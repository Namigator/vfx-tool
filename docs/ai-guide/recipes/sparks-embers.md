# Sparks & embers

Impact sparks, ember trails, debris streaks. The generic components are `spark-burst` and `spark-aftershock`;
every fire/earth/lightning/energy family also has its own ember/spark layer built the same way (see those
recipes), so this file is also the reference for building one from scratch inside a bigger effect.

## What makes sparks/embers read right

- **Always additive**, small, and velocity-stretched: `alignment: "velocity"`, `stretchRatio` 3–6, `pivot`
  0.7–0.8 (pivot near the tail so the streak trails behind the direction of travel), `size` 0.015–0.04 m,
  `emission` 0.8–1.5. This is what turns a dot into a streak of light.
- **Colour cools fast**: white → orange → dark red, with alpha going to 0 right at the end — the same
  cooling-ember idea as fire, but compressed into a much shorter life (0.3–1.2 s vs fire's 0.4–0.75 s+).
- **Gravity direction sells the material**: sparks (hot metal, impacts) fall, `Gravity` ≈ `[0, -3..-9.8, 0]`.
  Embers (from a fire, lighter) rise or float, `Gravity` ≈ `[0, 0.9..1.6, 0]` and usually get more Drag so they
  drift rather than shoot.
- **Drag 1–2** on everything — sparks decelerate visibly, they don't fly at constant speed.
  `GroundCollision` (mode `bounce`, `restitution` ~0.3) sells impacts that hit a hard floor.
- **Burst vs rate**: an impact is a `burst` on a trigger event (an arrival, a death, `Schedule.start`); a
  shower/fountain of sparks is a steady `rate` during a `window`. Bursting sparks read best with a **cone or
  sphere** emitter shape so they spread in a starburst, not a single direction.
- **`ParticleTrail` adds tapered streaks** behind each spark (history 0.08–0.15 s) for the brightest/fastest
  sparks; it needs its own `SpriteUnlit` additive Material, separate from the spark billboard's Material.
- **Size vs a 1.8 m character**: individual sparks are tiny (2–4 cm) but very bright — a handful of them at
  emission 1+ reads much brighter than their footprint suggests; don't confuse "small" with "dim".

## Fastest: start from a component

| Want | Component id | Key knobs |
|---|---|---|
| A single burst of sparks at Target | `spark-burst` | no other published knobs besides Start at/Colour by default — open internals for burst count/speed, or use as-is |
| Sparks, then a second delayed burst | `spark-aftershock` | delayed second burst is wired internally (EventDelay); recolour with **Colour**/part pickers |
| Impact flash + a spark burst together | `impact-flash` | timed glow sprite + burst, good as a generic "something hit" cap on any effect |
| Embers rising off a flame | any fire component | `ctl-*-embers` (amount), **Embers colour** |
| Sparks off a lightning strike | `lightning-strike` family | `ctl-*-impact` / `ctl-*-source` (spark counts at each end) |

`vfx_add_component { docId, component: "spark-burst", group: true }`, then render at the burst tick — it needs no
tuning to look right; recolour with `vfx_set_control { docId, control: "ctl-spark-burst-colour-shift", value: <deg> }`.

**Verified 2026-09-30**: built `recA-sparks-component` from `spark-burst`, rendered tick 15 — a bright
white-to-orange starburst of streaking sparks with glowing trails, reading exactly as "sparks", not "dots".
Note the frame was 22.8% lit / 4.3% bright at the peak of the burst — expected for a dense bright burst, not a
flooding warning (no warning was emitted). [SAW]

## From scratch: a burst of falling, bouncing sparks

```
vfx_new_document { template: "blank", id: "my-sparks" }

vfx_add_node { docId: "my-sparks", type: "Schedule", id: "sched", params: { mode: "once", startTicks: 5 } }
vfx_add_node { docId: "my-sparks", type: "Emitter", id: "em", params: {
  shape: "sphere", burst: 80, rate: 0, speedMin: 3, speedMax: 7, lifetimeMin: 0.5, lifetimeMax: 1.1 } }
vfx_add_node { docId: "my-sparks", type: "InitialProperties", id: "ip", params: { sizeMin: 0.02, sizeMax: 0.04 } }
vfx_add_node { docId: "my-sparks", type: "Gravity", id: "grav", params: { acceleration: [0, -6, 0] } }
vfx_add_node { docId: "my-sparks", type: "Drag", id: "drag", params: { coefficient: 1.5 } }
vfx_add_node { docId: "my-sparks", type: "GroundCollision", id: "ground",
  params: { mode: "bounce", restitution: 0.3, friction: 0.5, maxBounces: 2 } }
vfx_add_node { docId: "my-sparks", type: "OverLife", id: "ol", params: {
  opacityOverLife: { domain: "normalized", interpolation: "linear",
                      keys: [{x:0,y:1},{x:0.7,y:0.8},{x:1,y:0}] },
  colorOverLife: { stops: [ {position:0,color:{srgb:"#FFFFFF",alpha:1}},
                             {position:0.3,color:{srgb:"#FFA050",alpha:1}},
                             {position:1,color:{srgb:"#5A1408",alpha:1}} ] } } }
vfx_add_node { docId: "my-sparks", type: "Material", id: "mat",
  params: { template: "SpriteTextured", sprite: "spark-streak", blend: "additive", opacity: 0.9, emission: 1.2 } }
vfx_add_node { docId: "my-sparks", type: "BillboardRenderer", id: "bb",
  params: { alignment: "velocity", stretchRatio: 4, pivot: 0.75 } }

vfx_connect { docId: "my-sparks", from: "sched.start", to: "em.trigger" }
vfx_connect { docId: "my-sparks", from: "node-target.out", to: "em.anchor" }
vfx_connect { docId: "my-sparks", from: "em.particles", to: "ip.particles" }
vfx_connect { docId: "my-sparks", from: "ip.particles", to: "grav.particles" }
vfx_connect { docId: "my-sparks", from: "grav.particles", to: "drag.particles" }
vfx_connect { docId: "my-sparks", from: "drag.particles", to: "ground.particles" }
vfx_connect { docId: "my-sparks", from: "ground.particles", to: "ol.particles" }
vfx_connect { docId: "my-sparks", from: "ol.particles", to: "bb.particles" }
vfx_connect { docId: "my-sparks", from: "mat.material", to: "bb.material" }
vfx_connect { docId: "my-sparks", from: "bb.visual", to: "node-output.visual" }

vfx_compile { docId: "my-sparks" }
vfx_render_frames { docId: "my-sparks", ticks: [8, 20, 45] }
```

**Verified 2026-09-30**: built `recA-sparks-scratch`, compiled clean (no tail warning — default 120-tick
duration already covers a ~1.1 s spark life from a tick-5 burst), rendered ticks 8/20/45 — a tight white-hot
starburst at tick 8 spreading into falling, cooling orange-to-dark-red streaks by tick 45, several visibly
bouncing off the ground plane. [SAW]

## Variants

| Variant | Change from the base burst |
|---|---|
| Embers (rise, drift) | reverse `Gravity` to `[0, 0.9..1.6, 0]`, raise `Drag` to 1.2–1.6, longer life (0.8–1.9 s), no `GroundCollision` |
| Shower / fountain (continuous, not a burst) | `burst: 0` + `rate` 20–60/s + a connected `window` instead of a trigger |
| Heavy metal sparks (impact) | `GroundCollision restitution` 0.2–0.4, tighter cone instead of sphere, `Gravity` stronger (−9.8) |
| Aftershock (two bursts) | `EventDelay` (6–20 ticks) off the first `Schedule.start`, feeding a second identical `Emitter`/chain, merged with `MergeEvents` if you need one trigger for both |
| Debris instead of sparks | swap `BillboardRenderer`+sprite for `MeshRenderer` (`rock-a/b/c`, `orientation: "tumble"`, lit `MeshLit` Material with `roughness` ~0.85, `surfaceDetail` ~0.75) |
| Tapered light trails on the brightest sparks | add a `ParticleTrail` renderer off the same chain with its own additive `SpriteUnlit` Material |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| Dots instead of streaks | no `alignment: "velocity"` / `stretchRatio` too low | `alignment: "velocity"`, `stretchRatio` 3–6, `pivot` 0.7–0.8 |
| Sparks fly forever, never slow | no `Drag` | `Drag` 1–2 |
| Sparks pass through the floor | no `GroundCollision` | add `GroundCollision` (`bounce` for impacts, `kill` to just remove them) |
| Sparks look dim/grey, not hot | `blend: "normal"` instead of additive, or `emission` 0 | `blend: "additive"`, `emission` 0.8–1.5 |
| All one direction, no starburst | `shape: "cone"` with a narrow angle on a burst | use `shape: "sphere"` (or a wide cone) for impact bursts |
| Nothing visible | `burst` set but no `trigger` connected (compile error) | wire a `Schedule.start`/other event into `Emitter.trigger`, or use `rate`+`window` for continuous |

## Ticks / camera to check

Burst / impact: the trigger tick itself, +2 (peak brightness), +8 (spreading), +30 (falling/fading), and near the
end of the longest particle life (settled/gone). Render close — sparks are small and a wide shot makes them
disappear. Check a floor-level camera angle to confirm bounces read, and `background: "light"` since additive
sparks can wash out against a bright sky but disappear against a dark one at low opacity.
