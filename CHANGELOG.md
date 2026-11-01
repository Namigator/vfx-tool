# Changelog

## 0.1.0 (first public release, not tagged yet)

DRAFT (P-09), 2026-11-01. The version number and release date are set when the owner tags the release.

### Editor
- Ten elements (fire, lightning, water, ice, earth, wind, poison, shadow, light, energy): 52 ready-made components and
  ready-made presets, each with a few knobs, colour pickers and keyframes.
- Node graph underneath for full control: groups, breadcrumbs, keyboard shortcuts, curve and gradient editors, and
  compact cards when zoomed out on big graphs.
- Deterministic 60 Hz simulation with a Three.js preview (glow, ribbons and beams, meshes, lights, dissolve).
- Timeline: play, scrub, step, and per-component start times and events.
- Layered effect sounds in the editor (208 CC0 samples).
- Projects autosave in the browser; save and open `.json`, import your own images, meshes and sounds.
- Optional AI assistant using your own provider and key, or a model on your own computer.
- In-editor Feedback form.

### Export
- Portable `.vfxpack`; sprite sheets, PNG sequences, GIF, MP4/WebM.
- Roblox: a model plus the `EffectPlayer` module (`play(model, nil, { source, target, speed, scale })`).
- Unreal Engine 5: Niagara through the bundled VfxStudioImporter plugin.
- Godot 4: a `.tscn` scene with particles, an AnimationPlayer and baked beams.
- Unity 6: a prefab through the bundled importer (built-in pipeline and URP).
- Every engine package includes a `report.md` listing what it approximates or leaves out.

### For AI agents
- MCP server whose `vfx_*` tools mirror every editor action and render frames headlessly, plus a written guide.

### Known limits
- Engine exports and video carry no sound.
- The preview simulates in world space only.
- Unity: no bloom in the built-in pipeline, and URP sprites are dimmer than in the editor.
- Some effect sounds still need better picks.
- Very large graphs (200+ nodes) respond to clicks in about 0.1 s.
