# VFX Studio

A browser tool for building visual effects (spells, elements, impacts) as editable node graphs, with a
deterministic 60 Hz simulation, a Three.js preview, ready-made components for ten elements, and an MCP server so
AI agents can do everything the editor can. Everything lives in `F:\Dev2\VFX-Tool`.

## Start

Double-click `Start-VFX.cmd` (keep its window open), then open **http://127.0.0.1:5174/?workspace=v2** in Chrome or
Edge. The old v1 editor is still at http://127.0.0.1:5174/ ("Back to v1 editor" in the new one).

Manual commands (Node 24+):

```text
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort   # dev server
bash tools/gate.sh                                                                 # type-check + all tests
node node_modules/vite/bin/vite.js build                                           # production build -> dist/
```

`dist/` must be served over HTTP (e.g. `vite preview`), not opened as a file.

## Using the editor

- **Add component** (below the preview): pick a ready-made effect (49 built-in, plus *My components*) and press
  Insert. It arrives as one component box; its knobs appear under **Controls** on the right.
- **Play / Restart / scrub** the timeline under the preview. **Glow**, **Dark/Light arena**, **Quality** and
  **Reduced effects** only change the preview, never the effect.
- **Start at** (every component) delays it, so parts play in sequence (charge → shot → impact).
- **Graph**: drag nodes, connect ports, select a node to edit it on the right. Double-click a component (or Open
  internals) to see inside; the breadcrumb goes back. Shift+click several nodes → **Group selection**. Select a
  component → **Save as my component** to reuse it anywhere. Delete key removes the selection; Enter opens a component.
- **Outline (parts list)** on the right lists the parts for keyboard/screen-reader use: select, switch on/off, open.
- **Files**: Keep (project list in this browser), Projects, Remove (goes to Trash, restorable), Save .json, Open…,
  Export pack (.vfxpack with imported images/models). Everything autosaves; the last five versions are kept. Two tabs
  on the same effect never overwrite each other.
- **Legacy v1**: pick an old v1 effect and **Convert a copy** — a new graph is made and a report lists what was
  converted. The original is never changed.
- **Imported assets**: import PNG/WebP/JPEG textures (with flipbook grid preview) and GLB models (with a picture and
  real size), then use them on a Material / MeshRenderer.

## For AI agents (MCP)

`.mcp.json` registers the `vfx` server (`mcp/vfx-mcp-reload.mjs`, which restarts itself when the code changes). Its
tools mirror every editor action (the map is in `STATE.md`, "Standing rule: MCP parity"): documents, nodes, edges,
knobs, components, groups, user components, imports, packs, legacy conversion, undo/redo, compile (with event and
tail reports), headless frame rendering (with camera, glow, lit/bright statistics), contact sheets, image comparison,
particle sampling, audio rendering, and `vfx_guide` (authoring recipes per element).
`node mcp/run-steps.mjs <file>` runs a scripted list of tool calls (see `mcp/examples/*.steps.json`).

## Where things are

- `src/model/` — document format, validation, controls/knobs, persistence, packs, legacy migration.
- `src/graph/` — node registry, graph analysis, compilers (particles, paths, audio), components, grouping.
- `src/runtime/` — deterministic particle and path simulation.
- `src/render/` — preview viewport (particles, ribbons, meshes, lights, bloom), built-in meshes.
- `src/editor/` + `src/PreviewV2.tsx` — the v2 editor. `src/App.tsx` + `src/core/` — the preserved v1 editor.
- `tools/` — sprite baker, component builder, per-element recipe generators, `gate.sh`.
- `mcp/` — MCP server, examples, guide, image tools.
- `docs/v2-plan/` — the plan; `27-GAP-AUDIT.md` tracks what was built with evidence; `evidence/` holds measurements.
- `licenses/` — third-party licences (all MIT) and the note that every included asset is procedural.

## Known limits

- Sound: the audio graph works (layered synthesis, filters, WAV export) but the effects' sounds were parked by the
  user and have not been listened to or tuned.
- Simulation runs on the main thread (measured < 1 ms per tick on average; a worker was not needed).
- No engine exporters yet (Unity/Unreal/Godot); documents are engine-neutral JSON.
- Performance figures in `docs/v2-plan/evidence/perf-2026-09-29.md` are CPU draw costs on one machine; GPU time is not isolated.
