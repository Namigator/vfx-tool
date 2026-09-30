# Water

Streams, splashes, fountains, rain. Components: `fountain`, `rain-splash`, and the `water-stream` /
`water-narrow` / `water-broad` family (03-WATER, arcing stream that lands in a splash with droplets, foam and
ripples).

## What makes water read right

- **Never a solid blue ribbon.** The body ribbon uses `Material.template: "SurfaceTranslucent"`
  (or `RibbonUnlit` with `liquid` set) with `liquid` ~0.85, a **pale** tint (`#D8EEF8`-ish, not saturated blue),
  `blend: "normal"`. `liquid` makes the middle see-through and highlights run along the flow — 0 gives a flat
  solid-colour ribbon that reads as plastic/rubber, not liquid.
- **Droplets and foam are sprites, normal blend, near-white.** `droplet` sprite, `blend: "normal"`, near-white
  tint. **Additive droplets read as sparks, not water** — this is the single most common mistake going from
  fire/sparks habits to water.
- **Bubbles/gas**: `bubble` sprite (thin rim, clear middle), `blend: "normal"`, opacity ~0.75.
  `ripple-ring` sprite reads as a flat expanding circle — good for concentric ripples on impact, not for
  splashes themselves.
- **Motion**: a stream that travels Source→Target follows a `BezierPath` with a gentle arch (both handles
  pointing up, `startHandle`/`endHandle` ~`[0, 1–2, 0]`) — a dead-straight `LinePath` reads as a laser, not water.
  Gravity `[0, -9.81, 0]` on droplets, full strength (water is heavy, it falls fast). `GroundCollision` (kill or a
  single soft bounce) for droplets landing.
- **Phases**: travel (the head moving along the path, `PathFollower` with `Travel ticks`/`Speed`) → arrival
  (splash burst of droplets + foam + expanding ripples, triggered by `PathFollower.arrival`, not a fixed tick, so
  it stays synced if travel time changes) → the body ribbon keeps flowing continuously behind the head via a
  `window` on the `RibbonRenderer` while the arrival keeps re-triggering bursts.
- **Size vs a 1.8 m character**: a narrow stream is ~0.1–0.15 m wide; a broad splash body ~0.3 m; a splash impact
  pool ~0.7–2 m across; ripples 1.4–3.2 m.
- **Ground contact**: ripples and the splash pool should sit exactly at Target and follow it if it moves — use
  `OffsetAnchor { dropToGround: true }` from Target, never a separate fixed anchor.

## Fastest: start from a component

| Want | Component id | Key knobs |
|---|---|---|
| Arcing stream Source→Target landing in a splash | `water-stream` | `ctl-water-stream-width`, `ctl-water-stream-travel`, `ctl-water-stream-droplets`, `ctl-water-stream-foam`, `ctl-water-stream-splash`, `ctl-water-stream-ripple` |
| Thin fast jet, small splash, almost no foam | `water-narrow` (stream variant) | `width` ~0.14, `travel` ~20, `foam` ~3 |
| Low wide body, big splash, wide ripples | `water-broad` (stream variant) | `width` ~0.32, `droplets` ~190, `splash` ~1.9, `ripple` ~3.2 |
| Upward fountain (plays at Source, no travel) | `fountain` | `ctl-fountain-flow` (rate), `ctl-fountain-height` (jet speed), `ctl-fountain-spread`, `ctl-fountain-bounce` |
| Falling rain that splashes on landing | `rain-splash` | `ctl-rain-splash-rain` (rate), `ctl-rain-splash-area`, `ctl-rain-splash-splash` (drop count), `ctl-rain-splash-splash-speed` |

`vfx_add_component { docId, component: "water-stream", group: true }` then render past the arrival tick (the
splash needs `travel` ticks + a few to appear). Recolour with **Water colour** (body) and **Droplets colour** /
**Splash & rings colour**.

**Verified 2026-09-30**: built `recA-water-component` from `water-stream`, rendered tick 40 (head still
mid-flight, only the arcing ribbon visible — expected, arrival is at tick ~18+30=48) and tick 70 — by tick 70 a
full splash ring, scattered droplets and foam bloom at the landing point around the arced ribbon; exactly the
described look. [SAW]

## From scratch: arcing stream + droplet splash

```
vfx_new_document { template: "blank", id: "my-water" }

vfx_add_node { docId: "my-water", type: "BezierPath", id: "arc",
  params: { startHandle: [0, 2.2, 0], endHandle: [0, 0.8, 0], samples: 48 } }
vfx_add_node { docId: "my-water", type: "Material", id: "watermat", params: {
  template: "SurfaceTranslucent", tint: { srgb: "#D8EEF8", alpha: 1 }, blend: "normal",
  liquid: 0.85, opacity: 0.9 } }
vfx_add_node { docId: "my-water", type: "RibbonRenderer", id: "waterrib",
  params: { width: 0.28, endFade: 0.06, orientation: "parallelTransport" } }
vfx_add_node { docId: "my-water", type: "Schedule", id: "flowwin",
  params: { mode: "window", startTicks: 0, durationTicks: 120 } }

// splash: a repeating burst of droplets at Target
vfx_add_node { docId: "my-water", type: "Schedule", id: "splashsched",
  params: { mode: "repeat", startTicks: 0, repeatIntervalTicks: 10, repeatCount: 12 } }
vfx_add_node { docId: "my-water", type: "Emitter", id: "dropem", params: {
  shape: "cone", coneAngle: 0.9, radius: 0.1, burst: 10, rate: 0,
  speedMin: 1.2, speedMax: 2.8, lifetimeMin: 0.4, lifetimeMax: 0.8, direction: [0, 1, 0] } }
vfx_add_node { docId: "my-water", type: "InitialProperties", id: "dropip", params: { sizeMin: 0.04, sizeMax: 0.08 } }
vfx_add_node { docId: "my-water", type: "Gravity", id: "dropgrav", params: { acceleration: [0, -9.81, 0] } }
vfx_add_node { docId: "my-water", type: "Material", id: "dropmat", params: {
  template: "SpriteTextured", sprite: "droplet", blend: "normal", opacity: 0.9,
  tint: { srgb: "#EAF6FF", alpha: 1 } } }
vfx_add_node { docId: "my-water", type: "BillboardRenderer", id: "dropbb",
  params: { alignment: "velocity", stretchRatio: 1.6, pivot: 0.5 } }

// wiring
vfx_connect { docId: "my-water", from: "node-source.out", to: "arc.start" }
vfx_connect { docId: "my-water", from: "node-target.out", to: "arc.end" }
vfx_connect { docId: "my-water", from: "arc.paths", to: "waterrib.paths" }
vfx_connect { docId: "my-water", from: "watermat.material", to: "waterrib.material" }
vfx_connect { docId: "my-water", from: "flowwin.window", to: "waterrib.window" }
vfx_connect { docId: "my-water", from: "waterrib.visual", to: "node-output.visual" }
vfx_connect { docId: "my-water", from: "splashsched.start", to: "dropem.trigger" }
vfx_connect { docId: "my-water", from: "node-target.out", to: "dropem.anchor" }
vfx_connect { docId: "my-water", from: "dropem.particles", to: "dropip.particles" }
vfx_connect { docId: "my-water", from: "dropip.particles", to: "dropgrav.particles" }
vfx_connect { docId: "my-water", from: "dropgrav.particles", to: "dropbb.particles" }
vfx_connect { docId: "my-water", from: "dropmat.material", to: "dropbb.material" }
vfx_connect { docId: "my-water", from: "dropbb.visual", to: "node-output.visual" }

vfx_set_document { docId: "my-water", durationTicks: 165 }
vfx_compile { docId: "my-water" }
vfx_render_frames { docId: "my-water", ticks: [20, 60, 110] }
```

This scratch build keeps the ribbon flowing for the whole window rather than animating a travelling head (skip
`PathFollower`/`RevealPath` for simplicity) — it reads as an already-flowing stream rather than one that's still
arriving. Add `PathFollower` + `RevealPath` (clip the path at the follower's `progress`) for a stream that visibly
shoots out and arrives, matching the full `water-stream` component.

**Verified 2026-09-30**: built `recA-water-scratch`, compiled (warned the tail needed 159+ ticks — set 165),
rendered ticks 20/60/110 — a pale, curved, translucent ribbon arcing from source to target with droplets falling
and scattering at the landing point throughout. The ribbon reads more like a smooth tube than the layered
body+highlight+core look of the real `water-stream` component (which stacks several ribbons) — this simplified
single-ribbon version is a reasonable starting point but benefits from a second, narrower additive-free highlight
ribbon on top for the polished look. [SAW]

## Variants

| Variant | Change from the base stream |
|---|---|
| Narrow fast jet | smaller `width` (~0.12–0.15), higher speed, smaller splash/droplet counts |
| Broad low splash | wider `width` (~0.3+), flatter arch (lower handle heights), bigger splash/ripple sizes |
| Fountain (no travel, plays at Source) | skip the path/travel entirely: a cone `Emitter` straight up from Source, `Gravity` down, `GroundCollision bounce` with moderate `restitution` (~0.35) |
| Rain | many independent short vertical streams (a wide-area `Emitter`, `shape: "box"` or wide cone, falling), each `GroundCollision`-triggering its own tiny splash burst |
| Poison/acid instead of water | swap tint to sickly green/yellow, add slow rising bubbles, keep `liquid` high but lower `opacity` for a thicker look |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| Solid blue rubber hose | `liquid` 0 or very low, saturated tint | `liquid` ~0.85, pale tint (`#D8EEF8`-ish) |
| Droplets look like sparks | `blend: "additive"` on droplets | `blend: "normal"`, near-white tint |
| Water looks like a laser beam | straight `LinePath` instead of an arched `BezierPath` | arch both handles upward |
| No sense of impact | no droplet burst/ripple triggered by arrival | trigger a burst + `RingPath`/ripple sprite on `PathFollower.arrival` |
| Splash doesn't follow a moving Target | droplet/ripple anchored to a fixed point | anchor to `node-target.out` (or `OffsetAnchor{dropToGround:true}` from it) |
| Ribbon reads flat, no shimmer | `SurfaceTranslucent`/`liquid` missing, or `uvScroll` unused | add `liquid`, optionally a slow `uvScroll` for flow highlights |

## Ticks / camera to check

Travelling stream: launch, mid-flight (arc visible), arrival tick (`vfx_list_timeline`), arrival+5 (splash
peaking), arrival+30 (settling, ripples expanding). Continuous (fountain, rain): ramp-up, steady middle, the last
10 ticks, and after the window closes (droplets still falling). Check from the side to see the arch and from
above the landing point to see ripples/foam spread.
