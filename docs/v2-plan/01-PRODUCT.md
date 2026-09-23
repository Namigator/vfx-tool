# Product requirements

## Purpose and audience

A local desktop browser tool for game creators who want sophisticated spell effects without coding or AI generation. Start simply, expose deeper controls when requested, and preserve enough authoring power to reproduce the original lightning. The visual target is layered, detailed game spells; neither physically accurate fluids nor flat generic glowing particles.

## Required user outcomes

| ID | Outcome | Acceptance witness |
| --- | --- | --- |
| R01 | Start from ten distinct defaults or a blank effect | Ten presets plus New Blank |
| R02 | Reach original lightning quality using exposed tools | Lightning comparison gate |
| R03 | Enable, disable, solo, remove, duplicate and replace parts | Graph interaction tests |
| R04 | Expand ready-made blocks into real editable internals | Group equivalence and editing tests |
| R05 | Combine elements and create reusable blocks | Mixed-effect and group-library exercises |
| R06 | Control emission, shape, motion, appearance, timing and sound | Node catalog coverage |
| R07 | Import useful art assets and retain provenance | Asset round-trip tests |
| R08 | Reproduce motion with a seed and inspect any timeline time | Schedule/seek conformance |
| R09 | Save/reopen locally and exchange complete bundles | Fresh-storage portable import |
| R10 | Keep engine-independent authored intent | Boundary tests and capability report |
| R11 | Remain responsive and disclose limits | Qualified browser measurements |
| R12 | Support keyboard authoring and reduced presentation effects | Accessibility scenarios |
| R13 | Preserve old recipes without silent conversion | v1 migration tests |

## Simple surface, substantial depth

A default opens as roughly 5–9 labeled component blocks, source/target controls, and one Output. Graph content is not artificially limited to that count. Select a block for 4–8 primary controls; expand Advanced or open its internal graph for the full component pipeline. A user never has to manipulate low-level nodes merely to disable smoke or widen a beam.

Internals are real graph nodes with typed connections, not a decorative diagram over a hard-coded family switch. A preset may reference only documented nodes/materials/assets. Family names are tags and library organization, not renderer dispatch instructions.

Expose exact units, meaningful ranges, animated curves, seed and performance estimates. No unexplained per-element slider that secretly adjusts unrelated values. Macro controls display their bindings.

## Included scope

One active composed effect; static source/target/custom anchors; ten shipped presets plus two authored variants per family; graph groups; curve and gradient editors; material recipes; particle/path/ribbon/mesh/ring/light nodes; procedural and sampled SFX; neutral arena; local asset library; JSON and portable archive; optional screen flash/camera impulse; diagnostics; migration of old files.

Users can assemble mixed-element effects and reuse groups. World-space and anchor-local emitters are supported. Mesh placement and motion remain effect authoring, not scene/world building.

## Explicit exclusions

Engine export/import plugins, arbitrary shader code, a general shader graph, arbitrary JavaScript/Lua execution, real-time collaboration, accounts, cloud storage, marketplace, mobile authoring, characters/rigs, combat/network replication, terrain editing/destruction, volumetric fluid simulation, general rigid bodies, animated/skinned mesh imports, scene collision beyond the preview ground plane, and an asset-generation AI service.

Screen flash, camera impulse, scene-color refraction and soft intersections are optional enhancements with explicit fallbacks. Defaults must retain readable structure without them.

## Priority and conflict resolution

1. Correct editable model and preservation of user work.
2. Reference-quality visuals/sound and understandable workflow.
3. Responsiveness on the reference desktop.
4. Breadth of preset library.
5. Convenience features.

Do not trade away component editability or quietly lower visual quality to increase the number of completed presets. Reduce optional presentation or document a measured limit instead. No public date or hardware guarantee until measurements exist.

## Definition of user approval

The original lightning establishes a quality floor. The user judges whether the graph-authored version has comparable richness and impact. Visual approval is required at the lightning gate and for the ten-default review; it is not required for routine implementation decisions already specified here. Capture the evidence first, then request only the specific artistic judgment still missing.

