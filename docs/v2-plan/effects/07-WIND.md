# Wind — spiral gust

Default source (-3,1.1,0), target (3,1.1,0), seed 42, duration 180 ticks. Buildup 0–18, gust 18–108, fade 108–180.

## Composition

| Component | Nodes and initial values |
| --- | --- |
| Main ribbons | 4 HelixPath ribbons around source→target; radius .55 m, 1.5 turns, taper ends; width .035–.08 m |
| Secondary streaks | velocity-aligned Emitter, 45/s, speed 6–9 m/s, life 24–48 ticks; narrow textured streaks |
| Air wisps | low-opacity textured billboards, 10/s, slight swirl, no opaque body |
| Gust modulation | attack/hold/fall envelope and slow radius/opacity variation; motion follows gust direction |
| Sound | filtered wind rush with rising attack, moving spectral emphasis and soft tail |

Ribbons use broken soft masks and restrained desaturated white/teal, emission ≤.3. The flow should be indicated by sparse material rather than a solid luminous spring. Vary ribbon phase and thickness while preserving coherent travel.

Published controls: gust width, twist, travel speed, ribbon amount, streak density, buildup and duration. Internals expose path taper, UV scroll, rate/life and force curves.

Variants: straight cutting gust with low twist and long thin streaks; compact whirling burst around a short axis with wider radius and slower release.

Acceptance: reads as air movement rather than lightning or water, with open negative space and coherent direction. No infinitely rotating unchanged helix after emission stops. Check both backgrounds; listen for wind identity without an irritating sustained whistle.

