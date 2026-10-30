// Uploads the built-in meshes (src/export/meshObj.ts, the editor's geometry) to Roblox as Model assets (one MeshPart
// each, from a generated .glb) and records the model asset ids in work/roblox/mesh-ids.json ({ kind: { model } }).
// The exporter needs each MeshPart's MeshId, which only the Asset Delivery API returns (key scope legacy-asset:manage);
// resolving it is a separate step.
//
// DRY RUN by default: lists what would be uploaded. Uploading publishes to the Roblox account that owns the API key,
// so it only happens with --yes (owner approval).
//
//   node --experimental-strip-types tools/roblox-upload-meshes.mjs --creator-user <userId> [--yes] [kind ...]
//
// Needs ROBLOX_OPEN_CLOUD_API_KEY with the "assets" read+write permission (never printed).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtinMeshObj } from '../src/export/meshObj.ts';
import { BUILTIN_MESHES } from '../src/render/builtinMeshes.ts';

/** Minimal binary glTF (one mesh, non-indexed triangles, POSITION + NORMAL) from OBJ text with v / vn / f a//a lines. */
export function glbFromObj(obj, name) {
  const v = [], vn = [], pos = [], nrm = [];
  for (const line of obj.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') v.push(t.slice(1, 4).map(Number));
    else if (t[0] === 'vn') vn.push(t.slice(1, 4).map(Number));
    else if (t[0] === 'f') for (const c of t.slice(1, 4)) { const [a, , b] = c.split('/').map(Number); pos.push(...v[a - 1]); nrm.push(...vn[(b || a) - 1]); }
  }
  const count = pos.length / 3, P = new Float32Array(pos), N = new Float32Array(nrm);
  const min = [0, 1, 2].map(i => Math.min(...pos.filter((_, k) => k % 3 === i))), max = [0, 1, 2].map(i => Math.max(...pos.filter((_, k) => k % 3 === i)));
  const bin = Buffer.concat([Buffer.from(P.buffer), Buffer.from(N.buffer)]);
  const gltf = {
    asset: { version: '2.0', generator: 'VFX Studio' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, mode: 4 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength, byteLength: N.byteLength, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5126, count, type: 'VEC3' }],
  };
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const json = pad(Buffer.from(JSON.stringify(gltf)), 0x20), body = pad(bin, 0);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + body.length, 8);
  const chunk = (b, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, b]); };
  return Buffer.concat([head, chunk(json, 0x4e4f534a), chunk(body, 0x004e4942)]);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('roblox-upload-meshes.mjs')) {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(`--${n}`); if (i < 0) return undefined; const val = args[i + 1]; args.splice(i, 2); return val; };
  const flag = n => { const i = args.indexOf(`--${n}`); if (i < 0) return false; args.splice(i, 1); return true; };
  const user = opt('creator-user'), yes = flag('yes');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const idsFile = join(root, 'work', 'roblox', 'mesh-ids.json');
  const ids = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};
  const kinds = (args.length ? args : [...BUILTIN_MESHES]).filter(k => !ids[k]?.model);
  console.log(`Meshes to upload: ${kinds.join(' ') || '(none)'}`);
  if (!kinds.length) process.exit(0);
  if (!yes) { console.log('Dry run: nothing uploaded. Re-run with --yes to publish these meshes to Roblox.'); process.exit(0); }
  const key = process.env.ROBLOX_OPEN_CLOUD_API_KEY;
  if (!key) { console.error('ROBLOX_OPEN_CLOUD_API_KEY is not set.'); process.exit(2); }
  if (!user) { console.error('Pass --creator-user <userId>.'); process.exit(2); }
  for (const kind of kinds) {
    const glb = glbFromObj(builtinMeshObj(kind), `VFX_${kind}`);
    const form = new FormData();
    form.append('request', JSON.stringify({ assetType: 'Model', displayName: `VFX mesh ${kind}`, description: 'VFX Studio built-in particle mesh', creationContext: { creator: { userId: String(user) } } }));
    form.append('fileContent', new Blob([glb], { type: 'model/gltf-binary' }), `${kind}.glb`);
    const res = await fetch('https://apis.roblox.com/assets/v1/assets', { method: 'POST', headers: { 'x-api-key': key }, body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { console.error(`  ${kind}: upload failed HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`); continue; }
    const op = body.path ?? (body.operationId ? `operations/${body.operationId}` : undefined);
    let assetId = body.response?.assetId;
    for (let i = 0; !assetId && op && i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const o = await (await fetch(`https://apis.roblox.com/assets/v1/${op}`, { headers: { 'x-api-key': key } })).json().catch(() => ({}));
      if (o.done) assetId = o.response?.assetId;
      if (o.error) { console.error(`  ${kind}: ${JSON.stringify(o.error).slice(0, 300)}`); break; }
    }
    if (!assetId) { console.error(`  ${kind}: no asset id yet (moderation or timeout)`); continue; }
    ids[kind] = { model: String(assetId) };
    mkdirSync(join(root, 'work', 'roblox'), { recursive: true });
    writeFileSync(idsFile, JSON.stringify(ids, null, 2));
    console.log(`  ${kind}: model ${assetId}`);
  }
}
