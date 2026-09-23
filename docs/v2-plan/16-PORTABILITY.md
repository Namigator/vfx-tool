# Engine-independent authoring and future exporters

## What this phase promises

The saved graph, public controls, simulation semantics, assets, events, units and material intent do not depend on Three.js or browser objects. This makes later native adapters possible to reason about. It does not prove any engine export works, and does not promise identical pixels or arbitrary editable shader translation.

The user's conditional shader request is resolved as configurable VFX materials, not a full shader-programming graph. Roblox's documented MaterialVariant/SurfaceAppearance model uses supported PBR maps; Unity/Unreal have their own material systems. A neutral JSON graph by itself cannot establish a common runtime for all their shader features.

## Capability classes

Every node/material operation declares one or more capabilities and one of:
- Core: semantic behavior required to preserve authored intent, e.g. timed burst, path, gravity, alpha texture, public color.
- Approximation: behavior needing target-specific reconstruction, e.g. arbitrary branching paths, custom noise motion, dissolve, rim.
- Enhancement: optional presentation, e.g. screen refraction, bloom, soft intersection, camera impulse.

These classes describe the authoring contract, not a verified support matrix. The UI says "Portable intent" or "May need approximation", never "Roblox supported" without an adapter test.

## Capability inventory

| Capability | Semantic description | Future substitution to evaluate |
| --- | --- | --- |
| Timed burst/rate/lifetime | Fixed event ticks and identities | Native emitter or small runtime |
| Path/branch/ribbon | World-space points, width and appearance | Beam/trail segments, mesh strips |
| Particle forces | Defined integrator/noise math | Scripted CPU system or baked trajectories |
| Textured billboard/flipbook | Atlas, UV, age, blend, tint | Native particle sprites |
| Static mesh instances | GLB geometry, transforms, PBR intent | Imported mesh plus instance management |
| Gradient/curve | Defined interpolation and domains | Native curve/sequence or sampled data |
| Dissolve/rim | Named material operation | Material code, baked flipbook or simpler edge |
| Water refraction | Scene-color displacement | Native refraction or no-refraction surface |
| Dark smoke | Normal-alpha darkened textured sprite | Native alpha sprites/material |
| Lights | Position/color/intensity envelope | Native light or glow sprite |
| Layered audio | Source graph plus canonical WAV | Baked audio assets and timed playback |
| Presentation | Flash/impulse intent and bounds | Optional engine camera/post implementation |

## Adapter boundary

A future adapter reads validated document + assets + target profile and returns generated assets, native definition/runtime, public parameter mapping, conversion report and unsupported-feature errors. It must never overwrite the source graph.

Compile-time, restart-time and live controls are separate. PublicControl stable IDs map to native exposed fields. Future exports separate generated definitions from user overrides and preserve compatible overrides on re-export. This phase records those IDs and edit policies; it does not implement native inspectors or re-export merging.

## Baking and editability

Baked texture flipbooks preserve assets/appearance while reducing shader editability. Baked animation/trajectory caches reduce motion editability. The future report must name every baked control, asset size and lost runtime behavior. Never call a baked movie an editable VFX export.

The browser project always retains original graph and source assets. Portable package is the interchange master; GLB alone cannot represent particle timing, graph semantics and procedural audio.

## Required preparation now

- Pure node math and stable contract versions.
- Test fixtures with seed, tick, particle/path state and cue times.
- Explicit world units, transforms, color spaces and alpha semantics.
- Public controls with types/ranges/edit policies.
- Original asset bytes, provenance and checksums.
- Enhancement-off reference captures.
- No silent engine-specific fallback inside a generic node.

A later export feasibility slice must implement one complete lightning and one texture-heavy effect per target engine before estimating full exporter work. That future milestone is deliberately outside current delivery.

