// Node: library sounds straight from assets/sounds for compileAudio's `samples` (MCP server, tools, tests).
import { readFileSync } from 'node:fs';
import { SOUND_LIBRARY } from './soundLibrary.generated.ts';
import { decodeWav, to48k } from './wavDecode.ts';

const DIR = new URL('../../assets/sounds/', import.meta.url);

export function loadSoundsNode(ids: readonly string[]): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  for (const id of ids) {
    const s = SOUND_LIBRARY.find(x => x.id === id);
    if (!s) continue;
    const d = decodeWav(new Uint8Array(readFileSync(new URL(s.file, DIR))));
    if (typeof d === 'string') throw new Error(`${s.file}: ${d}`);
    out.set(id, to48k(d));
  }
  return out;
}
