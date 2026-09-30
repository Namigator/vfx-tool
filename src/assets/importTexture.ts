// User texture / flipbook import (10-ASSETS "User imports", first slice): pure byte inspection and the
// document AssetReference. No DOM, no decode: dimensions come from the PNG/JPEG/WebP headers; the
// browser decode later must agree (the viewport simply shows what the browser decodes).
import type { AssetInterpretation, AssetReference, EffectDocumentV2 } from '../model/types.ts';
import { UNSPECIFIED_LICENSE } from '../model/types.ts';
import type { SpriteSheet } from './spriteLibrary.ts';

export const MAX_TEXTURE_BYTES = 16 * 1024 * 1024;
export const MAX_TEXTURE_SIDE = 4096;

export type ImageHeader = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; ext: 'png' | 'jpg' | 'webp'; width: number; height: number };

/** Lowercase hex SHA-256 (Web Crypto; available in browsers and Node ≥ 20). */
export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/** Reads format and pixel size from the file header, or returns why the file is not an accepted image. */
export function readImageHeader(b: Uint8Array): ImageHeader | string {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    if (b.length > 40 && ascii(b, 37, 4) === 'acTL') return 'Animated PNG is not supported; use a flipbook atlas.';
    return { mime: 'image/png', ext: 'png', width: be32(b, 16), height: be32(b, 20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let o = 2; o + 9 < b.length;) {
      if (b[o] !== 0xff) return 'Corrupt JPEG header.';
      const m = b[o + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { o += 2; continue; }
      const len = be16(b, o + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', ext: 'jpg', width: be16(b, o + 7), height: be16(b, o + 5) };
      o += 2 + len;
    }
    return 'JPEG has no frame header.';
  }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8 ') return { mime: 'image/webp', ext: 'webp', width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    if (chunk === 'VP8L') { const v = be32(new Uint8Array([b[24], b[23], b[22], b[21]]), 0); return { mime: 'image/webp', ext: 'webp', width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8X') {
      if (b[20] & 0x02) return 'Animated WebP is not supported; use a flipbook atlas.';
      return { mime: 'image/webp', ext: 'webp', width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
    }
    return 'Unrecognised WebP chunk.';
  }
  return 'Only PNG, static WebP or JPEG images can be imported (no SVG, GIF or video).';
}

export type TextureImportOptions = {
  filename: string;
  /** color (tint-able RGBA sprite), mask (alpha/luminance), normal (tangent-space normal map) or noise (data pattern). JPEG is color only. */
  role: 'color' | 'mask' | 'normal' | 'noise';
  /** Present for an atlas: cells read left-to-right, top-to-bottom. */
  flipbook?: { rows: number; columns: number; frameCount?: number; cells?: 'sequence' | 'variants' };
};
export type TextureImport = { asset: AssetReference; path: string; header: ImageHeader };

/** Validates bytes against the 10-ASSETS texture/flipbook limits and builds the document asset reference. */
export async function createTextureAsset(bytes: Uint8Array, o: TextureImportOptions): Promise<{ ok: true; value: TextureImport } | { ok: false; message: string }> {
  if (bytes.length > MAX_TEXTURE_BYTES) return { ok: false, message: `File is ${(bytes.length / 1048576).toFixed(1)} MiB; the texture limit is 16 MiB.` };
  const h = readImageHeader(bytes);
  if (typeof h === 'string') return { ok: false, message: h };
  if (h.width < 1 || h.height < 1 || h.width > MAX_TEXTURE_SIDE || h.height > MAX_TEXTURE_SIDE) return { ok: false, message: `Image is ${h.width}×${h.height}; textures must be 1..${MAX_TEXTURE_SIDE} px per side.` };
  if (h.mime === 'image/jpeg' && o.role !== 'color') return { ok: false, message: 'JPEG is for color textures only (lossy, no alpha); use PNG or WebP for masks, normal maps and noise.' };
  let flipbook: AssetInterpretation['flipbook'];
  if (o.flipbook) {
    const { rows, columns } = o.flipbook, frameCount = o.flipbook.frameCount ?? rows * columns;
    if (![rows, columns].every(n => Number.isInteger(n) && n >= 1 && n <= 16)) return { ok: false, message: 'Flipbook rows and columns must be whole numbers 1..16.' };
    if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > rows * columns || frameCount > 256) return { ok: false, message: `Frame count must be 1..${Math.min(256, rows * columns)}.` };
    if (h.width % columns || h.height % rows) return { ok: false, message: `Image ${h.width}×${h.height} does not divide into ${columns}×${rows} equal cells.` };
    flipbook = { rows, columns, frameCount, paddingPixels: 0, ...(o.flipbook.cells === 'variants' ? { cells: 'variants' as const } : {}) };
  }
  const sha256 = await sha256Hex(bytes);
  const kind = flipbook ? 'flipbook' : 'texture', colorSpace = o.role;
  const interpretation: AssetInterpretation = { kind, colorSpace, ...(flipbook ? { flipbook } : {}) };
  const id = await sha256Hex(JSON.stringify({ sha256, interpretation }));
  const path = `assets/${sha256}.${h.ext}`;
  const asset: AssetReference = {
    id, sha256, kind, mime: h.mime, bytes: bytes.length, source: { kind: 'bundle', path }, width: h.width, height: h.height,
    colorSpace, interpretation, provenance: { origin: 'imported', originalFilename: o.filename.slice(0, 256), modificationNotes: '' }, license: { identifier: UNSPECIFIED_LICENSE },
  };
  return { ok: true, value: { asset, path, header: h } };
}

/** Prefix marking a SpriteSheet.file that names imported bytes (resolved by the viewport's asset URL registry). */
export const ASSET_FILE_PREFIX = 'asset:';

/** Sprite sheet for an imported texture/flipbook asset of `doc`, or why it cannot be used. */
export function assetSpriteSheet(doc: Pick<EffectDocumentV2, 'assets'>, assetId: string): SpriteSheet | string {
  const a = doc.assets.find(x => x.id === assetId);
  if (!a) return `Texture asset "${assetId}" is not listed in this document's assets.`;
  if (a.kind !== 'texture' && a.kind !== 'flipbook') return `Asset "${a.provenance.originalFilename}" is a ${a.kind}, not a texture.`;
  if (!a.width || !a.height) return `Asset "${a.provenance.originalFilename}" has no recorded size.`;
  const fb = a.interpretation.flipbook, columns = fb?.columns ?? 1, rows = fb?.rows ?? 1;
  return { id: a.id, file: `${ASSET_FILE_PREFIX}${a.sha256}`, kind: fb ? (fb.cells === 'variants' ? 'variants' : 'flipbook') : 'texture', cell: [a.width / columns, a.height / rows], columns, rows, blend: 'normal' };
}
