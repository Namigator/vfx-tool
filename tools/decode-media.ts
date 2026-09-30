// Decodes a few frames of an exported GIF / MP4 / WebM in headless Chrome (the browser's own decoders, so this is what a
// player would show) and saves them as PNGs: node --experimental-strip-types tools/decode-media.ts <file> [count] [outPrefix]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromeEval } from '../mcp/chromeEval.ts';

const [file, countArg, prefixArg] = process.argv.slice(2);
if (!file) { console.error('usage: decode-media.ts <file.gif|mp4|webm> [count] [outPrefix]'); process.exit(2); }
const chrome = [process.env.VFX_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => p && existsSync(p));
if (!chrome) throw new Error('No Chrome; set VFX_CHROME.');
const bytes = readFileSync(file), count = Number(countArg ?? 4), isGif = /\.gif$/i.test(file), mime = isGif ? 'image/gif' : /\.webm$/i.test(file) ? 'video/webm' : 'video/mp4';
const script = `
const bin = atob(${JSON.stringify(bytes.toString('base64'))}), u8 = Uint8Array.from(bin, c => c.charCodeAt(0));
const out = { frames: [], info: {} };
const toPng = c => c.toDataURL('image/png').split(',')[1];
if (${isGif}) {
  const dec = new ImageDecoder({ data: u8, type: 'image/gif' });
  await dec.tracks.ready;
  const track = dec.tracks.selectedTrack;
  out.info = { frameCount: track.frameCount, repetitionCount: track.repetitionCount };
  const n = Math.min(${count}, track.frameCount);
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i * (track.frameCount - 1) / Math.max(1, n - 1));
    const { image } = await dec.decode({ frameIndex: idx });
    const c = document.createElement('canvas'); c.width = image.displayWidth; c.height = image.displayHeight;
    c.getContext('2d').drawImage(image, 0, 0); out.frames.push({ index: idx, png: toPng(c), duration: image.duration }); image.close();
  }
} else {
  const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(new Blob([u8], { type: '${mime}' }));
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video failed to load: ' + (v.error && v.error.message))); });
  out.info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  for (let i = 0; i < ${count}; i++) {
    const t = Math.min(v.duration - 0.05, (i + 0.5) * v.duration / ${count});
    await new Promise(res => { v.onseeked = res; v.currentTime = t; });
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0); out.frames.push({ time: t, png: toPng(c) });
  }
}
return out;`;
const r = await chromeEval<{ frames: { png: string; index?: number; time?: number }[]; info: unknown }>({ chrome, url: 'http://127.0.0.1:5174/capture-media.html?doc=/work/mcp/mx-bolt.json', readyTitle: 'MEDIA READY', script });
mkdirSync('work/mcp/media', { recursive: true });
const prefix = prefixArg ?? file.replace(/\.[a-z0-9]+$/i, '') + '-decoded';
r.frames.forEach((f, i) => writeFileSync(`${prefix}-${i}.png`, Buffer.from(f.png, 'base64')));
console.log(JSON.stringify(r.info), r.frames.map((f, i) => `${prefix}-${i}.png (${f.index ?? f.time?.toFixed(2)})`).join(', '));
