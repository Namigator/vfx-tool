// Writes src/export/roblox/assets.ts (the shipped Roblox asset ids) from the upload tools' local records:
// work/roblox/asset-ids.json (textures) and work/roblox/mesh-ids.json (meshes with a resolved MeshId).
//   node tools/roblox-sync-assets.mjs        run after tools/roblox-upload-textures.mjs / roblox-upload-meshes.mjs --resolve
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = f => (existsSync(join(root, f)) ? JSON.parse(readFileSync(join(root, f), 'utf8')) : {});
const textures = read('work/roblox/asset-ids.json');
const meshes = Object.fromEntries(Object.entries(read('work/roblox/mesh-ids.json')).filter(([, v]) => v.mesh).map(([k, v]) => [k, { model: v.model, mesh: v.mesh }]));
const ts = `// Roblox asset ids uploaded by tools/roblox-upload-textures.mjs and tools/roblox-upload-meshes.mjs (creator user
// 11041117443; public images and meshes any experience can use). Shipped so every export (editor, MCP, tools) references
// them; a local work/roblox/asset-ids.json adds or overrides texture ids. Regenerate: node tools/roblox-sync-assets.mjs.
/** Texture key (sheet file, "sheet.png#N" cell, "@beam-..." cross-section) -> image asset id. */
export const ROBLOX_TEXTURE_IDS: Record<string, string> = ${JSON.stringify(textures, null, 2)};
/** Built-in mesh kind -> uploaded Model and the MeshId of its one MeshPart. */
export const ROBLOX_MESH_IDS: Record<string, { model: string; mesh: string }> = ${JSON.stringify(meshes, null, 2)};
`;
writeFileSync(join(root, 'src/export/roblox/assets.ts'), ts);
console.log(`assets.ts: ${Object.keys(textures).length} textures, ${Object.keys(meshes).length} meshes`);
