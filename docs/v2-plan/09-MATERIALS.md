# Material recipes and visual building blocks

## Contract and boundary

Materials are engine-independent descriptions of named operations. The editor does not expose GLSL, WGSL, HLSL, engine shader nodes or executable code. Material controls can be driven by constant, effect-time, normalized-age or pathU signals where declared.

MaterialRecipe fields: id, template, blend, faceMode, depthTest, texture slots, ordered UV settings, color gradient, opacity curve, emission, roughness/metalness, dissolve, rim, softIntersection and optional distortion. Use only fields supported by the chosen template; show unsupported fields disabled with explanation. Unknown material operations block compilation, not silently disappear.

Five templates:
1. SpriteUnlit: flames, sparks, smoke masks, billboards, core flashes.
2. RibbonUnlit: bolts, wisps, trails and streaks with longitudinal UV control.
3. MeshLit: rocks, shards, meshes using metallic/roughness PBR.
4. SurfaceTranslucent: water sheet/droplets with restrained reflection and optional refraction.
5. DarkVolumeSprite: normal-alpha smoke/wisp with dark body and separately controllable edge tint.

Templates are reusable materials, not effect-family switches.

## Evaluation order

1. Compute geometric UV; apply tiling, offset, rotation and scroll.
2. Apply deterministic distortion of UV by a noise texture; amplitude normalized UV, 0–.15.
3. Select flipbook cell if present; clamp sample within padded cell borders.
4. Sample color/mask and optional normal/data maps.
5. Multiply sampled color by gradient/tint in linear color space.
6. Calculate opacity from texture alpha, mask, age/envelope and dissolve.
7. Add optional dissolve edge/rim emission; apply lighting where template supports it.
8. Apply soft intersection/ground fade; output blend-compatible color and alpha.

Neither emission nor bloom raises alpha on smoke. Black normal-alpha particles can darken the background; black additive particles cannot create shadow.

## Default fields and ranges

| Field | Default | Range/behavior |
| --- | --- | --- |
| Tint | white | sRGB hex |
| Opacity | 1 | 0–1, multiplied by curves |
| Emission | 0 | 0–20 linear multiplier |
| Blend | template default | normal, additive, cutout; no subtractive mode |
| Alpha cutoff | .5 | 0–1, cutout only |
| Roughness | .6 | .04–1, lit/translucent only |
| Metalness | 0 | 0–1, lit only |
| UV tiling | (1,1) | .01–32 per axis |
| UV scroll | (0,0) | -10–10 UV units/s |
| UV rotation | 0 | radians, -2π–2π |
| Dissolve amount | 0 | 0–1 curve |
| Dissolve softness | .08 | .001–.5 |
| Dissolve edge width | .03 | 0–.25 |
| Rim power | 3 | .25–12 |
| Rim strength | 0 | 0–5 |
| Refraction offset | 0 | 0–8 pixels at 1080p; enhancement only |

Dissolve: mask m, threshold d; opacity factor smoothstep(d-softness,d+softness,m). Edge band is the difference between two adjacent smoothsteps of declared width, independent of alpha color. At d=1 force zero opacity to avoid residual bright pixels.

Rim uses pow(1-max(dot(normal,view),0),power). Camera-facing sprite rim is radial UV-derived instead of pretending its normal produces a useful Fresnel edge. Document this distinction in material help.

## Texture/flipbook support

Color and emissive textures are sRGB; masks, normal and noise maps are linear data. Flipbooks are regular grids with rows/columns, frame count, fps or normalized-lifetime playback, looping flag and start-frame policy. Default sprite animation plays once across normalized age. Loop is optional while emitter is active, never an implicit immortal particle.

Frame index is floor(progress*frameCount), clamped to frameCount-1. Optional crossfade blends current/next cell; it must not sample a neighboring cell outside padding. Inset at least half a texel and author at least 2-pixel padding. Normalized age 1 yields no particle, not a wrapped first frame.

## Included visual recipes

- Lightning: four independent RibbonUnlit layers on the same path, with distinct widths, opacity and emission.
- Flame: textured moving tongues, hot narrow core, darker colored exterior, sparse embers; smoke uses a separate normal-alpha material.
- Water: translucent curved body, non-emissive highlights, thin edge reflection, small opaque/alpha foam patches, separate droplets.
- Shadow: dark smoke mass, readable cool edge accents and inward wisps; bloom off on the dark body.
- Earth: rough faceted solid plus low-opacity textured dust.
- Ice: faceted lit translucent/cutout shapes, narrow bright edges and small frost accents.

## Portability treatment

Texture color/alpha, gradients, UV animation and emission intent are core. Dissolve/rim/soft intersections/refraction require capability entries and alternate representations. Their recipes remain engine-neutral, but support is not promised in each engine.

Future adapters may bake a material's animated appearance to a flipbook or substitute a simpler mesh/sprite material. Baking can preserve appearance at a cost to editable material internals; the future exporter must report that loss. This phase records the distinction and builds browser recipes, not native exporters.

