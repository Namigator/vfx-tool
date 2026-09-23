# Light — radiant pulse

Default target (0,1,0), source (-3,1.3,0), seed 42, duration 168 ticks. Gathering 0–36, pulse at 36, rays/ring through 90, fading motes to 168.

## Composition

| Component | Nodes and initial values |
| --- | --- |
| Charge | 24 inward motes and small growing source/target core, warm white |
| Pulse core | layered SpriteRenderers, sharp 3-tick attack then .15–.4 m core, broad low-alpha halo |
| Rays | RadialPath count 32, lengths .6–2.4 m, seeded direction/length, tapered RibbonRenderer widths .01–.035 m |
| Halo/ring | thin masked rings expand .2→2.6 m; one upright halo, one ground ring |
| Motes | burst 48, slow outward drift .3–1 m/s, life 36–90 ticks, tiny soft sprites |
| Point light | one short bounded warm light, independently disabled |
| Sound | tonal anticipation, bright chime, soft shimmer tail |

RadialPath is a generic documented path generator (sphere/disc/cone distribution), not a Light-family hook. Brightness hierarchy is narrow core, distinct rays, faint halo. Bloom should preserve individual structures rather than producing a flat white disk.

Published controls: charge time, ray count/length, pulse size, halo softness, mote amount and brightness. Internals expose ray direction distribution, path taper, material emission and audio partials.

Variants: focused narrow cone of rays; broad soft radial blessing pulse with fewer rays and longer mote tail.

Acceptance: individual rays remain legible at normal viewing scale and glow-off; no harsh strobing or clipped white region hiding most geometry. Rings retain orientation while orbiting. Chime avoids piercing peaks and begins with the visible pulse.

