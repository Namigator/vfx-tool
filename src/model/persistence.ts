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
