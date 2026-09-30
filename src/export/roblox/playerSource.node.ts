// Node-only: the EffectPlayer.luau text for writeRbxmx({ playerSource }). Kept out of rbxmx.ts so that module stays
// browser-safe (no node: imports). Browser code uses `import('./EffectPlayer.luau?raw')` instead.
import { readFileSync } from 'node:fs';

let cached: string | undefined;
export function effectPlayerSource(): string {
  cached ??= readFileSync(new URL('./EffectPlayer.luau', import.meta.url), 'utf8');
  return cached;
}
