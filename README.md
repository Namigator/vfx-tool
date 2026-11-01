# VFX Studio

A browser tool for building game visual effects (spells, elements, impacts) as editable node graphs, and exporting
them to game engines.

**Try it:** https://demo.xpo.dev/avi/vfx-tool/

- 52 ready-made components across ten elements (fire, lightning, water, ice, earth, wind, poison, shadow, light,
  energy), each with a few friendly knobs, colour pickers and keyframes.
- A node graph underneath for full control, a deterministic 60 Hz simulation and a Three.js preview with glow.
- Exports: portable `.vfxpack`, sprite sheets / PNG sequences / GIF / MP4, and engine packages for Roblox (models
  with an aiming API), Unreal Engine 5 (Niagara, via the bundled importer plugin), Godot 4 (a scene) and Unity 6
  (a prefab, via the bundled importer). Each engine package has a `report.md` listing what it approximates or leaves out.
- Sounds: effects can carry layered sound in the editor (208 CC0 samples included); engine exports and video do not
  include sound yet.
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

Step-by-step import guides for every target are in [docs/ai-guide/export.md](docs/ai-guide/export.md):

| Target | You get | Import |
|---|---|---|
| Roblox | a model + `EffectPlayer` module | insert the model; `EffectPlayer.play(model, nil, { source, target, speed, scale })` |
| Unreal Engine 5 | `effect.json` + textures | install `integrations/unreal` (VfxStudioImporter plugin), then import the folder |
| Godot 4 | `.tscn` scene + textures | copy to `res://vfx_studio/<name>/` and instance the scene |
| Unity 6 | `effect.unity.json` + textures | copy `integrations/unity/VfxStudio` into Assets once, then **Tools > VFX Studio > Import Effect...** |

Unity: the built-in pipeline has no bloom, so add Bloom (URP Volume or Post Processing) for the editor's glow.

## Project layout

- `src/model/` document format, validation, knobs, persistence, packs
- `src/graph/` node registry, compilers (particles, paths, audio), components
- `src/runtime/` deterministic particle and path simulation
- `src/render/` preview viewport (particles, ribbons, meshes, lights, glow)
- `src/editor/`, `src/PreviewV2.tsx` the editor UI
- `src/export/` media, Roblox, Unreal, Godot and Unity exporters; `integrations/` the Unreal and Unity importers
- `mcp/` MCP server and examples; `tools/` build tools and generators; `tests/` the test suite
- `docs/ai-guide/` the guide; `docs/references/` the two reference effects the components were tuned against
- `licenses/` third-party licences and the included assets' sources ([licenses/README.md](licenses/README.md)): most sprites
  and all meshes are generated in code; 6 flipbooks and all 208 sounds are CC0, with per-file provenance

## Known limits

- Effect sounds are on their second tuning round; some presets still need better picks.
- The preview simulates in world space only.

## Privacy, licence and support

- Privacy: [PRIVACY.md](PRIVACY.md). Everything stays in your browser except AI-assistant requests and feedback you send.
- Licence for the tool itself: not chosen yet.
- Feedback and bug reports: the **Feedback** button in the editor.
