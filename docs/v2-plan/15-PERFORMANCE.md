# Performance, limits and resource budgets

All numbers here are design limits/acceptance targets, not measured v2 capabilities. Existing CPU-only generator timings do not establish browser performance.

## Hard authoring limits

| Resource | v2 limit |
| --- | --- |
| Duration | 600 ticks / 10 seconds |
| Expanded nodes / edges / group depth | 512 / 1024 / 4 |
| Asset references per document | 128 |
| Live particles across independent systems | 8192 |
| Particle births per cast | 65536 |
| Events per cast / per tick | 8192 / 1024 |
| Individual paths / vertices per path | 256 / 128 |
| Trail samples across effect | 65536 |
| Mesh instances / visible mesh triangles | 512 / 250000 |
| Active point lights | 4 |
| Audio source voices before mix | 64 simultaneous / 512 per cast |
| Decoded textures for active document | 256 MiB including mip estimates |
| Runtime checkpoint cache | 64 MiB |
| Undo patch data / transactions | 20 MiB / 100 |

Compiler estimates conservative upper bounds from rates/windows/lifetimes, repeat counts and event fan-out. A hard violation blocks validated playback/export with per-node cost explanations; allow draft editing. Runtime also guards actual counts and stops the offending system with an error if estimates were insufficient. Never silently truncate user-authored particles to pass performance tests.

## Default-preset budgets

Recommended per default: ≤2000 live particles, ≤96 paths, ≤128 mesh instances, ≤100k visible triangles, ≤2 lights, ≤16 simultaneous audio source layers and ≤150 draw calls. These are preset acceptance budgets, stricter than tool capacity. Component combinations can exceed recommended budgets up to hard limits and show a warning.

Budget impact includes overdraw and shader passes, not just particle count. Full-screen smoke, nested transparent water layers and many bloom pixels can be expensive with few particles. Measure those defaults, do not infer performance from count alone.

## Preview profiles

- Reference: 1920×1080 internal viewport, DPR-independent, bloom full quality, full texture resolution within budget, all authored layers.
- Balanced (default editing): internal pixel count capped at 1920×1080, devicePixelRatio capped 1.5, bloom half-resolution, full authored counts.
- Economy: internal 1280×720 maximum, bloom quarter-resolution or off, texture upload max 1024 with source bytes preserved, optional scene refraction disabled. All simulation identities/counts remain unchanged.

Profiles may change rendering quality, never silently alter the document or seed. No automatic quality switching during a comparison capture. If a default misses the Reference target, report it; Economy is a fallback, not a passing score.

## Targets and benchmark protocol

On a named reference desktop/browser/GPU:
- Live appearance edit visible p95 ≤100 ms.
- Restart-required edit/compile p95 ≤250 ms for default graphs.
- Default seek p95 ≤200 ms across 0–600 ticks after first compile.
- Default playback median frame interval ≤16.7 ms, p95 ≤20 ms at Reference resolution.
- Graph interaction with 200 visible nodes remains ≤50 ms p95 input response.
- Initial local app usable ≤3 s after warm local server load, excluding user-selected large asset decode.

Warm up 30 s, measure 120 s, repeat 3 times. Record viewport resolution, actual render-target sizes, profile, browser version, GPU/driver, CPU, OS, power mode, graph hash, seed and background. Collect frame intervals, main-thread long tasks, worker simulation cost, draw calls and GPU timings only if available.

The user's GPU is presently unknown because system discovery was denied. WP00 records it through available browser/system information; do not assume a GPU from the CPU. Numerical targets remain acceptance targets until tested there.

## Runtime design

Use typed-array structure-of-arrays particle state, pooled IDs, immutable compiled descriptors and buffer reuse. Keep simulation and heavy decode off the UI thread. Do not allocate per-particle React objects or render graph panels at simulation frequency. Throttle diagnostics to 4 Hz; transport display to 10 Hz.

Compile only on authored semantic changes. Structural material changes may compile shaders; ordinary colors/curves update uniforms/textures. Prewarm shader variants for a preset before timing. Warm cache time and cold compile time are separately reported.

## Resource lifetime gate

After 100 casts and 20 cycles through all ten presets, active counts return to empty between completed casts and asset/GPU resources plateau after warm-up. Track application-owned allocations and renderer counters; browser garbage collection alone is not a leak diagnosis. Dispose the entire editor, remount it, and check no old RAF, worker, observer, audio source or context remains active.

After hidden-tab pause, simulation/render scheduling stops apart from editor autosave. Resize and context restore rebuild only necessary resources. A limit error must leave editing, save and diagnostics operational.

