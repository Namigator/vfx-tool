# Poison

A seeping yellow-green cloud at Target, rising bubbles that pop into droplets, dark drips falling to the floor, and
a lingering ground stain. Ramps in, holds, fades — the slowest-reading of the elemental families.

## What makes poison read right

- **Blend: normal for the cloud/residue (it's gas/liquid, covering not adding), a touch of emission (0.08–0.1) so it
  doesn't vanish in shadow.** Bubbles and droplets are also normal blend but brighter tint and higher opacity
  (0.75–0.95) since they're small, sharp highlights inside the cloud, not the cloud itself.
- **Colour ages toward dark, not brighter.** `colorOverLife` on the cloud sprite goes bright yellow-green
  (`#A6C832`) → mid green (`#6F9A22`) → near-black green (`#2E4712`) as each puff ages — this is what gives a
  "sickly, rotting" read instead of a flat green fog. Drips/residue use the darkest tone directly.
  Bubbles stay a brighter, slightly different green (`#B8DA50`/`#C8EE6A`) so they pop out of the duller cloud body.
- **The cloud is disc-emitted upward, not a sphere burst.** `Emitter(shape:"disc", direction:[0,1,0])` at the Target
  (or an `OffsetAnchor` sitting a little above it) with a slow `rateOverWindow` ramp (0.3→1 over the first ~13%,
  hold, fall to 0.2 at the end) plus `NoiseForce(mode:"curl")` for drift and slight upward `Gravity` (0.1–0.15
  m/s²) — a sphere burst looks like an explosion, not a seep.
- **Bubbles die into pops.** Route the bubble particle stream through `ParticleEvents` (`.death`) into a small
  `popdrops` burst `Emitter` with `useEventPosition: true` — a few tiny droplets flung out and falling under gravity
  wherever a bubble disappears. This single wire is what makes the cloud feel alive instead of just foggy.
- **Drips need `GroundCollision { mode: "kill" }`** so they disappear on contact instead of visibly clipping through
  the floor, and a **ground residue** (`OffsetAnchor` at the floor, a flat `SpriteRenderer` with `alignment:
  "worldAxis"`) that fades in slowly and lingers well past the cloud itself — poison should leave a stain.
- **Size vs a 1.8 m character**: cloud radius 0.3 m (tight bubbling plume) to 1.2 m (creeping pool); sprite
  `sizeOverLife` grows ×3.3 over each puff's life so the cloud visibly billows rather than staying pin-sized.
- **Timing**: ramp-in over the first ~15–20% of the active window (~138 ticks total), bubbles start a little after
  the cloud (offset +18 ticks) and run the rest of the window, the ground residue starts almost immediately
  (+6 ticks) but keeps going long after the cloud schedule ends (own window, ~232 ticks) — poison should still be
  visible on the ground well after the gas itself has drifted off.

## Fastest: start from a component

| id | look | radius | density | rise | bubbles |
|---|---|---|---|---|---|
| `poison-cloud` | simple seeping cloud + rising bubbles + sickly floor glow | 0.8 m | 45/s | — | 30/s |
| `poison-caustic` | slow yellow-green cloud, rim bubbles pop to droplets, dark drips, ground stain | 0.65 m | 24/s | 0.7 m/s | 10/s |
| `poison-pool` | low, wide, creeping — few bubbles | 1.2 m | 22/s | 0.2 m/s | 3/s |
| `poison-plume` | tall, narrow base, many bubbles/drips | 0.3 m | 26/s | 1.5 m/s | 20/s |

```
vfx_new_document { template: "blank", id: "p", component: "poison-caustic" }
vfx_compile { docId: "p" }
vfx_render_frames { docId: "p", ticks: [40, 150, 250] }   # building / steady / fading tail
```

Common knob turns:

| Want | Knob | Example |
|---|---|---|
| Bigger/smaller cloud | `radius` (Cloud radius, m) | `1.8` for a room-filling gas |
| Denser/thinner gas | `density` (perSecond) | `60` for a thick toxic cloud |
| Faster/slower rise | `rise` (m/s) | `0.1` for a pool that barely rises |
| More/fewer bubbles | `bubbles` (perSecond) | `2` for a near-still pool |
| Recolour (purple curse gas, blue plague) | `colour-smoke` / `colour-shift` | `{ srgb: "#8A4CC8", alpha: 1 }` |

## From scratch: seeping cloud with popping bubbles

```
vfx_new_document { template: "blank", id: "poison2" }
vfx_set_document { docId: "poison2", durationTicks: 276 }

vfx_add_node { docId: "poison2", type: "Schedule", id: "active", params: { startTicks: 0, durationTicks: 138, mode: "window" } }
vfx_add_node { docId: "poison2", type: "Emitter", id: "cloud", params: { shape: "disc", direction: [0,1,0], radius: 0.65, rate: 24, burst: 8, speedMin: 0.25, speedMax: 0.7, lifetimeMin: 1.2, lifetimeMax: 2.3, rateOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0.3},{x:0.13,y:1},{x:0.85,y:1},{x:1,y:0.2}] } } }
vfx_connect { docId: "poison2", from: "node-target.out", to: "cloud.anchor" }
vfx_connect { docId: "poison2", from: "active.window", to: "cloud.window" }
vfx_connect { docId: "poison2", from: "active.start", to: "cloud.trigger" }
vfx_add_node { docId: "poison2", type: "InitialProperties", id: "cloudip", params: { sizeMin: 0.25, sizeMax: 0.35, randomFrameStart: true, rotationMin: 0, rotationMax: 6.283 } }
vfx_add_node { docId: "poison2", type: "Drag", id: "clouddrag", params: { coefficient: 0.6 } }
vfx_add_node { docId: "poison2", type: "NoiseForce", id: "clouddrift", params: { mode: "curl", amplitude: 0.25, frequency: 0.5, evolution: 0.35 } }
vfx_add_node { docId: "poison2", type: "Gravity", id: "cloudlift", params: { acceleration: [0, 0.12, 0] } }
vfx_add_node { docId: "poison2", type: "Material", id: "cloudmat", params: { template: "SpriteTextured", sprite: "smoke-puff", blend: "normal", opacity: 1, emission: 0.08 } }
vfx_add_node { docId: "poison2", type: "BillboardRenderer", id: "cloudbb", params: { flipbookMode: "overLife", sizeOverLife: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:1},{x:1,y:3.3}] }, opacityOverLife: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0},{x:0.15,y:0.6},{x:0.7,y:0.42},{x:1,y:0}] }, colorOverLife: { stops: [{position:0,color:{srgb:"#A6C832",alpha:1}},{position:0.35,color:{srgb:"#6F9A22",alpha:1}},{position:1,color:{srgb:"#2E4712",alpha:1}}] } } }
vfx_connect { docId: "poison2", from: "cloud.particles", to: "cloudip.particles" }
vfx_connect { docId: "poison2", from: "cloudip.particles", to: "clouddrag.particles" }
vfx_connect { docId: "poison2", from: "clouddrag.particles", to: "clouddrift.particles" }
vfx_connect { docId: "poison2", from: "clouddrift.particles", to: "cloudlift.particles" }
vfx_connect { docId: "poison2", from: "cloudlift.particles", to: "cloudbb.particles" }
vfx_connect { docId: "poison2", from: "cloudmat.material", to: "cloudbb.material" }
vfx_connect { docId: "poison2", from: "cloudbb.visual", to: "node-output.visual" }

# Bubbles that pop into droplets on death (ParticleEvents -> Emitter.trigger with useEventPosition)
vfx_add_node { docId: "poison2", type: "Schedule", id: "bubblewin", params: { startTicks: 18, durationTicks: 120, mode: "window" } }
vfx_add_node { docId: "poison2", type: "Emitter", id: "bubbles", params: { shape: "disc", direction: [0,1,0], radius: 0.52, rate: 10, speedMin: 0.4, speedMax: 1, lifetimeMin: 0.6, lifetimeMax: 1.3 } }
vfx_connect { docId: "poison2", from: "node-target.out", to: "bubbles.anchor" }
vfx_connect { docId: "poison2", from: "bubblewin.window", to: "bubbles.window" }
vfx_add_node { docId: "poison2", type: "InitialProperties", id: "bubbleip", params: { sizeMin: 0.08, sizeMax: 0.28 } }
vfx_add_node { docId: "poison2", type: "NoiseForce", id: "bubblewobble", params: { mode: "vector", amplitude: 0.4, frequency: 1.5, evolution: 1 } }
vfx_add_node { docId: "poison2", type: "ParticleEvents", id: "pops", params: { probability: 1, maxEvents: 256 } }
vfx_add_node { docId: "poison2", type: "Emitter", id: "popdrops", params: { shape: "sphere", radius: 0.02, burst: 4, speedMin: 0.3, speedMax: 1.2, lifetimeMin: 0.15, lifetimeMax: 0.35, useEventPosition: true } }
vfx_connect { docId: "poison2", from: "bubbles.particles", to: "bubbleip.particles" }
vfx_connect { docId: "poison2", from: "bubbleip.particles", to: "bubblewobble.particles" }
vfx_connect { docId: "poison2", from: "bubblewobble.particles", to: "pops.particles" }
vfx_connect { docId: "poison2", from: "pops.death", to: "popdrops.trigger" }
vfx_add_node { docId: "poison2", type: "InitialProperties", id: "popip", params: { sizeMin: 0.015, sizeMax: 0.03 } }
vfx_add_node { docId: "poison2", type: "Gravity", id: "popg", params: { acceleration: [0,-4,0] } }
vfx_add_node { docId: "poison2", type: "Material", id: "popmat", params: { template: "SpriteTextured", sprite: "droplet", blend: "normal", tint: { srgb: "#B8DA50", alpha: 1 }, opacity: 0.9 } }
vfx_add_node { docId: "poison2", type: "BillboardRenderer", id: "popbb", params: { alignment: "velocity", stretchRatio: 1.6 } }
vfx_connect { docId: "poison2", from: "popdrops.particles", to: "popip.particles" }
vfx_connect { docId: "poison2", from: "popip.particles", to: "popg.particles" }
vfx_connect { docId: "poison2", from: "popg.particles", to: "popbb.particles" }
vfx_connect { docId: "poison2", from: "popmat.material", to: "popbb.material" }
vfx_connect { docId: "poison2", from: "popbb.visual", to: "node-output.visual" }
vfx_compile { docId: "poison2" }
vfx_render_frames { docId: "poison2", ticks: [30, 100, 180] }
```

## Variants

| Variant | Change | Example |
|---|---|---|
| Pool | wide, low, slow rise, few bubbles | radius 1.2, rise 0.2, bubbles 3/s |
| Plume | narrow, tall, fast rise, many bubbles | radius 0.3, rise 1.5, bubbles 20/s |
| Curse/plague gas | recolour purple/sickly blue, keep the same curl+pop structure | `colour-smoke` to `#6A4C8A` |
| Instant gas burst (trap trigger) | higher `cloud.burst`, shorter `active` window | burst 30+, window 40 ticks |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| A flat green fog with no life | no `colorOverLife` aging, no bubble pops | age colour bright→dark over life; wire bubble `.death` → `popdrops` |
| Explosion instead of a seep | `Emitter shape: "sphere"` with a burst | disc emitter, direction up, mostly `rate` not `burst`, ramped `rateOverWindow` |
| Bubbles look static / glued to the cloud | no `NoiseForce(vector)` wobble on the bubble stream | add wobble before the billboard renderer |
| Drips visibly clip through the floor | no `GroundCollision` | add `GroundCollision { mode: "kill" }` on the drip particle chain |
| Nothing left a mark | no ground residue layer, or its window ends with the cloud | add a floor `OffsetAnchor` + flat sprite with its own longer window (outlives the cloud schedule) |
| Cloud pops fully formed on the first frame | `rateOverWindow` flat or missing | ramp 0.3→1 over the first ~15% of the window |

## Ticks/camera to check

Early build-up (~15–20% into the active window), steady mid-cloud, and well past the cloud's schedule end to confirm
the ground residue is still visible while the gas itself has thinned. Standard side view; also check from slightly
above since the cloud/bubbles are disc-emitted upward and read differently looking down at the pool.

**Verified 2026-09-30**: built `recB-poison` via `vfx_new_document(component:"poison-caustic")`, compiled clean (5
particle systems), rendered ticks 40/150/250 — tick 40 and 150 show a billowing yellow-green cloud with several
visible bubble spheres at different sizes rising through it; tick 250 (past the 138-tick active window, within the
232-tick residue window) shows the cloud almost entirely faded with only a faint green tint remaining, confirming
the ramp-in/fade-out behaviour described above.
