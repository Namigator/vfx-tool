# VFX Studio

An early browser implementation of the Elemental VFX Studio plan. Everything for this project lives in `F:\Dev2\VFX-Tool`.

## Evidence and current limits

- [RAN] TypeScript compile and Vite production build pass.
- [RAN] 46 tests pass: generation, seeded repeatability, lifecycle, validation, recipe and bundle round-trips, PCM audio, editor history/transport/numeric commits, and simulated Web Audio cleanup.
- [PROXY] Ten effect generators and their 3D renderer are implemented. The current build has NOT been visually inspected: browser control reported no available browsers and the user's screenshot utilities are absent.
- [UNVERIFIED] Browser interaction behavior, cross-browser rendering, and 60 FPS targets remain unverified.
- [UNVERIFIED] Audio signals pass numerical checks, but the sounds have not been listened to. Actual audiovisual synchronization is unverified.
- This is an early implementation, not the completed acceptance gate from PLAN.md. Engine exporters are not implemented.

## Launch

Double-click `Start-VFX.cmd`, then visit **http://127.0.0.1:5174/** in Chrome, Edge, or another WebGL2 browser. Keep the launched terminal running while using the editor. A running development server may already be using that port.

With Node available on PATH, these commands also work from this directory:

```text
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test tests/*.test.ts
node node_modules/vite/bin/vite.js build
```

Dependencies are installed and locked by `pnpm-lock.yaml`. Reinstall with `pnpm install --frozen-lockfile --ignore-scripts` if needed. The tested runtime is Node 24.3.0. No installation is needed for each launch. The `dist` directory contains a production build and must be served over HTTP; don't double-click its HTML file.

## Editing

- Select an element on the left; edit settings on the right.
- Drag to orbit, scroll to zoom; Reset camera restores the initial view.
- Play/pause, restart, advance one frame, or scrub the timeline. Space toggles playback when no control is focused.
- Topology/timing changes restart a playing effect. When paused, the new recipe is sampled at the current time for comparison.
- Slow motion and scrubbing are silent. Click Sound on to enable normal-speed audio after a user gesture.
- Save preset stores a variation in this browser's local storage. It is not a filesystem backup. Up to 50 presets are retained; the editor refuses additional saves rather than silently dropping earlier entries.
- Download JSON saves editable recipe data. Import JSON accepts those recipes and version-1 effect bundles.
- Open Sound to download a PCM16 mono 48 kHz WAV, or a self-contained effect bundle containing recipe, WAV, and units/version manifest.
- Bundle import restores authored controls and regenerates procedural sound. It does not ingest arbitrary external audio or execute code.
- Undo/redo applies to authored recipe changes; one slider drag creates one undo entry. Camera movement is separate. Numeric fields commit on Enter or blur and revert invalid drafts.

## Elements

Lightning arc; fire plume; ice shards; water arc and droplets; wind helix; earth rocks and dust; light rays; shadow vortex; poison cloud; energy projectile. `presets/` contains ten editable defaults and corresponding WAV files.

These are stylized procedural primitives. Particle motion is analytically sampled and repeated during the active phase, fading in decay. It is not persistent fluid, smoke, collision, destruction, or rigid-body simulation. Later visual review may require substantial art-direction changes.

## Structure

- `PLAN.md` — planned scope and acceptance gates.
- `STATE.md` — latest status, limitations, next steps.
- `src/core/types.ts` — portable data contracts and world-space primitives.
- `src/core/recipe.ts` — typed settings, ranges, defaults, strict import validation.
- `src/core/generator.ts` — seeded, 60 Hz sampled geometry for ten families; no renderer imports.
- `src/core/bundle.ts` — portable recipe + audio package.
- `src/render/Viewport.ts` — Three.js renderer, reusable geometry pools, particles, bloom, floor, orbit camera.
- `src/audio/synth.ts` — deterministic waveform generation, WAV encoding, gesture-unlocked playback.
- `src/App.tsx` — editor, playback, history, presets and diagnostics.
- `tests/` — Node test suite.
- `evidence/preset-metrics.json` — actual generated counts and audio statistics, explicitly not visual evidence.
- `licenses/` — license notices for bundled production libraries.

## Portability boundary

Recipes use meters, seconds, Y-up right-handed coordinates, hex sRGB colors, stable parameter keys, a seed, and schema/generator versions. No Three.js objects or shaders are saved. The browser converts this description into visuals. The family algorithms still need native implementation in a future engine adapter; JSON alone is not an engine-export implementation. The v1 schema exposes family parameters rather than a general editable node/layer graph.

Glow and the floor are preview features. Fixed-tick sampling gives repeatability within the reference implementation; no pixel-identical rendering across devices or engines is claimed. Renderer pools have bounded capacities, and shape-count controls match the implemented per-family limits. Diagnostics show recent browser frame intervals, not GPU execution times or a hardware-qualified performance certification.

See `TEST-WHEN-HOME.md` for a short manual test sequence. `evidence/cpu-sampling.json` records 30 configurations / 7200 sampled frames; it measures CPU geometry generation only, not GPU or browser frame rate.

## Remaining acceptance work

1. Connect a browser; capture all elements through their phases and at multiple angles; correct visual defects.
2. Exercise numeric controls, pause/seek/restart, sound, history, preset save/reopen, JSON/bundle import and downloads in the actual UI.
3. Listen to each sound and measure audiovisual synchronization.
4. Run sustained, hardware-qualified frame-time and resource-lifetime checks. Inspect low/high parameter extremes and background/glow variants.
5. Broaden schema/layer editability and compatibility fixtures only after the first end-to-end workflow is accepted.
