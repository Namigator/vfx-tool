# WP03 path preview adapter

`src/graph/toPaths.ts` — `compilePathPreview(input: unknown, effectTick: number): ValidationResult<PathPreviewPlan>`.
Pure (no DOM/React/Three), same pipeline as `toParticles.ts`: `createRegistry → analyzeGraph → expandGroups`,
resolved parameters from expansion, addressed diagnostics (`nodeId`, `fieldPath`).

## Scope
- Layers: enabled `RibbonRenderer` sinks on root `EffectOutput.visual`, in connection order. `BillboardRenderer`
  sinks are skipped (they belong to `compileParticlePreview`); any other visual source is `UNKNOWN_NODE`.
- Path nodes: `LinePath`, `BezierPath` (handles are offsets from their endpoint), `JaggedPath`, `BranchPath`
  (`trunk` and `branches`), `RevealPath`. Geometry comes from `runtime/paths.ts` and `runtime/branches.ts`;
  no lightning-specific recipe exists here.
- Layer metadata: width, widthOverPath curve, uvMode, uvTileLength, orientation, renderOrderOffset, material
  tint/opacity/emission/blend/alphaCutoff (SpriteUnlit only), window and `active`.

## Decisions
- Semantic path IDs (plan24 A1): generator output index `p<i>` (Line/Bezier: `p0`); modifiers keep IDs;
  branches `<parentId>/b<k>`. Node IDs never enter path IDs or random keys, so renames and Preserve-pattern
  copies are geometry-identical; changing `randomStreamId` changes the pattern.
- Jagged: `pathOrdinal` = index in input set; time = `effectTick / TICKS_PER_SECOND` (60, the canonical clock).
- Geometry is effect-local, then the root transform (scale → rotate → translate) is applied once per point.
  Width and uvTileLength are multiplied by root scale. `groundY`, handles, amplitude and lengths are effect-local.
- Disabled: Line/Bezier → empty set; Jagged/Reveal → bypass; Branch → trunk = input, branches empty;
  Ribbon → no layer; window Schedule → `window: null`, never active; Material/Anchor → `MISSING_REFERENCE`.
- Unconnected window = whole document; repeat-mode window is rejected. At/after document end all layers are
  inactive. Validation is tick-independent (geometry is always evaluated; inactive layers carry no paths).
- Rejected: connections into parameter ports, exposed-control drivers, connected audio/presentation,
  literal group defaults on structural inputs, non-integer/negative `effectTick`.
- Budget: `MAX_PREVIEW_PATHS` 4096 and `MAX_PREVIEW_POINTS` 262144 over all evaluated node outputs (each output
  evaluated once per compile); BranchPath checks its projected count before generating.

## Browser preview (PreviewV2)
- `render/previewMode.ts` `choosePreviewMode`: any RibbonRenderer on root `EffectOutput.visual` → path mode;
  plus an enabled BillboardRenderer → `mixed`, an addressed error (no layer is silently dropped); else points (F01).
- Path mode compiles tick 0 in the UI, then `PreviewViewport.setPathSource` recompiles per landing tick
  (play/scrub/restart; no replay needed). One `RibbonGeometry` + mesh per layer, rebuilt only when the layer
  set/material changes; re-billboarded when the camera moves. Inactive layers draw nothing.
- Material tint/opacity/emission/blend (incl. cutout via alphaCutoff) and renderOrderOffset are honoured.
  Nontrivial `widthOverPath` and `orientation: parallelTransport` block the preview with addressed errors;
  `uvMode: tile` is a warning (ribbons are untextured).
- "Load lightning demo" (Advanced) loads the shared editable L01 fixture (`createL01Document`): Bezier → Jagged → primary Branch → secondary Branch, feeding seven ribbons (four trunk layers, branch glow/core, fork).

## Limitations
- One tick per compile (no cached per-tick re-evaluation); RevealPath fraction is literal only (no effectTime signal).
- `compileParticlePreview` still rejects RibbonRenderer visual sources, so mixed graphs need a combined caller.
- No HelixPath/RadialPath/PathFollower/ParticlePaths. The Three preview renders camera-facing untextured ribbons; width shaping and parallel-transport orientation are still unsupported.
