# STATE — VFX Tool

**Goal:** Expandable-node VFX/SFX authoring, original-lightning quality minimum, ten editable elemental defaults, future engine-neutral export inputs.

## Authority and workflow
- User requests Claude squad agents in VISIBLE terminals, default Opus5.5 LOW. No built-in/nested agents. Codex coordinates/checks/integrates; Claude does implementation and independent review.
- User authorizes new packages ONLY after inspector vetting. Do not ask again for accepted packages. ReactFlow12.12.0 +19 dependencies vetted and installed; evidence/dependencies/react-flow.
- Wait for worker completion reports. Do not repeatedly poll workers/logs. Ten-minute fallback check if no report; startup/failure recovery may inspect exact affected process/task.

## Current evidence
- [RAN] Full223 tests pass. TypeScript and production build pass after vetted package installation. Build warns about >500kB Three/OrbitControls chunk.
- [PROXY] Independent static reviews PASS for expansion, corrected particle core, graph-to-particle adapter, transactional history and preview lifecycle. Reviews in evidence/wp03-preview. Known limits below.
- [SAW] F01 graph-driven preview: white particle over grid at tick0, empty at120, rewind restores particle. Revised transport no longer spills into JSON panel at1280x720. This is a point-particle primitive preview, NOT completed VFX quality or node editor.
- [RAN] ReactFlow20-package addition: all archive hashes and npm registry signatures validated; lock preserves77 previous package versions/integrities. Installed with scripts disabled and frozen pnpm lock. pnpm10.15.1 already installed; node_modules was recreated from approved locked versions because previous layout reportedpnpm11.19.0. Project-local .pnpm-store ignored.

## Active Claude assignments
- claude-model: f3450eb2-802c-4e60-a566-af39c5ce02b7 — NEW editor/GraphCanvas.tsx + graph-canvas.css. Controlled ReactFlow from document, named typed handles, enabled/delete/add, drag transaction, typed connection validation. No workspace edits.
- claude-controls: 6c868e9d-4943-4243-9dea-6da9941df638 — integrate GraphCanvas/history into PreviewV2.tsx + preview-v2.css; minor callback-disposal guard/comment in render/PreviewViewport.ts. Graph below viewport, authoritative history, undo/redo, editable invalid graphs, advanced JSON, selected-node summary. No inspector implementation yet.
- claude-review idle after PASS; review canvas/integration after reports and tests. Reports via squad receive vfx-manager --wait --timeout45 --json. No frequent status checks.

## Next3 steps
1. Collect canvas/integration reports, typecheck/build and independent review; test real browser add/disable/connect/drag/undo/invalid graph. Fix addressed findings through Claude.
2. Add metadata-based parameter inspector, finish ordinary catalog/signal evaluation and renderer primitives as bounded parallel scopes. Keep primitives distinct from full work-package acceptance.
3. Capture full original lightning cycle, then reusable lightning components/parity and blank-authoring proof before other elemental families. Full37-doc plan docs/v2-plan/00-START-HERE.md.

## Known limits / not accepted
- User-reported v1 fire/water/shadow unacceptable; lightning below original. None claimed visually fixed.
- Preview supports point/world emitters, equal speed range, neutral rotation/angular fields, SpriteUnlit camera billboards and schedule bursts/single window. Unsupported reachable settings/signals/audio/presentation produce addressed errors. Group interface literal defaults unsupported by adapter. This is not full WP02/03/04/07 completion.
- Core particle random keys deterministic; IDs only unique per emitter, namespace by systemId across branches. Expansion512/1024 limits. Renderer buffers reused but simulation snapshots allocate per tick; no performance claim. Scrub replays from0, potentially slow at8192x600.
- History has100 transactions/20MiB inverse-patch limit; active transaction memory only limited atcommit. No persistence/asset handling yet. Camera/selection are not to be sent through authored history.
- Inspector review identified callback dispose reentrancy guard; assigned to integrationworker. Full context-loss, automated viewport tests, screenshot regression coverage still pending.
- Original archived PNG showschargeonly; discharge/impact/decay and GPU benchmark evidence still pending. No engine exporters in this phase.

## Environment and recovery
- Root F:/Dev2/VFX-Tool; branch squad/vfx-v2. Last prior checkpoint962a7ed; recovered changes now being checkpointed.
- Vite http://127.0.0.1:5174/ v1, ?workspace=v2 newpreview. Restarted PID28436; work/dev-server.pid authoritative. Output work/dev-server.*.log. New browser tab3 marked deliverable; v1 preserved.
- F writes/squad/Git need Codex escalation. Node24.3.0, existingCorepackpnpm10.15.1; do not mix npm lockfiles. pnpm install --frozen-lockfile --ignore-scripts --store-dir F:/Dev2/VFX-Tool/.pnpm-store.
- Claude auto-updated2.1.280->2.1.281. Installed executable Authenticode Valid AnthropicPBC; launcher path updated.
- Restarting squad sessions by leave/requeue caused lease races and stale inbox failures; fixed wrapper bounded SQLite-lock retry and skip stale task notices. For failed wrapper with active registration, restart exact terminal with -ResumeExistingRegistration, WITHOUT leave/requeue. Never globalclean. Processrecords .squad/logs/*.process.json. Do not assume oldPIDs.
- tools/squad-agent.ps1 uses restricted file-only tools, no shell/network/nestedagents; inspector readonly. Start-ClaudeSquad.ps1 visible terminals. SQUAD.md contains details.
- Doctor and shot are C:/Users/itonk/.claude/tools (not .codex/tools); lastdoctorclean. User explicitly asked screenshots and actual inspection.

## Key code
- model/*, graph/registry/signature/analyze/expand/toParticles/fixtures; runtime/random/clock/particles; editor/history.
- PreviewV2.tsx, render/PreviewViewport.ts, preview-v2.css; main.tsx lazy-loads exactly one workspace and its CSS.
- tests/v2-*.test.ts; commands node --experimental-strip-types --test tests/*.test.ts and node node_modules/typescript/bin/tsc --noEmit.
