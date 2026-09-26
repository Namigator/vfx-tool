# WP04/05 — Textured materials, flipbook playback, bundled sprite library

Step 1 of the tool-first direction (STATE.md "Direction"). Goal: any billboard layer can use a shared
sprite sheet and animate through it over particle life. This is the single biggest realism gap
(untextured sprites read as "orange circles", which 02-FIRE.md explicitly rejects).

Read first: `docs/v2-plan/09-MATERIALS.md` (reconcile names/params with it; this doc wins only where
09 is silent), `src/graph/registry.ts` (Material, BillboardRenderer), `src/render/PreviewViewport.ts`,
`src/render/billboardLife.ts`, `assets/sprites/manifest.json`, `tools/bake-sprites.mjs`.

## Sprite library (seed exists)
- `node tools/bake-sprites.mjs` writes `assets/sprites/*.png` + `manifest.json` (no deps, deterministic).
  Current sheets: `flame-tongue-t0..t3` (8 shape rows × 12 frame columns, 40×96 cells, t0 hottest) and
  `smoke-puff` (4 variants, 64×64). Algorithm is identical to the flamethrower reference page.
- Add a typed loader `src/assets/spriteLibrary.ts`: reads the manifest, exposes
  `{ id, file, cell, columns, rows, kind, blend }`; unknown ids are a validation error, not a crash.
- Later sheets (not in this WP): sparks/streak, soft glow, electric arc, splash. Keep the baker the
  single source; do not hand-paint.

## Registry changes (definitionVersion bump + migration if 09 requires it)
- `Material` template `SpriteTextured` alongside `SpriteUnlit`:
  - `sprite` (enum of manifest ids), `blend` (existing), `tint`, `opacity`, `emission` (existing semantics).
- `BillboardRenderer` (or Material, follow 09-MATERIALS.md):
  - `flipbookMode`: `none | overLife | fps`; `fps` number; `variantMode`: `random | fixed` (picks the
    sheet row per particle, seeded); `flipX`: `random | off`.
  - `pivot` (normalized Y, default 0.62 from the tip) so velocity-aligned tongues sit like the reference.
- `InitialProperties.randomFrameStart` already exists — honour it for `fps` mode.

## Renderer
- Load textures once per sprite id (Three `TextureLoader`, `SRGBColorSpace`, no mipmap bleed across
  cells: clamp + half-texel inset in UVs).
- Per-particle attributes: cell index (row, frame). Frame = `floor(normalizedAge * columns)` clamped for
  `overLife`.
- Must work with existing `alignment: velocity` + `stretchRatio`; normal and additive blend; depth
  sorting for normal blend at ≥500 particles without visible popping.

## Acceptance (evidence tags required)
- [RAN] tests: manifest parse + unknown id rejected; frame/row selection deterministic for a seed;
  overLife hits last column at age 1; registry snapshot updated; tsc + full suite + build pass.
- [SAW] in-app browser capture: a cone emitter with `flame-tongue-t1`, velocity alignment, normal blend,
  reads as flame tongues (not circles/rectangles) on the dark floor; no cell bleeding at edges.
- Compare side-by-side with `docs/v2-plan/references/standalone-flamethrower/flamethrower.html?t=1.2`
  (it will still lack forces/colour-over-life — those are WP06; only the sprite look is judged here).

## Out of scope
Forces (Drag, Gravity, NoiseForce), ColorOverLife, sub-emitters, trails, lights, layer-stack UI → WP06+.
