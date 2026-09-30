I've finished the static review of both files, the adapter contract and the analysis and registry rules they rely on. Here is the verdict.

## Summary

**Prior particle findings: all four are fixed** [PROXY]
- **Sparse arrays:** `isVec3` now checks each index with `i in v` (`src/runtime/particles.ts:120-124`). Bursts (`:191`) and operators (`:249`) now report holes as errors instead of skipping them.
- **Empty burst key vs rate:** the empty key is kept for rate births (`RATE_EVENT_RANDOM_KEY`, `:19`), and a burst using it is rejected (`:198`).
- **Stable burst IDs:** `burstParticleId` builds the ID from the emitter ID, the JSON-quoted event key and the ordinal (`:25-27`, used at `:421`). It no longer depends on the burst's sorted position, so inserting an earlier event doesn't renumber later ones. `burstIndex` is now only metadata.
- **Immutable limits:** `this.limits` is frozen (`:318`), and the validated descriptor is deep-frozen (`:282`).

**Adapter (`src/graph/toParticles.ts`)** [PROXY]
- **Deterministic schedule:** event keys use `scheduleEventRandomKey(stream, tick, k)`. Events at or after the document end are dropped (`:205`). Duplicate events are reported as `DUPLICATE_ID` (`:207`). Bursts are then sorted by (tick, key) in the runtime.
- **Root transforms:** position and velocity are rotated and scaled once, and position is also translated once (`:225-238`). Size is multiplied by the scalar scale (`:242`). `Transform.scale` is a number (`src/model/types.ts:130`), so non-uniform scale can't be expressed.
- **Disabled nodes:**
  - A disabled renderer is skipped (`:257`).
  - A disabled InitialProperties is bypassed (`:134`).
  - A disabled Emitter produces no layer (`:142`).
  - A disabled Schedule produces no events or window (`:157`).
  - A disabled Material or Anchor raises a missing-required-input error (`:183`, `:267`).
- **Shared systems:** a system's ID is the last enabled node in its chain. It is compiled once (`:275`), and the budget counts it once.
- **Budgets:** the combined worst case for total births and peak live particles is checked against the plan15 caps (`:310-338`). The runtime also checks each emitter separately and fails loudly when a limit is hit, never silently dropping particles.
- **Other cases:**
  - A zero direction, a nonzero rate with no window, and an emitter with neither trigger nor window are all caught earlier by `analyze.ts:311-333`.
  - Connected parameters, exposed controls and root audio/presentation connections all return errors that name the node.

## Findings (not blocking)
1. `toParticles.ts:216`: if more than one window is connected, the rate is silently dropped. The registry's `window` port looks like a single-input port (`src/graph/registry.ts:74`), so analysis should already reject this. That is [UNVERIFIED] until a test shows it.
2. Two chains that end at different InitialProperties but share the same Emitter get the same `emitterId`/`randomStreamId`. Their particle IDs and random values are therefore identical across the two systems. The adapter's own comments say this is intended, but the renderer must not key particles by ID across systems.
3. I didn't read the three test files in detail. I'm relying on the manager's report that all 210 tests pass and TypeScript exits 0; I did not observe that run myself.

## Files changed
None (read-only review).

## Checks the manager should run
- `node --test tests/v2-particles.test.ts tests/v2-to-particles.test.ts tests/v2-expand.test.ts`
- The TypeScript check (`tsc --noEmit`)
- Optionally, add a test that connects two windows to one Emitter and confirm analysis rejects it (finding 1).

## Remaining limitations
- There is no visual evidence yet ([SAW] is not claimed).
- The preview only supports point emitters in world space, with gravity/drag operators, no rotation, and a single window.
- Passing this static review is [PROXY], not visual acceptance.

VERDICT: PASS. All four prior particle findings are fixed, and the adapter meets the WP03 contract on schedule determinism, root transforms, disabled nodes, shared systems and budgets. The two non-blocking notes above remain.
