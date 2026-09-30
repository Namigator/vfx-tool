# VFX Studio

A browser tool for building game visual effects (spells, elements, impacts) as editable node graphs, and exporting
them to game engines.

**Try it:** https://demo.xpo.dev/avi/vfx-tool/

- 49 ready-made components across ten elements (fire, lightning, water, ice, earth, wind, poison, shadow, light,
  energy), each with a few friendly knobs, colour pickers and keyframes.
- A node graph underneath for full control, a deterministic 60 Hz simulation and a Three.js preview with glow.
- Exports: portable `.vfxpack`, sprite sheets / PNG sequences / GIF / MP4, Roblox models (with an aiming API),
  and Unreal Engine (Niagara, in progress).
- An MCP server so AI agents can do everything the editor can, with a written guide for them.

## Run it locally

Node 24+ and pnpm:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

Then open http://127.0.0.1:5174/ in Chrome or Edge (on Windows, `Start-VFX.cmd` does both steps).

```bash
pnpm test      # all tests
pnpm build     # production build -> dist/ (serve it over HTTP, any sub-folder works)
pnpm guide     # regenerate the AI guide's reference pages
```

## Using it

Open the **Library**, pick a preset or add a component, then turn its knobs under **Controls**. Play, scrub and
step through the timeline; open a component's internals in the graph when the knobs aren't enough. Save as
`.json`, keep projects in the browser, or export. A full map of the editor: [docs/ai-guide/editor.md](docs/ai-guide/editor.md).

## For AI agents (MCP)

`.mcp.json` registers the `vfx` MCP server (`mcp/vfx-mcp-reload.mjs`). Its `vfx_*` tools mirror every editor
action (documents, nodes, knobs, components, imports, exports, compile) and can render frames headlessly so an agent
can look at what it built. Start with the guide: [docs/ai-guide/README.md](docs/ai-guide/README.md), also served by
the `vfx_guide` tool. `node mcp/run-steps.mjs <file>` runs a scripted list of tool calls (see `mcp/examples/`).

## Exporting

See [docs/ai-guide/export.md](docs/ai-guide/export.md): packs, media, Roblox (`EffectPlayer.play(model, nil,
{ source, target, speed, scale })`) and Unreal.

## Project layout

- `src/model/` document format, validation, knobs, persistence, packs
- `src/graph/` node registry, compilers (particles, paths, audio), components
- `src/runtime/` deterministic particle and path simulation
- `src/render/` preview viewport (particles, ribbons, meshes, lights, glow)
- `src/editor/`, `src/PreviewV2.tsx` the editor UI
- `src/export/` Roblox, media and Unreal exporters
- `mcp/` MCP server and examples; `tools/` build tools and generators; `tests/` the test suite
- `docs/ai-guide/` the guide; `docs/references/` the two reference effects the components were tuned against
- `licenses/` third-party licences; every included sprite is procedurally generated

## Known limits

- Sound works technically but the effect sounds are not tuned yet.
- The preview simulates in world space only.
