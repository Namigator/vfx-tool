// Page-side probe for tools/perf-knob.mjs (evaluated by cdp-eval): 15 knob edits (+5 % each) on the third knob;
// returns the synchronous edit → recompile → viewport rebuild time per edit (rebuildAt) and time to the next frame.
// Time from a knob change to the next painted frame (React commit + compile + viewport rebuild + draw), 15 edits.
const sliders = [...document.querySelectorAll('input[type=range]')].filter(r => r.closest('.cp-row'));
const s = sliders[2] ?? sliders[0];
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
const vp = window.__vfxDebug?.viewport, proto = vp && Object.getPrototypeOf(vp); let rebuilt = 0;
for (const k of ['setPlan', 'setPathSource', 'setMixedSource']) if (proto) { const o = proto[k]; proto[k] = function (...a) { rebuilt = performance.now(); return o.apply(this, a); }; }
const times = [], rebuilds = [], base = Number(s.closest('.cp-row').querySelector('.cp-num').value) || (Number(s.min) + Number(s.max)) / 2;
for (let i = 0; i < 15; i++) {
  const v = Math.min(Number(s.max), Math.max(Number(s.min), base * (1 + 0.05 * (i + 1))));
  setter.call(s, String(v)); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 0)); rebuilt = 0; const t0 = performance.now(); s.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); const tSync = performance.now() - t0;
  while (!rebuilt && performance.now() - t0 < 3000) await new Promise(r => setTimeout(r, 2));
  await new Promise(r => requestAnimationFrame(r));
  times.push(performance.now() - t0); rebuilds.push(tSync);
  await new Promise(r => setTimeout(r, 150));
}
const q = [...times].sort((a, b) => a - b);
return { knob: s.closest('label, div')?.textContent?.trim().slice(0, 30), median: q[7].toFixed(0), p95: q[14].toFixed(0), all: times.map(t => t.toFixed(0)).join(' '), rebuildAt: rebuilds.map(t => t.toFixed(0)).join(' '), hooked: !!vp };
