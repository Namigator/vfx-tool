// 15-PERFORMANCE "Restart-required edit/compile p95 ≤ 250 ms" and "Default seek p95 ≤ 200 ms": measures, for every
// built-in component in a blank effect, (a) an edit + full recompile (particles + paths at tick 0; a fresh JSON copy
// each time so no compile cache helps) and (b) a seek to a random tick: simulation replay of every system plus the
// path compile at that tick — both cold from tick 0 (worst case, first seek) and from the nearest 30-tick checkpoint
// (what the viewport does after the first pass). CPU-only in Node: rendering is measured separately (perf-*.md).
// Run: node tools/perf-report.ts
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { COMPONENT_TEMPLATES, insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { ParticleSimulation } from '../src/runtime/particles.ts';
import { choosePreviewMode } from '../src/render/previewMode.ts';
import type { EffectDocumentV2 } from '../src/model/types.ts';

const REPS = 20, CHECKPOINT = 30;
const p95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/** The edit: nudge the first numeric Emitter/knob value, as a user would, on a fresh copy of the document. */
function edited(doc: EffectDocumentV2, i: number): EffectDocumentV2 {
  const d = JSON.parse(JSON.stringify(doc)) as EffectDocumentV2;
  const c = d.controls.find(x => typeof x.value === 'number' && x.bindings.length);
  if (c && typeof c.value === 'number') { const lo = c.min ?? c.value, hi = c.max ?? c.value; c.value = Math.min(hi, Math.max(lo, c.value * (1 - 0.002 * i))); } // unique value per edit: no cache can help
  return d;
}

const rows: string[] = [], allCompile: number[] = [], allSeekCold: number[] = [], allSeekCp: number[] = [];
for (const t of COMPONENT_TEMPLATES) {
  const { doc } = insertComponent(createBlankDocument(), t.id, undefined, { group: true });
  const mode = choosePreviewMode(doc).mode;
  const compile = (d: EffectDocumentV2) => {
    const p = compileParticlePreview(d, { audioHandled: true, ribbonsHandled: true });
    if (mode !== 'points') compilePathPreview(d, 0, { audioHandled: true });
    return p;
  };
  compile(edited(doc, 0)); // warm-up (JIT), not counted
  const cTimes: number[] = [];
  for (let i = 1; i <= REPS; i++) { const d = edited(doc, i); const t0 = performance.now(); compile(d); cTimes.push(performance.now() - t0); }
  const plan = compileParticlePreview(doc, { audioHandled: true, ribbonsHandled: true });
  const descriptors = plan.ok ? plan.value.systems.map(s => s.descriptor) : [];
  const seek = (tick: number, from: number) => {
    const t0 = performance.now();
    for (const d of descriptors) {
      const r = ParticleSimulation.create(d); if (!r.ok) continue;
      const end = Math.min(tick, d.durationTicks);
      // From a checkpoint: only the ticks after it are simulated (the clone itself is ~free next to a tick).
      const start = Math.min(from, end);
      for (let k = 0; k < end - start; k++) r.value.step();
    }
    if (mode !== 'points') compilePathPreview(doc, tick, { audioHandled: true });
    return performance.now() - t0;
  };
  seek(doc.durationTicks, 0);
  const cold: number[] = [], cp: number[] = [];
  for (let i = 0; i < REPS; i++) {
    const tick = Math.floor(rnd() * doc.durationTicks);
    cold.push(seek(tick, 0));
    cp.push(seek(tick, tick - (tick % CHECKPOINT)));
  }
  allCompile.push(...cTimes); allSeekCold.push(...cold); allSeekCp.push(...cp);
  rows.push(`| ${t.id} | ${doc.durationTicks} | ${med(cTimes).toFixed(1)} | ${p95(cTimes).toFixed(1)} | ${p95(cold).toFixed(1)} | ${p95(cp).toFixed(1)} |`);
}
const date = new Date().toISOString().slice(0, 10);
const summary = `Across all ${COMPONENT_TEMPLATES.length} components (${allCompile.length} samples each): edit+compile p95 **${p95(allCompile).toFixed(1)} ms** (target ≤ 250), seek p95 cold-from-0 **${p95(allSeekCold).toFixed(1)} ms**, from checkpoint **${p95(allSeekCp).toFixed(1)} ms** (target ≤ 200).`;
const out = `# Edit/compile and seek timings — ${date} (15-PERFORMANCE, CPU side)

Environment: Node ${process.version}, ${cpus()[0].model} × ${cpus().length}, Windows. Reproduce: \`node tools/perf-report.ts\`.
Method: see the header of tools/perf-report.ts. ${REPS} samples per component after one warm-up; each edit compiles a fresh JSON copy (no cache hits).
Scope: CPU work only (compile, simulation replay, path compile). Rendering cost per frame is in perf-2026-09-29.md; the browser adds React/three.js upload work not measured here.

${summary}

| Component | ticks | compile median ms | compile p95 ms | seek p95 cold ms | seek p95 checkpoint ms |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
writeFileSync(`docs/v2-plan/evidence/perf-compile-seek-${date}.md`, out);
console.log(summary);
