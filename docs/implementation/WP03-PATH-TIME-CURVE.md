# Generic effect-time path reveal slice

`EffectTimeCurve@1` is a reusable graph node with one authored `effectSeconds` curve and a normalized `scalarSignal` output. `src/runtime/curves.ts` evaluates linear or hold keys, using the first/last key beyond the authored range. Invalid keys, nonfinite values and y outside `[0,1]` are errors. The driver is deterministic for a document and tick.

`src/graph/toPaths.ts` accepts this signal into `RevealPath.fraction` and samples it at `effectTick / 60`. A disabled curve node falls back to the RevealPath literal fraction. All other path parameters still reject driven values, and invalid connections return addressed diagnostics. This is a narrow first use of the existing graph signal/domain model, not a general expression runtime.

L01 uses one curve with keys `(24/60,0)` and `(26/60,1)` to drive three RevealPath nodes, one each for trunk, primary branches and secondary forks. Seven separate ribbon layers share a Schedule visibility window `[24,63)`. The impact sparks begin at tick 26, when the strike reaches the target, and end at tick 38. This avoids showing a detached target burst while the bolt is only halfway revealed. The graph remains editable; no lightning-specific branch was added to the compiler.

Validation: `tests/v2-effect-time-curve.test.ts` and `tests/v2-lightning-fixture.test.ts` cover curve evaluation, graph wiring, 24/25/26 geometry and window boundaries. At this checkpoint the full 404-test suite and TypeScript check pass. The in-app browser showed the tick-25 partial bolt without the early impact; full-width whole-cycle visual acceptance is still pending.

Next generic capabilities for the L01 benchmark: visible charge core/halo and motes, animated strength/width, moving source/impact sparks, ring/light preview, and synchronized sound. Mixed point and ribbon preview is currently rejected, so a charge built from point sprites also needs a combined preview path or a ribbon-only prototype.
