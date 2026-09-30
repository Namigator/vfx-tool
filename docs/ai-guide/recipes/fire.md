# Fire

Torches, flame jets, flamethrowers, fireballs, campfires. See [look.md](../look.md) for the general rules this
recipe applies (additive vs normal, colour-over-life, size vs a 1.8 m character).

## What makes fire read right

- **Blend is not all-additive.** The flame **body** reads best as **normal blend** (opacity ~0.6), with only a
  thin **additive accent** layer on top (opacity 0.05, tint near-white) and a small **additive hot core**
  (opacity ~0.13). An all-additive flame blooms into orange fog before it looks like fire — see look.md's
  "Orange/white fog" row.
- **Colour cools as the particle ages**, it does not stay one colour: white → pale yellow `#FFE0A0` → orange
  `#FFA050` → deep orange-red `#C8501E` → dark `#5A1E0A`, alpha fading out at the very end. This is what gives a
  white root, orange body and dark red tips. Saturated red at full opacity anywhere but the very end reads as
  "flower petals", not fire.
- **Size vs a 1.8 m character**: a hand torch flame is ~0.3–0.5 m tall (`sizeMax` ~0.15–0.2, sprite fills half its
  cell so double the visible width you want); a flamethrower jet is ~2–4 m long; a fireball core ~1–1.5 m.
- **Motion**: aim with `Aim` = Target (not a fixed Direction) so the jet always points at what it's burning.
  `NoiseForce` (curl, amplitude 3, frequency 0.55) breaks the jet into tongues — without it a flame is a solid
  tube. `Drag` ~0.18 on the flame itself; **much stronger Drag (1.2–1.6) on anything born from a death event**
  (smoke, embers) because they inherit the jet's speed and will otherwise fly out of frame.
- **Gravity is reversed**: `[0, 0.9, 0]` on the flame tail and up to `[0, 1.6, 0]` on smoke — heat rises.
- **Timing phases**: ignition flash (2–11 ticks) → steady burn (continuous, `rate`+`window`) → decay (the tail:
  particles born near the window's end still live ~1–2 s after it closes; compile always warns if the document is
  too short — believe it and lengthen).
- **Smoke and embers are born where flame tongues die**, not from their own independent emitter: `ParticleEvents`
  reading the flame chain's `death` output, feeding a `Burst 1` emitter with `useEventPosition: true` and
  `inheritVelocity` 0.35–0.45.

## Fastest: start from a component

| Want | Component id | Key knobs to turn |
|---|---|---|
| Steady jet with turbulence + floor light, simplest rig | `flame-jet` | `ctl-flame-jet-reach` (speed), `ctl-flame-jet-size`, `ctl-flame-jet-density`, `ctl-flame-jet-spread` |
| Full directed jet: core + two tongue layers + embers + smoke | `fire-jet` | `ctl-fire-jet-reach`, `ctl-fire-jet-cone`, `ctl-fire-jet-smoke`, `ctl-fire-jet-embers` |
| Hand torch | `fire-torch` (fire-jet variant, narrower/shorter by default) | `ctl-fire-torch-reach` ~4, `ctl-fire-torch-size` ~0.13 |
| Wide burst / flame breath | `fire-burst` (35° cone variant) | `ctl-fire-burst-cone` ~0.61 rad, `ctl-fire-burst-embers` ~70 |
| Continuous flamethrower matched to the reference | `flamethrower` | `ctl-flamethrower-length` (speed), `ctl-flamethrower-width`, `ctl-flamethrower-density`, `ctl-flamethrower-burn` (window length) |
| Thrown fireball / explosion on arrival | `fireball` | `ctl-fireball-travel` (flight ticks), `ctl-fireball-core` (size), `ctl-fireball-impact` (spark burst count) |
| Campfire (continuous, no travel) | `fire-torch` or `fire-jet` with Source≈Target, or open `flame-jet` and stub `Aim` | shrink `reach`/`size`, raise `ctl-*-smoke` |

Recolour with the automatic **Colour** knob (degrees or `"#RRGGBB"`) — it keeps the hot-core→cool-tip shape;
use the **Flame colour** / **Embers colour** / **Smoke & dust colour** / **Light colour** part pickers for a
full recolour of one part only.

Example: `vfx_add_component { docId, component: "flamethrower", group: true }` then
`vfx_set_control { docId, control: "ctl-flamethrower-width", value: 0.18 }` for a narrower jet, and
`vfx_set_control { docId, control: "ctl-flamethrower-colour-main", value: "#4FA8FF" }` for blue fire.

**Verified 2026-09-30**: built `recA-fire-component` from `flamethrower`, rendered tick 60 — white-hot
root cooling through orange to dark red, billowing tail, embers visible, nozzle mesh and floor light; matches the
description exactly. [SAW]

## From scratch: two-layer flame jet + death-triggered smoke

Exact calls (a simplified two-layer version of the guide's full recipe — body + smoke only; add a hot core,
embers and a light the same way for the full look):

```
vfx_new_document { template: "blank", id: "my-fire" }

vfx_add_node { docId: "my-fire", type: "Schedule", id: "sched",
  params: { mode: "window", startTicks: 0, durationTicks: 140 } }
vfx_add_node { docId: "my-fire", type: "Emitter", id: "em",
  params: { shape: "cone", coneAngle: 0.105, radius: 0.02, rate: 210, burst: 0,
            speedMin: 6.6, speedMax: 9, lifetimeMin: 0.4, lifetimeMax: 0.75 } }
vfx_add_node { docId: "my-fire", type: "InitialProperties", id: "ip", params: { sizeMin: 0.22, sizeMax: 0.3 } }
vfx_add_node { docId: "my-fire", type: "Drag", id: "drag", params: { coefficient: 0.18 } }
vfx_add_node { docId: "my-fire", type: "NoiseForce", id: "noise", params: { amplitude: 3, frequency: 0.55 } }
vfx_add_node { docId: "my-fire", type: "Gravity", id: "grav", params: { acceleration: [0, 0.9, 0] } }
vfx_add_node { docId: "my-fire", type: "OverLife", id: "ol", params: {
  sizeOverLife: { domain: "normalized", interpolation: "linear",
                  keys: [{x:0,y:1},{x:0.7,y:3.7},{x:1,y:2.2}] },
  opacityOverLife: { domain: "normalized", interpolation: "linear",
                      keys: [{x:0,y:0},{x:0.07,y:1},{x:0.55,y:1},{x:1,y:0}] },
  colorOverLife: { stops: [
    {position:0,   color:{srgb:"#FFFFFF",alpha:1}},
    {position:0.15,color:{srgb:"#FFE0A0",alpha:1}},
    {position:0.45,color:{srgb:"#FFA050",alpha:1}},
    {position:0.75,color:{srgb:"#C8501E",alpha:1}},
    {position:1,   color:{srgb:"#5A1E0A",alpha:1}} ] } } }
vfx_add_node { docId: "my-fire", type: "Material", id: "mat", params: {
  template: "SpriteTextured", sprite: "flame-tongue-a", blend: "normal",
  opacity: 0.62, dissolve: 0.6, dissolveStart: 0.5 } }
vfx_add_node { docId: "my-fire", type: "BillboardRenderer", id: "bb",
  params: { alignment: "velocity", stretchRatio: 1.6, pivot: 0.38, flipbookMode: "overLife" } }
vfx_add_node { docId: "my-fire", type: "ParticleEvents", id: "pevents", params: { probability: 1, maxEvents: 64 } }

// smoke, born where the flame chain's particles die
vfx_add_node { docId: "my-fire", type: "Emitter", id: "smokeem", params: {
  shape: "point", burst: 1, rate: 0, useEventPosition: true, inheritVelocity: 0.4,
  speedMin: 0, speedMax: 0.3, lifetimeMin: 1, lifetimeMax: 1.9 } }
vfx_add_node { docId: "my-fire", type: "InitialProperties", id: "smokeip", params: { sizeMin: 0.35, sizeMax: 0.5 } }
vfx_add_node { docId: "my-fire", type: "Drag", id: "smokedrag", params: { coefficient: 1.4 } }
vfx_add_node { docId: "my-fire", type: "Gravity", id: "smokegrav", params: { acceleration: [0, 1.6, 0] } }
vfx_add_node { docId: "my-fire", type: "OverLife", id: "smokeol", params: {
  sizeOverLife: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:1},{x:1,y:2.6}] },
  opacityOverLife: { domain: "normalized", interpolation: "linear",
                      keys: [{x:0,y:0},{x:0.15,y:0.32},{x:1,y:0}] },
  colorOverLife: { stops: [ {position:0,color:{srgb:"#8A8078",alpha:1}},
                             {position:1,color:{srgb:"#6A625A",alpha:1}} ] } } }
vfx_add_node { docId: "my-fire", type: "Material", id: "smokemat",
  params: { template: "SpriteTextured", sprite: "smoke-puff", blend: "normal", opacity: 1 } }
vfx_add_node { docId: "my-fire", type: "BillboardRenderer", id: "smokebb", params: { flipbookMode: "overLife" } }

// wiring
vfx_connect { docId: "my-fire", from: "sched.window", to: "em.window" }
vfx_connect { docId: "my-fire", from: "node-source.out", to: "em.anchor" }
vfx_connect { docId: "my-fire", from: "node-target.out", to: "em.aim" }
vfx_connect { docId: "my-fire", from: "em.particles", to: "ip.particles" }
vfx_connect { docId: "my-fire", from: "ip.particles", to: "drag.particles" }
vfx_connect { docId: "my-fire", from: "drag.particles", to: "noise.particles" }
vfx_connect { docId: "my-fire", from: "noise.particles", to: "grav.particles" }
vfx_connect { docId: "my-fire", from: "grav.particles", to: "ol.particles" }
vfx_connect { docId: "my-fire", from: "ol.particles", to: "bb.particles" }
vfx_connect { docId: "my-fire", from: "mat.material", to: "bb.material" }
vfx_connect { docId: "my-fire", from: "bb.visual", to: "node-output.visual" }
vfx_connect { docId: "my-fire", from: "ol.particles", to: "pevents.particles" }   // fan-out from the same output, see note below
vfx_connect { docId: "my-fire", from: "pevents.death", to: "smokeem.trigger" }
vfx_connect { docId: "my-fire", from: "smokeem.particles", to: "smokeip.particles" }
vfx_connect { docId: "my-fire", from: "smokeip.particles", to: "smokedrag.particles" }
vfx_connect { docId: "my-fire", from: "smokedrag.particles", to: "smokegrav.particles" }
vfx_connect { docId: "my-fire", from: "smokegrav.particles", to: "smokeol.particles" }
vfx_connect { docId: "my-fire", from: "smokeol.particles", to: "smokebb.particles" }
vfx_connect { docId: "my-fire", from: "smokemat.material", to: "smokebb.material" }
vfx_connect { docId: "my-fire", from: "smokebb.visual", to: "node-output.visual" }

vfx_set_document { docId: "my-fire", durationTicks: 190 }   // compile warns the tail needs it
vfx_compile { docId: "my-fire" }
vfx_render_frames { docId: "my-fire", ticks: [15, 60, 130] }
```

Note: `ol.particles` connects to **both** `bb.particles` and `pevents.particles` — an output port can fan out to
several inputs even though the node reference table says "connections: one" for that port (that column describes
how many links an *input* accepts, not how many times an *output* can be wired out of; see `_gaps-A.md`).

**Verified 2026-09-30**: built `recA-fire-scratch`, compiled (warned the 120-tick window needed 190 to keep the
tail — lengthened), rendered ticks 15/60/130 — a bright white-hot root cooling to orange body with grey smoke
breaking off and drifting up where the flame dies; reads clearly as a flame jet even with only two layers. [SAW]

## Variants

| Variant | Change from the base jet |
|---|---|
| Torch (small, in-place) | `reach` ~4 m/s, `size` ~0.13, short `coneAngle`, Source≈Target so nothing travels |
| Flamethrower (long, continuous) | `reach`/`length` ~11 m/s, `width` ~0.3, `burn` (window) ~80+ ticks, two tongue layers |
| Wide burst / breath | `coneAngle` 0.5–0.7 rad, short window, strong `embers` |
| Fireball (projectile) | `PathFollower` along a `BezierPath`, glowing `core` + `flame` trail, burst of `sparkmat` sparks + `flash`/`PointLight` on `arrival` |
| Campfire (in place, long-lived) | `mode: "window"`, long `durationTicks`, low `speedMin/Max`, more `smoke`, no `Aim` needed |
| Blue / green fire | Component **Colour** knob or `hueShift` on every Material in the chain (keeps the light→dark shape) |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| Orange/white fog filling the frame | body layer is additive at opacity 1 | switch body to `blend: "normal"`, opacity ~0.6; keep only a thin additive accent |
| Flower petals | saturated red at full opacity through the particle's life | red only at the very end of `colorOverLife`, and faint |
| A smooth billowing blob / cloud instead of crisp licking tongues | one sprite sheet only, no edge breakup | what the included flamethrower does: **two** tongue layers (`sprite: "flame-tongue-a"` and `"flame-tongue-b"`, same emitter settings, rate 210 each); **dissolve** on the tongue Material (`dissolve: 0.6, dissolveStart: 0.5, dissolveSoftness: 0.12`: tongues burn away ragged in the second half of life); BillboardRenderer `alignment: "velocity", stretchRatio: 1.6, pivot: 0.38, flipbookMode: "overLife"`; tongue sizes 0.22–0.3 growing ×3.7 by 70 % of life; body `blend: "normal", opacity: 0.62`; a faint additive accent (opacity 0.05) and a hot core (opacity 0.13, stretch 1.9). Note: with `flipbookMode: "overLife"` every particle plays its flipbook once from birth to death, so `randomFrameStart` changes nothing visible; it matters only for looping flipbooks. |
| A solid orange tube, no flicker | no `NoiseForce`, constant size | add curl `NoiseForce` (amplitude ~3) and `sizeOverLife` growth |
| Smoke/embers shoot off-frame | event-born particles inherit the jet's speed, no Drag | add `Drag` 1.2–1.6 to anything wired from a `ParticleEvents.death` trigger |
| Nothing visible | `burst` nonzero with no trigger connected (compile error), or `window` not wired | continuous fire = `burst: 0` + `rate` + connected `window`; check with `vfx_sample_particles` |
| Flame doesn't follow the target | Emitter uses fixed `direction` instead of `Aim` | connect `node-target.out` (or a moving anchor) to `em.aim` |
| Tail cut off at the effect's end | `durationTicks` shorter than the last particle's life | lengthen by the amount `vfx_compile`'s warning states |

## Ticks / camera to check

Continuous jet: ignition (~10–15), steady middle, last 10 ticks, and 20–40 ticks after the window closes (the
tail — smoke and embers still fading). Render from the side and from behind the source (velocity-aligned sprites
look different end-on). Projectile (fireball): launch, mid-flight, arrival tick (`vfx_list_timeline`), arrival+5,
arrival+30. Check `background: "light"` too — faint additive accents can vanish on a light floor.
