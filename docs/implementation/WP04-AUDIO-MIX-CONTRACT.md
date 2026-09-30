# WP04 AudioMix graph contract (accepted; phase 1 implemented)

Status: accepted. Phase 1 (edge metadata, document validation, canonical form) is implemented in `src/model/types.ts`, `src/model/document.ts`, `src/model/canonical.ts` and `tests/v2-edge-mix.test.ts` [UNVERIFIED until the manager runs the tests]. Registry metadata, group expansion, compiler lowering, inspector and export (§3 registry block, §6–§9) are later phases and are not implemented.

Sources: plan11 (AudioMix row, equal-power pan, no per-layer normalization), plan04 (EdgeDefinition, canonical serialization, "Edges with multi-input ordering sort by order then edge ID"), plan25 (`AudioMix | in: audio many ordered; out: audio`, group control storage), plan24 Amendment A3, `src/model/types.ts:178-183`, `src/audio/mix.ts:20,58-80`, `src/graph/expand.ts:41,154-171`, WP04-AUDIO-CORE.md "Audio graph registry staging".

## 1. Problem

AudioMix needs one gain in [0,2] and one pan in [−1,1] per ordered input, plus a master gain in [0,1]. `NodeDefinition.params` is `Record<string, ParameterValue>` keyed by registered parameter IDs, so it cannot hold a variable-length, per-connection list. `EdgeDefinition` has no parameter storage. The stored representation must remain correct through these operations:

- reorder (changing `order`)
- duplicate/paste (new edge IDs)
- deleting an edge or its source
- Group expansion, where one authored edge can resolve to several sources
- canonical hashing
- inspector editing
- engine export

## 2. Options compared

### A. Edge-parameter extension (chosen)
Add optional per-connection values to `EdgeDefinition`. Gain and pan are stored on the edge they describe.

- Reorder: the values move with the edge. `order` stays the only ordering key.
- Duplicate/paste: the values are copied with the edge. ID remapping needs no extra step.
- Delete: the values are removed with the edge. Orphans cannot exist.
- Hash: the values are already inside the sorted edge array, so no new canonical rule is needed.
- Cost: this is a schema change to a core type. Every edge validator must reject the field on non-AudioMix targets.

### B. Node binding table
Store AudioMix entries as `params.inputs = [{edgeId, gain, pan}]`.

- `ParameterValue` has no array-of-records type. That means either adding a new value type or abusing `RegisteredRecordValue`, whose `fields` are schema-named, not edge-keyed.
- There are two sources of truth: edges hold order and the table holds values. Every edge delete, duplicate, paste, regroup or cross-document remap must also rewrite the table. If one misses it, the result is an orphan or a missing entry.
- The only advantage is that the value lives in `params`, which could later make it reachable by `ControlBinding{nodeId, parameter}`. That still wouldn't work without a new path syntax for the entry index.

[PROXY] B needs the same schema-level work (a new value type) plus a referential-integrity obligation across all edit operations. A has neither. A is chosen.

## 3. Exact TS shape (proposed additions to `src/model/types.ts`)

```ts
/** Per-connection mix settings; only valid on an edge whose target is AudioMix port "inputs". */
export type EdgeMixParams = { gain: number; pan: number };
export const DEFAULT_EDGE_MIX: Readonly<EdgeMixParams> = { gain: 1, pan: 0 };

export type EdgeDefinition = {
  id: string;
  source: { nodeId: string; port: string };
  target: { nodeId: string; port: string };
  order: number;
  /** Absent = DEFAULT_EDGE_MIX. Present only when target is AudioMix.inputs. */
  mix?: EdgeMixParams;
};
```

`AudioMix@1` registry metadata:

```ts
{ type: 'AudioMix', definitionVersion: 1,
  inputs:  [{ id: 'inputs', label: 'Inputs', type: 'audio', cardinality: 'many', required: false }],
  outputs: [{ id: 'audio',  label: 'Audio',  type: 'audio', cardinality: 'one',  required: false }],
  parameters: [param({ id: 'masterGain', label: 'Master gain', type: 'number', unit: 'linearGain',
    default: 1, min: 0, max: 1, step: 0.01, editPolicy: 'live' })],
  disabledBehavior: 'empty', capabilities: [] }
```

- Gain bounds are `MIN_INPUT_GAIN`/`MAX_INPUT_GAIN` (0..2) from `mix.ts`. Pan bounds are −1..1. Both are closed intervals and must be finite.
- If the node is disabled, it contributes nothing (`empty`). Bypass is not chosen because it would be ambiguous with many inputs.
- Zero inputs is valid and produces silence with 0 frames, matching `mixStereo([])`.

## 4. Canonical form and hashing

- Semantic canonical serialization used for hashing omits `mix` when it deep-equals `DEFAULT_EDGE_MIX`; ordinary canonical JSON preserves the authored field. It emits `mix` with sorted keys `{gain, pan}` otherwise. So `{gain:1,pan:0}` and an absent `mix` hash identically. Both spellings are accepted on import. The editor writes the omitted form.
- `-0` is canonicalized to `0` before comparing and emitting.
- Numbers are serialized exactly as stored. No rounding happens at hash time; the UI step (0.01) is a UI concern only.
- The edge sort (order, then ID) is unchanged. Reordering changes `order` and therefore the hash. That is correct because mix order is semantic: float64 summation order is fixed by A3.
- Audio cache key: the `mix` values and `masterGain` are audio-relevant. Visual-only edits must not change them.

## 5. Validation (WP01b document validator and WP02 analysis)

| Condition | Code | fieldPath | Severity |
| --- | --- | --- | --- |
| `mix` is not a plain object, has extra keys, or is missing gain/pan | INVALID_VALUE | `graphs[g].edges[e].mix` | error |
| gain is nonfinite or outside [0,2] | INVALID_VALUE | `…edges[e].mix.gain` | error |
| pan is nonfinite or outside [−1,1] | INVALID_VALUE | `…edges[e].mix.pan` | error |
| `mix` is present on an edge whose target is not AudioMix `inputs` (including GroupOutput or bridge edges) | INVALID_VALUE | `…edges[e].mix` | error |
| masterGain is outside [0,1] | INVALID_VALUE (existing param check) | `…nodes[n].params.masterGain` | error |
| Expanded AudioMix input count > `MAX_MIX_INPUTS` (64) | BUDGET_EXCEEDED | AudioMix node | error |

Validation rules:

- Invalid imported values are rejected with a path and are never clamped (plan04).
- Duplicate `order` values on the same target are legal. The edge ID breaks the tie, as the plan already specifies.

## 6. Group expansion

- The per-input values belong to the authored edge whose target is AudioMix. In `ExpandedConnection`, that edge is `sourceEdgeIds[0]` (`expand.ts:238`).
- If that edge comes from a GroupOutput `many` port that resolves to k sources, the edge's gain and pan apply to each of the k traces. The traces keep the existing expanded order (`orderPath`, then `sourceEdgeIds`).
- Internal edges crossing the group boundary cannot carry `mix`, because of the §5 target rule. So a gain inside a group never multiplies with the gain outside it, and the chain has no hidden compounding. Per-layer level inside a group is authored on `AudioSource.gain` or on an internal AudioMix.
- Nested AudioMix nodes are allowed. Decided (Q2): an inner AudioMix whose output feeds another AudioMix is lowered as a sub-sum *without* its own limiter, with its masterGain applied as a multiplier on that sub-sum. Exactly ONE limiter runs, at the final mix feeding the effect's audio output. This is implemented by a future compiler phase, not phase 1.
- Budget: expanded inputs across the whole flattened mix tree count against the 64-voice and 4.8M-sample caps. These are checked before any buffer is allocated.

## 7. Compiler lowering

For each expanded connection into AudioMix, the compiler emits a `MixInput{startSample, samples, gain: edge.mix?.gain ?? 1, pan: edge.mix?.pan ?? 0}` in expanded order. It then calls `mixStereo(inputs, masterGain)`. Gain and pan are literal-only in v1: the edge is not a port, so no connection or control can drive it.

## 8. Inspector editing

- The AudioMix inspector lists its incoming edges in canonical order. Each row shows the source label, a gain slider (0–2, step .01), a pan slider (−1..1, step .01, with a centre detent), and up/down buttons that rewrite `order` as dense integers 0..n−1.
- One history entry covers each commit. Numeric drafts are transient, and only valid values are written (plan04).
- Selecting an edge on the canvas shows the same two fields.
- Edits are `live`: they re-render audio only and do not resimulate visuals.
- A disconnect deletes the values with the edge. Undo restores them.

## 9. Engine export

- Export carries `mix` exactly as stored in the canonical document, so absent means the default.
- Flattened engine plans resolve the defaults and emit explicit per-input `{gain, pan}` in expanded order, plus `masterGain`.
- The WAV path is unchanged: it uses the same `mixStereo`.

## 10. Version and migration

- `mix` is an additive optional field, and absence equals the default. Existing documents are therefore unchanged byte-for-byte in canonical form, and their hashes are stable.
- `SCHEMA_VERSION` stays 2: v2 is pre-release, so the optional field needs no migration (Q1 decided).
- A reader without this contract must reject documents containing `mix` as INVALID_VALUE rather than silently dropping it.
- `AudioMix` starts at `definitionVersion: 1`. Any change to the defaults, the ranges, the nested-limiter rule or the A3 algorithm requires a definition version bump and an A3 amendment.

## 11. Conformance tests (native node:test, node:assert/strict)

1. Canonical hash: an edge with `mix` absent equals `{gain:1,pan:0}` equals `{pan:0,gain:1}`, and `pan:-0` equals `pan:0`. `{gain:1.5,pan:0}` differs.
2. Reorder: swapping `order` on two mix edges changes the hash and swaps the mixStereo input order. The gains follow their edges.
3. Duplicate/paste with remapped IDs: the values are preserved. Delete: no residual data remains anywhere in the document.
4. Validation: gain −0.01, 2.01, NaN and Infinity; pan ±1.01; extra key; `mix` on an AudioOutput edge; `mix` on an internal edge into GroupOutput. Each gives the exact code and fieldPath. Boundaries 0, 2, −1 and 1 are accepted.
5. Group: one outer edge with `{gain:.5,pan:-1}` fed by a GroupOutput resolving to two sources applies to both. The left-only output is bit-silent on the right.
6. Budget: 65 expanded inputs gives BUDGET_EXCEEDED before any allocation (use a spy or zero-length check).
7. Golden: two known voices with gains and pans produce output identical to a direct `mixStereo` call with the same `MixInput`s.
8. Disabled AudioMix gives an empty contribution. Zero inputs gives a 0-frame result.
9. Non-audio edits (visual colour) leave the audio cache key unchanged. Mix edits change it.

## 12. Open questions

- Q1 (decided): `schemaVersion` 2 is pre-release and mutable. Adding optional `edge.mix` is backward-compatible; absent and `{gain:1,pan:0}` canonicalize identically, so existing documents and hashes are unchanged.
- Q2 (decided): single final limiter. Nested AudioMix nodes apply their masterGain within sub-sums, and only the final output mix runs the limiter (§6). The nested compiler is not yet implemented.
- Q3: Should per-input gain be bindable by public controls? `ControlBinding{nodeId, parameter}` cannot address an edge. A future `ControlBinding.edgeId?` would be additive. It is excluded from v1.
- Q4: Stereo sample sources (plan11 "stereo samples retain channels") need a stereo `MixInput`. For stereo inputs, pan semantics (balance versus equal-power) are unspecified. This contract covers mono inputs only.
