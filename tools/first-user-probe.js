// P-04 first-time-user check on the deployed site: New -> add Flame jet from Components -> play -> export each
// engine. Downloads are captured in the page (anchor click on a blob URL) and returned as base64.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const btn = (re, root = document) => [...root.querySelectorAll('button, [role=tab], [role=menuitem]')].filter(vis).find(b => re.test(b.getAttribute('aria-label') || b.textContent.trim()));
async function click(el) {
  el.scrollIntoView({ block: 'center' }); await sleep(80);
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(500);
}
const blobs = new Map(), downloads = [], errors = [];
const mk = URL.createObjectURL.bind(URL);
URL.createObjectURL = b => { const u = mk(b); blobs.set(u, b); return u; };
const aclick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { if (this.download && blobs.has(this.href)) { downloads.push({ name: this.download, blob: blobs.get(this.href) }); return; } return aclick.call(this); };
addEventListener('error', e => errors.push(String(e.message)));
addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
const steps = [];
const step = (name, ok, detail = '') => steps.push({ name, ok: !!ok, detail: String(detail).slice(0, 200) });
await sleep(2500);
const nodesBefore = document.querySelectorAll('.react-flow__node').length;
await click(btn(/^New$/)); await sleep(800);
const nodesNew = document.querySelectorAll('.react-flow__node').length;
step('New gives an empty effect', nodesNew <= 1, `nodes ${nodesBefore} -> ${nodesNew}`);
await click(btn(/^Components$/));
const card = [...document.querySelectorAll('[aria-label=Library] *')].filter(vis).find(e => /^Flame jet/.test(e.innerText?.trim() ?? '') && btn(/^Add$/, e));
step('Flame jet listed under Components', card);
if (card) await click(btn(/^Add$/, card));
await sleep(1500);
const nodesAdded = document.querySelectorAll('.react-flow__node').length;
step('Adding it puts nodes on the graph', nodesAdded > nodesNew, `nodes ${nodesAdded}`);
const play = btn(/^Play$/); if (play) { await click(play); await sleep(1500); }
const engines = ['Roblox', 'Unreal', 'Unity', 'Godot'];
for (const eng of engines) {
  const n0 = downloads.length;
  await click(btn(/^Export$/));
  const item = btn(new RegExp(`^Export ${eng}$`));
  if (!item) { step(`Export ${eng} in the menu`, false); continue; }
  await click(item);
  for (let i = 0; i < 60 && downloads.length === n0; i++) await sleep(250);
  // Some exports open a dialog with a confirm button first.
  if (downloads.length === n0) { const go = btn(/^(Export|Download|Save)( .*)?$/, document.querySelector('[role=dialog]') ?? document.body); if (go && go !== item) { await click(go); for (let i = 0; i < 60 && downloads.length === n0; i++) await sleep(250); } }
  const d = downloads[n0];
  step(`Export ${eng} downloads a file`, d, d ? `${d.name} ${d.blob.size} B` : document.querySelector('[role=dialog]')?.innerText?.slice(0, 160) ?? 'no download');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);
}
const b64 = async b => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const files = [];
for (const d of downloads) files.push({ name: d.name, size: d.blob.size, data: await b64(d.blob) });
step('No page errors', !errors.length, errors.join(' | '));
return { steps, files };
