# WP01 representation decisions — 2026-09-24

This implementation supplement resolves concrete ambiguities found by the Claude contract review. It is normative for WP01 and supplements the frozen planning snapshot without invalidating its historical integrity manifest. Read alongside plan documents 04, 10, 13, 15, 24 and 25. Scope/product decisions are unchanged.

## Canonical representation

Canonical serialization is a deterministic content/cache identity, not a proof that differently authored documents produce different images. Conservatively include all saved semantic root fields except `editor`; audit timestamps belong to storage records outside the document. Include names, tags, IDs, labels and descriptions. Renaming may invalidate a compiled cache, but never changes random streams: RNG uses the tuple in plan 24, not the content hash.

Sort object keys by JS code-unit lexicographic order (no localeCompare). Sort these definition arrays by id: root graphs, anchors, controls, assets; nodes within each graph. Sort each graph's entire edge array by numeric order, then edge ID, as plan 04 specifies. Target grouping is unnecessary because node/port identity is retained in every edge. Sort root tags by code-unit order. Do not deduplicate invalid inputs.

Preserve all other arrays, including graph inputs/outputs, public-control bindings, enum choices, material operations, curve keys, gradient stops and vector components. Preserve ordered arrays inside registered records. The compiler may choose execution order separately from serialization.

Use compact JSON syntax and ECMAScript JSON.stringify number/string escaping; finite binary64 numbers only, -0 serializes as 0, no whitespace, no Unicode normalization. Reject NaN, infinity, undefined, functions, symbols, sparse arrays, cycles and exotic objects rather than silently dropping/coercing values. For plain JSON, accept Object.prototype or null prototypes. Reject invalid input with a path diagnostic/explicit error; do not mutate input. No arbitrary toJSON callback execution. Absent optional fields stay absent; defaults are NOT materialized during hashing, so omitted scale versus scale:1 can hash differently while resolving equivalently. This is intentional conservative invalidation.

SHA-256 hashes UTF-8 canonical bytes and returns lowercase 64-character hex. Use an injected async digest adapter; a separate native Web Crypto adapter may use globalThis.crypto.subtle in both browser and supported Node. No Node-specific imports in model modules; TextEncoder/Web Crypto are shared runtime APIs, not browser UI dependencies. Native node:crypto in tests may independently check a fixture hash. SHA-256 content identity and FNV-1a random-stream identity are separate.

## Values and parameter metadata

Vectors are fixed tuples; quaternion is xyzw and finite/unit length within 1e-6, rejecting zero-length rather than silently normalizing imports. Root scale is finite and strictly positive; authored zero/negative/nonuniform root scales are invalid. Seed is uint32 (0 through 4294967295); semantic duration 1..600 integer ticks.

Color: `{srgb:"#RRGGBB",alpha:number}`. Accept either case for six hex digits, preserve authored case in canonical JSON. Alpha is [0,1]. Canonical identity may distinguish case-equivalent colors, as with explicitly authored defaults.

Curve: `{domain:"normalized"|"effectSeconds",interpolation:"linear"|"hold",keys:{x:number,y:number}[]}`. Normalized domain is a storage range, mapped to normalizedAge or pathU by parameter metadata/ports. effectSeconds maps to effectTime. The domain is explicit; never infer one from numeric values. Curves require 2..16 finite keys with strictly increasing x. Normalized x is within [0,1]; effectSeconds x is within [0,durationTicks/60] when document context is supplied, and [0,10] as the standalone parameter bound. Curves clamp beyond their first/last key; curve endpoints at the full-domain bounds are not required. Integer ticks apply to discrete schedules/lifetimes, while continuous signal curve x remains seconds. Parameter min/max constrains curve y when provided.

Gradient: `{stops:{position:number,color:ColorValue}[]}` with 2..8 strictly increasing positions within [0,1], first 0 and last 1. Color rules above apply. Numeric min/max for vectors bounds each component; quaternion has its unit-norm rule. `step` is UI stepping metadata, not an implicit rounding rule on imports. Integer type still requires integer values. Enum choices are exact strings.

Registered record: `{recordType:string,fields:Record<string,ParameterValue>}`. ParameterSpec can declare recordType and curveDomain. The caller supplies a registry of named field schemas; unknown record types and unknown/missing fields fail, with no code/eval or permissive arbitrary-object fallback. Applying the full material/audio settings registry is later work. Record-schema functions are application-owned code, never serialized user code.

Diagnostics use dot paths for identifier keys and bracket indices; unusual property keys use bracketed JSON string notation. Preserve exact location in tests. Error code and fieldPath are stable; English prose may improve.

## Ports, controls and IDs

Primitive registry-owned port names are lowerCamelCase. Group exposed-control ports and graph interface bridge references explicitly use stable control/interface IDs and are exempt from that spelling rule. Group.params stores graphId only; dynamic Group controls are held in the controls array. Reserve graphId for the structural reference and reject a child control with id graphId rather than treating it as a second literal.

Object IDs are 1..64 ASCII letters/digits/underscore/hyphen. Document, graph, node, edge, anchor, control and asset object IDs are globally unique within a document. Port IDs are scoped to their node/interface; randomStreamId is separate and may be preserved as specified in plan 04. References may of course equal their target object IDs. No uniqueness condition applies to labels.

PortType vocabulary includes event, timeWindow, anchor, paths, particles, material, visual, audio, presentation, scalarSignal, colorSignal, vec2Signal, vec3Signal, quaternionSignal, booleanSignal and asset. This closes Constant vector/bool and Mesh asset inputs. Domain/unit compatibility and driver precedence remain compiler/next-slice obligations; the type list does not implement them.

## Assets

Asset parameters store an interpretation asset ID, not the original byte hash. Plan 10 already specifies identity from original bytes plus interpretation. Two interpretation IDs can reference identical bytes. Use `sha256` for the original-byte lowercase hex digest. Define interpretation ID as SHA-256 of canonical UTF-8 JSON `{sha256,interpretation}`; no prefix so the 64-character ID limit holds. Store that interpretation record in the reference. Implement ID derivation/verification in WP05; WP01a only locks the shape and hashing of authored references.

AssetReference fields: id, sha256, kind (texture/flipbook/mesh/sound), mime, bytes; source is `{kind:"bundle",path:string}` or `{kind:"builtin",builtinId:string,version:number}`; optional width/height/durationSeconds; colorSpace (color/mask/normal/noise/none); interpretation; provenance; license.

Interpretation is a typed record with kind and colorSpace matching the enclosing reference, optional flipbook `{rows,columns,frameCount,paddingPixels}`, optional mesh `{importScale}`. Omit a kind-specific field for other kinds. Audio source bytes preserve their sample format; the fixed canonical 48kHz decode behavior is runtime-versioned. No additional user decoder program is permitted.

Provenance is `{origin:"authored"|"imported"|"external",originalFilename:string,author?:string,sourceUrl?:string,modificationNotes:string}`; license is `{identifier:string,text?:string}`. Unknown personal-import license uses the explicit identifier `user-provided; license unspecified`. A sourceUrl is provenance text, never permission to fetch. Byte/mesh/texture import checks and builtin resolution remain WP05; no fake asset bytes are introduced in WP01.

## Bounds and deferred validation

Plan 15 already specifies 512 expanded nodes, 1024 expanded edges, group depth 4, 128 asset references; plan 13 gives JSON <=5 MiB/depth<=32. Apply these existing limits, not new conflicting ones.

For stored drafts and pre-expansion protection, also cap graphs at 128, total stored nodes at 512, total stored edges at 1024, controls at 512, anchors at 128, total control bindings at 2048, tags at 32 and interface ports per graph/direction at 128. Cap name/label/section at 128 Unicode code points, descriptions/modificationNotes at 4096, individual tags at 64, paths at 1024; other metadata text remains constrained by the 5 MiB total. Reject rather than truncate. String lengths count Unicode code points. Incomplete draft references may remain recoverable, but cannot become runnable through these limits.

WP01a implements types, supplied-schema parameter checks, canonical serialization/hash and a typed fixture, with real tests. WP01b implements whole-document validation/references, limits, metadata registries and public-control resolution. WP02 implements graph compilation/cycles/expanded budgets. ZIP imports belong to WP08 and asset bytes to WP05. Do not claim a fixture renders until the runtime and renderer exist and are exercised.

## Review response

The initial reviewer read keyword excerpts for some documents. Several reported unknowns were already answered in 10 (interpretation identity), 15 (graph limits), and 24 (uint32 seed/RNG). They remain necessary review inputs. New decisions above cover actual gaps; no demand is made to implement unrelated future packages in WP01a.
