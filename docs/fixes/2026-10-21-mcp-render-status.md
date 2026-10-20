# MCP render status (2026-10-21)

Status: written by GPT sol 6.1 (Codex, edit-only); verified by Claude 2026-10-21:
- [RAN] `npm test` 750/750 after `npm run guide`; `tsc --noEmit` clean.
- [RAN] live MCP `vfx_render_frames`: fresh dev server -> success, frame looked at (fireball at t30); old prebuilt `dist/` on a static server -> fails with "did not report its status"; invalid document via the beacon -> fails with the page's validation message.
- Not run live: signature mismatch (unit test only), `vite preview`, `vfx_contact_sheet`, the two standalone tools.

## External GPT tester report

1. `vfx_render_frames` reported success when its PNG contained a validation error or a blank page.
2. MCP accepted `axisMode` using this checkout's registry, but a stale prebuilt editor rejected it using older definitions. The error screenshot was still counted as rendered.

## Root cause

Pre-change locations: `mcp/server.ts:719` (`renderFrames`), especially lines 731–736, accepted any existing screenshot after Chrome. `src/capture.ts:18` (`fail`) only set the title and message; `src/capture.ts:99` set READY without an external status channel. A screenshot does not expose the title. MCP's `createRegistry()` (`mcp/server.ts:103`) and the independently served capture bundle (`src/capture.ts:27`) could contain different definitions.

## Changes

- Each MCP capture uses a random nonce. The page POSTs `{run,tick,state,message?,registry}` to `/__vfx/capture-status` only with a run query parameter. Success awaits the POST before READY. Failures, including viewport callbacks, latch failure and serialize reports so success cannot overwrite an error.
- `tools/captureStatusPlugin.ts` installs the same middleware in Vite dev and preview. It validates the run id, limits the body to 64 KiB, creates `work/mcp/frames/status/`, writes the JSON and responds 204 only after writing. Invalid JSON/ids return 400; write errors return 500.
- `src/graph/registrySignature.ts` hashes sorted types, definition versions and sorted parameter ids plus the document schema version. MCP and capture use `createRegistry()` and the same pure function.
- MCP reads and removes the nonce file after Chrome. Missing status, malformed status, mismatched definitions, wrong ticks and error states reject the capture; errors include the PNG path and image. Existing no-image/timeout handling remains. Only accepted statuses reach the rendered count.
- Contact sheets call `renderFrames`. The standalone `tools/layer-brightness.mjs` and `tools/roblox-fidelity.mjs` callers now request/check status via `tools/captureStatus.node.ts`.
- The generated MCP guide is untouched. Its source tool description changed; regenerate `docs/ai-guide/reference/mcp-tools.md` with `npm run guide`.

## Verification for Claude

Run from `F:/Dev2/VFX-Tool`:

```powershell
node --experimental-strip-types --test tests/mcp-capture-status.test.ts tests/v2-mcp.test.ts
node node_modules/typescript/bin/tsc --noEmit
npm test
npm run guide
```

Start this checkout's server with `npm run dev`. Through MCP create an f01 document and call `vfx_render_frames` at tick 7; inspect the PNG and returned message. Repeat through `vfx_contact_sheet`. Check the consumed nonce file is removed. Exercise a capture-page validation failure and a PreviewViewport onError failure; the beacon must be error and READY must never replace ERROR. Use a stale editor without the beacon to check the missing-status diagnostic, then a beacon-capable build with an added/removed parameter to check the signature diagnostic. Repeat endpoint checks with `npm run build` then `npm run preview` (stop dev first). Test the two standalone callers with existing local comparison inputs. No browser or script execution was performed in this edit-only session.

## Known limits / untouched scope

- `vfx_export_media` and protected `tools/render-layer-clips.ts` use `capture-media.html` and `chromeEval`, not `renderFrames`. They do not gain this registry beacon check. Protected `src/captureMedia.ts`, `src/export/media/render.ts` and `tools/render-layer-clips.ts` were not edited.
- This is a metadata fingerprint, not a renderer/content checksum: defaults, bounds, shader/runtime changes and hash collisions are outside its guarantee. A matching, beacon-capable prebuilt editor can pass. Blank imagery without a reported error is not detected; visual inspection remains required.
- Missing status can also mean a failed POST, unwritable directory, page load failure or editor/MCP using different filesystem roots. The diagnostic says probably stale, not certainly stale. The editor must write into the same checkout MCP reads.
- Network errors are intentionally ignored by the page; MCP fails closed on missing status. A hung POST may outlive Chrome's capture budget and cause rejection. Reports arriving after process timeout can leave orphan status files. The local development endpoint is not an authenticated remote rendering service.
- Benchmark mode uses BENCH rather than READY and is not used by these MCP frame tools. No beacon was added to media or benchmark completion.
