// Roblox export conversion report (16-PORTABILITY "the report must name every lost runtime behavior"): plain
// language for the user, grouped by what happened, with repeated messages folded together.
import type { RobloxEffect } from './types.ts';

export function reportMarkdown(e: RobloxEffect, assetIds: Record<string, string> = {}): string {
  const lines = [`# Roblox export: ${e.name}`, '',
    `- ${e.emitters.length} particle emitters, ${e.beams.length} beam layers (up to ${e.beams.reduce((n, b) => n + b.maxSegments, 0)} beams at once), ${e.lights.length} lights`,
    `- Length ${(e.durationTicks / 60).toFixed(2)} s (${e.durationTicks} ticks), 1 m = ${e.studsPerMeter} studs`, ''];
  const missing = e.textures.filter(t => !assetIds[t]);
  lines.push('## Textures', '');
  if (!e.textures.length) lines.push('None (plain round particles).');
  for (const t of e.textures) lines.push(`- ${t}: ${assetIds[t] ? `rbxassetid://${assetIds[t]}` : 'NOT UPLOADED - shows the default Roblox sparkle until uploaded'}`);
  if (missing.length) lines.push('', `${missing.length} texture(s) still need uploading to Roblox.`);
  const groups: [string, string][] = [['dropped', 'Not available in Roblox (left out)'], ['approximated', 'Approximated'], ['info', 'Notes']];
  for (const [level, title] of groups) {
    const items = e.report.filter(r => r.level === level);
    if (!items.length) continue;
    lines.push('', `## ${title}`, '');
    const folded = new Map<string, string[]>();
    for (const r of items) folded.set(r.message, [...(folded.get(r.message) ?? []), r.item]);
    for (const [message, where] of folded) lines.push(`- ${message}${where.length > 1 || where[0] !== 'presentation' ? ` (${[...new Set(where)].join(', ')})` : ''}`);
  }
  lines.push('', '## Using it in Studio', '',
    '1. In Studio: right-click Workspace → Insert from File → pick the .rbxmx.',
    '2. Move the model where the effect should happen (its pivot is the effect origin: the Source point on the floor).',
    '3. To preview: select the model\'s Demo script, tick Enabled, press Play. From your own scripts: `require(model.EffectPlayer).play(model)`.');
  return lines.join('\n') + '\n';
}
