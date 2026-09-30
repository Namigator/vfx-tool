**WP01b corrected slice: acceptance review (read-only)**

Findings F1–F4 from my first review are fixed in the current files, and I found no remaining blockers. This conclusion comes from reading the code [PROXY]. I edited no files and ran no commands. The 108 passing tests and clean TypeScript check are the manager's run; I did not verify them.

**What I read:**
- Every line of `src/model/document.ts` (1–775) and `src/model/controls.ts` (1–352).
- Every line of `tests/v2-integration.test.ts` (1–54).
- Every line of `WP01B-WORKER-CONTRACT.md`, including the Review decisions section.
- Every line of `evidence/wp01b/review-first.md`, my previous report.
- For `tests/v2-document.test.ts` and `tests/v2-controls.test.ts`, only the lines matching a targeted search for `portId`, `graphId` and `recordType`. I did not read them in full.
- None of `types.ts`, `values.ts`, `canonical.ts` or `fixtures.ts` this pass.

**How the earlier findings were fixed [PROXY]:**
- **F1 (`graphId` reserved as a control ID):** both APIs now reserve it in every scope, including the root (`document.ts:660`, `controls.ts:123`). Tests: `v2-document.test.ts:261-263` and `v2-controls.test.ts:185`.
- **F2 (the structural `portId` field could be driven):**
  - `isStructuralParam` now covers `Group.graphId` and `GroupInput`/`GroupOutput.portId` in both files (`document.ts:340`, `controls.ts:25`).
  - Edges into those fields are blocked by `drivableParams` (`document.ts:351-354`), which also returns nothing for Group nodes.
  - Bindings are rejected at `document.ts:721` and `controls.ts:247`, and connections at `controls.ts:280`.
  - An ordinary node with a parameter named `portId` can still be bound or connected.
  - Tests: `v2-document.test.ts:267-284` and `v2-controls.test.ts:211-242`.
- **F3 (record control default of a different type):** the record type is now taken from the authored value and `default` is checked against the same spec (`document.ts:697-701`). Test: `v2-document.test.ts:288-296`.
- **F4 (the two APIs never tested together):**
  - Group literals are now limited to `graphId` in both APIs, even when the registry lists more parameters (`document.ts:346`, `controls.ts:154`). Test: `v2-document.test.ts:306`.
  - The new integration test uses one shared registry. It serializes the fixture, parses it with `parseDocumentJson`, then runs `resolveParameters` on the result.
  - That covers a nested Group with its bound value (2×0.5+0.1 = 1.1), a connection overriding it (3.1), disconnecting (back to 1.1) and unbinding (the literal 0.4).
  - It also checks that the resample edit policy is inherited from the child parameter, that fields are read-only, and that the canonical JSON doesn't change.
  - The cross-scope binding test (`v2-integration.test.ts:42-53`) confirms both APIs reject the same field path.
- **Independent modules:** `controls.ts` imports only `types`, `values` and `canonical`, and redefines the Group type constants locally (`:14-16`). `document.ts` doesn't import `controls.ts`.

**Remaining minor items (none blocking):**
- **N1:** `controls.ts` never validates a control's `default`; it relies on `validateDocument` running first. That matches the documented pipeline order.
- **N2:** the unused-graph warning at `controls.ts:175` has no `fieldPath`. This is F7, already deferred.
- **N3:** the Group registry spec in the integration test (`:11`) sets `min: undefined` and `max: undefined` explicitly. That works but isn't tidy.
- **Accepted as deferred:** F5 (binding type checks happen in the resolver), F6, F7, F8 (callers include builtins in the asset set), F9 (WP05).

**Commands for the manager to run:**
- `node --test tests/v2-document.test.ts tests/v2-controls.test.ts tests/v2-integration.test.ts`
- The project's typecheck (e.g. `tsc --noEmit`)

**Limitations:** this was a static review only. I didn't read the full document and controls test files or the shared value modules this pass, and nothing was checked visually.

**Changed files:** none.

VERDICT: PASS. F1–F4 are fixed consistently in both APIs, and there is now an end-to-end test that validates a document and then resolves it with the same registry. The remaining items are minor or were deferred by decision. This pass rests on static review [PROXY] plus the manager's test run; it is not visual or runtime acceptance.
