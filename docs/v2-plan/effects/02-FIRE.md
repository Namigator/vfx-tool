# Fire — directed flame jet

## Intent and failure to avoid

A coherent jet of evolving flame tongues with a hot source, cooler outer tongues, rising embers and separate smoke. The user rejected v1 fire. A field of circular orange particles, blurred glowing fog or visible rectangular cards fails this specification.

Default source (-3,1.2,0), target (3,1.1,0), seed 42, duration 216 ticks. Charge/ignition ticks 0–12, emission 12–96, tail 96–216.

## Editable components

| Component | Construction | Initial settings |
| --- | --- | --- |
| Ignition | SpriteRenderer + short Sound | .15→.4 m flash over 6 ticks at tick 12 |
| Hot core | cone Emitter + velocity-aligned flame flipbook | 35/s, speed 9–12 m/s, life 18–30 ticks, cone 8°, size .12→.4→0 m |
| Flame tongues | cone Emitter→Drag→NoiseForce→OverLife | 100/s, speed 7–10 m/s, life 24–45 ticks, cone 15°, size .18→.65→0 m; two different atlases |
| Embers | sparse Emitter→Gravity/Drag→ParticleTrail | 28/s, speed 3–6 m/s, upward bias; life 30–72 ticks; .015–.035 m streaks |
| Smoke | low-rate Emitter→upward acceleration→NoiseForce | 14/s, life 60–114 ticks, .2→1 m; normal alpha .05→.25→0 |
| Source light | PointLight | warm, bounded flicker; follows ignition/emission envelope |
| Sound | ignition + rush + crackles + tail | separately enabled; no perpetual sound beyond duration |

Flame motion follows source→target direction and lifts gradually. Gravity node may use positive Y acceleration for buoyancy. Noise is low-frequency coherent motion, not independently random jitter each frame. Size/opacity/temperature vary over life. Use a bright yellow-white narrow base, orange body and darker red edge; smoke is a separate non-additive material.

## Assets and material gate

Create/review two 4×4 animated flame atlases with changing asymmetric silhouettes, narrow roots and tapering tips, plus smoke atlas and ember streak. Inspect on checkerboard, dark and light backgrounds, enlarged and at intended size. No hard alpha rectangles, edge clipping, obvious atlas repetition or isolated circular blobs.

Default flame blend is normal with restrained emissive core; additive accents are separate. Animated dissolve breaks up the tip. UV distortion must not turn the whole plume into a uniform wobble.

## Published controls

Reach (launch speed/lifetime bindings), cone width, flame size, heat palette, turbulence, smoke amount, ember amount, emission duration. Internals expose rate, speed/life ranges, flipbook, curves, noise scale, drag and material operations. Turning Smoke or Embers off leaves Flames unchanged.

## Variants

Compact torch: source and target 1.5 m apart, continuous .9 s burst, narrow cone, slow upward flicker.
Wide burst: 35° cone, .45 s emission, stronger initial velocity, short tongues and more sparse embers.
No variant is merely a hue change.

## Acceptance

Read as fire with bloom off; a directional hot base and changing tongues remain apparent. Smoke rises/fades rather than becoming a gray wall. Compare all three configurations from front-oblique and side, dark/light floor. Listen for clear ignition, shaped rush and controlled crackle. Record captures and user judgment; do not mark complete because particles spawn.

