# Edit/compile and seek timings — 2026-09-29 (15-PERFORMANCE, CPU side)

Environment: Node v24.3.0, AMD Ryzen 5 3600 6-Core Processor               × 12, Windows. Reproduce: `node tools/perf-report.ts`.
Method: see the header of tools/perf-report.ts. 20 samples per component after one warm-up; each edit compiles a fresh JSON copy (no cache hits).
Scope: CPU work only (compile, simulation replay, path compile). Rendering cost per frame is in perf-2026-09-29.md; the browser adds React/three.js upload work not measured here.

Across all 49 components (980 samples each): edit+compile p95 **128.0 ms** (target ≤ 250), seek p95 cold-from-0 **85.1 ms**, from checkpoint **5.2 ms** (target ≤ 200).

| Component | ticks | compile median ms | compile p95 ms | seek p95 cold ms | seek p95 checkpoint ms |
| --- | --- | --- | --- | --- | --- |
| spark-burst | 142 | 12.1 | 13.8 | 9.8 | 2.3 |
| flame-jet | 180 | 13.0 | 14.2 | 155.2 | 5.0 |
| smoke-plume | 450 | 6.2 | 7.9 | 192.6 | 2.1 |
| fountain | 312 | 7.7 | 9.4 | 30.4 | 1.4 |
| rain-splash | 320 | 18.2 | 25.3 | 57.8 | 5.1 |
| impact-flash | 120 | 13.5 | 16.5 | 4.1 | 2.3 |
| arc-beam | 120 | 20.9 | 27.5 | 1.0 | 0.9 |
| rock-burst | 150 | 15.9 | 17.5 | 9.0 | 3.7 |
| charge-up | 166 | 11.3 | 13.8 | 35.6 | 5.0 |
| tornado | 364 | 9.6 | 11.1 | 132.5 | 3.8 |
| ice-shards | 150 | 15.0 | 17.8 | 11.5 | 5.0 |
| poison-cloud | 410 | 11.8 | 13.2 | 106.6 | 1.2 |
| shadow-vortex | 258 | 10.4 | 11.6 | 53.6 | 3.2 |
| holy-light | 120 | 12.7 | 14.5 | 2.6 | 0.4 |
| helix-beam | 120 | 15.8 | 21.8 | 0.6 | 0.5 |
| charge-tethers | 120 | 26.8 | 32.2 | 5.2 | 3.9 |
| spark-aftershock | 122 | 17.4 | 21.8 | 21.4 | 5.2 |
| lightning-strike | 144 | 141.4 | 156.4 | 12.0 | 8.3 |
| lightning-thin-fork | 144 | 132.3 | 146.6 | 9.9 | 5.8 |
| lightning-heavy-strike | 144 | 130.1 | 149.2 | 13.2 | 5.0 |
| fire-jet | 216 | 25.8 | 29.9 | 119.1 | 4.6 |
| fire-torch | 180 | 26.0 | 36.0 | 62.2 | 6.0 |
| fire-burst | 153 | 25.9 | 27.9 | 66.1 | 11.9 |
| water-stream | 180 | 76.1 | 86.3 | 11.2 | 2.1 |
| water-narrow | 180 | 72.5 | 82.8 | 4.1 | 1.5 |
| water-broad | 180 | 71.6 | 81.0 | 13.5 | 1.9 |
| shadow-collapse | 228 | 54.4 | 68.8 | 16.2 | 2.8 |
| shadow-puff | 150 | 19.6 | 24.4 | 14.3 | 3.0 |
| shadow-tendril | 200 | 65.7 | 69.8 | 10.2 | 2.1 |
| ice-eruption | 192 | 54.3 | 60.2 | 11.0 | 1.9 |
| ice-fan | 192 | 59.3 | 64.9 | 9.2 | 1.8 |
| ice-cluster | 192 | 58.9 | 75.5 | 6.4 | 1.6 |
| earth-upheaval | 216 | 26.3 | 31.7 | 32.2 | 0.5 |
| earth-heavy | 216 | 31.3 | 33.7 | 30.0 | 0.6 |
| earth-gravel | 216 | 30.2 | 33.1 | 19.2 | 0.4 |
| wind-gust | 198 | 37.5 | 46.2 | 5.7 | 1.0 |
| wind-cut | 198 | 32.9 | 39.7 | 4.4 | 0.7 |
| wind-whirl | 198 | 41.7 | 51.1 | 3.9 | 1.2 |
| poison-caustic | 276 | 23.0 | 25.7 | 34.6 | 2.9 |
| poison-pool | 276 | 21.1 | 24.4 | 26.7 | 2.7 |
| poison-plume | 276 | 24.8 | 27.4 | 46.8 | 1.6 |
| light-pulse | 168 | 41.5 | 47.1 | 6.4 | 2.4 |
| light-cone | 168 | 42.4 | 49.6 | 4.4 | 1.9 |
| light-blessing | 193 | 41.5 | 49.0 | 9.7 | 1.7 |
| energy-bolt | 199 | 75.0 | 87.6 | 14.8 | 2.5 |
| energy-needle | 208 | 69.7 | 76.4 | 9.0 | 2.1 |
| energy-orb | 192 | 81.9 | 94.6 | 25.0 | 2.5 |
| flamethrower | 242 | 118.3 | 132.1 | 73.2 | 5.1 |
| fireball | 120 | 50.6 | 58.9 | 105.5 | 29.3 |

## App load (15 "Initial local app usable ≤ 3 s after warm local server load")

In-app browser pane, Chrome 152.0.7977.130, warm Vite dev server (unbundled modules, so slower than a production build). The editor's preview canvas existed **778–807 ms** after navigation start (2 loads; measured with performance.now() and the navigation timing entry). [RAN]

## Not measured here

- "Live appearance edit visible p95 ≤ 100 ms": live edits update uniforms without a recompile. Their time to visible is not isolated from rAF throttling in the hidden pane.
- "Graph interaction with 200 visible nodes ≤ 50 ms p95": not benchmarked. The largest built-in graph is Energy bolt (49 nodes, grouped).
- Playback frame interval: CPU draw-submission timings are in perf-2026-09-29.md. The pane throttles rAF, so real fps needs a focused browser window (performance pass, post-release).
