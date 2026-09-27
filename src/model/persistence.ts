// Local draft persistence (13-PERSISTENCE, first slice): the editor's current document is mirrored to
// browser storage and restored on the next visit; Save/Open exchange plain document JSON files.
// Deviation noted in 27-GAP-AUDIT: localStorage instead of IndexedDB, one draft slot, no asset bytes.
import type { EffectDocumentV2 } from './types.ts';

export const DRAFT_KEY = 'vfx-studio.v2.draft';

/** Minimal Storage surface (localStorage in the browser, a Map-backed fake in tests). */
export type DraftStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type DraftSaveResult = { ok: true; bytes: number } | { ok: false; message: string };

export function saveDraft(storage: DraftStorage, doc: EffectDocumentV2): DraftSaveResult {
  try {
    const text = JSON.stringify(doc);
    storage.setItem(DRAFT_KEY, text);
    return { ok: true, bytes: text.length };
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

export function removeFromShelf(storage: DraftStorage, name: string): ShelfEntry[] {
  const entries = readShelf(storage).filter(e => e.name !== name);
  try { storage.setItem(SHELF_KEY, JSON.stringify(entries)); } catch { /* storage unavailable: the in-memory list still updates */ }
  return entries;
}
