# Earth — stone upheaval

Default target (0,0,0), source (-3,1.3,0), seed 42, duration 216 ticks. Ground anticipation 0–30, eruption at 30, debris motion through 120, dust tail to 216.

## Composition

| Component | Nodes and initial values |
| --- | --- |
| Ground pulse | ring radius .2→1.4 m over 18 ticks; dusty mask, not a luminous sci-fi ring |
| Large stones | burst 18, 3 static rock meshes, size .18–.5 m; disc radius .8 m; upward speed 2–5 m/s with outward bias |
| Small chips | burst 48, size .025–.1 m, speed 2–6 m/s, life 30–90 ticks |
| Motion | Gravity(-9.81Y), Drag(.15), GroundCollision bounce(.15), friction .7, max 2 bounces |
| Dust | burst 35 plus short 20/s window, .2→1.2 m textured alpha particles, life 60–150 ticks |
| Contact puffs | collision-driven small dust bursts, max 2 particles/contact, no recursive event chain |
| Sound | low impact, granular stone ticks, dust tail; contact ticks volume follows incoming speed |

Rock material is rough (.85), non-emissive, warm brown/gray; lighting must reveal facets. Use varied silhouettes and rotations. No terrain mesh is removed or deformed. Dust sits near ground initially, expands and thins rather than forming orange smoke.

Published controls: stone count/size, eruption force, spread, bounce, dust density and settling time. Increasing force changes trajectory; it must not silently enlarge rocks.

Variants: heavy compact eruption with fewer large slow stones; wide gravel burst with many small faster chips and restrained dust.

Acceptance: stones emerge from the target area, hit the floor without tunneling, stop repeated collision sounds when resting, and fade before the end. Dust and rock remain distinct with bloom off. Low impact audio has definition without excessive sub-bass. Inspect contact points, silhouettes and resource cleanup.

