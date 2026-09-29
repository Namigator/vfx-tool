# Edit/compile and seek timings — 2026-09-29 (15-PERFORMANCE, CPU side)

Environment: Node v24.3.0, AMD Ryzen 5 3600 6-Core Processor               × 12, Windows. Reproduce: `node tools/perf-report.ts`.
Method: see the header of tools/perf-report.ts. 20 samples per component after one warm-up; each edit compiles a fresh JSON copy (no cache hits).
Scope: CPU work only (compile, simulation replay, path compile). Rendering cost per frame is in perf-2026-09-29.md; the browser adds React/three.js upload work not measured here.

Across all 49 components (980 samples each): edit+compile p95 **52.2 ms** (target ≤ 250), seek p95 cold-from-0 **88.1 ms**, from checkpoint **5.5 ms** (target ≤ 200).

| Component | ticks | compile median ms | compile p95 ms | seek p95 cold ms | seek p95 checkpoint ms |
| --- | --- | --- | --- | --- | --- |
| spark-burst | 142 | 11.3 | 12.9 | 8.6 | 2.8 |
| flame-jet | 180 | 13.1 | 15.1 | 154.7 | 4.2 |
| smoke-plume | 450 | 6.1 | 7.7 | 182.7 | 2.1 |
| fountain | 312 | 8.5 | 10.8 | 29.8 | 1.9 |
| rain-splash | 320 | 13.7 | 16.7 | 58.4 | 5.6 |
| impact-flash | 120 | 12.4 | 14.6 | 3.6 | 2.5 |
| arc-beam | 120 | 10.1 | 12.5 | 0.9 | 0.8 |
| rock-burst | 150 | 11.6 | 17.4 | 9.6 | 3.8 |
| charge-up | 166 | 9.8 | 14.3 | 31.9 | 5.5 |
| tornado | 364 | 8.1 | 10.7 | 98.1 | 3.4 |
| ice-shards | 150 | 17.1 | 22.0 | 11.0 | 4.9 |
| poison-cloud | 410 | 12.6 | 14.8 | 119.6 | 0.9 |
| shadow-vortex | 258 | 11.9 | 14.1 | 53.8 | 2.7 |
| holy-light | 120 | 13.5 | 17.3 | 2.5 | 0.3 |
| helix-beam | 120 | 8.0 | 9.4 | 0.7 | 0.6 |
| charge-tethers | 120 | 9.4 | 12.5 | 5.4 | 3.8 |
| spark-aftershock | 122 | 10.1 | 13.5 | 21.3 | 3.5 |
| lightning-strike | 144 | 51.8 | 57.8 | 12.4 | 9.4 |
| lightning-thin-fork | 144 | 48.1 | 59.9 | 10.0 | 7.7 |
| lightning-heavy-strike | 144 | 51.1 | 60.0 | 15.0 | 5.5 |
| fire-jet | 216 | 26.8 | 32.0 | 136.4 | 4.0 |
| fire-torch | 180 | 25.7 | 33.7 | 59.2 | 6.1 |
| fire-burst | 153 | 29.4 | 35.2 | 58.7 | 9.6 |
| water-stream | 180 | 46.8 | 53.2 | 11.1 | 2.0 |
| water-narrow | 180 | 42.0 | 56.0 | 5.6 | 1.9 |
| water-broad | 180 | 46.9 | 57.2 | 13.2 | 2.0 |
| shadow-collapse | 228 | 26.4 | 37.3 | 14.2 | 2.9 |
| shadow-puff | 150 | 20.0 | 28.1 | 14.0 | 3.2 |
| shadow-tendril | 200 | 42.7 | 45.1 | 11.9 | 2.0 |
| ice-eruption | 192 | 28.7 | 38.9 | 10.3 | 2.0 |
| ice-fan | 192 | 27.8 | 36.1 | 10.9 | 2.4 |
| ice-cluster | 192 | 30.6 | 38.2 | 7.6 | 1.9 |
| earth-upheaval | 216 | 24.5 | 30.0 | 32.4 | 0.7 |
| earth-heavy | 216 | 22.7 | 29.8 | 24.5 | 0.6 |
| earth-gravel | 216 | 22.3 | 29.7 | 19.8 | 0.6 |
| wind-gust | 198 | 20.1 | 26.1 | 6.3 | 1.4 |
| wind-cut | 198 | 17.0 | 22.5 | 5.0 | 0.7 |
| wind-whirl | 198 | 22.2 | 30.8 | 6.0 | 1.3 |
| poison-caustic | 276 | 19.2 | 25.0 | 34.3 | 2.1 |
| poison-pool | 276 | 19.9 | 26.1 | 31.3 | 2.3 |
| poison-plume | 276 | 20.4 | 31.2 | 45.9 | 1.7 |
| light-pulse | 168 | 22.8 | 32.0 | 6.0 | 2.2 |
| light-cone | 168 | 23.5 | 30.7 | 4.5 | 2.2 |
| light-blessing | 193 | 26.7 | 34.1 | 14.6 | 2.5 |
| energy-bolt | 199 | 48.6 | 56.5 | 16.9 | 2.5 |
| energy-needle | 208 | 40.0 | 46.7 | 8.6 | 3.4 |
| energy-orb | 192 | 52.6 | 57.3 | 21.6 | 2.3 |
| flamethrower | 242 | 37.8 | 44.1 | 87.2 | 5.5 |
| fireball | 120 | 33.3 | 38.9 | 96.2 | 28.6 |
## App load (15 "Initial local app usable ≤ 3 s after warm local server load")

In-app browser pane, Chrome 152.0.7977.130, warm Vite dev server (unbundled modules, so slower than a production build). The editor's preview canvas existed **778–807 ms** after navigation start (2 loads; measured with performance.now() and the navigation timing entry). [RAN]

## Not measured here

- "Live appearance edit visible p95 ≤ 100 ms": live edits update uniforms without a recompile. Their time to visible is not isolated from rAF throttling in the hidden pane.
- "Graph interaction with 200 visible nodes ≤ 50 ms p95": not benchmarked. The largest built-in graph is Energy bolt (49 nodes, grouped).
- Playback frame interval: measured on the real GPU in perf-fps-2026-09-29.md (all 49 at 60 fps).

## Before / after the performance pass (same method)

Before: edit+compile p95 128 ms (lightning ~150 ms). Two changes brought it down:
- Validation, analysis and group expansion now run once per edit, shared by the particle compile, the path compile and
  the particle probe (src/graph/prepare.ts). Before, they ran three times per edit.
- The compile-time parent simulation that finds where child particles are born (e.g. flamethrower smoke and embers) is
  cached by the parent's settings (runtime collectParticleEvents).

After: p95 52 ms, with each benchmark edit a unique value so the caches cannot help.
