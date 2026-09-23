# Versioned document and parameter contract

## Root contract

See [interface details](25-INTERFACE-CONTRACTS.md) for complete PublicControl/port shapes and [algorithms](24-ALGORITHMS.md) for supplementary node definitions.

Use schemaVersion 2 and runtimeVersion "2.0.0". Each node has its own integer definitionVersion, initially 1. Different semantic behavior requires a version/migration, not silent reinterpretation. TypeScript types and runtime validation implement this contract; saved files contain plain JSON only.

~~~ts
type EffectDocumentV2 = {
  format: "vfx-studio";
  schemaVersion: 2;
  runtimeVersion: "2.0.0";
  id: string;
  name: string;
  tags: string[];
  seed: number;
  rootTransform: Transform;
  anchors: AnchorDefinition[];
  durationTicks: number;
  rootGraphId: string;
  graphs: GraphDefinition[];
  controls: PublicControl[];
  assets: AssetReference[];
  editor: EditorLayout;
};
type GraphDefinition = {
  id: string;
  inputs: InterfacePort[];
  outputs: InterfacePort[];
  nodes: NodeDefinition[];
  edges: EdgeDefinition[];
};
type NodeDefinition = {
  id: string;
  type: string;
  definitionVersion: number;
  label: string;
  enabled: boolean;
  randomStreamId: string;
  params: Record<string, ParameterValue>;
};
type EdgeDefinition = {
  id: string;
  source: { nodeId: string; port: string };
  target: { nodeId: string; port: string };
  order: number;
};
~~~

A Group node adds graphId inside params; graph input/output bridge nodes map declared interface ports by ID. All graph definitions required by the root are embedded. Definitions cannot recursively reference themselves. Node IDs are globally unique within one document. Instantiated groups are embedded instance graphs, not shared mutable definitions.

IDs: 1–64 ASCII letters/digits/underscore/hyphen; avoid labels as identity. New IDs use a type prefix plus crypto.randomUUID(). Random stream IDs obey the same rule but are independent of labels, positions and group paths. Duplicate creates new IDs and independent streams. Cut/paste and regrouping preserve original IDs/streams within the document. Across documents, remap object IDs while preserving randomStreamId values when copying the same pattern. Random stream IDs are allowed to repeat only for an explicit Preserve pattern operation; object IDs remain unique.

## Coordinate and timing conventions

Right-handed coordinates, Y up; meters, seconds, radians, meters/second and meters/second squared. Editor may display angles in degrees; saved values remain radians. Colors are sRGB hex plus separate alpha, converted to linear for shading and gradient interpolation.

Transform = position vec3, rotation quaternion xyzw, positive uniform scale. No negative/nonuniform root scale in v2. Anchor definitions contain id, name and effect-local position; all positions are transformed by the root transform. Source and target always exist and may coincide. Beam local X points source→target; construct a stable perpendicular frame, using Z as the reference up when parallel to Y.

Fixed simulation tick is 1/60 second. Authoring time inputs convert to nearest tick via floor(seconds*60+0.5), show the resolved value, and store integer ticks. Duration: 1–600 ticks. Event windows are start-inclusive/end-exclusive. Lifetime end is exclusive. At durationTicks all outputs and sound are zero.

## Parameter definitions and values

Every registered node declares keys, type, literal default, valid range/choices, units, help, evaluation domain and edit policy. ParameterValue supports boolean, finite number, string enum, color, vec2, vec3, quaternion, asset ID, curve, gradient and structured registered settings. No function, expression string, HTML or shader source.

Scalar signals carry domain: constant, effectTime, normalizedAge or pathU. Inputs explicitly list allowed domains. A constant may feed any allowed signal input. Never implicitly reinterpret seconds as normalized age or degrees as radians.

Curves: ordered unique keys x/y, 2–16 keys, domain explicitly [0,1] or effect seconds, linear or hold interpolation. End values clamp beyond the key domain. No cubic interpolation/overshoot in v2. Gradients: 2–8 stops in [0,1], sorted unique positions, colors interpolated in linear RGB and alpha linearly. Endpoints are required; UI inserts them when editing, importer rejects missing ones.

Integer count/rate limits come from the node catalog and global budget. UI may permit intermediate drafts but only valid values enter the document. Import errors name exact paths. Do not silently clamp invalid imported values.

## Public controls and macro binding

A PublicControl has stable id, scopeGraphId, label, type, unit, authored value, default, range/choices, section, description and an ordered array of bindings to nodeId/parameter keys. Numeric bindings support only explicit affine mapping: target = source*scale+offset. Types/units must be declared compatible. One target may have one control owner; ownership conflicts are errors.

Value precedence: connected port → bound public control → node literal. Show driven fields read-only with a Jump to driver action. Disconnect retains the stored literal. In Simple mode changing a control updates its authored value, not every bound literal. Advanced users can remove the binding and edit independently.

Runtime-adjustable is metadata, not a promise of engine support. Mark appearance/gain inputs live; counts, shapes, forces, seeds, materials requiring compilation and timings restart/resample. Edits while paused resimulate the same tick. Playing restarts when any affected field requires it.

## Assets and UI data

AssetReference records content hash, kind, MIME, byte size, local bundle path or builtin ID/version, dimensions/duration where relevant, color-space role, provenance and license. Document contains references, not image data. Bundles carry actual bytes.

EditorLayout stores node positions per graph, group breadcrumb, inspector sections and library display metadata. Selection, transient numeric drafts, Solo, camera and quality profile are session preferences, not semantic recipe data. Layout does not influence compilation, RNG or content hashes used for simulation.

Canonical semantic serialization excludes editor layout and audit timestamps, sorts object keys and unordered definitions by ID, and preserves ordered arrays such as material operations. Edges with multi-input ordering sort by order then edge ID. SHA-256 over UTF-8 canonical data identifies compiled content. Assets identify their exact bytes by SHA-256.

## Validation and compatibility

Validate version, size/depth limits, IDs/references, types, ranges, graph cycles, group recursion, asset availability, node capabilities and bounded expansion before compiling. Unknown node types/versions keep their raw records in read-only recovery mode; do not delete them or execute them. Recognized documents with missing assets can be edited and saved as drafts, but playback and portable export remain blocked until references resolve. Legacy handling is defined separately.

