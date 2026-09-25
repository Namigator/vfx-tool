# STATE — VFX Tool

**Goal:** A simple composable web VFX/SFX node tool with ten editable elemental defaults, original-lightning quality floor, and an engine-neutral design for future exporters.

## Now
- Claude Opus 5.5 LOW in visible squad terminals does implementation; Codex coordinates and validates. No built-in agents. Wait for reports; fallback status check after ten minutes.
- [RAN] Latest full gate: 253 tests pass, TypeScript pass, production build pass. These are proxy evidence for user-visible effects.
- [SAW] v2 browser graph and point preview captured at `evidence/wp03-preview/graph-preview.png`; add/disable/undo, parameter editing/validation, typed connection acceptance/rejection, and connected-node deletion tested in browser. Node dragging remains unverified.
- [PROXY] GraphCanvas and NodeInspector corrections passed independent static review. Path core passed static review. Branch core review FAIL pending contract correction.
- Active: claude-model task fda137ca branch semantic RNG IDs; claude-controls task 96187e5d path/ribbon node catalog. Inspector idle for next review.

## Next
1. Receive Claude reports, review branch correction and catalog, run focused/full gates, checkpoint.
2. Build a pure graph-to-path/ribbon preview adapter, then reusable camera-facing ribbon renderer and browser visual check.
3. Iterate original-lightning parity before accepting other elemental presets; complete SFX, persistence, assets, and ten families later.

## Known limits
- [SAW] Current v2 output is one white point, far below target lightning quality. v1 fire/water/shadow remain user-rejected.
- [UNVERIFIED] Node drag has no conclusive browser evidence; CUA single-step drag cannot exercise ReactFlow's full pointer sequence.
- [PROXY] Branch random key uses semantic parent path ID; review requires versioned plan amendment, invariance test, and finite endpoint guard.
- [PROXY] Current preview supports point emitters only. No path/ribbon rendering, improved lightning, full ten families, SFX graph, asset persistence, or engine exporters yet.

## Environment
- Root `F:/Dev2/VFX-Tool`, branch `squad/vfx-v2`, checkpoint `65adb74` plus uncommitted UI/path work. F writes/Git/squad need escalation.
- Vite `http://127.0.0.1:5174/`, v2 `?workspace=v2`, PID file `work/dev-server.pid`. Doctor/shot in `C:/Users/itonk/.claude/tools/`.
- Approved deps: ReactFlow 12.12.0 plus 19 vetted transitives, `evidence/dependencies/react-flow/`. Any NEW package requires inspector vetting before installation or execution.
- Test `node --experimental-strip-types --test tests/*.test.ts`; typecheck `node node_modules/typescript/bin/tsc --noEmit`; build `node node_modules/vite/bin/vite.js build`.
- Squad instructions and recovery: `SQUAD.md`; manager `vfx-manager`; receive with `F:/Dev2/squad/squad.exe receive vfx-manager --wait --timeout 45 --json`. No broad cleanup of agents/processes.

## Key files
- `docs/v2-plan/00-START-HERE.md` — 37-doc implementation plan.
- `src/graph/registry.ts`, `src/graph/toParticles.ts` — catalog and current preview compiler.
- `src/runtime/paths.ts`, `branches.ts` — pure path geometry.
- `src/PreviewV2.tsx`, `src/editor/*`, `src/render/PreviewViewport.ts` — current v2 web UI.
