// Editor-side Unreal (Niagara) export: builds the IR, resolves texture bytes from the library, zips the folder
// package (fflate, already a project dependency) and returns it ready to download. Kept out of PreviewV2.tsx (only
// a one-line button calls this) so the editor layout file stays uncluttered.
import type { EffectDocumentV2 } from '../model/types.ts';
import { spriteUrl } from '../assets/spriteUrl.ts';

export type UnrealExportResult = {
  blob: Blob;
  fileName: string;
  /** Short status line for the file-bar note, e.g. "Unreal export: 7 emitters... - see report.md in the zip." */
  summary: string;
};

/** documentFileName(doc) with its extension stripped, e.g. "flamethrower.vfx.json" -> "flamethrower". */
function baseName(doc: EffectDocumentV2): string {
  return (doc.name || doc.id || 'effect').replace(/[^A-Za-z0-9_-]/g, '_') || 'effect';
}

/**
 * Exports `doc` for Unreal Engine (Niagara): effect.json (IR) + Textures/*.png (from /assets/sprites/<file>) +
 * README.md + report.md, zipped. Loaded on demand (dynamic import) so the editor stays light, same pattern as the
 * Roblox export in PreviewV2.tsx.
 */
export async function exportUnrealZip(doc: EffectDocumentV2): Promise<UnrealExportResult> {
  const [{ unrealEffectFrom }, { buildUnrealPackage }, { zipSync }] = await Promise.all([
    import('../export/unreal/fromPlan.ts'), import('../export/unreal/package.ts'), import('fflate'),
  ]);
  const r = unrealEffectFrom(doc);
  if (!r.ok) throw new Error(`Unreal export failed: ${r.message}`);
  const e = r.value;
  const textureBytes = new Map<string, Uint8Array>();
  for (const t of e.textures) {
    const res = await fetch(spriteUrl(t)).catch(() => null);
    if (res?.ok) textureBytes.set(t, new Uint8Array(await res.arrayBuffer()));
  }
  const files = buildUnrealPackage(e, textureBytes);
  const base = baseName(doc);
  const zipInput: Record<string, Uint8Array> = {};
  for (const f of files) zipInput[`${base}/${f.path}`] = typeof f.bytes === 'string' ? new TextEncoder().encode(f.bytes) : f.bytes;
  const zipped = zipSync(zipInput, { level: 6 });
  const blob = new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  const dropped = e.report.filter(x => x.level === 'dropped').length, approx = e.report.filter(x => x.level === 'approximated').length;
  const missingTex = e.textures.filter(t => !textureBytes.has(t));
  const summary = `Unreal export: ${e.emitters.length} emitters, ${e.ribbons.length} ribbon layers, ${e.lights.length} lights. ${approx} approximated, ${dropped} left out${missingTex.length ? `, ${missingTex.length} texture(s) missing` : ''} - see report.md in the zip.`;
  return { blob, fileName: `${base}.unreal.zip`, summary };
}
