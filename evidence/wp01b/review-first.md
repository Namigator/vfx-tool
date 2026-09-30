**WP01b review: `document.ts` and `controls.ts`, read-only**

Neither API crashes on the inputs I traced, but they disagree on several points. As a result, a document that `validateDocument` accepts can still be rejected by `resolveParameters`, and one structural field can be changed by a control. No test runs both APIs on the same document. I made no edits and ran nothing. All findings come from reading the code [PROXY]; the reproductions below have not been run [UNVERIFIED]. I ignored the known ValueContext import and recordType guard issues.

**Read coverage (every line):** `src/model/document.ts` (1–757), `src/model/controls.ts` (1–338), `tests/v2-document.test.ts` (1–347), `tests/v2-controls.test.ts` (1–227), `WP01B-WORKER-CONTRACT.md` and `WP01-REPRESENTATION-DECISIONS.md`. From `types.ts`/`values.ts` I read only the exports these files use: `ParameterSpec`, `PublicControl`, `ControlBinding`, `NodeDefinition`, `ValidationResult`, `ValueContext`, `RecordRegistry` and the `validateParameterValue` header. I did not read the rest of `values.ts`, `canonical.ts` or `fixtures.ts`.

## Findings

**F1 – A root-scoped control named `graphId` passes one API and fails the other.**
- `document.ts:642` rejects `graphId` only when the control is not in the root scope.
- `controls.ts:113` rejects `graphId` in every scope.
- Repro: `minimalDocument()` plus a control `{id:'graphId', scopeGraphId:'graph-root', …, bindings:[]}`. `validateDocument` returns ok, but `resolveParameters` returns `INVALID_VALUE@controls[0].id`.
- Fix: pick one rule and use it in both files. The contract says to reserve the ID for child controls, so the simplest fix is to reserve it in every scope.

**F2 – A control or edge can drive the structural `portId` on GroupInput/GroupOutput.**
- `document.ts:563` only removes `graphId` from a node's connectable inputs, so `portId` becomes a connectable input port.
- `document.ts:704` only blocks bindings to `graphId`.
- `controls.ts:237` reserves only `graphId`.
- Repro: take `groupDoc()` and add a control scoped to `graph-child` with `type:'string', unit:'none', value:'zzz'` and binding `{nodeId:'node-gout', parameter:'portId'}`. Document validation passes, and the resolver returns `portId='zzz'`, which references a port that doesn't exist. An edge targeting `node-gout.portId` is also accepted.
- Fix: treat `BRIDGE_PORT_PARAM` the same way as `graphId` in both files. Regression tests: binding to `portId` fails, and an edge into `portId` fails with `MISSING_REFERENCE`.

**F3 – A registered-record control can have a `default` of a different record type from its `value`.**
- `document.ts:682` takes the record type from each field separately, so `value` of type A and `default` of type B both pass.
- `controls.ts` never checks `default`.
- Fix: take the record type from `value` and require `default` to match. Regression: value A with default B gives an error at `controls[i].default`.

**F4 – The two APIs expect different registry contents, and no test covers using them together.**
- `document.ts` requires a `Group@N` entry in the registry that declares `graphId` (see `:517`, `:522`). Without it, Group nodes get `UNKNOWN_NODE`.
- `controls.ts` ignores the Group entry, and the controls test registry doesn't have one. So every document built by `nested()` in the controls tests would be rejected by `validateDocument`.
- If the Group entry declares extra parameters, `document.ts:527-534` accepts them as Group literals, while `controls.ts:145` rejects them.
- Fix: write down the Group registry requirement (manager-owned shared contract). Add one test that runs `validateDocument` and then `resolveParameters` on the same document and registry, covering F09 and a nested group.

**F5 – Documents with bad binding types pass validation and only fail in the resolver.**
- `document.ts` `checkBinding` (lines 691–720) does not check type, unit, or scale/offset on non-numeric controls. `controls.ts:245-256` does.
- This is acceptable if validation is always followed by resolution. Please confirm that as the intended ordering, or copy the check into `document.ts`. I don't consider this blocking on its own.

**Minor:**
- **F6:** `choices` is accepted on non-enum controls (`document.ts:658`).
- **F7:** A graph reachable only through an unused graph gets no warning (`document.ts:628` checks only direct references). The resolver does warn about it, without a `fieldPath`.
- **F8:** When `availableAssetIds` is given, builtin assets are marked as having no data (`document.ts:174`). Decide this as part of WP05.
- **F9:** Registry defaults for asset parameters are never checked against the asset list (`document.ts:535`). The registry is trusted, so this can wait.

## Items that check out [PROXY]
- **Precedence:** connection > control > literal > default, and for Groups: parent driver > override > stored child value. Resolution goes top-down in pre-order, so parent values are ready before children need them.
- **Masked conflicts:** duplicate drivers are still reported when a connection hides them.
- **Group depth:** both files count depth the same way.
- **Aliasing and mutation:** document input is never mutated, shared objects are rejected, and resolver results are deep-cloned.
- **Ordering:** results are sorted by nodeId then parameter.
- **Unsafe record access:** every access by user-supplied key is guarded by `hasOwn`, uses `Object.keys` or goes through a `Map`, so `__proto__` is safe.
- **Other checks:** accessors and `toJSON` are never called; depth and byte limits are checked first; quoted user text in messages is bounded.

## Blockers vs deferred
- **Nothing blocks the task itself.** F4 needs a manager decision on the shared registry contract.
- **Deferred as the contract allows:**
  - WP02: edge ordering and cycles, port type/domain matching, interface `defaultValue` typing, expanded budgets, `meshAsset`/`textureAsset` port naming.
  - WP05: asset bytes, checksums, interpretation-ID derivation, builtin resolution.

## Checks for you to run
1. `node --test tests/v2-document.test.ts tests/v2-controls.test.ts` after the import and guard fixes.
2. A typecheck (`tsc --noEmit` or whatever the project uses).
3. The new regression tests for F1–F4 once they're added.

The current 20/12 pass counts are yours [RAN by manager], not something I verified.

**Changed files:** none.

**Limitations:** this was static review only; nothing was executed and nothing was checked visually. I also couldn't write the plan-mode plan file or call ExitPlanMode because those tools weren't available in this session.

VERDICT: FAIL. F1 and F2 are concrete cases where the two APIs disagree, and F2 lets a control or edge change a structural field. F3 accepts invalid control defaults. F4 means the two APIs have never been tested together. Fixing F1–F3 and adding the combined test from F4 should be enough to pass; F5–F9 can be deferred.
