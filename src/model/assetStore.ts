// Local asset byte store (13-PERSISTENCE "Storage model"): IndexedDB database vfx-studio-v2, version 1.
// All v1 object stores are created up front so later slices (documents, revisions, blocks) need no
// upgrade; only `assets` (immutable Blobs keyed by byte SHA-256, deduplicated) is used so far.
// Browser-only; every call resolves to a failure value instead of throwing when IndexedDB is unavailable.

const DB_NAME = 'vfx-studio-v2', DB_VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const make = (name: string, keyPath: string | string[]) => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath }); };
      make('documents', 'id');
      make('revisions', ['documentId', 'revision']);
      make('assets', 'byteHash');
      make('assetMetadata', 'assetId');
      make('blocks', ['id', 'revision']);
      make('preferences', 'key');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error ?? new Error('IndexedDB open failed.')); };
  });
  return opening;
}

export type AssetBytesRecord = { byteHash: string; mime: string; blob: Blob };

/** Stores immutable bytes once per hash (an existing record is kept). */
export async function putAssetBytes(byteHash: string, mime: string, blob: Blob): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      const store = tx.objectStore('assets');
      const get = store.get(byteHash);
      get.onsuccess = () => { if (!get.result) store.put({ byteHash, mime, blob } satisfies AssetBytesRecord); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Asset write failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Asset write aborted (storage quota?).'));
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function getAssetBytes(byteHash: string): Promise<AssetBytesRecord | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction('assets', 'readonly').objectStore('assets').get(byteHash);
      req.onsuccess = () => resolve(req.result as AssetBytesRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

/** Every stored asset byte record with its size (for the explicit cleanup action). */
export async function listAssetBytes(): Promise<{ byteHash: string; size: number }[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction('assets', 'readonly').objectStore('assets').getAll();
      req.onsuccess = () => resolve((req.result as AssetBytesRecord[]).map(r => ({ byteHash: r.byteHash, size: r.blob.size })));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Deletes the given byte records in one transaction; resolves to the bytes reclaimed (0 on failure). */
export async function deleteAssetBytes(hashes: readonly string[], sizes: ReadonlyMap<string, number>): Promise<number> {
  if (!hashes.length) return 0;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite'), store = tx.objectStore('assets');
      for (const h of hashes) store.delete(h);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return hashes.reduce((n, h) => n + (sizes.get(h) ?? 0), 0);
  } catch {
    return 0;
  }
}

/**
 * 13 "Asset cleanup computes references across documents, revisions, blocks and active undo history": every SHA-256
 * mentioned anywhere in those texts is kept (a content hash only ever appears as a reference), everything else in the
 * store is unused.
 */
export function unusedAssetHashes(stored: readonly string[], referenceTexts: readonly (string | null | undefined)[]): string[] {
  const used = new Set<string>();
  for (const t of referenceTexts) if (t) for (const m of t.matchAll(/[0-9a-f]{64}/g)) used.add(m[0]);
  return stored.filter(h => !used.has(h));
}

/**
 * Project shelf and trash in IndexedDB (13: named documents must not be squeezed by the ~5 MB localStorage
 * quota). A synchronous key/value view over the `preferences` store: values for `keys` are loaded once into
 * memory, reads are synchronous, writes update memory at once and persist in the background (failures are
 * reported through onError, never thrown). Values still in localStorage from before are migrated once.
 */
export async function openProjectStorage(keys: readonly string[], onError: (message: string) => void, merge: (key: string, stored: string, legacy: string) => string = (_k, stored) => stored): Promise<{ getItem(key: string): string | null; setItem(key: string, value: string): void } | null> {
  let db: IDBDatabase;
  try { db = await openDb(); } catch { return null; }
  const mem = new Map<string, string>();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('preferences', 'readwrite'), store = tx.objectStore('preferences');
      for (const key of keys) {
        const req = store.get(key);
        req.onsuccess = () => {
          const rec = req.result as { key: string; value: string } | undefined;
          const stored = rec && typeof rec.value === 'string' ? rec.value : null;
          let legacy: string | null = null;
          try { legacy = typeof localStorage === 'undefined' ? null : localStorage.getItem(key); } catch { /* unavailable */ }
          // A value left in localStorage (older tab or version) is merged in, never dropped.
          const value = stored !== null && legacy !== null ? merge(key, stored, legacy) : stored ?? legacy;
          if (value === null) return;
          mem.set(key, value);
          if (value !== stored) store.put({ key, value });
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Project store read failed.'));
    });
  } catch { return null; }
  // Migrated values leave localStorage only after they are safely in IndexedDB.
  for (const key of keys) { try { if (mem.has(key) && typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch { /* best effort */ } }
  return {
    getItem: key => mem.get(key) ?? null,
    setItem: (key, value) => {
      mem.set(key, value);
      const tx = db.transaction('preferences', 'readwrite');
      tx.objectStore('preferences').put({ key, value });
      tx.onabort = () => onError(`Could not save projects: ${tx.error?.message ?? 'storage quota?'}`);
    },
  };
}
