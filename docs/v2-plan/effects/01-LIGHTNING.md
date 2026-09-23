# Lightning — first quality benchmark

## Intent

Match or exceed the original ARC demo's layered blue-white discharge, sharp branching, charge anticipation, impact and fading sparks. Every layer must be visible as an editable component in the graph. No private lightning renderer, copied whole-frame animation or baked screenshot is acceptable.

Reference: preserved original HTML/WAV. Original charge is about .39 s, discharge .65 s and sound 2.4 s. v2 timing rounds to ticks: charge 24, active 39, total 144. Default source (-5.1,1.65,0), target (4.5,.1,0), seed 2. Frame the view to match the original cast.

## Top-level components and graph

Charge → Discharge event → Bolt + Source Sparks + Impact Sparks + Impact Ring + Impact Light + Sound.
Optional Presentation receives the same discharge event.
Expose source/target, energy, core width, spread, primary branch count, charge time and total duration. Advanced contains all component parameters. Ordinary root Output mixes visual/audio/presentation outputs.

## Components and initial values

| Component | Internal construction | Initial settings |
| --- | --- | --- |
| Charge core/halo | Schedule + two SpriteRenderers | ticks 0–24; size .04→.28 m core / .2→1.4 m halo; blue-white core, blue halo; alpha rise |
| Charge motes | Emitter + orbit/vortex motion + tiny sprites | burst 27, life 24 ticks; radius .25–1.5 m contracts toward source; ParticlePaths selects 4 mote-to-source paths, then JaggedPath makes tiny tethers |
| Main bolt | LinePath→JaggedPath→RevealPath | 42 samples; .55 m displacement, vertical bow .42 m via Bezier base; 24 Hz regeneration; reveal over 2 ticks |
| Secondary filaments | two independent JaggedPath chains | 48 samples, .36/.56 m displacement, opacity scale .32 |
| Primary branches | BranchPath(main) | 14; attach u .12–.88; length .4–1.8 m; opacity .20–.48; exact attachment |
| Secondary forks | BranchPath(primary) | 7 total selected parent branches; short .3–1 m; opacity .15 |
| Four bolt materials | same paths→four RibbonRenderers | core width .026 m / inner .07 / outer .185 / halo .43; white/cyan/blue/deep blue; opacity 1/.65/.17/.07 |
| Source sparks | Emitter→Gravity→ParticleTrail | burst 45 at tick 24; speed 1.5–6.5 m/s; life 11–71 ticks; gravity -10Y; trail 2 ticks |
| Impact sparks | Emitter→Gravity→ParticleTrail | burst 70 at target tick 24; speed 1–6 m/s; same lifetime; upward hemisphere |
| Impact core/halo | two SpriteRenderers | .35 m core, 2 m halo, fast exponential envelope; no permanent orb |
| Ground light/ripple | PointLight + RingRenderer | 1–2 lights total; ripple radius .15→5.6 m over 96 ticks, exponential fade |
| Presentation | ScreenFlash + CameraImpulse | alpha .13 over 4 ticks; subtle 6-tick impulse; independently disabled |

Four passes share path geometry. Path strength/width attributes multiply each material's alpha/width; branches cannot be as thick as the main trunk unless changed deliberately. Discharge envelope is exp(-3*t)*(.72+.28*sin(96*t)^2) over .65 seconds, represented by registered envelope/math nodes rather than hidden family code. Use Time, ScalarMath(exp/multiply/add/power) and a sine Oscillator at 96/(2π) Hz (then square it) in the node graph to express it; expose envelope decay and flicker separately. No approximating it with a few hand-picked curve keys.

## Audio

Expandable layers: rising chirp charge, short highpassed noise snap, fluttering mid-band electrical tear, accents at discharge+5/+11/+19 ticks, low rumble with fast attack and long release. Use the same discharge event. Preserve original source/WAV as listening reference. Target mix peak ≤-1 dBFS and no audible onset/loop clicks.

## Required variants

Thin fork: half core width, 22 fine primary branches, fewer impact sparks, short tail.
Heavy strike: 1.6× core width, 8 strong branches, wider impact/ring, slower .55 s charge.
Both use the same exposed components; do not clone and alter runtime code.

## Acceptance

Matched original/new clip through all phases, plus two oblique views and dark/light backgrounds. Main and fork endpoints stay attached. Four material layers remain distinguishable at close-up, with a readable core at normal scale. Sparks are moving streaks with individual lifetimes, not orbiting stationary dots. Charge and impact feel temporally distinct; tail clears completely. Glow-off view retains a good bolt silhouette.

User approves comparable richness and impact. Save/reopen, disable individual layers, build the composition from Components, and demonstrate edits produce the intended changes. This gate precedes fire/water/shadow expansion.

