// User mesh import (10-ASSETS "User imports": self-contained GLB 2.0), first slice: pure inspection of the GLB
// container and its glTF JSON, then the document AssetReference. No geometry decode here — the viewport loads
// the same bytes with three's GLTFLoader. Rejections follow 10-ASSETS: external URIs, cameras, lights,
// animation, skins, morph targets and required extensions other than KHR_materials_unlit.
import type { AssetReference } from '../model/types.ts';
import { UNSPECIFIED_LICENSE } from '../model/types.ts';
import { sha256Hex } from './importTexture.ts';

export const MAX_MESH_BYTES = 20 * 1024 * 1024;
export const MESH_LIMITS = { triangles: 50_000, materials: 8, primitives: 16 };
const ALLOWED_REQUIRED = new Set(['KHR_materials_unlit']);

export type GlbSummary = { triangles: number; primitives: number; materials: number; meshes: number };

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v as Json[] : []);

/** Validates a GLB 2.0 container and its JSON against the v2 import rules; returns counts or the reasons it is rejected. */
export function inspectGlb(b: Uint8Array): { ok: true; value: GlbSummary } | { ok: false; message: string } {
  if (b.length < 20) return { ok: false, message: 'File is too small to be a GLB.' };
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(0, true) !== 0x46546c67) return { ok: false, message: 'Not a GLB file (only self-contained binary glTF .glb is accepted).' };
  if (v.getUint32(4, true) !== 2) return { ok: false, message: `GLB version ${v.getUint32(4, true)} is not supported; export glTF 2.0.` };
  if (v.getUint32(8, true) !== b.length) return { ok: false, message: 'GLB length header does not match the file size.' };
  const jsonLen = v.getUint32(12, true);
  if (v.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLen > b.length) return { ok: false, message: 'GLB has no JSON chunk.' };
  let g: Json;
  try { g = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(20, 20 + jsonLen))); } catch { return { ok: false, message: 'GLB JSON chunk is not valid UTF-8 JSON.' }; }
  const problems: string[] = [];
  const required = (Array.isArray(g.extensionsRequired) ? g.extensionsRequired as string[] : []).filter(e => !ALLOWED_REQUIRED.has(e));
  if (required.length) problems.push(`requires unsupported extensions: ${required.join(', ')}`);
  if (arr(g.buffers).some(x => typeof x.uri === 'string')) problems.push('references external or data-URI buffers (export as a single self-contained .glb)');
  if (arr(g.images).some(x => typeof x.uri === 'string')) problems.push('references external image files');
  if (arr(g.cameras).length) problems.push('contains cameras');
  if (arr(g.animations).length) problems.push('contains animations');
  if (arr(g.skins).length) problems.push('contains skins');
  const used = Array.isArray(g.extensionsUsed) ? g.extensionsUsed as string[] : [];
  if (used.includes('KHR_lights_punctual')) problems.push('contains lights');
  const accessors = arr(g.accessors);
  let triangles = 0, primitives = 0;
  for (const m of arr(g.meshes)) for (const p of arr(m.primitives)) {
    primitives++;
    if (arr(p.targets).length) problems.push('contains morph targets');
    const mode = typeof p.mode === 'number' ? p.mode : 4;
    const attrs = (p.attributes ?? {}) as Record<string, number>;
    const count = Number(accessors[typeof p.indices === 'number' ? p.indices : attrs.POSITION]?.count ?? 0);
    if (mode === 4) triangles += Math.floor(count / 3);
    else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
    else problems.push('contains point/line primitives (only triangles render)');
  }
  const materials = arr(g.materials).length;
  if (triangles > MESH_LIMITS.triangles) problems.push(`has ${triangles} triangles (limit ${MESH_LIMITS.triangles})`);
  if (materials > MESH_LIMITS.materials) problems.push(`has ${materials} materials (limit ${MESH_LIMITS.materials})`);
  if (primitives > MESH_LIMITS.primitives) problems.push(`has ${primitives} primitives (limit ${MESH_LIMITS.primitives})`);
  if (primitives === 0) problems.push('has no mesh geometry');
  if (problems.length) return { ok: false, message: `This GLB ${[...new Set(problems)].join('; ')}.` };
  return { ok: true, value: { triangles, primitives, materials, meshes: arr(g.meshes).length } };
}

/** Builds the document asset reference for a validated GLB; `importScale` converts file units to meters. */
export async function createMeshAsset(bytes: Uint8Array, filename: string, importScale = 1): Promise<{ ok: true; value: { asset: AssetReference; path: string; summary: GlbSummary } } | { ok: false; message: string }> {
  if (bytes.length > MAX_MESH_BYTES) return { ok: false, message: `File is ${(bytes.length / 1048576).toFixed(1)} MiB; the mesh limit is 20 MiB.` };
  if (!(importScale > 0 && importScale <= 1000)) return { ok: false, message: 'Import scale must be greater than 0 and at most 1000.' };
  const r = inspectGlb(bytes);
  if (!r.ok) return r;
  const sha256 = await sha256Hex(bytes);
  const interpretation = { kind: 'mesh' as const, colorSpace: 'none' as const, mesh: { importScale } };
  const id = await sha256Hex(JSON.stringify({ sha256, interpretation }));
  const path = `assets/${sha256}.glb`;
  const asset: AssetReference = {
    id, sha256, kind: 'mesh', mime: 'model/gltf-binary', bytes: bytes.length, source: { kind: 'bundle', path }, colorSpace: 'none', interpretation,
    provenance: { origin: 'imported', originalFilename: filename.slice(0, 256), modificationNotes: '' }, license: { identifier: UNSPECIFIED_LICENSE },
  };
  return { ok: true, value: { asset, path, summary: r.value } };
}
