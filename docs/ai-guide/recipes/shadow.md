# Shadow

Dark wisps pulled and swirled inward (never outward — shadow gathers), a near-black body, curling tendrils, a thin
violet edge accent, and a violet light. The darkest-reading family: it is built to nearly disappear against the
default dark preview background, which is correct but makes it the hardest family to judge from renders alone.

## What makes shadow read right

- **Blend: normal for every dark part** (body, wisps, tendrils, core — additive black adds nothing and simply
  doesn't render) **with a separate thin additive accent layer** (`accentmat`/`corerimmat`, opacity 0.14–0.25,
  emission 0.1–0.2, violet `#5E5288`–`#7A6AA8`) laid on top for the only part of the effect that should actually
  glow. Shadow is legible by its edge light and by occluding what's behind it, not by emitting light itself.
- **Everything pulls inward.** `Vortex { tangential, inward }` plus `Attract` on every particle stream — wisps, the
  implode burst, even the tendril tips are `OffsetAnchor`s around the Target that the geometry curls toward. A
  shadow effect that pushes particles outward reads as smoke or an explosion, not a void.
- **Colour is almost black, with the violet only in the rim/edge.** Body `#161823`/`#0E0F16`, wisps
  `#1E1D29`, core `#0E0F16` — these are *near-black*, not "dark purple." The identifying colour
  (`#7A6AA8`/`#9A4CFF`) lives only in the thin accent/rim/light layers. Push the body colour brighter and it stops
  reading as shadow.
- **`dissolve`/`dissolveStart`/`dissolveSoftness` on the wisp material** (e.g. 0.6 / 0.5 / 0.2) burns away each
  wisp's edges as it lives instead of a hard sprite-square cutoff — critical since dark sprites on a dark background
  show their square edges more than bright ones do.
- **Tendrils are curling `HelixPath`s from Target-relative `OffsetAnchor` tips back to Target**, not straight lines
  — each tip is placed at a small random offset around Target (`shadow-collapse` uses 5 tips arranged roughly in a
  ring, `radius` ≈1.2–1.3 m with alternating height), each with its own `phase` so they don't all curl in sync.
- **Size vs a 1.8 m character**: vortex/gather radius 0.7–2 m (roughly torso-to-full-body sized), core 1.2–2.2 m at
  its largest — shadow effects often read *larger* than the caster, a looming presence rather than a tight point.
- **Timing phases**: gather/active (continuous, wisps + body + tendrils swirling, ~138 ticks) → collapse (short,
  30 ticks: core shrinks to 0 via `sizeOverWindow` 1→0, an inward `implode` burst of fast-attracted particles) →
  brief residue (a few fading puffs drifting up, +30–168 ticks after collapse starts).

## Fastest: start from a component

| id | look | radius | swirl/pull | notes |
|---|---|---|---|---|
| `shadow-vortex` | wisps pulled/swirled into a violet void core, flickering light | 2 m | pull 9, swirl 7 | plays at Target; a standing void |
| `shadow-collapse` | full body + inward wisps + curling tendrils + violet edge + collapse + residue | 1.4 m | inward 1.8, swirl 2.5 | the richest of the four |
| `shadow-puff` | brief outward burst rapidly absorbed inward | 1.1 m | inward 1.8, swirl 2.5 | fast, punchy — a curse cast |
| `shadow-tendril` | narrow curling tendril Source→Target feeding a small vortex | 0.7 m | inward 1.8, swirl 2.5 | travels, good for a drain/leech spell |

```
vfx_new_document { template: "blank", id: "sh", component: "shadow-collapse" }
vfx_compile { docId: "sh" }
vfx_render_frames { docId: "sh", ticks: [60, 145, 200], background: "light" }   # check on a light floor — see note below
```

Common knob turns:

| Want | Knob | Example |
|---|---|---|
| Bigger/smaller void | `radius` (Vortex radius, m) | `2.5` for a large looming shadow |
| Faster/slower pull inward | `inward` (m/s²) | `4` for a violent drain |
| More/less swirl | `swirl` (m/s²) | `0` for a still, heavy shadow with no spin |
| Denser body | `density` (perSecond) | `24` for a thicker mass |
| More/less rim visibility | `edge` (Edge visibility, 0–1) | `0.4` for a brighter violet outline |
| Recolour (green rot-shadow, red curse) | `colour-main` | `{ srgb: "#5A1E2A", alpha: 1 }` |

## From scratch: inward-pulled wisps + a collapsing core

```
vfx_new_document { template: "blank", id: "shadow2" }
vfx_set_document { docId: "shadow2", durationTicks: 228 }

vfx_add_node { docId: "shadow2", type: "Schedule", id: "active", params: { startTicks: 0, durationTicks: 138, mode: "window" } }
vfx_add_node { docId: "shadow2", type: "Emitter", id: "wisps", params: { shape: "sphere", radius: 1.4, rate: 36, speedMin: 0, speedMax: 0.2, lifetimeMin: 0.8, lifetimeMax: 1.5 } }
vfx_connect { docId: "shadow2", from: "node-target.out", to: "wisps.anchor" }
vfx_connect { docId: "shadow2", from: "active.window", to: "wisps.window" }
vfx_add_node { docId: "shadow2", type: "InitialProperties", id: "wispip", params: { sizeMin: 0.3, sizeMax: 0.5, randomFrameStart: true } }
vfx_add_node { docId: "shadow2", type: "Drag", id: "wispdrag", params: { coefficient: 0.4 } }
vfx_add_node { docId: "shadow2", type: "Vortex", id: "swirl", params: { axis: [0,1,0], tangential: 2.5, inward: 1.8, falloff: 2 } }
vfx_connect { docId: "shadow2", from: "node-target.out", to: "swirl.anchor" }
vfx_add_node { docId: "shadow2", type: "Attract", id: "pull", params: { acceleration: 1.6, softRadius: 0.3, killRadius: 0.08 } }
vfx_connect { docId: "shadow2", from: "node-target.out", to: "pull.anchor" }
vfx_add_node { docId: "shadow2", type: "Material", id: "wispmat", params: { template: "SpriteTextured", sprite: "smoke-puff", blend: "normal", tint: { srgb: "#1E1D29", alpha: 1 }, opacity: 0.9, dissolve: 0.6, dissolveStart: 0.5, dissolveSoftness: 0.2 } }
vfx_add_node { docId: "shadow2", type: "BillboardRenderer", id: "wispbb", params: { alignment: "velocity", stretchRatio: 2.4, pivot: 0.4, flipbookMode: "overLife" } }
vfx_connect { docId: "shadow2", from: "wisps.particles", to: "wispip.particles" }
vfx_connect { docId: "shadow2", from: "wispip.particles", to: "wispdrag.particles" }
vfx_connect { docId: "shadow2", from: "wispdrag.particles", to: "swirl.particles" }
vfx_connect { docId: "shadow2", from: "swirl.particles", to: "pull.particles" }
vfx_connect { docId: "shadow2", from: "pull.particles", to: "wispbb.particles" }
vfx_connect { docId: "shadow2", from: "wispmat.material", to: "wispbb.material" }
vfx_connect { docId: "shadow2", from: "wispbb.visual", to: "node-output.visual" }

# Thin additive edge accent on the same pulled stream
vfx_add_node { docId: "shadow2", type: "Material", id: "accentmat", params: { template: "SpriteTextured", sprite: "smoke-puff", blend: "additive", tint: { srgb: "#6A5C94", alpha: 1 }, opacity: 0.18, emission: 0.2 } }
vfx_add_node { docId: "shadow2", type: "BillboardRenderer", id: "accentbb", params: { alignment: "velocity", stretchRatio: 2.4, pivot: 0.4, flipbookMode: "overLife" } }
vfx_connect { docId: "shadow2", from: "pull.particles", to: "accentbb.particles" }
vfx_connect { docId: "shadow2", from: "accentmat.material", to: "accentbb.material" }
vfx_connect { docId: "shadow2", from: "accentbb.visual", to: "node-output.visual" }

# Collapse: core shrinks to 0, then an inward implode burst
vfx_add_node { docId: "shadow2", type: "Schedule", id: "collapse", params: { startTicks: 138, durationTicks: 30, mode: "window" } }
vfx_add_node { docId: "shadow2", type: "Material", id: "coremat", params: { template: "SpriteTextured", sprite: "smoke-puff", blend: "normal", tint: { srgb: "#0E0F16", alpha: 1 }, opacity: 0.85 } }
vfx_add_node { docId: "shadow2", type: "SpriteRenderer", id: "core", params: { size: 1.2, sizeOverWindow: { domain: "normalized", interpolation: "linear", keys: [{x:0,y:1},{x:1,y:0}] } } }
vfx_connect { docId: "shadow2", from: "node-target.out", to: "core.anchor" }
vfx_connect { docId: "shadow2", from: "coremat.material", to: "core.material" }
vfx_connect { docId: "shadow2", from: "collapse.window", to: "core.window" }
vfx_connect { docId: "shadow2", from: "core.visual", to: "node-output.visual" }
vfx_compile { docId: "shadow2" }
vfx_render_frames { docId: "shadow2", ticks: [60, 140, 150], background: "light" }
```

## Variants

| Variant | Change | Example |
|---|---|---|
| Standing void (no collapse) | drop the collapse/residue phases, loop the gather | use `shadow-vortex` directly |
| Fast punchy curse | shorter active window, brief outward-then-inward burst | use `shadow-puff` |
| Drain/leech (travels) | Source→Target tendril feeding a small vortex at Target | use `shadow-tendril` |
| Coloured shadow (rot, blood curse) | recolour the accent/rim only, keep the body near-black | `colour-main` to a dark sickly or red hue |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| Invisible / nothing renders | additive blend on dark tint (adds ~0 light), or rendered only against the default dark background | switch dark parts to normal blend; check with `background: "light"` too — shadow is *meant* to read best against a lighter floor |
| Looks like ordinary grey smoke | no violet accent/rim layer, or body colour too light | keep body near-black (`#0E0F16`–`#1E1D29`); add a thin additive violet accent at low opacity |
| Particles fly outward | `Vortex`/`Attract` missing or `inward`/`acceleration` too small | make sure every particle stream routes through the inward pull, not just spin |
| Hard-edged sprite squares visible | no dissolve on the wisp material | add `dissolve`/`dissolveStart`/`dissolveSoftness` |
| Tendrils all curl identically | same `phase` on every `HelixPath` tip | give each tendril tip its own `phase` and a slightly different `OffsetAnchor` offset |
| Collapse looks like a pop, not a suck-in | core `sizeOverWindow` drops to 0 with no implode burst | add the fast `Attract`-driven implode particles at the same tick |

## Ticks/camera to check

Mid-gather (well into the active window), the collapse tick and a couple ticks after (core visibly shrinking), and
the residue tail. **Always render shadow with `background: "light"` at least once** — on the default dark background
a correctly-built shadow effect can measure under 1% "lit" and look like nothing happened; that is expected, not a
bug, but it means a dark-background-only check is not enough to judge it.

**Verified 2026-09-30**: built `recB-shadow` via `vfx_new_document(component:"shadow-collapse")`, compiled clean (6
particle systems), rendered ticks 60/145/200 on the default dark background — a visible but very dim violet-black
swirl (0.5–0.6% lit), confirming the family is intentionally faint there. Re-rendered tick 145 with
`background:"light"` — the same swirl reads clearly as a dark, curling mass against the light floor (97.5% lit,
89.1% bright, because the light background itself dominates the frame), confirming the light-background check in
look.md's readability rule is necessary for this family specifically and is now called out above.
