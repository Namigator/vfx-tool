// Page-side probe for tools/perf-graph200.mjs (evaluated by cdp-eval with trusted input): with >= 200 nodes drawn,
// measures input response = time from sending a mouse event to the first painted frame that shows its result,
// for selecting nodes, dragging a node and panning. Each sample includes the DevTools round trip (pessimistic).
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10; };
async function untilPainted(cond, t0, limit = 2000) {
  while (performance.now() - t0 < limit) { await frame(); if (cond()) { await frame(); return performance.now() - t0; } }
  return NaN;
}
// Wait for the whole graph to be drawn and fitted.
let last = '', same = 0;
for (let i = 0; i < 80 && same < 4; i++) { await sleep(250); const now = document.querySelectorAll('.react-flow__node').length + '|' + document.querySelector('.react-flow__viewport')?.style.transform; same = now === last ? same + 1 : 0; last = now; }
const usableMs = Math.round(performance.now());
const nodes = [...document.querySelectorAll('.react-flow__node')];
// Nodes whose centre is actually on top (not covered by another node) and inside the canvas.
const pane = document.querySelector('.react-flow').getBoundingClientRect();
const clickable = nodes.filter(n => { const r = n.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return x > pane.left && x < pane.right && y > pane.top && y < pane.bottom && document.elementFromPoint(x, y)?.closest('.react-flow__node') === n; });
const at = n => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

const select = [];
for (let i = 0; i < 30; i++) {
  const n = clickable[(i * 7) % clickable.length], [x, y] = at(n);
  const t0 = performance.now();
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  select.push(await untilPainted(() => n.classList.contains('selected'), t0));
  await sleep(60);
}
const dragNode = clickable[0]; let [dx, dy] = at(dragNode);
const drag = [];
await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: dx, y: dy, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 30; i++) {
  const before = dragNode.style.transform, t0 = performance.now();
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dx + i * 4, y: dy + (i % 2 ? 3 : -3), button: 'left', buttons: 1 });
  drag.push(await untilPainted(() => dragNode.style.transform !== before, t0));
}
await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dx + 120, y: dy, button: 'left', clickCount: 1 });
await sleep(300);
const vp = document.querySelector('.react-flow__viewport'), px = pane.left + 30, py = pane.bottom - 30;
const pan = [];
await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'middle', buttons: 4, clickCount: 1 });
for (let i = 1; i <= 30; i++) {
  const before = vp.style.transform, t0 = performance.now();
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px + i * 5, y: py - i * 2, button: 'middle', buttons: 4 });
  pan.push(await untilPainted(() => vp.style.transform !== before, t0));
}
await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px + 150, y: py - 60, button: 'middle', clickCount: 1 });
const stat = a => ({ n: a.filter(Number.isFinite).length, missed: a.filter(v => !Number.isFinite(v)).length, p50: q(a.filter(Number.isFinite), 0.5), p95: q(a.filter(Number.isFinite), 0.95), max: q(a.filter(Number.isFinite), 1) });
return { drawnNodes: nodes.length, clickable: clickable.length, usableMs, select: stat(select), drag: stat(drag), pan: stat(pan), ua: navigator.userAgent, dpr: devicePixelRatio, size: [innerWidth, innerHeight] };
