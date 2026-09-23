# STATE — VFX Tool

**Goal:** A simple expandable-node VFX/SFX authoring tool capable of the original lightning's quality, with ten rich game-spell defaults and future engine-independent export inputs.

## Now
- Planning handoff saved at docs/v2-plan/00-START-HERE.md; 37 Markdown documents, 28 work packages, 39 test scenarios, ten effect specifications.
- [RAN] Documentation links, requirement coverage, dependency order and reference checksums audited; report: docs/v2-plan/plan-audit.json.
- Application implementation for v2 has NOT started. No application source, presets or installed packages changed during planning.
- User choices: expandable blocks; included assets plus imports; rich game spells. Full shader programming deferred under user's portability condition; configurable materials included.
- Work solo. No subagents were used. User asked for the full plan before continuing implementation.
- Historical root PLAN.md points to the new authoritative handoff.

## Next (in order)
1. On implementation request, read the handoff and start WP00: preserve v1 baseline, capture full original lightning cycle, record browser/GPU and vet new dependencies.
2. Implement graph contracts/runtime/editor slice through WP09, then lightning parity WP10–WP12.
3. Pass lightning artistic gate before fire/water/shadow, then the other six and final acceptance.

## Known failed / unverified
- [UNVERIFIED by agent; user-reported failure] v1 fire, water and shadow looked unacceptable; lightning quality was substantially below the original.
- [SAW] Original lightning-preview.png inspected: charging frame only, not full discharge evidence.
- [UNVERIFIED] v2 visuals/audio/performance are planned, not implemented or tested.
- [UNVERIFIED] Actual GPU unknown: CIM discovery denied; CPU-only v1 measurements cannot establish render performance.
- [RAN] Earlier browser discovery was unavailable; reconnect/use supported browser capture for implementation gates.
- [RAN] doctor.ps1/shot.ps1 absent at instructed paths; do not repeatedly call missing utilities.
- [UNVERIFIED] Future Unity/Roblox/Unreal exporters remain outside this phase.

## Environment
- Everything for this handoff is under F:\Dev2\VFX-Tool.
- Existing editor port 5174; original lightning port 5173.
- Existing Node 24.3.0; approved/pinned React/Three/TypeScript/Vite dependencies.
- New @xyflow/react / fflate or other third-party packages need approval before installation/running.
- [RAN — historical] v1 had 46 passing tests and passing TypeScript/build; not rerun for documentation-only work.
- Project root is not currently a Git repository.
- F drive writes require the appropriate tool permission under the current sandbox.

## Key files
- docs/v2-plan/00-START-HERE.md — handoff index and authority.
- docs/v2-plan/19-WORK-PACKAGES.md — ordered implementation units and gates.
- docs/v2-plan/20-AGENT-HANDOFF.md — agent instructions and completion evidence.
- docs/v2-plan/effects/01-LIGHTNING.md — first visual benchmark.
- docs/v2-plan/references/original-lightning/ — original HTML/WAV/PNG plus hashes.
- docs/v2-plan/26-PLAN-AUDIT.md — review findings and integrity evidence.
