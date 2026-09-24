# STATE — VFX Tool

**Goal:** Expandable-node VFX/SFX authoring with original-lightning quality, ten editable spell defaults, and future engine-independent export inputs.

## Now
- User authorized Claude squad workers in visible terminals; no built-in or nested agents. Default Opus5.5 LOW, higher only justified per task. All current tasks LOW.
- [RAN] Reviewed WP01a/b model and controls preserved in commits aa4d4d2/9ed648c on squad/vfx-v2. Full plan at docs/v2-plan/00-START-HERE.md.
- [RAN] WP01c/WP02a foundations: ten-node registry and F01, typed signatures, graph analysis, deterministic random and fixed-step clock. Full170 tests pass; TypeScript exit0. [PROXY] reviewer accepted bounded slice. evidence/wp02a/README.md lists exact limits.
- Active claude-model task a1c0bd12-d0ae-4cf7-a8b5-d4128ad2e610: src/graph/expand.ts and tests/v2-expand.test.ts.
- Active claude-controls task59a5638e-0c18-4a30-bf05-771ccaa7a04f: src/runtime/particles.ts and tests/v2-particles.test.ts.
- Reviewer idle pending these outputs; contract docs/implementation/WP02B-WP03-WORKER-CONTRACT.md. Manager owns tests/Git/shared integration.
- [SAW] Existing v1 preview reopened and lightning inspected after computer restart: http://127.0.0.1:5174/. PID2244, work/dev-server.*.log. Browser tab marked deliverable. New modules are NOT wired into UI.

## Next (in order)
1. Collect group-expansion/particle outputs, run focused checks, independent review, fix findings and checkpoint. Preserve active worker ownership.
2. Implement enabled-state lowering/descriptors, connect F01 to actual renderer, then editor skeleton; finish production catalog/signal specialization alongside. Do not represent primitives as completed work packages.
3. Complete original full-cycle reference/GPU evidence before renderer acceptance; lightning parity and reuse gates precede other effect families.

## Known failed / unverified
- [UNVERIFIED by agent; user-reported] v1 fire/water/shadow unacceptable, lightning below original. No visual quality fix yet.
- [UNVERIFIED] v2 node UI/render/audio/performance not implemented or accepted. Unity/Roblox/Unreal exporters out of this phase.
- [PROXY] Typed analysis is conservative for group-boundary cycles and driven-zero emission. No signal expression evaluation/disabled fallback rewrite/full budgets yet. Dynamic Constant/PublicParameter deliberately not registered.
- [PROXY] Interface default typing, production asset default references/availability, complete catalog/material controls and angular units remain. Existing random/clock/registry tests do not establish visual quality.
- [SAW] Original archived PNG depicts charge only; full-cycle clip/GPU reference still pending.
- React Flow12.12.0 dependency approval requested through async user question, pending. Do not install until approved. Existing React/Three/TS/Vite approved; @xyflow/react/fflate are additional packages.

## Environment
- Root F:/Dev2/VFX-Tool. F writes/squad operations need Codex escalation. Node24.3.0, erasable TS.
- Tests: node --experimental-strip-types --test tests/*.test.ts; types: node node_modules/typescript/bin/tsc --noEmit.
- Restored visible terminal PIDs model7216/controls12584/review25964. Process records in .squad/logs/*.process.json authoritative; confirm actual process before restart. No global squad clean.
- Inspector read-only tools Read/Glob/Grep now use default permission mode; plan mode incorrectly required unavailable plan-file tools. Worker acceptEdits restricted file tools, no shell/network/nested agents. SQUAD.md and tools/squad-agent.ps1.
- Prior turn hit usage-limit error in automatic approval review. Current user explicitly resumed; new authorized operations succeeded. No approval bypass used.
- doctor/shot paths: C:/Users/itonk/.claude/tools (not original .codex/tools). Doctor completed after restart.

## Key files
- docs/implementation/WP01-REPRESENTATION-DECISIONS.md, WP01B/WP01C/WP02A contracts — accepted interpretations.
- docs/implementation/WP02B-WP03-WORKER-CONTRACT.md — current parallel scopes and exact APIs.
- src/model/, src/graph/, src/runtime/; tests/v2-*.test.ts.
- evidence/wp01a/, wp01b/, wp02a/, wp03-random/; docs/v2-plan/references/original-lightning/.
