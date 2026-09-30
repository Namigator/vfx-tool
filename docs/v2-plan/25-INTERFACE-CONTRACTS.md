# Interface details for implementation

This supplement is normative with the format, node catalog and graph semantics. It closes representation decisions so the UI, compiler and runtime can be implemented separately without divergent assumptions.

## Public parameters and layout

~~~ts
type EvaluationDomain = "constant" | "effectTime" | "normalizedAge" | "pathU";
type EditPolicy = "live" | "resample";
type PublicControl = {
  id: string; scopeGraphId: string; label: string; type: ValueType; unit: Unit;
  value: ParameterValue; default: ParameterValue;
  min?: number; max?: number; step?: number; choices?: string[];
  section: string; description: string; editPolicy: EditPolicy;
  bindings: { nodeId: string; parameter: string; scale?: number; offset?: number }[];
};
type PortSpec = {
  id: string; label: string; type: PortType; unit?: Unit;
  domains?: EvaluationDomain[]; cardinality: "one" | "many";
  required: boolean; defaultValue?: ParameterValue;
};
type ParameterSpec = {
  id: string; label: string; type: ValueType; unit: Unit;
  default: ParameterValue; min?: number; max?: number; step?: number;
  choices?: string[]; domains: EvaluationDomain[];
  editPolicy: EditPolicy; description: string;
};
type NodeSpec = {
  type: string; definitionVersion: number;
  inputs: PortSpec[]; outputs: PortSpec[]; parameters: ParameterSpec[];
  disabledBehavior: "empty" | "bypass" | "fallback" | "protected";
  capabilities: CapabilityRequirement[];
};
~~~

ValueType is boolean/number/integer/color/vec2/vec3/quaternion/enum/string/asset/curve/gradient/registeredRecord. PortType is the catalog's connection vocabulary; registered records are not arbitrary object ports. Unit is none, meter, second, tick, radian, metersPerSecond, metersPerSecondSquared, hertz, perSecond, linearGain or normalized. A color value is {srgb:"#RRGGBB",alpha:0..1}; legacy plain hex converts explicitly.

InterfacePort uses the same port shape plus direction input/output. GroupInput.params.portId and GroupOutput.params.portId identify the interface, not a display label. Root graph has no external interface; it uses Anchor/PublicParameter nodes and one EffectOutput.

EditorLayout = {graphs: Record<graphId,{nodes:Record<nodeId,{x,y}>,viewport:{x,y,zoom}}>, openedGraphId:string}. Saved layout numbers are finite, zoom .1–4. Selection and numeric drafts remain transient. Audit metadata lives in storage records, not the semantic hash.

## Group control storage

EffectDocumentV2.controls contains all controls, including internal group controls; scopeGraphId identifies their owning embedded graph. IDs remain globally unique. Root controls have scopeGraphId=rootGraphId. A PublicParameter node can read only controls in its own graph.

For a Group referencing graph G, controls scoped to G become its exposed parameter ports. Each such port uses control.id as the parameter key and control.value as its stored literal. Group.params stores graphId, not a second copy of control values. Editing the Group inspector writes the corresponding control.value. A parent control/edge may drive that exposed Group parameter; compiler passes the resolved override into the child graph, taking precedence over that child control's stored value. Internal node bindings then resolve normally.

This permits parent→group→internal bindings without two writable sources of truth. Child controls cannot bind outside their graph. Undo operates on one authoritative value. Group library insertion copies its scoped controls and remaps scope/node/control IDs together.

## Node port naming and common rules

Identifiers are stable lowerCamelCase. Parameter-driven input ports have the same ID as their parameter. A connection overrides that literal/control value. Required structured ports:

| Node category | Named ports |
| --- | --- |
| Anchor | out: anchor |
| OffsetAnchor | in: anchor; out: anchor |
| Schedule | out: start(event), end(event), window(timeWindow) |
| EventDelay/MergeEvents | in: events; out: events |
| Line/Bezier/Helix path | in: start,end anchors; out: paths |
| RadialPath | in: center anchor, window optional; out: paths |
| Jagged/Reveal/Transform path | in: paths; out: paths |
| BranchPath | in: paths; out: trunk,branches |
| PathFollower | in: paths,window; out: anchor,arrival |
| ParticlePaths | in: particles,anchor; out: paths |
| Emitter | in: anchor optional,paths optional,trigger optional,window optional,aim optional; out: particles |
| Particle modifiers | in: particles; out: particles |
| Attract/Vortex | also in: target anchor |
| GroundCollision | also out: collisions |
| ParticleEvents | in: particles; out: births,deaths |
| Material | out: material |
| Billboard/Mesh/ParticleTrail | in: particles; material; out: visual |
| Anchored MeshRenderer | in: anchor instead of particles, plus window; out: visual |
| RibbonRenderer | in: paths,material,window; out: visual |
| MotionTrail | in: anchor,material,window; out: visual |
| Ring/Sprite/PointLight | in: anchor,window; material for ring/sprite; out: visual |
| AudioSource | in: trigger or window; out: audio |
| AudioEnvelope/Filter | in: audio; out: audio |
| AudioMix | in: audio many ordered; out: audio |
| AudioOutput | in: audio; out: audio |
| ScreenFlash/CameraImpulse | in: trigger; out: presentation |
| EffectOutput | in: visual/audio/presentation, each many ordered |

Emitter requires exactly one position source: anchor or paths, unless every trigger supplies position and useEventPosition is enabled. Continuous rate requires a window. Burst requires a trigger; supplying both is allowed and intentionally produces burst plus continuous emission. An emitter with neither is an incomplete reachable node. World origin is an explicit Anchor choice, not an invisible fallback.

MeshRenderer requires exactly one of particles/anchor. Ring/Sprite/Ribbon window can use an explicit default whole-document window; renderer help shows that default. Attract and Vortex default target to the selected document target through an explicit Anchor connection in inserted components.

ParticlePaths constructs paths from an anchor to selected current particle positions, maxCount 4 [1,128], selection by stable particle ID, optional direction anchorToParticle/particleToAnchor. This is needed for editable charge tethers. It cannot feed motion of its own source system because that would form a dependency cycle.

## Compiled descriptors and frame packets

CompiledEffect contains semanticHash, durationTicks, registryVersions, systems, paths, renderLayers, materialRecipes, audioLayers, presentationLayers, eventDependencies, publicControls, capabilities and budgetEstimate. Descriptors contain sourceNodeIds for diagnostics. Numeric signals compile to a bounded expression tree of registered operations; no eval/code generation from strings.

SimulationSnapshot includes tick, system states, emission counters, pending future events and trail history. RenderPacket contains generation, revision, tick0/tick1, interpolation alpha, bounds and typed-array batches:
- particles: position, previousPosition, size/scale, rotation, age, lifetime, color, alpha, frame index and stable ID;
- paths: stable path IDs, offsets into point arrays, widths/opacity scales;
- meshes: transforms, geometry/material IDs, per-instance color/alpha;
- lights and presentation: small bounded records.

Arrays use Float32 for renderer-bound geometry, Uint32 for IDs/counts and Float64 for canonical simulation integrator state. Material/asset IDs use per-plan numeric lookup tables. Renderer is forbidden to mutate canonical snapshots. Birth/death flags prevent interpolating a particle into existence before its birth tick or keeping it past its death.

## Worker protocol

Requests: compile revision, loadPlan generation, advanceToTick, seekTick, cancel request, returnBuffers and dispose. Responses: diagnostics, planReady, frame, progress, error and disposed. Each carries requestId/revision/generation. Only the latest generation can update the renderer/audio cache. Structured errors include code, message, nodeId?, fieldPath?, recoverable and cause summary with no asset binary dump.

The app supplies assets through explicit byte/decoded-data messages. Worker may not fetch remote resources. Disposing cancels pending requests, releases transfer pools and acknowledges before termination where possible; timeout 500 ms then terminate.

## Validation results and error codes

ValidationResult<T> = {ok:true,value:T,warnings:Diagnostic[]} or {ok:false,errors:Diagnostic[],recoverableRaw?:unknown}.
CompileResult uses the same shape with CompiledEffect.

Stable error codes: UNSUPPORTED_VERSION, UNKNOWN_NODE, INVALID_VALUE, DUPLICATE_ID, MISSING_REFERENCE, MISSING_ASSET, TYPE_MISMATCH, DOMAIN_MISMATCH, MULTIPLE_DRIVERS, GRAPH_CYCLE, GROUP_RECURSION, BUDGET_EXCEEDED, IMPORT_LIMIT, CHECKSUM_MISMATCH, STORAGE_CONFLICT, STORAGE_QUOTA, WORKER_FAILURE and RENDERER_UNAVAILABLE.

Messages are user-facing and actionable; code and location support tests. Do not expose stack traces as the only explanation.

## Preview invalidation

live means update appearance/audio gain or resample signals at current time without changing particle identities. resample means rebuild affected simulation from tick 0/checkpoint; when playing restart at tick 0, when paused retain requested tick. Changes to timing invalidate audio cue scheduling. Material structure changes pause until shader variant readiness; retain last valid image visibly marked Preparing material.

Source/target movement is resample. Root transform changes are live only when no world-ground collision system is active; otherwise resample. Camera/quality/layout edits never modify semantic hash.

