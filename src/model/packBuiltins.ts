// 13-PERSISTENCE portable packs: "Portable export includes every referenced original asset byte, including
// built-ins", so a later library update cannot alter an old effect. Included-library sprites referenced by
// Materials are embedded (bytes + sheet layout); on import, a sprite whose bytes differ from the current library
// is pinned: stored as a document texture asset and the Materials that used it point at that copy instead.
// Also: the capability list a pack declares, and a read-only summary shown before Import.
import { createTextureAsset, sha256Hex } from '../assets/importTexture.ts';
import type { SpriteSheet } from '../assets/spriteLibrary.ts';
import type { EffectDocumentV2 } from './types.ts';
import { isTexturedTemplate } from '../graph/materialSprite.ts';

export type EmbeddedBuiltin = { id: string; sheet: SpriteSheet; bytes: Uint8Array };
export type PinnedBuiltin = { id: string; assetId: string; sha256: string; mime: string; bytes: Uint8Array; path: string };

const DEFAULT_SPRITE = 'soft-glow';
const materials = (doc: EffectDocumentV2) => doc.graphs.flatMap(g => g.nodes).filter(n => n.type === 'Material');
const usesLibrarySprite = (params: Record<string, unknown>) =>
  isTexturedTemplate(params.template, params) && (typeof params.textureAsset !== 'string' || params.textureAsset === '');

/** Included-library sprite ids drawn by this document (Materials with template SpriteTextured and no imported texture). */
export function referencedBuiltinSprites(doc: EffectDocumentV2): string[] {
  const ids = new Set<string>();
  for (const m of materials(doc)) if (usesLibrarySprite(m.params)) ids.add(typeof m.params.sprite === 'string' ? m.params.sprite : DEFAULT_SPRITE);
  return [...ids].sort();
}

/**
 * Pins embedded built-ins whose bytes differ from the current library (`currentSha(id)` undefined = no longer in the
 * library): each becomes a document texture asset with the same grid and cell mode, and every Material that drew the
 * library sprite now draws the pinned copy. Unchanged built-ins stay library references. Never mutates `doc`.
 */
export async function pinBuiltins(doc: EffectDocumentV2, embedded: readonly EmbeddedBuiltin[], currentSha: (id: string) => string | undefined):
  Promise<{ ok: true; doc: EffectDocumentV2; pinned: PinnedBuiltin[] } | { ok: false; message: string }> {
  const out = structuredClone(doc), pinned: PinnedBuiltin[] = [];
  for (const b of embedded) {
    const sha = await sha256Hex(b.bytes);
    if (currentSha(b.id) === sha) continue;
    const s = b.sheet, grid = s.columns * s.rows > 1;
    const r = await createTextureAsset(b.bytes, {
      filename: `${b.id}.png (included library, as packed)`, role: 'color',
      ...(grid ? { flipbook: { rows: s.rows, columns: s.columns, cells: s.kind === 'variants' ? 'variants' as const : 'sequence' as const } } : {}),
    });
    if (!r.ok) return { ok: false, message: `Included sprite "${b.id}" in the pack is unusable: ${r.message}` };
    const asset = { ...r.value.asset, provenance: { origin: 'authored' as const, originalFilename: `${b.id}.png`, modificationNotes: 'VFX Studio included library sprite, kept as it was when packed because the library has changed since.' }, license: { identifier: 'VFX Studio included asset (procedural, no third-party rights)' } };
    if (!out.assets.some(a => a.id === asset.id)) out.assets.push(asset);
    for (const m of out.graphs.flatMap(g => g.nodes)) {
      if (m.type !== 'Material' || !usesLibrarySprite(m.params)) continue;
      if ((typeof m.params.sprite === 'string' ? m.params.sprite : DEFAULT_SPRITE) === b.id) m.params.textureAsset = asset.id;
    }
    pinned.push({ id: b.id, assetId: asset.id, sha256: asset.sha256, mime: asset.mime, bytes: b.bytes, path: r.value.path });
  }
  return { ok: true, doc: out, pinned };
}

/** Capabilities a player of this pack needs (13 manifest "capability list"). */
export const KNOWN_CAPABILITIES = ['particles', 'sprites', 'ribbons', 'trails', 'meshes', 'lights', 'presentation', 'audio', 'groups', 'imported-textures', 'imported-meshes'] as const;
export function packCapabilities(doc: EffectDocumentV2): string[] {
  const types = new Set(doc.graphs.flatMap(g => g.nodes).map(n => n.type)), caps = new Set<string>();
  if (types.has('Emitter') || types.has('SpriteRenderer')) caps.add('particles');
  if (types.has('SpriteRenderer') || types.has('BillboardRenderer')) caps.add('sprites');
  if (types.has('RibbonRenderer')) caps.add('ribbons');
  if (types.has('ParticleTrail') || types.has('MotionTrail')) caps.add('trails');
  if (types.has('MeshRenderer') || types.has('PropMesh')) caps.add('meshes');
  if (types.has('PointLight')) caps.add('lights');
  if (types.has('ScreenFlash') || types.has('CameraImpulse')) caps.add('presentation');
  if ([...types].some(t => t.startsWith('Audio'))) caps.add('audio');
  if (types.has('Group')) caps.add('groups');
  if (doc.assets.some(a => a.kind === 'texture' || a.kind === 'flipbook')) caps.add('imported-textures');
  if (doc.assets.some(a => a.kind === 'mesh')) caps.add('imported-meshes');
  return KNOWN_CAPABILITIES.filter(c => caps.has(c));
}

/** Imported (non-library) asset files a plain .vfx.json leaves out: 13 "Export warning names non-builtin dependencies". */
export function jsonExportWarning(doc: EffectDocumentV2): string | undefined {
  const names = doc.assets.filter(a => a.source.kind === 'bundle').map(a => a.provenance.originalFilename);
  return names.length ? `This .json does not contain your imported files (${names.join(', ')}). On another computer they will be missing; use Export pack to include them.` : undefined;
}

/** 13 "Stage the document ... show name, counts, warnings, licenses and required capabilities, then Import". */
export function describePack(doc: EffectDocumentV2, manifest: { state: string; capabilities?: unknown }, info: { importedFiles: number; builtins: number; pinned: readonly string[]; mixWav: boolean; notices: string; warnings: readonly string[] }): string[] {
  const nodes = doc.graphs.reduce((n, g) => n + g.nodes.length, 0), groups = doc.graphs[0]?.nodes.filter(n => n.type === 'Group').length ?? 0;
  const caps = Array.isArray(manifest.capabilities) ? manifest.capabilities.filter((c): c is string => typeof c === 'string') : [];
  const unknown = caps.filter(c => !(KNOWN_CAPABILITIES as readonly string[]).includes(c));
  const lines = [
    `"${doc.name}" (${manifest.state === 'draft' ? 'DRAFT: some files were missing when it was packed' : 'complete'})`,
    `${nodes} nodes in ${doc.graphs.length} graph(s), ${groups} component(s), ${doc.controls.length} knob(s), ${(doc.durationTicks / 60).toFixed(2)} s long`,
    `${info.importedFiles} imported file(s); ${info.builtins} included sprite(s)${info.pinned.length ? `, of which ${info.pinned.length} changed in this version of the tool and will be kept as packed (${info.pinned.join(', ')})` : ', all identical to this version of the tool'}`,
    info.mixWav ? 'Includes the rendered sound mix.' : 'No rendered sound mix.',
    `Needs: ${caps.length ? caps.join(', ') : 'nothing special'}${unknown.length ? ` — NOT supported here: ${unknown.join(', ')}` : ''}`,
  ];
  for (const w of info.warnings) lines.push(`Warning: ${w}`);
  const lic = info.notices.trim();
  if (lic && lic !== 'No imported assets.') lines.push(`Licences: ${lic.replace(/\n+/g, '; ')}`);
  return lines;
}
