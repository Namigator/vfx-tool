# Poison — caustic cloud with bubbles

Default target (0,.1,0), source (-3,1.2,0), seed 42, duration 240 ticks. Initial bloom 0–18, cloud/bubbles 18–138, dissipation 138–240.

## Composition

| Component | Nodes and initial values |
| --- | --- |
| Low cloud | sphere/disc Emitter 24/s, radius .65 m, rise .25–.7 m/s, life 72–138 ticks; size .25→1 m |
| Drift | Drag(.6), low-frequency NoiseForce(.25 m/s²), small upward acceleration |
| Bubbles | 10/s, orb/sprite sizes .04–.14 m, rise .4–1 m/s, life 36–78 ticks; thin rim with mostly transparent center |
| Bubble pops | death-event burst 3–5 tiny droplets, speed .3–1.2 m/s, short life; event budget enforced |
| Drips | sparse downward particles with gravity, dark wet color; not bright sparks |
| Ground residue | irregular masked ring/sprite .6–1.4 m, opacity ≤.25, fades by end |
| Sound | short hiss, irregular bubbling pops and soft liquid tail |

Cloud material uses normal-alpha with yellow-green variation, low emission and darker dense regions. Bubble/pop timing varies through seeded lifetimes. Do not apply the fire flipbook and recolor it green. Motion is slow buoyancy/drift, not a fast flame cone.

Published controls: cloud radius/density, drift, rise speed, bubble rate/size, popping amount and dissipation. Bubble and drips components can be removed without changing cloud generation.

Variants: low creeping pool cloud with few bubbles; tall bubbling plume with narrow base and more visible droplets.

Acceptance: readable internal volume without a solid green blob; bubbles have a distinct rise/pop lifecycle; event chains terminate; no all-frame synchronous popping. Differentiate visual and acoustic behavior from fire/water. Inspect light/dark backgrounds and counts at maximum safe preset controls.

