// Shared page-side helpers for tools/ui-test.mjs probes (concatenated in front of each probe, evaluated by
// ~/.claude/tools/cdp-eval.mjs). Input goes through `cdp(...)` (trusted DevTools input), never synthetic events.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 160) }); };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const byText = (sel, re, root = document) => $$(sel, root).find(e => re.test(e.textContent.trim()));
const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
async function click(el) {
  el.scrollIntoView({ block: 'center' }); await sleep(50);
  const [x, y] = center(el);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(120);
}
async function drag(el, dx, dy, steps = 6, button = 'left') {
  const buttons = { left: 1, right: 2, middle: 4 }[button];
  el.scrollIntoView({ block: 'center' }); await sleep(50);
  const [x, y] = center(el);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 });
  for (let i = 1; i <= steps; i++) await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * i / steps, y: y + dy * i / steps, button, buttons });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button, clickCount: 1 });
  await sleep(150);
}
const KEYS = { Enter: 13, Escape: 27, Tab: 9, Delete: 46, Backspace: 8, a: 65, d: 68, f: 70, z: 90 };
async function key(k, modifiers = 0) {
  const code = KEYS[k] ?? k.toUpperCase().charCodeAt(0);
  const base = { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(80);
}
/** Click a field, select all, type text, press Enter: what a keyboard user does. */
async function typeInto(el, text) {
  await click(el);
  await key('a', 2); // Ctrl+A
  await cdp('Input.insertText', { text });
  await key('Enter');
  await sleep(150);
}
/** The autosaved draft document (written ~400 ms after each edit). */
async function savedDoc() {
  await sleep(700);
  const raw = localStorage.getItem('vfx-studio.v2.draft');
  if (!raw) return null;
  const v = JSON.parse(raw);
  return v.graphs ? v : v.document ?? v.doc ?? v;
}
const nodeIn = (doc, id) => doc?.graphs?.flatMap(g => g.nodes).find(n => n.id === id);
/** Select a node through the Outline list; `match` is part of its id, label or "(Type)". */
async function selectNode(match) {
  await click(byText('.pv2-tab', /^Outline$/));
  const b = $$('.ol-name').find(x => (x.title || '').includes(match) || x.textContent.includes(match));
  if (!b) throw new Error(`outline has no ${match}: ${$$('.ol-name').map(x => x.title).join(' | ').slice(0, 300)}`);
  await click(b);
  await click(byText('.pv2-tab', /^Node$/));
  await sleep(200);
}
/** Wait until the loaded document's graph is drawn and fitted (the first frame shows only the anchors). */
async function ready() {
  let last = '', same = 0;
  for (let i = 0; i < 40 && same < 3; i++) {
    await sleep(250);
    const now = $$('.react-flow__node').length + '|' + ($('.react-flow__viewport')?.style.transform ?? '');
    same = now === last && $$('.react-flow__node').length > 3 ? same + 1 : 0; last = now;
  }
}
