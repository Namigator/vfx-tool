// Editor-side Godot 4 export: builds the scene (via the engine-neutral IR), resolves texture bytes from the library and
// zips the folder package (<name>/<name>.tscn, Textures/, README.md, report.md). Loaded on demand like exportUnreal.ts.
import type { EffectDocumentV2 } from '../model/types.ts';
import { spriteUrl } from '../assets/spriteUrl.ts';

export type GodotExportResult = { blob: Blob; fileName: string; summary: string };

export async function exportGodotZip(doc: EffectDocumentV2): Promise<GodotExportResult> {
  const [{ unrealEffectFrom }, { godotSceneFrom, godotReadme, godotReportMarkdown }, { zipSync }] = await Promise.all([
    import('../export/unreal/fromPlan.ts'), import('../export/godot/scene.ts'), import('fflate'),
  ]);
  const r = unrealEffectFrom(doc);
  if (!r.ok) throw new Error(`Godot export failed: ${r.message}`);
  const g = godotSceneFrom(r.value);
  const enc = new TextEncoder(), files: Record<string, Uint8Array> = {
    [`${g.name}/${g.name}.tscn`]: enc.encode(g.tscn),
    [`${g.name}/README.md`]: enc.encode(godotReadme(g)),
    [`${g.name}/report.md`]: enc.encode(godotReportMarkdown(g)),
  };
  for (const f of g.files) files[`${g.name}/${f.path}`] = enc.encode(f.text);
  let missing = 0;
  for (const t of g.textures) {
    const res = await fetch(spriteUrl(t)).catch(() => null);
    if (res?.ok) files[`${g.name}/Textures/${t}`] = new Uint8Array(await res.arrayBuffer()); else missing++;
  }
  const blob = new Blob([zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  const count = (lvl: string) => g.report.filter(x => x.level === lvl).length;
  const summary = `Godot export: ${r.value.emitters.length} emitters, ${r.value.lights.length} lights. ${count('approximated')} approximated, ${count('dropped')} left out${missing ? `, ${missing} texture(s) missing` : ''} - copy the folder to ${g.resPath}/ (see README.md).`;
  return { blob, fileName: `${g.name}.godot.zip`, summary };
}
