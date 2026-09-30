// Matting proof for media export: for a document in work/mcp (e.g. made with vfx_new_document), renders the same ticks
// as a transparent frame and as a solid dark frame, composites the transparent one over the dark frame's own background
// pixel and prints the mean absolute difference (0..255). Saves direct / matte-over-dark / transparent PNGs to work/mcp/media/.
// Usage: node --experimental-strip-types tools/verify-media.ts <docId> <tick,tick,...> [size] [glow=1|0]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { chromeEval } from '../mcp/chromeEval.ts';

const [docId, ticksArg, sizeArg, glowArg] = process.argv.slice(2);
if (!docId || !ticksArg) { console.error('usage: verify-media.ts <docId> <ticks> [size] [glow]'); process.exit(2); }
const chrome = [process.env.VFX_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => p && existsSync(p));
if (!chrome) throw new Error('No Chrome; set VFX_CHROME.');
const ticks = ticksArg.split(',').map(Number), size = Number(sizeArg ?? 256), glow = glowArg !== '0';
const r = await chromeEval<{ results: { tick: number; meanAbsDiff: number; bg: number[]; bands: { alpha: string; pixels: number; meanDiff: number }[] }[]; shots: Record<string, string> }>({
  chrome, url: `http://127.0.0.1:5174/capture-media.html?doc=/work/mcp/${docId}.json`, readyTitle: 'MEDIA READY',
  script: `return await window.__vfxMedia.verifyMatte(${JSON.stringify(ticks)}, ${size}, ${glow});`,
});
mkdirSync('work/mcp/media', { recursive: true });
for (const [k, b64] of Object.entries(r.shots)) writeFileSync(`work/mcp/media/verify-${docId}-${k}.png`, Buffer.from(b64, 'base64'));
for (const x of r.results) console.log(`${docId} tick ${x.tick}: mean abs difference ${x.meanAbsDiff.toFixed(3)} / 255 (dark bg pixel ${x.bg.join(',')}); by alpha band: ${x.bands.map(b => `${b.alpha}: ${b.pixels}px diff ${b.meanDiff}`).join('; ')}`);
