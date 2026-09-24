# WP01b evidence

[RAN] 108 tests pass (46 legacy, 22 WP01a, 24 document, 14 controls, 2 integration); TypeScript exits 0. See tests.txt and types.txt. These checks validate the data/control slice, not rendered VFX.

[PROXY] Adds strict saved-document structure and reference validation, safe JSON/recovery handling, public-parameter precedence and nested Group overrides. Supplied registry/record schemas are application-owned; there is no complete production catalog yet. No UI, renderer, audio, existing presets or dependencies changed.

## Review
Initial independent Opus5.5 LOW review rejected the slice for mismatched reserved-name rules, writable structural bridge references and mismatched record defaults. Review-first.md preserves those findings. Workers added regression coverage; manager added serialized-document-to-resolver integration coverage and removed an accidental module dependency. Final Opus5.5 LOW review accepted this slice [PROXY]; see review-final.md for read coverage and minor deferred items.

## Reproduce
- node --experimental-strip-types --test tests/*.test.ts
- node node_modules/typescript/bin/tsc --noEmit
- Initial robustness probe: work/document-mutations.mjs completed 522 wrong-shape mutations without throwing; mutations.txt. This was a probe, not exhaustive fuzzing.

## Boundaries and remaining work
- Production registry and executable fixtures, typed connections, expanded graph budgets, DAG/reachability, compiler and renderer remain later slices. This is not full WP01 or VFX completion.
- Always validateDocument then resolveParameters before compilation. Structural acceptance alone does not validate binding type/unit/affine semantics.
- Interface port default typing and role-specific asset port vocabulary require reconciliation before compiler acceptance.
- Asset availability input includes builtins; absent availability input checks references only. Asset default references, bytes, hashes and interpretation IDs remain WP05.
- Minor review follow-ups: reject irrelevant non-enum choices if desired; document warnings only flag directly unused graphs, whereas resolver flags unreachable descendants.
- Registered-record schema absence still uses the earlier value-validator diagnostic; bounded message text applies to document-owned messages, not every inherited value diagnostic.
- Proxy traps cannot be detected in ordinary JavaScript; JSON text import is the untrusted interchange path.

## Visible application
[SAW] Existing v1 app at http://127.0.0.1:5174/ was inspected in the browser and left playing for user testing. That does not demonstrate these new model modules in the UI. User-reported fire/water/shadow and lightning quality issues remain.
