// Whole-document structural validation and recovery (04 "Validation and compatibility", 13 "Import
// validation", 15 limits, 25, WP01-REPRESENTATION-DECISIONS.md, WP01B-WORKER-CONTRACT.md).
// Pure: no compiler, renderer, filesystem or network work. The input is never mutated, defaults are
// never materialized and unknown records are reported, never dropped. Edge DAG ordering, type/domain
// matching, reachability and expanded budgets remain WP02.
import {
  DOCUMENT_FORMAT, ID_PATTERN, MAX_ANCHORS, MAX_ASSET_REFERENCES, MAX_CONTROL_BINDINGS, MAX_CONTROLS,
  MAX_DESCRIPTION_CODE_POINTS, MAX_DURATION_TICKS, MAX_GRAPHS, MAX_GROUP_DEPTH,
  MAX_INTERFACE_PORTS_PER_DIRECTION, MAX_JSON_BYTES, MAX_JSON_DEPTH, MAX_LABEL_CODE_POINTS,
  MAX_PATH_CODE_POINTS, MAX_STORED_EDGES, MAX_STORED_NODES, MAX_TAG_CODE_POINTS, MAX_TAGS,
  AUDIO_MIX_INPUT_PORT, AUDIO_MIX_NODE_TYPE, MAX_EDGE_MIX_GAIN, MAX_EDGE_MIX_PAN, MIN_EDGE_MIX_GAIN, MIN_EDGE_MIX_PAN,
  MIN_DURATION_TICKS, RUNTIME_VERSION, SCHEMA_VERSION,
  type Diagnostic, type EffectDocumentV2, type ErrorCode, type NodeSpec, type ParameterSpec,
  type ValidationResult,
} from './types.ts';
import { validateParameterValue, type RecordRegistry, type ValueContext } from './values.ts';
import { CanonicalError, canonicalJson, pathKey } from './canonical.ts';

export type DocumentValidationOptions = {
  /** Keyed by `${type}@${definitionVersion}`. Application-owned, trusted metadata. */
  registry: ReadonlyMap<string, NodeSpec>;
  records?: RecordRegistry;
  /** Optional byte-availability input; without it only reference integrity is checked. */
  availableAssetIds?: ReadonlySet<string>;
};

export const GROUP_NODE_TYPE = 'Group';
export const GROUP_INPUT_NODE_TYPE = 'GroupInput';
export const GROUP_OUTPUT_NODE_TYPE = 'GroupOutput';
export const EFFECT_OUTPUT_NODE_TYPE = 'EffectOutput';
/** Structural Group parameter; reserved and never usable as a child-control ID. */
export const GROUP_GRAPH_PARAM = 'graphId';
export const BRIDGE_PORT_PARAM = 'portId';
export const SOURCE_ANCHOR_ID = 'source';
export const TARGET_ANCHOR_ID = 'target';
export const MIN_LAYOUT_ZOOM = 0.1;
export const MAX_LAYOUT_ZOOM = 4;
/** Maximum code points of user text quoted in a message; fieldPath keeps the full location. */
export const MAX_QUOTED_CODE_POINTS = 48;

const VALUE_TYPES = ['boolean', 'number', 'integer', 'color', 'vec2', 'vec3', 'quaternion', 'enum', 'string', 'asset', 'curve', 'gradient', 'registeredRecord'];
const UNITS = ['none', 'meter', 'second', 'tick', 'radian', 'metersPerSecond', 'metersPerSecondSquared', 'hertz', 'perSecond', 'linearGain', 'normalized'];
const PORT_TYPES = ['event', 'timeWindow', 'anchor', 'paths', 'particles', 'material', 'visual', 'audio', 'presentation', 'scalarSignal', 'colorSignal', 'vec2Signal', 'vec3Signal', 'quaternionSignal', 'booleanSignal', 'asset', 'meshAsset', 'textureAsset', 'audioAsset'];
const DOMAINS = ['constant', 'effectTime', 'normalizedAge', 'pathU'];
const EDIT_POLICIES = ['live', 'resample'];
const ASSET_KINDS = ['texture', 'flipbook', 'mesh', 'sound'];
const COLOR_SPACES = ['color', 'mask', 'normal', 'noise', 'none'];
const ORIGINS = ['authored', 'imported', 'external'];
const SHA256_HEX = /^[0-9a-f]{64}$/;
const UINT32_MAX = 0xffffffff;

type Obj = Record<string, unknown>;
type NodeInfo = { graphId: string; path: string; node: Obj; spec?: NodeSpec };
type GroupRef = { nodeId: string; parentGraphId: string; childGraphId: string; path: string };
type Ctx = {
  opts: DocumentValidationOptions;
  records: RecordRegistry;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  /** Global object ID → first path. */
  ids: Map<string, string>;
  valueContext: ValueContext;
  registeredTypes: Set<string>;
  assetIds: Set<string>;
  graphs: Map<string, Obj>;
  nodes: Map<string, NodeInfo>;
  /** scopeGraphId → control IDs (pre-indexed for Group ports and bindings). */
  scopedControls: Map<string, Set<string>>;
  groupRefs: GroupRef[];
  rootGraphId?: string;
};

// ---------- helpers ----------

const isPlainObject = (v: unknown): v is Obj => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const hasOwn = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === 'string' && ID_PATTERN.test(v);

const join = (base: string, key: string) => (base ? pathKey(base, key) : pathKey('', key).replace(/^\./, ''));
const at = (base: string, i: number) => `${base}[${i}]`;

/** Counts code points, stopping early once the limit is exceeded. */
function codePoints(s: string, limit: number): number {
  let n = 0;
  for (const _ of s) if (++n > limit) return n;
  return n;
}

/** Bounded quoted user text for messages. */
export function quote(v: unknown): string {
  const s = typeof v === 'string' ? v : String(typeof v);
  let out = '';
  let n = 0;
  for (const c of s) {
    if (n++ >= MAX_QUOTED_CODE_POINTS) return `${JSON.stringify(out)}…`;
    out += c;
  }
  return JSON.stringify(out);
}

function err(ctx: Ctx, code: ErrorCode, path: string, message: string, nodeId?: string) {
  const d: Diagnostic = { code, message, fieldPath: path || '$', severity: 'error' };
  if (nodeId !== undefined) d.nodeId = nodeId;
  ctx.errors.push(d);
}

function warn(ctx: Ctx, code: ErrorCode, path: string, message: string) {
  ctx.warnings.push({ code, message, fieldPath: path || '$', severity: 'warning' });
}

function listKeys(keys: string[]): string {
  const shown = keys.slice(0, 5).map(quote).join(', ');
  return keys.length > 5 ? `${shown} and ${keys.length - 5} more` : shown;
}

/** Plain object with exactly the required keys plus any subset of optional keys. */
function shape(ctx: Ctx, path: string, v: unknown, required: string[], optional: string[] = [], what = 'object'): v is Obj {
  if (!isPlainObject(v)) { err(ctx, 'TYPE_MISMATCH', path, `Expected ${what}.`); return false; }
  const extra = Object.keys(v).filter(k => !required.includes(k) && !optional.includes(k));
  const missing = required.filter(k => !hasOwn(v, k));
  if (extra.length) err(ctx, 'INVALID_VALUE', path, `Unknown field(s) in ${what}: ${listKeys(extra)}.`);
  if (missing.length) err(ctx, 'INVALID_VALUE', path, `Missing field(s) in ${what}: ${missing.join(', ')}.`);
  return true;
}

function text(ctx: Ctx, path: string, v: unknown, max: number, nonEmpty = false): v is string {
  if (typeof v !== 'string') { err(ctx, 'TYPE_MISMATCH', path, 'Expected text.'); return false; }
  if (nonEmpty && v.length === 0) { err(ctx, 'INVALID_VALUE', path, 'Text must not be empty.'); return false; }
  if (codePoints(v, max) > max) { err(ctx, 'INVALID_VALUE', path, `Text exceeds ${max} characters; shorten it (text is never truncated).`); return false; }
  return true;
}

function oneOf(ctx: Ctx, path: string, v: unknown, allowed: string[], what: string): v is string {
  if (typeof v === 'string' && allowed.includes(v)) return true;
  err(ctx, 'INVALID_VALUE', path, `${what} ${quote(v)} is not one of: ${allowed.join(', ')}.`);
  return false;
}

function idField(ctx: Ctx, path: string, v: unknown): v is string {
  if (isId(v)) return true;
  err(ctx, 'INVALID_VALUE', path, `ID ${quote(v)} must be 1–64 ASCII letters, digits, "_" or "-".`);
  return false;
}

/** Validates and registers a globally unique object ID. */
function objectId(ctx: Ctx, path: string, v: unknown): v is string {
  if (!idField(ctx, path, v)) return false;
  const first = ctx.ids.get(v);
  if (first !== undefined) { err(ctx, 'DUPLICATE_ID', path, `ID ${quote(v)} is already used at ${first}; object IDs must be unique in the document.`); return false; }
  ctx.ids.set(v, path || '$');
  return true;
}

function list(ctx: Ctx, path: string, v: unknown, max: number, what: string): unknown[] | null {
  if (!Array.isArray(v)) { err(ctx, 'TYPE_MISMATCH', path, `Expected a list of ${what}.`); return null; }
  if (v.length > max) { err(ctx, 'IMPORT_LIMIT', path, `Too many ${what}: ${v.length} (limit ${max}).`); return null; }
  return v;
}

function value(ctx: Ctx, path: string, v: unknown, spec: ParameterSpec, nodeId?: string) {
  for (const d of validateParameterValue(v, spec, path, ctx.records, ctx.valueContext)) {
    if (nodeId !== undefined) d.nodeId = nodeId;
    ctx.errors.push(d);
  }
  if (spec.type === 'asset' && isId(v)) assetRef(ctx, path, v, nodeId);
}

function assetRef(ctx: Ctx, path: string, id: string, nodeId?: string) {
  if (!ctx.assetIds.has(id)) err(ctx, 'MISSING_ASSET', path, `Asset ${quote(id)} is not listed in document assets.`, nodeId);
  else if (ctx.opts.availableAssetIds && !ctx.opts.availableAssetIds.has(id)) {
    err(ctx, 'MISSING_ASSET', path, `Asset ${quote(id)} is referenced but its data is not available; import it to run or export.`, nodeId);
  }
}

const simpleSpec = (type: ParameterSpec['type']): ParameterSpec => ({
  id: 'value', label: 'value', type, unit: 'none', default: 0, domains: ['constant'], editPolicy: 'live', description: '',
});

/** Finds the first object reachable twice (independent instances are required). Input is canonical-safe. */
function findAlias(v: unknown, path: string, seen: Set<object>): string | null {
  if (typeof v !== 'object' || v === null) return null;
  if (seen.has(v)) return path;
  seen.add(v);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { const p = findAlias(v[i], at(path, i), seen); if (p !== null) return p; }
  } else {
    for (const k of Object.keys(v)) { const p = findAlias((v as Obj)[k], join(path, k), seen); if (p !== null) return p; }
  }
  return null;
}

const fromCanonicalPath = (p: string) => (p === '$' ? '' : p.replace(/^\$\.?/, ''));

// ---------- entry points ----------

/** Preflights text size, then parses without throwing; delegates to validateDocument. */
export function parseDocumentJson(text: string, options: DocumentValidationOptions): ValidationResult<EffectDocumentV2> {
  const fail = (code: ErrorCode, message: string): ValidationResult<EffectDocumentV2> =>
    ({ ok: false, errors: [{ code, message, fieldPath: '$', severity: 'error' }] });
  if (typeof text !== 'string') return fail('TYPE_MISMATCH', 'Expected JSON text.');
  // UTF-8 length is at least the UTF-16 length, so this rejects oversized text before encoding.
  if (text.length > MAX_JSON_BYTES || new TextEncoder().encode(text).length > MAX_JSON_BYTES) {
    return fail('IMPORT_LIMIT', `Document JSON exceeds ${MAX_JSON_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? quote(e.message) : 'unknown error';
    return fail(e instanceof RangeError ? 'IMPORT_LIMIT' : 'INVALID_VALUE', `Document is not valid JSON (${detail}).`);
  }
  return validateDocument(parsed, options);
}

export function validateDocument(input: unknown, options: DocumentValidationOptions): ValidationResult<EffectDocumentV2> {
  const ctx: Ctx = {
    opts: options, records: options.records ?? new Map(), errors: [], warnings: [], ids: new Map(),
    valueContext: {}, registeredTypes: new Set(), assetIds: new Set(), graphs: new Map(), nodes: new Map(),
    scopedControls: new Map(), groupRefs: [],
  };
  const reject = (): ValidationResult<EffectDocumentV2> => ({ ok: false, errors: ctx.errors });
  if (!isPlainObject(input)) { err(ctx, 'TYPE_MISMATCH', '', 'Document must be a JSON object.'); return reject(); }

  // Plain-JSON, depth and byte preflight. canonicalJson reads descriptors only: no getter/toJSON runs.
  let json: string;
  try {
    json = canonicalJson(input);
  } catch (e) {
    if (e instanceof CanonicalError) {
      const deep = e.message.includes('nesting deeper than');
      err(ctx, deep ? 'IMPORT_LIMIT' : 'INVALID_VALUE', fromCanonicalPath(e.fieldPath),
        deep ? `Document nesting exceeds depth ${MAX_JSON_DEPTH}.` : `Document is not plain JSON: ${e.message}`);
    } else err(ctx, 'IMPORT_LIMIT', '', 'Document could not be traversed safely.');
    return reject();
  }
  if (json.length > MAX_JSON_BYTES || new TextEncoder().encode(json).length > MAX_JSON_BYTES) {
    err(ctx, 'IMPORT_LIMIT', '', `Document JSON exceeds ${MAX_JSON_BYTES} bytes.`);
    return reject();
  }
  const alias = findAlias(input, '', new Set());
  if (alias !== null) {
    err(ctx, 'INVALID_VALUE', alias, 'This object is shared with another location; each record must be an independent copy.');
    return reject();
  }

  if (input.format !== DOCUMENT_FORMAT) {
    err(ctx, 'INVALID_VALUE', 'format', `Not a ${DOCUMENT_FORMAT} document (format ${quote(input.format)}).`);
    return reject();
  }
  // Recognized and safely bounded: from here every failure preserves the exact input for recovery.
  const recover = (): ValidationResult<EffectDocumentV2> => ({ ok: false, errors: ctx.errors, recoverableRaw: input });
  if (input.schemaVersion !== SCHEMA_VERSION) err(ctx, 'UNSUPPORTED_VERSION', 'schemaVersion', `Schema version ${quote(String(input.schemaVersion))} is not supported (expected ${SCHEMA_VERSION}); opened read-only for recovery.`);
  if (input.runtimeVersion !== RUNTIME_VERSION) err(ctx, 'UNSUPPORTED_VERSION', 'runtimeVersion', `Runtime version ${quote(input.runtimeVersion)} is not supported (expected ${RUNTIME_VERSION}); opened read-only for recovery.`);
  if (ctx.errors.length) return recover();

  for (const s of options.registry.values()) ctx.registeredTypes.add(s.type);
  checkDocument(ctx, input);
  if (ctx.errors.length) return recover();
  return { ok: true, value: input as EffectDocumentV2, warnings: ctx.warnings };
}

// ---------- document ----------

function checkDocument(ctx: Ctx, d: Obj) {
  if (!shape(ctx, '', d, ['format', 'schemaVersion', 'runtimeVersion', 'id', 'name', 'tags', 'seed', 'rootTransform', 'anchors', 'durationTicks', 'rootGraphId', 'graphs', 'controls', 'assets', 'editor'], [], 'document')) return;
  objectId(ctx, 'id', d.id);
  text(ctx, 'name', d.name, MAX_LABEL_CODE_POINTS);
  const tags = list(ctx, 'tags', d.tags, MAX_TAGS, 'tags');
  tags?.forEach((t, i) => text(ctx, at('tags', i), t, MAX_TAG_CODE_POINTS));
  if (!Number.isInteger(d.seed) || (d.seed as number) < 0 || (d.seed as number) > UINT32_MAX) {
    err(ctx, 'INVALID_VALUE', 'seed', `Seed must be a whole number in [0,${UINT32_MAX}].`);
  }
  if (Number.isSafeInteger(d.durationTicks) && (d.durationTicks as number) >= MIN_DURATION_TICKS && (d.durationTicks as number) <= MAX_DURATION_TICKS) {
    ctx.valueContext = { durationTicks: d.durationTicks as number };
  } else err(ctx, 'INVALID_VALUE', 'durationTicks', `Duration must be a whole number of ticks in [${MIN_DURATION_TICKS},${MAX_DURATION_TICKS}].`);

  if (shape(ctx, 'rootTransform', d.rootTransform, ['position', 'rotation', 'scale'], [], 'transform')) {
    const t = d.rootTransform as Obj;
    value(ctx, 'rootTransform.position', t.position, simpleSpec('vec3'));
    value(ctx, 'rootTransform.rotation', t.rotation, simpleSpec('quaternion'));
    if (!isFiniteNumber(t.scale) || t.scale <= 0) err(ctx, 'INVALID_VALUE', 'rootTransform.scale', 'Root scale must be a finite number greater than 0.');
  }
  checkAnchors(ctx, d.anchors);
  checkAssets(ctx, d.assets);

  const graphs = list(ctx, 'graphs', d.graphs, MAX_GRAPHS, 'graphs');
  const controls = list(ctx, 'controls', d.controls, MAX_CONTROLS, 'controls');
  if (!graphs || !controls) return;
  // Stored totals are bounded before any per-node work.
  let nodeCount = 0, edgeCount = 0, bindingCount = 0;
  for (const g of graphs) if (isPlainObject(g)) {
    if (Array.isArray(g.nodes)) nodeCount += g.nodes.length;
    if (Array.isArray(g.edges)) edgeCount += g.edges.length;
  }
  for (const c of controls) if (isPlainObject(c) && Array.isArray(c.bindings)) bindingCount += c.bindings.length;
  let limited = false;
  if (nodeCount > MAX_STORED_NODES) { err(ctx, 'IMPORT_LIMIT', 'graphs', `Too many stored nodes: ${nodeCount} (limit ${MAX_STORED_NODES}).`); limited = true; }
  if (edgeCount > MAX_STORED_EDGES) { err(ctx, 'IMPORT_LIMIT', 'graphs', `Too many stored edges: ${edgeCount} (limit ${MAX_STORED_EDGES}).`); limited = true; }
  if (bindingCount > MAX_CONTROL_BINDINGS) { err(ctx, 'IMPORT_LIMIT', 'controls', `Too many control bindings: ${bindingCount} (limit ${MAX_CONTROL_BINDINGS}).`); limited = true; }
  if (limited) return;

  graphs.forEach((g, i) => {
    if (isPlainObject(g) && objectId(ctx, at('graphs', i) + '.id', g.id)) ctx.graphs.set(g.id, g);
  });
  if (idField(ctx, 'rootGraphId', d.rootGraphId)) {
    if (ctx.graphs.has(d.rootGraphId)) ctx.rootGraphId = d.rootGraphId;
    else err(ctx, 'MISSING_REFERENCE', 'rootGraphId', `Root graph ${quote(d.rootGraphId)} does not exist.`);
  }
  controls.forEach(c => {
    if (isPlainObject(c) && isId(c.id) && isId(c.scopeGraphId)) {
      let set = ctx.scopedControls.get(c.scopeGraphId);
      if (!set) ctx.scopedControls.set(c.scopeGraphId, set = new Set());
      set.add(c.id);
    }
  });

  // Register every node first so edges/bindings can distinguish other-graph from missing nodes.
  graphs.forEach((g, gi) => {
    if (!isPlainObject(g) || !Array.isArray(g.nodes) || !isId(g.id)) return;
    g.nodes.forEach((n, ni) => {
      const path = `${at('graphs', gi)}.nodes[${ni}]`;
      if (isPlainObject(n) && objectId(ctx, `${path}.id`, n.id)) {
        ctx.nodes.set(n.id, { graphId: g.id as string, path, node: n, spec: lookupSpec(ctx, n) });
      }
    });
  });
  graphs.forEach((g, gi) => checkGraph(ctx, at('graphs', gi), g));
  checkGroupStructure(ctx);

  const bindingTargets = new Map<string, string>();
  controls.forEach((c, i) => checkControl(ctx, at('controls', i), c, bindingTargets));
  checkEditor(ctx, d.editor);
}

/** Structural parameters: Group.graphId and GroupInput/GroupOutput.portId. Never bindable or connectable. */
function isStructuralParam(nodeType: unknown, parameter: unknown): boolean {
  if (nodeType === GROUP_NODE_TYPE) return parameter === GROUP_GRAPH_PARAM;
  return (nodeType === GROUP_INPUT_NODE_TYPE || nodeType === GROUP_OUTPUT_NODE_TYPE) && parameter === BRIDGE_PORT_PARAM;
}

/** Parameter specs a node literal may carry. A Group carries only graphId, whatever extra metadata lists. */
function literalParams(nodeType: unknown, spec: NodeSpec): readonly ParameterSpec[] {
  return nodeType === GROUP_NODE_TYPE ? spec.parameters.filter(s => s.id === GROUP_GRAPH_PARAM) : spec.parameters;
}

/** Registry parameters that controls/edges may drive: never structural, and none on a Group (exposed controls only). */
function drivableParams(nodeType: unknown, spec: NodeSpec): ParameterSpec[] {
  if (nodeType === GROUP_NODE_TYPE) return [];
  return spec.parameters.filter(s => !isStructuralParam(nodeType, s.id));
}

function lookupSpec(ctx: Ctx, n: Obj): NodeSpec | undefined {
  if (typeof n.type !== 'string' || !Number.isSafeInteger(n.definitionVersion)) return undefined;
  return ctx.opts.registry.get(`${n.type}@${n.definitionVersion}`);
}

function checkAnchors(ctx: Ctx, v: unknown) {
  const anchors = list(ctx, 'anchors', v, MAX_ANCHORS, 'anchors');
  if (!anchors) return;
  const seen = new Set<string>();
  anchors.forEach((a, i) => {
    const p = at('anchors', i);
    if (!shape(ctx, p, a, ['id', 'name', 'position'], [], 'anchor')) return;
    if (objectId(ctx, `${p}.id`, a.id)) seen.add(a.id);
    text(ctx, `${p}.name`, a.name, MAX_LABEL_CODE_POINTS);
    value(ctx, `${p}.position`, a.position, simpleSpec('vec3'));
  });
  for (const required of [SOURCE_ANCHOR_ID, TARGET_ANCHOR_ID]) {
    if (!seen.has(required)) err(ctx, 'MISSING_REFERENCE', 'anchors', `Required anchor "${required}" is missing.`);
  }
}

// ---------- assets ----------

/** Relative bundle path only: no absolute/drive/backslash/empty/dot segments. Never resolved here. */
function safeBundlePath(p: string): boolean {
  if (p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p) || p.includes('\0')) return false;
  return p.split('/').every(s => s !== '' && s !== '.' && s !== '..');
}

function checkAssets(ctx: Ctx, v: unknown) {
  const assets = list(ctx, 'assets', v, MAX_ASSET_REFERENCES, 'asset references');
  if (!assets) return;
  assets.forEach((a, i) => {
    const p = at('assets', i);
    if (!shape(ctx, p, a, ['id', 'sha256', 'kind', 'mime', 'bytes', 'source', 'colorSpace', 'interpretation', 'provenance', 'license'], ['width', 'height', 'durationSeconds'], 'asset reference')) return;
    if (objectId(ctx, `${p}.id`, a.id)) ctx.assetIds.add(a.id);
    if (typeof a.sha256 !== 'string' || !SHA256_HEX.test(a.sha256)) err(ctx, 'INVALID_VALUE', `${p}.sha256`, 'sha256 must be 64 lowercase hex digits.');
    const kindOk = oneOf(ctx, `${p}.kind`, a.kind, ASSET_KINDS, 'Asset kind');
    text(ctx, `${p}.mime`, a.mime, MAX_LABEL_CODE_POINTS, true);
    if (!Number.isSafeInteger(a.bytes) || (a.bytes as number) < 0) err(ctx, 'INVALID_VALUE', `${p}.bytes`, 'Byte size must be a whole number ≥ 0.');
    for (const k of ['width', 'height']) {
      if (hasOwn(a, k) && (!Number.isSafeInteger(a[k]) || (a[k] as number) < 1)) err(ctx, 'INVALID_VALUE', `${p}.${k}`, `${k} must be a whole number ≥ 1.`);
    }
    if (hasOwn(a, 'durationSeconds') && (!isFiniteNumber(a.durationSeconds) || a.durationSeconds <= 0)) {
      err(ctx, 'INVALID_VALUE', `${p}.durationSeconds`, 'Duration must be a finite number greater than 0.');
    }
    checkAssetSource(ctx, `${p}.source`, a.source);
    const csOk = oneOf(ctx, `${p}.colorSpace`, a.colorSpace, COLOR_SPACES, 'Color space');
    checkInterpretation(ctx, `${p}.interpretation`, a.interpretation, kindOk ? a.kind as string : undefined, csOk ? a.colorSpace as string : undefined);
    const pp = `${p}.provenance`;
    if (shape(ctx, pp, a.provenance, ['origin', 'originalFilename', 'modificationNotes'], ['author', 'sourceUrl'], 'provenance')) {
      const pv = a.provenance as Obj;
      oneOf(ctx, `${pp}.origin`, pv.origin, ORIGINS, 'Origin');
      text(ctx, `${pp}.originalFilename`, pv.originalFilename, MAX_PATH_CODE_POINTS);
      text(ctx, `${pp}.modificationNotes`, pv.modificationNotes, MAX_DESCRIPTION_CODE_POINTS);
      if (hasOwn(pv, 'author')) text(ctx, `${pp}.author`, pv.author, MAX_LABEL_CODE_POINTS);
      // Provenance text only: never fetched or resolved.
      if (hasOwn(pv, 'sourceUrl')) text(ctx, `${pp}.sourceUrl`, pv.sourceUrl, MAX_PATH_CODE_POINTS);
    }
    const lp = `${p}.license`;
    if (shape(ctx, lp, a.license, ['identifier'], ['text'], 'license')) {
      const l = a.license as Obj;
      text(ctx, `${lp}.identifier`, l.identifier, MAX_LABEL_CODE_POINTS, true);
      if (hasOwn(l, 'text') && typeof l.text !== 'string') err(ctx, 'TYPE_MISMATCH', `${lp}.text`, 'Expected text.');
    }
  });
}

function checkAssetSource(ctx: Ctx, p: string, s: unknown) {
  if (!isPlainObject(s)) { err(ctx, 'TYPE_MISMATCH', p, 'Expected an asset source.'); return; }
  if (s.kind === 'bundle') {
    if (!shape(ctx, p, s, ['kind', 'path'], [], 'bundle source')) return;
    if (text(ctx, `${p}.path`, s.path, MAX_PATH_CODE_POINTS, true) && !safeBundlePath(s.path)) {
      err(ctx, 'INVALID_VALUE', `${p}.path`, 'Bundle path must be relative with no empty, "." or ".." segments, backslashes or drive letters.');
    }
  } else if (s.kind === 'builtin') {
    if (!shape(ctx, p, s, ['kind', 'builtinId', 'version'], [], 'builtin source')) return;
    idField(ctx, `${p}.builtinId`, s.builtinId);
    if (!Number.isSafeInteger(s.version) || (s.version as number) < 1) err(ctx, 'INVALID_VALUE', `${p}.version`, 'Builtin version must be a whole number ≥ 1.');
  } else err(ctx, 'INVALID_VALUE', `${p}.kind`, `Asset source kind ${quote(s.kind)} must be "bundle" or "builtin".`);
}

function checkInterpretation(ctx: Ctx, p: string, v: unknown, kind: string | undefined, colorSpace: string | undefined) {
  if (!shape(ctx, p, v, ['kind', 'colorSpace'], ['flipbook', 'mesh'], 'interpretation')) return;
  if (oneOf(ctx, `${p}.kind`, v.kind, ASSET_KINDS, 'Interpretation kind') && kind !== undefined && v.kind !== kind) {
    err(ctx, 'TYPE_MISMATCH', `${p}.kind`, 'Interpretation kind must match the asset kind.');
  }
  if (oneOf(ctx, `${p}.colorSpace`, v.colorSpace, COLOR_SPACES, 'Color space') && colorSpace !== undefined && v.colorSpace !== colorSpace) {
    err(ctx, 'TYPE_MISMATCH', `${p}.colorSpace`, 'Interpretation color space must match the asset color space.');
  }
  if (hasOwn(v, 'flipbook')) {
    const fp = `${p}.flipbook`;
    if (kind !== undefined && kind !== 'flipbook') err(ctx, 'INVALID_VALUE', fp, 'Flipbook settings are only allowed for flipbook assets.');
    else if (shape(ctx, fp, v.flipbook, ['rows', 'columns', 'frameCount', 'paddingPixels'], [], 'flipbook settings')) {
      const f = v.flipbook as Obj;
      for (const k of ['rows', 'columns', 'frameCount']) {
        if (!Number.isSafeInteger(f[k]) || (f[k] as number) < 1) err(ctx, 'INVALID_VALUE', `${fp}.${k}`, `${k} must be a whole number ≥ 1.`);
      }
      if (!Number.isSafeInteger(f.paddingPixels) || (f.paddingPixels as number) < 0) err(ctx, 'INVALID_VALUE', `${fp}.paddingPixels`, 'Padding must be a whole number ≥ 0.');
      if (Number.isSafeInteger(f.rows) && Number.isSafeInteger(f.columns) && Number.isSafeInteger(f.frameCount) && (f.frameCount as number) > (f.rows as number) * (f.columns as number)) {
        err(ctx, 'INVALID_VALUE', `${fp}.frameCount`, 'Frame count cannot exceed rows × columns.');
      }
    }
  }
  if (hasOwn(v, 'mesh')) {
    const mp = `${p}.mesh`;
    if (kind !== undefined && kind !== 'mesh') err(ctx, 'INVALID_VALUE', mp, 'Mesh settings are only allowed for mesh assets.');
    else if (shape(ctx, mp, v.mesh, ['importScale'], [], 'mesh settings')) {
      const m = v.mesh as Obj;
      if (!isFiniteNumber(m.importScale) || m.importScale <= 0) err(ctx, 'INVALID_VALUE', `${mp}.importScale`, 'Import scale must be a finite number greater than 0.');
    }
  }
}

// ---------- graphs ----------

function checkGraph(ctx: Ctx, p: string, g: unknown) {
  if (!shape(ctx, p, g, ['id', 'inputs', 'outputs', 'nodes', 'edges'], [], 'graph')) return;
  const graphId = isId(g.id) && ctx.graphs.get(g.id) === g ? g.id : undefined;
  const isRoot = graphId !== undefined && graphId === ctx.rootGraphId;
  const inputIds = checkInterface(ctx, `${p}.inputs`, g.inputs, 'input');
  const outputIds = checkInterface(ctx, `${p}.outputs`, g.outputs, 'output');
  const shared = [...inputIds].filter(id => outputIds.has(id));
  if (shared.length) err(ctx, 'DUPLICATE_ID', p, `Interface port ID(s) used as both input and output: ${listKeys(shared)}.`);
  if (isRoot && ((Array.isArray(g.inputs) && g.inputs.length) || (Array.isArray(g.outputs) && g.outputs.length))) {
    err(ctx, 'INVALID_VALUE', p, 'The root graph has no external interface; use Anchor/PublicParameter nodes and EffectOutput.');
  }
  let enabledOutputs = 0;
  if (Array.isArray(g.nodes)) g.nodes.forEach((n, i) => {
    const np = `${p}.nodes[${i}]`;
    checkNode(ctx, np, n, graphId, inputIds, outputIds);
    if (isRoot && isPlainObject(n) && n.type === EFFECT_OUTPUT_NODE_TYPE && n.enabled === true) enabledOutputs++;
  });
  else err(ctx, 'TYPE_MISMATCH', `${p}.nodes`, 'Expected a list of nodes.');
  if (isRoot && enabledOutputs !== 1) {
    err(ctx, 'INVALID_VALUE', `${p}.nodes`, `The root graph needs exactly one enabled EffectOutput (found ${enabledOutputs}).`);
  }
  if (Array.isArray(g.edges)) g.edges.forEach((e, i) => checkEdge(ctx, `${p}.edges[${i}]`, e, graphId));
  else err(ctx, 'TYPE_MISMATCH', `${p}.edges`, 'Expected a list of edges.');
}

function checkInterface(ctx: Ctx, p: string, v: unknown, direction: 'input' | 'output'): Set<string> {
  const ids = new Set<string>();
  const ports = list(ctx, p, v, MAX_INTERFACE_PORTS_PER_DIRECTION, `${direction} ports`);
  ports?.forEach((port, i) => {
    const pp = at(p, i);
    if (!shape(ctx, pp, port, ['id', 'label', 'type', 'cardinality', 'required', 'direction'], ['unit', 'domains', 'defaultValue'], 'interface port')) return;
    if (idField(ctx, `${pp}.id`, port.id)) {
      if (ids.has(port.id)) err(ctx, 'DUPLICATE_ID', `${pp}.id`, `Interface port ${quote(port.id)} is declared twice.`);
      ids.add(port.id);
    }
    text(ctx, `${pp}.label`, port.label, MAX_LABEL_CODE_POINTS);
    oneOf(ctx, `${pp}.type`, port.type, PORT_TYPES, 'Port type');
    oneOf(ctx, `${pp}.cardinality`, port.cardinality, ['one', 'many'], 'Cardinality');
    if (typeof port.required !== 'boolean') err(ctx, 'TYPE_MISMATCH', `${pp}.required`, 'Expected true or false.');
    if (port.direction !== direction) err(ctx, 'INVALID_VALUE', `${pp}.direction`, `Port in ${direction}s must have direction "${direction}".`);
    if (hasOwn(port, 'unit')) oneOf(ctx, `${pp}.unit`, port.unit, UNITS, 'Unit');
    if (hasOwn(port, 'domains')) {
      if (!Array.isArray(port.domains)) err(ctx, 'TYPE_MISMATCH', `${pp}.domains`, 'Expected a list of evaluation domains.');
      else port.domains.forEach((dm, j) => oneOf(ctx, `${pp}.domains[${j}]`, dm, DOMAINS, 'Domain'));
    }
    // defaultValue is plain JSON (preflight); typed port-default compatibility is a WP02 compiler check.
  });
  return ids;
}

function checkNode(ctx: Ctx, p: string, n: unknown, graphId: string | undefined, inputIds: Set<string>, outputIds: Set<string>) {
  if (!shape(ctx, p, n, ['id', 'type', 'definitionVersion', 'label', 'enabled', 'randomStreamId', 'params'], [], 'node')) return;
  const nodeId = isId(n.id) ? n.id : undefined;
  const typeOk = text(ctx, `${p}.type`, n.type, MAX_LABEL_CODE_POINTS, true);
  const versionOk = Number.isSafeInteger(n.definitionVersion) && (n.definitionVersion as number) >= 1;
  if (!versionOk) err(ctx, 'INVALID_VALUE', `${p}.definitionVersion`, 'Definition version must be a whole number ≥ 1.', nodeId);
  text(ctx, `${p}.label`, n.label, MAX_LABEL_CODE_POINTS);
  if (typeof n.enabled !== 'boolean') err(ctx, 'TYPE_MISMATCH', `${p}.enabled`, 'Expected true or false.', nodeId);
  idField(ctx, `${p}.randomStreamId`, n.randomStreamId);
  if (!isPlainObject(n.params)) { err(ctx, 'TYPE_MISMATCH', `${p}.params`, 'Node params must be an object.', nodeId); return; }
  if (!typeOk || !versionOk) return;

  const spec = lookupSpec(ctx, n);
  if (!spec) {
    // Preserved in the recoverable raw document; never dropped or executed.
    if (ctx.registeredTypes.has(n.type as string)) {
      err(ctx, 'UNSUPPORTED_VERSION', `${p}.definitionVersion`, `Node type ${quote(n.type)} version ${n.definitionVersion} is not supported; kept read-only for recovery.`, nodeId);
    } else err(ctx, 'UNKNOWN_NODE', `${p}.type`, `Unknown node type ${quote(n.type)}; kept read-only for recovery.`, nodeId);
    return;
  }
  const params = n.params;
  const pp = `${p}.params`;
  const allowed = literalParams(n.type, spec);
  const known = new Set(allowed.map(s => s.id));
  const extraKeys = Object.keys(params).filter(k => !known.has(k));
  for (const k of extraKeys.slice(0, 16)) {
    err(ctx, 'INVALID_VALUE', join(pp, k), `Node ${quote(n.type)} has no parameter ${quote(k)}.`, nodeId);
  }
  if (extraKeys.length > 16) err(ctx, 'INVALID_VALUE', pp, `${extraKeys.length - 16} more unknown parameters.`, nodeId);
  for (const s of allowed) {
    if (hasOwn(params, s.id)) value(ctx, join(pp, s.id), params[s.id], s, nodeId);
    else if (!hasOwn(s, 'default')) err(ctx, 'INVALID_VALUE', join(pp, s.id), `Parameter ${quote(s.id)} is required.`, nodeId);
  }

  if (n.type === GROUP_NODE_TYPE) {
    const gp = join(pp, GROUP_GRAPH_PARAM);
    const child = params[GROUP_GRAPH_PARAM];
    if (!isId(child)) err(ctx, 'INVALID_VALUE', gp, 'A Group must reference its embedded graph by ID.', nodeId);
    else if (!ctx.graphs.has(child)) err(ctx, 'MISSING_REFERENCE', gp, `Group graph ${quote(child)} does not exist.`, nodeId);
    else if (graphId !== undefined && nodeId !== undefined) ctx.groupRefs.push({ nodeId, parentGraphId: graphId, childGraphId: child, path: gp });
  } else if (n.type === GROUP_INPUT_NODE_TYPE || n.type === GROUP_OUTPUT_NODE_TYPE) {
    const input = n.type === GROUP_INPUT_NODE_TYPE;
    const bp = join(pp, BRIDGE_PORT_PARAM);
    const port = params[BRIDGE_PORT_PARAM];
    if (!isId(port)) err(ctx, 'INVALID_VALUE', bp, 'A graph bridge must reference an interface port by ID.', nodeId);
    else if (!(input ? inputIds : outputIds).has(port)) {
      err(ctx, 'MISSING_REFERENCE', bp, `This graph has no ${input ? 'input' : 'output'} interface port ${quote(port)}.`, nodeId);
    }
  }
}

/** Ports of a node: registered ports; parameter-driven inputs; Group interface and exposed controls. */
function nodePorts(ctx: Ctx, info: NodeInfo, side: 'source' | 'target'): Set<string> | null {
  const spec = info.spec;
  if (!spec) return null;
  const ports = new Set<string>();
  // Bridge port identity is fixed; its concrete type comes from its graph interface.
  if (info.node.type === GROUP_INPUT_NODE_TYPE) {
    if (side === 'source') ports.add('out');
    return ports;
  }
  if (info.node.type === GROUP_OUTPUT_NODE_TYPE) {
    if (side === 'target') ports.add('in');
    return ports;
  }
  if (side === 'source') for (const o of spec.outputs) ports.add(o.id);
  else {
    for (const i of spec.inputs) ports.add(i.id);
    for (const s of drivableParams(info.node.type, spec)) ports.add(s.id);
  }
  if (info.node.type === GROUP_NODE_TYPE && isPlainObject(info.node.params)) {
    const child = info.node.params[GROUP_GRAPH_PARAM];
    const g = isId(child) ? ctx.graphs.get(child) : undefined;
    const iface = g ? (side === 'source' ? g.outputs : g.inputs) : undefined;
    if (Array.isArray(iface)) for (const port of iface) if (isPlainObject(port) && isId(port.id)) ports.add(port.id);
    if (side === 'target' && isId(child)) for (const c of ctx.scopedControls.get(child) ?? []) ports.add(c);
  }
  return ports;
}

function checkEdge(ctx: Ctx, p: string, e: unknown, graphId: string | undefined) {
  if (!shape(ctx, p, e, ['id', 'source', 'target', 'order'], ['mix'], 'edge')) return;
  if (hasOwn(e, 'mix')) checkEdgeMix(ctx, `${p}.mix`, e.mix, e.target);
  objectId(ctx, `${p}.id`, e.id);
  if (!Number.isSafeInteger(e.order) || (e.order as number) < 0) err(ctx, 'INVALID_VALUE', `${p}.order`, 'Edge order must be a whole number ≥ 0.');
  for (const side of ['source', 'target'] as const) {
    const sp = `${p}.${side}`;
    const end = e[side];
    if (!shape(ctx, sp, end, ['nodeId', 'port'], [], `edge ${side}`)) continue;
    if (!idField(ctx, `${sp}.port`, end.port) || !idField(ctx, `${sp}.nodeId`, end.nodeId)) continue;
    const info = ctx.nodes.get(end.nodeId);
    if (!info) { err(ctx, 'MISSING_REFERENCE', `${sp}.nodeId`, `Node ${quote(end.nodeId)} does not exist.`); continue; }
    if (info.graphId !== graphId) { err(ctx, 'MISSING_REFERENCE', `${sp}.nodeId`, `Node ${quote(end.nodeId)} is in another graph; edges connect nodes of the same graph.`, end.nodeId); continue; }
    const ports = nodePorts(ctx, info, side);
    if (ports && !ports.has(end.port)) {
      err(ctx, 'MISSING_REFERENCE', `${sp}.port`, `Node ${quote(end.nodeId)} has no ${side === 'source' ? 'output' : 'input'} port ${quote(end.port)}.`, end.nodeId);
    }
  }
}

/** WP04-AUDIO-MIX-CONTRACT.md §5: per-connection mix only on AudioMix `inputs`; never clamped. */
function checkEdgeMix(ctx: Ctx, p: string, mix: unknown, target: unknown) {
  const t = isPlainObject(target) ? ctx.nodes.get(target.nodeId as string) : undefined;
  if (!t || t.node.type !== AUDIO_MIX_NODE_TYPE || (target as Obj).port !== AUDIO_MIX_INPUT_PORT) {
    err(ctx, 'INVALID_VALUE', p, 'Mix settings are only allowed on edges into an AudioMix "inputs" port.');
    return;
  }
  if (!isPlainObject(mix)) { err(ctx, 'INVALID_VALUE', p, 'Expected mix settings {gain, pan}.'); return; }
  const extra = Object.keys(mix).filter(k => k !== 'gain' && k !== 'pan');
  if (extra.length > 0 || !hasOwn(mix, 'gain') || !hasOwn(mix, 'pan')) {
    err(ctx, 'INVALID_VALUE', p, 'Mix settings must contain exactly gain and pan.');
    return;
  }
  const { gain, pan } = mix;
  if (!isFiniteNumber(gain) || gain < MIN_EDGE_MIX_GAIN || gain > MAX_EDGE_MIX_GAIN) {
    err(ctx, 'INVALID_VALUE', `${p}.gain`, `Gain must be a finite number from ${MIN_EDGE_MIX_GAIN} to ${MAX_EDGE_MIX_GAIN}.`);
  }
  if (!isFiniteNumber(pan) || pan < MIN_EDGE_MIX_PAN || pan > MAX_EDGE_MIX_PAN) {
    err(ctx, 'INVALID_VALUE', `${p}.pan`, `Pan must be a finite number from ${MIN_EDGE_MIX_PAN} to ${MAX_EDGE_MIX_PAN}.`);
  }
}

/** Group references: one independent instance per embedded graph, no recursion, depth ≤ MAX_GROUP_DEPTH. */
function checkGroupStructure(ctx: Ctx) {
  const children = new Map<string, GroupRef[]>();
  const refCount = new Map<string, GroupRef[]>();
  for (const r of ctx.groupRefs) {
    (children.get(r.parentGraphId) ?? children.set(r.parentGraphId, []).get(r.parentGraphId)!).push(r);
    (refCount.get(r.childGraphId) ?? refCount.set(r.childGraphId, []).get(r.childGraphId)!).push(r);
  }
  for (const r of ctx.groupRefs) {
    if (r.childGraphId === ctx.rootGraphId) err(ctx, 'GROUP_RECURSION', r.path, 'A Group cannot embed the root graph.', r.nodeId);
  }
  for (const [graphId, refs] of refCount) {
    for (const r of refs.slice(1)) {
      err(ctx, 'INVALID_VALUE', r.path, `Graph ${quote(graphId)} is already instantiated by Group ${quote(refs[0].nodeId)}; each Group needs its own embedded copy.`, r.nodeId);
    }
  }
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const visit = (graphId: string, depth: number) => {
    visited.add(graphId);
    onStack.add(graphId);
    for (const r of children.get(graphId) ?? []) {
      if (r.childGraphId === ctx.rootGraphId) continue;
      if (onStack.has(r.childGraphId)) { err(ctx, 'GROUP_RECURSION', r.path, `Group ${quote(r.nodeId)} recursively embeds graph ${quote(r.childGraphId)}.`, r.nodeId); continue; }
      if (visited.has(r.childGraphId)) continue;
      if (depth + 1 > MAX_GROUP_DEPTH) { err(ctx, 'BUDGET_EXCEEDED', r.path, `Group nesting exceeds depth ${MAX_GROUP_DEPTH}.`, r.nodeId); continue; }
      visit(r.childGraphId, depth + 1);
    }
    onStack.delete(graphId);
  };
  if (ctx.rootGraphId !== undefined) visit(ctx.rootGraphId, 0);
  for (const graphId of ctx.graphs.keys()) {
    if (visited.has(graphId)) continue;
    visit(graphId, 0);
    if (!refCount.has(graphId)) warn(ctx, 'MISSING_REFERENCE', 'graphs', `Graph ${quote(graphId)} is not used by the root graph or any Group.`);
  }
}

// ---------- controls ----------

function checkControl(ctx: Ctx, p: string, c: unknown, targets: Map<string, string>) {
  if (!shape(ctx, p, c, ['id', 'scopeGraphId', 'label', 'type', 'unit', 'value', 'default', 'section', 'description', 'editPolicy', 'bindings'], ['min', 'max', 'step', 'choices'], 'control')) return;
  objectId(ctx, `${p}.id`, c.id);
  let scope: string | undefined;
  if (idField(ctx, `${p}.scopeGraphId`, c.scopeGraphId)) {
    if (ctx.graphs.has(c.scopeGraphId)) scope = c.scopeGraphId;
    else err(ctx, 'MISSING_REFERENCE', `${p}.scopeGraphId`, `Control scope graph ${quote(c.scopeGraphId)} does not exist.`);
  }
  if (c.id === GROUP_GRAPH_PARAM) {
    err(ctx, 'INVALID_VALUE', `${p}.id`, `"${GROUP_GRAPH_PARAM}" is reserved for the Group graph reference and cannot name a control.`);
  }
  text(ctx, `${p}.label`, c.label, MAX_LABEL_CODE_POINTS);
  text(ctx, `${p}.section`, c.section, MAX_LABEL_CODE_POINTS);
  text(ctx, `${p}.description`, c.description, MAX_DESCRIPTION_CODE_POINTS);
  const typeOk = oneOf(ctx, `${p}.type`, c.type, VALUE_TYPES, 'Value type');
  const unitOk = oneOf(ctx, `${p}.unit`, c.unit, UNITS, 'Unit');
  const policyOk = oneOf(ctx, `${p}.editPolicy`, c.editPolicy, EDIT_POLICIES, 'Edit policy');
  let rangeOk = true;
  for (const k of ['min', 'max', 'step']) {
    if (hasOwn(c, k) && !isFiniteNumber(c[k])) { err(ctx, 'INVALID_VALUE', `${p}.${k}`, `${k} must be a finite number.`); rangeOk = false; }
  }
  if (rangeOk && isFiniteNumber(c.min) && isFiniteNumber(c.max) && c.min > c.max) { err(ctx, 'INVALID_VALUE', `${p}.min`, 'min cannot exceed max.'); rangeOk = false; }
  if (rangeOk && hasOwn(c, 'step') && (c.step as number) <= 0) { err(ctx, 'INVALID_VALUE', `${p}.step`, 'step must be greater than 0.'); rangeOk = false; }
  let choicesOk = true;
  if (hasOwn(c, 'choices')) {
    if (!Array.isArray(c.choices) || c.choices.length === 0) { err(ctx, 'INVALID_VALUE', `${p}.choices`, 'choices must be a non-empty list of text.'); choicesOk = false; }
    else {
      const seen = new Set<string>();
      c.choices.forEach((ch, i) => {
        if (!text(ctx, `${p}.choices[${i}]`, ch, MAX_LABEL_CODE_POINTS)) choicesOk = false;
        else if (seen.has(ch)) { err(ctx, 'DUPLICATE_ID', `${p}.choices[${i}]`, `Choice ${quote(ch)} is listed twice.`); choicesOk = false; }
        else seen.add(ch);
      });
    }
  } else if (c.type === 'enum') { err(ctx, 'INVALID_VALUE', `${p}.choices`, 'An enum control needs choices.'); choicesOk = false; }

  if (typeOk && unitOk && policyOk && rangeOk && choicesOk) {
    const spec: ParameterSpec = {
      id: typeof c.id === 'string' ? c.id : 'control', label: 'control', type: c.type as ParameterSpec['type'], unit: c.unit as ParameterSpec['unit'],
      default: 0, domains: ['constant'], editPolicy: c.editPolicy as ParameterSpec['editPolicy'], description: '',
    };
    if (hasOwn(c, 'min')) spec.min = c.min as number;
    if (hasOwn(c, 'max')) spec.max = c.max as number;
    if (hasOwn(c, 'step')) spec.step = c.step as number;
    if (hasOwn(c, 'choices')) spec.choices = c.choices as string[];
    // Record controls carry no recordType field: derive it from the authored value; default must match it.
    const v = c.value;
    if (spec.type === 'registeredRecord' && isPlainObject(v) && typeof v.recordType === 'string') spec.recordType = v.recordType;
    value(ctx, `${p}.value`, v, spec);
    value(ctx, `${p}.default`, c.default, spec);
  }

  if (!Array.isArray(c.bindings)) { err(ctx, 'TYPE_MISMATCH', `${p}.bindings`, 'Expected a list of bindings.'); return; }
  c.bindings.forEach((b, i) => checkBinding(ctx, `${p}.bindings[${i}]`, b, scope, targets));
}

function checkBinding(ctx: Ctx, p: string, b: unknown, scope: string | undefined, targets: Map<string, string>) {
  if (!shape(ctx, p, b, ['nodeId', 'parameter'], ['scale', 'offset', 'axis'], 'binding')) return;
  if (hasOwn(b, 'axis') && !(Number.isInteger(b.axis) && (b.axis as number) >= 0 && (b.axis as number) <= 2)) err(ctx, 'INVALID_VALUE', `${p}.axis`, 'axis must be 0, 1 or 2.');
  for (const k of ['scale', 'offset']) {
    if (hasOwn(b, k) && !isFiniteNumber(b[k])) err(ctx, 'INVALID_VALUE', `${p}.${k}`, `${k} must be a finite number.`);
  }
  if (!idField(ctx, `${p}.nodeId`, b.nodeId) || !idField(ctx, `${p}.parameter`, b.parameter)) return;
  const info = ctx.nodes.get(b.nodeId);
  if (!info) { err(ctx, 'MISSING_REFERENCE', `${p}.nodeId`, `Bound node ${quote(b.nodeId)} does not exist.`); return; }
  if (scope !== undefined && info.graphId !== scope) {
    err(ctx, 'MISSING_REFERENCE', `${p}.nodeId`, `Node ${quote(b.nodeId)} is outside this control's graph; bind the enclosing Group's exposed control instead.`, b.nodeId);
    return;
  }
  const isGroup = info.node.type === GROUP_NODE_TYPE;
  if (isStructuralParam(info.node.type, b.parameter)) {
    err(ctx, 'INVALID_VALUE', `${p}.parameter`, `${quote(b.parameter)} is a structural ${quote(info.node.type)} reference and cannot be bound.`, b.nodeId);
    return;
  }
  if (info.spec) {
    let ok = drivableParams(info.node.type, info.spec).some(s => s.id === b.parameter);
    if (!ok && isGroup && isPlainObject(info.node.params)) {
      const child = info.node.params[GROUP_GRAPH_PARAM];
      ok = isId(child) && (ctx.scopedControls.get(child)?.has(b.parameter as string) ?? false);
    }
    if (!ok) { err(ctx, 'MISSING_REFERENCE', `${p}.parameter`, `Node ${quote(b.nodeId)} has no parameter ${quote(b.parameter)}.`, b.nodeId); return; }
  }
  // A whole-parameter binding owns every axis; an axis binding owns one component.
  const base = `${b.nodeId}\u0000${b.parameter}`;
  const own = hasOwn(b, 'axis') ? `${base}\u0000${b.axis}` : base;
  const clashes = hasOwn(b, 'axis') ? [base, own] : [base, ...[0, 1, 2].map(a => `${base}\u0000${a}`)];
  const first = clashes.map(k => targets.get(k)).find(v => v !== undefined);
  if (first !== undefined) err(ctx, 'MULTIPLE_DRIVERS', p, `Parameter ${quote(b.parameter)} of node ${quote(b.nodeId)} is already bound at ${first}; a target has one control owner.`, b.nodeId);
  else targets.set(own, p);
}

// ---------- editor layout ----------

function checkEditor(ctx: Ctx, v: unknown) {
  if (!shape(ctx, 'editor', v, ['graphs', 'openedGraphId'], [], 'editor layout')) return;
  if (idField(ctx, 'editor.openedGraphId', v.openedGraphId) && !ctx.graphs.has(v.openedGraphId)) {
    err(ctx, 'MISSING_REFERENCE', 'editor.openedGraphId', `Opened graph ${quote(v.openedGraphId)} does not exist.`);
  }
  if (!isPlainObject(v.graphs)) { err(ctx, 'TYPE_MISMATCH', 'editor.graphs', 'Expected layout per graph.'); return; }
  const keys = Object.keys(v.graphs);
  if (keys.length > MAX_GRAPHS) { err(ctx, 'IMPORT_LIMIT', 'editor.graphs', `Too many graph layouts (limit ${MAX_GRAPHS}).`); return; }
  for (const graphId of keys) {
    const gp = join('editor.graphs', graphId);
    if (!ctx.graphs.has(graphId)) { err(ctx, 'MISSING_REFERENCE', gp, `Layout graph ${quote(graphId)} does not exist.`); continue; }
    const layout = v.graphs[graphId];
    if (!shape(ctx, gp, layout, ['nodes', 'viewport'], [], 'graph layout')) continue;
    const vp = `${gp}.viewport`;
    if (shape(ctx, vp, layout.viewport, ['x', 'y', 'zoom'], [], 'viewport')) {
      const view = layout.viewport as Obj;
      for (const k of ['x', 'y']) if (!isFiniteNumber(view[k])) err(ctx, 'INVALID_VALUE', `${vp}.${k}`, `${k} must be a finite number.`);
      if (!isFiniteNumber(view.zoom) || view.zoom < MIN_LAYOUT_ZOOM || view.zoom > MAX_LAYOUT_ZOOM) {
        err(ctx, 'INVALID_VALUE', `${vp}.zoom`, `Zoom must be in [${MIN_LAYOUT_ZOOM},${MAX_LAYOUT_ZOOM}].`);
      }
    }
    const np = `${gp}.nodes`;
    if (!isPlainObject(layout.nodes)) { err(ctx, 'TYPE_MISMATCH', np, 'Expected node positions.'); continue; }
    const nodeKeys = Object.keys(layout.nodes);
    if (nodeKeys.length > MAX_STORED_NODES) { err(ctx, 'IMPORT_LIMIT', np, `Too many node positions (limit ${MAX_STORED_NODES}).`); continue; }
    for (const nodeId of nodeKeys) {
      const pp = join(np, nodeId);
      if (ctx.nodes.get(nodeId)?.graphId !== graphId) { err(ctx, 'MISSING_REFERENCE', pp, `Layout node ${quote(nodeId)} is not in graph ${quote(graphId)}.`); continue; }
      const pt = layout.nodes[nodeId];
      if (!shape(ctx, pp, pt, ['x', 'y'], [], 'position')) continue;
      for (const k of ['x', 'y']) if (!isFiniteNumber((pt as Obj)[k])) err(ctx, 'INVALID_VALUE', `${pp}.${k}`, `${k} must be a finite number.`);
    }
  }
}
