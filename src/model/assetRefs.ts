// 10-ASSETS asset lifecycle: "deleting an asset used by a graph is blocked with a list of references. Offer Replace
// references" and "Allow relink by selecting a local file; require expected hash or explicit Replace as new asset so
// old projects do not change invisibly." Pure: returns patches / verdicts; callers store bytes and apply edits.
import type { AssetReference, EffectDocumentV2 } from './types.ts';
import type { Patch } from '../editor/history.ts';

export type AssetUse = { graphId: string; nodeId: string; label: string; parameter: string; path: (string | number)[] };

/** Every node parameter that points at this asset (asset IDs are content hashes, so an exact string match is a reference). */
export function assetReferences(doc: EffectDocumentV2, assetId: string): AssetUse[] {
  const out: AssetUse[] = [];
  doc.graphs.forEach((g, gi) => g.nodes.forEach((n, ni) => {
    for (const [k, v] of Object.entries(n.params)) if (v === assetId) out.push({ graphId: g.id, nodeId: n.id, label: n.label || n.id, parameter: k, path: ['graphs', gi, 'nodes', ni, 'params', k] });
  }));
  return out;
}

/** Remove an asset from the document: refused while nodes still use it (the refusal lists them). */
export function removeAssetPatches(doc: EffectDocumentV2, assetId: string): { ok: true; patches: Patch[] } | { ok: false; message: string } {
  const i = doc.assets.findIndex(a => a.id === assetId);
  if (i < 0) return { ok: false, message: `Asset ${assetId} is not in this effect.` };
  const uses = assetReferences(doc, assetId);
  if (uses.length) return { ok: false, message: `Still used by ${uses.map(u => `${u.label} (${u.parameter})`).join(', ')}. Point those at another asset (Replace uses) or remove them first.` };
  return { ok: true, patches: [{ op: 'splice', path: ['assets'], index: i, deleteCount: 1, insert: [] }] };
}

/** Point every use of `oldId` at `newAsset` (adding it to the document if needed) and drop the old record. */
export function replaceAssetPatches(doc: EffectDocumentV2, oldId: string, newAsset: AssetReference): Patch[] {
  const patches: Patch[] = assetReferences(doc, oldId).map(u => ({ op: 'set', path: u.path, value: newAsset.id }));
  const oldIndex = doc.assets.findIndex(a => a.id === oldId), has = doc.assets.some(a => a.id === newAsset.id);
  if (!has) patches.push({ op: 'splice', path: ['assets'], index: doc.assets.length, deleteCount: 0, insert: [newAsset] });
  if (oldIndex >= 0 && oldId !== newAsset.id) patches.push({ op: 'splice', path: ['assets'], index: oldIndex, deleteCount: 1, insert: [] });
  return patches;
}

/** Relink: a picked file restores a missing asset only if its bytes are the original ones (same SHA-256). */
export function relinkVerdict(asset: AssetReference, pickedSha256: string): 'same' | 'different' {
  return pickedSha256 === asset.sha256 ? 'same' : 'different';
}
