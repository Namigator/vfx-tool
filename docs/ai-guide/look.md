# Look and quality: what makes an effect read well

Hard-won rules from building the 49 included components against real references (the standalone flamethrower and
the original lightning). Each rule names the mistake it prevents. Family-specific numbers are in [recipes/](recipes/).

## 1. Additive vs normal blending

| Use **additive** for | Use **normal** for |
|---|---|
| fire tongues' glow accents, sparks, embers, energy, lightning, light rays, glows | smoke, dust, clouds, water, droplets, foam, poison gas, dark/shadow matter, debris |

- Additive sprites **add light**: 200 overlapping sprites at opacity 1 become a white-hot blob and the bloom floods
  the frame. Dense additive layers need **per-sprite opacity 0.05–0.3** and **emission 0–0.5**; only a small hot core
  may use emission 1–2.
- Normal sprites **cover**: they keep shape and colour in dense stacks and never flood the glow. A dense flame body
  reads better as *normal* blend (opacity ≈ 0.6) with a *faint additive accent* on top than as pure additive.
- Dark things (shadow, smoke) must be normal blend — additive black adds nothing and disappears.

`vfx_render_frames` reports "lit %" and "bright %" per frame and warns **"glow flooding"** (a large dim halo around
a small bright core). When you see it: lower per-sprite opacity/emission first; only then touch EffectOutput
`glowLimit` (1.5–2 for dense stacks) or `glowThreshold` (1.3–1.6 for dense fire). Defaults: glowStrength 0.8,
glowRadius 0.45, glowThreshold 1, glowLimit 3.

## 2. Colour

- Fire cools as it ages: white → pale yellow (#FFE0A0) → orange (#FFA050) → deep orange-red (#C8501E) → dark
  (#5A1E0A), with alpha fading at the end. `colorOverLife` does this per particle; it is what makes a white root,
  orange body and dark tips.
- **Saturated red at full opacity reads as "petals"**, not fire. Keep reds faint and only at the end of life.
- Lightning and energy: a near-white core with the colour in the wider, fainter sheath around it. The colour lives in
  the halo, not the core.
- Recolouring a finished effect: use the component's **Colour** knob (keeps the hot-core-to-cool-tip look) or a
  **part colour** picker (full recolour of one part, including grey smoke). Don't retint every material by hand.
- Check colour with bloom on (the default): bloom shifts hues toward white in bright areas.

## 3. Size and scale

- Think in metres against a **1.8 m character**. The default Source→Target distance is 4–6 m.
- Sprite textures rarely fill their square: a flame tongue fills about half its cell, so a sprite must be **about
  twice the visible flame width** you want.
- Grow things over life (`sizeOverLife`): flames 1 → 3.7 → 2.2, smoke ×2.5–4. Constant-size particles look like
  confetti.
- For game-character scale, shrink with component knobs or the document `rootTransform.scale`, not by editing every
  node. In Roblox exports, `play(..., { scale })` resizes at runtime.

## 4. Shape and motion

- **Velocity alignment + stretch** (`alignment: "velocity"`, `stretchRatio` 1.5–6) makes sparks streak and flames
  flow. It fades to upright puffs when a particle flies toward or away from the camera (seen end-on), so jets still
  read from in front and behind.
- **Turbulence** (`NoiseForce`, vector ~3 m/s², frequency ~0.55) breaks up straight lines; without it jets look like
  tubes.
- **Drag** makes things slow down naturally. Particles born from events (smoke and embers at flame deaths) inherit the
  parent's speed: always give them Drag (1.2–1.6) or they shoot out of frame.
- **Gravity** direction sells material: sparks fall (−3 to −9.8), embers and smoke rise (+0.9 to +1.6).
- Randomise: size ranges, lifetime ranges, `randomFrameStart`, rotation and slow spin for smoke. Identical particles
  read as a pattern.

## 5. Timing

- Good effects have phases: **anticipation** (charge, gather, 10–30 ticks) → **release** (fast, 2–6 ticks) →
  **impact** (flash, sparks, shake, ring) → **decay** (smoke, embers, fade, 30–120 ticks).
- Tie impacts to events (`PathFollower.arrival → Schedule.trigger`) instead of fixed ticks, so they stay in sync when
  travel time changes.
- Flashes are short (2–6 ticks); light pulses peak early and decay; shakes are subtle (translation ≈ 0.03).
- Leave room for tails: the compile warns when the effect ends before its content does.

## 6. Layering

Build layers separately, then stack. A typical rich effect has 4–7 layers: body, hot core, accent, secondary matter
(smoke / debris), sparks / embers, light, flash / ring. Keep each layer doing one job, and check each with `solo`.

## 7. Readability on backgrounds

- Faint additive effects vanish on light floors; dark smoke vanishes on dark ones. Render with
  `background: "light"` too if the effect must work on either, and adjust (lighter smoke, a normal-blend underlayer
  for glows).
- Ground contact sells weight: a light pool (PointLight near the floor), a scorch/stain, a ring or a dust puff where
  the effect touches the ground. Use `OffsetAnchor { dropToGround: true }` from Target, never a fixed anchor.

## 8. Light

PointLights make effects feel physical (they light the floor and lit meshes). One or two per effect, colour matched
to the effect, flicker 0.2–0.3 for fire. The preview caps active lights (see [reference/limits.md](reference/limits.md)).

## 9. Quality bars

- Fire: `docs/v2-plan/references/standalone-flamethrower/flamethrower.html` (open via the dev server;
  `?t=<sec>` freezes a frame).
- Lightning: `docs/v2-plan/references/original-lightning/lightning-arc.html` — thin bright core, fine zigzag
  (±0.3 m), hair-thin faint branches.
Both references are HTML pages, not images: open them through the dev server (e.g.
`http://127.0.0.1:5174/docs/v2-plan/references/standalone-flamethrower/flamethrower.html?t=1`) and take a PNG
screenshot, then render your effect at a matched camera and compare with `vfx_compare_images` (PNG only;
`lightning-preview.png` next to the lightning page is really a JPEG and is refused).
The included `flamethrower` and `lightning-strike` components are tuned to these references: when your own build
falls short, `vfx_describe_node_type` plus a render of the component side by side is the fastest way to see what
differs.

## 10. Common wrong looks → cause

| Looks like | Cause | Fix |
|---|---|---|
| Orange/white fog filling the frame | too many additive sprites at high opacity | opacity 0.05–0.3, emission ≤ 0.5 |
| Flower petals | saturated red at full opacity | red only at end of life, faint |
| Overlapping cards / scales | few big textured sprites, normal blend, no variation | more, smaller, stretched sprites; random frames; faint additive accent |
| A solid tube | no turbulence, constant size | NoiseForce + sizeOverLife growth |
| Confetti | constant size, no alignment | velocity alignment + stretch, size over life |
| Nothing visible | window/trigger not wired, burst 0 without rate, particles out of frame | `vfx_sample_particles`; add Drag |
| Spiky star seen end-on | velocity-stretched sprites viewed along their motion | handled automatically since 2026-09-30; lower stretchRatio if still harsh |
| Effect cut off at the end | duration shorter than tails | lengthen the effect (compile tells you how much) |
