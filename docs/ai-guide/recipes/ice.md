# Ice

Ice shards, crystal eruptions, frost. Components: `ice-shards` (burst of shards), and the `ice-eruption` /
`ice-fan` / `ice-cluster` family (05-ICE, crystals growing from the ground then fracturing).

## What makes ice read right

- **Lit crystal meshes, restrained glow.** `MeshRenderer` with `mesh: "crystal"` / `"crystal-b"` / `"shard"`,
  `Material` tint `#4E94BE`, **low** `roughness` (~0.08 — glossy facets), `reflection` ~0.6, `surfaceDetail` ~0.3,
  `colorVariation` ~0.45, a thin `rim` ~0.25 with `rimColor` `#CFF4FF`. Keep `reflection` and `rim` **low** — push
  either too far and ice reads as glowing neon instead of cold glass. `opacity` ~0.88 (not fully opaque — light
  should pass through a little).
- **Grow, don't pop.** Shards that grow from the ground read best with `pivot: "base"` and either a fast
  `sizeOverLife` ramp-in (`0:0, 0.2:1, 1:1`) or (for the eruption family) a genuine grow-hold-fracture sequence:
  crystals grow from the ground (~24 ticks), hold, then fracture into falling fragments (~90 ticks in).
  Instant full-size shards read as "spawned", not "grown".
- **Cold air**: a slow, low-opacity (~0.16) `smoke-puff` mist rising gently around the base for as long as the
  shards stand — frost, not smoke; keep it faint and slow.
- **Blend is normal/lit for the crystals**; any additive use is restricted to small glints (`soft-glow`,
  additive, tiny, low opacity) catching the light off a facet, not the crystal body itself.
- **Motion**: shards that erupt (vs. grow in place) launch with `Gravity` down and `GroundCollision` — mode
  `slide` or a single low-restitution `bounce` then stop (ice doesn't bounce bouncily; it chips and settles).
- **Size vs a 1.8 m character**: a fan of low shards is ~0.3–0.6 m tall; a tall cluster (like `ice-cluster`) can
  reach 4–6 m for a dramatic spell.
- **Colour**: keep the light source close to white/pale blue (`#DFF6FF`/`#BFEAFF`) for glints and frost — a fully
  saturated blue ice reads like coloured glass, not cold.

## Fastest: start from a component

| Want | Component id | Key knobs |
|---|---|---|
| A burst of lit shards + frost mist | `ice-shards` | `ctl-ice-shards-shards` (count), `ctl-ice-shards-force`, `ctl-ice-shards-size`, `ctl-ice-shards-frost` |
| Crystals grow-hold-fracture (full 05-ICE look) | `ice-eruption` | `ctl-ice-eruption-count`, `ctl-ice-eruption-height`, `ctl-ice-eruption-spread`, `ctl-ice-eruption-edge` (edge brightness) |
| Short, low, outward-leaning shards | `ice-fan` (eruption variant) | `height` ~1.8, `spread` ~1.4 |
| A few tall, slowly-growing crystals | `ice-cluster` (eruption variant) | `count` 4, `height` ~6, `spread` 0.55 (tight cluster) |

`vfx_add_component { docId, component: "ice-shards", group: true }` then render past the burst tick. Recolour with
**Ice colour** (crystal + frost) and **Sparks colour** (glints).

**Verified 2026-09-30**: built `recA-ice-component` from `ice-shards`, rendered tick 40 — a burst of lit pale-blue
crystal shards with a soft frost puff at the base and small glints scattered around; reads clearly as an ice
burst. [SAW]

## From scratch: crystals growing from the ground + frost mist

```
vfx_new_document { template: "blank", id: "my-ice" }

vfx_add_node { docId: "my-ice", type: "Schedule", id: "sched", params: { mode: "once", startTicks: 5 } }
vfx_add_node { docId: "my-ice", type: "Emitter", id: "em", params: {
  shape: "disc", radius: 0.5, burst: 9, rate: 0, speedMin: 0.1, speedMax: 0.4,
  lifetimeMin: 3, lifetimeMax: 3, direction: [0, 1, 0], coneAngle: 0.3 } }
vfx_add_node { docId: "my-ice", type: "InitialProperties", id: "ip",
  params: { sizeMin: 0.35, sizeMax: 0.7, rotationMin: -0.3, rotationMax: 0.3 } }
vfx_add_node { docId: "my-ice", type: "Material", id: "icemat", params: {
  template: "MeshLit", tint: { srgb: "#4E94BE", alpha: 1 }, opacity: 0.88, roughness: 0.08,
  reflection: 0.6, surfaceDetail: 0.3, colorVariation: 0.45, rim: 0.25,
  rimColor: { srgb: "#CFF4FF", alpha: 1 } } }
vfx_add_node { docId: "my-ice", type: "MeshRenderer", id: "icemesh", params: {
  mesh: "crystal", pivot: "base", orientation: "upright", tilt: 0.15, scaleY: 3,
  sizeOverLife: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0},{x:0.25,y:1},{x:1,y:1}] } } }

// frost mist, a slow separate low-rate window
vfx_add_node { docId: "my-ice", type: "Schedule", id: "frostwin",
  params: { mode: "window", startTicks: 5, durationTicks: 150 } }
vfx_add_node { docId: "my-ice", type: "Emitter", id: "frostem", params: {
  shape: "disc", radius: 0.6, rate: 3, burst: 0, speedMin: 0.1, speedMax: 0.3,
  lifetimeMin: 1.5, lifetimeMax: 2.5, direction: [0, 1, 0], coneAngle: 0.4 } }
vfx_add_node { docId: "my-ice", type: "InitialProperties", id: "frostip",
  params: { sizeMin: 0.3, sizeMax: 0.5, randomFrameStart: true } }
vfx_add_node { docId: "my-ice", type: "OverLife", id: "frostol", params: {
  opacityOverLife: { domain: "normalized", interpolation: "linear",
                      keys: [{x:0,y:0},{x:0.25,y:0.16},{x:1,y:0}] },
  colorOverLife: { stops: [ {position:0,color:{srgb:"#DDEFF8",alpha:1}},
                             {position:1,color:{srgb:"#DDEFF8",alpha:1}} ] } } }
vfx_add_node { docId: "my-ice", type: "Material", id: "frostmat",
  params: { template: "SpriteTextured", sprite: "smoke-puff", blend: "normal", opacity: 1 } }
vfx_add_node { docId: "my-ice", type: "BillboardRenderer", id: "frostbb", params: { flipbookMode: "overLife" } }

// wiring
vfx_connect { docId: "my-ice", from: "sched.start", to: "em.trigger" }
vfx_connect { docId: "my-ice", from: "node-target.out", to: "em.anchor" }
vfx_connect { docId: "my-ice", from: "em.particles", to: "ip.particles" }
vfx_connect { docId: "my-ice", from: "ip.particles", to: "icemesh.particles" }
vfx_connect { docId: "my-ice", from: "icemat.material", to: "icemesh.material" }
vfx_connect { docId: "my-ice", from: "icemesh.visual", to: "node-output.visual" }
vfx_connect { docId: "my-ice", from: "frostwin.window", to: "frostem.window" }
vfx_connect { docId: "my-ice", from: "node-target.out", to: "frostem.anchor" }
vfx_connect { docId: "my-ice", from: "frostem.particles", to: "frostip.particles" }
vfx_connect { docId: "my-ice", from: "frostip.particles", to: "frostol.particles" }
vfx_connect { docId: "my-ice", from: "frostol.particles", to: "frostbb.particles" }
vfx_connect { docId: "my-ice", from: "frostmat.material", to: "frostbb.material" }
vfx_connect { docId: "my-ice", from: "frostbb.visual", to: "node-output.visual" }

vfx_set_document { docId: "my-ice", durationTicks: 310 }   // 3 s shard life + 2.5 s frost window tail
vfx_compile { docId: "my-ice" }
vfx_render_frames { docId: "my-ice", ticks: [15, 40, 100] }
```

**Verified 2026-09-30**: built `recA-ice-scratch`, compiled (warned the tail needed 305+ ticks — set 310),
rendered ticks 15/40/100 — nine pale-blue crystal shards growing up from the ground with visible rim light and
faceted shading, a soft frost puff drifting near the base by tick 100. At ticks 40 and 100 the default framing
camera (fixed from tick-0 content) clipped the tops of the tallest shards, since it does not re-fit as the mesh
grows taller over time — pass an explicit wider/farther `camera` when a growing effect changes bounds a lot
between the ticks you render. [SAW]

## Variants

| Variant | Change from the base crystals |
|---|---|
| Fan (short, leaning outward) | lower `scaleY` (~1.5–2), `tilt` ~0.3–0.4, wider `radius` |
| Cluster (few, tall, slow) | fewer particles (`burst` 3–5), high `scaleY` (5–8), narrow `radius`, slower `sizeOverLife` ramp |
| Burst of loose shards (not grounded) | `orientation: "tumble"` instead of `"upright"`, add `Gravity` + `GroundCollision`, drop `pivot: "base"` |
| Fracture (grow then break) | after holding at full size, trigger a second `Emitter` (fragments) on a delayed event, and fade/hide the grown crystal at the same tick |
| Frozen ground ring | pair with a flat `RingPath`/ground-hugging frost decal at Target using `OffsetAnchor { dropToGround: true }` |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| Glowing neon crystal | `reflection`/`rim` too high | drop `reflection` toward 0.5–0.7, `rim` toward 0.2–0.3 |
| Flat, chalky ice | `roughness` too high, no `surfaceDetail` | `roughness` ~0.08, `surfaceDetail` ~0.3, `colorVariation` ~0.45 |
| Crystals "spawn" instantly | no `sizeOverLife` grow-in | ramp `sizeOverLife` from 0 over the first 15–25% of life |
| Ice looks like coloured glass, not cold | fully saturated tint | keep tint mid-blue (`#4E94BE`ish), let `rimColor` carry the pale highlight |
| Shards clip off-screen in later frames | growing mesh outgrows the auto-fit camera set at tick 0 | pass an explicit `camera` (wider FOV or farther back) instead of relying on default framing |
| No sense of cold | no frost mist | add a slow, faint (opacity ~0.16) smoke-puff layer at the base |

## Ticks / camera to check

Charge-up/grow (if any): start, halfway through the grow, full height held. Burst: trigger tick, +5, +15
(near-full growth), and later once frost mist has had time to drift (60–100 ticks). Because ice effects often grow
in height well past the initial frame, render at least one late tick and check nothing is clipped by the camera —
pass an explicit `camera` rather than trusting default auto-framing for anything that changes bounds a lot.
