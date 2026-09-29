# T01–T40 traceability (18-TEST-MATRIX → tests and evidence), 2026-09-29

Status: ✅ covered by named tests or evidence · ◐ partly · ⏸ parked by user decision · ⏳ needs the user.
Test files are under `tests/` (run: `npm test`; 587 passing at 814920f). Evidence is under `docs/v2-plan/evidence/`.

| ID | Requirement (short) | Status | Where |
| --- | --- | --- | --- |
| T01 | Valid minimal graph; bad versions/types/IDs/NaN/limits/refs | ✅ | v2-document, v2-model, v2-analyze, v2-conformance (F11) |
| T02 | Port type/domain/unit, single-input replace, multi-input order, cycle, recursion | ✅ | v2-analyze, v2-signature, v2-edge-mix, v2-expand |
| T03 | Enable/disable per category, bypass, shared deps, Solo union, disabled group events | ✅ | v2-to-particles, v2-solo (T03), v2-expand |
| T04 | Group expansion equivalence, regroup IDs/randomness, duplicate independence, template isolation | ✅ | v2-conformance (F05, F06, Preserve pattern), v2-group-selection, v2-user-components |
| T05 | Precedence, read-only bound fields, affine mapping, owner conflicts, unbind | ✅ | v2-controls (F09), v2-inspector-values, v2-knob-pairs |
| T06 | Canonical hash ignores layout, detects semantics/assets/version | ✅ | v2-model (T06) |
| T07 | Core/model import no DOM/Three/React; presets use registry nodes only | ✅ | v2-registry, v2-components |
| T08 | PRNG/hash/noise golden vectors, independent streams | ✅ | v2-random, v2-noise, v2-conformance (F05) |
| T09 | Same tick at 30/60/144 Hz, seek vs replay, checkpoints, stale results | ✅ | v2-clock, v2-particles (clone equivalence); no worker, so "cancelled stale results" = generation counters in the editor |
| T10 | Burst once, fractional rate, repeat, event order, fan-out limits | ✅ | v2-particles (F02), v2-to-particles |
| T11 | Fixed-step gravity/drag, world space, coincident anchors, exact endpoints, no NaN | ◐ | v2-particles (F03), v2-paths. Local space is rejected with a named error, not implemented (decision). |
| T12 | Ground collision, max bounces, resting, child emission position/identity | ✅ | v2-particles (in-step bounce test), v2-to-particles, v2-conformance (F07) |
| T13 | Trail lifespan, death events, empty at document end | ✅ | v2-particle-trails, v2-particles (F04) |
| T14 | Worker crash/restart, superseded revisions, buffers | ⏸ | Worker deferred by measurement: every component simulates < 1 ms/tick average, ≤ 4.5 ms worst tick (27-GAP-AUDIT I12). Stopped-simulation Retry preview exists. |
| T15 | Hard budgets estimated/enforced, no silent truncation | ✅ | v2-to-particles, v2-to-paths (MAX_PREVIEW_PATHS), budgets-2026-09-29.md, runtime mesh/trail/light limit errors [RAN] |
| T16 | UV order, flipbook first/last, no wrap, padding, color/data roles | ✅ | v2-sprite-library, v2-billboard-life, v2-conformance (F08), v2-asset-roles |
| T17 | Dissolve endpoints, alpha modes, rim, enhancement fallbacks | ◐ | v2-portability, v2-to-particles. The dissolve shader is render-checked (tools/render-smoke.mjs); no pixel assertion. |
| T18 | Valid/invalid PNG/WebP/JPEG/GLB/WAV headers and limits | ◐ | v2-import-texture, v2-import-mesh. WAV import is ⏸ (sound parked). |
| T19 | Duplicate interpretation, hash match/mismatch, relink, deletion refs | ✅ | v2-asset-refs (T19), v2-mcp |
| T20 | Every included asset has provenance/rights and a thumbnail | ✅ | assets/sprites/manifest.json (provenance, license, thumbnail); [SAW] assets/sprites/preview.html |
| T21 | Audio generator vectors, filter coefficients, resampling, pan, duration | ✅ | v2-audio-synthesis, v2-audio-mix |
| T22 | Finite PCM, limiter, silent boundaries, WAV header/sample count | ✅ | v2-audio-mix, v2-conformance (F10) |
| T23 | Cue ticks match visual events | ✅ | v2-audio-graph, v2-lightning-audio-fixture |
| T24 | Audio unlock, resume, restart, pause, hidden tab, stale callbacks | ✅ | v2-audio-transport, audio-lifecycle |
| T25 | Per-family audition + sync | ⏸ | Sound parked (user, 2026-09-27) |
| T26 | Default open, Blank composition, auto-wire choice, mixed effect, block reuse | ✅ | v2-components, v2-user-components, v2-mcp; Library panel [RAN] |
| T27 | Numeric drafts, slider transaction, undo no-op, field reset | ✅ | v2-history, v2-inspector-values |
| T28 | Curve/gradient mouse + keyboard editing, invalid points, driven controls | ◐ | CurveEditor has a numeric key table [SAW earlier]; model rules in v2-effect-time-curve/v2-life-gradient; no DOM test |
| T29 | Graph shortcuts, outline, focus/error navigation, reduced effects | ◐ | Implemented (GraphCanvas, OutlinePanel, focusDiagnostic, prefers-reduced-motion); checked by hand, no automated UI test |
| T30 | Save/reload, revisions, corrupt recovery, quota failure, stale tab | ✅ | v2-persistence (T10/T11 cases, quota), two-tab check [RAN] |
| T31 | Fresh-origin package round trip incl. built-ins | ✅ | v2-vfxpack (T31) |
| T32 | ZIP paths, duplicates, checksums, decompression limits, versions | ✅ | v2-vfxpack, bundle |
| T33 | Legacy v1 unchanged, conversion report, ten mappings | ✅ | v2-migrate (T33) |
| T34 | Original vs graph lightning clips, solo, angles, enhancement-off | ✅ | evidence/gate-B |
| T35 | Fire/water/shadow material gates and variants | ◐ | evidence/gate-D. User approved the defaults; variant approval pending. |
| T36 | Ten families × three configurations × phase/angle/background | ✅ | evidence/gate-D (120 sheets; 30 kept in repo) |
| T37 | Latency/FPS/graph benchmarks with hardware metadata | ◐ | perf-2026-09-29.md (draw cost), perf-compile-seek-2026-09-29.md (compile/seek/load). Focused-window fps and the 200-node graph benchmark are open. |
| T38 | 100 casts, cycles, remount, resize, context loss, plateau | ✅ | 27-GAP-AUDIT WP24 entry (100 loads, heap without trend, context loss [RAN]) |
| T39 | Artist task without code | ◐ | User editor test 2026-09-29 ("everything seems to work"); a new mixed effect built by the user is not recorded |
| T40 | Model build test A-05 | ⏳ | Runs 1–6 recorded in STATE.md; run 6 awaits the user's visual verdict |
