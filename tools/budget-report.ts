// 15-PERFORMANCE default-preset budgets: measures every built-in component (inserted into a blank effect) —
// peak live particles, paths and path points per tick, mesh instances, lights active at once, trail samples and a
// draw-call estimate — and writes docs/v2-plan/evidence/budgets-<date>.md.
// Run: node --experimental-strip-types --no-warnings tools/budget-report.ts
import { writeFileSync } from 'node:fs';
import { COMPONENT_TEMPLATES, insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { ParticleSimulation } from '../src/runtime/particles.ts';
import { choosePreviewMode } from '../src/render/previewMode.ts';

const BUDGET = { live: 2000, paths: 96, meshes: 128, lights: 2, draws: 150 };
const rows: string[] = [];
for (const c of COMPONENT_TEMPLATES) {
  const { doc } = insertComponent(createBlankDocument(), c.id, undefined, { group: true });
  const mode = choosePreviewMode(doc).mode;
  const p = compileParticlePreview(doc, { audioHandled: true, ribbonsHandled: true });
  let live = 0, meshPeak = 0, trailSamples = 0;
  const layers = p.ok ? p.value : undefined;
  if (layers) {
    const sims = layers.systems.map(s => { const r = ParticleSimulation.create(s.descriptor); return r.ok ? { id: s.id, sim: r.value } : undefined; }).filter(x => x !== undefined);
    const meshSystems = new Set(layers.meshes.map(m => m.systemId));
    const trailByLayer = layers.trails.map(t => ({ sys: t.systemId, per: Math.min(t.historyTicks, t.maxPoints) }));
    for (let t = 0; t < doc.durationTicks; t++) {
      let now = 0, meshNow = 0, trailNow = 0;
      for (const s of sims) {
        if (s.sim.tick < s.sim.descriptor.durationTicks) s.sim.step();
        const n = s.sim.snapshot().particles.length;
        now += n; if (meshSystems.has(s.id)) meshNow += n;
        for (const tr of trailByLayer) if (tr.sys === s.id) trailNow += n * tr.per;
      }
      live = Math.max(live, now); meshPeak = Math.max(meshPeak, meshNow); trailSamples = Math.max(trailSamples, trailNow);
    }
  }
  let paths = 0, points = 0, ribbons = 0;
  if (mode !== 'points') for (let t = 0; t < doc.durationTicks; t += 2) {
    const r = compilePathPreview(doc, t, { audioHandled: true });
    if (!r.ok) continue;
    ribbons = Math.max(ribbons, r.value.layers.filter(l => l.active).length);
    const act = r.value.layers.filter(l => l.active).flatMap(l => l.paths);
    paths = Math.max(paths, act.length); points = Math.max(points, act.reduce((n, x) => n + x.points.length, 0));
  }
  const lights = layers ? Math.max(0, ...Array.from({ length: doc.durationTicks }, (_, t) => layers.lights.filter(l => t >= l.startTick && t < l.endTick).length)) : 0;
  const draws = (layers ? layers.layers.length + layers.meshes.length + layers.trails.length : 0) + ribbons;
  const over = [live > BUDGET.live && 'particles', paths > BUDGET.paths && 'paths', meshPeak > BUDGET.meshes && 'meshes', lights > BUDGET.lights && 'lights', draws > BUDGET.draws && 'draws'].filter(Boolean);
  rows.push(`| ${c.label} | ${live} | ${paths} / ${points} | ${meshPeak} | ${lights} | ${trailSamples} | ${draws} | ${over.length ? `**over: ${over.join(', ')}**` : 'within'} |`);
  console.log(c.id, live, paths, meshPeak, lights, draws, over.join(','));
}
const date = new Date().toISOString().slice(0, 10);
writeFileSync(`docs/v2-plan/evidence/budgets-${date}.md`, `# Default-component budgets (${date})

15-PERFORMANCE preset budgets: ≤${BUDGET.live} live particles, ≤${BUDGET.paths} paths, ≤${BUDGET.meshes} mesh instances, ≤${BUDGET.lights} lights, ≤${BUDGET.draws} draw calls.
[RAN] \`node --experimental-strip-types --no-warnings tools/budget-report.ts\`: each component inserted into a blank effect,
simulated tick by tick (peaks over the whole effect). Draw calls are an estimate (one per billboard/mesh/trail layer and
active ribbon layer; bloom passes not counted). Hard limits (8192 live, 256 paths, 512 mesh instances, 4 lights,
65536 trail samples) are enforced separately.

| Component | Peak live particles | Peak paths / points | Peak mesh instances | Lights at once | Peak trail samples | Draw calls | Budget |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`);
