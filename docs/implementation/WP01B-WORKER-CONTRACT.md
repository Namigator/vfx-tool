# WP01b split and interfaces

Continue the accepted WP01a foundation. These tasks are pure modules; no renderer/UI/legacy/dependency edits. Both workers stay Opus5.5 LOW and must read all assigned files. The manager runs tests and owns shared types/fixtures changes. The reviewer is separate and read-only.

## Shared registry contract
Use a caller-supplied `ReadonlyMap<string, NodeSpec>` keyed by `${type}@${definitionVersion}`. Do not invent the entire production node catalog in this slice. Application-owned metadata is trusted, but test registries must use valid defaults. Registered-record schemas are supplied separately through the existing RecordRegistry.

Keep new files independent: document.ts must not import controls.ts and vice versa. Both may import accepted types/values/canonical modules. Do not change those shared modules without reporting the exact proposed diff to the manager. The next compiler consumes these APIs after whole-document validation; neither API compiles graph signals or renders effects.

## Document worker
Own src/model/document.ts and tests/v2-document.test.ts only.

Export validateDocument(input:unknown, options:{registry:ReadonlyMap<string,NodeSpec>, records?:RecordRegistry, availableAssetIds?:ReadonlySet<string>}):ValidationResult<EffectDocumentV2>. Also optionally export parseDocumentJson(text:string, same options), which preflights UTF-8 size before JSON.parse and returns diagnostics rather than throwing on malformed input. Preserve input, do not materialize defaults or strip unknown fields.

Implement strict current-schema field validation for root, transforms, anchors, graphs/nodes/edges, controls/bindings, asset metadata and editor layout using plan04/25 plus the representation supplement. Bound plain JSON depth/bytes first; no accessor/toJSON execution. Versions, seed, duration, IDs/global uniqueness, stored counts/string limits, finite layout and zoom. Require source and target anchor IDs, one root graph with no external interface and exactly one enabled EffectOutput. References are explicit: same-graph edge endpoints, registered ports, control scope and binding node targets, Group.graphId and bridge port references, asset params where metadata says asset. Validate node literals through supplied schemas, accepting missing keys that have declared defaults; unknown keys fail. Group dynamic controls are stored only in controls array, never invented Group.params literals. Group instances must be independent; reject recursive/shared mutable instance references. Missing/unknown versions/nodes/assets are recoverable diagnostics, never silently dropped or executed. availableAssetIds is optional availability input; without it validate asset references, not byte availability.

Bounded group-reference checks may be here; executable edge DAG ordering/type/domain matching/reachability and expanded runtime budgets remain WP02. Current top-level object shapes should reject unknown fields to catch misspellings. Return recoverableRaw only for a recognized, safely traversed, size-bounded JSON document; preserve its exact content. Unknown root schema/runtime versions preserve safe raw data but do not return ok:true.

Error messages must bound quoted user text while fieldPath retains the full location. Unregistered record metadata uses existing validation output for now; canonical preflight depth/size should report IMPORT_LIMIT. Full asset-byte decode/checksum/derived-ID verification remains WP05. Source path metadata cannot trigger filesystem/network work.

## Controls worker
Own src/model/controls.ts and tests/v2-controls.test.ts only.

Implement a pure resolver over an already structurally validated document and supplied registry (still diagnose missing references it relies on). API resolveParameters(doc, registry, options?) returns ValidationResult<ResolvedParameter[]>; use explicit types exported from controls.ts. options supplies records, connections as {nodeId,parameter,value}[] of already-evaluated parameter-port values, and optional controlOverrides as ReadonlyMap<controlId,ParameterValue>. Connection evaluation belongs to WP02; this resolver must not pretend to evaluate time signals.

ResolvedParameter has nodeId, parameter, value, source (connection/control/literal/default with driving controlId where relevant), readOnly and editPolicy. Return deterministic nodeId/parameter order. Deep-clone resolved values so callers cannot mutate document/default/control values through results.

Resolve connected value > bound control value > stored literal > registry default. Detect duplicate connection drivers and duplicate control owners even when a connection masks the conflict. Preserve literal and control values without mutation; removing a connection resumes binding, unbinding resumes the literal. Validate final values against target metadata without clamping. Affine mapping applies only to finite numeric controls; require finite scale/offset, compatible unit, numeric value/type; integer targets require integer result. Number/integer bindings are numerically compatible if final target validation passes; all other types must match exactly. Other value types require identity mapping (no scale/offset).

Control bindings may target only nodes in scopeGraphId; a parent may target its Group node exposed child-control ID, never a child node directly. Reserve Group structural graphId. For Group controls resolve parent connection/binding override > optional explicit controlOverride > stored child-control value; that result feeds child bindings. Reject recursive group/control resolution and multiply-instantiated child graph reuse. Track inherited live/resample policy conservatively: any affected resample target makes the resolved driving control resample; do not mutate metadata. Return errors on missing control scope/target/parameter or invalid group reference. Child controls remain one source of truth. Use existing value validation; for registered-record controls derive recordType from the authored record and registry; curve value domain remains explicit.

Tests: F09 literal 0.4, public value2 mapping*.5+.1 ->1.1, connection3 wins, disconnect1.1, unbind0.4. Test duplicate owners, duplicate connections, invalid affine/ranges/units/types, nonnumeric controls, no mutation/aliasing, nested Group overrides, scope violations, independent group copies, missing refs and resample propagation. No UI read-only widgets yet; return metadata sufficient for them.

## Deferred and acceptance
T01 structural/recovery cases and T05 resolution are the goal of this slice. Complete production registry, typed edge compiler, runtime and visible node editor remain later. Before compiler integration reconcile plan06 meshAsset/textureAsset/audioAsset distinctions with current PortType alias vocabulary; these tasks must not claim generic asset ports prove typed-connection compatibility.

## Review decisions (WP01b)
- Reserve public-control ID graphId in every scope, including root, for one consistent authoring rule.
- Group registry metadata must contain only its structural graphId string parameter; Group literals may contain only graphId even if erroneous trusted metadata lists more. GroupInput/GroupOutput portId is structural: no control bindings or parameter connections may change it. Ordinary nodes may use a portId parameter normally.
- Structural node versions must be registered before document acceptance. The resolver assumes that upstream validation has succeeded; its Group special handling is not standalone registry validation.
- A registered-record control default must match the record type of its authored value.
- Pipeline: parse/validateDocument -> resolveParameters -> compiler. Document structural acceptance alone is not execution eligibility. The resolver owns binding type/unit/affine semantics.
- availableAssetIds means all assets available to the caller, including builtins; the caller must include installed builtins. Omitting the set checks reference integrity only. WP05 builds this availability set and verifies metadata/default asset references.
- Current interface-default typing, production registry, role-specific asset port types, expanded graph checks and full asset handling remain later packages.
