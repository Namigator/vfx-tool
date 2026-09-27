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
