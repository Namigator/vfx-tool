# Locked decisions, risks and completion boundaries

## Decision register

| ID | Decision | Reason / consequence |
| --- | --- | --- |
| D01 | Rich game-spell art direction | User choice; original lightning is minimum quality benchmark |
| D02 | Expandable component blocks | Simple defaults with real editable internals |
| D03 | Included assets plus user imports | User choice; quality cannot depend on generic circular particles |
| D04 | Configurable materials, no full shader programming | Conditional user request; common cross-engine shader behavior unproven |
| D05 | Graph semantics independent of UI/backend | React Flow is an editor view; Three.js is one renderer |
| D06 | Typed DAG and bounded event chains | Prevent feedback/infinite work and support reproducible compilation |
| D07 | Fixed 60 Hz, 10-second maximum | Bounded seeking and event timing; continuous rendering interpolation |
| D08 | Embedded independent group instances | Avoid library updates changing saved projects |
| D09 | Native IndexedDB plus ZIP interchange | Asset storage and portable backup; no backend |
| D10 | Preserve v1 and convert explicitly | No silent loss or misleading visual-equivalence claim |
| D11 | Quality profiles change renderer, not simulation | Stable seeded authoring and honest workload limits |
| D12 | Lightning gate before family expansion | Prove tool capability at the known visual benchmark |
| D13 | Fire/water/shadow next | Address user-reported quality failures and material diversity |
| D14 | User-installed arbitrary nodes/plugins deferred | No executable content in imported projects |
| D15 | Hidden page pauses and requires resume | Predictable audio and no background work |
| D16 | Engine exports deferred | Preserve future adapter inputs without claiming implementation |
| D17 | Solo is preview-only, enable is authored | Debugging cannot accidentally change saved effect |
| D18 | Work solo | User instruction; planning and implementation need no agents |

## Risks and responses

| Risk | Detection | Required response |
| --- | --- | --- |
| Pretty node UI over weak visuals | Lightning/material gates fail | Improve reusable render/material/asset capability before broadening |
| Default can only be built through private code | Preset registry audit | Remove hidden special case; expose a documented node/operation |
| Node complexity overwhelms users | Blank-to-effect exercise stalls | Improve components, auto-wire and published controls; retain deep model |
| Asset quality insufficient | Solo asset/component inspection | Re-author or acquire rights-cleared art; do not hide with bloom |
| Overdraw/sorting harms water/smoke | Angle/background captures and GPU/frame measurements | Adjust material/layer structure and batching; record limitations |
| Event fan-out exhausts budget | Static estimate/runtime guard | Reject or stop offending system with exact cost source |
| Seed changes after unrelated edits | Identity fixture fails | Fix stream identity, not golden expectations |
| Browser storage loss | Quota/eviction tests | Atomic saves, revisions and portable backups |
| Engine-neutral confused with universal export | Capability report language | State approximation and deferred engine tests explicitly |
| New dependency cannot be installed | Approval gate | Continue independent work; do not bypass approval or invent API |
| Device unknown or too slow | Reference benchmark setup | Record actual hardware; qualify performance, retain visible quality choice |
| Full audio synthesis is aesthetically weak | Listening gate | Use editable rights-cleared samples through same graph |
| Context/tool unavailable | Browser discovery/capture failure | Leave visual gate pending; no replacement with scene metadata |
| Scope expands to engine/game editor | Work package review | Keep documented exclusions; request explicit scope revision |

## Scope change protocol

A change needs a short decision note with requested behavior, affected contracts/tests/presets, compatibility impact and evidence motivating it. Update the authoritative document and work packages, not conflicting ad-hoc instructions in multiple files. User requests override older plan choices; preserve the change history.

Artistic tuning within the specified components/ranges is expected implementation iteration. Changing schemas, supported node types, portability claims, file safety limits or omitted functionality is an architectural change and must be recorded.

## Open execution facts, not open design decisions

GPU/browser measurements, exact compatible dependency patch versions, final authored texture pixels, listening judgments and user visual approval are future execution evidence. They are not permission to invent missing scope or call the product complete early. Work packages specify how each will be obtained and what blocks on it.

## Release definition

All R01–R13 requirements have passing test/evidence links. All ten defaults meet visual/listening review and preset budgets on the named environment. A user can compose a novel effect, save/import it with assets and continue editing internals. Known limitations are explicit. Native engine export remains unimplemented and must be described that way.

