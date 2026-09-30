# Gate B — lightning quality floor (evidence packet)

Status: **OPEN — waiting for the user's visual judgement.** Nothing here claims acceptance.

## Reproduce
- Original: `node tools/capture-original-lightning.mjs` (dev server on 127.0.0.1:5174) captures
  `docs/v2-plan/references/original-lightning/lightning-arc.html` with headless Chrome → `original-*.png`.
- Graph version: `document.vfx.json` = Blank + Add component "Lightning strike" with Source/Target moved to the
  original's positions (-5.1, 1.65, 0) and (4.5, 0.1, 0). Matched camera derived from the original's projection
  (yaw .32, pitch .30, distance 18.5, look-at (0, .6, 0), focal = min(W/1.45, H·1.48) → 44.4° vertical fov):
  `vfx_render_frames {camera: {position: [-5.56, 6.07, 16.78], target: [0, .6, 0], fov: 44.4}, 960×540}`.
- Extra angles/backgrounds: `vfx_contact_sheet` with `orbit` (yaw 70/pitch 25, yaw -130/pitch 35), glow off, light arena.

## Files (all opened and inspected by the agent, 2026-09-29)
| File | What |
| --- | --- |
| original-strike.png (+ charge/flicker/decay) | Original at the discharge. Limitation: Chrome's virtual clock did not land on the charge or late decay phases; all four show the discharge. |
| graph-strike-matched.png | Graph lightning, tick 27 (just after the strike), matched camera |
| compare-strike.png | Side by side (mean colour difference 27/255 — not a quality measure; the original has UI chrome and a lit arena) |
| graph-matched-glowoff.png | Ticks 18–100, glow off |
| graph-matched-light.png | Same on the light arena |
| graph-angle2.png, graph-angle3.png | Two additional angles, dark arena |

## Agent observations (not the user's review)
- Same framing and silhouette: one bolt from Source to Target with side branches, bright impact end, sparks at both
  ends, ground ripple, decay to empty by tick ~100. Stable in 3D from both extra angles (branches stay attached).
- Differences: the original bathes the arena in a blue ambient glow and has a larger soft halo at the impact; the graph
  bolt zig-zags with a larger amplitude and its branches are longer (the user already asked for shorter branches and
  a bit more white; skipped as a preset taste tweak per the user's 2026-09-29 decision — the Branches/Jaggedness knobs
  cover it).
- Glow off: bolt geometry still reads (not dependent on bloom).
- Light arena: the bolt is nearly invisible — it is additive light. The original only ever ran on a dark arena.
  Open question for the user (a darker core/outline variant would help on light floors).

## User review
_Not yet given._
