// Local draft persistence (13-PERSISTENCE, first slice): the editor's current document is mirrored to
// browser storage and restored on the next visit; Save/Open exchange plain document JSON files.
// Deviation noted in 27-GAP-AUDIT: localStorage instead of IndexedDB, one draft slot, no asset bytes.
import type { EffectDocumentV2 } from './types.ts';

export const DRAFT_KEY = 'vfx-studio.v2.draft';

/** Minimal Storage surface (localStorage in the browser, a Map-backed fake in tests). */
export type DraftStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type DraftSaveResult = { ok: true; bytes: number; revision: number } | { ok: false; message: string; conflict?: true };

/**
 * 13 "Two tabs editing one document": the draft carries a revision counter and the tab that wrote it. A tab
 * saves only if the stored revision is still the one it loaded or last wrote (compare-and-swap); otherwise it
 * is stale and must reload or keep its version as a copy — it never overwrites the other tab's work.
 */
export const DRAFT_META_KEY = 'vfx-studio.v2.draft-meta';
export type DraftMeta = { revision: number; tabId: string };
export type DraftGuard = { tabId: string; baseRevision: number };

export function readDraftMeta(storage: DraftStorage | undefined): DraftMeta {
  try {
    const m = storage ? JSON.parse(storage.getItem(DRAFT_META_KEY) ?? 'null') : null;
    return m && Number.isInteger(m.revision) && typeof m.tabId === 'string' ? m : { revision: 0, tabId: '' };
  } catch { return { revision: 0, tabId: '' }; }
}

export const REVISIONS_KEY = 'vfx-studio.v2.draft-revisions';
export const CORRUPT_KEY = 'vfx-studio.v2.draft-corrupt';
/** 13: five prior revisions are kept besides the latest draft; at most one new revision per interval so slider drags do not flood it. */
export const MAX_REVISIONS = 5, REVISION_INTERVAL_MS = 20_000;
export type DraftRevision = { savedAt: string; text: string };

export function readRevisions(storage: DraftStorage | undefined): DraftRevision[] {
  try {
    const raw = storage ? JSON.parse(storage.getItem(REVISIONS_KEY) ?? '[]') : [];
    return Array.isArray(raw) ? raw.filter((r): r is DraftRevision => !!r && typeof r.savedAt === 'string' && typeof r.text === 'string').slice(0, MAX_REVISIONS) : [];
  } catch { return []; }
}

export function saveDraft(storage: DraftStorage, doc: EffectDocumentV2, now = new Date(), guard?: DraftGuard): DraftSaveResult {
  try {
    const meta = readDraftMeta(storage);
    if (guard && meta.revision !== guard.baseRevision && meta.tabId !== guard.tabId) {
      return { ok: false, conflict: true, message: 'This effect was changed in another tab; this tab will not overwrite it.' };
    }
    const text = JSON.stringify(doc);
    let previous: string | null = null;
    try { previous = storage.getItem(DRAFT_KEY); } catch { /* unreadable storage: no revision */ }
    if (previous === text) return { ok: true, bytes: text.length, revision: meta.revision }; // Unchanged: no new revision, other tabs stay current.
    storage.setItem(DRAFT_KEY, text);
    // The draft being replaced becomes a revision (newest first) unless the last revision is recent.
    const revs = readRevisions(storage);
    if (previous && previous !== text && (!revs.length || now.getTime() - Date.parse(revs[0].savedAt) >= REVISION_INTERVAL_MS)) {
      try { storage.setItem(REVISIONS_KEY, JSON.stringify([{ savedAt: now.toISOString(), text: previous }, ...revs].slice(0, MAX_REVISIONS))); } catch { /* quota: the latest draft is already saved */ }
    }
    const revision = meta.revision + 1;
    storage.setItem(DRAFT_META_KEY, JSON.stringify({ revision, tabId: guard?.tabId ?? '' }));
    return { ok: true, bytes: text.length, revision };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Raw draft JSON text, or null when absent or storage is unavailable. The caller validates it. */
export function loadDraftText(storage: DraftStorage | undefined): string | null {
  try { return storage ? storage.getItem(DRAFT_KEY) : null; } catch { return null; }
}

/** File name for a downloaded document: the effect name, filesystem-safe, with .vfx.json. */
export function documentFileName(doc: EffectDocumentV2): string {
  return `${(doc.name || 'effect').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'effect'}.vfx.json`;
}

// Project shelf (13-PERSISTENCE, second slice): up to MAX_SHELF named documents kept in browser storage,
// so several effects survive side by side. Same-name saves replace; entries are newest first.
export const SHELF_KEY = 'vfx-studio.v2.projects';
export const MAX_SHELF = 50;
export type ShelfEntry = { name: string; savedAt: string; text: string };

export function readShelf(storage: DraftStorage | undefined): ShelfEntry[] {
  try {
    const raw = storage ? JSON.parse(storage.getItem(SHELF_KEY) ?? '[]') : [];
    return Array.isArray(raw) ? raw.filter((e): e is ShelfEntry => !!e && typeof e.name === 'string' && typeof e.savedAt === 'string' && typeof e.text === 'string').slice(0, MAX_SHELF) : [];
  } catch { return []; }
}

export function saveToShelf(storage: DraftStorage, doc: EffectDocumentV2, now = new Date()): { ok: true; entries: ShelfEntry[] } | { ok: false; message: string } {
  const name = (doc.name || 'effect').trim() || 'effect';
  const rest = readShelf(storage).filter(e => e.name !== name);
  if (rest.length >= MAX_SHELF) return { ok: false, message: `The project shelf is full (${MAX_SHELF}). Remove a project or download JSON instead.` };
  const entries = [{ name, savedAt: now.toISOString(), text: JSON.stringify(doc) }, ...rest];
  try { storage.setItem(SHELF_KEY, JSON.stringify(entries)); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
  return { ok: true, entries };
}

/** Removing a project moves it to the trash (13 "Delete project moves it to a local trash record"). */
export function removeFromShelf(storage: DraftStorage, name: string, now = new Date()): ShelfEntry[] {
  const all = readShelf(storage), gone = all.find(e => e.name === name);
  const entries = all.filter(e => e.name !== name);
  try {
    storage.setItem(SHELF_KEY, JSON.stringify(entries));
    if (gone) storage.setItem(TRASH_KEY, JSON.stringify([{ ...gone, removedAt: now.toISOString() }, ...readTrash(storage).filter(t => t.name !== name)].slice(0, MAX_SHELF)));
  } catch { /* storage unavailable: the in-memory list still updates */ }
  return entries;
}

export const TRASH_KEY = 'vfx-studio.v2.trash';
export type TrashEntry = ShelfEntry & { removedAt: string };

export function readTrash(storage: DraftStorage | undefined): TrashEntry[] {
  try {
    const raw = storage ? JSON.parse(storage.getItem(TRASH_KEY) ?? '[]') : [];
    return Array.isArray(raw) ? raw.filter((e): e is TrashEntry => !!e && typeof e.name === 'string' && typeof e.text === 'string' && typeof e.removedAt === 'string') : [];
  } catch { return []; }
}

/** Puts a trashed project back on the shelf (replacing a same-name project is refused, never silent). */
export function restoreFromTrash(storage: DraftStorage, name: string): { ok: true; shelf: ShelfEntry[]; trash: TrashEntry[] } | { ok: false; message: string } {
  const trash = readTrash(storage), item = trash.find(t => t.name === name);
  if (!item) return { ok: false, message: `"${name}" is not in the trash.` };
  const shelf = readShelf(storage);
  if (shelf.some(e => e.name === name)) return { ok: false, message: `A project named "${name}" already exists; rename or remove it first.` };
  if (shelf.length >= MAX_SHELF) return { ok: false, message: `The project shelf is full (${MAX_SHELF}).` };
  const { removedAt: _removed, ...entry } = item;
  const nextShelf = [entry, ...shelf], nextTrash = trash.filter(t => t.name !== name);
  try { storage.setItem(SHELF_KEY, JSON.stringify(nextShelf)); storage.setItem(TRASH_KEY, JSON.stringify(nextTrash)); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
  return { ok: true, shelf: nextShelf, trash: nextTrash };
}

/** Empty trash: the explicit, final removal. */
export function emptyTrash(storage: DraftStorage): void {
  try { storage.setItem(TRASH_KEY, '[]'); } catch { /* storage unavailable */ }
}

/**
 * Recovery (13): the latest draft if it validates, otherwise the newest revision that does. The unreadable
 * latest draft is copied to CORRUPT_KEY (never overwritten with an empty graph) so it can be inspected.
 */
export function recoverDraft<T>(storage: DraftStorage | undefined, parse: (text: string) => T | null): { value: T; recoveredFrom?: string } | null {
  const latest = loadDraftText(storage);
  if (latest) { const v = parse(latest); if (v) return { value: v }; }
  for (const r of readRevisions(storage)) {
    const v = parse(r.text);
    if (v) {
      if (latest && storage) { try { storage.setItem(CORRUPT_KEY, latest); } catch { /* best effort */ } }
      return { value: v, recoveredFrom: r.savedAt };
    }
  }
  return null;
}

/** Merges two stored shelf/trash lists (JSON) by name; the newer copy of a name wins; newest first. */
export function mergeEntryLists(a: string, b: string): string {
  const parse = (t: string): ShelfEntry[] => { try { const v = JSON.parse(t); return Array.isArray(v) ? v.filter(e => e && typeof e.name === 'string' && typeof e.savedAt === 'string') : []; } catch { return []; } };
  const byName = new Map<string, ShelfEntry>();
  for (const e of [...parse(a), ...parse(b)]) { const old = byName.get(e.name); if (!old || Date.parse(e.savedAt) > Date.parse(old.savedAt)) byName.set(e.name, e); }
  return JSON.stringify([...byName.values()].sort((x, y) => Date.parse(y.savedAt) - Date.parse(x.savedAt)).slice(0, MAX_SHELF));
}
