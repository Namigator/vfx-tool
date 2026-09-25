// V2 graph preview workspace (WP03-PREVIEW-ADAPTER.md, 12-EDITOR). Limited point-particle preview of a v2
// graph document with a controlled graph canvas below it. DocumentHistory owns the authoritative document;
// React holds an owned snapshot of it plus diagnostics and tick. Particle state lives in the viewport, never
// in React state. Only semantic changes recompile, so moving nodes does not reset the simulation.
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Diagnostic, EffectDocumentV2 } from './model/types.ts';
import { validateDocument } from './model/document.ts';
import { createRegistry } from './graph/registry.ts';
import { compileParticlePreview } from './graph/toParticles.ts';
import { compilePathPreview } from './graph/toPaths.ts';
import { createF01Document } from './graph/fixtures.ts';
import { choosePreviewMode, createLightningDemoDocument, ribbonStyleDiagnostics, type PreviewModeChoice } from './render/previewMode.ts';
import { DocumentHistory, type HistoryNotice, type HistoryResult, type Patch } from './editor/history.ts';
import GraphCanvas from './editor/GraphCanvas.tsx';
import NodeInspector from './editor/NodeInspector.tsx';
import { PreviewViewport, type PreviewFrameInfo } from './render/PreviewViewport.ts';
import './preview-v2.css';

const EMPTY_FRAME: PreviewFrameInfo = { tick: 0, durationTicks: 0, playing: false, suspended: false, live: 0, mode: 'none', sampleParticleId: '' };
/** Documents larger than this are rejected before reading the file contents. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function describe(d: Diagnostic): string {
  const where = [d.fieldPath, d.nodeId && `node ${d.nodeId}`].filter(Boolean).join(' · ');
  return where ? `${d.code} at ${where}: ${d.message}` : `${d.code}: ${d.message}`;
}

const toText = (doc: EffectDocumentV2) => JSON.stringify(doc, null, 2);

/** Graph shown in the canvas: the saved opened graph if it exists, else the root graph. */
function canvasGraphId(doc: EffectDocumentV2): string {
  const opened = doc.editor?.openedGraphId;
  return opened && doc.graphs.some(g => g.id === opened) ? opened : doc.rootGraphId;
}

/** Keyboard shortcuts never fire while the user is typing in a text control. */
function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export default function PreviewV2() {
  const hostRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<PreviewViewport | null>(null);
  const historyRef = useRef<DocumentHistory | null>(null);
  if (historyRef.current === null) historyRef.current = new DocumentHistory(createF01Document());
  const [doc, setDoc] = useState<EffectDocumentV2>(() => historyRef.current!.snapshot());
  const [text, setText] = useState(() => toText(doc));
  const [textDirty, setTextDirty] = useState(false);
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [jsonErrors, setJsonErrors] = useState<Diagnostic[]>([]);
  const [editMessages, setEditMessages] = useState<string[]>([]);
  const [runtimeErrors, setRuntimeErrors] = useState<Diagnostic[]>([]);
  const [fatal, setFatal] = useState('');
  const [frame, setFrame] = useState<PreviewFrameInfo>(EMPTY_FRAME);
  const [compiled, setCompiled] = useState(false);
  const [mode, setMode] = useState<PreviewModeChoice['mode']>('points');
  const [expanded, setExpanded] = useState(false);
  // Bumped by every document replacement; async file reads apply only if still the latest request.
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const txCounterRef = useRef(0);
  const textDirtyRef = useRef(false);
  textDirtyRef.current = textDirty;

  /** Compiles the (structurally valid) document; errors clear the preview instead of keeping stale output. */
  const compile = useCallback((d: EffectDocumentV2) => {
    const vp = viewportRef.current;
    setRuntimeErrors([]);
    const choice = choosePreviewMode(d);
    setMode(choice.mode);
    if (choice.mode === 'mixed') {
      vp?.clearPlan();
      setCompiled(false);
      setDiagnostics(choice.errors);
      return;
    }
    if (choice.mode === 'paths') {
      // Tick 0 validates the document and style; later ticks recompile inside the viewport.
      const first = compilePathPreview(d, 0);
      if (!first.ok) {
        vp?.clearPlan();
        setCompiled(false);
        setDiagnostics(first.errors);
        return;
      }
      const style = ribbonStyleDiagnostics(d, first.value.layers);
      const blocked = style.some(s => s.severity === 'error');
      setDiagnostics([...first.warnings, ...style]);
      if (blocked) {
        vp?.clearPlan();
        setCompiled(false);
        return;
      }
      setCompiled(true);
      const snapshot = structuredClone(d); // Later edits never leak into the running source.
      vp?.setPathSource(first.value, tick => compilePathPreview(snapshot, tick));
      return;
    }
    const result = compileParticlePreview(d);
    if (!result.ok) {
      vp?.clearPlan();
      setCompiled(false);
      setDiagnostics(result.errors);
      return;
    }
    setDiagnostics(result.warnings);
    setCompiled(true);
    vp?.setPlan(result.value); // Starts paused at tick 0.
  }, []);

  /** Publishes the history's current document to React; the JSON text follows unless it has unapplied edits. */
  const publish = useCallback((recompile: boolean) => {
    const h = historyRef.current!;
    const next = h.snapshot();
    setDoc(next);
    setHistoryFlags({ canUndo: h.canUndo(), canRedo: h.canRedo() });
    if (!textDirtyRef.current) setText(toText(next));
    if (recompile) compile(next);
  }, [compile]);

  const noticeText = (notices: HistoryNotice[]) => notices.map(n => n.message);
  const failText = (label: string, r: HistoryResult) => (r.ok ? '' : `${label} failed (${r.code}): ${r.message}`);

  const onEdit = useCallback((label: string, patches: Patch[]) => {
    const h = historyRef.current!;
    const id = `edit-${++txCounterRef.current}`;
    const begun = h.begin(id, label);
    if (!begun.ok) { setEditMessages([failText(label, begun)]); return; }
    const applied = h.apply(patches);
    if (!applied.ok) { h.cancel(); setEditMessages([failText(label, applied)]); return; }
    const committed = h.commit();
    if (!committed.ok) { h.cancel(); setEditMessages([failText(label, committed)]); return; }
    setEditMessages(noticeText(committed.notices));
    if (committed.changed) publish(committed.semanticChanged);
  }, [publish]);

  const undo = useCallback(() => {
    const r = historyRef.current!.undo();
    if (!r.ok) return;
    setEditMessages([]);
    publish(r.semanticChanged);
  }, [publish]);

  const redo = useCallback(() => {
    const r = historyRef.current!.redo();
    if (!r.ok) return;
    setEditMessages([]);
    publish(r.semanticChanged);
  }, [publish]);

  /**
   * JSON Apply/Load/Reset: replaces the document and history only if the text parses and passes structural
   * validation. A structurally valid document that fails to compile is still accepted (and stays editable).
   * Rejected input leaves the current document, history and preview untouched; nothing is defaulted.
   */
  const replace = useCallback((source: string, origin: string): boolean => {
    generationRef.current++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (e) {
      setJsonErrors([{ code: 'INVALID_VALUE', severity: 'error', message: `${origin}: JSON parse error: ${e instanceof Error ? e.message : String(e)}. The current document was kept.` }]);
      return false;
    }
    const valid = validateDocument(parsed, { registry: createRegistry() });
    if (!valid.ok) {
      setJsonErrors([
        { code: 'INVALID_VALUE', severity: 'error', message: `${origin}: document rejected by structural validation. The current document was kept.` },
        ...valid.errors,
      ]);
      return false;
    }
    let next: DocumentHistory;
    try {
      next = new DocumentHistory(valid.value);
    } catch (e) {
      setJsonErrors([{ code: 'INVALID_VALUE', severity: 'error', message: `${origin}: ${e instanceof Error ? e.message : String(e)}. The current document was kept.` }]);
      return false;
    }
    historyRef.current = next;
    setJsonErrors(valid.warnings);
    setEditMessages([]);
    setTextDirty(false);
    textDirtyRef.current = false;
    publish(true);
    return true;
  }, [publish]);

  // Viewport lifetime; dispose is idempotent so StrictMode double-mount is safe.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    mountedRef.current = true;
    let vp: PreviewViewport | null = null;
    try {
      vp = new PreviewViewport(host, { onFrame: setFrame, onError: setRuntimeErrors });
      viewportRef.current = vp;
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    }
    // Diagnostics are still produced without WebGL; the graph canvas stays usable.
    compile(historyRef.current!.snapshot());
    return () => {
      mountedRef.current = false;
      generationRef.current++; // Invalidates in-flight file reads.
      vp?.dispose();
      if (viewportRef.current === vp) viewportRef.current = null;
    };
  }, [compile]);

  // Undo: Ctrl/Cmd+Z. Redo: Ctrl/Cmd+Shift+Z or Ctrl+Y. Suppressed in text inputs, textareas and contenteditable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (k === 'y' && !e.shiftKey) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const graphId = canvasGraphId(doc);
  const graph = doc.graphs.find(g => g.id === graphId);
  const selectedNode = selectedNodeId ? graph?.nodes.find(n => n.id === selectedNodeId) : undefined;

  // A selection whose node was deleted (edit, undo/redo or JSON replace) is cleared.
  useEffect(() => {
    if (selectedNodeId !== null && !selectedNode) setSelectedNodeId(null);
  }, [selectedNodeId, selectedNode]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const generation = ++generationRef.current;
    if (file.size > MAX_FILE_BYTES) {
      setJsonErrors([{ code: 'IMPORT_LIMIT', severity: 'error', message: `File is ${file.size} bytes; the limit is ${MAX_FILE_BYTES} bytes (5 MiB). Nothing was loaded.` }]);
      return;
    }
    const current = () => mountedRef.current && generation === generationRef.current;
    file.text().then(t => {
      if (!current()) return; // A newer apply/load or unmount superseded this read.
      if (!replace(t, `Load ${file.name}`)) {
        // Keep the rejected text visible for fixing without replacing the document.
        setText(t);
        setTextDirty(true);
      }
    }, err => {
      if (!current()) return;
      setJsonErrors([{ code: 'INVALID_VALUE', severity: 'error', message: `Could not read file: ${String(err)}` }]);
    });
  };

  const resetF01 = () => { replace(toText(createF01Document()), 'Reset to F01'); };
  const loadLightningDemo = () => { replace(toText(createLightningDemoDocument()), 'Load lightning demo'); };
  const revertText = () => { setText(toText(doc)); setTextDirty(false); };

  const vp = viewportRef.current;
  const disabled = !compiled || !!fatal || runtimeErrors.length > 0;
  const errors = diagnostics.filter(d => d.severity === 'error');
  const warnings = diagnostics.filter(d => d.severity !== 'error');

  return (
    <div className="pv2">
      <header className="pv2-header">
        <strong>V2 graph preview — {mode === 'paths' ? 'path ribbons' : mode === 'mixed' ? 'unsupported mix' : 'point particles'}</strong>
        <span className="pv2-note">
          {mode === 'paths'
            ? 'Limited preview of graph data (camera-facing untextured ribbons). No textures, bloom or sound.'
            : 'Limited preview of graph data (point emitters, camera quads). No textures, bloom or sound.'}
        </span>
        <div className="pv2-history" role="group" aria-label="History">
          <button type="button" disabled={!historyFlags.canUndo} onClick={undo} title="Undo (Ctrl/Cmd+Z)">Undo</button>
          <button type="button" disabled={!historyFlags.canRedo} onClick={redo} title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
        </div>
        <a className="pv2-link" href={window.location.pathname}>Back to v1 editor</a>
      </header>
      <main className="pv2-main">
        <section className={expanded ? 'pv2-stage pv2-expanded' : 'pv2-stage'}>
          <div className="pv2-host" ref={hostRef} />
          {fatal && <div className="pv2-overlay pv2-error" role="alert">{fatal}</div>}
          {!fatal && !compiled && <div className="pv2-overlay">No preview: the document does not compile (see diagnostics).</div>}
          {runtimeErrors.length > 0 && (
            <div className="pv2-overlay pv2-error" role="alert">
              Simulation stopped: {runtimeErrors.map(describe).join(' | ')}
            </div>
          )}
          <div className="pv2-transport">
            <button type="button" disabled={disabled} onClick={() => (frame.playing ? vp?.pause() : vp?.play())}>
              {frame.playing ? 'Pause' : frame.suspended ? 'Resume' : 'Play'}
            </button>
            <button type="button" disabled={disabled} onClick={() => vp?.restart()}>Restart</button>
            {/* Viewport ResizeObserver refits path framing to the new size until the user orbits. */}
            <button type="button" aria-pressed={expanded} onClick={() => setExpanded(e => !e)}>
              {expanded ? 'Collapse preview' : 'Expand preview'}
            </button>
            <input
              type="range" min={0} max={frame.durationTicks} step={1} value={frame.tick} disabled={disabled}
              aria-label="Tick" onChange={e => vp?.seek(Number(e.target.value))}
            />
            {/* Not a live region: per-frame tick changes must not be announced. Errors use role="alert". */}
            <span className="pv2-readout" title={frame.sampleParticleId ? `Sample particle ${frame.sampleParticleId}` : undefined}>
              {frame.suspended && <>Paused (tab hidden) · </>}
              tick {frame.tick}/{frame.durationTicks} · {frame.live} {frame.mode === 'paths' ? 'paths' : 'live'}
            </span>
          </div>
          {frame.sampleParticleId && (
            <details className="pv2-tech">
              <summary>Technical details</summary>
              Sample particle ID: <code>{frame.sampleParticleId}</code>
            </details>
          )}
          <div className="pv2-graph" aria-label="Graph editor">
            <GraphCanvas
              document={doc}
              graphId={graphId}
              selectedNodeId={selectedNode ? selectedNode.id : undefined}
              onSelectNode={setSelectedNodeId}
              onEdit={onEdit}
            />
          </div>
        </section>
        <aside className="pv2-side">
          <section className="pv2-panel" aria-label="Selected node">
            <h2 className="pv2-heading">Selected node</h2>
            {selectedNode ? (
              <NodeInspector document={doc} graphId={graphId} nodeId={selectedNode.id} onEdit={onEdit} />
            ) : (
              <p className="pv2-muted">No node selected. Select a node in the graph.</p>
            )}
          </section>
          {editMessages.length > 0 && (
            <ul className="pv2-diags" role="alert">
              {editMessages.map((m, i) => <li key={i} className="pv2-warn">{m}</li>)}
            </ul>
          )}
          <ul className="pv2-diags" role="status" aria-live="polite" aria-label="Diagnostics">
            {errors.map((d, i) => <li key={`e${i}`} className="pv2-error">{describe(d)}</li>)}
            {warnings.map((d, i) => <li key={`w${i}`} className="pv2-warn">{describe(d)}</li>)}
            {compiled && errors.length === 0 && <li className="pv2-ok">Compiled; loads paused at tick 0.</li>}
          </ul>
          <details className="pv2-advanced">
            <summary>Advanced: document JSON</summary>
            <div className="pv2-actions">
              <button type="button" onClick={() => { replace(text, 'Apply JSON'); }}>Apply JSON</button>
              <button type="button" onClick={() => fileRef.current?.click()}>Load file…</button>
              <input ref={fileRef} className="pv2-file-input" type="file" accept=".json,application/json" tabIndex={-1} aria-hidden="true" onChange={onFile} />
              <button type="button" onClick={resetF01}>Reset to F01</button>
              <button type="button" onClick={loadLightningDemo}>Load lightning demo</button>
              {textDirty && <button type="button" onClick={revertText}>Revert text</button>}
            </div>
            <p className="pv2-muted">Apply, Load and Reset replace the document and clear undo history.</p>
            {textDirty && <p className="pv2-warn">JSON text has unapplied edits; graph changes are not reflected here until reverted.</p>}
            <textarea
              className="pv2-json" spellCheck={false} value={text} aria-label="Graph document JSON"
              onChange={e => { setText(e.target.value); setTextDirty(true); }}
            />
            <ul className="pv2-diags" role="status" aria-live="polite" aria-label="JSON diagnostics">
              {jsonErrors.map((d, i) => <li key={i} className={d.severity === 'error' ? 'pv2-error' : 'pv2-warn'}>{describe(d)}</li>)}
            </ul>
          </details>
        </aside>
      </main>
    </div>
  );
}
