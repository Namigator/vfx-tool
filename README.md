# VFX Studio

A browser tool for building visual effects (spells, elements, impacts) as editable node graphs, with a
deterministic 60 Hz simulation, a Three.js preview, ready-made components for ten elements, and an MCP server so
AI agents can do everything the editor can. Everything lives in `F:\Dev2\VFX-Tool`.

## Start

Double-click `Start-VFX.cmd` (keep its window open), then open **http://127.0.0.1:5174/** in Chrome or Edge.
Effects made with the old editor open through **Import old effect** (an editable copy; the original is unchanged).

Manual commands (Node 24+):

```text
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort   # dev server
bash tools/gate.sh                                                                 # type-check + all tests
node node_modules/vite/bin/vite.js build                                           # production build -> dist/
```

`dist/` must be served over HTTP (e.g. `vite preview`), not opened as a file.

## Using the editor

- **Library** (left, or the Library button): **Presets** open a ready-made effect as a new effect, **Components** and
  **My Blocks** insert into the open one, **Assets** lists the included sprites and your imports. Search filters by
  name, element or type.
- **Add component** (below the preview): pick a ready-made effect (49 built-in, plus *My components*) and press
  Insert. It arrives as one component box; its knobs appear under **Controls** on the right.
- **Play / Restart / scrub** the timeline under the preview; ◀ ▶ step one tick, 0.25x/0.5x/1x speed, New seed each loop,
  Reset camera, Grid on/off (also hides the Source/Target markers). Selecting a node dims everything it does not draw. **Glow**, **Dark/Light arena**, **Quality** and
  **Reduced effects** only change the preview, never the effect.
- **Start at** (every component) delays it, so parts play in sequence (charge → shot → impact).
- **Graph**: drag nodes, connect ports, select a node to edit it on the right. Double-click a component (or Open
  internals) to see inside; the breadcrumb goes back. Shift+click several nodes → **Group selection**. Select a
  component → **Save as my component** to reuse it anywhere. Delete key removes the selection; Enter opens a component.
  Ctrl+D duplicates, Ctrl+C/V copy and paste (also between effects), right-click for the menu (Duplicate with the same
  random pattern, Delete and reconnect, Solo). Drag from a port into empty space to add a connected node.
- **Inspector**: curve and gradient editors (drag points or type values), Disconnect / Unbind / Jump to driver on
  driven fields, Reset block. An error in the list opens its node and field.
- **Outline (parts list)** on the right lists the parts for keyboard/screen-reader use: select, switch on/off, open.
- **Files**: Keep (project list in this browser), Projects, Remove (goes to Trash, restorable), Save .json, Open…,
  Export pack (.vfxpack with imported images/models). Everything autosaves; the last five versions are kept. Two tabs
  on the same effect never overwrite each other.
- **Import old effect**: pick an effect made with the old editor (or open its file) and press **Import** — a new
  editable copy is made and a report lists what was converted. The original is never changed.
- **Imported assets**: import PNG/WebP/JPEG textures as colour, mask, normal map or noise (flipbook grid and playback
  preview) and GLB models (with a picture and real size). **Add to effect** inserts a ready-made component that uses
  the asset; **Use on selected Material/MeshRenderer** applies it to an existing part. Relink, Remove and Clean up
  unused files keep the local library tidy.

## For AI agents (MCP)

`.mcp.json` registers the `vfx` server (`mcp/vfx-mcp-reload.mjs`, which restarts itself when the code changes). Its
tools mirror every editor action (the map is in `STATE.md`, "Standing rule: MCP parity"): documents, nodes, edges,
knobs, components, groups, user components, imports, packs, legacy conversion, undo/redo, compile (with event and
tail reports), headless frame rendering (with camera, glow, lit/bright statistics), contact sheets, image comparison,
particle sampling, audio rendering, and `vfx_guide` (authoring recipes per element, materials, curves and workflow tools).
`node mcp/run-steps.mjs <file>` runs a scripted list of tool calls (see `mcp/examples/*.steps.json`).

## Where things are

- `src/model/` — document format, validation, controls/knobs, persistence, packs, legacy migration.
- `src/graph/` — node registry, graph analysis, compilers (particles, paths, audio), components, grouping.
- `src/runtime/` — deterministic particle and path simulation.
- `src/render/` — preview viewport (particles, ribbons, meshes, lights, bloom), built-in meshes.
- `src/editor/` + `src/PreviewV2.tsx` — the editor. `src/core/` — the old effect format, kept only so old effects can be imported.
- `tools/` — sprite baker, component builder, per-element recipe generators, `gate.sh`.
- `mcp/` — MCP server, examples, guide, image tools.
- `docs/v2-plan/` — the plan; `27-GAP-AUDIT.md` tracks what was built with evidence; `evidence/` holds measurements.
- `licenses/` — third-party licences (all MIT) and the note that every included asset is procedural.

## Known limits

- Sound: the audio graph works (layered synthesis, filters, WAV export) but the effects' sounds were parked by the
  user and have not been listened to or tuned.
- Simulation runs on the main thread (measured < 1 ms per tick on average; a worker was not needed).
- No engine exporters yet (Unity/Unreal/Godot); documents are engine-neutral JSON.
- Performance figures in `docs/v2-plan/evidence/` are CPU costs on one machine (draw 1–8 ms, edit+compile p95 128 ms,
  seek p95 85 ms); GPU time is not isolated and real fps needs a focused browser window.
- Local particle space is not supported (world space only); refraction and liquid shading are preview enhancements.
