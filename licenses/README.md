# Third-party libraries

All runtime libraries are MIT-licensed; their license texts are in this directory. Exact versions and the full resolved dependency graph are in `package.json` and `pnpm-lock.yaml`.

| Library | Version | Used for | License file |
| --- | --- | --- | --- |
| React, React DOM | 19.3.0 | editor UI | react-LICENSE.txt, react-dom-LICENSE.txt |
| Three.js | 0.186.0 | 3D preview, bloom, GLB loading | three-LICENSE.txt |
| @xyflow/react (React Flow) | 12.12.0 | node graph canvas | xyflow-react-LICENSE.txt |
| fflate | 0.8.3 | .vfxpack ZIP read/write (vetted 2026-09-27, see 27-GAP-AUDIT I11) | fflate-LICENSE.txt |
| @modelcontextprotocol/sdk | 1.30.1 | MCP server for agents | modelcontextprotocol-sdk-LICENSE.txt |
| zod | 4.6.5 | MCP tool argument schemas | zod-LICENSE.txt |
| gifenc | 1.0.3 | animated GIF export (vetted 2026-09-30) | gifenc-LICENSE.txt |
| mp4-muxer | 5.2.2 | MP4 container for exported video (vetted 2026-09-30) | mp4-muxer-LICENSE.txt |
| webm-muxer | 5.1.4 | WebM container for exported video (vetted 2026-09-30) | webm-muxer-LICENSE.txt |

Development-only: TypeScript (Apache-2.0), Vite (MIT), DefinitelyTyped declarations (MIT).

## Included assets

Every included sprite (`assets/sprites`: flame tongues, fire puff, smoke, foam, glows, sparks, electric arcs, droplets, ripples, dissolve noise) is generated procedurally by `tools/bake-sprites.mjs`, and every included mesh (rocks, shards, crystals, orb, cone, cylinder, box) is generated in code (`src/render/builtinMeshes.ts`). No downloaded textures, models, sound samples or AI-generated runtime assets are included, so no third-party asset licences apply. Assets a user imports keep their own licence; the `.vfxpack` manifest records their provenance.
