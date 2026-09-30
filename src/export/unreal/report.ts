// Unreal export conversion report (mirrors src/export/roblox/report.ts): plain language, grouped, repeats folded.
import type { UnrealEffect } from './types.ts';

export function reportMarkdown(e: UnrealEffect): string {
  const lines = [`# Unreal export: ${e.name}`, '',
    `- ${e.emitters.length} Niagara emitters, ${e.ribbons.length} ribbon layers, ${e.lights.length} lights`,
    `- Length ${(e.durationTicks / e.ticksPerSecond).toFixed(2)} s (${e.durationTicks} ticks at ${e.ticksPerSecond}/s), 1 m = 100 cm`, ''];
  lines.push('## Textures', '');
  if (!e.textures.length) lines.push('None (plain default particle sprite).');
  for (const t of e.textures) lines.push(`- ${t}`);
  const groups: [string, string][] = [['dropped', 'Not available / out of scope (left out)'], ['approximated', 'Approximated'], ['info', 'Notes']];
  for (const [level, title] of groups) {
    const items = e.report.filter(r => r.level === level);
    if (!items.length) continue;
    lines.push('', `## ${title}`, '');
    const folded = new Map<string, string[]>();
    for (const r of items) folded.set(r.message, [...(folded.get(r.message) ?? []), r.item]);
    for (const [message, where] of folded) lines.push(`- ${message}${where.length > 1 || where[0] !== 'presentation' ? ` (${[...new Set(where)].join(', ')})` : ''}`);
  }
  lines.push('', '## Importing it into Unreal', '',
    '1. Copy `integrations/unreal/VfxStudioImporter` into `<YourProject>/Plugins/VfxStudioImporter`, then regenerate project files and build (or let the editor prompt to build missing modules on next launch).',
    '2. Enable the plugin (it enables itself via the .uplugin default) and restart the editor if prompted.',
    '3. Run the commandlet: `UnrealEditor-Cmd.exe <YourProject>.uproject -run=VfxStudioImport -Package=<path to this package folder> -Dest=/Game/VFXStudio/' + e.name + '` — or call `unreal.VfxNiagaraImporter.import_package(package_dir, dest_path)` from the Python console / an editor utility script.',
    '4. The importer reads `effect.json`, imports `Textures/*.png`, creates one Material Instance per blend mode/texture combination, and builds one NiagaraSystem with one emitter per IR emitter (template chosen per emitter, see effect.json `suggestedTemplate`).',
    '5. Drag the new NiagaraSystem (`/Game/VFXStudio/' + e.name + '/NS_' + e.name + '`) into a level, or spawn it at runtime with `UNiagaraFunctionLibrary::SpawnSystemAtLocation`.');
  return lines.join('\n') + '\n';
}
