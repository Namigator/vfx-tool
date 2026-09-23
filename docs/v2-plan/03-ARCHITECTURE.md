# Architecture and interfaces

## Chosen stack

Retain TypeScript, React, Vite, Three.js/WebGL2 and Web Audio. Use the MIT React Flow package (@xyflow/react) for graph interaction, not as the semantic graph model. Use fflate for ZIP bundles. Native IndexedDB stores documents/assets; native Worker runs simulation and heavy import/bake work. No backend or network calls are required after local application loading.

Before installation, vet and pin an exact stable release compatible with the existing React version, record license/source, and obtain approval for new third-party code. Do not substitute a homemade graph interaction framework or paid Pro examples if approval is pending; complete unrelated contracts/tests and report the dependency gate.

Use application-owned command/history stores with React useSyncExternalStore subscriptions; do not add another state framework. Keep React Flow's transient drag/selection state separate from authored graph state. Follow its documented memoization/subscription practices.

## Data flow

~~~mermaid
flowchart LR
  UI[Editor commands] --> DOC[Versioned document]
  DOC --> VAL[Validation and compiler]
  ASSET[Asset registry] --> VAL
  VAL --> IR[Compiled effect]
  IR --> SIM[Simulation worker]
  SIM --> FRAME[Frame packets and events]
  FRAME --> GPU[Three.js renderer]
  IR --> AUD[Audio cue renderer]
  CLOCK[Transport clock] --> SIM
  CLOCK --> AUD
  DOC <--> DB[IndexedDB]
  DOC <--> ZIP[Portable bundle]
~~~

The compiler emits engine-independent systems/material descriptions, not Three.js objects, shader source or React Flow node records. It validates and expands groups, resolves controls, prunes disabled render sinks, and computes budgets.

## Module boundaries

- model/: document types, validation, migrations and canonical serialization; no browser or renderer imports.
- graph/: node registry, port validation, group expansion, parameter bindings and compile pipeline.
- runtime/: math, RNG, particle/path state, events, seek/checkpoints; pure TypeScript.
- render/: Three.js conversion, materials, asset GPU resources and disposal.
- audio/: canonical offline synthesis/mixing plus browser playback transport.
- editor/: graph UI, inspectors, commands, asset browser and transport controls.
- persistence/: IndexedDB transactions, archives and import staging.
- presets/: data-only graphs, reusable groups and asset manifests.

New v2 modules coexist with frozen legacy modules until migration acceptance. Avoid renaming the entire existing tree before the first vertical slice.

## Core public contracts

~~~ts
validateDocument(raw: unknown): ValidationResult<EffectDocumentV2>
compileEffect(doc: EffectDocumentV2, registry: NodeRegistry,
  assets: AssetMetadataIndex): CompileResult
createRuntime(effect: CompiledEffect): Runtime
runtime.seekTick(tick: number): SimulationSnapshot
runtime.advanceToTick(tick: number): SimulationSnapshot
runtime.renderSample(alpha: number): FramePacket
renderFrame(packet: FramePacket, view: PreviewSettings): void
renderAudio(effect: CompiledEffect, assets: DecodedAudioIndex,
  sampleRate: number): Promise<RenderedAudio>
exportBundle(doc: EffectDocumentV2, assets: AssetStore): Promise<Blob>
importBundle(file: Blob): Promise<StagedImport>
~~~

CompileResult is either a compiled plan with warnings/costs or structured errors with node/port/field locations. Validation does not mutate input. Warnings cannot secretly substitute invalid required assets.

Worker requests carry documentRevision, runtimeGeneration and requestId. Responses with superseded values are discarded. Transfer frame buffers through a three-buffer pool, return them explicitly, and never transfer an ArrayBuffer still owned by the renderer. Worker failure stops playback with a recoverable error; keep document editing and export available.

## State ownership

Document owns authored graph, controls, timing, assets and seed. Runtime owns generated state/caches. UI owns selection, pan/zoom, open group and unsaved drafts. Preview owns camera, floor, resolution and global enhancement switches. Library owns reusable immutable group templates; document instances are embedded copies.

Editor panel movement, camera orbit and node selection do not recompile or reset simulation. Changes commit through commands, get revision IDs, autosave, and invalidate only affected compiled systems where possible. Correct full recompilation is the initial implementation; incremental reuse follows measured need.

## Dependency direction and enforcement

Model → nothing environment-specific. Graph → model/math. Runtime → compiled contracts/math. Renderer/audio/editor → the contracts they consume. Node registries declare dependencies through descriptions, never access React state or an active viewport. Add an import-boundary test. Keep Three.js and DOM globals out of saved files and pure tests.

## Engine future

Adapters will consume the versioned document or compiled semantic plan, with explicit capabilities and public controls. There is no universal shader bytecode in this design. Material behavior and optional presentation carry fallback descriptions; exporter correctness remains a future measured gate.

