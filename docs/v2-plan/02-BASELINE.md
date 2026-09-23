# Baseline and reference preservation

## Current evidence

- [RAN — historical] The v1 project had 46 passing Node tests, a passing TypeScript check and production build, and HTTP 200 on port 5174. These were not rerun solely for this planning task.
- [PROXY] v1 contains ten family generators, a Three.js viewport, simple materials, synthesized mono sound, parameter controls, history, JSON and a base64-WAV bundle.
- [UNVERIFIED by agent / user-reported failure] User inspected v1 and found multiple effects unacceptable, specifically fire, water and shadow, and a large lightning quality regression.
- [SAW] During planning, the preserved lightning-preview.png was opened and inspected. It shows the original demo's CHARGING phase in a narrow viewport. It is NOT a discharge reference capture.
- [RAN] Original lightning source was inspected. Its four stroke passes, main/fork paths, spark streaks, charge, rapid reveal, flicker, ground illumination, ring, camera impulse, flash and layered sound are identifiable in source.
- [RAN] The F project is not currently a Git repository. Do not assume commits or branches already exist.
- [UNVERIFIED] GPU/RAM discovery through CIM was denied. Existing CPU sampling report identifies a Ryzen 5 3600, but this does not establish GPU capability.
- [RAN] The instructed doctor.ps1 is absent. Do not repeatedly invoke a missing utility.

## Preserved reference

The handoff includes copies of the original lightning HTML, WAV and preview image under references/original-lightning/. Source before copying:
C:\Users\itonk\Documents\Codex\2026-09-23\iu-x20\outputs

The manifest records SHA-256 hashes. Keep these originals immutable. Any capture controls added later belong to a separate harness copy. The original is a Canvas 2D renderer with projected 3D coordinates, pixel-width strokes and screen-space glow, not a Three.js scene.

The reference is not replaced by a screenshot. Capture its full charge → discharge → impact → decay cycle at desktop resolution during the first implementation package. Normalize screen framing and timing for side-by-side evaluation, then check the new 3D version from other angles.

## Retain, adapt, replace

| Area | Action |
| --- | --- |
| React/TypeScript/Vite setup and launchers | Retain pinned working setup; add approved dependencies only |
| Numeric draft control | Adapt and extend with node schema metadata |
| History/transport helpers and tests | Reuse tested ideas; replace recipe-specific storage/contracts |
| Seeded math, WAV encoding | Reuse with explicit versioned contracts and conformance tests |
| v1 family switch generator | Freeze for legacy mode; do not wrap it as the v2 node runtime |
| Renderer primitives/pools | Reuse selectively; replace circular-point-only material vocabulary |
| v1 localStorage | Preserve, read through a compatibility adapter; v2 uses IndexedDB |
| v1 JSON and bundles | Continue legacy import; explicit conversion to graph copy |
| v1 visual defaults | Reference only; none is automatically accepted for v2 |
| Root PLAN.md | Historical design; superseded where conflicting by this package |

## Working environment

All final project/planning assets live under F:\Dev2\VFX-Tool. Port 5174 is the editor. Port 5173 belongs to the original standalone demo. Do not stop the original server to make the editor appear to work.

Existing approved dependencies: React 19.3.0, React DOM 19.3.0, Three.js 0.186.0, TypeScript 7.0.2, Vite 8.3.0 and their pinned required dependencies. Node 24.3.0 was used for prior checks.

Planning adds no runtime package and changes no application source. Future installation of React Flow, ZIP support and browser-test packages requires the user's standing third-party-code approval rule to be satisfied. That approval has not been inferred from the old React/Three/Vite approval.

## Baseline package to collect before refactoring

Archive source/config/lockfile/old presets; record checksums; capture original and v1 clips; record OS/browser/GPU/driver/canvas/DPR; keep existing tests and a small v1 state fixture. Do not copy node_modules into the source archive. If Git is initialized later, use an ordinary baseline commit only after checking what is tracked and never include private keys or caches.

