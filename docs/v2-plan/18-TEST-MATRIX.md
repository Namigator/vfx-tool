# Test matrix and requirements traceability

Use native Node tests for pure TypeScript. Use a permitted, connected browser automation surface for actual editor interactions and screenshots. If adopting an additional browser-test dependency later, obtain required approval; do not install one to evade unavailable/blocked browser control. Browser automation scripts belong to the project once authorized. Human visual and listening gates remain separate.

## Contract and graph tests

| ID | Cases | Requirement |
| --- | --- | --- |
| T01 | Valid minimal graph; unsupported version/type; bad IDs; NaN; oversized/deep input; missing references | R06,R09 |
| T02 | Port type/domain/unit mismatch, single-input replacement, multi-input order, cycle path, group recursion | R03,R04 |
| T03 | Enable/disable by node category, modifier bypass, shared dependencies, Solo union, disabled group events | R03 |
| T04 | Group expansion equivalence; regroup preserves IDs/randomness; duplicate independence; template isolation | R04,R05 |
| T05 | Parameter precedence, bound-field read-only, affine mapping, conflicting owners and unbind | R06,R10 |
| T06 | Canonical hashing ignores layout but detects semantics/assets/version changes | R08,R09 |
| T07 | Core/model imports contain no DOM/Three/React and presets use only registry nodes | R02,R10 |

## Runtime tests

| ID | Cases | Requirement |
| --- | --- | --- |
| T08 | PRNG/hash/noise golden vectors, independent streams, unrelated node insertion | R08 |
| T09 | Same tick under 30/60/144 Hz, seek versus replay, checkpoints, cancelled stale results | R08 |
| T10 | Burst once, fractional rate, repeat count, event ordering, event fan-out limits | R06,R08 |
| T11 | Fixed-step gravity/drag, local/world space, coincident anchors, exact endpoint, no NaNs | R06 |
| T12 | Ground collision, max bounces, resting contacts, child emission position/identity | R05,R06 |
| T13 | Trail lifespan, death events, all output empty at document endpoint | R06,R08 |
| T14 | Worker crash/restart, superseded revisions, transfer-buffer ownership | R11 |
| T15 | Hard budgets estimated/enforced and no silent truncation | R11 |

## Materials and assets

| ID | Cases | Requirement |
| --- | --- | --- |
| T16 | UV order, flipbook first/last frame, no age-end wrap, padding, color/data texture roles | R02,R07 |
| T17 | Dissolve endpoints, alpha modes, rim domains, enhancement fallbacks | R02,R10 |
| T18 | Valid PNG/WebP/JPEG/WAV/GLB; invalid headers, oversize decode, external GLB URI, unsupported mesh features | R07 |
| T19 | Duplicate asset interpretation, hash match/mismatch, relink and deletion references | R07,R09 |
| T20 | Every included asset has source/provenance/rights record and actual thumbnail | R01,R07 |

## Audio

| ID | Cases | Requirement |
| --- | --- | --- |
| T21 | Generator golden vectors, deterministic noise, filter coefficients, resampling, pan and duration | R06,R08 |
| T22 | Finite PCM, limiter/peak, silent boundaries, correct WAV header and sample count | R06,R09 |
| T23 | Cue ticks match visual events; collisions/death offline schedule matches runtime | R06,R08 |
| T24 | User unlock, rejected resume, rapid restart, pause, hidden tab, stale callbacks, cache invalidation | R11 |
| T25 | Actual per-family audition and synchronization check | R01,R02 |

## Editor and persistence

| ID | Cases | Requirement |
| --- | --- | --- |
| T26 | Default open, Blank composition, component auto-wire choice, mixed effect and block reuse | R01,R05 |
| T27 | Numeric intermediate drafts, slider transaction, undo/redo no-op behavior, field reset | R03,R06 |
| T28 | Curve/gradient mouse and keyboard editing, invalid points, driven controls | R06,R12 |
| T29 | Graph keyboard shortcuts, accessible outline, focus/error navigation, reduced effects | R12 |
| T30 | Local save/reload, five revisions, corrupt newest recovery, failed quota, stale-tab conflict | R09 |
| T31 | Fresh-origin package round-trip with imported texture/mesh/WAV, checksums and included built-ins | R07,R09 |
| T32 | ZIP paths, duplicate entries, checksum errors, actual decompression limits, unsupported versions | R09 |
| T33 | Legacy v1 unchanged, explicit conversion report, all ten mappings and boundary settings | R13 |

## Visual, reliability and performance

| ID | Cases | Requirement |
| --- | --- | --- |
| T34 | Original versus graph lightning clips, layers solo, multi-angle and enhancement-off | R02 |
| T35 | Fire/water/shadow material gates and variants | R01,R02 |
| T36 | All ten × three configurations × phase/angle/background evidence matrix | R01 |
| T37 | Qualified latency/FPS/graph benchmarks, repeat runs, hardware metadata | R11 |
| T38 | 100 casts, preset cycles, remount, resize, context loss and resource plateau | R11 |
| T39 | Artist task: modify benchmark and build a new mixed effect without code | R02,R05 |
| T40 | Model build test (A-05): fresh agent reproduces a standalone reference from Blank via UI only; gap log recorded | R02,R05,R06 |

## Test fixture policy

Small deterministic fixtures live beside core tests; large assets/clips live in evidence or asset directories. Expected values must be independently calculable or approved reference captures. Do not generate expected output from the same function under test.

Pin asset bytes and runtime versions in regression cases. A screenshot difference is an investigation signal, not automatic artistic failure; anti-aliasing/GPU variance matters. Updating a visual baseline requires opening both results and documenting why the change is accepted.

Current 46 v1 tests remain legacy coverage. Do not inflate progress by renaming them as v2 coverage. Each work package lists the new tests it must add or execute.

