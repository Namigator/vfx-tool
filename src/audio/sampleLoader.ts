// Loads library sounds (assets/sounds/<id>.wav) for compileAudio's `samples`. Browser: fetch relative to the app base
// (like spriteUrl). Decoded sounds are cached for the session.
import { SOUND_LIBRARY } from './soundLibrary.generated.ts';
import { decodeWav, to48k } from './wavDecode.ts';

const BASE: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const cache = new Map<string, Promise<Float32Array>>();

export function soundUrl(file: string): string {
  return `${BASE.endsWith('/') ? BASE : `${BASE}/`}assets/sounds/${file}`;
}

/** Decoded 48 kHz mono PCM of each requested library sound (unknown ids are skipped; compileAudio reports them). */
export async function loadSounds(ids: readonly string[], fetchBytes: (url: string) => Promise<Uint8Array> = async u => new Uint8Array(await (await fetch(u)).arrayBuffer())): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  await Promise.all(ids.map(async id => {
    const s = SOUND_LIBRARY.find(x => x.id === id);
    if (!s) return;
    let p = cache.get(id);
    if (!p) {
      p = fetchBytes(soundUrl(s.file)).then(b => { const d = decodeWav(b); if (typeof d === 'string') throw new Error(`${s.file}: ${d}`); return to48k(d); });
      cache.set(id, p);
      p.catch(() => cache.delete(id));
    }
    out.set(id, await p);
  }));
  return out;
}
