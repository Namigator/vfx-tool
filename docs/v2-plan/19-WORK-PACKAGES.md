# Sequenced implementation work packages

Read the agent handoff before starting. Each package is a bounded unit; finish its tests/evidence before marking it complete. Packages are ordered by dependencies, not dates. All work remains in F:\Dev2\VFX-Tool. No parallel agents unless the user changes that instruction.

## Foundation

| ID | Depends on | Deliverable | Exit |
| --- | --- | --- | --- |
| WP00 Baseline | planning handoff | Preserve source/lockfile/v1 fixtures; full original-lightning capture harness; record browser/GPU; vet/pin/approve needed dependencies | Source/reference hashes; baseline tests; actual original clip inspected; dependency decisions recorded |
| WP01 Document model | WP00 | v2 types, runtime validation, parameter metadata, canonical serialization and fixtures | T01,T05,T06,T07 pass |
| WP02 Graph compiler | WP01 | Typed edges, disabled behavior, group expansion, DAG/event ordering, diagnostics, budget plan | T02,T03,T04,T15 pass |
| WP03 Runtime foundation | WP02 | RNG/math, events, fixed clock, emitter/forces, paths, trails, seek/checkpoints, worker protocol | T08–T14 pass with real worker smoke test |
| WP04 Renderer foundation | WP02,WP03 | Instanced billboards/meshes, ribbons/rings/lights, material variants, depth/bloom, cleanup | T16,T17 preliminary; primitives actually captured and inspected |
| WP05 Asset pipeline | WP01 | Asset metadata/import/preview, included utility masks/meshes, refcounts and limits | T18–T20 pass; imported examples visibly inspected |
| WP06 Audio graph | WP02,WP03,WP05 | Layered sources/envelopes/filters/mix, canonical PCM, playback clock and WAV | T21–T24 pass; charge/snap/tail audition recorded |
| WP07 Editor skeleton | WP01,WP02 | React Flow shell, Simple/Graph/Internals views, metadata inspector, commands/history | T26–T29 core flow through connected browser |
| WP08 Persistence | WP01,WP05,WP07 | IndexedDB saves/recovery, assets/blocks, staged ZIP/JSON/WAV export/import | T30–T32 pass incl. fresh-storage bundle |
| WP09 Integrate slice | WP03–WP08 | End-to-end graph preview, transport, error states, revision cancellation, diagnostics | Build blank effect, edit/save/reopen; T14,T24,T26,T27 |

WP04 can use utility assets before full WP05 completion, but a quality preset cannot pass without the asset pipeline. WP07 can use compiler fixtures before full rendering; never present that as a completed VFX tool.

## Quality benchmark

| ID | Depends on | Deliverable | Exit |
| --- | --- | --- | --- |
| WP10 Lightning components | WP09 | Reference feature mapping, charge, core/halo, branches/forks, sparks, impact, sound groups | Every feature can be soloed/disabled/edited; no private node |
| WP11 Lightning parity | WP10 | Default and two structural variants; matched comparison captures, qualified timing/performance | Gate B / T34 and user artistic acceptance |
| WP12 Reuse proof | WP11 | Create lightning from Blank using same components; save group; mixed bolt+smoke example | Gate A / T39 passes without writing source |

If WP11 fails, fix the reusable renderer/node/material capability or preset composition identified by evidence. Do not patch a hidden lightning-specific render function and proceed.

## Difficult families

| ID | Depends on | Deliverable | Exit |
| --- | --- | --- | --- |
| WP13 Fire | WP12 | Authored flame/smoke assets; flame jet, compact torch and wide burst; layered sound | Fire spec + Gate C; no circle-cloud substitute |
| WP14 Water | WP13 | Liquid body, splash/foam, droplets/ripples; arc, sheet burst and narrow stream | Water spec + Gate C on light/dark background |
| WP15 Shadow | WP14 | Dark body, inward wisps, collapse; vortex, inward puff and narrow tendril | Shadow spec + Gate C with bloom off |
| WP16 Material/reuse audit | WP13–WP15 | All three built from shared registry/material recipes; remove redundant family-only code | T07,T17,T35; user visual review of these defaults |

## Remaining families

| ID | Depends on | Deliverable | Exit |
| --- | --- | --- | --- |
| WP17 Ice | WP16 | Shards, frost, fracture, three configurations and sound | Ice spec, asset/profiling/visual packet |
| WP18 Earth | WP17 | Rocks, dust, ground response, three configurations and sound | Earth spec, collision events and visual packet |
| WP19 Wind | WP18 | Helical ribbons, streaks, gust envelope, three configurations and sound | Wind spec, distinct non-electric motion |
| WP20 Poison | WP19 | Slow cloud, bubbles/drips, three configurations and sound | Poison spec, distinct from recolored fire |
| WP21 Light | WP20 | Controlled core, rays/ring, three configurations and sound | Light spec, no featureless white disk |
| WP22 Energy | WP21 | Follower/trail/arrival-driven impact, three configurations and sound | Energy spec, event synchronization and trail expiry |

Each family package includes data graph, reusable components, source/provenance for any new assets, default values, two meaningful variants, tests for any added general capability, captured phases/angles and audition. No preset completion without those outputs.

## Release preparation

| ID | Depends on | Deliverable | Exit |
| --- | --- | --- | --- |
| WP23 Legacy migration | WP08,WP22 | Legacy view/import and explicit graph-copy converters | T33 all families; old data untouched |
| WP24 Reliability | WP22,WP23 | Failure recovery, budgets, context-loss handling, lifetime fixes | T14,T15,T24,T30–T32,T38 |
| WP25 Performance/accessibility | WP24 | Qualified profile runs, keyboard/outline workflows, reduced effects | T29,T37; actual recorded environment |
| WP26 Final visual/audio review | WP25 | Full ten-family/default/variant evidence matrix and user review | Gates B–G; T25,T34–T36,T39 |
| WP27 Delivery | WP26 | Runnable build, docs, assets/licenses, package examples, evidence index and known limits | Clean launch/fresh-storage import; all requirements mapped |

## Agent tooling (MCP)

| Package | Depends | Deliverable | Exit |
| --- | --- | --- | --- |
| WP-MCP1 Headless core | WP02,WP03 | stdio MCP server over the pure modules: registry/catalog listing, document create/open/save, add/remove/connect/set-param nodes, compile with diagnostics, simulate/sample particles at tick, render audio to WAV | Agent builds F01 + forces demo end-to-end via tools only; tests |
| WP-MCP2 Visual loop | WP-MCP1,WP04 | render effect frame(s) at given ticks/camera to PNG via headless browser; contact sheet over a timeline; compare two captures | Agent returns images it has actually inspected |
| WP-MCP3 Authoring parity | WP07,WP08 | components/templates, published controls, group/expand, asset import, bundle export — everything the UI can do | A-05 model build test can run through MCP as well as UI |

MCP tools call the same compile/runtime code as the editor; no MCP-only behaviour.

## Capability floor (gate before WP10+ artistic work)

Family tuning (WP10 onward) may not resume until these catalog items are registered, compiled, simulated/rendered and covered by tests, with at least one captured preview each: Emitter shapes cone/sphere/disc/box and speed ranges plus aim anchor; Gravity, Drag, NoiseForce; InitialProperties rotation/angular velocity; colour/size/opacity over life; velocity-aligned stretched billboards; textured flipbook material with the included library conforming to 10-ASSETS; GroundCollision and ParticleEvents child emission; ParticleTrail, SpriteRenderer, PointLight; Curve and RandomRange; PathFollower with arrival event. Track status in [27 Gap audit](27-GAP-AUDIT.md). Rationale: the lightning benchmark was tuned on a point-only runtime, which produced effect-specific work instead of reusable capability.

## Scope discipline

Do not add exporters, shader programming, networking or an AI assistant while these packages are incomplete. Do not perform repeated broad refactors without a failing test or measured constraint. If one capability proves impossible within WebGL2 limits, record the concrete failure and its effect on acceptance; do not weaken the requirement silently.

A package blocked only by user visual/listening approval can leave that gate pending and continue dependency-independent infrastructure. Work that depends on approved art direction must not claim acceptance in advance.

