// Lists an uploaded Roblox model on the Creator Store (free or for USD) via the Open Cloud "Creator Store products"
// API (beta): POST https://apis.roblox.com/cloud/v2/creator-store-products.
//
// DRY RUN by default (prints the request). --yes publishes it - it becomes PUBLIC, so only with the owner's go-ahead.
//
//   node tools/roblox-list-product.mjs --asset <modelAssetId> --creator-user <userId> [--price 7.99] [--unpublish] [--yes]
//
// Needs ROBLOX_OPEN_CLOUD_API_KEY with the creator-store-product:write permission (read from the environment, never
// printed). Paid products also need the owner's Creator Store seller account (ID verified, Stripe); until then Roblox
// returns the product with restrictions and it is not purchasable - the response is printed so that shows.
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = n => { const i = args.indexOf(`--${n}`); if (i < 0) return false; args.splice(i, 1); return true; };
const asset = opt('asset'), user = opt('creator-user'), group = opt('creator-group'), price = Number(opt('price') ?? 0);
const unpublish = flag('unpublish'), yes = flag('yes');
if (!asset || (!user && !group) || !(price >= 0)) { console.error('usage: roblox-list-product.mjs --asset <modelAssetId> --creator-user <userId> [--price 7.99] [--unpublish] [--yes]'); process.exit(2); }

const body = {
  modelAssetId: String(asset),
  ...(group ? { groupSeller: `groups/${group}` } : { userSeller: `users/${user}` }),
  // Free = no price at all (Roblox rejects a $0 price tier for models).
  ...(price > 0 ? { basePrice: { currencyCode: 'USD', quantity: { significand: Math.round(price * 1e9), exponent: -9 } } } : {}),
  published: !unpublish,
};
console.log(`${unpublish ? 'Unpublish' : 'Publish'} model ${asset} on the Creator Store at ${price > 0 ? `$${price.toFixed(2)}` : 'free'}`);
console.log(JSON.stringify(body, null, 2));
if (!yes) { console.log('Dry run: nothing sent. Re-run with --yes to make it public.'); process.exit(0); }
const key = process.env.ROBLOX_OPEN_CLOUD_API_KEY;
if (!key) { console.error('ROBLOX_OPEN_CLOUD_API_KEY is not set.'); process.exit(2); }

const res = await fetch('https://apis.roblox.com/cloud/v2/creator-store-products', {
  method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const text = await res.text();
let out; try { out = JSON.parse(text); } catch { out = text; }
console.log(`HTTP ${res.status}`);
console.log(typeof out === 'string' ? out.slice(0, 2000) : JSON.stringify(out, null, 2));
if (res.status === 401 || res.status === 403) console.error('The API key lacks creator-store-product:write (add it in Creator Dashboard -> API keys), or this account cannot sell yet.');
if (out && typeof out === 'object' && Array.isArray(out.restrictions) && out.restrictions.length) console.error(`Not purchasable yet: ${out.restrictions.join(', ')} (seller account / verification needed for paid items).`);
process.exit(res.ok ? 0 : 1);
