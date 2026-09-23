# Energy — charged projectile and impact

Default source (-4,1.4,0), target (4,.3,0), seed 42, duration 180 ticks. Charge 0–30, travel 30–66, impact at arrival 66, tail through 180.

## Composition

| Component | Nodes and initial values |
| --- | --- |
| Charge core | two sprite layers plus 24 converging motes; .08→.3 m over 30 ticks |
| Projectile path | BezierPath, shallow .4 m arc, PathFollower duration 36 ticks |
| Moving core | Mesh/Sprite at follower anchor, .22 m core plus .6 m low-alpha halo |
| Main trail | MotionTrail history 18 ticks, width .08→0 m, gradient white→violet→transparent |
| Orbiting accents | sparse local-space particles around follower; world-space shed sparks are a separate emitter |
| Shed sparks | 60/s during travel, life 18–42 ticks, low velocity noise and tapered trails |
| Impact | arrival event drives ring, sprite flash and 90-particle burst |
| Impact ring | radius .2→2.8 m over 36 ticks, thin mask, fade |
| Sound | charge chirp, travel tone/rush, arrival transient, decaying tail |

The trail follows past projectile positions; it must not appear as a full source-to-target beam before the projectile arrives. Core stops at target; trail drains naturally, with no teleport/reset at loop boundary.

Published controls: charge time, travel duration, arc bend, core size, trail length/width, impact amount and palette. Changing target distance while duration stays fixed changes actual speed, displayed in meters/second. Offer a duration-versus-speed control mode in the component macro: speed mode explicitly computes duration from path length and rounds to ticks, with the resolved duration shown.

Arrival event drives every impact element and sound. If travel duration changes, impact timing updates automatically. The global document duration must include its tail; warn if a user shortens it and will truncate output.

Variants: fast needle projectile with narrow long trail and small sharp impact; slow heavy orb with broad short trail and larger ring/particle burst.

Acceptance: charge/travel/impact are clearly distinct, no premature impact sound, arrival occurs once, trail persists briefly after core stops then clears. Inspect moving core from side and oblique views and scrub backward/forward to the same trail state. Both speed and duration macro modes reproduce after save/import.

