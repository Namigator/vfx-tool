// Metadata-driven parameter inspector (12-EDITOR "Inspector"). Controlled: reads the authored document and
// emits one labelled patch batch per committed edit through onEdit (DocumentHistory). Text drafts stay local
// until Enter/blur, so typing never recompiles the graph. Precedence mirrors model/controls.ts:
// connection > control binding > stored literal > registry default. Driven fields are read-only and are never
// written; resetting deletes the stored override so the registry default applies again.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { EffectDocumentV2, NodeDefinition, NodeSpec, ParameterSpec, ParameterValue, Unit, ColorValue, CurveValue, GradientValue } from '../model/types.ts';
import { MAX_LABEL_CODE_POINTS } from '../model/types.ts';
import { validateParameterValue } from '../model/values.ts';
import { registryKey } from '../model/controls.ts';
import { createRegistry } from '../graph/registry.ts';
import type { Patch } from './history.ts';
import { inspectorValues, type InspectorValue } from './inspector-values.ts';
import { CurveEditor, GradientEditor } from './CurveEditor.tsx';
import './node-inspector.css';

export type NodeInspectorProps = {
  document: EffectDocumentV2;
  graphId: string;
  nodeId: string;
  onEdit: (label: string, patches: Patch[]) => void;
  /** Active public-control overrides (e.g. Group exposed values) used when resolving driven fields. */
  controlOverrides?: ReadonlyMap<string, ParameterValue>;
};

const REGISTRY: ReadonlyMap<string, NodeSpec> = createRegistry();

const UNIT_TEXT: Record<Unit, string> = {
  none: '', meter: 'm', second: 's', tick: 'ticks', radian: 'rad', metersPerSecond: 'm/s',
  metersPerSecondSquared: 'm/s²', hertz: 'Hz', perSecond: '/s', linearGain: '× gain', normalized: '0–1',
};

/** Structural identifiers (see graph/signature.ts); shown read-only here, edited by dedicated tools. */
const STRUCTURAL: Record<string, string> = { Group: 'graphId', GroupInput: 'portId', GroupOutput: 'portId' };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(6))));
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function rangeText(spec: ParameterSpec): string {
  const parts: string[] = [];
  if (spec.min !== undefined && spec.max !== undefined) parts.push(`${fmt(spec.min)} to ${fmt(spec.max)}`);
  else if (spec.min !== undefined) parts.push(`≥ ${fmt(spec.min)}`);
  else if (spec.max !== undefined) parts.push(`≤ ${fmt(spec.max)}`);
  const u = UNIT_TEXT[spec.unit];
  if (u) parts.push(u);
  return parts.join(' ');
}

export default function NodeInspector({ document: doc, graphId, nodeId, onEdit, controlOverrides }: NodeInspectorProps) {
  const gi = doc.graphs.findIndex(g => g.id === graphId);
  const graph = doc.graphs[gi];
  const ni = graph ? graph.nodes.findIndex(n => n.id === nodeId) : -1;
  if (!graph || ni < 0) return <p className="ni-muted">Node "{nodeId}" is not in graph "{graphId}".</p>;
  const node = graph.nodes[ni];
  const base: (string | number)[] = ['graphs', gi, 'nodes', ni];
  const spec = REGISTRY.get(registryKey(node.type, node.definitionVersion));
  const protectedNode = spec?.disabledBehavior === 'protected';

  // Effective values: connection (runtime-unknown) > resolved control > stored literal > default.
  const effective = inspectorValues(doc, REGISTRY, graphId, nodeId, controlOverrides);

  const title = node.label || node.type;
  return (
    <div className="ni" aria-label={`Inspector for ${title}`}>
      <LabelField key={node.id} node={node} onCommit={label => onEdit('Rename node', [{ op: 'set', path: [...base, 'label'], value: label }])} />
      <label className="ni-check">
        <input
          type="checkbox" checked={node.enabled} disabled={protectedNode && node.enabled}
          onChange={e => onEdit(e.target.checked ? `Enable ${title}` : `Disable ${title}`, [{ op: 'set', path: [...base, 'enabled'], value: e.target.checked }])}
        />
        Enabled
      </label>
      {protectedNode && <p className="ni-muted">{node.type} nodes are protected and cannot be disabled.</p>}
      <p className="ni-muted"><code>{node.type}@{node.definitionVersion}</code> · <code>{node.id}</code></p>
      {!spec ? (
        <p className="ni-unsupported" role="note">Unknown node type; parameters cannot be edited.</p>
      ) : node.type === 'Group' ? (
        <p className="ni-unsupported" role="note">Group exposed controls are edited from public controls, not supported in this inspector yet.</p>
      ) : spec.parameters.length === 0 ? (
        <p className="ni-muted">This node has no parameters.</p>
      ) : (
        <div className="ni-params">
          {spec.parameters.map(p => {
            const stored = hasOwn(node.params, p.id);
            const eff: InspectorValue = effective.get(p.id)
              ?? (stored ? { kind: 'literal', value: node.params[p.id] } : { kind: 'default', value: p.default });
            const path = [...base, 'params', p.id];
            return (
              <ParamRow
                key={`${node.id}:${p.id}`}
                doc={doc} node={node} spec={p} eff={eff} stored={stored}
                structural={STRUCTURAL[node.type] === p.id}
                onSet={v => onEdit(`Set ${title} ${p.label}`, [{ op: 'set', path, value: v }])}
                onReset={() => onEdit(`Reset ${title} ${p.label}`, [{ op: 'delete', path }])}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function LabelField({ node, onCommit }: { node: NodeDefinition; onCommit: (label: string) => void }) {
  const [draft, setDraft] = useState(node.label);
  useEffect(() => setDraft(node.label), [node.id, node.label]);
  const tooLong = [...draft].length > MAX_LABEL_CODE_POINTS;
  const commit = () => { if (!tooLong && draft !== node.label) onCommit(draft); };
  return (
    <label className="ni-field">
      <span className="ni-name">Label</span>
      <input
        className="ni-input" value={draft} aria-invalid={tooLong}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setDraft(node.label); }}
      />
      {tooLong && <span className="ni-error" role="alert">Label is limited to {MAX_LABEL_CODE_POINTS} characters.</span>}
    </label>
  );
}

type RowProps = {
  doc: EffectDocumentV2; node: NodeDefinition; spec: ParameterSpec; eff: InspectorValue; stored: boolean;
  structural: boolean;
  onSet: (v: ParameterValue) => void; onReset: () => void;
};

function ParamRow({ doc, node, spec, eff, stored, structural, onSet, onReset }: RowProps) {
  // Errors are kept per input slot ('' scalar, 0/1/2 vector components, 'alpha') so an unchanged sibling
  // component cannot clear another component's invalid draft.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const slotError = (slot: string | number) => (m: string) =>
    setErrors(prev => (prev[slot] ?? '') === m ? prev : { ...prev, [slot]: m });
  const error = [...new Set(Object.values(errors).filter(Boolean))].join(' ');
  const id = `ni-${node.id}-${spec.id}`;
  const helpId = `${id}-help`;
  const driven = eff.kind === 'connection' || eff.kind === 'control' || eff.kind === 'unavailable';
  const readOnly = driven || structural;
  const value = 'value' in eff ? eff.value : undefined;
  const isDefault = same(value, spec.default);

  /** Validates against metadata and commits only real changes; invalid drafts stay visible with the reason. */
  const commit = (v: ParameterValue, slot: string | number = ''): boolean => {
    const diags = validateParameterValue(v, spec, spec.id, new Map(), { durationTicks: doc.durationTicks });
    if (diags.length) { slotError(slot)(diags[0].message); return false; }
    slotError(slot)('');
    if (!same(v, value)) onSet(v);
    return true;
  };

  const range = rangeText(spec);
  const help = [spec.description, range && `Range: ${range}.`].filter(Boolean).join(' ');
  const common = { id, disabled: readOnly, 'aria-describedby': helpId, 'aria-invalid': !!error };

  let control: ReactElement;
  if (value === undefined) {
    control = (
      <span className="ni-unsupported" id={id} aria-describedby={helpId}>
        {eff.kind === 'connection' ? 'Runtime value (not known in the editor)' : 'Value unavailable'}
      </span>
    );
  } else switch (spec.type) {
    case 'number':
    case 'integer':
      control = <NumberDraft {...common} value={value as number} spec={spec} onCommit={n => commit(n)} onError={slotError('')} />;
      break;
    case 'boolean':
      control = <input type="checkbox" className="ni-box" {...common} checked={value as boolean} onChange={e => commit(e.target.checked)} />;
      break;
    case 'enum':
      control = (
        <select className="ni-input" {...common} value={value as string} onChange={e => commit(e.target.value)}>
          {(spec.choices ?? []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      );
      break;
    case 'color':
      control = <ColorDraft {...common} value={value as ColorValue} onCommit={c => commit(c, 'alpha')} onError={slotError('alpha')} />;
      break;
    case 'vec2':
    case 'vec3':
      control = (
        <div className="ni-vec" role="group" aria-labelledby={`${id}-name`} aria-describedby={helpId}>
          {(value as number[]).map((c, i) => (
            <NumberDraft
              key={i} id={i === 0 ? id : `${id}-${i}`} disabled={readOnly} aria-invalid={!!errors[i]}
              aria-label={`${spec.label} ${'XYZ'[i]}`} value={c} spec={{ ...spec, type: 'number' }}
              onCommit={n => { const next = [...(value as number[])]; next[i] = n; return commit(next as ParameterValue, i); }}
              onError={slotError(i)}
            />
          ))}
        </div>
      );
      break;
    case 'string':
      control = node.type === 'Anchor' && spec.id === 'anchorId'
        ? <AnchorSelect {...common} doc={doc} value={value as string} onCommit={v => commit(v)} />
        : <TextDraft {...common} value={value as string} onCommit={v => commit(v)} />;
      break;
    case 'asset':
      control = doc.assets.length ? (
        <select className="ni-input" {...common} value={value as string} onChange={e => commit(e.target.value)}>
          {!doc.assets.some(a => a.id === value) && <option value={value as string}>{String(value)} (missing)</option>}
          {doc.assets.map(a => <option key={a.id} value={a.id}>{a.provenance.originalFilename || a.id} ({a.kind})</option>)}
        </select>
      ) : <span className="ni-unsupported">No assets in this document.</span>;
      break;
    case 'curve':
      control = <CurveEditor id={id} label={spec.label} value={value as CurveValue} disabled={readOnly} durationSeconds={doc.durationTicks / 60}
        yMin={spec.min} yMax={spec.max} onCommit={v => commit(v)} />;
      break;
    case 'gradient':
      control = <GradientEditor id={id} label={spec.label} value={value as GradientValue} disabled={readOnly} onCommit={v => commit(v)} />;
      break;
    default:
      control = <span className="ni-unsupported" role="note">Editing {spec.type} values is not supported yet.</span>;
  }

  return (
    <div className="ni-row">
      <div className="ni-head">
        <label htmlFor={id} id={`${id}-name`} className="ni-name">{spec.label}</label>
        {range && <span className="ni-unit">{range}</span>}
        {!readOnly && stored && (
          <button type="button" className="ni-reset" onClick={onReset}
            title={isDefault ? 'Stored value equals the default; remove the override' : 'Reset to default'}
            aria-label={`Reset ${spec.label} to default`}>Reset</button>
        )}
      </div>
      {control}
      <p id={helpId} className="ni-help">
        {eff.kind === 'connection' && <strong className="ni-driven">Driven by connection from {eff.from}; value is computed at runtime. </strong>}
        {eff.kind === 'control' && <strong className="ni-driven">Driven by public control “{eff.controlLabel}”; showing its resolved value. </strong>}
        {eff.kind === 'unavailable' && <strong className="ni-driven">Driven by public control “{eff.controlLabel}”; value unavailable: {eff.reason} </strong>}
        {structural && <strong className="ni-driven">Structural reference; not editable here. </strong>}
        {eff.kind === 'default' ? 'Default value. ' : ''}
        {help}
      </p>
      {error && <p className="ni-error" role="alert">{error}</p>}
    </div>
  );
}

type DraftBase = {
  id: string; disabled: boolean; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-label'?: string;
};

/** Enter/blur commits, Escape reverts. Returns focus-safe behavior: failed commits keep the draft. */
function useDraft(initial: string) {
  const [draft, setDraft] = useState(initial);
  const skipBlur = useRef(false);
  useEffect(() => setDraft(initial), [initial]);
  return { draft, setDraft, skipBlur };
}

function NumberDraft({ value, spec, onCommit, onError, ...rest }: DraftBase & {
  value: number; spec: ParameterSpec; onCommit: (n: number) => boolean | void; onError: (m: string) => void;
}) {
  const initial = fmt(value);
  const { draft, setDraft, skipBlur } = useDraft(initial);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // An externally changed value (commit, undo) replaces this slot's draft, so its stale error goes too.
  useEffect(() => onErrorRef.current(''), [initial]);
  const commit = () => {
    if (draft === initial) { onError(''); return; }
    const t = draft.trim();
    const n = t === '' ? NaN : Number(t);
    if (!Number.isFinite(n)) { onError(`"${draft}" is not a number.`); return; }
    onCommit(n);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') { skipBlur.current = true; setDraft(initial); onError(''); e.currentTarget.blur(); }
  };
  return (
    <input
      {...rest} className="ni-input ni-num" type="text" inputMode={spec.type === 'integer' ? 'numeric' : 'decimal'}
      value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
      onBlur={() => { if (skipBlur.current) skipBlur.current = false; else commit(); }}
    />
  );
}

function TextDraft({ value, onCommit, ...rest }: DraftBase & { value: string; onCommit: (v: string) => void }) {
  const { draft, setDraft, skipBlur } = useDraft(value);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <input
      {...rest} className="ni-input" type="text" value={draft} onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { skipBlur.current = true; setDraft(value); e.currentTarget.blur(); }
      }}
      onBlur={() => { if (skipBlur.current) skipBlur.current = false; else commit(); }}
    />
  );
}

function AnchorSelect({ doc, value, onCommit, ...rest }: DraftBase & { doc: EffectDocumentV2; value: string; onCommit: (v: string) => void }) {
  const ids = ['source', 'target', ...doc.anchors.map(a => a.id).filter(a => a !== 'source' && a !== 'target')];
  return (
    <select {...rest} className="ni-input" value={value} onChange={e => onCommit(e.target.value)}>
      {!ids.includes(value) && <option value={value}>{value} (missing)</option>}
      {ids.map(a => {
        const def = doc.anchors.find(d => d.id === a);
        return <option key={a} value={a}>{def?.name ? `${def.name} (${a})` : a}</option>;
      })}
    </select>
  );
}

/** Color swatch commits on the native change event (picker closed), not on every input event. */
function ColorDraft({ value, onCommit, onError, ...rest }: DraftBase & {
  value: ColorValue; onCommit: (c: ColorValue) => boolean | void; onError: (m: string) => void;
}) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [hex, setHex] = useState(value.srgb.toLowerCase());
  const valueRef = useRef(value);
  valueRef.current = value;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => setHex(value.srgb.toLowerCase()), [value.srgb]);
  useEffect(() => {
    const el = pickerRef.current;
    if (!el) return;
    const onChange = () => {
      const cur = valueRef.current;
      if (el.value.toLowerCase() !== cur.srgb.toLowerCase()) commitRef.current({ srgb: el.value.toUpperCase(), alpha: cur.alpha });
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return (
    <div className="ni-color">
      <input {...rest} ref={pickerRef} type="color" className="ni-swatch" value={hex} onChange={e => setHex(e.target.value)} />
      <code className="ni-hex">{hex.toUpperCase()}</code>
      <span className="ni-alpha-label" aria-hidden="true">Alpha</span>
      <NumberDraft
        id={`${rest.id}-alpha`} disabled={rest.disabled} aria-label="Alpha (0 to 1)" aria-invalid={rest['aria-invalid']}
        value={value.alpha}
        spec={{ id: 'alpha', label: 'Alpha', type: 'number', unit: 'normalized', default: 1, min: 0, max: 1, domains: ['constant'], editPolicy: 'live', description: '' }}
        onCommit={a => onCommit({ srgb: value.srgb, alpha: a })} onError={onError}
      />
    </div>
  );
}
