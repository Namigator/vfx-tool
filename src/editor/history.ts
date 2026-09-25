// Pure transactional authored-document history (12-EDITOR "Commands, history and dirty state").
// Edits are explicit JSON patches grouped in transactions with required IDs; history keeps
// forward and inverse patches only, never full document snapshots. Bounded to 100 transactions
// and 20 MiB of retained patch data (UTF-8 bytes of the patch JSON); oldest undo entries are
// evicted first. Paths under `editor` (EditorLayout) are layout-only; everything else is semantic.
// No DOM, React or Three dependencies. Dirty/save state is intentionally out of scope.
import { canonicalJson, CanonicalError } from '../model/canonical.ts';
import type { EffectDocumentV2 } from '../model/types.ts';

export type PatchPath = (string | number)[];
export type Patch =
  /** Replace an existing object key or array element, or add an owned object key. */
  | { op: 'set'; path: PatchPath; value: unknown }
  /** Remove an existing owned object key. Arrays use splice. */
  | { op: 'delete'; path: PatchPath }
  /** Array insertion/removal at `path` (the array itself). */
  | { op: 'splice'; path: PatchPath; index: number; deleteCount: number; insert: unknown[] };

export const MAX_HISTORY_TRANSACTIONS = 100;
export const MAX_HISTORY_BYTES = 20 * 1024 * 1024;

export type HistoryErrorCode =
  | 'NO_TRANSACTION' | 'TRANSACTION_ACTIVE' | 'INVALID_TRANSACTION_ID'
  | 'INVALID_PATCH' | 'INVALID_PATH' | 'UNSAFE_PATH' | 'TYPE_MISMATCH' | 'INVALID_INDEX'
  | 'MISSING_KEY' | 'UNSAFE_VALUE' | 'NOTHING_TO_UNDO' | 'NOTHING_TO_REDO';

export type ChangeKind = { changed: boolean; semanticChanged: boolean; layoutChanged: boolean };

export type HistoryNotice =
  | { code: 'HISTORY_CLEARED_OVERSIZED'; message: string; bytes: number }
  | { code: 'HISTORY_EVICTED'; message: string; evicted: number };

export type HistoryResult =
  | ({ ok: true; notices: HistoryNotice[] } & ChangeKind)
  | { ok: false; code: HistoryErrorCode; message: string; patchIndex?: number };

type Entry = {
  id: string; label: string;
  forward: Patch[]; inverse: Patch[];
  bytes: number; semantic: boolean; layout: boolean;
};

type Active = {
  id: string; label: string;
  forward: Patch[]; inverse: Patch[];
  semanticBefore: string; layoutBefore: string;
};

type Container = Record<string, unknown> | unknown[];

class PatchError extends Error {
  readonly code: HistoryErrorCode;
  constructor(code: HistoryErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const pathText = (p: PatchPath) => JSON.stringify(p);

/** Validates plain JSON (via canonicalJson; no getters run) and returns an owned deep clone. */
function cloneJson<T>(value: T, where: string): T {
  try {
    canonicalJson(value);
  } catch (e) {
    if (e instanceof CanonicalError) throw new PatchError('UNSAFE_VALUE', `${where}: ${e.message}`);
    throw e;
  }
  return copy(value) as T;
}

function copy(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(copy);
  if (isRecord(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      if (UNSAFE_KEYS.has(k)) throw new PatchError('UNSAFE_VALUE', `Unsafe key ${JSON.stringify(k)} in value.`);
      out[k] = copy(v[k]);
    }
    return out;
  }
  return v;
}

/** Checks shape and returns an owned copy of a caller patch. */
function ownPatch(p: unknown): Patch {
  if (!isRecord(p)) throw new PatchError('INVALID_PATCH', 'Patch must be an object.');
  const path = p.path;
  if (!Array.isArray(path) || path.length === 0) throw new PatchError('INVALID_PATH', 'Path must be a non-empty array.');
  const own: PatchPath = [];
  for (let i = 0; i < path.length; i++) {
    const k: unknown = path[i];
    if (typeof k === 'string') {
      if (UNSAFE_KEYS.has(k)) throw new PatchError('UNSAFE_PATH', `Unsafe path key ${JSON.stringify(k)}.`);
      own.push(k);
    } else if (isIndex(k)) own.push(k);
    else throw new PatchError('INVALID_PATH', `Path segment ${i} must be a string or non-negative integer.`);
  }
  switch (p.op) {
    case 'set':
      if (!hasOwn(p, 'value')) throw new PatchError('INVALID_PATCH', 'set requires a value.');
      return { op: 'set', path: own, value: cloneJson(p.value, 'set value') };
    case 'delete':
      return { op: 'delete', path: own };
    case 'splice':
      if (!isIndex(p.index) || !isIndex(p.deleteCount)) {
        throw new PatchError('INVALID_INDEX', 'splice index and deleteCount must be non-negative integers.');
      }
      if (!Array.isArray(p.insert)) throw new PatchError('INVALID_PATCH', 'splice insert must be an array.');
      return { op: 'splice', path: own, index: p.index, deleteCount: p.deleteCount, insert: cloneJson(p.insert, 'splice insert') };
    default:
      throw new PatchError('INVALID_PATCH', `Unknown patch op ${JSON.stringify(p.op)}.`);
  }
}

function resolve(doc: unknown, path: PatchPath, upTo: number): unknown {
  let cur = doc;
  for (let i = 0; i < upTo; i++) {
    const k = path[i];
    if (Array.isArray(cur)) {
      if (typeof k !== 'number' || k >= cur.length) throw new PatchError('INVALID_INDEX', `No array element at ${pathText(path.slice(0, i + 1))}.`);
      cur = cur[k];
    } else if (isRecord(cur)) {
      if (typeof k !== 'string') throw new PatchError('TYPE_MISMATCH', `Numeric key on object at ${pathText(path.slice(0, i + 1))}.`);
      if (!hasOwn(cur, k)) throw new PatchError('MISSING_KEY', `Missing key at ${pathText(path.slice(0, i + 1))}.`);
      cur = cur[k];
    } else {
      throw new PatchError('TYPE_MISMATCH', `Cannot descend into a scalar at ${pathText(path.slice(0, i))}.`);
    }
  }
  return cur;
}

/** Applies one owned patch in place and returns its inverse. Throws before mutating on error. */
function applyOne(doc: Container, patch: Patch): Patch {
  const { path } = patch;
  if (patch.op === 'splice') {
    const arr = resolve(doc, path, path.length);
    if (!Array.isArray(arr)) throw new PatchError('TYPE_MISMATCH', `splice target ${pathText(path)} is not an array.`);
    if (patch.index > arr.length || patch.deleteCount > arr.length - patch.index) {
      throw new PatchError('INVALID_INDEX', `splice range out of bounds at ${pathText(path)}.`);
    }
    const removed = arr.splice(patch.index, patch.deleteCount, ...(copy(patch.insert) as unknown[]));
    return { op: 'splice', path: [...path], index: patch.index, deleteCount: patch.insert.length, insert: removed };
  }
  const parent = resolve(doc, path, path.length - 1);
  const key = path[path.length - 1];
  if (Array.isArray(parent)) {
    if (patch.op === 'delete') throw new PatchError('TYPE_MISMATCH', `Use splice to remove array elements at ${pathText(path)}.`);
    if (typeof key !== 'number' || key >= parent.length) {
      throw new PatchError('INVALID_INDEX', `set may only replace existing elements at ${pathText(path)}; use splice to insert.`);
    }
    const old = parent[key];
    parent[key] = copy(patch.value);
    return { op: 'set', path: [...path], value: old };
  }
  if (!isRecord(parent)) throw new PatchError('TYPE_MISMATCH', `Parent of ${pathText(path)} is not a container.`);
  if (typeof key !== 'string') throw new PatchError('TYPE_MISMATCH', `Numeric key on object at ${pathText(path)}.`);
  const existed = hasOwn(parent, key);
  if (patch.op === 'delete') {
    if (!existed) throw new PatchError('MISSING_KEY', `Cannot delete missing key at ${pathText(path)}.`);
    const old = parent[key];
    delete parent[key];
    return { op: 'set', path: [...path], value: old };
  }
  const old = parent[key];
  // defineProperty creates an owned data key even for names shadowing Object.prototype members.
  Object.defineProperty(parent, key, { value: copy(patch.value), writable: true, enumerable: true, configurable: true });
  return existed ? { op: 'set', path: [...path], value: old } : { op: 'delete', path: [...path] };
}

/** Applies all patches or none; returns inverses in application order. */
function applyBatch(doc: Container, patches: readonly Patch[]): Patch[] {
  const inverses: Patch[] = [];
  let i = 0;
  try {
    for (; i < patches.length; i++) inverses.push(applyOne(doc, patches[i]));
  } catch (e) {
    for (let j = inverses.length - 1; j >= 0; j--) applyOne(doc, inverses[j]);
    if (e instanceof PatchError) (e as PatchError & { patchIndex?: number }).patchIndex = i;
    throw e;
  }
  return inverses;
}

const isLayout = (p: Patch) => p.path[0] === 'editor';
const kindOf = (patches: readonly Patch[]): ChangeKind => {
  const layout = patches.some(isLayout);
  const semantic = patches.some(p => !isLayout(p));
  return { changed: layout || semantic, semanticChanged: semantic, layoutChanged: layout };
};
const noChange: ChangeKind = { changed: false, semanticChanged: false, layoutChanged: false };

function splitCanonical(doc: EffectDocumentV2): { semantic: string; layout: string } {
  const { editor, ...rest } = doc;
  return { semantic: canonicalJson(rest), layout: canonicalJson(editor ?? null) };
}

const fail = (code: HistoryErrorCode, message: string, patchIndex?: number): HistoryResult =>
  patchIndex === undefined ? { ok: false, code, message } : { ok: false, code, message, patchIndex };

export class DocumentHistory {
  #doc: EffectDocumentV2;
  #undo: Entry[] = [];
  #redo: Entry[] = [];
  #bytes = 0;
  #active: Active | null = null;

  constructor(initialDocument: EffectDocumentV2) {
    try {
      this.#doc = cloneJson(initialDocument, 'initial document');
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e));
    }
    if (!isRecord(this.#doc)) throw new Error('Initial document must be a JSON object.');
  }

  /** Owned deep clone of the current document (including uncommitted transaction edits). */
  snapshot(): EffectDocumentV2 {
    return copy(this.#doc) as EffectDocumentV2;
  }

  get activeTransactionId(): string | null { return this.#active?.id ?? null; }
  canUndo(): boolean { return this.#active === null && this.#undo.length > 0; }
  canRedo(): boolean { return this.#active === null && this.#redo.length > 0; }
  /** Retained patch data in UTF-8 bytes, and undo/redo depth (for diagnostics and tests). */
  stats(): { undo: number; redo: number; bytes: number } {
    return { undo: this.#undo.length, redo: this.#redo.length, bytes: this.#bytes };
  }

  begin(transactionId: string, label: string): HistoryResult {
    if (this.#active) return fail('TRANSACTION_ACTIVE', `Transaction ${JSON.stringify(this.#active.id)} is still active.`);
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      return fail('INVALID_TRANSACTION_ID', 'A non-empty transaction ID is required.');
    }
    const before = splitCanonical(this.#doc);
    this.#active = {
      id: transactionId, label: typeof label === 'string' ? label : '',
      forward: [], inverse: [], semanticBefore: before.semantic, layoutBefore: before.layout,
    };
    return { ok: true, notices: [], ...noChange };
  }

  /** Applies a batch atomically inside the active transaction. */
  apply(patches: readonly Patch[]): HistoryResult {
    const tx = this.#active;
    if (!tx) return fail('NO_TRANSACTION', 'apply requires an active transaction.');
    if (!Array.isArray(patches)) return fail('INVALID_PATCH', 'patches must be an array.');
    const owned: Patch[] = [];
    try {
      for (let i = 0; i < patches.length; i++) {
        try { owned.push(ownPatch(patches[i])); } catch (e) {
          if (e instanceof PatchError) return fail(e.code, e.message, i);
          throw e;
        }
      }
      const inverses = applyBatch(this.#doc as unknown as Container, owned);
      tx.forward.push(...owned);
      tx.inverse.push(...inverses);
    } catch (e) {
      if (e instanceof PatchError) return fail(e.code, e.message, (e as PatchError & { patchIndex?: number }).patchIndex);
      throw e;
    }
    return { ok: true, notices: [], ...kindOf(owned) };
  }

  /** Restores the document to its state at begin(); history and redo are untouched. */
  cancel(): HistoryResult {
    const tx = this.#active;
    if (!tx) return fail('NO_TRANSACTION', 'No active transaction to cancel.');
    for (let j = tx.inverse.length - 1; j >= 0; j--) applyOne(this.#doc as unknown as Container, tx.inverse[j]);
    this.#active = null;
    return { ok: true, notices: [], ...kindOf(tx.forward) };
  }

  commit(): HistoryResult {
    const tx = this.#active;
    if (!tx) return fail('NO_TRANSACTION', 'No active transaction to commit.');
    this.#active = null;
    const after = splitCanonical(this.#doc);
    const semantic = after.semantic !== tx.semanticBefore;
    const layout = after.layout !== tx.layoutBefore;
    // Net no-op: nothing recorded and redo preserved.
    if (!semantic && !layout) return { ok: true, notices: [], ...noChange };

    const inverse = tx.inverse.slice().reverse();
    const bytes = new TextEncoder().encode(JSON.stringify([tx.forward, inverse])).byteLength;
    // #bytes counts undo and redo entries; a real edit discards redo.
    for (const r of this.#redo) this.#bytes -= r.bytes;
    this.#redo = [];
    const notices: HistoryNotice[] = [];
    const kind: ChangeKind = { changed: true, semanticChanged: semantic, layoutChanged: layout };
    if (bytes > MAX_HISTORY_BYTES) {
      this.#undo = [];
      this.#bytes = 0;
      notices.push({
        code: 'HISTORY_CLEARED_OVERSIZED', bytes,
        message: `"${tx.label}" was applied but exceeds the ${MAX_HISTORY_BYTES}-byte history limit; undo history was cleared and it cannot be undone.`,
      });
      return { ok: true, notices, ...kind };
    }
    this.#undo.push({ id: tx.id, label: tx.label, forward: tx.forward, inverse, bytes, semantic, layout });
    this.#bytes += bytes;
    let evicted = 0;
    while (this.#undo.length > MAX_HISTORY_TRANSACTIONS || this.#bytes > MAX_HISTORY_BYTES) {
      this.#bytes -= this.#undo.shift()!.bytes;
      evicted++;
    }
    if (evicted > 0) notices.push({ code: 'HISTORY_EVICTED', evicted, message: `${evicted} oldest undo step(s) were discarded.` });
    return { ok: true, notices, ...kind };
  }

  undo(): HistoryResult {
    if (this.#active) return fail('TRANSACTION_ACTIVE', 'Finish or cancel the active transaction before undo.');
    const entry = this.#undo.pop();
    if (!entry) return fail('NOTHING_TO_UNDO', 'Nothing to undo.');
    applyBatch(this.#doc as unknown as Container, entry.inverse);
    this.#redo.push(entry);
    return { ok: true, notices: [], changed: true, semanticChanged: entry.semantic, layoutChanged: entry.layout };
  }

  redo(): HistoryResult {
    if (this.#active) return fail('TRANSACTION_ACTIVE', 'Finish or cancel the active transaction before redo.');
    const entry = this.#redo.pop();
    if (!entry) return fail('NOTHING_TO_REDO', 'Nothing to redo.');
    applyBatch(this.#doc as unknown as Container, entry.forward);
    this.#undo.push(entry);
    return { ok: true, notices: [], changed: true, semanticChanged: entry.semantic, layoutChanged: entry.layout };
  }
}
