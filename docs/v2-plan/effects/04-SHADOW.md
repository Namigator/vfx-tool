# Shadow — inward vortex and collapse

## Intent and failure to avoid

A dark, textured volume formed by wisps moving inward, with restrained violet/cool edge definition and a collapsing core. The user rejected v1 shadow. Purple neon spirals, pure additive fog, a featureless black disk and disappearing completely on the dark floor fail.

Default center target (0,.75,0), source (-3,1.4,0), seed 42, duration 210 ticks. Gathering 0–30, inward motion 30–138, collapse 138–168, residual wisps 168–210.

## Editable components

| Component | Construction | Initial settings |
| --- | --- | --- |
| Dark body | overlapping DarkVolumeSprite particles | low-rate sphere emitter, radius .55 m, 12–20 live cards; alpha .15–.35; dark blue-gray |
| Inward wisps | disc/sphere Emitter→Vortex→Attract→OverLife | 36/s, radius 1.4 m, life 48–90 ticks; tangential acceleration 2.5, inward 1.8, kill radius .08 m |
| Tendrils | HelixPath/taper→RibbonRenderer | 5 paths, radius 1.3 m→0, textured broken mask, width .06–.12 m |
| Edge accent | separate restrained sprite/ribbon material | desaturated violet, alpha ≤.3, emission ≤.5; no bright white core |
| Collapse | shrinking sprite/mesh + inward burst | 30 ticks; radius .6→0, all emission stops by tick 138 |
| Residue | sparse dark wisps | life ≤42 ticks, opacity tapers to zero |
| Sound | low swell + inward rush + soft collapse | same collapse event, distinct from electrical snap |

Dark body uses normal-alpha compositing so it can darken the scene. It has internal variation and semitransparent edges, not a solid black quad. Edge tint provides separation on a dark background without redefining the effect as glowing purple light.

## Assets and material gate

Animated dark smoke/wisp mask with stretched irregular shapes, low-frequency dissolve noise and broken ribbon mask. Review alpha and body color separately. DarkVolumeSprite allows subtle cool edge tint; keep that independently editable. No global floor darkening or camera vignette is used to make the preset pass.

## Published controls

Vortex radius, inward speed, swirl, body density, edge visibility, collapse time, residual duration. Internals expose dark tint, alpha distribution, attract soft radius, wisp life and material maps. Solo body and wisps independently; turning edge accents off must leave genuine dark structure on a light background.

## Variants

Inward puff: no long tendrils, brief outward radius followed by rapid inward absorption.
Narrow tendril: elongated source→target textured ribbon with dark trailing wisps and a small receiving vortex.
Both use existing path/emitter/material nodes.

## Acceptance

Readable on both neutral backgrounds without turning on bloom. Motion clearly converges inward, including particles rather than only texture scrolling. Collapse reduces volume and clears emission; no endless looping cloud survives end. Inspect from two oblique views and close-up for billboard/card exposure. Sound is restrained and ominous, with no clipping or continuous sub-bass overload.

