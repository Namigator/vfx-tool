# Assets, included library and import

## Included library requirement

Ship assets with the application, load locally, and use the same Asset browser for included and imported assets. No default may depend on a CDN, unavailable external file or AI request. Asset creation and licensing are first-class implementation work, not placeholders deferred until after preset completion.

Minimum library:
- 16-frame lightning charge/noise accents plus radial core/halo masks.
- Two 16-frame flame tongue flipbooks with different silhouettes.
- One 16-frame smoke/dust evolution flipbook and two static wisp masks.
- One 16-frame splash/foam flipbook, droplet mask, ripple and streak masks.
- One dark-wisp flipbook, dissolve noise and cellular bubble mask.
- Star/ray/ring masks; spark streak; neutral gradient/noise utilities.
- Built-in shard, three rock variants, orb, plane, cone and tapered ribbon geometry.
- Ten procedural sound group templates, plus any recorded samples that pass provenance and audition gates.

Prefer project-authored procedural art baked at authoring/build time. This is not restricted to simplistic runtime circles: offline tools may bake detailed noise, masks, animated textures and mesh silhouettes. The source recipe/script and seed accompany each generated asset. If generated art fails visual review, use artist-authored or verified CC0 assets with recorded source/rights; do not quietly mark low-quality placeholders complete.

Default flipbooks: 4×4 grid, 256-pixel cells including padding, 1024×1024 RGBA atlas. Larger assets require measured benefit. Noise/mask assets 256 or 512 square. Include actual thumbnails, dimensions, frame count, intended usage and license/provenance in the library.

## User imports

| Kind | Accepted v2 input | Limits |
| --- | --- | --- |
| Color/mask/normal texture | PNG, static WebP, JPEG for color only | 16 MiB/file; max 4096×4096; decoded RGBA budget enforced |
| Flipbook | PNG/WebP atlas + user-entered grid | 1–16 rows/columns; ≤256 frames; dimensions divisible by grid |
| Mesh | self-contained GLB 2.0 | 20 MiB; ≤50k triangles total; ≤8 materials; ≤16 primitives |
| Sound | WAV PCM16/PCM24/PCM32 or float32 | 20 MiB; mono/stereo; 8–96 kHz; ≤10 s |

No remote URL import, SVG, executable HTML, animated WebP, video, ZIP-with-arbitrary-assets shortcut, compressed-mesh decoder extension, skeleton, morph target or animation in v2. GLB external URIs, cameras and lights are rejected; static mesh hierarchy is flattened with transforms applied. Unsupported required extensions fail with an actionable list. Accept only core glTF geometry/materials and KHR_materials_unlit; map supported PBR fields explicitly and warn on ignored optional extras.

Check dimensions/counts from headers before expensive decode, then verify decoded results. All asset parsing is staged; failure leaves the active document unchanged. Audio is normalized to canonical 48 kHz float PCM using project-owned deterministic linear resampling before waveform use; preserve original bytes for export/provenance.

## Import wizard

Inspect → classify role → preview → set metadata → add. For textures choose color/mask/normal/noise; do not infer color space solely from filename. For flipbooks show cell overlays, playback and frame ordering left-to-right, top-to-bottom. For GLB show meter scale, rotate/fit preview, material mapping and estimated cost. User confirms a uniform import scale; source file bytes remain unchanged. For WAV show duration, channels and waveform with a user-gesture play button.

After import, an explicit Add to effect action creates a suitable ready-made component. Import alone does not modify the active graph.

## Identity, provenance and ownership

Asset ID derives from SHA-256 of original bytes plus interpretation metadata hash; identical bytes with color and mask roles may share storage but have different interpretation IDs. Store byte hash separately for deduplication and archive integrity.

Provenance fields: origin authored/imported/external, original filename, author if known, source URL if external, license identifier/text or "user-provided; license unspecified", and modification notes. Never invent a license. Unknown license on a user's personal import warns on sharing but does not prevent local use. Shipped external assets require verified redistribution rights and included notices. Project-authored assets record their generation/source history.

## Memory and missing references

Asset records own immutable bytes. GPU textures/meshes are derived caches with refcounts. Undo history holds references; deleting an asset used by a graph is blocked with a list of references. Offer Replace references, not silent pink material replacement. Orphans can be explicitly cleaned after history eviction.

Missing assets show a named placeholder in the Asset browser and block validated playback/export of affected reachable nodes. Allow relink by selecting a local file; require expected hash or explicit Replace as new asset so old projects do not change invisibly.

## Packaging

Portable archives embed all referenced assets, including built-ins, so a later library update cannot alter an old effect. Include per-asset metadata and license/provenance. Prune unreferenced asset bytes from exports only; do not delete the local library.

