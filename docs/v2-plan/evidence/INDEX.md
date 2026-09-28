# Evidence index (WP27)

Where the proof for each part of the plan lives. Evidence tags as everywhere: [RAN] executed and read,
[SAW] captured image looked at, [PROXY] indirect, [UNVERIFIED] not checked. The item-by-item history with dates is
`docs/v2-plan/27-GAP-AUDIT.md`; current status is `STATE.md`.

## Automated tests — [RAN] `bash tools/gate.sh` (tsc + 543 tests, 2026-09-29)

| Area (plan) | Test files |
| --- | --- |
| Document format, validation, controls/knobs (01, 04) | v2-document, v2-model, v2-controls, v2-signature, v2-inspector-values, v2-knob-pairs |
| Graph semantics, groups (06) | v2-analyze, v2-expand, v2-registry, v2-group-selection, v2-user-components |
| Simulation (07) | v2-particles, v2-random, v2-noise, v2-clock, v2-billboard-life, v2-life-gradient, v2-particle-trails |
| Paths and ribbons (05, 08) | v2-paths, v2-path-nodes, v2-branches, v2-radial-path, v2-ring-path, v2-ribbon-geometry, v2-ribbon-framing, v2-path-view, v2-path-framing |
| Compilers | v2-to-particles, v2-to-paths, v2-integration, v2-preview-mode, v2-visual-audio-handled, v2-effect-time-curve |
| Materials, glow, assets (09, 10) | v2-sprite-library, v2-glow, v2-import-texture, v2-import-mesh |
| Audio (11, parked for tuning) | v2-audio-graph, v2-audio-mix, v2-audio-synthesis, v2-audio-transport, v2-edge-mix |
| Editor (12) | v2-history, v2-selection, editor |
| Persistence, packs (13) | v2-persistence, v2-vfxpack, v2-examples |
| Migration (14, T33) | v2-migrate |
| Components | v2-components, v2-lightning-fixture, v2-lightning-audio-fixture |
| Agent tooling (MCP) | v2-mcp, v2-frame-stats, v2-image-tools |
| Legacy v1 (preserved) | generator, recipe, bundle, audio, audio-lifecycle |

## Visual evidence — [SAW]

- Every element family: frames rendered with `node mcp/run-steps.mjs mcp/examples/<recipe>.steps.json` land in
  `work/mcp/frames/`; the families were each looked at while built (27-GAP-AUDIT, element entries).
- Flamethrower vs the standalone reference at the reference camera: `work/a05/ref-t*.png` vs
  `work/mcp/frames/flamethrower-t*.png`; A-05 runs 1–6: `work/mcp/frames/a05*-t*.png`.
- Review packet for the user: `REVIEW.md` (contact sheets of every default).

## Measurements — [RAN]

- Performance (T37): `perf-2026-09-29.md` (all ten defaults under 8 ms CPU draw cost at 1920×1080 Balanced).
- Resource plateau (T38) and GPU context-loss recovery (WP24): 27-GAP-AUDIT, WP24 entry.
- Simulation cost per tick: 27-GAP-AUDIT, I12 (worker deferred: < 1 ms average per tick).

## Not verified

- Sound has not been listened to (parked by the user).
- GPU execution time is not isolated in the performance numbers.
- No other browser than Chrome/Edge (Chromium) has been tried.
