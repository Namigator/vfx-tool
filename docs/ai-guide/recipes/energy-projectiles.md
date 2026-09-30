# Energy projectiles

Charge at Source (motes pulled in) → a core flies an arc to Target on a `PathFollower`, carrying a trail, shed
sparks and a moving light → its **arrival** event drives flash, ring, burst and light at Target. This is the family
for magic bolts, energy orbs, fast needles and (with a hotter palette) small fireballs.

## What makes projectiles read right

- **The head is one small, very bright core** (`core` size 0.12–0.4 m) **with a wider, fainter halo** (`halo` ≈2.6–3×
  the core size, opacity ~0.35) — same "bright centre, colour in the halo" rule as lightning/light.
- **Two trails, not one**: a narrow bright `MotionTrail` (history 0.18–0.45 s, width ≈ core size ×0.3–0.5) plus a
  wider, fainter "sheath" `MotionTrail` (width ≈ ×2.6 the narrow one, lower opacity/emission) both following the
  same `PathFollower.anchor`. One trail alone looks like a line; two give it volume.
- **Shed particles, not just a trail**: a small continuous `Emitter` on the moving anchor (`rate` 40–60/s, tiny burst
  radius, short lifetime 0.08–0.7 s) with `NoiseForce(curl)` + `Drag` gives the bolt a sparking, unstable edge that a
  pure ribbon trail can't. Fade them out over life (`opacityOverLife` 1→0).
- **The travel is what sells speed**, not a huge core: `PathFollower.durationTicks` (Travel ticks) 20 (needle) – 56
  (heavy orb); or set `speed` (m/s) instead and let farther targets take longer automatically. A shallow arc
  (`BezierPath` handle bulge 0.1–0.7 m) reads better than a dead-straight line.
- **The impact is driven by `arrival`, not a fixed tick**: `PathFollower.arrival` fans out to every impact
  Schedule/Emitter trigger, so flash + ring + burst + light always land exactly when the core gets there, even if you
  change Travel ticks or Speed later.
- **Colour**: near-white/pale core, full saturation lives in the halo, sheath trail and impact ring/burst — not in
  the core. A fully-saturated core reads as a flat cartoon ball.
- **Size vs a 1.8 m character**: needle core ~0.12 m, standard bolt ~0.22 m, heavy orb ~0.38 m; impact ring 1.6–3.6 m
  (bigger than the character, sells "this hit something").
- **Timing phases**: charge 24–30 ticks (motes gather at Source) → flight (Travel ticks, 20–56) → arrival → impact
  window ~30–38 ticks (flash 2–6 ticks, ring expanding over the window, burst sparks with gravity+drag, light
  decaying).

## Fastest: start from a component

| id | look | travel | core | trail | impact |
|---|---|---|---|---|---|
| `energy-bolt` | the default: violet core, visible shallow arc | 36 ticks | 0.22 m | 0.3 s / 0.08 m | 90 sparks, 2.8 m ring |
| `energy-needle` | fast, narrow, long thin trail, small sharp hit | 20 ticks | 0.12 m | 0.45 s / 0.035 m | 50 sparks, 1.6 m ring |
| `energy-orb` | slow, heavy, broad short trail, big hit | 56 ticks | 0.38 m | 0.18 s / 0.2 m | 150 sparks, 3.6 m ring |
| `fireball` (Fire family, same shape) | hot palette, flame trail instead of energy sheath | 40 ticks | 1.4 m | — | 120 sparks, 3 m flash |

```
vfx_new_document { template: "blank", id: "bolt", component: "energy-bolt" }
vfx_compile { docId: "bolt" }
vfx_render_frames { docId: "bolt", ticks: [15, 45, 66] }   # charge / mid-flight / impact
```

Common knob turns (prefix matches the component, e.g. `ctl-energy-bolt-travel`):

| Want | Knob | Example |
|---|---|---|
| Faster/slower flight | `speed` (m/s; `0` = use Travel ticks) | `25` for a fast snap-shot |
| Shorter/longer flight in ticks | `travel` (Travel ticks) | `18` for a needle-fast snap |
| Bigger/smaller core | `core` (m) | `0.5` for a heavy orb look |
| Longer/shorter trail | `trail` (Trail length, s) | `0.6` for a comet tail |
| Straighter/more curved path | `bend` (Arc bend, m) | `0` for a laser-straight shot |
| Recolour | `colour-main` / `colour-shift` | `{ srgb: "#40FF80", alpha: 1 }` for a green bolt |
| Bigger impact | `impact` (burst count), `ring` (m) | `200`, `5` for a heavy hit |

## From scratch: PathFollower + arrival → Schedule.trigger

This is the actual wiring used by `energy-bolt` (confirmed via `vfx_get_document` on the shipped component) — a
minimal version:

```
vfx_new_document { template: "blank", id: "proj" }
vfx_set_document { docId: "proj", durationTicks: 150 }

# Arc Source -> Target, and the moving anchor that follows it
vfx_add_node { docId: "proj", type: "BezierPath", id: "arc", params: { startHandle: [2.6, 0.53, 0], endHandle: [-2.6, 0.53, 0], samples: 64 } }
vfx_connect { docId: "proj", from: "node-source.out", to: "arc.start" }
vfx_connect { docId: "proj", from: "node-target.out", to: "arc.end" }
vfx_add_node { docId: "proj", type: "Schedule", id: "flight", params: { startTicks: 0, durationTicks: 60, mode: "window" } }
vfx_add_node { docId: "proj", type: "PathFollower", id: "ball", params: { durationTicks: 36, easing: "linear", speed: 0 } }
vfx_connect { docId: "proj", from: "arc.paths", to: "ball.paths" }
vfx_connect { docId: "proj", from: "flight.window", to: "ball.window" }

# The core, riding the moving anchor
vfx_add_node { docId: "proj", type: "Material", id: "coremat", params: { template: "SpriteTextured", sprite: "soft-glow", blend: "additive", tint: { srgb: "#FFFFFF", alpha: 1 }, emission: 1.4 } }
vfx_add_node { docId: "proj", type: "Schedule", id: "corewin", params: { startTicks: 0, durationTicks: 38, mode: "window" } }
vfx_add_node { docId: "proj", type: "SpriteRenderer", id: "core", params: { size: 0.22 } }
vfx_connect { docId: "proj", from: "ball.anchor", to: "core.anchor" }
vfx_connect { docId: "proj", from: "coremat.material", to: "core.material" }
vfx_connect { docId: "proj", from: "corewin.window", to: "core.window" }
vfx_connect { docId: "proj", from: "core.visual", to: "node-output.visual" }

# A trail riding the same anchor
vfx_add_node { docId: "proj", type: "Material", id: "trailmat", params: { blend: "additive", tint: { srgb: "#F0EEF4", alpha: 1 }, emission: 0.5, opacity: 0.55 } }
vfx_add_node { docId: "proj", type: "MotionTrail", id: "trail", params: { history: 0.3, width: 0.08, endFade: 0.5 } }
vfx_connect { docId: "proj", from: "ball.anchor", to: "trail.anchor" }
vfx_connect { docId: "proj", from: "trailmat.material", to: "trail.material" }
vfx_connect { docId: "proj", from: "flight.window", to: "trail.window" }
vfx_connect { docId: "proj", from: "trail.visual", to: "node-output.visual" }

# Impact: PathFollower.arrival fans out to a burst Schedule/Emitter — this is the key wiring
vfx_add_node { docId: "proj", type: "Schedule", id: "impactwin", params: { startTicks: 0, durationTicks: 30, mode: "window" } }
vfx_connect { docId: "proj", from: "ball.arrival", to: "impactwin.trigger" }
vfx_add_node { docId: "proj", type: "Emitter", id: "burst", params: { shape: "sphere", radius: 0.08, burst: 90, rate: 0, speedMin: 2, speedMax: 6, lifetimeMin: 0.3, lifetimeMax: 0.8 } }
vfx_connect { docId: "proj", from: "node-target.out", to: "burst.anchor" }
vfx_connect { docId: "proj", from: "ball.arrival", to: "burst.trigger" }
vfx_add_node { docId: "proj", type: "InitialProperties", id: "burstip", params: { sizeMin: 0.02, sizeMax: 0.04 } }
vfx_add_node { docId: "proj", type: "Drag", id: "burstdrag", params: { coefficient: 2 } }
vfx_add_node { docId: "proj", type: "Gravity", id: "burstg", params: { acceleration: [0, -3, 0] } }
vfx_add_node { docId: "proj", type: "Material", id: "burstmat", params: { template: "SpriteTextured", sprite: "spark-streak", blend: "additive", tint: { srgb: "#9B6BFF", alpha: 1 }, emission: 0.8 } }
vfx_add_node { docId: "proj", type: "BillboardRenderer", id: "burstbb", params: { alignment: "velocity", stretchRatio: 4, pivot: 0.8 } }
vfx_connect { docId: "proj", from: "burst.particles", to: "burstip.particles" }
vfx_connect { docId: "proj", from: "burstip.particles", to: "burstdrag.particles" }
vfx_connect { docId: "proj", from: "burstdrag.particles", to: "burstg.particles" }
vfx_connect { docId: "proj", from: "burstg.particles", to: "burstbb.particles" }
vfx_connect { docId: "proj", from: "burstmat.material", to: "burstbb.material" }
vfx_connect { docId: "proj", from: "burstbb.visual", to: "node-output.visual" }
vfx_compile { docId: "proj" }
vfx_render_frames { docId: "proj", ticks: [10, 30, 40] }
```

Note `flight.window`/`corewin.window` open at `startTicks: 0` here for simplicity; the shipped component opens them
at the charge-end tick and derives `impactwin`/ring/light Schedules' start from the same tick plus a small offset —
do that once you add a charge phase, so nothing shows before the core actually launches.

## Several projectiles at once: RadialPath → PathSplitter → PathFollower

A `PathFollower` follows **every** path it is given, and everything riding its `anchor` is repeated per path, so a
volley is just a path set: `RadialPath` (one ray per projectile) → `PathSplitter` (optional: pick which rays fly) →
`PathFollower`. `arrival` fires once per ray, at that ray's own end.

```
vfx_add_node { docId: "volley", type: "RadialPath", id: "rays", params: { mode: "disc", count: 5, lengthMin: 2.5, lengthMax: 4 } }
vfx_connect { docId: "volley", from: "node-source.out", to: "rays.center" }
vfx_add_node { docId: "volley", type: "PathSplitter", id: "pick", params: { mode: "range", from: 0, count: 2 } }   # optional: only 2 of the 5 fly
vfx_connect { docId: "volley", from: "rays.paths", to: "pick.paths" }
vfx_add_node { docId: "volley", type: "Schedule", id: "flight", params: { startTicks: 20, durationTicks: 60, mode: "window" } }
vfx_add_node { docId: "volley", type: "PathFollower", id: "fly", params: { durationTicks: 40 } }   # or speed: 4 -> each ray takes its own length / speed
vfx_connect { docId: "volley", from: "pick.paths", to: "fly.paths" }        # or "rays.paths" for all 5
vfx_connect { docId: "volley", from: "flight.window", to: "fly.window" }
# streak: an Emitter (rate 60) on fly.anchor is a full-rate streak behind EACH projectile
vfx_connect { docId: "volley", from: "fly.anchor", to: "streak.anchor" }
# impacts: fly.arrival -> an Emitter with useEventPosition: true = one burst at each ray's end, at its own tick
vfx_connect { docId: "volley", from: "fly.arrival", to: "impact.trigger" }
```

Choosing with `PathSplitter`: `everyNth` (step 2) gives every other ray, `random` (count 3) a fixed random pick
(change the node's random stream or the document seed for another), `longest` / `shortest` the 1..N extremes. The
`rest` output carries the paths that were not chosen (e.g. draw them as dim cracks while the chosen ones fly). Check
`vfx_compile`: it lists `follows 5 paths … arrivals at ticks …`. More than 4 point lights on a volley hits the light
budget (one light per path): use a shared glow sprite instead.

## Variants

| Variant | Change | Example |
|---|---|---|
| Needle | short travel, small core, long thin trail, small hit | travel 20, core 0.12, trail width 0.035 |
| Heavy orb | long travel, big core, broad short trail, big hit | travel 56, core 0.38, trail width 0.2, ring 3.6 |
| Fireball (hot variant) | swap palette to orange/red, add a flame-textured trail emitter instead of the energy sheath | use the `fireball` component directly |
| Homing/aimed (Roblox export) | `play(model, nil, { source, target, speed })` retargets at runtime | see export.md |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| A flat coloured ball with no life | core fully saturated, no halo, no shed particles | pale/white core, saturated halo, add the shed `NoiseForce` emitter |
| A single thin line instead of a bolt | only one trail (no sheath) | add the wider, fainter sheath `MotionTrail` |
| Impact happens before/after the core arrives | impact Schedule on a fixed tick instead of `PathFollower.arrival` | wire `.arrival` → every impact trigger |
| Impact never appears | `arrival` not connected, or `corewin`/`impactwin` window too short to reach the arrival tick | check `vfx_list_events`; make sure window durationTicks covers arrival + the impact tail |
| Trail lags or stutters | `MotionTrail.history` too short for the travel speed | raise history (0.3–0.6 s) or increase `maxPoints` |
| Bolt looks too slow/floaty for its distance | Travel ticks too high for the Source→Target distance | lower Travel ticks or set `speed` directly (m/s) |

## Ticks/camera to check

Launch tick, mid-flight, the arrival tick (`vfx_list_timeline` or the compile summary's `travel … m/s` line gives
the exact arrival tick), arrival +5, arrival +30 (impact tail). Check from the side (arc visible) and roughly
along the flight path (core seen nearly head-on) since the core/trail are velocity-aligned.

**Verified 2026-09-30**: built `recB-energy` via `vfx_new_document(component:"energy-bolt")`, compiled clean (12
particle systems, travel 8.14 m in 36 ticks = 13.6 m/s), rendered ticks 15/45/66 — tick 15 shows violet motes
gathering at Source; tick 45 shows a bright white core with a visible arced double trail (bright core trail + wider
violet sheath) mid-flight; tick 66 shows the impact: a bright flash/glow at Target with a fading beam-like trail
behind it and a violet pool light on the ground. The from-scratch graph above was extracted directly from the
shipped `energy-bolt` component's own node graph (`vfx_get_document`), the same graph that produced this render.
