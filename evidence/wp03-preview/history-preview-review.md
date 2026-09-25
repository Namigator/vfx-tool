**Summary:** I found no blocking defects in the history or the preview viewport. Everything below is static review only [PROXY]. I did not run tests, a build or a browser, and nothing here counts as browser or visual verification. I read the test file line by line this time.

## History (`src/editor/history.ts`, `tests/v2-history.test.ts`)
- **Spec match** [PROXY]: It matches `docs/v2-plan/12-EDITOR.md:46`. Edits are recorded as forward/inverse patches with no full-document snapshots, and they're grouped in transactions that need an ID. The limit is 100 transactions or 20 MiB, and the oldest entries are dropped first (`:310-313`). No-op and net no-op commits keep the redo stack (`:289`). Redo is cleared only by a real edit (`:294-295`). Edits under `editor` count as layout-only.
- **Edits and aliasing** [PROXY]: Incoming patches and values are deep-copied (`ownPatch` `:91`), and they are copied again when applied (`:148,159,173`). Inverse values are pieces already cut out of the document, so they aren't shared with it. `snapshot()` returns a copy. A batch applies fully or not at all: on failure, the inverses run in reverse order (`:184`).
- **Security** [PROXY]: `__proto__`, `constructor` and `prototype` are rejected in paths (`:99`) and in values (`:82`). New keys are added with `defineProperty`, so they are plain own properties (`:173`). NaN, `undefined`, Date and similar values are rejected by `canonicalJson`. Object/array type mismatches and sparse array writes are rejected. The tests check that nothing leaks onto `Object.prototype` (`test:90`).
- **Byte budget** [PROXY]: `#bytes` counts both the undo and redo stacks, and the redo bytes are subtracted when redo is cleared. An oversized edit is still applied, but it clears the undo history and returns a notice.
- **Tests** [PROXY]: They cover cloning, keys that are absent versus present, the order of dependent inverses, all-or-nothing batches (14 bad cases), `toString` as an own key, grouping, nesting and undo being blocked while a transaction is active, cancel, no-op and redo behaviour, layout versus semantic changes, the transaction cap and the byte budget.

Minor issues, not blockers:
- H1 `:278`: `cancel()` reports `changed` based on the forward patches, even though the document ends up as it was at `begin()`. Callers need to understand this. It probably does help with preview invalidation.
- H2: Transaction IDs aren't checked for uniqueness. The spec only requires that they're present.
- H3: Memory inside an active transaction has no limit until commit. A very long drag only hits the size check at commit.
- H4 `test:193-199`: The byte-budget test relies on the first entry being about 4 MiB and the next two about 8 MiB. It passes, but a small change could break it.
- Test gaps: nothing tests a failed `apply` followed by a valid `apply` and a commit in the same transaction. Nothing tests the undo and redo byte accounting after the redo stack is dropped.

## Preview (`src/render/PreviewViewport.ts`)
- **Fixed tick and scrub** [PROXY]: The clock and every simulation use the same `durationTicks` (`toParticles.ts:234`), so scrubbing (`:284`) and playback (`:297`) stop at the same tick. Seek rounds and clamps the tick, then replays from tick 0 and ends paused. Each frame's time step is capped at 0.25 s.
- **Lifecycle** [PROXY]: If the constructor fails partway, everything created so far is released. `dispose()` is guarded against running twice and cleans up everything the viewport creates (listener, animation frame, observer, controls, meshes, materials, geometry, renderer and canvas), and the shared quad is freed once. Visibility, resize and the frame loop all check whether the viewport was disposed. After a failure, `play()` does nothing, and `restart()` retries.

Minor issues, not blockers:
- P1 `:376-378`: If `onError` or `onFrame` calls `dispose()` while a frame is running, the loop still calls `controls.update()` and `renderer.render()` on the disposed objects. Adding `if (this.#disposed) return;` after `#emitFrame(false)` would fix this.
- P2 `:164-168`: If `new PlaybackClock` throws on an invalid `durationTicks`, the layers are cleared and the new plan is stored but the old clock stays. Compiled plans are already validated, so this is a small risk.
- P3 `:306`: `sim.snapshot()` allocates new arrays on every tick. That goes against the header comment saying per-frame work only writes into existing buffers.
- P4 `:333-335`: Between ticks, positions are extrapolated from velocity only, ignoring forces such as gravity or drag. This is a visual approximation only.
- P5: Every seek replays up to 600 ticks with up to 8192 particles. The cost is bounded, but dragging the scrubber may be slow.

**Changed files:** none (read-only review).

**Checks for the manager to run:** `node --test tests/v2-history.test.ts`, the full test suite and `tsc --noEmit`. Separately, the preview needs someone to check it in a real browser: scrubbing, play/pause at the end, hiding the tab, and running `dispose()` from inside a callback.

**Remaining limitations:** Nothing in `PreviewViewport` is covered by automated tests, and I have not checked WebGL behaviour or the visual output.

VERDICT: PASS [PROXY]. I found no problems with how edits are applied, undo, redo, the byte budget or security, and the renderer's lifecycle, disposal, scrubbing and fixed tick look sound. P1 is worth fixing next, but it doesn't block. This is not a visual or browser sign-off.
