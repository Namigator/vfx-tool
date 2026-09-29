// Page-side probe for tools/perf-fps.mjs (evaluated by cdp-eval): plays the loaded effect once and returns the
// requestAnimationFrame interval statistics.
const B = t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
const gaps = []; let last = 0, run = true;
const f = n => { if (last) gaps.push(n - last); last = n; if (run) requestAnimationFrame(f); };
// Optional (?big=1 on the URL): Expand preview + Reference quality, to measure at a large canvas.
if (new URLSearchParams(location.search).get('big')) {
  B('Expand preview')?.click();
  const q = document.querySelector('select[aria-label*="uality"]') ?? [...document.querySelectorAll('select')].find(x => [...x.options].some(o => /Reference/.test(o.text)));
  if (q) { const o = [...q.options].find(o => /Reference/.test(o.text)); q.value = o.value; q.dispatchEvent(new Event('change', { bubbles: true })); }
  await new Promise(r => setTimeout(r, 800));
}
B('Play').click(); requestAnimationFrame(f);
const t0 = performance.now();
const ended = () => { const m = /tick (\d+)\/(\d+)/.exec(document.querySelector('.pv2-readout').textContent); return m && m[1] === m[2]; };
while (performance.now() - t0 < 12000) { await new Promise(r => setTimeout(r, 200)); if (ended()) break; }
run = false;
const s = gaps.slice(5).sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(s.length * p))];
const c = document.querySelector('.pv2-main canvas');
return { frames: s.length, median: q(0.5), p95: q(0.95), max: s.at(-1), canvas: [c.width, c.height] };
