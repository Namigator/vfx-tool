// Object URLs for imported asset bytes, keyed by byte SHA-256. The editor registers them after an import
// or after loading bytes from the local asset store; the viewport waits for a URL that is not there yet.
const urls = new Map<string, string>();
const waiting = new Map<string, ((url: string) => void)[]>();

export function registerAssetUrl(sha256: string, url: string): void {
  urls.set(sha256, url);
  for (const cb of waiting.get(sha256) ?? []) cb(url);
  waiting.delete(sha256);
}

export function hasAssetUrl(sha256: string): boolean { return urls.has(sha256); }

/** Calls `cb` now if the bytes are registered, otherwise once they are. */
export function whenAssetUrl(sha256: string, cb: (url: string) => void): void {
  const u = urls.get(sha256);
  if (u !== undefined) { cb(u); return; }
  waiting.set(sha256, [...(waiting.get(sha256) ?? []), cb]);
}
