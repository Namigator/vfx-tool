// Import texture (10-ASSETS "User imports", first slice): pick a PNG/WebP/JPEG, choose color or mask and an
// optional flipbook grid, then the bytes go to the local asset store and the document lists the asset.
// "Use on selected Material" is the explicit add-to-effect step; importing alone does not change the graph.
// 10 "Inspect → classify role → preview → add": a chosen image is previewed with its flipbook cell grid first
// and only added on confirm.
import { useRef, useState } from 'react';
import { createTextureAsset } from '../assets/importTexture.ts';
import { createMeshAsset } from '../assets/importMesh.ts';
import { registerAssetUrl } from '../assets/assetUrls.ts';
import { putAssetBytes } from '../model/assetStore.ts';
import type { EffectDocumentV2 } from '../model/types.ts';
import type { Patch } from './history.ts';

type Props = {
  document: EffectDocumentV2;
  graphId: string;
  selectedNodeId: string | undefined;
  onEdit: (label: string, patches: Patch[]) => void;
};

export function TexturePanel({ document: doc, graphId, selectedNodeId, onEdit }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const meshRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<'color' | 'mask'>('color');
  const [grid, setGrid] = useState({ rows: 1, columns: 1 });
  const [status, setStatus] = useState('');
  /** 10-ASSETS: the user confirms a uniform import scale (file units → meters; 0.01 for centimetres). */
  const [meshScale, setMeshScale] = useState(1);
  /** Image chosen but not yet added: previewed with the cell grid so role/grid can be checked first. */
  const [pending, setPending] = useState<{ file: File; url: string; size?: [number, number] } | null>(null);
  const clearPending = () => { if (pending) URL.revokeObjectURL(pending.url); setPending(null); };
  const textures = doc.assets.filter(a => a.kind === 'texture' || a.kind === 'flipbook');
  const gi = doc.graphs.findIndex(g => g.id === graphId);
  const ni = gi < 0 || !selectedNodeId ? -1 : doc.graphs[gi].nodes.findIndex(n => n.id === selectedNodeId);
  const material = ni >= 0 && doc.graphs[gi].nodes[ni].type === 'Material' ? doc.graphs[gi].nodes[ni] : undefined;
  const meshRenderer = ni >= 0 && doc.graphs[gi].nodes[ni].type === 'MeshRenderer' ? doc.graphs[gi].nodes[ni] : undefined;
  const models = doc.assets.filter(a => a.kind === 'mesh');

  const importFile = async (f: File) => {
    setStatus(`Reading ${f.name}…`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const flip = grid.rows * grid.columns > 1 ? { rows: grid.rows, columns: grid.columns } : undefined;
    const r = await createTextureAsset(bytes, { filename: f.name, role, ...(flip ? { flipbook: flip } : {}) });
    if (!r.ok) { setStatus(`Import failed: ${r.message}`); return; }
    const { asset, header } = r.value;
    const blob = new Blob([bytes], { type: header.mime });
    const stored = await putAssetBytes(asset.sha256, header.mime, blob);
    registerAssetUrl(asset.sha256, URL.createObjectURL(blob));
    if (!doc.assets.some(a => a.id === asset.id)) onEdit(`Import texture ${f.name}`, [{ op: 'splice', path: ['assets'], index: doc.assets.length, deleteCount: 0, insert: [asset] }]);
    setStatus(`Imported ${f.name} (${header.width}×${header.height}${flip ? `, ${flip.columns}×${flip.rows} flipbook` : ''})${stored.ok ? '' : ` — not saved locally: ${stored.message}`}.`);
  };

  /** GLB import (10-ASSETS): validated, stored locally, listed in the document; "Use on selected MeshRenderer" applies it. */
  const importModel = async (f: File) => {
    setStatus(`Reading ${f.name}…`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = await createMeshAsset(bytes, f.name, meshScale);
    if (!r.ok) { setStatus(`Import failed: ${r.message}`); return; }
    const { asset, summary } = r.value;
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    const stored = await putAssetBytes(asset.sha256, 'model/gltf-binary', blob);
    registerAssetUrl(asset.sha256, URL.createObjectURL(blob));
    if (!doc.assets.some(a => a.id === asset.id)) onEdit(`Import model ${f.name}`, [{ op: 'splice', path: ['assets'], index: doc.assets.length, deleteCount: 0, insert: [asset] }]);
    setStatus(`Imported ${f.name} (${summary.triangles} triangles)${stored.ok ? '' : ` — not saved locally: ${stored.message}`}.`);
  };
  const useModel = (assetId: string, name: string) => {
    if (!meshRenderer) return;
    onEdit(`Use model ${name} on ${meshRenderer.label}`, [{ op: 'set', path: ['graphs', gi, 'nodes', ni, 'params', 'meshAsset'], value: assetId }]);
  };

  const useOn = (assetId: string, name: string) => {
    if (!material) return;
    const base = ['graphs', gi, 'nodes', ni, 'params'];
    onEdit(`Use texture ${name} on ${material.label}`, [
      { op: 'set', path: [...base, 'template'], value: 'SpriteTextured' },
      { op: 'set', path: [...base, 'textureAsset'], value: assetId },
    ]);
  };

  return (
    <div className="tp-root">
      <div className="tp-row">
        <label>Role <select value={role} onChange={e => setRole(e.currentTarget.value as 'color' | 'mask')}><option value="color">Color</option><option value="mask">Mask</option></select></label>
        <label>Grid <input type="number" min={1} max={16} value={grid.columns} aria-label="Flipbook columns" onChange={e => { const columns = Math.max(1, Math.min(16, Math.round(Number(e.currentTarget.value) || 1))); setGrid(g => ({ ...g, columns })); }} />×
          <input type="number" min={1} max={16} value={grid.rows} aria-label="Flipbook rows" onChange={e => { const rows = Math.max(1, Math.min(16, Math.round(Number(e.currentTarget.value) || 1))); setGrid(g => ({ ...g, rows })); }} /></label>
        <button type="button" onClick={() => fileRef.current?.click()} title="PNG, static WebP or JPEG; up to 16 MiB and 4096 px">Import texture…</button>
        <input ref={fileRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) { clearPending(); setPending({ file: f, url: URL.createObjectURL(f) }); setStatus(''); } }} />
        <label title="File units → meters, used when a MeshRenderer's Imported size is 'real' (0.01 for a model made in centimetres)">Model scale <input type="number" min={0.001} max={1000} step="any" value={meshScale} aria-label="Model import scale"
          onChange={e => { const v = Number(e.currentTarget.value); if (v > 0 && v <= 1000) setMeshScale(v); }} /></label>
        <button type="button" onClick={() => meshRef.current?.click()} title="Self-contained .glb (glTF 2.0), up to 20 MiB and 50k triangles; no animation">Import 3D model…</button>
        <input ref={meshRef} type="file" accept=".glb,model/gltf-binary" hidden onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void importModel(f); }} />
      </div>
      {pending && (
        <div className="tp-preview" aria-label="Texture preview">
          <div className="tp-frame">
            <img src={pending.url} alt={`Preview of ${pending.file.name}`} onLoad={e => { const i = e.currentTarget; setPending(p => p && { ...p, size: [i.naturalWidth, i.naturalHeight] }); }} />
            {/* Flipbook cell grid (left-to-right, top-to-bottom), updated live from Grid. */}
            <svg className="tp-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {Array.from({ length: grid.columns - 1 }, (_, i) => <line key={`c${i}`} x1={(100 * (i + 1)) / grid.columns} x2={(100 * (i + 1)) / grid.columns} y1={0} y2={100} />)}
              {Array.from({ length: grid.rows - 1 }, (_, i) => <line key={`r${i}`} y1={(100 * (i + 1)) / grid.rows} y2={(100 * (i + 1)) / grid.rows} x1={0} x2={100} />)}
            </svg>
          </div>
          <div className="tp-preview-info">
            <strong>{pending.file.name}</strong>
            <span>{pending.size ? `${pending.size[0]}×${pending.size[1]} px` : 'reading…'} · {role === 'mask' ? 'mask (alpha/brightness only)' : 'colour'}{grid.rows * grid.columns > 1 ? ` · ${grid.columns}×${grid.rows} = ${grid.rows * grid.columns} frames${pending.size ? ` of ${Math.floor(pending.size[0] / grid.columns)}×${Math.floor(pending.size[1] / grid.rows)} px` : ''}` : ' · single image'}</span>
            <span className="pv2-muted">Check the grid lines sit between the frames, then add. Role and Grid above update this preview.</span>
            <span>
              <button type="button" onClick={() => { const f = pending.file; clearPending(); void importFile(f); }}>Add texture</button>
              <button type="button" onClick={clearPending}>Cancel</button>
            </span>
          </div>
        </div>
      )}
      {status && <p className="pv2-note" role="status">{status}</p>}
      {textures.length === 0 ? <p className="pv2-muted">No imported textures in this effect.</p> : (
        <ul className="tp-list">
          {textures.map(a => (
            <li key={a.id}>
              <span>{a.provenance.originalFilename} — {a.width}×{a.height}{a.interpretation.flipbook ? ` · ${a.interpretation.flipbook.columns}×${a.interpretation.flipbook.rows}` : ''} · {a.colorSpace}</span>
              <button type="button" disabled={!material} onClick={() => useOn(a.id, a.provenance.originalFilename)} title={material ? `Set ${material.label} to this texture` : 'Select a Material node first'}>Use on selected Material</button>
            </li>
          ))}
        </ul>
      )}
      {models.length > 0 && (
        <ul className="tp-list">
          {models.map(a => (
            <li key={a.id}>
              <span>{a.provenance.originalFilename} · 3D model</span>
              <button type="button" disabled={!meshRenderer} onClick={() => useModel(a.id, a.provenance.originalFilename)} title={meshRenderer ? `Draw ${meshRenderer.label} particles as this model` : 'Select a MeshRenderer node first'}>Use on selected MeshRenderer</button>
            </li>
          ))}
        </ul>
      )}
      <style>{`.tp-root{display:flex;flex-direction:column;gap:6px;font-size:13px}.tp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.tp-row input[type=number]{width:44px}.tp-list{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px}.tp-list li span{margin-right:6px}.tp-preview{display:flex;gap:10px;align-items:flex-start;border:1px solid #2a3140;border-radius:6px;padding:6px}.tp-frame{position:relative;width:160px;flex:none;background:repeating-conic-gradient(#222 0 25%,#333 0 50%) 0 0/16px 16px}.tp-frame img{display:block;width:100%;height:auto}.tp-grid{position:absolute;inset:0;width:100%;height:100%}.tp-grid line{stroke:#4cc3ff;stroke-width:.6;vector-effect:non-scaling-stroke}.tp-preview-info{display:flex;flex-direction:column;gap:4px}.tp-preview-info button{margin-right:6px}`}</style>
    </div>
  );
}
