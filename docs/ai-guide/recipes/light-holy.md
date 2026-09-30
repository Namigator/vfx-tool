# Light / Holy

Radiating rays from a white-gold core, a spinning ground halo, and a warm point light. Reads as blessing, healing,
divine judgement or a generic "buff" flash depending on colour and ray count. The brightest, simplest family —
almost the whole look comes from one core + rays + halo + light stack.

## What makes light read right

- **Blend: additive everywhere**, no exceptions — light effects are pure emission, nothing to "cover."
- **Near-white core, colour in the rays/halo/light — same rule as lightning/energy.** Core tint `#FFF6D8`
  (near-white, warm), emission 2 (the single brightest part of the effect); rays/halo/ring use the family colour
  (`#FFD890`–`#FFE9A8`, warm gold) at lower emission (0.8–1). A fully golden core reads as "yellow ball," not
  "radiant light."
- **Rays are velocity-stretched streak particles aimed outward from Target**, not a static starburst texture:
  `Emitter(shape:"sphere", small radius)`, high speed (5–7 m/s), very short lifetime (0.35–0.5 s),
  `BillboardRenderer{ alignment:"velocity", stretchRatio: 14, pivot: 0.95 }` — the high `stretchRatio` (10–14, far
  higher than sparks' 2–6) is what makes them read as thin light rays instead of streaking sparks.
  `opacityOverLife` fades in fast (0→1 by 20% of life) then out, so rays don't pop at full brightness from a point.
- **A spinning ground halo, not just a vertical glow.** `SpriteRenderer { alignment: "worldAxis", spin: 0.6 }` on a
  floor-level `OffsetAnchor` (dropped to ground) — a flat glowing ring that slowly rotates sells "sacred geometry"
  far more than a billboarded glow card ever does.
  `light-pulse`/`light-cone`/`light-blessing` add a second, sharper `RingPath`+`RibbonRenderer` ring on top of the
  halo sprite for a crisper "magic circle" edge.
- **A charge phase for the "pulse" variants**: motes gather at Target (`Attract`), then a `RevealPath`-driven pulse
  of rays fires — this reads as "gathering then releasing" divine power rather than an instant flash.
- **Size vs a 1.8 m character**: core 0.4–1.4 m, halo 1.2–3 m (bigger than the character — light effects spread
  past their source), ray length 1.8–14 (unit depends on variant: `holy-light`'s `raybb.stretchRatio` is a
  *multiplier* on a small base sprite, `light-pulse`'s `rays.lengthMax` is metres directly — check
  `vfx_list_controls` for the unit on the specific component before setting it).
- **Timing**: pulse window 70–120 ticks total; ray emission active ~10–70% of it, halo and light span the full
  window with a smooth fade in/out (`intensityOverWindow` 0→1→1→0), never a hard cut.

## Fastest: start from a component

| id | look | rays | length | halo | light |
|---|---|---|---|---|---|
| `holy-light` | simple: rays + core + spinning halo + light | rate 90/s | stretch ×14 | 3 m | 50 |
| `light-pulse` | charge-then-release: motes, narrow core, tapered rays, ring | 32 rays | 2.4 m | 2 m | 30 |
| `light-cone` | rays concentrated upward in a narrow cone | 24 rays | 3.2 m | 1.2 m | 30 |
| `light-blessing` | fewer, softer rays, wide halo, many lingering motes | 14 rays | 1.8 m | 3 m | 30 |

```
vfx_new_document { template: "blank", id: "holy", component: "holy-light" }
vfx_compile { docId: "holy" }
vfx_render_frames { docId: "holy", ticks: [15, 30, 60] }   # rise / peak / settle
```

Common knob turns:

| Want | Knob | Example |
|---|---|---|
| More/fewer rays | `rays` (Ray rate perSecond, or Ray count integer depending on component) | `180` on `holy-light`, or `64` (count) on `light-pulse` |
| Longer/shorter rays | `length` | component-dependent unit — check `vfx_list_controls` first |
| Bigger/smaller core | `core`/`pulse` (m) | `2.5` for a large divine flash |
| Wider/narrower halo | `halo` (Halo size/softness, m) | `5` for a room-filling blessing |
| Brighter/dimmer | `light` (Brightness, linearGain) | `80` for a searing judgement effect |
| Recolour (unholy purple, cold blue ward) | `colour-main` / `colour-shift` | `{ srgb: "#9B6BFF", alpha: 1 }` for a corrupted-light variant |

## From scratch: core + outward rays + spinning ground halo + light

```
vfx_new_document { template: "blank", id: "light2" }
vfx_set_document { docId: "light2", durationTicks: 120 }

vfx_add_node { docId: "light2", type: "Schedule", id: "pulse", params: { startTicks: 10, durationTicks: 70, mode: "window" } }

# Core: near-white, brightest part
vfx_add_node { docId: "light2", type: "Material", id: "coremat", params: { template: "SpriteTextured", sprite: "soft-glow", blend: "additive", tint: { srgb: "#FFF6D8", alpha: 1 }, emission: 2 } }
vfx_add_node { docId: "light2", type: "SpriteRenderer", id: "core", params: { size: 1.4, sizeOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0.2},{x:0.2,y:1},{x:0.8,y:1.1},{x:1,y:0}] } } }
vfx_connect { docId: "light2", from: "node-target.out", to: "core.anchor" }
vfx_connect { docId: "light2", from: "coremat.material", to: "core.material" }
vfx_connect { docId: "light2", from: "pulse.window", to: "core.window" }
vfx_connect { docId: "light2", from: "core.visual", to: "node-output.visual" }

# Rays: velocity-stretched streaks radiating outward
vfx_add_node { docId: "light2", type: "Emitter", id: "rays", params: { shape: "sphere", radius: 0.15, rate: 90, speedMin: 5, speedMax: 7, lifetimeMin: 0.35, lifetimeMax: 0.5 } }
vfx_connect { docId: "light2", from: "node-target.out", to: "rays.anchor" }
vfx_connect { docId: "light2", from: "pulse.window", to: "rays.window" }
vfx_add_node { docId: "light2", type: "InitialProperties", id: "rayip", params: { sizeMin: 0.08, sizeMax: 0.14 } }
vfx_add_node { docId: "light2", type: "Material", id: "raymat", params: { template: "SpriteTextured", sprite: "spark-streak", blend: "additive", tint: { srgb: "#FFE9A8", alpha: 1 }, emission: 1 } }
vfx_add_node { docId: "light2", type: "BillboardRenderer", id: "raybb", params: { alignment: "velocity", stretchRatio: 14, pivot: 0.95, opacityOverLife: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0},{x:0.2,y:1},{x:1,y:0}] } } }
vfx_connect { docId: "light2", from: "rays.particles", to: "rayip.particles" }
vfx_connect { docId: "light2", from: "rayip.particles", to: "raybb.particles" }
vfx_connect { docId: "light2", from: "raymat.material", to: "raybb.material" }
vfx_connect { docId: "light2", from: "raybb.visual", to: "node-output.visual" }

# Ground halo: flat, world-aligned, slowly spinning
vfx_add_node { docId: "light2", type: "OffsetAnchor", id: "ground", params: { offset: [0, 0.02, 0], dropToGround: true } }
vfx_connect { docId: "light2", from: "node-target.out", to: "ground.anchor" }
vfx_add_node { docId: "light2", type: "Material", id: "ringmat", params: { template: "SpriteTextured", sprite: "ripple-ring", blend: "additive", tint: { srgb: "#FFD98A", alpha: 1 }, emission: 0.8 } }
vfx_add_node { docId: "light2", type: "SpriteRenderer", id: "halo", params: { size: 3, alignment: "worldAxis", spin: 0.6, sizeOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0.4},{x:1,y:1.3}] }, opacityOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0},{x:0.2,y:1},{x:1,y:0}] } } }
vfx_connect { docId: "light2", from: "ground.out", to: "halo.anchor" }
vfx_connect { docId: "light2", from: "ringmat.material", to: "halo.material" }
vfx_connect { docId: "light2", from: "pulse.window", to: "halo.window" }
vfx_connect { docId: "light2", from: "halo.visual", to: "node-output.visual" }

# Warm point light, smooth fade in/out
vfx_add_node { docId: "light2", type: "PointLight", id: "lamp", params: { color: { srgb: "#FFE2A0", alpha: 1 }, intensity: 50, range: 6, intensityOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0},{x:0.2,y:1},{x:0.8,y:1},{x:1,y:0}] } } }
vfx_connect { docId: "light2", from: "node-target.out", to: "lamp.anchor" }
vfx_connect { docId: "light2", from: "pulse.window", to: "lamp.window" }
vfx_connect { docId: "light2", from: "lamp.visual", to: "node-output.visual" }
vfx_compile { docId: "light2" }
vfx_render_frames { docId: "light2", ticks: [15, 30, 60] }
```

## Variants

| Variant | Change | Example |
|---|---|---|
| Focused cone (judgement beam) | rays concentrated upward in a narrow cone instead of radial | use `light-cone` |
| Blessing (soft, lingering) | fewer, softer rays, wide halo, many motes that linger | use `light-blessing` |
| Charge-then-release pulse | add a charge phase (motes gathering) before the ray burst | use `light-pulse` |
| Corrupted/unholy light | recolour to purple/sickly green, keep the same near-white core rule | `colour-main` to `#9B6BFF` or `#7CD13A` |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| A flat yellow ball, not radiant | core fully saturated instead of near-white | keep core tint near-white (`#FFF6D8`–`#FFFFFF`), push colour into rays/halo |
| Rays look like sparks, not light rays | `stretchRatio` too low (spark-range 2–6) | raise to 10–14 |
| Halo looks static/pasted on | no `spin`, or `alignment` is billboard instead of `worldAxis` | `alignment: "worldAxis"`, `spin` 0.4–0.8 |
| Pulse snaps on/off | flat window opacity/intensity instead of smooth in/out curves | fade `opacityOverWindow`/`intensityOverWindow` 0→1→1→0 |
| Effect looks tiny next to the character | halo/ray length too small relative to a 1.8 m character | halo ≥ character height; check the knob's actual unit first (`vfx_list_controls`) |
| Washes the whole frame white | too many rays at high opacity/emission with bloom on, or core emission too high | lower per-ray opacity/emission first, then check `EffectOutput.glowLimit` |

## Ticks/camera to check

Rise (a few ticks after the window opens), peak (rays and halo both visible, light near full intensity), and settle
(near the window's end, everything fading together). Standard side/three-quarter view shows the ray burst and the
spinning halo at once; a top-down or low angle shows the halo shape best.

**Verified 2026-09-30**: built `recB-light` via `vfx_new_document(component:"holy-light")`, compiled clean (3
particle systems, light ticks 10-80 intensity 50), rendered ticks 15/30/60 — tick 15 shows the core rising with a
faint ground halo ring beginning to form; tick 30 shows a full radiant burst of thin golden rays around a bright
near-white core with the ground halo clearly visible and lit; tick 60 shows the rays continuing with the halo still
present, matching the described "near-white core, colour in the rays/halo" look.
