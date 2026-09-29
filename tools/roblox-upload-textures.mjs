// Uploads the library sprite sheets a Roblox export uses (RobloxEffect.textures) as Roblox Image assets via Open Cloud
// and records their ids in work/roblox/asset-ids.json (sheet file -> asset id), which the exporter then uses.
//
// DRY RUN by default: lists what would be uploaded. Uploading publishes to the Roblox account that owns the API key,
// so it only happens with --yes (ask the user first).
//
//   node tools/roblox-upload-textures.mjs --creator-user <userId> [--creator-group <groupId>] [--yes] <sheet.png ...|--all-used work/roblox/*.ir.json>
//
// Needs ROBLOX_OPEN_CLOUD_API_KEY with the "assets" read+write permission. The key is read from the environment and
// never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = n => { const i = args.indexOf(`--${n}`); if (i < 0) return false; args.splice(i, 1); return true; };
const user = opt('creator-user'), group = opt('creator-group'), yes = flag('yes'), allUsed = flag('all-used');
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const idsFile = join(root, 'work', 'roblox', 'asset-ids.json');
const ids = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};

let files = args;
if (allUsed) files = [...new Set(args.flatMap(f => JSON.parse(readFileSync(f, 'utf8')).textures ?? []))];
files = files.map(f => basename(f));
const todo = files.filter(f => !ids[f]);
console.log(`Textures: ${files.length} (${files.length - todo.length} already uploaded, ${todo.length} to upload)`);
for (const f of todo) console.log(`  ${f}`);
if (!todo.length) process.exit(0);
if (!yes) { console.log('Dry run: nothing uploaded. Re-run with --yes to publish these images to Roblox.'); process.exit(0); }
const key = process.env.ROBLOX_OPEN_CLOUD_API_KEY;
if (!key) { console.error('ROBLOX_OPEN_CLOUD_API_KEY is not set.'); process.exit(2); }
if (!user && !group) { console.error('Pass --creator-user <userId> or --creator-group <groupId>.'); process.exit(2); }
const creator = group ? { groupId: String(group) } : { userId: String(user) };

for (const f of todo) {
  const path = join(root, 'assets', 'sprites', f);
  if (!existsSync(path)) { console.error(`  ${f}: not found in assets/sprites`); continue; }
  const form = new FormData();
  form.append('request', JSON.stringify({ assetType: 'Image', displayName: `VFX ${f.replace(/\.png$/i, '')}`.slice(0, 50), description: 'VFX Studio sprite sheet (procedurally generated)', creationContext: { creator } }));
  form.append('fileContent', new Blob([readFileSync(path)], { type: 'image/png' }), f);
  const res = await fetch('https://apis.roblox.com/assets/v1/assets', { method: 'POST', headers: { 'x-api-key': key }, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`  ${f}: upload failed HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`); continue; }
  const op = body.path ?? (body.operationId ? `operations/${body.operationId}` : undefined);
  let assetId = body.response?.assetId;
  for (let i = 0; !assetId && op && i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const o = await (await fetch(`https://apis.roblox.com/assets/v1/${op}`, { headers: { 'x-api-key': key } })).json().catch(() => ({}));
    if (o.done) assetId = o.response?.assetId;
    if (o.error) { console.error(`  ${f}: ${JSON.stringify(o.error).slice(0, 300)}`); break; }
  }
  if (!assetId) { console.error(`  ${f}: no asset id yet (moderation or timeout)`); continue; }
  ids[f] = String(assetId);
  mkdirSync(join(root, 'work', 'roblox'), { recursive: true });
  writeFileSync(idsFile, JSON.stringify(ids, null, 2));
  console.log(`  ${f}: rbxassetid://${assetId}`);
}
