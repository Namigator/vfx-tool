# Wind

Broken ribbons spiralling along a helix Source→Target (or around a short axis), plus fast velocity-stretched streaks
and faint drifting wisps, on an attack/hold/fall envelope. Also covers tornado/vortex-shaped wind.

## What makes wind read right

- **Blend: normal for the ribbons and wisps** (they're moving air/dust, not light) **with a little emission** (0.1–
  0.25) for a faint self-lit edge — not full additive, or a dense gust floods white. Streaks (the fast individual
  air lines) can run closer to additive-feeling with `opacity` ~0.75, `emission` ~0.1.
  Teal/cyan-grey (`#5A948F`–`#9CC4C0`) is the default "air" palette; desaturate further for a plain gust, saturate
  for a magical wind spell.
- **Several `HelixPath` ribbons at once, not one.** The shipped gusts use 3–5 helices around the same Source→Target
  axis, each with a different `phase` (spread evenly, e.g. 0, 1.94, 3.88, 5.82 rad for 4 strands — roughly
  `2π/n · index`), slightly different `radius` (0.44–0.55 m) and alternating `spin` (3.2/4) so the strands visibly
  cross and braid rather than tracing the same line. Each strand gets its own `Material`/`RibbonRenderer` with a
  **`uvScroll`** (e.g. `[-2.5, 0]` to `[-3.6, 0]`, increasingly negative per strand) so the texture visibly flows
  along the ribbon — a static ribbon reads as a rigid shape, not moving air. `uvDistort` ≈ 0.06 adds a subtle ripple.
- **An envelope curve, not a flat window.** `EffectTimeCurve` shaped attack→hold→fall (e.g. 0→0.4 over 0.3 s, up to
  1 at 0.5 s, hold near 1, fall to 0 by ~2.3 s) multiplies into each ribbon's opacity (`ribfade` nodes) and the
  `Vortex.strength` — a gust that snaps to full strength and stops abruptly looks like a glitch, not wind.
- **Fast streaks sell speed; wisps sell volume.** Streaks: `Emitter(shape:"cone", coneAngle" small, direction along
  the gust)`, high speed (6–9 m/s), short lifetime (0.3–0.6 s), heavily velocity-stretched
  (`alignment:"velocity"`, `stretchRatio` 6). Wisps: slower (2–3.5 m/s), longer-lived (0.9–1.5 s), bigger
  (0.35–0.6 m), low opacity (~0.2), randomised rotation/spin, run through a `Vortex` for a lazy curl.
- **`Vortex` node is the wind "force"**: `tangential` spins particles around the gust axis, `inward` pulls them
  toward it — for a tornado use a *vertical* axis with a big `inward`/`tangential` and add upward `Gravity`
  (negative acceleration, i.e. lift) so dust rises while swirling.
- **Size vs a 1.8 m character**: gust width (helix radius) 0.16–0.76 m — narrower than the character for a "cutting"
  gust, wider for a broad blast; a tornado's base radius starts ~0.5 m and its funnel is several metres tall.
- **Timing**: a gust has no separate "impact" — it's the whole envelope (attack ~0.3–0.5 s, hold, fall by ~2–2.3 s).
  A tornado/vortex is closer to continuous (window ~6 s) for a standing hazard.

## Fastest: start from a component

| id | look | width | twist | streaks | wisps |
|---|---|---|---|---|---|
| `wind-gust` | broken spiral gust Source→Target, 4 strands | 0.44 m | 1.5 turns | 45/s | 10/s |
| `wind-cut` | straight, low-twist, long thin streaks — a cutting gust | 0.16 m | 0.35 turns | 80/s | 5/s |
| `wind-whirl` | wide whirling burst around a short axis at Source, 5 strands | 0.76 m | 3 turns | 25/s | 16/s |
| `tornado` | rising dust funnel pulled to a vertical axis (Vortex + lift) | base 0.5 m | spin 9, pull 12 | (dust rate 260/s) | — |

```
vfx_new_document { template: "blank", id: "gust", component: "wind-gust" }
vfx_compile { docId: "gust" }
vfx_render_frames { docId: "gust", ticks: [30, 90, 150] }   # rising / peak / fading
```

Common knob turns:

| Want | Knob | Example |
|---|---|---|
| Wider/narrower gust | `width` (Gust width, m) | `1.2` for a broad blast |
| More/less spiral | `twist` (Turns) | `0` for a nearly straight gust |
| Denser/sparser streaks | `streaks` (perSecond) | `120` for a violent gust |
| Faster travel | `speed` (Travel speed, m/s) | `20` for a fast slash |
| Recolour (e.g. green poison wind, white blizzard) | `colour-main` | `{ srgb: "#E8F4FF", alpha: 1 }` |
| Tornado strength | `spin` / `pull` (m/s²) | raise both together, keep `pull` ≥ `spin` so it gathers instead of flinging out |

## From scratch: a small gust (HelixPath → RibbonRenderer + Vortex wisps)

```
vfx_new_document { template: "blank", id: "wind2" }
vfx_set_document { docId: "wind2", durationTicks: 198 }

# One braided strand (add 2-3 more at different phase/radius for the full braid)
vfx_add_node { docId: "wind2", type: "HelixPath", id: "helix0", params: { radius: 0.44, turns: 1.5, phase: 0, spin: 3.2, taper: "both", samples: 72 } }
vfx_connect { docId: "wind2", from: "node-source.out", to: "helix0.start" }
vfx_connect { docId: "wind2", from: "node-target.out", to: "helix0.end" }
vfx_add_node { docId: "wind2", type: "EffectTimeCurve", id: "envelope", params: { curve: { domain: "effectSeconds", interpolation: "linear", keys: [{x:0,y:0},{x:0.3,y:0.4},{x:0.5,y:1},{x:1.47,y:0.85},{x:1.8,y:0.6},{x:2.3,y:0}] } } }
vfx_add_node { docId: "wind2", type: "ScalarMath", id: "ribfade0", params: { operation: "multiply", b: 0.85, inputUnit: "normalized", unit: "normalized" } }
vfx_connect { docId: "wind2", from: "envelope.value", to: "ribfade0.a" }
vfx_add_node { docId: "wind2", type: "Material", id: "ribmat0", params: { template: "SpriteTextured", sprite: "smoke-puff", blend: "normal", tint: { srgb: "#5A948F", alpha: 1 }, emission: 0.25, uvScroll: [-2.5, 0], uvDistort: 0.06 } }
vfx_connect { docId: "wind2", from: "ribfade0.value", to: "ribmat0.opacity" }
vfx_add_node { docId: "wind2", type: "Schedule", id: "gust", params: { startTicks: 0, durationTicks: 138, mode: "window" } }
vfx_add_node { docId: "wind2", type: "RibbonRenderer", id: "ribbon0", params: { width: 0.105, endFade: 0.3, uvMode: "tile", uvTileLength: 1.4 } }
vfx_connect { docId: "wind2", from: "helix0.paths", to: "ribbon0.paths" }
vfx_connect { docId: "wind2", from: "ribmat0.material", to: "ribbon0.material" }
vfx_connect { docId: "wind2", from: "gust.window", to: "ribbon0.window" }
vfx_connect { docId: "wind2", from: "ribbon0.visual", to: "node-output.visual" }

# Fast streaks along the same axis
vfx_add_node { docId: "wind2", type: "Schedule", id: "streakwin", params: { startTicks: 18, durationTicks: 90, mode: "window" } }
vfx_add_node { docId: "wind2", type: "Emitter", id: "streaks", params: { shape: "cone", coneAngle: 0.12, radius: 0.66, rate: 45, speedMin: 6, speedMax: 9, lifetimeMin: 0.3, lifetimeMax: 0.6, direction: [1,0,0] } }
vfx_connect { docId: "wind2", from: "node-source.out", to: "streaks.anchor" }
vfx_connect { docId: "wind2", from: "node-target.out", to: "streaks.aim" }
vfx_connect { docId: "wind2", from: "streakwin.window", to: "streaks.window" }
vfx_add_node { docId: "wind2", type: "InitialProperties", id: "streakip", params: { sizeMin: 0.02, sizeMax: 0.04 } }
vfx_add_node { docId: "wind2", type: "Material", id: "streakmat", params: { template: "SpriteTextured", sprite: "spark-streak", blend: "normal", tint: { srgb: "#88B8B4", alpha: 1 }, opacity: 0.75, emission: 0.1 } }
vfx_add_node { docId: "wind2", type: "BillboardRenderer", id: "streakbb", params: { alignment: "velocity", stretchRatio: 6, pivot: 0.7 } }
vfx_connect { docId: "wind2", from: "streaks.particles", to: "streakip.particles" }
vfx_connect { docId: "wind2", from: "streakip.particles", to: "streakbb.particles" }
vfx_connect { docId: "wind2", from: "streakmat.material", to: "streakbb.material" }
vfx_connect { docId: "wind2", from: "streakbb.visual", to: "node-output.visual" }
vfx_compile { docId: "wind2" }
vfx_render_frames { docId: "wind2", ticks: [20, 60, 120] }
```

Add 2–3 more `HelixPath`+`Material`+`RibbonRenderer` strands at different `phase`/`radius`/`spin` for the full braid,
and a `Vortex`-driven wisp layer (see wiring in the shipped `wind-gust` component) for volume.

## Variants

| Variant | Change | Example |
|---|---|---|
| Cutting gust | straight (low twist), narrow, fast dense streaks | width 0.16, twist 0.35, streaks 80/s |
| Broad whirl | wide, high twist, around a short axis at Source instead of travelling | width 0.76, twist 3, 5 strands |
| Tornado | vertical Vortex axis, continuous window, rising dust instead of ribbons | see `tornado` component |
| Elemental wind (poison/holy gust) | recolour via `colour-main`, keep normal blend | green `#7CD13A` for a poison gust |

## Looks wrong → fix

| Looks like | Cause | Fix |
|---|---|---|
| A rigid ribbon, not moving air | no `uvScroll` on the ribbon material | add `uvScroll` (e.g. `[-2.5,0]`), increase magnitude for faster-feeling flow |
| One flat ribbon instead of a braid | only one `HelixPath` strand | add 3–5 strands at evenly spread `phase` and slightly different `radius` |
| Snaps on/off abruptly | flat window opacity, no envelope curve | drive opacity from an attack/hold/fall `EffectTimeCurve` |
| White-outs into fog | blend set to additive with opacity near 1 | normal blend, opacity ≤ 0.85 per ribbon, small emission only |
| Streaks look like straight needles with no sense of air | no `Vortex` on the wisp layer | route wisps through a `Vortex` for a lazy curl |
| Tornado dust just falls instead of rising | `Gravity` acceleration pointing down | use a small *positive* Y acceleration (lift) alongside the Vortex |

## Ticks/camera to check

Attack (~10–20 ticks in), peak (near the envelope's 1.0 point), and the fall tail (last 20–30 ticks) — a gust that
looks good only at its peak but pops in/out at the edges needs envelope work. Side view shows the braid best; check
front-on too since streaks are velocity-aligned toward the camera on a head-on gust.

**Verified 2026-09-30**: built `recB-wind` via `vfx_new_document(component:"wind-gust")`, compiled clean (2 particle
systems, 4 ribbon layers), rendered ticks 30/90/150 — tick 30 and 90 show four teal ribbons visibly crossing and
braiding along the gust axis with faint streak sparkles; tick 150 (near the end of the 138-tick active window) shows
the gust mostly faded to a single small wisp puff, confirming the fall-off envelope. First render attempt timed out
after 1800s (dev server render queue); a retry with identical params succeeded — logged in `_gaps-B.md`.
