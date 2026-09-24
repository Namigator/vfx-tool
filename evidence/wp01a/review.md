**VERDICT: PASS.** I accept WP01a only. F4 is fixed, the change didn't break anything else, and I found no remaining blocker. This is static review [PROXY], not visual acceptance.

I read `src/model/canonical.ts` (197 lines) and `tests/v2-model.test.ts` (368 lines) in full, plus my previous review and both evidence files. I changed no files. Plan mode was on, but no Write or ExitPlanMode tool was available, so I made no plan file.

## F4 is fixed [PROXY]
- **Checks run in a safe order** (`canonical.ts:120-125`). `canonicalJson(doc)` runs first, so accessors and exotic objects are rejected before anything reads the fields. Then the new `checkProjectionShape` runs, and only after that does `semanticProjection` build the sorted copy.
- **Everything the sort step reads is now checked** (`canonical.ts:149-169`):
  - the root is a record;
  - `tags` is an array of strings;
  - `anchors`, `controls`, `assets`, `graphs` and each graph's `nodes` go through `checkIdList` (an array of records with a string `id`);
  - each graph's `edges` is an array of records with a safe-integer `order` and a string `id`.

  The only other field the sort step touches is `editor`, which is removed. A missing `editor` is harmless.
- **Both failures from my last review are closed.** A string like `tags: "ba"` can no longer become `["a","b"]`, and no sort falls back to input order. `null` entries and missing lists now throw `CanonicalError` with the exact path instead of a `TypeError`.
- **The typecheck fix is sound.** The callback parameter `e` is now `unknown`, and `isRecord(e)` (`:162`) narrows it at runtime. The `?.` in `e?.order` (`:163`) is unnecessary but harmless. `EdgeDefinition` is still used by `byEdgeOrder` (`:29`).
- **Only the message is shortened now.** `CanonicalError.message` is cut at 200 characters, while `fieldPath` keeps the full path (`:17-24`). `values.ts:237` passes that full `fieldPath` through. Two tests cover this: the 265-character path at `tests:243-246`, and the 1000-character key with a message under 300 characters at `:247-251`.
- **The new tests cover the reported cases** (`tests:189-209`). Each expected path matches the order of the checks in `checkProjectionShape`, the non-array cases for `$.tags` and `$.controls` go through the same `checkArray` a non-array `nodes` or `edges` would, and there is a positive control case. The F3 edge-order tests (`:181-187`) are unchanged and still cover edge order.

## Findings
None blocking. Two minor gaps, neither required for WP01a:
- No test for a non-object root document, or for `edges` / `nodes` given as a string.
- `e?.order` could be `e.order`.

## Evidence
- [SAW] `evidence/squad/wp01a-all-tests-final.txt` shows 68 tests, 68 passed, 0 failed, including the "F4: …" test and all the v1 tests.
- [SAW] `evidence/squad/wp01a-types-final.txt` contains two appended runs: the first failed with the TS2345 callback-type error, the latest ends with "TypeScript exit code: 0".
- I did not run anything myself (no [RAN]). This result is [PROXY].

## Changed files
None.

## Checks for the manager to re-run if anything changes
- The v2 model tests and the full legacy suite (`node --test`).
- The project's TypeScript no-emit check.

Ideally, write each typecheck run to a fresh evidence file instead of appending, so the latest result is unambiguous.

## Follow-up (not blocking, deferred)
- **L1:** user text pasted into `values.ts` error messages has no length limit. `CanonicalError.fieldPath` is also uncapped, because a single key can be very long; that belongs with WP01b string and path limits (`MAX_PATH_CODE_POINTS`).
- **L2:** an unregistered record type is reported as `UNKNOWN_NODE`; the name needs settling in WP01b.
- **Deferred WP01b validation:** duplicate IDs, whole-document validation, the uint32 seed, string limits and asset reference resolution.
- **WP05:** deriving the asset interpretation ID.
- Proxy traps can't be detected from plain JavaScript; this is documented in the code.
- No rendering or visual acceptance is claimed.

**VERDICT: PASS.** WP01a only. F4 is fixed with exact-path `CanonicalError`s and has tests; the manager's evidence shows 68 of 68 tests passing and the latest typecheck exiting with 0. This is a static [PROXY] review, not visual acceptance.
