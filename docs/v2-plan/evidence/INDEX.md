# Evidence index (WP27)

Where the proof for each part of the plan lives. Evidence tags as everywhere: [RAN] executed and read,
[SAW] captured image looked at, [PROXY] indirect, [UNVERIFIED] not checked. The item-by-item history with dates is
`docs/v2-plan/27-GAP-AUDIT.md`; current status is `STATE.md`.

Requirement-by-requirement map (T01–T40): `TRACEABILITY.md`.

## Automated tests — [RAN] `bash tools/gate.sh` (tsc + 581 tests, 2026-09-29)

| Area (plan) | Test files |
| --- | --- |
| Document format, validation, controls/knobs (01, 04) | v2-document, v2-model, v2-controls, v2-signature, v2-inspector-values, v2-knob-pairs |
| Graph semantics, groups (06) | v2-analyze, v2-expand, v2-registry, v2-group-selection, v2-user-components, v2-solo, v2-graph-ops |
| Conformance fixtures (22) | v2-conformance (F05–F08, F10, F11); F01–F04 in v2-particles / v2-to-particles, F09 in v2-controls |
| Simulation (07) | v2-particles, v2-random, v2-noise, v2-clock, v2-billboard-life, v2-life-gradient, v2-particle-trails |
| Paths and ribbons (05, 08) | v2-paths, v2-path-nodes, v2-branches, v2-radial-path, v2-ring-path, v2-ribbon-geometry, v2-ribbon-framing, v2-path-view, v2-path-framing |
| Compilers | v2-to-particles, v2-to-paths, v2-integration, v2-preview-mode, v2-visual-audio-handled, v2-effect-time-curve |
| Materials, glow, assets (09, 10) | v2-sprite-library, v2-glow, v2-import-texture, v2-import-mesh, v2-asset-refs, v2-asset-roles, v2-portability |
| Audio (11, parked for tuning) | v2-audio-graph, v2-audio-mix, v2-audio-synthesis, v2-audio-transport, v2-edge-mix |
| Editor (12) | v2-history, v2-selection, v2-timeline |
| Persistence, packs (13) | v2-persistence, v2-vfxpack, v2-examples |
| Migration (14, T33) | v2-migrate |
| Components | v2-components, v2-lightning-fixture, v2-lightning-audio-fixture |
| Agent tooling (MCP) | v2-mcp, v2-frame-stats, v2-image-tools |
| Old effect format (import only) | generator, recipe, bundle, audio, audio-lifecycle |

## Visual evidence — [SAW]

- Every element family: frames rendered with `node mcp/run-steps.mjs mcp/examples/<recipe>.steps.json` land in
  `work/mcp/frames/`; the families were each looked at while built (27-GAP-AUDIT, element entries).
- Flamethrower vs the standalone reference at the reference camera: `work/a05/ref-t*.png` vs
  `work/mcp/frames/flamethrower-t*.png`; A-05 runs 1–6: `work/mcp/frames/a05*-t*.png`.
- Review packet for the user: `REVIEW.md` and `review.html` (contact sheets plus "Watch it play" links).
- Gate B (lightning original vs graph, T34): `gate-B/README.md`.
- Gate D (30 components × 2 orbits × dark/light, T36): `gate-D/README.md` (30 sheets kept, full set reproducible).
- Included sprite library (T20): `assets/sprites/preview.html` (17 sheets on dark, checker and light).
- Render smoke check after shader changes: `node tools/render-smoke.mjs` (one frame per preview path).

## Measurements — [RAN]

- Performance (T37): `perf-2026-09-29.md` (all ten defaults under 8 ms CPU draw cost at 1920×1080 Balanced);
  `perf-compile-seek-2026-09-29.md` (edit+compile p95 128 ms, seek p95 85 ms cold / 5 ms checkpointed, app ~0.8 s).
- Default-preset budgets (15): `budgets-2026-09-29.md` (all 49 components within budget).
- Resource plateau (T38) and GPU context-loss recovery (WP24): 27-GAP-AUDIT, WP24 entry.
- Simulation cost per tick: 27-GAP-AUDIT, I12 (worker deferred: < 1 ms average per tick).

## Not verified

- Sound has not been listened to (parked by the user).
- GPU execution time is not isolated in the performance numbers.
- No other browser than Chrome/Edge (Chromium) has been tried.
