// Editor-side Unity 6 export: IR -> effect.unity.json, resolves texture bytes from the library and zips the folder
// package (<name>/effect.unity.json, Textures/, README.md, report.md). Loaded on demand like exportGodot.ts.
import type { EffectDocumentV2 } from '../model/types.ts';
import { spriteUrl } from '../assets/spriteUrl.ts';

export type UnityExportResult = { blob: Blob; fileName: string; summary: string };

export async function exportUnityZip(doc: EffectDocumentV2): Promise<UnityExportResult> {
  const [{ unrealEffectFrom }, { unityEffectFrom, unityReadme, unityReportMarkdown }, { zipSync }] = await Promise.all([
    import('../export/unreal/fromPlan.ts'), import('../export/unity/fromUnreal.ts'), import('fflate'),
  ]);
  const r = unrealEffectFrom(doc);
  if (!r.ok) throw new Error(`Unity export failed: ${r.message}`);
  const { effect, report } = unityEffectFrom(r.value), name = effect.name;
  const enc = new TextEncoder(), files: Record<string, Uint8Array> = {
    [`${name}/effect.unity.json`]: enc.encode(JSON.stringify(effect)),
    [`${name}/README.md`]: enc.encode(unityReadme(name)),
    [`${name}/report.md`]: enc.encode(unityReportMarkdown(name, report)),
  };
  let missing = 0;
  for (const t of effect.textures) {
    const res = await fetch(spriteUrl(t)).catch(() => null);
    if (res?.ok) files[`${name}/Textures/${t}`] = new Uint8Array(await res.arrayBuffer()); else missing++;
  }
  const blob = new Blob([zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  const count = (lvl: string) => report.filter(x => x.level === lvl).length;
  const summary = `Unity export: ${effect.emitters.length} emitters, ${effect.lights.length} lights, ${effect.ribbons.length} ribbons. ${count('approximated')} approximated, ${count('dropped')} left out${missing ? `, ${missing} texture(s) missing` : ''} - import with integrations/unity/VfxStudio (see README.md).`;
  return { blob, fileName: `${name}.unity.zip`, summary };
}
