// V2 graph preview workspace (WP03-PREVIEW-ADAPTER.md, 12-EDITOR). Limited point-particle preview of a v2
// graph document with a controlled graph canvas below it. DocumentHistory owns the authoritative document;
// React holds an owned snapshot of it plus diagnostics and tick. Particle state lives in the viewport, never
// in React state. Only semantic changes recompile, so moving nodes does not reset the simulation.
import { soloMask } from './graph/solo.ts';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { Diagnostic, EffectDocumentV2 } from './model/types.ts';
import { validateDocument } from './model/document.ts';
import { createRegistry } from './graph/registry.ts';
import { compileParticlePreview, type FollowerTravel } from './graph/toParticles.ts';
import { grownDuration, truncationWarning } from './graph/truncation.ts';
import { glowSettings } from './graph/glow.ts';
import { convertLegacyRecipe, formatMigrationReport } from './model/migrate.ts';
import { createRecipe, parseRecipe, validateRecipe } from './core/recipe.ts';
import { FAMILIES, type Recipe } from './core/types.ts';
import { compilePathPreview } from './graph/toPaths.ts';
import { createBlankDocument, createF01Document, createForcesDemoDocument } from './graph/fixtures.ts';
import { TexturePanel } from './editor/TexturePanel.tsx';
import { LibraryPanel } from './editor/LibraryPanel.tsx';
import { ExportMediaDialog } from './editor/ExportMediaDialog.tsx';
import { userComponentsText } from './editor/userComponentStore.ts';
import { deleteAssetBytes, listAssetBytes, unusedAssetHashes, getAssetBytes, openProjectStorage, putAssetBytes } from './model/assetStore.ts';
import { buildPack, readPack, type PackAsset } from './model/vfxpack.ts';
import { hasAssetUrl, registerAssetUrl } from './assets/assetUrls.ts';
import { CORRUPT_KEY, DRAFT_KEY, REVISIONS_KEY, DRAFT_META_KEY, SHELF_KEY, TRASH_KEY, documentFileName, mergeEntryLists, emptyTrash, loadDraftText, readDraftMeta, readShelf, readTrash, recoverDraft, removeFromShelf, restoreFromTrash, saveDraft, saveToShelf, type DraftStorage, type ShelfEntry, type TrashEntry } from './model/persistence.ts';
import { ControlsPanel } from './editor/ControlsPanel.tsx';
import { OutlinePanel } from './editor/OutlinePanel.tsx';
import { compileAudio } from './graph/toAudio.ts';
import { choosePreviewMode, createLightningAudioDemoDocument, hasRootAudio, ribbonStyleDiagnostics, type PreviewModeChoice } from './render/previewMode.ts';
import { AudioTransport, type AudioBufferLike, type AudioContextLike, type BufferSourceLike, type PlayResult } from './audio/transport.ts';
import type { MixResult } from './audio/mix.ts';
import { encodeWavPcm16Stereo } from './audio/wav.ts';
import { describePack, jsonExportWarning, pinBuiltins, referencedBuiltinSprites, type EmbeddedBuiltin, type PinnedBuiltin } from './model/packBuiltins.ts';
import { BUILTIN_SPRITES } from './assets/builtinSprites.generated.ts';
import type { SpriteSheet } from './assets/spriteLibrary.ts';
import { sha256Hex } from './assets/importTexture.ts';
import { DocumentHistory, type HistoryNotice, type HistoryResult, type Patch } from './editor/history.ts';
import GraphCanvas from './editor/GraphCanvas.tsx';
import NodeInspector from './editor/NodeInspector.tsx';
import { PreviewViewport, type PreviewFrameInfo } from './render/PreviewViewport.ts';
import { mergeDiagnostics } from './render/layerOrder.ts';
import { timelineInfo, timelineLanes, type TimelineInfo } from './render/timeline.ts';
import { TimelineStrip } from './editor/TimelineStrip.tsx';
import { SplitPane } from './editor/SplitPane.tsx';
import { MenuButton, OverlayMenu, type MenuItem } from './editor/MenuButton.tsx';
import { IconUndo, IconRedo, IconPlay, IconPause, IconRestart, IconStepBack, IconStepForward, IconChevronDown, IconPanelLeft, IconPanelRight, IconPanelBottom, IconEye } from './editor/icons.tsx';
import './preview-v2.css';

const EMPTY_FRAME: PreviewFrameInfo = { tick: 0, durationTicks: 0, playing: false, suspended: false, live: 0, mode: 'none', sampleParticleId: '' };
/** Documents larger than this are rejected before reading the file contents. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function describe(d: Diagnostic): string {
  const where = [d.fieldPath, d.nodeId && `node ${d.nodeId}`].filter(Boolean).join(' · ');
  return where ? `${d.code} at ${where}: ${d.message}` : `${d.code}: ${d.message}`;
}

/** 12 "Error panel can focus the responsible node/field": a diagnostic naming a node is a button that selects it. */
function DiagText({ d, onFocus }: { d: Diagnostic; onFocus: (d: Diagnostic) => void }) {
  return d.nodeId
    ? <button type="button" className="pv2-diag-link" title="Show the node (and field) this is about" onClick={() => onFocus(d)}>{describe(d)}</button>
    : <>{describe(d)}</>;
}

const toText = (doc: EffectDocumentV2) => JSON.stringify(doc, null, 2);

/** A selected Schedule's own window (start, start + duration) for the timeline highlight. */
function scheduleWindow(n: EffectDocumentV2['graphs'][number]['nodes'][number] | undefined): [number, number] | undefined {
  if (n?.type !== 'Schedule') return undefined;
  const s = Number(n.params.startTicks ?? 0), d = Number(n.params.durationTicks ?? 0);
  return [s, s + Math.max(1, d)];
}

/** The validated canonical mix of one audio compile; the revision changes on every compile. */
type HeldAudio = { revision: string; mix: MixResult };

const PLAY_FAILURES: Record<Extract<PlayResult, { ok: false }>['reason'], string> = {
  'no-buffer': 'no mix is loaded.',
  'suspended': 'the browser kept audio suspended. Click Play sound again.',
  'resume-rejected': 'the browser refused to start audio.',
  'stale': 'the request was superseded.',
  'disposed': 'audio was shut down.',
  'offset-out-of-range': 'the start position is outside the mix.',
};

/**
 * Adapts a native AudioContext to the transport's minimal interface without casts. Buffer sources are
 * wrapped because the native onended handler takes an Event and a `this`; buffers and connect targets are
 * checked at runtime to be native Web Audio objects.
 */
function browserAudioContext(ctx: AudioContext): AudioContextLike {
  const wrapSource = (node: AudioBufferSourceNode): BufferSourceLike => {
    let ended: (() => void) | null = null;
    node.onended = () => { ended?.(); };
    return {
      get buffer(): AudioBufferLike | null { return node.buffer; },
      set buffer(b: AudioBufferLike | null) {
        if (b !== null && !(b instanceof AudioBuffer)) throw new TypeError('buffer must be a native AudioBuffer');
        node.buffer = b;
      },
      get onended(): (() => void) | null { return ended; },
      set onended(f: (() => void) | null) { ended = f; },
      start: (when: number, offset: number) => node.start(when, offset),
      stop: () => node.stop(),
      connect: (destination: unknown) => {
        if (!(destination instanceof AudioNode)) throw new TypeError('destination must be a native AudioNode');
        return node.connect(destination);
      },
      disconnect: () => node.disconnect(),
    };
  };
  return {
    get currentTime() { return ctx.currentTime; },
    get state() { return ctx.state; },
    get destination() { return ctx.destination; },
    resume: () => ctx.resume(),
    createGain: () => ctx.createGain(),
    createBufferSource: () => wrapSource(ctx.createBufferSource()),
    createBuffer: (channels: number, length: number, sampleRate: number) => ctx.createBuffer(channels, length, sampleRate),
    getOutputTimestamp: () => ctx.getOutputTimestamp(),
  };
}

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
  /** Set when the latest draft was unreadable and an older revision was restored (13 recovery). */
  const recoveredFromRef = useRef<string | null>(null);
  if (historyRef.current === null) {
    const q = new URLSearchParams(window.location.search), demo = q.get('demo');
    // Demo/doc URLs win; otherwise the last local draft (if it still validates), else the F01 fixture.
    const draft = () => {
      if (q.get('doc')) return null;
      const parse = (text: string) => { try { const v = validateDocument(JSON.parse(text), { registry: createRegistry() }); return v.ok ? v.value : null; } catch { return null; } };
      const r = recoverDraft(typeof localStorage === 'undefined' ? undefined : localStorage, parse);
      if (r?.recoveredFrom) recoveredFromRef.current = r.recoveredFrom;
      return r?.value ?? null;
    };
    historyRef.current = new DocumentHistory(demo === 'lightning' ? createLightningAudioDemoDocument() : demo === 'forces' ? createForcesDemoDocument() : draft() ?? createBlankDocument()); // First run: a blank effect; the Library offers the presets.
  }
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
  const [gpuLost, setGpuLost] = useState(false);
  /** 12: reduced effects (no screen flash / camera shake); starts from the system prefers-reduced-motion setting. */
  const [reducedEffects, setReducedEffects] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [followers, setFollowers] = useState<FollowerTravel[]>([]);
  const [mode, setMode] = useState<PreviewModeChoice['mode']>('points');
  const [glow, setGlow] = useState(true);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [syncSound, setSyncSound] = useState(true);
  const [looping, setLooping] = useState(false);
  /** 12 transport: playback speed and "New seed on cast" (preview-only; the saved seed never changes). */
  const [speed, setSpeed] = useState(1);
  const [newSeed, setNewSeed] = useState(false);
  const seedOffsetRef = useRef(0);
  const [timeline, setTimeline] = useState<TimelineInfo>({ markers: [], windows: new Map() });
  const onLoopRef = useRef<() => void>(() => {});
  const [lightBg, setLightBg] = useState(false);
  const [grid, setGrid] = useState(true);
  /** 06 Solo: preview-only mask of soloed nodes (never saved in the effect). */
  const [solo, setSolo] = useState<ReadonlySet<string>>(() => new Set());
  const toggleSolo = useCallback((id: string) => setSolo(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  // 12 "Below 1024 px show a compact preview and 'Desktop authoring recommended'".
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1024);
  useEffect(() => { const on = () => setNarrow(window.innerWidth < 1024); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  // 12 workspace: the library is a left panel at >= 1280 px and a toggled drawer below (closed in the watch-only ?view=1 page).
  const [libraryOpen, setLibraryOpen] = useState(() => window.innerWidth >= 1280 && new URLSearchParams(window.location.search).get('view') !== '1');
  // Redesigned shell (2026-10): resizable panes, one compact top bar, tabbed right inspector.
  const [rightOpen, setRightOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'controls' | 'node' | 'outline' | 'assets' | 'sound' | 'diagnostics'>('controls');
  const [showProjects, setShowProjects] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  // Bumped by every document replacement; async file reads apply only if still the latest request.
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const txCounterRef = useRef(0);
  const textDirtyRef = useRef(false);
  textDirtyRef.current = textDirty;
  // Audio audition: the canonical mix of the current compile (null when absent/invalid), plus the lazily
  // created device context and transport. The token invalidates pending plays and end-of-sound timers.
  const [audio, setAudio] = useState<HeldAudio | null>(null);
  const [soundStatus, setSoundStatus] = useState('');
  const audioRef = useRef<HeldAudio | null>(null);
  const audioRevisionRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const transportRef = useRef<AudioTransport | null>(null);
  const soundTokenRef = useRef(0);
  const soundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Stops any audition sound and invalidates in-flight Play clicks. */
  const stopSound = useCallback((status: string) => {
    soundTokenRef.current++;
    if (soundTimerRef.current !== null) { clearTimeout(soundTimerRef.current); soundTimerRef.current = null; }
    transportRef.current?.stop();
    setSoundStatus(status);
  }, []);

  /**
   * Compiles the (structurally valid) document; errors clear the preview instead of keeping stale output.
   * Root audio is compiled first; only a successful audio compile lets the visual compiler skip the audio edge.
   */
  /**
   * 12 "Invalid graph pauses with last valid preview clearly marked stale": while editing, a broken graph keeps the last
   * working preview on screen (paused) with a stale notice; a newly loaded document that does not compile shows none.
   */
  const lastGoodRef = useRef(false);
  const pauseStale = () => { const vp = viewportRef.current; if (lastGoodRef.current) vp?.pause(); else vp?.clearPlan(); };
  const compile = useCallback((authored: EffectDocumentV2) => {
    // New seed on cast (preview-only): each loop plays a different random pattern; the document keeps its seed.
    const d = seedOffsetRef.current ? { ...authored, seed: (authored.seed + seedOffsetRef.current * 7919) >>> 0 } : authored;
    const vp = viewportRef.current;
    // An edit made while paused keeps the playhead where it is (keyframing: move the playhead, change a knob).
    const keepTick = vp && !vp.isPlaying ? vp.currentTick : 0;
    const restore = () => { if (keepTick > 0) vp?.seek(Math.min(keepTick, d.durationTicks)); };
    setRuntimeErrors([]);
    stopSound(transportRef.current?.status === 'playing' ? 'Sound stopped: the document changed.' : '');
    audioRef.current = null;
    setAudio(null);
    const fail = (errors: Diagnostic[]) => {
      pauseStale();
      setCompiled(false);
      setDiagnostics(errors);
    };
    let audioWarnings: Diagnostic[] = [];
    const visualOptions: { audioHandled?: boolean } = {};
    if (hasRootAudio(d)) {
      const a = compileAudio(d);
      if (!a.ok) {
        setMode(choosePreviewMode(d).mode);
        fail(a.errors);
        return;
      }
      const held: HeldAudio = { revision: `audio-${++audioRevisionRef.current}`, mix: a.value.mix };
      audioRef.current = held;
      setAudio(held);
      audioWarnings = a.warnings;
      visualOptions.audioHandled = true;
    }
    vp?.setGlowSettings(glowSettings(d));
    const choice = choosePreviewMode(d);
    setMode(choice.mode);
    if (choice.mode === 'mixed') {
      // Both compilers must succeed; the particle compiler leaves ribbon sinks to the path compiler.
      const points = compileParticlePreview(d, { ...visualOptions, ribbonsHandled: true });
      const first = compilePathPreview(d, 0, visualOptions);
      if (!points.ok || !first.ok) {
        fail(mergeDiagnostics(points.ok ? [] : points.errors, first.ok ? [] : first.errors, audioWarnings));
        return;
      }
      const style = ribbonStyleDiagnostics(d, first.value.layers);
      const cut = truncationWarning(d);
      setDiagnostics(mergeDiagnostics(audioWarnings, points.warnings, first.warnings, style, cut ? [cut] : []));
      if (style.some(s => s.severity === 'error')) {
        pauseStale();
        setCompiled(false);
        return;
      }
      setCompiled(true); lastGoodRef.current = true;
      setFollowers(points.value.followers);
      setTimeline(timelineInfo(points.value, first.value));
      const snapshot = structuredClone(d);
      vp?.setMixedSource(points.value, first.value, tick => compilePathPreview(snapshot, tick, visualOptions));
      restore();
      return;
    }
    if (choice.mode === 'paths') {
      // Tick 0 validates the document and style; later ticks recompile inside the viewport.
      const first = compilePathPreview(d, 0, visualOptions);
      if (!first.ok) {
        fail([...first.errors, ...audioWarnings]);
        return;
      }
      const style = ribbonStyleDiagnostics(d, first.value.layers);
      const blocked = style.some(s => s.severity === 'error');
      const cut = truncationWarning(d);
      setDiagnostics([...audioWarnings, ...first.warnings, ...style, ...(cut ? [cut] : [])]);
      if (blocked) {
        pauseStale();
        setCompiled(false);
        return;
      }
      setCompiled(true); lastGoodRef.current = true;
      setTimeline(timelineInfo(null, first.value));
      const snapshot = structuredClone(d); // Later edits never leak into the running source.
      vp?.setPathSource(first.value, tick => compilePathPreview(snapshot, tick, visualOptions));
      restore();
      return;
    }
    const result = compileParticlePreview(d, visualOptions);
    if (!result.ok) {
      fail([...result.errors, ...audioWarnings]);
      return;
    }
    const cut = truncationWarning(d);
    setDiagnostics([...audioWarnings, ...result.warnings, ...(cut ? [cut] : [])]);
    setCompiled(true); lastGoodRef.current = true;
    setFollowers(result.value.followers);
    setTimeline(timelineInfo(result.value, null));
    vp?.setPlan(result.value); // Starts paused at tick 0.
    restore();
  }, [stopSound]);

  /** User gesture only: lazily creates the AudioContext, loads the current mix and plays it from the start. */
  /** Plays the held mix from `fromTick` (800 samples per tick); the visual transport calls this to stay in sync. */
  const playSound = useCallback(async (fromTick = 0) => {
    const held = audioRef.current;
    if (!held) return;
    const token = ++soundTokenRef.current;
    if (soundTimerRef.current !== null) { clearTimeout(soundTimerRef.current); soundTimerRef.current = null; }
    let transport = transportRef.current;
    if (!transport) {
      if (typeof AudioContext !== 'function') { setSoundStatus('Sound unavailable: this browser has no Web Audio AudioContext.'); return; }
      try {
        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        transport = new AudioTransport(browserAudioContext(ctx));
        transportRef.current = transport;
      } catch (e) {
        setSoundStatus(`Sound unavailable: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    try {
      if (transport.currentRevision !== held.revision) transport.setMix(held.revision, held.mix);
    } catch (e) {
      setSoundStatus(`Sound rejected: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setSoundStatus('Starting sound…');
    const offset = Math.max(0, Math.round(fromTick * 800));
    if (offset >= held.mix.left.length) { setSoundStatus('Sound already finished at this tick.'); return; }
    const r = await transport.play(offset);
    if (!mountedRef.current || token !== soundTokenRef.current) return; // Stopped, replaced or unmounted meanwhile.
    if (audioRef.current !== held) { transport.stop(); return; }
    if (!r.ok) { setSoundStatus(`Sound not played: ${PLAY_FAILURES[r.reason]}`); return; }
    setSoundStatus(offset === 0 ? 'Playing sound from the start.' : `Playing sound from tick ${fromTick}.`);
    const ms = ((held.mix.left.length - offset) / held.mix.sampleRate) * 1000 + 250;
    soundTimerRef.current = setTimeout(() => {
      soundTimerRef.current = null;
      if (token === soundTokenRef.current) setSoundStatus('Sound finished.');
    }, ms);
  }, []);

  useEffect(() => {
    onLoopRef.current = () => {
      if (newSeed) { seedOffsetRef.current++; compile(historyRef.current!.snapshot()); viewportRef.current?.play(); }
      if (syncSound && audioRef.current) void playSound(0);
    };
  }, [syncSound, playSound, newSeed, compile]);

  // Autosave: mirror every committed document to local storage (debounced); status is announced politely.
  const [saveStatus, setSaveStatus] = useState('');
  /** File actions (Keep, Export pack, Open pack, Remove) report here; autosave never overwrites it. */
  const [fileNote, setFileNote] = useState(() => recoveredFromRef.current ? `The latest autosave could not be read; restored the version saved ${new Date(recoveredFromRef.current).toLocaleString()}.` : '');
  // Two tabs (13): autosave is a compare-and-swap on the draft revision; a tab that fell behind stops saving
  // and offers to load the other tab's version or keep its own as a project copy.
  const tabIdRef = useRef(Math.random().toString(36).slice(2));
  const baseRevisionRef = useRef(readDraftMeta(typeof localStorage === 'undefined' ? undefined : localStorage).revision);
  const [stale, setStale] = useState(false);
  // 12: leaving the page while the last save failed (or another tab took over) warns instead of losing work silently.
  const unsavedRef = useRef(false);
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (unsavedRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);
  // ?view=1 (review links): watch a served document without autosaving over the user's own draft.
  const viewOnly = useRef(new URLSearchParams(window.location.search).get('view') === '1').current;
  useEffect(() => {
    if (stale || viewOnly) return;
    const t = setTimeout(() => {
      const r = saveDraft(localStorage, doc, new Date(), { tabId: tabIdRef.current, baseRevision: baseRevisionRef.current });
      if (r.ok) baseRevisionRef.current = r.revision;
      else if (r.conflict) setStale(true);
      unsavedRef.current = !r.ok;
      setSaveStatus(r.ok ? 'Saved locally' : r.conflict ? 'Not saved: changed in another tab' : `Save failed: ${r.message} — use Save .json or Export pack to keep a copy`);
    }, 400);
    return () => clearTimeout(t);
  }, [doc, stale, viewOnly]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DRAFT_META_KEY) return;
      const m = readDraftMeta(localStorage);
      if (m.tabId !== tabIdRef.current && m.revision !== baseRevisionRef.current) setStale(true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const downloadDocument = useCallback(() => {
    const d = historyRef.current!.snapshot();
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = documentFileName(d);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setFileNote(jsonExportWarning(d) ?? `Saved ${documentFileName(d)}`);
  }, []);
  const openInputRef = useRef<HTMLInputElement>(null);

  /** Portable .vfxpack: the effect plus every imported asset's bytes; missing bytes export a labelled draft. */
  const downloadPack = useCallback(async () => {
    const d = historyRef.current!.snapshot();
    const bytes = new Map<string, PackAsset>();
    for (const a of d.assets) {
      const rec = a.source.kind === 'bundle' ? await getAssetBytes(a.sha256) : undefined;
      if (rec) bytes.set(a.sha256, { sha256: a.sha256, mime: rec.mime, bytes: new Uint8Array(await rec.blob.arrayBuffer()) });
    }
    // Included-library sprites and the rendered sound mix travel inside the pack (13-PERSISTENCE).
    const builtins: EmbeddedBuiltin[] = [];
    for (const id of referencedBuiltinSprites(d)) {
      const sheet = BUILTIN_SPRITES.find(x => x.id === id);
      const res = sheet ? await fetch(`/assets/sprites/${sheet.file}`).catch(() => null) : null;
      if (sheet && res?.ok) builtins.push({ id, sheet: structuredClone(sheet) as SpriteSheet, bytes: new Uint8Array(await res.arrayBuffer()) });
    }
    const audio = hasRootAudio(d) ? compileAudio(d) : undefined;
    const mixWav = audio?.ok ? encodeWavPcm16Stereo(audio.value.mix.left, audio.value.mix.right, audio.value.mix.sampleRate) : undefined;
    const extras = { builtins, ...(mixWav ? { mixWav } : {}) };
    let r = await buildPack(d, bytes, extras);
    let note = '';
    if (!r.ok && /Missing asset bytes/.test(r.message)) { note = ` Exported as a DRAFT: ${r.message}`; r = await buildPack(d, bytes, { ...extras, draft: true }); }
    if (!r.ok) { setFileNote(`Pack export failed: ${r.message}`); return; }
    const url = URL.createObjectURL(new Blob([r.value as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url; a.download = documentFileName(d).replace(/\.vfx\.json$/, '.vfxpack');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setFileNote(`Pack exported (${(r.value.length / 1024).toFixed(0)} KiB).${note}`);
  }, []);

  /**
   * Roblox export (user order: engine export, first target Roblox): a .rbxmx model (ParticleEmitters, Beams,
   * PointLights + the EffectPlayer script) and its conversion report. Loaded on demand so the editor stays light.
   * Texture ids come from /work/roblox/asset-ids.json when that file exists (sheet file -> rbxassetid).
   */
  const downloadRoblox = useCallback(async () => {
    const d = historyRef.current!.snapshot();
    setFileNote('Exporting for Roblox…');
    const [{ robloxEffectFrom }, { writeRbxmx }, { reportMarkdown }, player] = await Promise.all([
      import('./export/roblox/fromPlan.ts'), import('./export/roblox/rbxmx.ts'), import('./export/roblox/report.ts'), import('./export/roblox/EffectPlayer.luau?raw'),
    ]);
    const r = robloxEffectFrom(d);
    if (!r.ok) { setFileNote(`Roblox export failed: ${r.message}`); return; }
    const assetIds: Record<string, string> = await fetch('/work/roblox/asset-ids.json', { cache: 'no-store' }).then(x => (x.ok ? x.json() : {})).catch(() => ({}));
    const base = documentFileName(d).replace(/\.vfx\.json$/, '');
    const save = (text: string, name: string, type: string) => {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
    save(writeRbxmx(r.value, { assetIds, playerSource: player.default }), `${base}.rbxmx`, 'application/xml');
    save(reportMarkdown(r.value, assetIds), `${base}.roblox-report.md`, 'text/markdown');
    const e = r.value, left = e.report.filter(x => x.level === 'dropped').length, missing = e.textures.filter(t => !assetIds[t]).length;
    setFileNote(`Roblox export: ${e.emitters.length} emitters, ${e.beams.length} beam layers, ${e.lights.length} lights. ${left} feature(s) left out${missing ? `, ${missing} texture(s) not uploaded yet` : ''} - see the report file.`);
  }, []);

  /**
   * Opens a .vfxpack in two steps (13 "Stage ... then Import commits atomically"): checksums, paths and the document
   * are verified and a summary is shown; nothing is stored until Import. Changed included sprites are pinned.
   */
  const [stagedPack, setStagedPack] = useState<{ name: string; doc: EffectDocumentV2; assets: PackAsset[]; pinned: PinnedBuiltin[]; summary: string[] } | null>(null);
  const openPack = useCallback(async (f: File) => {
    setStagedPack(null);
    const r = await readPack(new Uint8Array(await f.arrayBuffer()));
    if (!r.ok) { setFileNote(`Pack rejected: ${r.message}`); return; }
    const v = validateDocument(r.value.document, { registry: createRegistry() });
    if (!v.ok) { setFileNote(`Pack rejected: its effect is invalid (${v.errors[0]?.message ?? 'unknown error'}).`); return; }
    const current = new Map<string, string>();
    for (const b of r.value.builtins) {
      const sheet = BUILTIN_SPRITES.find(x => x.id === b.id), res = sheet ? await fetch(`/assets/sprites/${sheet.file}`).catch(() => null) : null;
      if (res?.ok) current.set(b.id, await sha256Hex(new Uint8Array(await res.arrayBuffer())));
    }
    const pinned = await pinBuiltins(v.value, r.value.builtins, id => current.get(id));
    if (!pinned.ok) { setFileNote(`Pack rejected: ${pinned.message}`); return; }
    const summary = describePack(pinned.doc, r.value.manifest, { importedFiles: r.value.assets.length, builtins: r.value.builtins.length, pinned: pinned.pinned.map(p => p.id), mixWav: !!r.value.mixWav, notices: r.value.notices, warnings: v.warnings.map(w => w.message) });
    setStagedPack({ name: f.name, doc: pinned.doc, assets: r.value.assets, pinned: pinned.pinned, summary });
  }, []);
  const importStagedPack = useCallback(async () => {
    const st = stagedPack;
    if (!st) return;
    for (const a of [...st.assets, ...st.pinned]) {
      const blob = new Blob([a.bytes as Uint8Array<ArrayBuffer>], { type: a.mime });
      await putAssetBytes(a.sha256, a.mime, blob);
      registerAssetUrl(a.sha256, URL.createObjectURL(blob));
    }
    setStagedPack(null);
    if (replaceRef.current(JSON.stringify(st.doc), `Open ${st.name}`)) setFileNote(`Opened ${st.name}.`);
  }, [stagedPack]);
  const replaceRef = useRef<(source: string, origin: string) => boolean>(() => false);

  // Project shelf: several named effects kept in browser storage (Keep / choose / Remove).
  const [shelf, setShelf] = useState<ShelfEntry[]>(() => readShelf(typeof localStorage === 'undefined' ? undefined : localStorage));
  const [shelfPick, setShelfPick] = useState('');
  const [trash, setTrash] = useState<TrashEntry[]>(() => readTrash(typeof localStorage === 'undefined' ? undefined : localStorage));
  const [trashPick, setTrashPick] = useState('');
  // 14-MIGRATION: v1 presets (read-only, never modified) and the ten v1 defaults can be converted into a NEW graph copy.
  const legacy = useMemo<Recipe[]>(() => {
    const own: Recipe[] = [];
    try { const raw = JSON.parse(localStorage.getItem('vfx-studio-presets-v1') ?? '[]'); if (Array.isArray(raw)) for (const x of raw.slice(0, 50)) { try { own.push(validateRecipe(x)); } catch { /* skip unreadable */ } } } catch { /* none */ }
    return [...own, ...FAMILIES.map(f => createRecipe(f))];
  }, []);
  const [legacyPick, setLegacyPick] = useState('');
  const [migrationReport, setMigrationReport] = useState('');
  // Projects and trash live in IndexedDB once it opens (localStorage until then, and as the fallback).
  const projectsRef = useRef<DraftStorage>(typeof localStorage === 'undefined' ? { getItem: () => null, setItem: () => {} } : localStorage);
  useEffect(() => {
    let live = true;
    void openProjectStorage([SHELF_KEY, TRASH_KEY], m => setFileNote(m), (_key, stored, legacy) => mergeEntryLists(stored, legacy)).then(store => {
      if (!live || !store) return;
      projectsRef.current = store;
      setShelf(readShelf(store));
      setTrash(readTrash(store));
    });
    return () => { live = false; };
  }, []);
  /** 13 explicit asset cleanup: removes stored bytes nothing references (current effect, undo history, autosave and its revisions, projects, trash, saved components). */
  const cleanupAssets = useCallback(async () => {
    const stored = await listAssetBytes();
    const ls = typeof localStorage === 'undefined' ? null : localStorage;
    const texts = [JSON.stringify(historyRef.current!.snapshot()), historyRef.current!.patchText(), ls?.getItem(DRAFT_KEY), ls?.getItem(REVISIONS_KEY), ls?.getItem(CORRUPT_KEY),
      projectsRef.current.getItem(SHELF_KEY), projectsRef.current.getItem(TRASH_KEY), userComponentsText()];
    const unused = unusedAssetHashes(stored.map(s => s.byteHash), texts);
    if (!unused.length) { setFileNote(`No unused imported files (${stored.length} stored, all in use).`); return; }
    if (!window.confirm(`Remove ${unused.length} imported file(s) that nothing uses any more? This cannot be undone.`)) return;
    const freed = await deleteAssetBytes(unused, new Map(stored.map(s => [s.byteHash, s.size])));
    setFileNote(freed > 0 ? `Removed ${unused.length} unused file(s); ${(freed / 1024).toFixed(0)} KiB freed.` : 'Cleanup failed; nothing was removed.');
  }, []);
  /** Downloads text as a file (13: unreadable autosaves and unknown-version files stay downloadable, never discarded). */
  const downloadText = (name: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const keepProject = useCallback(() => {
    const r = saveToShelf(projectsRef.current, historyRef.current!.snapshot());
    if (r.ok) { setShelf(r.entries); setShelfPick(r.entries[0].name); setFileNote(`Kept "${r.entries[0].name}" in projects`); }
    else setFileNote(r.message);
  }, []);

  /** Downloads the exact mix held for the current audio revision; never re-renders. */
  const downloadWav = useCallback(() => {
    const held = audioRef.current;
    if (!held) return;
    let bytes: Uint8Array;
    try {
      bytes = encodeWavPcm16Stereo(held.mix.left, held.mix.right, held.mix.sampleRate);
    } catch (e) {
      setSoundStatus(`WAV export failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const name = `${(historyRef.current!.snapshot().name || 'effect').replace(/[^\w.-]+/g, '_')}.wav`;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
    const before = patches.some(p => p.path[0] === 'controls') ? h.snapshot() : null;
    const applied = h.apply(patches);
    if (!applied.ok) { h.cancel(); setEditMessages([failText(label, applied)]); return; }
    // Knob edits lengthen the effect when they push its end past the duration (never shorten; same rule as vfx_set_control).
    const grow = before ? grownDuration(before, h.snapshot()) : undefined;
    if (grow !== undefined) h.apply([{ op: 'set', path: ['durationTicks'], value: grow }]);
    const committed = h.commit();
    if (!committed.ok) { h.cancel(); setEditMessages([failText(label, committed)]); return; }
    setEditMessages(noticeText(committed.notices));
    if (committed.changed) publish(committed.semanticChanged);
  }, [publish]);

  /** Opens the graph that holds the diagnostic's node, selects it and focuses the named parameter field. */
  const focusDiagnostic = useCallback((d: Diagnostic) => {
    if (!d.nodeId) return;
    const cur = historyRef.current!.snapshot(), g = cur.graphs.find(x => x.nodes.some(n => n.id === d.nodeId));
    if (!g) return;
    if (g.id !== canvasGraphId(cur)) onEdit(`Show ${d.nodeId}`, [{ op: 'set', path: ['editor', 'openedGraphId'], value: g.id }]);
    setSelectedNodeId(d.nodeId);
    const param = /\.params\.([A-Za-z0-9_]+)/.exec(d.fieldPath ?? '')?.[1];
    setTimeout(() => {
      const el = (param && document.getElementById(`ni-${d.nodeId}-${param}`)) || document.querySelector<HTMLElement>('.ni-row input, .ni-row select');
      el?.scrollIntoView({ block: 'center' });
      (el as HTMLElement | null)?.focus();
    }, 60);
  }, [onEdit]);

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
    lastGoodRef.current = false; // A different document never shows the previous one's preview as stale.
    setJsonErrors(valid.warnings);
    setEditMessages([]);
    setTextDirty(false);
    textDirtyRef.current = false;
    publish(true);
    return true;
  }, [publish]);
  /** 14-MIGRATION "Convert to editable graph": a new document from a v1 recipe plus a visible conversion report. */
  const convertLegacy = useCallback((recipe: Recipe) => {
    const { doc: converted, report } = convertLegacyRecipe(recipe);
    if (replace(toText(converted), `Import old effect "${recipe.name}"`)) {
      setMigrationReport(formatMigrationReport(report));
      setFileNote(`Imported an editable copy of "${recipe.name}" (the original is unchanged)`);
    }
  }, [replace]);
  replaceRef.current = replace;

  // Viewport lifetime; dispose is idempotent so StrictMode double-mount is safe.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    mountedRef.current = true;
    let vp: PreviewViewport | null = null;
    try {
      vp = new PreviewViewport(host, { onFrame: setFrame, onError: setRuntimeErrors, onLoop: () => onLoopRef.current(), onContextLost: setGpuLost });
      viewportRef.current = vp;
      // Dev-only diagnostics hook (resource plateau / context-loss checks); absent from production builds.
      if (import.meta.env.DEV) (window as unknown as { __vfxDebug?: unknown }).__vfxDebug = { viewport: vp, load: (text: string) => replaceRef.current?.(text, 'debug load'), openPack: (f: File) => openPack(f) };
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    }
    // Diagnostics are still produced without WebGL; the graph canvas stays usable.
    compile(historyRef.current!.snapshot());
    const initialTick = Number(new URLSearchParams(window.location.search).get('tick'));
    if (Number.isInteger(initialTick) && initialTick > 0) vp?.seek(initialTick);
    return () => {
      mountedRef.current = false;
      generationRef.current++; // Invalidates in-flight file reads.
      vp?.dispose();
      if (viewportRef.current === vp) viewportRef.current = null;
      const dbg = (window as unknown as { __vfxDebug?: { viewport?: unknown } }).__vfxDebug;
      if (import.meta.env.DEV && dbg?.viewport === vp) delete (window as unknown as { __vfxDebug?: unknown }).__vfxDebug; // Never leave a handle to a disposed viewport.
    };
  }, [compile]);

  // Audio device lifetime: nothing is created until Play sound; unmount releases the transport and context.
  useEffect(() => () => {
    soundTokenRef.current++;
    if (soundTimerRef.current !== null) { clearTimeout(soundTimerRef.current); soundTimerRef.current = null; }
    transportRef.current?.dispose();
    transportRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    ctx?.close().catch(() => { /* already closed */ });
  }, []);

  useEffect(() => { viewportRef.current?.setSoloMask(soloMask(doc, solo)); }, [doc, solo]);
  // 08: selecting a part dims everything it does not draw (preview overlay only).
  useEffect(() => {
    const m = selectedNodeId ? soloMask(doc, new Set([selectedNodeId])) : null;
    viewportRef.current?.setHighlight(m && m.size ? m : null);
  }, [doc, selectedNodeId]);
  // 08 arena markers at Source/Target (and other anchors), in world space through the root transform.
  useEffect(() => {
    const t = doc.rootTransform, [qx, qy, qz, qw] = t.rotation;
    const world = (p: readonly number[]): [number, number, number] => {
      const x = p[0] * t.scale, y = p[1] * t.scale, z = p[2] * t.scale;
      // v' = v + w·t + q × t with t = 2 (q × v)  (unit quaternion rotation)
      const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
      return [x + qw * tx + (qy * tz - qz * ty) + t.position[0], y + qw * ty + (qz * tx - qx * tz) + t.position[1], z + qw * tz + (qx * ty - qy * tx) + t.position[2]];
    };
    viewportRef.current?.setMarkers(doc.anchors.map(a => ({ position: world(a.position), kind: a.id === 'source' ? 'source' as const : a.id === 'target' ? 'target' as const : 'other' as const })));
  }, [doc.anchors, doc.rootTransform]);
  // 08 diagnostics readout, refreshed once a second.
  const [renderStats, setRenderStats] = useState<ReturnType<PreviewViewport['renderStats']> | null>(null);
  useEffect(() => { const id = setInterval(() => { const v = viewportRef.current; if (v) setRenderStats(v.renderStats()); }, 1000); return () => clearInterval(id); }, []);

  // Undo: Ctrl/Cmd+Z. Redo: Ctrl/Cmd+Shift+Z or Ctrl+Y. Ctrl/Cmd+S saves .json. Suppressed in text fields.
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
      } else if (k === 's') {
        e.preventDefault();
        downloadDocument();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, downloadDocument]);
  // 5 "Space play/pause when focus isn't in a text field" — separate listener so it never fights Ctrl/Cmd combos.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || isTextTarget(e.target)) return;
      const vp = viewportRef.current;
      if (!vp || !compiled) return;
      e.preventDefault();
      if (vp.isPlaying) { vp.pause(); stopSound(''); } else { vp.play(); if (syncSound && audioRef.current && speed === 1) void playSound(vp.currentTick); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compiled, syncSound, speed, playSound, stopSound]);

  const graphId = canvasGraphId(doc);
  const graph = doc.graphs.find(g => g.id === graphId);
  const selectedNode = selectedNodeId ? graph?.nodes.find(n => n.id === selectedNodeId) : undefined;
  const lanes = useMemo(() => timelineLanes(doc, timeline.windows), [doc, timeline]);

  // Imported texture bytes: register object URLs for document assets from the local asset store.
  const [missingAssets, setMissingAssets] = useState<string[]>([]);
  const [assetCheck, setAssetCheck] = useState(0);
  useEffect(() => {
    let live = true;
    const need = doc.assets.filter(a => (a.kind === 'texture' || a.kind === 'flipbook' || a.kind === 'mesh') && !hasAssetUrl(a.sha256));
    void Promise.all(need.map(async a => {
      const rec = await getAssetBytes(a.sha256);
      if (rec) registerAssetUrl(a.sha256, URL.createObjectURL(rec.blob));
      return rec ? null : a.id;
    })).then(r => { if (live) setMissingAssets(r.filter((x): x is string => x !== null)); });
    return () => { live = false; };
  }, [doc.assets, assetCheck]);

  // A selection whose node was deleted (edit, undo/redo or JSON replace) is cleared.
  useEffect(() => {
    if (selectedNodeId !== null && !selectedNode) setSelectedNodeId(null);
  }, [selectedNodeId, selectedNode]);
  // 4 "selecting a node in the graph switches to Selected node": only when a node just became selected.
  useEffect(() => {
    if (selectedNodeId !== null) { setRightTab('node'); setRightOpen(true); }
  }, [selectedNodeId]);
  // Effect name editing: local draft while the field has focus, committed on blur/Enter (never one undo step per keystroke).
  useEffect(() => { if (!nameEditing) setNameDraft(doc.name); }, [doc.name, nameEditing]);
  const commitName = useCallback(() => {
    setNameEditing(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== doc.name) onEdit('Rename effect', [{ op: 'set', path: ['name'], value: trimmed }]);
    else setNameDraft(doc.name);
  }, [nameDraft, doc.name, onEdit]);

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

  // ?doc=<url> loads a document JSON once (e.g. /work/mcp/<id>.json written by the MCP server).
  const docLoadedRef = useRef(false);
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('doc');
    if (!url || docLoadedRef.current) return;
    docLoadedRef.current = true;
    fetch(url, { cache: 'no-store' })
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(t => {
        // Bundle assets of a served document sit beside it (e.g. work/mcp/assets/ for MCP documents).
        try { const d = JSON.parse(t) as { assets?: { sha256: string; source: { kind: string; path?: string } }[] }; const base = new URL(url, location.href); for (const x of d.assets ?? []) if (x.source.kind === 'bundle' && x.source.path && !hasAssetUrl(x.sha256)) registerAssetUrl(x.sha256, new URL(x.source.path, base).href); } catch { /* replace() reports invalid JSON */ }
        // ?autoplay=1 (review links): start playing on loop as soon as the document is in.
        if (replace(t, `Load ${url}`) && new URLSearchParams(window.location.search).get('autoplay') === '1') setTimeout(() => { const v = viewportRef.current; if (!v) return; v.setLoop(true); setLooping(true); v.play(); }, 0);
      })
      .catch(e => { setJsonErrors([{ code: 'MISSING_REFERENCE', severity: 'error', message: `Could not load ${url}: ${e instanceof Error ? e.message : String(e)}` }]); });
  }, [replace]);
  const resetF01 = () => { replace(toText(createF01Document()), 'Reset to F01'); };
  const loadLightningDemo = () => { replace(toText(createLightningAudioDemoDocument()), 'Load lightning demo'); };
  const revertText = () => { setText(toText(doc)); setTextDirty(false); };

  const vp = viewportRef.current;
  const disabled = !compiled || !!fatal || runtimeErrors.length > 0;
  const errors = diagnostics.filter(d => d.severity === 'error');
  const warnings = diagnostics.filter(d => d.severity !== 'error');
  const diagCount = errors.length + warnings.length;
  const isEmptyEffect = (graph?.nodes.length ?? 0) === 0;

  const fileMenuItems: MenuItem[] = [
    { label: 'New', title: 'Start a new blank effect (clears undo history — Keep or Save first)', onClick: () => { setShelfPick(''); replace(toText(createBlankDocument()), 'New blank effect'); } },
    { label: 'Open…', title: 'Open a .vfx.json document or a .vfxpack', onClick: () => openInputRef.current?.click() },
    { separator: true, label: '' },
    { label: 'Save .json', title: 'Download this effect as a .vfx.json file (recipe only; imported asset bytes not included). Ctrl/Cmd+S.', onClick: downloadDocument },
    {
      label: 'Save as…', title: 'Save a copy under a new name and keep working on that copy', onClick: () => {
        // 12 workflow 1 "Save As": keep the effect under a new name; the open effect continues as that copy.
        const cur = historyRef.current!.snapshot(), name = window.prompt('Save this effect as (new name):', `${cur.name || 'effect'} copy`)?.trim();
        if (!name) return;
        onEdit(`Save as ${name}`, [{ op: 'set', path: ['name'], value: name }, { op: 'set', path: ['id'], value: `effect-${name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)}-${Date.now().toString(36)}`.replace(/-+/g, '-') }]);
        const r = saveToShelf(projectsRef.current, { ...historyRef.current!.snapshot(), name });
        if (r.ok) { setShelf(r.entries); setShelfPick(r.entries[0].name); setFileNote(`Saved as "${name}" in Projects; you are now editing "${name}".`); } else setFileNote(r.message);
      },
    },
    { label: 'Keep', title: 'Keep a copy of this effect in the local project shelf (same name replaces)', onClick: keepProject },
    { separator: true, label: '' },
    { label: `Projects (${shelf.length}), trash (${trash.length}), import old effect…`, title: 'Open a saved project, restore from trash, or import an effect made with the old editor', onClick: () => setShowProjects(true) },
  ];
  const exportMenuItems: MenuItem[] = [
    { label: 'Export pack', title: 'Download a portable .vfxpack: the effect plus its imported asset bytes and checksums', onClick: () => void downloadPack() },
    { label: 'Export media…', title: 'Render the effect to a sprite sheet, PNG sequence, GIF or video (MP4/WebM), frame by frame', onClick: () => setMediaOpen(o => !o) },
    { label: 'Export Roblox', title: "Download a Roblox model (.rbxmx: particle emitters, beams, lights and a player script) plus a report of what Roblox can't do", onClick: () => void downloadRoblox() },
    { separator: true, label: '' },
    // Slot for Unreal export: another agent is adding an `exportUnreal` helper + editor button in parallel.
    // Once src/export/unreal/package.ts exposes it, wire it up the same way as downloadRoblox above:
    //   import { exportUnreal } from './export/unreal/package.ts';
    //   { label: 'Export Unreal', title: '…', onClick: () => void exportUnreal(historyRef.current!.snapshot()) },
    { label: 'Export Unreal (coming soon)', note: true },
  ];

  return (
    <div className="pv2">
      <header className="pv2-topbar">
        <div className="pv2-topbar-brand">
          <strong className="pv2-appname">VFX Studio</strong>
          {nameEditing ? (
            <input
              className="pv2-name-input" aria-label="Effect name" value={nameDraft} autoFocus
              onChange={e => setNameDraft(e.currentTarget.value)}
              onBlur={commitName}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitName(); } else if (e.key === 'Escape') { setNameDraft(doc.name); setNameEditing(false); } }}
            />
          ) : (
            <button type="button" className="pv2-name-display" title="Click to rename the effect" onClick={() => { setNameDraft(doc.name); setNameEditing(true); }}>{doc.name || 'Untitled effect'}</button>
          )}
        </div>
        <nav className="pv2-topbar-menus" aria-label="Main menu">
          <MenuButton label="File" items={fileMenuItems} />
          <MenuButton label="Export" items={exportMenuItems} />
        </nav>
        <div className="pv2-topbar-panels" role="group" aria-label="Panels">
          <button type="button" className="pv2-icon-btn" aria-pressed={libraryOpen} onClick={() => setLibraryOpen(o => !o)} title="Show or hide the library: presets, components, assets and your saved blocks" aria-label="Toggle library panel"><IconPanelLeft /></button>
          <button type="button" className="pv2-icon-btn" aria-pressed={graphOpen} onClick={() => setGraphOpen(o => !o)} title="Show or hide the node graph editor" aria-label="Toggle graph panel"><IconPanelBottom /></button>
          <button type="button" className="pv2-icon-btn" aria-pressed={rightOpen} onClick={() => setRightOpen(o => !o)} title="Show or hide the inspector panel" aria-label="Toggle inspector panel"><IconPanelRight /></button>
        </div>
        <div className="pv2-topbar-history" role="group" aria-label="History">
          <button type="button" className="pv2-icon-btn" disabled={!historyFlags.canUndo} onClick={undo} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo"><IconUndo /></button>
          <button type="button" className="pv2-icon-btn" disabled={!historyFlags.canRedo} onClick={redo} title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo"><IconRedo /></button>
        </div>
        <div className="pv2-topbar-status" role="status" aria-live="polite">
          {narrow && <span className="pv2-note" role="note">Desktop authoring recommended: under 1024 px wide, panels stack.</span>}
          <span className="pv2-note">{saveStatus}</span>
        </div>
      </header>
      {(stale || fileNote || (recoveredFromRef.current && typeof localStorage !== 'undefined' && localStorage.getItem(CORRUPT_KEY)) || (jsonErrors.some(e => e.code === 'UNSUPPORTED_VERSION') && textDirty) || stagedPack || migrationReport || mediaOpen || showProjects) && (
        <div className="pv2-notices">
          {stale && (
            <span className="pv2-stale" role="alert">
              This effect was changed in another tab, so this tab stopped saving.
              <button type="button" onClick={() => { const t = loadDraftText(localStorage); baseRevisionRef.current = readDraftMeta(localStorage).revision; setStale(false); if (t) replace(t, 'Load the version from the other tab'); }}>Load the other tab's version</button>
              <button type="button" onClick={() => { const mine = historyRef.current!.snapshot(); const r = saveToShelf(projectsRef.current, { ...mine, name: `${mine.name || 'effect'} (copy)` }); if (r.ok) setShelf(r.entries); const t = loadDraftText(localStorage); baseRevisionRef.current = readDraftMeta(localStorage).revision; setStale(false); if (t) replace(t, 'Load the version from the other tab'); setFileNote(r.ok ? `Kept this tab's version as "${r.entries[0].name}" in Projects` : r.message); }}>Keep mine as a copy, then load theirs</button>
            </span>
          )}
          {fileNote && <span className="pv2-note" role="status" aria-live="polite">{fileNote}</span>}
          {recoveredFromRef.current && typeof localStorage !== 'undefined' && localStorage.getItem(CORRUPT_KEY) && (
            <button type="button" onClick={() => downloadText('unreadable-autosave.json', localStorage.getItem(CORRUPT_KEY) ?? '')} title="The unreadable autosave was kept aside; download it to inspect or recover it by hand">Download the unreadable autosave</button>
          )}
          {jsonErrors.some(e => e.code === 'UNSUPPORTED_VERSION') && textDirty && (
            <button type="button" onClick={() => downloadText('effect-unsupported-version.json', text)} title="This file is from a version this editor cannot open; it was not changed or converted. Download it as-is.">Download the file as-is</button>
          )}
          {mediaOpen && <ExportMediaDialog getDocument={() => historyRef.current!.snapshot()} getCameraPose={() => viewportRef.current?.cameraPose() ?? null} glow={glow} onNote={setFileNote} onClose={() => setMediaOpen(false)} />}
          {stagedPack && (
            <div className="pv2-banner" role="dialog" aria-label={`Open ${stagedPack.name}`}>
              <strong>Open pack {stagedPack.name}?</strong> Your current effect is autosaved first.
              <ul>{stagedPack.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
              <button type="button" onClick={() => void importStagedPack()}>Import</button>
              <button type="button" onClick={() => setStagedPack(null)}>Cancel</button>
            </div>
          )}
          {migrationReport && (
            <details className="pv2-report" open>
              <summary>Conversion report</summary>
              <pre>{migrationReport}</pre>
              <button type="button" onClick={() => setMigrationReport('')}>Close</button>
            </details>
          )}
          {showProjects && (
            <div className="pv2-banner" role="dialog" aria-label="Projects">
              <strong>Projects</strong>
              <div className="pv2-actions">
                <select aria-label="Projects" value={shelfPick} onChange={e => { const name = e.currentTarget.value; setShelfPick(name); const entry = shelf.find(s => s.name === name); if (entry) replace(entry.text, `Open project ${name}`); }}>
                  <option value="">Projects ({shelf.length})…</option>
                  {shelf.map(s => <option key={s.name} value={s.name}>{s.name} — {new Date(s.savedAt).toLocaleString()}</option>)}
                </select>
                <button type="button" disabled={!shelfPick} onClick={() => { setShelf(removeFromShelf(projectsRef.current, shelfPick)); setTrash(readTrash(projectsRef.current)); setFileNote(`Moved "${shelfPick}" to the trash`); setShelfPick(''); }} title="Move the chosen project to the trash (the open effect is untouched; restore it from Trash)">Remove</button>
              </div>
              {trash.length > 0 && (
                <div className="pv2-actions">
                  <select aria-label="Trash" value={trashPick} onChange={e => setTrashPick(e.currentTarget.value)}>
                    <option value="">Trash ({trash.length})…</option>
                    {trash.map(t => <option key={t.name} value={t.name}>{t.name} — removed {new Date(t.removedAt).toLocaleString()}</option>)}
                  </select>
                  <button type="button" disabled={!trashPick} onClick={() => { const r = restoreFromTrash(projectsRef.current, trashPick); if (r.ok) { setShelf(r.shelf); setTrash(r.trash); setFileNote(`Restored "${trashPick}" to projects`); setTrashPick(''); } else setFileNote(r.message); }} title="Put the chosen project back in Projects">Restore</button>
                  <button type="button" onClick={() => { if (window.confirm(`Permanently delete ${trash.length} project(s) in the trash?`)) { emptyTrash(projectsRef.current); setTrash([]); setTrashPick(''); setFileNote('Trash emptied'); } }} title="Permanently delete everything in the trash">Empty trash</button>
                </div>
              )}
              <div className="pv2-actions">
                <select aria-label="Import old effect" value={legacyPick} onChange={e => setLegacyPick(e.currentTarget.value)} title="Effects made with the old editor: your saved presets and the ten originals. Importing makes a new editable copy; the original is never changed.">
                  <option value="">Import old effect ({legacy.length})…</option>
                  {legacy.map((r, i) => <option key={i} value={String(i)}>{r.name}</option>)}
                </select>
                <button type="button" disabled={legacyPick === ''} onClick={() => { const r = legacy[Number(legacyPick)]; if (r) convertLegacy(r); setLegacyPick(''); }} title="Build an editable copy of the chosen old effect and show what was converted">Import</button>
              </div>
              <button type="button" onClick={() => setShowProjects(false)}>Close</button>
            </div>
          )}
        </div>
      )}
      <input ref={openInputRef} type="file" accept=".json,application/json,.vfxpack" hidden onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (!f) return; if (f.name.endsWith('.vfxpack')) void openPack(f); else void f.text().then(t => {
        // A v1 recipe or v1 bundle is never opened as v2: offer an explicit converted copy instead.
        let legacyRecipe: Recipe | null = null;
        try { const j = JSON.parse(t); if (j && (j.schemaVersion === 1 || j.format === 'vfx-studio-bundle')) legacyRecipe = parseRecipe(t); } catch { /* not v1 */ }
        if (legacyRecipe) { if (window.confirm(`"${f.name}" was made with the old editor. Import an editable copy? The file is not changed.`)) convertLegacy(legacyRecipe); return; }
        replace(t, `Open ${f.name}`);
      }); }} />
      <main className="pv2-main">
        <SplitPane
          storageKey="library-rest" direction="row" defaultSize={260} min={180} max={480}
          collapsed={libraryOpen ? false : 'first'} onToggleCollapse={() => setLibraryOpen(o => !o)} ariaLabel="Library panel"
          first={<LibraryPanel document={doc} graphId={graphId} onEdit={onEdit} onOpenNew={(t, label) => { setShelfPick(''); replace(t, label); }} onClose={() => setLibraryOpen(false)} />}
          second={
            <SplitPane
              storageKey="center-right" direction="row" defaultSize={380} min={280} max={640} sizedPane="second"
              collapsed={rightOpen ? false : 'second'} onToggleCollapse={() => setRightOpen(o => !o)} ariaLabel="Inspector panel"
              first={
                <section className="pv2-center">
                  <SplitPane
                    storageKey="viewport-graph" direction="column" defaultSize={420} min={200}
                    collapsed={graphOpen ? false : 'second'} onToggleCollapse={() => setGraphOpen(o => !o)} ariaLabel="Graph editor"
                    first={
                      <div className="pv2-viewport-pane">
                        <div className="pv2-host" ref={hostRef} />
                        <div className="pv2-view-overlay">
                          <OverlayMenu label={<><IconEye /> View <IconChevronDown /></>} title="Viewport view options" align="right">
                            <label className="pv2-check"><input type="checkbox" checked={glow} onChange={e => { const g = e.currentTarget.checked; setGlow(g); vp?.setGlow(g); }} /> Glow</label>
                            <label className="pv2-check"><input type="checkbox" checked={grid} onChange={e => { const g = e.currentTarget.checked; setGrid(g); vp?.setGrid(g); }} /> Grid &amp; markers</label>
                            <label className="pv2-check"><input type="checkbox" checked={lightBg} onChange={e => { const l = e.currentTarget.checked; setLightBg(l); vp?.setBackground(l ? 'light' : 'dark'); }} /> Light arena</label>
                            <label className="pv2-check"><input type="checkbox" checked={reducedEffects} onChange={e => { const r = e.currentTarget.checked; setReducedEffects(r); vp?.setReducedEffects(r); }} /> Reduced effects</label>
                            <label className="pv2-check"><input type="checkbox" checked={newSeed} onChange={e => { setNewSeed(e.currentTarget.checked); if (!e.currentTarget.checked && seedOffsetRef.current) { seedOffsetRef.current = 0; compile(historyRef.current!.snapshot()); } }} /> New seed each loop</label>
                            <label className="pv2-menu-field">Quality
                              <select aria-label="Preview quality" defaultValue="balanced" title="Preview quality: Reference (sharpest), Balanced (default), Economy (fast, no glow). Only the preview changes, never the effect." onChange={e => vp?.setQualityProfile(e.currentTarget.value as 'reference' | 'balanced' | 'economy')}>
                                <option value="reference">Reference</option><option value="balanced">Balanced</option><option value="economy">Economy</option>
                              </select>
                            </label>
                            <button type="button" onClick={() => vp?.resetView()} title="Fit the whole effect in view again (after orbiting or zooming)">Reset camera</button>
                          </OverlayMenu>
                        </div>
                        {isEmptyEffect && compiled && <div className="pv2-empty-state">Empty effect. Open the Library and add a component to get started.</div>}
                        {fatal && <div className="pv2-overlay pv2-error" role="alert">{fatal}</div>}
                        {gpuLost && <div className="pv2-overlay pv2-error" role="alert">The 3D view lost the graphics device (a driver reset or too many open tabs). It comes back by itself; your effect and edits are safe.</div>}
                        {!fatal && !compiled && <div className="pv2-overlay">{lastGoodRef.current ? 'Preview paused: the graph needs attention (see diagnostics). Showing the last working version — stale.' : 'No preview: the document does not compile (see diagnostics).'}</div>}
                        {runtimeErrors.length > 0 && (
                          <div className="pv2-overlay pv2-error" role="alert">
                            Simulation stopped: {runtimeErrors.map(describe).join(' | ')}
                            {/* 12 "failure pauses and offers Retry preview" (the simulation runs on the main thread; this replays from tick 0). */}
                            <button type="button" onClick={() => { setRuntimeErrors([]); vp?.restart(); }} title="Run the preview again from the start (after a fix, or if the stop was a one-off)">Retry preview</button>
                          </div>
                        )}
                        <div className="pv2-transport">
                          <button type="button" className="pv2-icon-btn" disabled={disabled} aria-label={frame.playing ? 'Pause' : frame.suspended ? 'Resume' : 'Play'} title={`${frame.playing ? 'Pause' : 'Play'} (Space)`} onClick={() => { if (frame.playing) { vp?.pause(); stopSound(''); } else { vp?.play(); if (syncSound && audio && speed === 1) void playSound(frame.tick); } }}>
                            {frame.playing ? <IconPause /> : <IconPlay />}
                          </button>
                          <button type="button" className="pv2-icon-btn" disabled={disabled} aria-label="Restart" title="Restart from tick 0" onClick={() => { vp?.restart(); if (syncSound && audio && speed === 1) void playSound(0); else stopSound(''); }}><IconRestart /></button>
                          <button type="button" className="pv2-icon-btn" disabled={disabled} title="One tick back" aria-label="Step back one tick" onClick={() => { vp?.seek(Math.max(0, frame.tick - 1)); stopSound(''); }}><IconStepBack /></button>
                          <button type="button" className="pv2-icon-btn" disabled={disabled} title="One tick forward" aria-label="Step forward one tick" onClick={() => { vp?.seek(Math.min(frame.durationTicks, frame.tick + 1)); stopSound(''); }}><IconStepForward /></button>
                          <div className="pv2-scrub">
                            <input
                              type="range" min={0} max={frame.durationTicks} step={1} value={frame.tick} disabled={disabled}
                              aria-label="Tick" onChange={e => { vp?.seek(Number(e.target.value)); stopSound(''); }}
                            />
                            {/* Event markers and the selected part's active window (12); decorative, the list is in the title. */}
                            <div className="pv2-marks" aria-hidden="true" title={timeline.markers.map(m => `${m.kind} ${m.nodeId} @ ${m.tick}`).join('\n')}>
                              {(() => { const w = selectedNodeId ? timeline.windows.get(selectedNodeId) ?? scheduleWindow(selectedNode) : undefined; return w && frame.durationTicks > 0 ? <span className="pv2-window" style={{ left: `${(100 * w[0]) / frame.durationTicks}%`, width: `${(100 * Math.max(1, w[1] - w[0])) / frame.durationTicks}%` }} /> : null; })()}
                              {frame.durationTicks > 0 && timeline.markers.map((m, i) => <span key={i} className={`pv2-mark pv2-mark-${m.kind}`} style={{ left: `${(100 * m.tick) / frame.durationTicks}%` }} />)}
                            </div>
                          </div>
                          {/* Not a live region: per-frame tick changes must not be announced. Errors use role="alert". */}
                          <span className="pv2-readout" title={frame.sampleParticleId ? `Sample particle ${frame.sampleParticleId}` : undefined}>
                            {frame.suspended && <>Paused (tab hidden) · </>}
                            {frame.catchingUp && <span title="The preview is running slower than real time on this device; every simulation step is still computed">Catching up · </span>}
                            tick {frame.tick}/{frame.durationTicks} · {frame.live} {frame.mode === 'paths' ? 'paths' : frame.mode === 'mixed' ? 'particles + paths' : 'live'}
                          </span>
                          <select aria-label="Playback speed" value={speed} title="Preview playback speed (sound plays only at 1x)" onChange={e => { const v = Number(e.currentTarget.value); setSpeed(v); vp?.setSpeed(v); if (v !== 1) stopSound(''); }}>
                            <option value={0.25}>0.25x</option><option value={0.5}>0.5x</option><option value={1}>1x</option>
                          </select>
                          <button type="button" className="pv2-icon-btn" aria-pressed={looping} disabled={disabled} title="Replay from tick 0 when the effect ends" onClick={() => { const l = !looping; setLooping(l); vp?.setLoop(l); }}>↻</button>
                          <button type="button" className="pv2-icon-btn" aria-pressed={syncSound} disabled={!audio} title="Play the effect's sound in sync with Play/Restart" onClick={() => { const s = !syncSound; setSyncSound(s); if (!s) stopSound(''); }}>{syncSound ? '🔊' : '🔇'}</button>
                        </div>
                        <TimelineStrip document={doc} lanes={lanes} tick={frame.tick} durationTicks={frame.durationTicks} selectedNodeId={selectedNodeId}
                          onEdit={onEdit} onSeek={t => { vp?.seek(Math.max(0, Math.min(frame.durationTicks, t))); stopSound(''); }}
                          onSelect={nodeId => { const cur = historyRef.current!.snapshot(); if (canvasGraphId(cur) !== cur.rootGraphId) onEdit('Show the effect', [{ op: 'set', path: ['editor', 'openedGraphId'], value: cur.rootGraphId }]); setSelectedNodeId(nodeId); }} />
                        {frame.sampleParticleId && (
                          <details className="pv2-tech">
                            <summary>Technical details</summary>
                            Sample particle ID: <code>{frame.sampleParticleId}</code>
                            {renderStats && <div className="pv2-muted">Last frame: {renderStats.calls} draw calls, {renderStats.triangles} triangles · {renderStats.width}×{renderStats.height} px (pixel ratio {renderStats.pixelRatio}) · {renderStats.geometries} geometries, {renderStats.materials} materials, {renderStats.textures} textures{renderStats.contextLost ? ' · GPU context lost' : ''}</div>}
                          </details>
                        )}
                      </div>
                    }
                    second={
                      <div className="pv2-graph" aria-label="Graph editor">
                        <GraphCanvas
                          document={doc}
                          graphId={graphId}
                          selectedNodeId={selectedNode ? selectedNode.id : undefined}
                          onSelectNode={setSelectedNodeId}
                          onEdit={onEdit}
                          soloed={solo}
                          onToggleSolo={toggleSolo}
                        />
                      </div>
                    }
                  />
                </section>
              }
              second={
                <aside className="pv2-side">
                  <div className="pv2-tabs" role="tablist" aria-label="Inspector">
                    <button type="button" role="tab" aria-selected={rightTab === 'controls'} className="pv2-tab" onClick={() => setRightTab('controls')}>Controls</button>
                    <button type="button" role="tab" aria-selected={rightTab === 'node'} className="pv2-tab" onClick={() => setRightTab('node')}>Selected node</button>
                    <button type="button" role="tab" aria-selected={rightTab === 'outline'} className="pv2-tab" onClick={() => setRightTab('outline')}>Outline</button>
                    <button type="button" role="tab" aria-selected={rightTab === 'assets'} className="pv2-tab" onClick={() => setRightTab('assets')}>Assets</button>
                    <button type="button" role="tab" aria-selected={rightTab === 'sound'} className="pv2-tab" onClick={() => setRightTab('sound')}>Sound</button>
                    <button type="button" role="tab" aria-selected={rightTab === 'diagnostics'} className="pv2-tab" onClick={() => setRightTab('diagnostics')}>
                      Diagnostics{diagCount > 0 && <span className="pv2-badge">{diagCount}</span>}
                    </button>
                  </div>
                  <div className="pv2-tabpanel">
                    {rightTab === 'controls' && (
                      <section aria-label="Controls">
                        <ControlsPanel document={doc} onEdit={onEdit} followers={followers} tick={frame.tick} />
                      </section>
                    )}
                    {rightTab === 'node' && (
                      <section aria-label="Selected node">
                        {selectedNode ? (
                          <NodeInspector document={doc} graphId={graphId} nodeId={selectedNode.id} onEdit={onEdit} onSelectNode={setSelectedNodeId} />
                        ) : (
                          <p className="pv2-muted">No node selected. Select a node in the graph.</p>
                        )}
                      </section>
                    )}
                    {rightTab === 'outline' && (
                      <section aria-label="Outline">
                        <OutlinePanel document={doc} graphId={graphId} selectedNodeId={selectedNode ? selectedNode.id : undefined} onSelectNode={setSelectedNodeId} onEdit={onEdit}
                          soloed={solo} onToggleSolo={toggleSolo} onClearSolo={() => setSolo(new Set())} />
                      </section>
                    )}
                    {rightTab === 'assets' && (
                      <section aria-label="Imported assets">
                        <TexturePanel document={doc} graphId={graphId} selectedNodeId={selectedNode?.id} onEdit={onEdit} missingIds={missingAssets} onBytesRestored={() => setAssetCheck(n => n + 1)} />
                        <button type="button" onClick={() => void cleanupAssets()} title="Remove imported image/model files that no effect, project, autosave revision, saved component or undo step uses (asks first, reports the space freed)">Clean up unused files</button>
                        {missingAssets.length > 0 && <p className="pv2-warn" role="alert">Missing imported files on this device: {missingAssets.map(id => doc.assets.find(a => a.id === id)?.provenance.originalFilename ?? id).join(', ')}. Use Relink… next to each one under Imported assets.</p>}
                      </section>
                    )}
                    {rightTab === 'sound' && (
                      <section className="pv2-sound" aria-label="Sound audition">
                        <p className="pv2-muted">Sound is parked (visuals first). This plays the document's rendered audio mix on its own, from the start.</p>
                        <div className="pv2-actions">
                          <button type="button" disabled={!audio} onClick={() => { void playSound(0); }}>Play sound</button>
                          <button type="button" disabled={!audio} onClick={() => stopSound('Sound stopped.')}>Stop sound</button>
                          <button type="button" disabled={!audio} onClick={downloadWav}>Download WAV</button>
                        </div>
                        {audio ? (
                          <p className="pv2-muted">
                            Mix: {(audio.mix.left.length / audio.mix.sampleRate).toFixed(2)} s stereo, {audio.mix.sampleRate} Hz
                            {audio.mix.severeLimiting && <span className="pv2-warn"> · severe limiting (peak {audio.mix.prePeak.toFixed(2)})</span>}
                          </p>
                        ) : (
                          <p className="pv2-muted">No valid sound: the document has no root audio, or its audio does not compile (see diagnostics).</p>
                        )}
                        <p className="pv2-muted" role="status" aria-live="polite">{soundStatus}</p>
                      </section>
                    )}
                    {rightTab === 'diagnostics' && (
                      <section aria-label="Diagnostics">
                        {editMessages.length > 0 && (
                          <ul className="pv2-diags" role="alert">
                            {editMessages.map((m, i) => <li key={i} className="pv2-warn">{m}</li>)}
                          </ul>
                        )}
                        <ul className="pv2-diags" role="status" aria-live="polite" aria-label="Diagnostics">
                          {errors.map((d, i) => <li key={`e${i}`} className="pv2-error"><DiagText d={d} onFocus={focusDiagnostic} /></li>)}
                          {warnings.map((d, i) => <li key={`w${i}`} className="pv2-warn"><DiagText d={d} onFocus={focusDiagnostic} /></li>)}
                          {compiled && errors.length === 0 && <li className="pv2-ok">Compiled; loads paused at tick 0.</li>}
                        </ul>
                        <details className="pv2-advanced">
                          <summary>Advanced: document JSON</summary>
                          <div className="pv2-actions">
                            <button type="button" onClick={() => { replace(text, 'Apply JSON'); }}>Apply JSON</button>
                            <button type="button" onClick={() => fileRef.current?.click()}>Load file…</button>
                            <input ref={fileRef} className="pv2-file-input" type="file" accept=".json,application/json" tabIndex={-1} aria-hidden="true" onChange={onFile} />
                            <button type="button" onClick={resetF01}>Load test graph (F01)</button>
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
                            {jsonErrors.map((d, i) => <li key={i} className={d.severity === 'error' ? 'pv2-error' : 'pv2-warn'}><DiagText d={d} onFocus={focusDiagnostic} /></li>)}
                          </ul>
                        </details>
                      </section>
                    )}
                  </div>
                </aside>
              }
            />
          }
        />
      </main>
    </div>
  );
}
