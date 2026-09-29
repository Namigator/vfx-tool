# Gate D — all ten families (evidence, 2026-09-29)

**Status: agent evidence captured; user visual approval given for the defaults on 2026-09-29 (review round 1: "everything looks good except the water splash", splash fixed in c0b6656). Taste tweaks were skipped by user decision. Variant approval and sound identity (Gate E) are still pending; sound is parked.**

## What was rendered

30 components (3 per family: lightning, fire, water, wind, earth, ice, poison, light, shadow, energy) × 2 oblique orbits (a = yaw 35°/pitch 28°, b = yaw −50°/pitch 18°) × dark and light arenas = 120 contact sheets, 6 ticks each spread over the effect (charge → active → impact → decay). Each component is built fresh from its component template, so the sheets show the current generator output, not stale documents.

This folder keeps the 30 `*-a-dark` sheets (4.2 MB). The full set (both orbits, both arenas) is regenerated with:

```
node tools/make-gate-d-steps.mjs
node mcp/run-steps.mjs work/gate-d.steps.json     # ~1 h, needs the vite dev server on 127.0.0.1:5174
```

Output: `work/mcp/frames/rv-<component>-<a|b>-<dark|light>.png`.

Environment: Windows 11, headless Chrome with SwiftShader WebGL (the MCP capture path), bloom on, 480×270 per frame.

## Agent review notes ([SAW] 30 of 120 sheets: at least one per component family, both arenas and both orbits represented)

- The whole set rendered: 120 sheets, no compile or runtime errors in the run log [RAN].
- Every sheet ends empty at the last tick: no persistent particles.
- None of the sheets I looked at show floating endpoints, detached branches, atlas borders or opaque smoke squares.
- Silhouettes differ within each family, which is the "structure, not hue" rule:
  - earth: upheaval (big rocks + dust) vs gravel (small scatter);
  - ice: eruption ring vs tall cluster;
  - water: stream vs broad splash;
  - lightning: strike vs thin fork vs heavy strike.
- **Open: additive effects on the light arena are faint.** Lightning heavy strike, light cone, energy orb and fire burst read weakly on the light floor, because additive light cannot darken a bright background. This is the same open question as in Gate B's README. A per-effect "light background" variant (normal-blend core) would fix it, if the user wants one.
- The energy-needle impact ring is partly cropped at tick 83 from orbit a, because auto-framing uses the whole timeline. Minor.
- The shadow family is dim on the dark arena by design (DarkVolumeSprite). It reads clearly on the light arena.

## Not covered here

- Close-up review at intended scale is done in the editor ("Watch it play" links in review.html).
- Sound identity is parked (user decision 2026-09-27).
