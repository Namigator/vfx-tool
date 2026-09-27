// Portable .vfxpack archive (13-PERSISTENCE "Export formats" 2, first slice): a ZIP (Deflate via the vetted
// fflate 0.8.3 for JSON/text, stored for already-compressed images) holding manifest.json, effect.json, assets/<sha256>.<ext>, metadata/<assetId>.json and
// licenses/NOTICE.txt. Pure: bytes in, bytes out. Import validates paths, limits, entry types and checksums
// before anything is handed to the editor; the caller commits atomically.
import type { EffectDocumentV2 } from './types.ts';
import { sha256Hex } from '../assets/importTexture.ts';
import { deflateSync, inflateSync } from 'fflate';

export const PACK_FORMAT = 'vfx-studio-package';
export const PACK_VERSION = 2;
const LIMITS = { archive: 100 * 1048576, expanded: 256 * 1048576, entries: 256, json: 5 * 1048576, manifest: 256 * 1024 };

// ---------- CRC-32 and a minimal stored-entry ZIP ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export type ZipEntry = { path: string; bytes: Uint8Array };

/** Writes stored (method 0) entries with UTF-8 names; deterministic (fixed DOS timestamp 1980-01-01). */
export function writeZip(entries: ZipEntry[], opts: { deflate?: boolean } = {}): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.path), crc = crc32(e.bytes), n = e.bytes.length;
    const packed = opts.deflate && !/.(png|jpe?g|webp)$/i.test(e.path) ? deflateSync(e.bytes, { level: 6 }) : undefined;
    const useDeflate = packed !== undefined && packed.length < n, data = useDeflate ? packed : e.bytes, c = data.length, method = useDeflate ? 8 : 0;
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true); lv.setUint32(18, c, true); lv.setUint32(22, n, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); local.set(name, 30);
    const cen = new Uint8Array(46 + name.length), cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, c, true); cv.setUint32(24, n, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); cen.set(name, 46);
    parts.push(local, data); central.push(cen);
    offset += local.length + c;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cenSize + 22);
  let o = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, o); o += p.length; }
  return out;
}

/** Same path rules as document bundle paths: relative, '/'-separated, no empty/./.. segments, backslashes or drives. */
export function safeArchivePath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p) || p.includes('\0')) return false;
  return p.split('/').every(s => s !== '' && s !== '.' && s !== '..');
}

/** Reads a ZIP from its central directory; only stored, unencrypted file entries with safe unique paths. */
export function readZip(b: Uint8Array): { ok: true; entries: ZipEntry[] } | { ok: false; message: string } {
  if (b.length > LIMITS.archive) return { ok: false, message: 'Archive is larger than 100 MiB.' };
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return { ok: false, message: 'Not a ZIP archive (no end-of-central-directory record).' };
  const count = v.getUint16(eocd + 10, true), cenOff = v.getUint32(eocd + 16, true);
  if (count > LIMITS.entries) return { ok: false, message: `Archive has ${count} entries; the limit is ${LIMITS.entries}.` };
  const dec = new TextDecoder('utf-8', { fatal: true }), entries: ZipEntry[] = [], seen = new Set<string>();
  let p = cenOff, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) return { ok: false, message: 'Corrupt central directory.' };
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const extAttr = v.getUint32(p + 38, true), local = v.getUint32(p + 42, true);
    let path: string;
    try { path = dec.decode(b.subarray(p + 46, p + 46 + nlen)); } catch { return { ok: false, message: 'Entry name is not valid UTF-8.' }; }
    p += 46 + nlen + xlen + clen;
    if (path.endsWith('/')) continue; // Directory entries carry no data.
    if (flags & 1) return { ok: false, message: `Entry "${path}" is encrypted.` };
    if (method !== 0 && method !== 8) return { ok: false, message: `Entry "${path}" uses unsupported compression (method ${method}); only stored and Deflate are accepted.` };
    if (((extAttr >>> 16) & 0o170000) === 0o120000) return { ok: false, message: `Entry "${path}" is a symbolic link.` };
    if (!safeArchivePath(path)) return { ok: false, message: `Unsafe entry path "${path}".` };
    const norm = path.normalize('NFC').toLowerCase();
    if (seen.has(norm)) return { ok: false, message: `Duplicate entry "${path}".` };
    seen.add(norm);
    if (method === 0 && csize !== usize) return { ok: false, message: `Entry "${path}" sizes disagree.` };
    expanded += usize;
    if (expanded > LIMITS.expanded) return { ok: false, message: 'Archive expands beyond 256 MiB.' };
    if (local + 30 > b.length || v.getUint32(local, true) !== 0x04034b50) return { ok: false, message: `Entry "${path}" has no local header.` };
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + csize > b.length) return { ok: false, message: `Entry "${path}" runs past the end of the archive.` };
    let bytes: Uint8Array;
    if (method === 0) bytes = b.slice(start, start + usize);
    else {
      // Inflate into a buffer of the declared size; a stream that claims less than it holds fails the size/CRC checks.
      try { bytes = inflateSync(b.subarray(start, start + csize), { out: new Uint8Array(usize) }); } catch { return { ok: false, message: `Entry "${path}" is not valid Deflate data.` }; }
      if (bytes.length !== usize) return { ok: false, message: `Entry "${path}" inflated to ${bytes.length} bytes, not the declared ${usize}.` };
    }
    if (crc32(bytes) !== crc) return { ok: false, message: `Entry "${path}" failed its CRC check.` };
    entries.push({ path, bytes });
  }
  return { ok: true, entries };
}

// ---------- pack ----------
export type PackAsset = { sha256: string; mime: string; bytes: Uint8Array };
export type ManifestFile = { path: string; sha256: string; bytes: number; mime: string; role: 'document' | 'asset' | 'metadata' | 'license' };
export type PackManifest = {
  format: typeof PACK_FORMAT; packageVersion: typeof PACK_VERSION; documentPath: 'effect.json'; schemaVersion: number; runtimeVersion: string;
  files: ManifestFile[]; creationTool: string; state: 'validated' | 'draft'; capabilities: string[];
};

const extOf = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'model/gltf-binary' ? 'glb' : 'bin');

/**
 * Builds a pack for `doc`. Every document asset with source kind "bundle" must be present in `bytes`
 * (validated state) unless `draft` is set, which records missing references in the manifest state.
 */
export async function buildPack(doc: EffectDocumentV2, bytes: Map<string, PackAsset>, opts: { draft?: boolean; tool?: string } = {}): Promise<{ ok: true; value: Uint8Array } | { ok: false; message: string }> {
  const enc = new TextEncoder(), files: ZipEntry[] = [], manifest: ManifestFile[] = [];
  const add = async (path: string, data: Uint8Array, mime: string, role: ManifestFile['role']) => { files.push({ path, bytes: data }); manifest.push({ path, sha256: await sha256Hex(data), bytes: data.length, mime, role }); };
  await add('effect.json', enc.encode(JSON.stringify(doc, null, 2)), 'application/json', 'document');
  const missing: string[] = [], written = new Set<string>();
  for (const a of doc.assets) {
    if (a.source.kind !== 'bundle') continue;
    const b = bytes.get(a.sha256);
    if (!b) { missing.push(a.provenance.originalFilename); continue; }
    if ((await sha256Hex(b.bytes)) !== a.sha256) return { ok: false, message: `Stored bytes for "${a.provenance.originalFilename}" do not match their hash.` };
    const path = `assets/${a.sha256}.${extOf(a.mime)}`;
    if (!written.has(path)) { written.add(path); await add(path, b.bytes, a.mime, 'asset'); }
    await add(`metadata/${a.id}.json`, enc.encode(JSON.stringify(a, null, 2)), 'application/json', 'metadata');
  }
  if (missing.length && !opts.draft) return { ok: false, message: `Missing asset bytes: ${missing.join(', ')}. Re-import them or export a draft.` };
  const notices = doc.assets.map(a => `${a.provenance.originalFilename} (${a.id}): ${a.license.identifier}${a.license.text ? `\n${a.license.text}` : ''}`).join('\n');
  await add('licenses/NOTICE.txt', enc.encode(notices || 'No imported assets.\n'), 'text/plain', 'license');
  const m: PackManifest = {
    format: PACK_FORMAT, packageVersion: PACK_VERSION, documentPath: 'effect.json', schemaVersion: doc.schemaVersion, runtimeVersion: doc.runtimeVersion,
    files: manifest, creationTool: opts.tool ?? 'vfx-studio', state: missing.length ? 'draft' : 'validated', capabilities: [],
  };
  return { ok: true, value: writeZip([{ path: 'manifest.json', bytes: enc.encode(JSON.stringify(m, null, 2)) }, ...files], { deflate: true }) };
}

export type ReadPack = { document: unknown; manifest: PackManifest; assets: PackAsset[] };

/** Validates archive structure, manifest and every checksum; the document JSON is returned unvalidated (caller runs validateDocument). */
export async function readPack(b: Uint8Array): Promise<{ ok: true; value: ReadPack } | { ok: false; message: string }> {
  const z = readZip(b);
  if (!z.ok) return z;
  const byPath = new Map(z.entries.map(e => [e.path, e.bytes]));
  const mb = byPath.get('manifest.json');
  if (!mb) return { ok: false, message: 'Pack has no manifest.json.' };
  if (mb.length > LIMITS.manifest) return { ok: false, message: 'manifest.json is larger than 256 KiB.' };
  let m: PackManifest;
  try { m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(mb)); } catch { return { ok: false, message: 'manifest.json is not valid UTF-8 JSON.' }; }
  if (m?.format !== PACK_FORMAT) return { ok: false, message: 'manifest.json is not a vfx-studio-package manifest.' };
  if (m.packageVersion !== PACK_VERSION) return { ok: false, message: `Unsupported package version ${String(m.packageVersion)}.` };
  if (!Array.isArray(m.files) || m.documentPath !== 'effect.json') return { ok: false, message: 'manifest.json lists no files or a different document path.' };
  for (const f of m.files) {
    const data = byPath.get(f?.path);
    if (!data) return { ok: false, message: `Manifest file "${String(f?.path)}" is missing from the archive.` };
    if (data.length !== f.bytes || (await sha256Hex(data)) !== f.sha256) return { ok: false, message: `Checksum mismatch for "${f.path}".` };
  }
  const listed = new Set(m.files.map(f => f.path));
  const extra = z.entries.find(e => e.path !== 'manifest.json' && !listed.has(e.path));
  if (extra) return { ok: false, message: `Archive entry "${extra.path}" is not listed in the manifest.` };
  const docBytes = byPath.get('effect.json')!;
  if (docBytes.length > LIMITS.json) return { ok: false, message: 'effect.json is larger than 5 MiB.' };
  let document: unknown;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(docBytes)); } catch { return { ok: false, message: 'effect.json is not valid UTF-8 JSON.' }; }
  const assets = m.files.filter(f => f.role === 'asset').map(f => ({ sha256: f.sha256, mime: f.mime, bytes: byPath.get(f.path)! }));
  return { ok: true, value: { document, manifest: m, assets } };
}
