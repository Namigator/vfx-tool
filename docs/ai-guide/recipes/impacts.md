# Impacts

The generic "something landed here" finisher: a flash, an outward spark burst (often with gravity and a ground
bounce), and a ground shockwave ring, optionally with a delayed second aftershock. Every travelling family
(lightning, energy, fire) has its own baked-in impact; this family is for attaching a impact to *anything* —
melee hits, arrows, generic "on hit" VFX — or as the `startOn` target of a projectile you built yourself.

## What makes an impact read right

- **Additive for the flash/sparks/ring, normal (or none) for dust** — same rule as every other bright-accent family.
- **The flash is one `SpriteRenderer` with a colour gradient over its window**, not a flat-tint circle: white
  (`#FFFFFF`) → orange (`#FFB060`) → red (`#FF3010`) via `colorOverWindow`, `sizeOverWindow` overshoots past 1
  (0.2→1→1.4) so it visibly punches outward instead of just fading in place, and a touch of `spin` (1.5) keeps it
  from looking like a static decal. `opacityOverWindow` 1→0 over the whole window (flash alone covers ~30 ticks,
  well past its own bright peak, so its "tail" contributes fading orange light into the sparks/ring below it).
- **Sparks are a single burst** (`Emitter { burst: 80, rate: 0 }`, not a rate) **with real `Gravity`** so they arc
  and fall instead of flying in straight lines forever, `alignment: "velocity"` + `stretchRatio` 4–5 for streaking,
  and — for anything that should scatter across the floor rather than just fall once — `GroundCollision` (`mode:
  "bounce"` to skitter, `mode: "kill"` to vanish cleanly on contact; `spark-aftershock` uses `kill` and instead
  spawns a **dust puff wherever a spark lands** by wiring `GroundCollision.collision` → a small burst `Emitter` with
  `useEventPosition: true, inheritVelocity: 0.4`).
- **The shockwave ring is a flat `SpriteRenderer`, not a path ribbon**, for a cheap single-hit ring: `alignment:
  "worldAxis"` on a floor-dropped `OffsetAnchor`, `sizeOverWindow` growing fast (0.2→5) while `opacityOverWindow`
  fades (1→0) — it's one sprite scaling up and fading, not simulated geometry, so it's essentially free.
- **`ScreenFlash` + `CameraImpulse` sell weight without extra geometry**: a very short (4–8 tick) white/warm screen
  flash at low alpha (0.13–0.15) and a brief camera shake (translation 0.03–0.05, rotation 0.006–0.01), both
  triggered off the same `.start` event as everything else. Skip or reduce these for small/frequent impacts (arrow
  hits) — constant screen shake on every hit is fatiguing.
- **Size vs a 1.8 m character**: flash 2.2–3 m (bigger than the character — an impact should feel like it displaces
  air), shockwave grows to ~5× its start size, spark burst radius small (0.05–0.08 m start) but speeds 2–6 m/s so
  they cover real distance.
- **Timing**: everything triggers off one `Schedule { mode: "window" }`'s `.start` event, offset a few ticks into
  the document (10 ticks in the shipped components) so there's a visible pre-roll if you're previewing the impact
  alone; flash window ~30 ticks (visually done well before that — opacity hits 0 by the end), sparks live 0.4–0.9 s.
  For a two-part hit, delay a second identical burst via `EventDelay` (10–20 ticks) and combine both triggers with
  `MergeEvents` so either the original hit or the delayed one can fire the same spark emitter.

## Fastest: start from a component

| id | look | flash | sparks | notes |
|---|---|---|---|---|
| `impact-flash` | flash + spark burst + ground shockwave ring, screen flash + shake | 2.2 m | 80, speed 6 m/s | the standard generic impact |
| `spark-aftershock` | spark burst + a delayed second burst; landed sparks kick up dust | — | 40 (×1.5 via ScalarMath), speed 4 m/s | no flash/ring — layer it on top of another impact |

```
vfx_new_document { template: "blank", id: "hit", component: "impact-flash" }
vfx_compile { docId: "hit" }
vfx_render_frames { docId: "hit", ticks: [11, 14, 30] }   # just after trigger / flash peak / sparks falling
```

Common knob turns:

| Want | Knob | Example |
|---|---|---|
| Bigger/smaller flash | `flash` (Flash size, m) | `4` for a heavy hit |
| More/fewer sparks | `sparks` (integer) | `200` for a shower |
| Faster/slower sparks | `speed` (m/s) | `12` for a violent hit |
| Recolour (ice shatter, poison splash) | `colour-main` / `colour-sparks` | `{ srgb: "#8FE0FF", alpha: 1 }` |
| Delay of an aftershock | `delay` (Aftershock delay, tick) — `spark-aftershock` only | `20` for a longer-telegraphed second hit |

## From scratch: burst → Gravity → GroundCollision → BillboardRenderer, plus a shockwave ring

This is the exact wiring used by the shipped `impact-flash` (confirmed via `vfx_get_document`):

```
vfx_new_document { template: "blank", id: "impact2" }
vfx_set_document { docId: "impact2", durationTicks: 90 }

vfx_add_node { docId: "impact2", type: "Schedule", id: "hit", params: { startTicks: 10, durationTicks: 30, mode: "window" } }

# Flash: white -> orange -> red over its window, punching outward
vfx_add_node { docId: "impact2", type: "Material", id: "glowmat", params: { template: "SpriteTextured", sprite: "soft-glow", blend: "additive", emission: 1 } }
vfx_add_node { docId: "impact2", type: "SpriteRenderer", id: "flash", params: { size: 2.2, spin: 1.5, sizeOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0.2},{x:0.15,y:1},{x:1,y:1.4}] }, opacityOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:1},{x:1,y:0}] }, colorOverWindow: { stops: [{position:0,color:{srgb:"#FFFFFF",alpha:1}},{position:0.4,color:{srgb:"#FFB060",alpha:1}},{position:1,color:{srgb:"#FF3010",alpha:1}}] } } }
vfx_connect { docId: "impact2", from: "node-target.out", to: "flash.anchor" }
vfx_connect { docId: "impact2", from: "glowmat.material", to: "flash.material" }
vfx_connect { docId: "impact2", from: "hit.window", to: "flash.window" }
vfx_connect { docId: "impact2", from: "flash.visual", to: "node-output.visual" }

# Sparks: a single burst, gravity, velocity-stretched
vfx_add_node { docId: "impact2", type: "Emitter", id: "sparks", params: { shape: "sphere", radius: 0.05, burst: 80, rate: 0, speedMin: 2, speedMax: 6, lifetimeMin: 0.4, lifetimeMax: 0.9 } }
vfx_connect { docId: "impact2", from: "node-target.out", to: "sparks.anchor" }
vfx_connect { docId: "impact2", from: "hit.start", to: "sparks.trigger" }
vfx_add_node { docId: "impact2", type: "InitialProperties", id: "ip", params: { sizeMin: 0.02, sizeMax: 0.04 } }
vfx_add_node { docId: "impact2", type: "Gravity", id: "grav" }
vfx_add_node { docId: "impact2", type: "Material", id: "sparkmat", params: { template: "SpriteTextured", sprite: "spark-streak", blend: "additive", tint: { srgb: "#FFD080", alpha: 1 } } }
vfx_add_node { docId: "impact2", type: "BillboardRenderer", id: "bb", params: { alignment: "velocity", stretchRatio: 5, pivot: 0.8 } }
vfx_connect { docId: "impact2", from: "sparks.particles", to: "ip.particles" }
vfx_connect { docId: "impact2", from: "ip.particles", to: "grav.particles" }
vfx_connect { docId: "impact2", from: "grav.particles", to: "bb.particles" }
vfx_connect { docId: "impact2", from: "sparkmat.material", to: "bb.material" }
vfx_connect { docId: "impact2", from: "bb.visual", to: "node-output.visual" }

# Shockwave: one flat sprite scaling up and fading on the floor
vfx_add_node { docId: "impact2", type: "OffsetAnchor", id: "ground", params: { offset: [0, 0.02, 0], dropToGround: true } }
vfx_connect { docId: "impact2", from: "node-target.out", to: "ground.anchor" }
vfx_add_node { docId: "impact2", type: "Material", id: "ringmat", params: { template: "SpriteTextured", sprite: "ripple-ring", blend: "additive", tint: { srgb: "#FFB060", alpha: 1 }, emission: 0.5 } }
vfx_add_node { docId: "impact2", type: "SpriteRenderer", id: "shockwave", params: { size: 1, alignment: "worldAxis", sizeOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:0.2},{x:1,y:5}] }, opacityOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:1},{x:1,y:0}] } } }
vfx_connect { docId: "impact2", from: "ground.out", to: "shockwave.anchor" }
vfx_connect { docId: "impact2", from: "ringmat.material", to: "shockwave.material" }
vfx_connect { docId: "impact2", from: "hit.window", to: "shockwave.window" }
vfx_connect { docId: "impact2", from: "shockwave.visual", to: "node-output.visual" }

# Sell it: short screen flash + subtle camera shake, same trigger
vfx_add_node { docId: "impact2", type: "ScreenFlash", id: "screenflash", params: { color: { srgb: "#FFE2B0", alpha: 1 }, alpha: 0.15, durationTicks: 4 } }
vfx_add_node { docId: "impact2", type: "CameraImpulse", id: "shake", params: { durationTicks: 8 } }
vfx_connect { docId: "impact2", from: "hit.start", to: "screenflash.trigger" }
vfx_connect { docId: "impact2", from: "hit.start", to: "shake.trigger" }
vfx_connect { docId: "impact2", from: "screenflash.presentation", to: "node-output.presentation" }
vfx_connect { docId: "impact2", from: "shake.presentation", to: "node-output.presentation" }
vfx_compile { docId: "impact2" }
vfx_render_frames { docId: "impact2", ticks: [11, 14, 30] }
```

To chain a projectile's arrival straight into an impact built this way instead of playing it on its own timer: wire
`PathFollower.arrival` to `hit.trigger` (a `once`-mode Schedule) instead of using `startTicks` — see
[energy-projectiles.md](energy-projectiles.md) for the full arrival pattern — or, with a whole impact component, use
`vfx_add_component { startOn: "<projectileNodeId>.arrival" }` to wire it automatically.

## Variants

| Variant | Change | Example |
|---|---|---|
| Aftershock | a delayed second burst via `EventDelay`+`MergeEvents`, landed sparks kick up dust via `GroundCollision.collision` | use `spark-aftershock`, or layer it onto `impact-flash` |
| Elemental recolour (ice shatter, poison splash, holy smite) | recolour flash/sparks/ring together | `colour-main`/`colour-sparks`/`colour-flash` |
| Small/frequent hits (arrows, bullets) | smaller flash, fewer sparks, drop the screen flash/shake | flash ≈1 m, sparks ≈20, disable `ScreenFlash`/`CameraImpulse` |
| Heavy hit (boss slam) | bigger flash/ring, `GroundCollision(bounce)` so sparks skitter, stronger shake | flash 4+ m, ring scale to 8×, shake translation 0.08 |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| A flat coloured circle, not a flash | no `colorOverWindow`/`sizeOverWindow` overshoot | white→colour gradient, size punch past 1 then settle |
| Sparks fly in perfectly straight lines forever | no `Gravity` | add `Gravity { acceleration: [0,-9.81,0] }` (or lighter for a "floaty" magic hit) |
| Sparks visibly clip through the floor | no `GroundCollision` | add `GroundCollision { mode: "bounce" }` or `"kill"` |
| Ring looks like a flat painted decal, no punch | `sizeOverWindow` too flat, no fast early growth | grow fast early (0.2→most-of-final-size by ~20% of the window) |
| Screen shake every single hit is annoying | `CameraImpulse` used on frequent small impacts | drop it for small hits; reserve for heavy/boss impacts |
| Second burst (aftershock) looks identical to the first | same burst count / speed reused unscaled | scale it down (`spark-aftershock` uses `count × 1.5` for the *first*, defaulting the delayed one implicitly smaller via fewer sparks by then) — tune independently |

## Ticks/camera to check

Trigger tick, +2 (flash near peak), +8 (sparks airborne), +30 (sparks landed/faded, ring gone). For a
projectile-driven impact, always check the arrival tick reported by `vfx_list_timeline`/the compile summary rather
than guessing — if Travel ticks or Speed changes later, a fixed tick goes stale but `arrival`-driven timing doesn't.

**Verified 2026-09-30**: built `recB-impact` via `vfx_new_document(component:"impact-flash")`, compiled clean (3
particle systems, screen flash ticks 10-14, camera shake ticks 10-18), rendered ticks 11/14/30 — tick 11 shows the
flash just beginning to bloom; tick 14 shows the flash near peak brightness with the ground ring starting to expand;
tick 30 shows the flash gone, an expanded orange ring on the floor and sparks still falling/scattering outward. The
from-scratch graph above was extracted directly from the shipped `impact-flash` component's own node graph
(`vfx_get_document`), the same graph that produced this render; `spark-aftershock`'s `EventDelay`/`MergeEvents`/
`GroundCollision.collision`→dust wiring was inspected the same way but not independently re-rendered — see
`_gaps-B.md`.
