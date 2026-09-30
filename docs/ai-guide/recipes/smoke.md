# Smoke

Rising smoke, dust clouds, billowing trails. There is only one dedicated component (`smoke-plume`); smoke more
often appears as a *layer* inside fire, earth and impact effects (born on a death event, or a steady low-rate
emitter). This recipe covers both uses.

## What makes smoke read right

- **Always normal blend**, never additive. Additive smoke either disappears (no light to add) or turns into a
  translucent glow instead of a cloud. Use `DarkVolumeSprite` template instead of `SpriteTextured` + normal if you
  want dark smoke that bloom can never lift (its emission is forced to 0).
- **Few, large, growing particles**, not many small constant ones. `sizeOverLife` growth ×2.5–4 over the
  particle's life; constant size reads as confetti or a spinning ball, not a billowing cloud.
- **Opacity peaks early then fades**: `opacityOverLife` ramps up over the first 15–25% of life to ~0.25–0.6, then
  fades to 0 — never fully opaque, and never abrupt at the end (abrupt = "cut", not "dissipated").
  `Material.groundFade` 0.2–0.3 lets puffs that touch the floor fade out softly instead of being clipped by it.
- **Drag + rising Gravity**: `Drag` 0.6–1.6 so puffs slow down and hang instead of drifting in a straight line;
  `Gravity` up `[0, 0.1..1.6, 0]` (hot smoke off a fire rises faster than cool dust).
- **Low-amplitude curl `NoiseForce`** (~0.3–0.8, frequency ~0.3) makes it curl and billow instead of rising as a
  rigid column; too much amplitude looks like it's boiling, not drifting.
- **Randomise everything**: `randomFrameStart` (if the sprite is a flipbook), random `rotationMin/Max`, slow
  `angularVelocityMin/Max` (±0.4) so every puff looks different — identical puffs read as a stamped pattern.
- **Size vs a 1.8 m character**: a hand-sized puff is ~0.3–0.5 m growing to ~1–2 m; a pillar of smoke off a burning
  building is 2–5 m wide.
- **Readability**: dark smoke can vanish on a dark floor/background — check with `background: "light"` too (see
  [look.md](../look.md) §7), and lighten the colour if the effect must read on both.

## Fastest: start from a component

| Want | Component id | Key knobs |
|---|---|---|
| Standalone rising smoke column | `smoke-plume` | no published knobs beyond Start at/Colour by default — open internals for rate/size, or just use it as-is and recolour with the automatic **Colour** knob |
| Smoke as part of a fire | `fire-jet` / `flamethrower` / `fire-torch` / `fire-burst` | `ctl-*-smoke` (amount), part colour **Smoke & dust colour** |
| Dust kicked up by an impact | `rock-burst`, `earth-upheaval`/`earth-heavy`/`earth-gravel` | `ctl-*-dust` (amount), **Smoke & dust colour** |
| Vapour off ice | `ice-eruption`/`ice-fan`/`ice-cluster` | `ctl-*-frost` (density), **Smoke & dust colour** |

`vfx_add_component { docId, component: "smoke-plume", group: true }` then render — it needs no tuning to look
right, only recolouring via `vfx_set_control { docId, control: "ctl-smoke-plume-colour-shift", value: <deg> }`.

**Verified 2026-09-30**: built `recA-smoke-component` from `smoke-plume`, rendered tick 100 — a soft, curling,
growing column of grey puffs rising and drifting, exactly as billed. [SAW]

## From scratch: standalone rising plume

```
vfx_new_document { template: "blank", id: "my-smoke" }

vfx_add_node { docId: "my-smoke", type: "Schedule", id: "sched",
  params: { mode: "window", startTicks: 0, durationTicks: 120 } }
vfx_add_node { docId: "my-smoke", type: "Emitter", id: "em", params: {
  shape: "cone", coneAngle: 0.35, radius: 0.15, rate: 8, burst: 0,
  speedMin: 0.3, speedMax: 0.7, lifetimeMin: 1.6, lifetimeMax: 2.4, direction: [0, 1, 0] } }
vfx_add_node { docId: "my-smoke", type: "InitialProperties", id: "ip", params: {
  sizeMin: 0.25, sizeMax: 0.45, rotationMin: -3.14159, rotationMax: 3.14159,
  angularVelocityMin: -0.4, angularVelocityMax: 0.4, randomFrameStart: true } }
vfx_add_node { docId: "my-smoke", type: "Drag", id: "drag", params: { coefficient: 1 } }
vfx_add_node { docId: "my-smoke", type: "Gravity", id: "grav", params: { acceleration: [0, 0.8, 0] } }
vfx_add_node { docId: "my-smoke", type: "NoiseForce", id: "noise", params: { amplitude: 0.6, frequency: 0.3, mode: "curl" } }
vfx_add_node { docId: "my-smoke", type: "OverLife", id: "ol", params: {
  sizeOverLife: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:1},{x:1,y:3.2}] },
  opacityOverLife: { domain: "normalized", interpolation: "linear",
                      keys: [{x:0,y:0},{x:0.2,y:0.45},{x:1,y:0}] },
  colorOverLife: { stops: [ {position:0,color:{srgb:"#9A9088",alpha:1}},
                             {position:1,color:{srgb:"#5C564E",alpha:1}} ] } } }
vfx_add_node { docId: "my-smoke", type: "Material", id: "mat", params: {
  template: "SpriteTextured", sprite: "smoke-puff", blend: "normal", opacity: 1, groundFade: 0.25 } }
vfx_add_node { docId: "my-smoke", type: "BillboardRenderer", id: "bb", params: { flipbookMode: "overLife" } }

vfx_connect { docId: "my-smoke", from: "sched.window", to: "em.window" }
vfx_connect { docId: "my-smoke", from: "node-source.out", to: "em.anchor" }
vfx_connect { docId: "my-smoke", from: "em.particles", to: "ip.particles" }
vfx_connect { docId: "my-smoke", from: "ip.particles", to: "drag.particles" }
vfx_connect { docId: "my-smoke", from: "drag.particles", to: "grav.particles" }
vfx_connect { docId: "my-smoke", from: "grav.particles", to: "noise.particles" }
vfx_connect { docId: "my-smoke", from: "noise.particles", to: "ol.particles" }
vfx_connect { docId: "my-smoke", from: "ol.particles", to: "bb.particles" }
vfx_connect { docId: "my-smoke", from: "mat.material", to: "bb.material" }
vfx_connect { docId: "my-smoke", from: "bb.visual", to: "node-output.visual" }

vfx_set_document { docId: "my-smoke", durationTicks: 270 }   // a 2.4 s lifetime tail needs the room
vfx_compile { docId: "my-smoke" }
vfx_render_frames { docId: "my-smoke", ticks: [40, 100, 200] }
```

**Verified 2026-09-30**: built `recA-smoke-scratch`, compiled (warned the tail needed 264+ ticks — set 270),
rendered ticks 40/100/200 — a small puff growing, curling and rising, fading to almost nothing by tick 200; correct
shape but noticeably dim against the default black background (0.2–1.5% lit) — render on `background: "light"`
too when judging a dark smoke colour. [SAW]

## Variants

| Variant | Change from the base plume |
|---|---|
| Thin wisp (incense, snuffed candle) | lower `rate` (2–4/s), smaller `sizeMin/Max`, less `NoiseForce` amplitude |
| Billowing pillar (building fire) | higher `rate`, larger `sizeOverLife` growth (×4+), stronger up `Gravity` |
| Dust cloud (impact, not rising) | near-zero up `Gravity`, `colorOverLife` tan/brown instead of grey, more `NoiseForce` amplitude for tumbling |
| Poison/toxic gas | green-tinted `colorOverLife`, slower rise, add a faint sickly `PointLight` — see the poison components for a full build |
| Death-triggered smoke (off fire, sparks) | replace the `Schedule`+continuous `Emitter` with `ParticleEvents.death` → `Emitter{burst:1, useEventPosition:true, inheritVelocity:0.35-0.45}`, and add stronger `Drag` (1.2–1.6) |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| Confetti / a spinning ball | constant size, no growth | `sizeOverLife` growth ×2.5–4 |
| A stamped pattern, every puff identical | no randomisation | `randomFrameStart`, random rotation, random `angularVelocityMin/Max` |
| Smoke invisible / glowing instead of clouding | `blend: "additive"` | switch to `normal` (or `DarkVolumeSprite` for dark smoke that bloom can't lift) |
| Smoke cut off sharply at the floor | no `groundFade` | `Material.groundFade` 0.2–0.3 |
| Rigid straight column, no billow | no `NoiseForce`, or amplitude too low | curl `NoiseForce`, amplitude 0.3–0.8 |
| Boiling/violent instead of drifting | `NoiseForce` amplitude too high | lower amplitude, lower frequency |
| Dark smoke invisible on screen | dark floor/background, low opacity | render with `background: "light"` to check; lighten the colour or opacity if it must read on both |
| Nothing visible | `rate` with no `window` connected, or all bursts fired with `burst=0`/no trigger | check wiring; `vfx_sample_particles` to confirm live count |

## Ticks / camera to check

Render the ramp-up (first puffs forming, ~10–20 ticks in), the steady billowing middle, and well past the window's
end (smoke lingers 1–2.5 s after emission stops — this is most of what sells "smoke" rather than "puff"). Check
both the default dark background and `background: "light"`. A side view shows the billow/curl best; a view from
directly below or above hides it.
