// Render smoke test (tests cannot compile GLSL): renders one mid-effect frame of components that exercise each preview
// path — textured billboards, ribbons, lit meshes, liquid ribbons — and fails if any frame is nearly empty (a shader
// compile error blanks its layers). Needs the dev server. Run after any change under src/render/: node tools/render-smoke.mjs
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const cases = [['flamethrower', 60, 3], ['lightning-strike', 27, 1.5], ['earth-upheaval', 60, 3], ['water-stream', 60, 1.5], ['energy-bolt', 40, 0.5]];
const steps = cases.flatMap(([c, tick]) => [['vfx_new_document', { template: 'blank', id: `smoke-${c}` }], ['vfx_add_component', { docId: `smoke-${c}`, component: c, group: true }], ['vfx_render_frames', { docId: `smoke-${c}`, ticks: [tick], width: 480, height: 270 }, true]]);
writeFileSync('work/render-smoke.steps.json', JSON.stringify(steps));
const out = spawnSync(process.execPath, ['mcp/run-steps.mjs', 'work/render-smoke.steps.json'], { encoding: 'utf8', timeout: 300_000 }).stdout ?? '';
const lit = [...out.matchAll(/tick \d+: lit ([\d.]+)% of frame/g)].map(m => Number(m[1]));
let bad = 0;
cases.forEach(([c, , min], i) => { const v = lit[i]; const ok = v !== undefined && v >= min; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${c}: lit ${v ?? 'none'}% (min ${min}%)`); });
if (bad || lit.length !== cases.length) { console.log('RENDER SMOKE FAILED'); process.exit(1); }
console.log('RENDER SMOKE OK');
