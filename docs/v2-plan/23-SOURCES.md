# Technical references and how they inform the plan

Consulted during planning on 2026-09-23/24. These support implementation choices, not claims that the future tool is tested. Local installed source/lockfile remains the authority for the currently installed package version.

## Graph editor

- [React Flow repository](https://github.com/xyflow/xyflow): official source and MIT licensing; vet/pin the actual package before installation.
- [Custom node and interaction examples](https://reactflow.dev/examples): source for supported graph interaction patterns. Some examples are Pro; this plan uses the open-source package and project-owned commands, not unlicensed Pro example code.
- [Subflows](https://reactflow.dev/learn/layouting/sub-flows): UI grouping concepts. Application-owned embedded graphs and interfaces remain the semantic model.
- [Performance guidance](https://reactflow.dev/learn/advanced-use/performance): memoize node components/callbacks, subscribe narrowly and avoid unnecessary graph-wide rerenders.

## Rendering and assets

- [Three.js color management](https://threejs.org/manual/pages/color-management.html): color textures versus non-color data maps and linear rendering workflow.
- [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html): official loader for the constrained static GLB import path.
- [Three.js Material](https://threejs.org/docs/pages/Material.html): rendering properties such as blending/depth/premultiplication. The plan stores semantic material recipes, not instances.
- [fflate repository](https://github.com/101arrowz/fflate): proposed ZIP implementation. Application-level path/size/hash validation remains required regardless of ZIP library.

## Browser persistence and audio

- [Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): browser storage is quota-controlled and may be evicted; catch failures and offer portable backups.
- [AudioContext.getOutputTimestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp): mapping audio context time to performance time. It helps scheduling alignment but does not certify actual perceived synchronization.

## Engine boundary

- [Roblox materials](https://create.roblox.com/docs/parts/materials) and [PBR textures](https://create.roblox.com/docs/art/modeling/surface-appearance): documented material customization uses supported map/property systems.
- [GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html): geometry/material interchange is distinct from exporting the full VFX graph, simulation, events and public controls.

Inference from these sources: an engine-neutral authored material vocabulary is useful, but a universal editable shader graph across the three target engines has not been established. Therefore this phase provides named material operations with capabilities/fallbacks and defers full shader programming and engine exporters.

## Source-code reference

Original lightning source and assets are preserved locally under references/original-lightning/, with hashes. The reference source supplies the visual composition and timing benchmark. It is not a dependency to load at runtime or a hidden family renderer.

