// Canonical semantic serialization and SHA-256 hashing (04 "Assets and UI data",
// WP01-REPRESENTATION-DECISIONS.md). Excludes editor layout, sorts object keys, unordered
// definitions by ID and root tags by code unit; preserves all other arrays. Edges sort by order
// then edge ID. Invalid input throws CanonicalError; nothing is dropped, coerced or mutated.
import { DEFAULT_EDGE_MIX, MAX_JSON_DEPTH, type EdgeDefinition, type EffectDocumentV2, type GraphDefinition } from './types.ts';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_PATH_IN_MESSAGE = 200;

/** Appends a property key to a field path: `.key` for identifiers, `["key"]` otherwise. */
export const pathKey = (path: string, key: string) =>
  IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const boundedPath = (path: string) =>
  path.length > MAX_PATH_IN_MESSAGE ? `${path.slice(0, MAX_PATH_IN_MESSAGE)}…` : path;

export class CanonicalError extends Error {
  readonly fieldPath: string;
  constructor(fieldPath: string, reason: string) {
    const p = boundedPath(fieldPath);
    super(`Cannot serialize ${reason} at ${p}.`);
    this.name = 'CanonicalError';
    this.fieldPath = fieldPath;
  }
}

const codeUnitCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byId = <T extends { id: string }>(a: T, b: T) => codeUnitCompare(a.id, b.id);
const byEdgeOrder = (a: EdgeDefinition, b: EdgeDefinition) => a.order - b.order || byId(a, b);

/** Exactly {gain:1, pan:0} (pan -0 included); any other shape or value is kept as authored. */
const isDefaultMix = (m: unknown) =>
  isRecord(m) && Object.keys(m).length === 2 &&
  m.gain === DEFAULT_EDGE_MIX.gain && m.pan === DEFAULT_EDGE_MIX.pan;

/** Absent and default mix serialize identically (WP04-AUDIO-MIX-CONTRACT.md §4). Returns a copy; never mutates. */
function withoutDefaultMix(e: EdgeDefinition): EdgeDefinition {
  if (!Object.prototype.hasOwnProperty.call(e, 'mix') || !isDefaultMix(e.mix)) return e;
  const { mix: _mix, ...rest } = e;
  return rest;
}

/**
 * Semantic projection: no editor layout, unordered lists sorted. Private; precondition is that the
 * input passed canonicalJson and checkProjectionShape. Duplicate IDs and whole-document shape are
 * WP01b validation preconditions (a stable sort keeps duplicates in input order).
 */
function semanticProjection(doc: EffectDocumentV2): Omit<EffectDocumentV2, 'editor'> {
  const { editor: _editor, ...rest } = doc;
  const graph = (g: GraphDefinition): GraphDefinition => ({
    ...g,
    nodes: [...g.nodes].sort(byId),
    edges: g.edges.map(withoutDefaultMix).sort(byEdgeOrder),
  });
  return {
    ...rest,
    tags: [...doc.tags].sort(codeUnitCompare),
    anchors: [...doc.anchors].sort(byId),
    graphs: doc.graphs.map(graph).sort(byId),
    controls: [...doc.controls].sort(byId),
    assets: [...doc.assets].sort(byId),
  };
}

/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit, no whitespace, -0 written as 0.
 * Accepts only plain JSON (Object.prototype or null-prototype records, dense ordinary arrays).
 * Rejects undefined, non-finite numbers, functions, symbols, bigint, sparse arrays, cycles,
 * accessors, symbol/non-enumerable members and exotic objects. Never invokes getters or toJSON.
 */
export function canonicalJson(value: unknown, path = '$'): string {
  return write(value, path, new Set(), 0);
}

function ownValue(obj: object, key: string, path: string): unknown {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (!d) throw new CanonicalError(path, 'a missing element (sparse array)');
  if (!('value' in d)) throw new CanonicalError(path, 'an accessor property');
  if (!d.enumerable) throw new CanonicalError(path, 'a non-enumerable property');
  return d.value;
}

function write(v: unknown, path: string, stack: Set<object>, depth: number): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean': return v ? 'true' : 'false';
    case 'string': return JSON.stringify(v);
    case 'number':
      if (!Number.isFinite(v)) throw new CanonicalError(path, 'a non-finite number');
      return Object.is(v, -0) ? '0' : JSON.stringify(v);
    case 'object': {
      if (depth >= MAX_JSON_DEPTH) throw new CanonicalError(path, `nesting deeper than ${MAX_JSON_DEPTH}`);
      if (stack.has(v)) throw new CanonicalError(path, 'a cyclic reference');
      const proto = Object.getPrototypeOf(v);
      const keys = Reflect.ownKeys(v);
      if (keys.some(k => typeof k === 'symbol')) throw new CanonicalError(path, 'a symbol-keyed member');
      stack.add(v);
      let out: string;
      if (Array.isArray(v)) {
        if (proto !== Array.prototype) throw new CanonicalError(path, 'an exotic array');
        const len = v.length;
        if (keys.length !== len + 1) {
          // Extra named members or holes: find the first hole for an exact path.
          for (let i = 0; i < len; i++) ownValue(v, String(i), `${path}[${i}]`);
          throw new CanonicalError(path, 'an array with non-index members');
        }
        const parts: string[] = [];
        for (let i = 0; i < len; i++) {
          const p = `${path}[${i}]`;
          parts.push(write(ownValue(v, String(i), p), p, stack, depth + 1));
        }
        out = `[${parts.join(',')}]`;
      } else {
        if (proto !== Object.prototype && proto !== null) throw new CanonicalError(path, 'a non-plain object');
        const parts: string[] = [];
        for (const k of (keys as string[]).sort(codeUnitCompare)) {
          const p = pathKey(path, k);
          const x = ownValue(v, k, p);
          if (x === undefined) throw new CanonicalError(p, 'undefined');
          parts.push(`${JSON.stringify(k)}:${write(x, p, stack, depth + 1)}`);
        }
        out = `{${parts.join(',')}}`;
      }
      stack.delete(v);
      return out;
    }
    default:
      throw new CanonicalError(path, typeof v);
  }
}

export function canonicalSemanticJson(doc: EffectDocumentV2): string {
  // Validate the whole input first so projection never touches accessors or exotic members.
  canonicalJson(doc);
  checkProjectionShape(doc);
  return canonicalJson(semanticProjection(doc));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function checkArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new CanonicalError(path, 'a non-array list');
  return v;
}

/** Requires an array of plain objects with string IDs (the byId sort precondition). */
function checkIdList(v: unknown, path: string): Record<string, unknown>[] {
  const list = checkArray(v, path);
  list.forEach((x, i) => {
    if (!isRecord(x)) throw new CanonicalError(`${path}[${i}]`, 'a non-object list entry');
    if (typeof x.id !== 'string') throw new CanonicalError(`${path}[${i}].id`, 'a non-string ID');
  });
  return list as Record<string, unknown>[];
}

/**
 * Rejects shapes the projection sorts depend on (not a whole-document validator), so malformed
 * values never collide with valid ones and edge order never depends on input order.
 */
function checkProjectionShape(doc: EffectDocumentV2) {
  const root: unknown = doc;
  if (!isRecord(root)) throw new CanonicalError('$', 'a non-object document');
  checkArray(root.tags, '$.tags').forEach((t, i) => {
    if (typeof t !== 'string') throw new CanonicalError(`$.tags[${i}]`, 'a non-string tag');
  });
  checkIdList(root.anchors, '$.anchors');
  checkIdList(root.controls, '$.controls');
  checkIdList(root.assets, '$.assets');
  checkIdList(root.graphs, '$.graphs').forEach((g, gi) => {
    checkIdList(g.nodes, `$.graphs[${gi}].nodes`);
    const edges = checkArray(g.edges, `$.graphs[${gi}].edges`);
    edges.forEach((e, ei) => {
      if (!isRecord(e)) throw new CanonicalError(`$.graphs[${gi}].edges[${ei}]`, 'a non-object edge');
      if (!Number.isSafeInteger(e?.order)) {
        throw new CanonicalError(`$.graphs[${gi}].edges[${ei}].order`, 'a non-integer edge order');
      }
      if (typeof e.id !== 'string') throw new CanonicalError(`$.graphs[${gi}].edges[${ei}].id`, 'a non-string edge ID');
    });
  });
}

/** Platform-neutral digest adapter: returns the 32-byte SHA-256 of the input. */
export type Sha256 = (data: Uint8Array) => Promise<Uint8Array>;

/** Web Crypto adapter (browsers, workers and Node ≥19 expose globalThis.crypto.subtle). */
export const webCryptoSha256: Sha256 = async data => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable; inject a Sha256 adapter.');
  // Owned ArrayBuffer copy: the input view may be backed by a SharedArrayBuffer.
  const owned = new ArrayBuffer(data.byteLength);
  new Uint8Array(owned).set(data);
  return new Uint8Array(await subtle.digest('SHA-256', owned));
};

const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string, sha256: Sha256 = webCryptoSha256): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(text));
  if (!(digest instanceof Uint8Array) || digest.length !== 32) {
    throw new Error('SHA-256 adapter must return exactly 32 bytes.');
  }
  return toHex(digest);
}

/** Lowercase hex SHA-256 over UTF-8 canonical semantic JSON. */
export async function semanticHash(doc: EffectDocumentV2, sha256: Sha256 = webCryptoSha256): Promise<string> {
  return sha256Hex(canonicalSemanticJson(doc), sha256);
}
