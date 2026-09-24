# STATE — VFX Tool

**Goal:** A simple expandable-node VFX/SFX authoring tool capable of the original lightning quality, with ten rich game-spell defaults and future engine-independent export inputs.

## Now
- Full planning handoff: docs/v2-plan/00-START-HERE.md (37 Markdown docs, 28 work packages, 39 test scenarios).
- [RAN] Planning links/coverage/dependencies/reference checksums audited before implementation; original planning audit remains a historical baseline.
- User explicitly authorized Claude agents through squad in visible terminals on 2026-09-24. This supersedes the plan snapshot's solo/planning-only instruction. No nested/built-in agents.
- [RAN] Git baseline 02c883d preserves v1 plus the full handoff. Active branch: squad/vfx-v2. Existing 46 tests and TypeScript passed at baseline.
- [RAN] Official installed Claude executable signature is valid (Anthropic, PBC); project-local launcher adapted from existing squad tools. No new third-party package installed.
- [RAN] User renewed Claude sign-in; both visible wrappers restarted and saved tasks requeued. Explicit model claude-opus-5-5 with process-local CLAUDE_CODE_EFFORT_LEVEL=low, per user preference. [RAN] Fresh logs show both agents reading assigned files after sign-in; WP01a draft has 11 passing tests but a TypeScript BufferSource error; rework task 07f9aea0-f2b7-4469-9899-91b02f976aa8 is active. Acceptance remains pending.
- [PROXY] Claude reviewer accepted docs/implementation/WP01-REPRESENTATION-DECISIONS.md; separate code review remains required.
- WP00 partial: source/reference preserved and baseline checks pass; full reference clip/GPU/dependency vetting remain pending. Independent WP01 contract slice may proceed; no visual gate claimed.

## Next (in order)
1. Monitor the resumed WP01a worker and contract inspector; run checks, request code review, and record remaining WP01 scope.
2. Complete reference capture/environment evidence and WP01 validation before dependent compiler/runtime integration.
3. Follow WP02–WP12 through lightning parity before expanding effect families.

## Known failed / unverified
- [UNVERIFIED by agent; user-reported] v1 fire/water/shadow unacceptable; v1 lightning substantially below original.
- [SAW] Archived original PNG is charging only, not discharge evidence.
- [UNVERIFIED] v2 visuals/audio/performance not implemented or accepted; actual GPU unknown.
- [UNVERIFIED] Future Unity/Roblox/Unreal exporters excluded from this phase.
- [RAN] Original doctor/shot paths under .codex/tools absent; alternatives found under C:/Users/itonk/.claude/tools. Doctor -Quiet completed without reported issues this session.

## Environment
- Everything belongs under F:/Dev2/VFX-Tool. F drive mutations require appropriate permission under Codex sandbox.
- Existing editor port 5174; original lightning 5173. Node 24.3.0; no TS parameter properties with strip-types.
- Approved React/Three/TypeScript/Vite; new @xyflow/react/fflate packages require approval before install/run.
- Tests: node --experimental-strip-types --test tests/*.test.ts
- Types/build: node node_modules/typescript/bin/tsc --noEmit; node node_modules/vite/bin/vite.js build
- Squad: F:/Dev2/squad/squad.exe; manager vfx-manager. See SQUAD.md for visible Claude setup.

## Key files
- docs/v2-plan/00-START-HERE.md — authority for design, indexed subsystem specs.
- docs/v2-plan/19-WORK-PACKAGES.md — dependencies and gates.
- docs/v2-plan/20-AGENT-HANDOFF.md — evidence/completion rules (current delegation authority above supersedes solo text).
- docs/v2-plan/04-DOCUMENT-FORMAT.md and 25-INTERFACE-CONTRACTS.md — first implementation contracts.
- docs/v2-plan/references/original-lightning/ — preserved original source/audio/image.
