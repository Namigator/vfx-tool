// Uploads exported effects (.rbxmx) as Roblox Model assets via Open Cloud so they show up in Studio (Toolbox →
// Inventory → My Models) for the account owning the API key. Uploaded models are private to that creator until they
// are distributed on the Creator Store by hand. Records ids in work/roblox/model-ids.json (file name -> asset id);
// a file that is already listed is updated in place (new version) instead of uploaded again.
//
// DRY RUN by default; --yes uploads (ask the user first).
//
//   node tools/roblox-upload-models.mjs --creator-user <userId> [--creator-group <groupId>] [--yes] <model.rbxmx ...>
//
// Needs ROBLOX_OPEN_CLOUD_API_KEY with the "assets" read+write permission. The key is read from the environment and
// never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = n => { const i = args.indexOf(`--${n}`); if (i < 0) return false; args.splice(i, 1); return true; };
const user = opt('creator-user'), group = opt('creator-group'), yes = flag('yes');
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const idsFile = join(root, 'work', 'roblox', 'model-ids.json');
const ids = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};

const files = args.filter(f => existsSync(f));
for (const f of args) if (!existsSync(f)) console.error(`  ${f}: not found`);
console.log(`Models: ${files.length} (${files.filter(f => ids[basename(f)]).length} will be updated, ${files.filter(f => !ids[basename(f)]).length} new)`);
for (const f of files) console.log(`  ${basename(f)}${ids[basename(f)] ? ` (update ${ids[basename(f)]})` : ''}`);
if (!files.length) process.exit(0);
if (!yes) { console.log('Dry run: nothing uploaded. Re-run with --yes to upload these models to Roblox.'); process.exit(0); }
const key = process.env.ROBLOX_OPEN_CLOUD_API_KEY;
if (!key) { console.error('ROBLOX_OPEN_CLOUD_API_KEY is not set.'); process.exit(2); }
if (!user && !group) { console.error('Pass --creator-user <userId> or --creator-group <groupId>.'); process.exit(2); }
const creator = group ? { groupId: String(group) } : { userId: String(user) };

const nameOf = f => basename(f).replace(/\.rbxmx?$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2');
let failed = 0;
for (const f of files) {
  const b = basename(f), existing = ids[b];
  const form = new FormData();
  const request = existing
    ? { assetId: String(existing) }
    : { assetType: 'Model', displayName: nameOf(f).slice(0, 50), description: 'VFX effect made with VFX Studio. Insert it, enable the Demo script and press Play.', creationContext: { creator } };
  form.append('request', JSON.stringify(request));
  form.append('fileContent', new Blob([readFileSync(f)], { type: 'model/x-rbxm' }), b);
  const url = existing ? `https://apis.roblox.com/assets/v1/assets/${existing}` : 'https://apis.roblox.com/assets/v1/assets';
  const res = await fetch(url, { method: existing ? 'PATCH' : 'POST', headers: { 'x-api-key': key }, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`  ${b}: upload failed HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`); failed++; continue; }
  const op = body.path ?? (body.operationId ? `operations/${body.operationId}` : undefined);
  let assetId = body.response?.assetId ?? (body.done ? existing : undefined);
  for (let i = 0; !assetId && op && i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const o = await (await fetch(`https://apis.roblox.com/assets/v1/${op}`, { headers: { 'x-api-key': key } })).json().catch(() => ({}));
    if (o.done) assetId = o.response?.assetId ?? existing;
    if (o.error) { console.error(`  ${b}: ${JSON.stringify(o.error).slice(0, 300)}`); break; }
  }
  if (!assetId) { console.error(`  ${b}: no asset id yet (moderation or timeout)`); failed++; continue; }
  ids[b] = String(assetId);
  mkdirSync(join(root, 'work', 'roblox'), { recursive: true });
  writeFileSync(idsFile, JSON.stringify(ids, null, 2));
  console.log(`  ${b}: ${existing ? 'updated' : 'uploaded'} https://create.roblox.com/store/asset/${assetId}`);
}
process.exit(failed ? 1 : 0);
