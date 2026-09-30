# Lightning

Charge at Source → a branching jagged bolt to Target, revealed in 1–2 ticks → sparks at both ends → impact glow,
ground light, ripple, flash and shake. The quality bar is `docs/references/original-lightning/lightning-arc.html`:
**thin bright core, fine zigzag (±0.3 m), hair-thin faint branches** — not a thick cartoon bolt.

## What makes lightning read right

- **Blend: additive, always.** Core, branches, sparks, ripple, impact glow — all additive. No normal-blend parts.
- **Four stacked ribbon passes on the same jagged geometry**, thin to wide, bright to faint: core (white, ~0.026 m,
  emission ~1), inner (pale blue, ×2.7 the core width, dim), outer (blue, ×7 the core width, very dim, 0 emission),
  halo (deep blue, ×16.5 the core width, almost transparent). **The colour lives in the wide faint outer/halo passes,
  the core stays near white** — this is what separates "electric" from "a blue line."
- **Zigzag amplitude, not width, sells "lightning."** JaggedPath `amplitude` is the half-offset of each zigzag point
  (the original reference's `rough` param is the full offset, so `amplitude = rough/2`). `0.3` m matches the
  reference; the whole-bolt "Jaggedness" knob on every lightning component defaults to `0.3` — turning it past
  ~1 makes the bolt look like a drawn scribble, not electricity. Branches and forks re-zigzag at smaller amplitude
  (0.08–0.18) so they read as offshoots, not equal bolts.
  - **Re-roll, don't hold still**: `JaggedPath.regenerationHz` (≈20–24) redraws the zigzag several times over the
    bolt's life so it flickers instead of looking like a frozen static line.
- **Reveal the bolt fast, not instantly.** `RevealPath` driven by an `EffectTimeCurve` from 0→1 over ~2 ticks (not
  0 ticks) — the strike still reads as a near-instant flash but doesn't pop like a single frame swap.
- **A decay envelope, not a flat window.** `exp(-3·t) · (0.72 + 0.28·sin²(96·t))` (built from `Time` → `ScalarMath`
  multiply/exp + an `Oscillator`) drives every pass's opacity: the bolt flashes bright, decays exponentially, and
  flickers on top. A flat opacity looks like a static neon sign, not a strike.
- **Branches attach along the trunk, not just at the ends.** `BranchPath.attachmentMin/Max` ≈ 0.12–0.88 (not 0–1;
  keeps branches off the very ends), with branch length, opacity and width all *random ranges* — uniform branches
  read as a fence, not a fracture pattern.
- **Size vs a 1.8 m character**: a strike from a 4–6 m Source→Target spans most of the frame; ripple radius 4–7.5 m
  (bigger than the character); impact core/halo sprites 0.35 m / 1.4–3 m, small relative to the bolt.
  The core ribbon width itself is a few centimetres — lightning is a *thin, bright* line, never a thick tube.
- **Timing phases**: charge 24–33 ticks (motes pulled to Source on jagged tethers, core/halo growing) → discharge
  2-tick reveal → active window 26–45 ticks (bolt visible, decaying/flickering) → impact burst + ripple (36–96
  ticks) → sparks fall/bounce at both ends the whole time. A screen flash (alpha ~0.13, 4 ticks) and a subtle camera
  shake (translation 0.03) sell the strike without overpowering it.

## Fastest: start from a component

Three lightning components share one graph shape (80 nodes) and differ only in values:

| id | look | core width | branches | jagged | impact sparks | source sparks | ripple |
|---|---|---|---|---|---|---|---|
| `lightning-strike` | the default strike | 0.026 m | 14 | 0.3 | 70 | 45 | 5.6 m |
| `lightning-thin-fork` | half-width core, many fine branches, short tail | 0.013 m | 14 | 0.3 | 35 | 25 | 4 m |
| `lightning-heavy-strike` | thick core, few strong branches, wider impact | 0.0416 m | 8 | 0.3 | 100 | 60 | 7.5 m |

Plus two smaller pieces: `arc-beam` (a re-rolling jagged arc + glow ribbon Source→Target, no branches/impact — good
for a sustained "tesla coil" beam) and `charge-tethers` (motes pulled to Source with jagged tethers — the charge-up
half of a strike, usable alone as an "electric aura" loop).

**Charge-up for a from-scratch bolt:** you don't have to build it by hand. Add the charge half as a component in
front of your own discharge: `vfx_add_component { docId, component: "charge-tethers", group: true }`, keep its
Start at 0, and start your strike Schedule (`startTicks`) at about 24 ticks, when the tethers peak. Check
tick ~12 (motes gathering) as well as the discharge ticks.

```
vfx_new_document { template: "blank", id: "bolt", component: "lightning-strike" }
vfx_compile { docId: "bolt" }
vfx_render_frames { docId: "bolt", ticks: [22, 27, 40] }   # charge / discharge / impact
```

Common knob turns (control ids keep the component's prefix, e.g. `ctl-lightning-strike-core`):

| Want | Knob | Example |
|---|---|---|
| Thicker/thinner bolt | `core` (Core width, m) | `0.06` for a heavy strike, `0.012` for a thread |
| More/fewer side branches | `branches` (integer) | `20` for a fractal look, `4` for a clean strike |
| Rougher/smoother zigzag | `jagged` (m) | keep ≤ 0.5; above ~1 it scribbles |
| Recolour (purple, green magic bolt) | `colour-shift` (Colour, degrees or hex) | `vfx_set_control { control: "colour-shift", value: "#B04CFF" }` |
| Bigger/smaller ground ring | `ripple` (m) | `12` for a large strike |
| Delay on the timeline | `start-at` (Start at, tick) | so it lands after a cast animation |

## From scratch: LinePath → JaggedPath → BranchPath → RibbonRenderer

This is the exact graph `tools/make-lightning-recipe.mjs` builds (the generator for the shipped `lightning-strike`
family) — a trunk `BezierPath`, jagged, branched, revealed, and rendered as four stacked ribbon passes. A straight
`LinePath` works the same way if you don't need the slight upward bow.

```
vfx_new_document { template: "blank", id: "bolt2" }
vfx_set_document { docId: "bolt2", durationTicks: 144, seed: 2 }
vfx_set_anchor { docId: "bolt2", anchorId: "source", position: [-5.1, 1.65, 0] }
vfx_set_anchor { docId: "bolt2", anchorId: "target", position: [4.5, 0.1, 0] }

# Trunk: a slightly bowed path, then jagged, then branched, then re-jagged, then revealed
vfx_add_node { docId: "bolt2", type: "BezierPath", id: "base", params: { startHandle: [2.4, 0.56, 0], endHandle: [-2.4, 0.56, 0], samples: 48 } }
vfx_connect { docId: "bolt2", from: "node-source.out", to: "base.start" }
vfx_connect { docId: "bolt2", from: "node-target.out", to: "base.end" }
vfx_add_node { docId: "bolt2", type: "JaggedPath", id: "trunk", params: { amplitude: 0.3, regenerationHz: 24, samples: 42 } }
vfx_connect { docId: "bolt2", from: "base.paths", to: "trunk.paths" }
vfx_add_node { docId: "bolt2", type: "BranchPath", id: "branches", params: { count: 14, attachmentMin: 0.12, attachmentMax: 0.88, lengthMin: 0.4, lengthMax: 1.8, opacityMin: 0.2, opacityMax: 0.48, widthMin: 0.2, widthMax: 0.4 } }
vfx_connect { docId: "bolt2", from: "trunk.paths", to: "branches.paths" }
vfx_add_node { docId: "bolt2", type: "JaggedPath", id: "branchjag", params: { amplitude: 0.14, regenerationHz: 24, samples: 14 } }
vfx_connect { docId: "bolt2", from: "branches.branches", to: "branchjag.paths" }
vfx_add_node { docId: "bolt2", type: "MergePaths", id: "boltpaths" }
vfx_connect { docId: "bolt2", from: "trunk.paths", to: "boltpaths.paths" }
vfx_connect { docId: "bolt2", from: "branchjag.paths", to: "boltpaths.paths" }
vfx_add_node { docId: "bolt2", type: "RevealPath", id: "reveal" }
vfx_add_node { docId: "bolt2", type: "EffectTimeCurve", id: "revealcurve", params: { curve: { domain: "effectSeconds", interpolation: "linear", keys: [{x:0.4,y:0},{x:0.4334,y:1}] } } }
vfx_connect { docId: "bolt2", from: "boltpaths.paths", to: "reveal.paths" }
vfx_connect { docId: "bolt2", from: "revealcurve.value", to: "reveal.fraction" }

# Window + four stacked passes (core is by far the thinnest and brightest; colour lives in outer/halo)
vfx_add_node { docId: "bolt2", type: "Schedule", id: "strike", params: { startTicks: 24, durationTicks: 39, mode: "window" } }
vfx_add_node { docId: "bolt2", type: "Material", id: "coremat", params: { blend: "additive", tint: { srgb: "#FFFFFF", alpha: 1 }, emission: 0.5 } }
vfx_add_node { docId: "bolt2", type: "RibbonRenderer", id: "corerib", params: { width: 0.026, endFade: 0.04 } }
vfx_connect { docId: "bolt2", from: "reveal.paths", to: "corerib.paths" }
vfx_connect { docId: "bolt2", from: "coremat.material", to: "corerib.material" }
vfx_connect { docId: "bolt2", from: "strike.window", to: "corerib.window" }
vfx_connect { docId: "bolt2", from: "corerib.visual", to: "node-output.visual" }
vfx_add_node { docId: "bolt2", type: "Material", id: "outermat", params: { blend: "additive", tint: { srgb: "#2F7BFF", alpha: 1 }, opacity: 0.17 } }
vfx_add_node { docId: "bolt2", type: "RibbonRenderer", id: "outerrib", params: { width: 0.185, endFade: 0.04 } }
vfx_connect { docId: "bolt2", from: "reveal.paths", to: "outerrib.paths" }
vfx_connect { docId: "bolt2", from: "outermat.material", to: "outerrib.material" }
vfx_connect { docId: "bolt2", from: "strike.window", to: "outerrib.window" }
vfx_connect { docId: "bolt2", from: "outerrib.visual", to: "node-output.visual" }
vfx_compile { docId: "bolt2" }
vfx_render_frames { docId: "bolt2", ticks: [25, 30, 60] }
```

(Add `inner` at width ×2.7 the core and `halo` at ×16.5 for the full four-pass look; drive each pass's `Material.opacity`
from the decay envelope below instead of a flat value, or the flash reads like a static neon tube.)

**Decay envelope** `exp(-3t) · flicker` (t = seconds since the strike window opened). Exact calls, as used by the
included lightning components. The `unit` / `inputUnit` values matter: every link must carry the same unit, and
`Material.opacity` wants `normalized`, so the last node converts (`unit: "normalized"`). Missing them gives
`TYPE_MISMATCH … Unit none of "value" does not match unit normalized …`.

```
vfx_add_node { docId: "bolt2", type: "Time", id: "clock" }
vfx_connect  { docId: "bolt2", from: "strike.window", to: "clock.window" }
vfx_add_node { docId: "bolt2", type: "ScalarMath", id: "decay",    params: { operation: "multiply", b: -3, inputUnit: "second", unit: "none" } }
vfx_add_node { docId: "bolt2", type: "ScalarMath", id: "expo",     params: { operation: "exp", unit: "none" } }
vfx_add_node { docId: "bolt2", type: "Oscillator", id: "flicker",  params: { waveform: "sine", frequency: 30.56, min: 0.72, max: 1, unit: "none" } }
vfx_add_node { docId: "bolt2", type: "ScalarMath", id: "envelope", params: { operation: "multiply", inputUnit: "none", unit: "none" } }
vfx_connect  { docId: "bolt2", from: "clock.localSeconds", to: "decay.a" }
vfx_connect  { docId: "bolt2", from: "decay.value",   to: "expo.a" }
vfx_connect  { docId: "bolt2", from: "expo.value",    to: "envelope.a" }
vfx_connect  { docId: "bolt2", from: "flicker.value", to: "envelope.b" }
# one per pass: scale the envelope by the pass's base opacity and convert to normalized
vfx_add_node { docId: "bolt2", type: "ScalarMath", id: "corelevel", params: { operation: "multiply", b: 1, inputUnit: "none", unit: "normalized" } }
vfx_connect  { docId: "bolt2", from: "envelope.value",  to: "corelevel.a" }
vfx_connect  { docId: "bolt2", from: "corelevel.value", to: "coremat.opacity" }
```

Base opacities per pass: core 1, inner 0.65, outer 0.17, halo 0.07. Use `-5` instead of `-3` in `decay` for a
faster, thinner strike, `-2.5` for a heavy one.

(
Add sparks with `Emitter` (burst, `shape: "sphere"`/`"cone"`, `speedMin/Max` a few m/s) → `Gravity` → `GroundCollision
{ mode: "bounce" }` → `BillboardRenderer { alignment: "velocity", stretchRatio: 2 }`, triggered off `strike.start` /
an `impact` Schedule's `.start`.)

## Variants

| Variant | Change | Example values |
|---|---|---|
| Thin fork | half core width, many fine branches, fewer/shorter sparks | core 0.013, branches 14, impact sparks 35 |
| Heavy strike | thick core, few strong branches, wider ring, slower charge | core 0.0416, branches 8, ripple 7.5 |
| Colour magic (purple/green bolt) | turn the Colour knob | `colour-shift` toward `#B04CFF` or a hue in degrees |
| Sustained beam (no impact) | use `arc-beam` instead of a strike | re-rolling jagged arc, no branches/impact/sparks |
| Electric aura at Source only | use `charge-tethers` alone | motes + jagged tethers, no discharge |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| A thick blue tube | core ribbon too wide, or only one pass | keep core ≈ 0.02–0.05 m; use all four passes (core/inner/outer/halo) |
| A drawn scribble, not a spark | `JaggedPath.amplitude` too high (>1) | drop to 0.2–0.4; the full jag = 2×`amplitude` |
| Looks frozen / like neon signage | flat opacity, no decay envelope, `regenerationHz` too low | drive opacity from the exp-decay + flicker chain; `regenerationHz` ≥ 15 |
| Branches look like a second bolt, not offshoots | branch width/opacity too close to the trunk's | branch opacity 0.15–0.5 of core, width smaller, randomised ranges |
| Bolt pops into existence in one frame | `RevealPath` fraction jumps 0→1 in a single tick | spread the `EffectTimeCurve` over ~2 ticks |
| Nothing visible at the impact tick | `Schedule.trigger` for impact/sparks not wired to the reveal-complete tick | trigger the impact Schedule from the discharge Schedule's `.start`, offset by the reveal duration (+2 ticks) |
| Dim / doesn't read on a light floor | additive halo passes have little contrast against a bright background | check with `background: "light"`; the bright white core still reads, the halo won't — that's expected for additive lightning |

## Ticks/camera to check

Render the charge tick (just before discharge), the discharge tick (+1–3 after `strike.startTicks`), and the impact
+ decay tail (+10–40 after impact). Side view is standard; check from behind the Source and in front of the Target
too since sparks are velocity-aligned. `vfx_list_timeline` gives the exact charge/strike/impact tick boundaries for
a given Start-at.

**Verified 2026-09-30**: built `recB-lightning` via `vfx_new_document(component:"lightning-strike")`, compiled clean
(7 particle systems, 8 ribbon layers, portability notes only), rendered ticks 22/27/40 — tick 22 shows only the blue
charge glow at Source (correct, bolt hasn't struck yet); tick 27 shows a thin bright white-core bolt with a fine
zigzag and faint side branches matching the original-lightning quality bar; tick 40 shows the bolt faded, an impact
ring and scattered falling/bouncing sparks at the target. The from-scratch graph above is transcribed from
`tools/make-lightning-recipe.mjs`, the actual generator for this shipped component (same graph, same verified render).
