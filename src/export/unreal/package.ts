// Writes the Unreal export as a folder package: <name>/effect.json (IR), <name>/Textures/*.png, <name>/README.md,
// <name>/report.md. Pure data in (no filesystem access here) so it works from both mcp/server.ts (Node fs) and the
// editor (fetch + File System/download); callers supply the texture bytes already resolved.
import type { UnrealEffect } from './types.ts';
import { reportMarkdown } from './report.ts';

export type UnrealPackageFile = { path: string; bytes: Uint8Array | string };

export function readmeMarkdown(e: UnrealEffect): string {
  return [
    `# ${e.name} — Unreal (Niagara) export`,
    '',
    'This folder is a self-contained VFX Studio -> Unreal Engine export package.',
    '',
    '## Contents',
    '- `effect.json` — the engine-neutral IR (emitters, ribbons, lights, curves) the importer reads.',
    '- `Textures/*.png` — the sprite sheets referenced by the effect.',
    '- `report.md` — every approximation or drop versus the VFX Studio preview.',
    '',
    '## Import steps',
    '1. Copy `integrations/unreal/VfxStudioImporter` (from the VFX-Tool repo) into `<YourProject>/Plugins/VfxStudioImporter/`.',
    '2. Open the project (or regenerate project files + build first if prompted) so the plugin compiles and loads.',
    '3. Run the commandlet from a shell:',
    '   ```',
    `   UnrealEditor-Cmd.exe <YourProject>.uproject -run=VfxStudioImport -Package="<path to this folder>" -Dest=/Game/VFXStudio/${e.name}`,
    '   ```',
    '   or, from the in-editor Python console:',
    '   ```python',
    `   import unreal`,
    `   unreal.VfxNiagaraImporter.import_package(r"<path to this folder>", "/Game/VFXStudio/${e.name}")`,
    '   ```',
    '4. The importer creates a Material Instance per blend/texture, builds one NiagaraSystem',
    `   (\`/Game/VFXStudio/${e.name}/NS_${e.name}\`) with one emitter per IR emitter, and saves the assets.`,
    '5. Drag the NiagaraSystem into a level, or spawn it with `UNiagaraFunctionLibrary::SpawnSystemAtLocation`.',
    '',
    '## What changes versus VFX Studio',
    'See `report.md` for the full list. In short: Niagara keeps turbulence/curl-noise, drag, attraction and vortex',
    '(dropped in the Roblox export); it drops screen flash/camera shake and mesh particles this pass (report items),',
    'and per-particle trails become stretched sprites rather than a true per-particle ribbon trail.',
    '',
  ].join('\n') + '\n';
}

/** Assembles the package files; `textureBytes` maps sheet filename -> PNG bytes (caller resolves from disk/fetch). */
export function buildUnrealPackage(e: UnrealEffect, textureBytes: Map<string, Uint8Array>): UnrealPackageFile[] {
  const files: UnrealPackageFile[] = [
    { path: 'effect.json', bytes: JSON.stringify(e, null, 2) },
    { path: 'README.md', bytes: readmeMarkdown(e) },
    { path: 'report.md', bytes: reportMarkdown(e) },
  ];
  for (const t of e.textures) {
    const bytes = textureBytes.get(t);
    if (bytes) files.push({ path: `Textures/${t}`, bytes });
  }
  return files;
}
