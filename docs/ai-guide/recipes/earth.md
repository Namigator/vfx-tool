# Earth

Rock bursts, stone eruptions, gravel, ground impacts. Components: `rock-burst` (generic impact) and the
`earth-upheaval` / `earth-heavy` / `earth-gravel` family (06-EARTH, ground pulse + stone eruption).

## What makes earth read right

- **Meshes, not sprites, for the solid pieces.** `MeshRenderer` with `mesh: "rock-a" / "rock-b" / "rock-c"`,
  `orientation: "tumble"` (random axis, spun by `InitialProperties` rotation/angular velocity) so chunks tumble
  believably as they fly. Debris that's meant to slide/settle can use `orientation: "velocity"` instead.
  `pivot: "base"` is for things that grow from the ground (see Ice for the same idea with crystals).
- **Without surface detail, rock reads as flat plastic.** The `MeshLit` Material needs `roughness` ~0.85,
  `surfaceDetail` ~0.75 with `detailScale` ~5, `colorVariation` ~0.7 (every chunk a slightly different shade), and
  a little `reflection` ~0.3; tint a mid-brown `#7A6654`. Skipping any of these is the single biggest reason a
  rock burst looks wrong.
- **Blend is always normal/lit** for the solid meshes — never additive (stone doesn't glow). Any glow in an earth
  effect belongs to an accompanying flash/pulse layer, not the rock itself.
- **Motion**: `Gravity` full strength `[0, -9.81, 0]` (nothing about earth floats), `GroundCollision` mode
  `bounce` with a **low** `restitution` (0.15–0.3 — stone doesn't bounce like a rubber ball) and `friction` 0.5–0.7
  so it slides to a stop rather than bouncing forever.
- **A rolling dust cloud accompanies every impact**: a separate `smoke-puff` layer (normal blend, tan/brown
  `colorOverLife`, `groundFade`) — see [smoke.md](smoke.md) for the dust-cloud variant. Dust should hug the
  ground and drift outward, not rise like hot smoke (near-zero or slightly positive `Gravity`).
- **Size vs a 1.8 m character**: gravel chips are 5–15 cm; a typical rock-burst chunk is 15–30 cm; heavy boulders
  are 0.5–1 m+ (`earth-heavy`'s default is 0.7 m).
- **Timing**: for a ground-pulse-then-eruption effect (`earth-upheaval`), there's a brief ground flash/pulse
  (~12 ticks) *before* the stones erupt (~30 ticks in) — the anticipation sells weight; stones erupting
  instantaneously with the trigger feels weightless.

## Fastest: start from a component

| Want | Component id | Key knobs to turn |
|---|---|---|
| Generic rock/debris impact | `rock-burst` | `ctl-rock-burst-count`, `ctl-rock-burst-force` (blast speed), `ctl-rock-burst-size`, `ctl-rock-burst-dust` |
| Full ground-pulse eruption (3 stone sizes + dust + contact puffs) | `earth-upheaval` | `ctl-earth-upheaval-stones`, `ctl-earth-upheaval-force`, `ctl-earth-upheaval-spread`, `ctl-earth-upheaval-bounce` |
| Few large, slow boulders | `earth-heavy` (upheaval variant) | same knobs, defaults already biased large/slow: `stones` 3, `size` 0.7, `force` 3.2 |
| Many small fast chips, less dust | `earth-gravel` (upheaval variant) | `stones` 2 (per shape ×3 shapes), `size` 0.25, `force` 6, `dust` 14 |

`vfx_add_component { docId, component: "rock-burst", group: true }` then render at the trigger tick + a few
frames later. Recolour rock with **Rock colour**, dust with **Smoke & dust colour**.

**Verified 2026-09-30**: built `recA-earth-component` from `rock-burst`, rendered tick 30 — tumbling brown-grey
rock chunks scattered around a low dust cloud, chunks already slowing from the initial blast; reads immediately
as a ground impact. [SAW]

## From scratch: tumbling rock burst + dust cloud

```
vfx_new_document { template: "blank", id: "my-earth" }

vfx_add_node { docId: "my-earth", type: "Schedule", id: "sched", params: { mode: "once", startTicks: 5 } }
vfx_add_node { docId: "my-earth", type: "Emitter", id: "em", params: {
  shape: "sphere", radius: 0.3, burst: 26, rate: 0, speedMin: 2.5, speedMax: 6,
  lifetimeMin: 1.5, lifetimeMax: 2.4, direction: [0, 1, 0], coneAngle: 1.0 } }
vfx_add_node { docId: "my-earth", type: "InitialProperties", id: "ip", params: {
  sizeMin: 0.12, sizeMax: 0.26, rotationMin: -3.14159, rotationMax: 3.14159,
  angularVelocityMin: -8, angularVelocityMax: 8 } }
vfx_add_node { docId: "my-earth", type: "Gravity", id: "grav", params: { acceleration: [0, -9.81, 0] } }
vfx_add_node { docId: "my-earth", type: "GroundCollision", id: "ground",
  params: { mode: "bounce", restitution: 0.15, friction: 0.7, maxBounces: 3 } }
vfx_add_node { docId: "my-earth", type: "Material", id: "rockmat", params: {
  template: "MeshLit", tint: { srgb: "#7A6654", alpha: 1 }, roughness: 0.85,
  surfaceDetail: 0.75, detailScale: 5, colorVariation: 0.7, reflection: 0.3 } }
vfx_add_node { docId: "my-earth", type: "MeshRenderer", id: "rockmesh",
  params: { mesh: "rock-a", orientation: "tumble", lit: true } }

// dust cloud, same burst
vfx_add_node { docId: "my-earth", type: "Emitter", id: "dustem", params: {
  shape: "sphere", radius: 0.4, burst: 18, rate: 0, speedMin: 0.5, speedMax: 1.8,
  lifetimeMin: 1.2, lifetimeMax: 2 } }
vfx_add_node { docId: "my-earth", type: "InitialProperties", id: "dustip",
  params: { sizeMin: 0.3, sizeMax: 0.6, randomFrameStart: true } }
vfx_add_node { docId: "my-earth", type: "Drag", id: "dustdrag", params: { coefficient: 1.2 } }
vfx_add_node { docId: "my-earth", type: "OverLife", id: "dustol", params: {
  sizeOverLife: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:1},{x:1,y:2.2}] },
  opacityOverLife: { domain: "normalized", interpolation: "linear",
                      keys: [{x:0,y:0},{x:0.2,y:0.4},{x:1,y:0}] },
  colorOverLife: { stops: [ {position:0,color:{srgb:"#A89A86",alpha:1}},
                             {position:1,color:{srgb:"#8C7A66",alpha:1}} ] } } }
vfx_add_node { docId: "my-earth", type: "Material", id: "dustmat",
  params: { template: "SpriteTextured", sprite: "smoke-puff", blend: "normal", opacity: 1, groundFade: 0.2 } }
vfx_add_node { docId: "my-earth", type: "BillboardRenderer", id: "dustbb", params: { flipbookMode: "overLife" } }

// wiring
vfx_connect { docId: "my-earth", from: "sched.start", to: "em.trigger" }
vfx_connect { docId: "my-earth", from: "node-target.out", to: "em.anchor" }
vfx_connect { docId: "my-earth", from: "em.particles", to: "ip.particles" }
vfx_connect { docId: "my-earth", from: "ip.particles", to: "grav.particles" }
vfx_connect { docId: "my-earth", from: "grav.particles", to: "ground.particles" }
vfx_connect { docId: "my-earth", from: "ground.particles", to: "rockmesh.particles" }
vfx_connect { docId: "my-earth", from: "rockmat.material", to: "rockmesh.material" }
vfx_connect { docId: "my-earth", from: "rockmesh.visual", to: "node-output.visual" }
vfx_connect { docId: "my-earth", from: "sched.start", to: "dustem.trigger" }
vfx_connect { docId: "my-earth", from: "node-target.out", to: "dustem.anchor" }
vfx_connect { docId: "my-earth", from: "dustem.particles", to: "dustip.particles" }
vfx_connect { docId: "my-earth", from: "dustip.particles", to: "dustdrag.particles" }
vfx_connect { docId: "my-earth", from: "dustdrag.particles", to: "dustol.particles" }
vfx_connect { docId: "my-earth", from: "dustol.particles", to: "dustbb.particles" }
vfx_connect { docId: "my-earth", from: "dustmat.material", to: "dustbb.material" }
vfx_connect { docId: "my-earth", from: "dustbb.visual", to: "node-output.visual" }

vfx_set_document { docId: "my-earth", durationTicks: 155 }
vfx_compile { docId: "my-earth" }
vfx_render_frames { docId: "my-earth", ticks: [10, 30, 90] }
```

**Verified 2026-09-30**: built `recA-earth-scratch`, compiled (warned the 120-tick default needed 150+ for the
tail — set 155), rendered ticks 10/30/90 — chunks blasting outward and tumbling at tick 10, still airborne with a
dust bloom at tick 30, and settled/scattered on the ground with most chunks stopped by tick 90; convincing without
sound or camera shake. [SAW]

## Variants

| Variant | Change from the base burst |
|---|---|
| Heavy boulders | fewer chunks (2–4), larger `sizeMin/Max` (0.5–0.9 m), lower `speedMax` (2–4 m/s), slower tumble (`angularVelocityMin/Max` ±3) |
| Gravel / chips | many chunks (30+), small `sizeMin/Max` (0.05–0.15 m), higher `speedMax` (5–8), fast tumble |
| Ground pulse + eruption | precede the burst with a flat `RingPath`/`SpriteRenderer` ground flash (~12 ticks) before the stones trigger, so the eruption has anticipation |
| Crumbling wall / collapse | many small chunks with a short upward burst then straight down (`Gravity` dominant, low `speedMax`), `GroundCollision maxBounces` 0–1 (mode `kill` after first contact) |
| Contact puffs along a path | small dust bursts triggered by each chunk's `GroundCollision.collision` event |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| Flat plastic-looking rocks | no `surfaceDetail`/`colorVariation`/`reflection` | `surfaceDetail` ~0.75, `detailScale` ~5, `colorVariation` ~0.7, `reflection` ~0.3 |
| Rocks bounce like rubber balls | `restitution` too high | drop to 0.15–0.3 |
| Chunks fly through the floor | no `GroundCollision` | add it, mode `bounce` or `slide` |
| Every chunk identical | `mesh` all `rock-a`, no rotation/size variety | mix `rock-a`/`rock-b`/`rock-c` (several Emitter/MeshRenderer chains or randomise per particle), vary `sizeMin/Max` |
| No sense of impact, just rocks flying | no dust, no ground pulse | add the dust layer; precede with a brief ground flash for a heavier effect |
| Rocks look like they're glowing/lit from inside | `blend: "additive"` on a mesh, or high `emission` | rock meshes are normal-blend `MeshLit`; keep `emission` at 0 |

## Ticks / camera to check

Burst / impact shape: trigger tick, +2 (initial blast), +8 (still airborne, dust blooming), +30 (chunks falling
and starting to bounce), and near the end of the longest chunk's life (settled, dust dissipated). A low,
ground-level camera sells the bounces and settling better than a top-down view. Check `background: "light"` —
brown dust can be hard to judge for opacity against a dark floor.
