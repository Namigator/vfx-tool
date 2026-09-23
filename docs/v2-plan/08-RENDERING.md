# Browser renderer

## Rendering objective

Produce detailed, layered effects through ordinary graph outputs. The lightning reference must not use a privileged render path unavailable to users. Do not emulate every material with the current circular point sprite.

Three.js/WebGL2 remains the rendering backend. Use an HDR linear render target where supported, ACES tone mapping once, and sRGB output conversion once. Configure color textures as sRGB and data maps as non-color. Preserve an SDR fallback with an explicit capability warning; it cannot automatically pass the reference-quality gate.

## Geometry paths

- Billboards: instanced camera-facing or velocity-aligned quads with per-instance position, size, rotation, color, opacity, atlas frame and motion direction. Use textured surfaces rather than gl_PointSize; particle appearance must not change because a point-size hardware limit is reached.
- Ribbons: indexed strip geometry with world-space widths, arc-length UVs, width/color/opacity attributes and stable joins. Clamp miter joins to twice width, use bevel fallback, and handle zero-length segments. Separate materials can render the same path for core/body/halo.
- Trails: a history-derived ribbon with age-based taper, not a beam permanently connecting source to target. A dead particle's trail fades by trail-point age.
- Meshes: InstancedMesh batches by geometry/material; static GLB primitives and built-in rock/shard/orb/cone/plane. Per-instance color/opacity and transforms. Transparent mesh instances use bounded sorted batches.
- Rings/sprites: real oriented geometry with masks and envelopes; draw at any authored orientation, not forced flat by the renderer.
- Lights: bounded PointLight pool. A light is a distinct authorable node; no hidden light automatically follows every effect.
- Presentation: optional camera impulse/screen flash run through a separate preview pipeline and global reduced-effects controls.

Preserve source node IDs in draw batches so selecting a block can highlight its contributing geometry. Highlight is a preview overlay and must not change saved materials.

## Transparency and depth

Opaque and cutout objects write depth. Ordinary translucent particles/ribbons do not; they depth-test against arena/opaque geometry. Additive objects do not write depth and must not use normal-alpha blending for their glow. Premultiplication policy is fixed per material pipeline and matches decoded textures.

Normal-alpha particles sort back-to-front within each system; systems sort by bounds-center depth with stable layer order as a tie-break. This is an explicit approximation for interpenetrating transparent systems. Preserve user render-order controls, test close overlaps, and do not claim perfect order-independent transparency.

Soft intersection samples scene depth only for templates that request it; fallback is alpha fade without depth softness. Ground-fade is analytic and works without a depth texture. Water uses a restrained translucent body and separate highlights/foam; do not rely on see-through sorting alone for readability.

## Materials and post-processing

Use semantic material recipes from the material document, compiled into internal shader variants. Variants are keyed by structural features, not animated numeric values. Reuse uniforms for changing values; no shader recompilation for color or age curves.

Bloom is optional, bounded and applied in HDR before OutputPass. Default profile: strength .8, radius .45, threshold 1.0; material emission controls determine what blooms. Exposure 1.0 is a preview default, not a hidden correction for individual effects. Provide glow-off inspection.

Scene-color distortion/refraction is an optional separate pass. Never read and write the same render target. Use a resolved scene-color copy, clamp offsets to max 8 pixels at 1080p, and provide a no-refraction water fallback. Vignette is a preview preference, off by default. No chromatic aberration or motion blur in v2.

## Arena and camera

Neutral empty floor, meter grid, source/target markers, dark and light background presets. Markers/grid can be hidden. Camera defaults to an oblique view that fits source, target and declared effect bounds; Reset camera fits those bounds, not a fixed distance that clips large effects. Near/far range .05–500 m; clamp orbit above the ground by default.

A/B reference harness uses a fixed camera/frame/resolution, disables auto-fit and records actual canvas dimensions/DPR. Normal editing uses orbit/pan/zoom; no character or game scene.

## Resource ownership

Asset registry owns CPU bytes; renderer owns reference-counted textures/geometries/material variants. Scene instances own pool slots only. Cache release occurs after the last document/undo reference is gone; renderer destruction disposes all geometries, materials, render targets and every postprocessing pass.

Resize updates canvas, depth/color/bloom targets and camera aspect. WebGL context loss pauses preview, shows a recovery message, preserves the document, and rebuilds GPU resources after restore. Do not create another renderer on each control change.

## Diagnostics and proof

Expose live particle/mesh/path counts, triangles, draw calls, textures/geometries, render-target sizes and worker cost. Distinguish application render CPU time, frame interval and GPU timer-query measurements. Each benchmark records which measurement exists.

Tests inspect packet correctness and resource ownership; screenshots/clips establish actual rendering. Passing packet tests cannot certify transparency, glow, silhouettes or material appearance.

