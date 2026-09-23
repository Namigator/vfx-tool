# VFX Studio v2 — implementation handoff

Revision: 1.0, 2026-09-24. Status: design specification; application implementation has NOT begun.

## Read this first

Build a desktop browser VFX authoring tool whose users can reach at least the visual richness of the original lightning demo through reusable, editable components. A node editor is the authoring interface, not the deliverable by itself. Ship ten rich game-spell defaults, all constructed with the same nodes and assets available to users.

User decisions: expandable blocks; included assets plus imports; rich game spells; no runtime AI; no engine exporters in this phase. Full shader programming is deferred because arbitrary shader behavior has no established common implementation across Unity, Unreal and Roblox. Configurable material operations remain included. Work solo unless the user subsequently changes their no-subagent instruction.

The user rejected the current fire, water and shadow appearance and identified a large quality gap between the original lightning and the tool. Preserve this feedback as a failed visual acceptance gate. Do not treat existing passing tests as artistic acceptance.

## Authority and reading order

1. This index and [product requirements](01-PRODUCT.md).
2. [Baseline](02-BASELINE.md), [architecture](03-ARCHITECTURE.md), [format](04-DOCUMENT-FORMAT.md).
3. [Node catalog](05-NODE-CATALOG.md), [graph rules](06-GRAPH-SEMANTICS.md), [simulation](07-SIMULATION.md).
4. The subsystem documents relevant to the work package.
5. [Acceptance](17-ACCEPTANCE.md), [test matrix](18-TEST-MATRIX.md), [work packages](19-WORK-PACKAGES.md), [agent handoff](20-AGENT-HANDOFF.md).

This specification supersedes conflicting decisions in the old root PLAN.md: fixed family-only controls, a fixed layer list, exclusion of mixed-element composition, and completion by counting ten implementations. The old plan remains historical. Numeric contracts in the format, graph and simulation documents are authoritative over illustrative prose. Effect specifications own artistic defaults; changing those defaults must preserve their acceptance gates.

## Document map

| Document | Responsibility |
| --- | --- |
| [01 Product](01-PRODUCT.md) | User outcomes, scope and priorities |
| [02 Baseline](02-BASELINE.md) | Observed state, retained code, reference evidence |
| [03 Architecture](03-ARCHITECTURE.md) | Boundaries, data flow, interfaces, dependencies |
| [04 Document format](04-DOCUMENT-FORMAT.md) | Versioned graph, assets, IDs, parameters |
| [05 Node catalog](05-NODE-CATALOG.md) | Required node vocabulary and controls |
| [06 Graph semantics](06-GRAPH-SEMANTICS.md) | Ports, groups, enable/solo, compilation |
| [07 Simulation](07-SIMULATION.md) | Clock, random streams, seeking, algorithms |
| [08 Rendering](08-RENDERING.md) | Geometry, transparency, lights, post effects |
| [09 Materials](09-MATERIALS.md) | Portable material recipes and operations |
| [10 Assets](10-ASSETS.md) | Included library, import, provenance, packaging |
| [11 Audio](11-AUDIO.md) | Layered sounds, scheduling, synthesis, WAV |
| [12 Editor](12-EDITOR.md) | Layout, gestures, controls, accessibility |
| [13 Persistence](13-PERSISTENCE.md) | IndexedDB, autosave, bundles, recovery |
| [14 Migration](14-MIGRATION.md) | Preserve v1 and convert explicitly |
| [15 Performance](15-PERFORMANCE.md) | Limits, budgets, profiles, measurements |
| [16 Portability](16-PORTABILITY.md) | Future adapter boundary, capability fallbacks |
| [17 Acceptance](17-ACCEPTANCE.md) | Quality gates and evidence requirements |
| [18 Tests](18-TEST-MATRIX.md) | Automated and human verification scenarios |
| [19 Work packages](19-WORK-PACKAGES.md) | Ordered implementation units and exits |
| [20 Agent handoff](20-AGENT-HANDOFF.md) | Exact execution procedure and reporting |
| [21 Decisions and risks](21-DECISIONS-RISKS.md) | Locked choices, mitigations and stop rules |
| [22 Fixtures](22-CONFORMANCE-FIXTURES.md) | Normative small examples and expected behavior |
| [23 Sources](23-SOURCES.md) | Primary-source technical references |
| [24 Algorithms](24-ALGORITHMS.md) | Exact path, motion, noise and audio math |
| [25 Interfaces](25-INTERFACE-CONTRACTS.md) | Port names, control values, frame packets and worker protocol |
| [26 Planning audit](26-PLAN-AUDIT.md) | Review findings, resolved ambiguities and integrity checks |
| [Lightning](effects/01-LIGHTNING.md) | First quality benchmark |
| [Fire](effects/02-FIRE.md) | Flame assets, emission and smoke |
| [Water](effects/03-WATER.md) | Liquid body, breakup, splash and ripples |
| [Shadow](effects/04-SHADOW.md) | Dark body, inward wisps and collapse |
| [Ice](effects/05-ICE.md) | Shards, frost and fracture |
| [Earth](effects/06-EARTH.md) | Debris, dust and grounded impact |
| [Wind](effects/07-WIND.md) | Gust structure and sparse tracers |
| [Poison](effects/08-POISON.md) | Volume, bubbles and drips |
| [Light](effects/09-LIGHT.md) | Controlled rays, pulse and halo |
| [Energy](effects/10-ENERGY.md) | Travel, trail and event-driven impact |

## Delivery order

Contracts and tests → reusable graph/runtime/editor skeleton → lightning parity → fire, water and shadow → remaining six elements → robustness and full acceptance. No new family passes merely because its source exists.

## Meaning of complete

All required work-package exits, visual gates, listening gates and persistence tests pass with recorded evidence. The user can modify the reference lightning, build a mixed effect from a blank graph, inspect component internals, import assets, and reopen a portable project without losing editability.

No implementation is authorized by the existence of these files alone; this planning request ends at a reviewed handoff package.

