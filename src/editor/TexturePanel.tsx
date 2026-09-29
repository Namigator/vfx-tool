// Import texture (10-ASSETS "User imports", first slice): pick a PNG/WebP/JPEG, choose color or mask and an
// optional flipbook grid, then the bytes go to the local asset store and the document lists the asset.
// "Use on selected Material" is the explicit add-to-effect step; importing alone does not change the graph.
// 10 "Inspect → classify role → preview → add": a chosen image is previewed with its flipbook cell grid first
// and only added on confirm.
import { useEffect, useRef, useState } from 'react';
import { createTextureAsset, sha256Hex } from '../assets/importTexture.ts';
import { relinkVerdict, removeAssetPatches, replaceAssetPatches } from '../model/assetRefs.ts';
import { createMeshAsset, inspectGlb, type GlbSummary } from '../assets/importMesh.ts';
import { previewGlb, type ModelPreview } from './modelPreview.ts';
import { registerAssetUrl } from '../assets/assetUrls.ts';
import { putAssetBytes } from '../model/assetStore.ts';
import type { AssetReference, EffectDocumentV2 } from '../model/types.ts';
import type { Patch } from './history.ts';
import { assetComponent } from '../graph/assetComponent.ts';
import { insertComponent } from '../graph/components.ts';

type TextureRole = 'color' | 'mask' | 'normal' | 'noise';
const ROLE_TEXT: Record<TextureRole, string> = { color: 'colour', mask: 'mask (alpha/brightness only)', normal: 'normal map (read as data, for lit meshes)', noise: 'noise (read as data, dissolve pattern)' };

type Props = {
  document: EffectDocumentV2;
  graphId: string;
  selectedNodeId: string | undefined;
  onEdit: (label: string, patches: Patch[]) => void;
  /** IDs of imported assets whose bytes are not on this device (10: named placeholder + Relink). */
  missingIds: readonly string[];
  /** Called after bytes were restored locally so the editor re-checks missing assets. */
  onBytesRestored: () => void;
};

/**
 * 10 "For flipbooks show … playback and frame ordering left-to-right, top-to-bottom": plays the cells of the chosen
 * image at 12 fps in that order, with the frame number, so a wrong grid or order is visible before adding.
 */
function FlipbookPlayer({ url, rows, columns }: { url: string; rows: number; columns: number }) {
  const [frame, setFrame] = useState(0);
  const count = rows * columns;
  useEffect(() => { setFrame(0); const id = setInterval(() => setFrame(f => (f + 1) % count), 1000 / 12); return () => clearInterval(id); }, [count]);
  const col = frame % columns, row = Math.floor(frame / columns);
  return (
    <div className="tp-player" aria-label="Flipbook playback">
      <div className="tp-cell" style={{ backgroundImage: `url(${url})`, backgroundSize: `${columns * 100}% ${rows * 100}%`, backgroundPosition: `${columns > 1 ? (col / (columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%` }} />
      <span className="pv2-muted">Frame {frame + 1} / {count} (row {row + 1}, column {col + 1})</span>
    </div>
  );
}

export function TexturePanel({ document: doc, graphId, selectedNodeId, onEdit, missingIds, onBytesRestored }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const relinkRef = useRef<HTMLInputElement>(null);
  const [relinkTarget, setRelinkTarget] = useState<AssetReference | null>(null);
  /** A relink file that is NOT the original: only an explicit Replace as new asset uses it. */
  const [replaceOffer, setReplaceOffer] = useState<{ asset: AssetReference; file: File; bytes: Uint8Array } | null>(null);
  const relink = async (asset: AssetReference, f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (relinkVerdict(asset, await sha256Hex(bytes)) === 'same') {
      const blob = new Blob([bytes], { type: asset.mime });
      const stored = await putAssetBytes(asset.sha256, asset.mime, blob);
      registerAssetUrl(asset.sha256, URL.createObjectURL(blob));
      setReplaceOffer(null);
      setStatus(`Relinked ${asset.provenance.originalFilename}: the file is the original${stored.ok ? '' : ` (not saved locally: ${stored.message})`}.`);
      onBytesRestored();
    } else {
      setReplaceOffer({ asset, file: f, bytes });
      setStatus('');
    }
  };
  const replaceAsNew = async () => {
    const o = replaceOffer;
    if (!o) return;
    const fb = o.asset.interpretation.flipbook;
    const r = o.asset.kind === 'mesh'
      ? await createMeshAsset(o.bytes, o.file.name, o.asset.interpretation.mesh?.importScale ?? 1)
      : await createTextureAsset(o.bytes, { filename: o.file.name, role: (['mask', 'normal', 'noise'] as const).find(r => r === o.asset.colorSpace) ?? 'color', ...(fb ? { flipbook: { rows: fb.rows, columns: fb.columns, frameCount: fb.frameCount, ...(fb.cells ? { cells: fb.cells } : {}) } } : {}) });
    if (!r.ok) { setStatus(`Replace failed: ${r.message}`); return; }
    const blob = new Blob([o.bytes as Uint8Array<ArrayBuffer>], { type: r.value.asset.mime });
    await putAssetBytes(r.value.asset.sha256, r.value.asset.mime, blob);
    registerAssetUrl(r.value.asset.sha256, URL.createObjectURL(blob));
    onEdit(`Replace ${o.asset.provenance.originalFilename} with ${o.file.name}`, replaceAssetPatches(doc, o.asset.id, r.value.asset));
    setReplaceOffer(null);
    setStatus(`Replaced ${o.asset.provenance.originalFilename} with ${o.file.name} everywhere it was used (undo restores the old one).`);
  };
  const removeAsset = (a: AssetReference) => {
    const r = removeAssetPatches(doc, a.id);
    if (!r.ok) { setStatus(`Cannot remove ${a.provenance.originalFilename}: ${r.message}`); return; }
    onEdit(`Remove ${a.provenance.originalFilename}`, r.patches);
    setStatus(`Removed ${a.provenance.originalFilename} from this effect.`);
  };
  /** 10 "Add to effect": the asset's ready-made component, inserted as one Group node (one undoable edit). */
  const addToEffect = (a: AssetReference) => {
    const t = assetComponent(a);
    if (typeof t === 'string') { setStatus(t); return; }
    let r;
    try { r = insertComponent(doc, t, undefined, { group: true }); } catch (e) { setStatus(`Add to effect failed: ${e instanceof Error ? e.message : String(e)}`); return; }
    onEdit(`Add ${t.label}`, [
      { op: 'set', path: ['graphs'], value: r.doc.graphs },
      { op: 'set', path: ['anchors'], value: r.doc.anchors },
      { op: 'set', path: ['controls'], value: r.doc.controls },
      { op: 'set', path: ['durationTicks'], value: r.doc.durationTicks },
      { op: 'set', path: ['editor', 'graphs'], value: r.doc.editor.graphs },
    ]);
    setStatus(`Added "${t.label}" (Group ${r.groupNodeId}): ${t.description}`);
  };
  const assetButtons = (a: AssetReference) => (
    <>
      <button type="button" onClick={() => addToEffect(a)} title="Insert a small ready-made component that uses this asset (undo removes it)">Add to effect</button>
      {missingIds.includes(a.id) && <button type="button" onClick={() => { setRelinkTarget(a); relinkRef.current?.click(); }} title="Pick the original file again; a different file is only used if you confirm Replace">Relink…</button>}
      <button type="button" onClick={() => removeAsset(a)} title="Remove from this effect (refused while nodes still use it)">Remove</button>
    </>
  );
  const meshRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<TextureRole>('color');
  const [grid, setGrid] = useState({ rows: 1, columns: 1 });
  const [status, setStatus] = useState('');
  /** 10-ASSETS: the user confirms a uniform import scale (file units → meters; 0.01 for centimetres). */
  const [meshScale, setMeshScale] = useState(1);
  /** Image chosen but not yet added: previewed with the cell grid so role/grid can be checked first. */
  const [pending, setPending] = useState<{ file: File; url: string; size?: [number, number] } | null>(null);
  const clearPending = () => { if (pending) URL.revokeObjectURL(pending.url); setPending(null); };
  /** GLB chosen but not yet added: checked against the import rules, measured and pictured first. */
  const [pendingModel, setPendingModel] = useState<{ file: File; summary: GlbSummary; preview?: ModelPreview; error?: string } | null>(null);
  const chooseModel = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const v = inspectGlb(bytes);
    if (!v.ok) { setPendingModel(null); setStatus(`Import failed: ${v.message}`); return; }
    setStatus('');
    setPendingModel({ file: f, summary: v.value });
    try { const preview = await previewGlb(bytes); setPendingModel(p => p && p.file === f ? { ...p, preview } : p); }
    catch (e) { setPendingModel(p => p && p.file === f ? { ...p, error: e instanceof Error ? e.message : String(e) } : p); }
  };
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

  const useOn = (assetId: string, name: string, role: string) => {
    if (!material) return;
    const base = ['graphs', gi, 'nodes', ni, 'params'];
    if (role === 'normal' || role === 'noise') { onEdit(`Use ${name} as ${role === 'normal' ? 'normal map' : 'noise'} on ${material.label}`, [{ op: 'set', path: [...base, role === 'normal' ? 'normalAsset' : 'noiseAsset'], value: assetId }]); return; }
    onEdit(`Use texture ${name} on ${material.label}`, [
      { op: 'set', path: [...base, 'template'], value: 'SpriteTextured' },
      { op: 'set', path: [...base, 'textureAsset'], value: assetId },
    ]);
  };

  return (
    <div className="tp-root">
      <div className="tp-row">
        <label>Role <select value={role} onChange={e => setRole(e.currentTarget.value as TextureRole)} title="How the image is read: Color and Mask draw sprites; Normal adds surface relief to lit meshes; Noise replaces the dissolve pattern"><option value="color">Color</option><option value="mask">Mask</option><option value="normal">Normal map</option><option value="noise">Noise</option></select></label>
        <label>Grid <input type="number" min={1} max={16} value={grid.columns} aria-label="Flipbook columns" onChange={e => { const columns = Math.max(1, Math.min(16, Math.round(Number(e.currentTarget.value) || 1))); setGrid(g => ({ ...g, columns })); }} />×
          <input type="number" min={1} max={16} value={grid.rows} aria-label="Flipbook rows" onChange={e => { const rows = Math.max(1, Math.min(16, Math.round(Number(e.currentTarget.value) || 1))); setGrid(g => ({ ...g, rows })); }} /></label>
        <button type="button" onClick={() => fileRef.current?.click()} title="PNG, static WebP or JPEG; up to 16 MiB and 4096 px">Import texture…</button>
        <input ref={fileRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) { clearPending(); setPending({ file: f, url: URL.createObjectURL(f) }); setStatus(''); } }} />
        <label title="File units → meters, used when a MeshRenderer's Imported size is 'real' (0.01 for a model made in centimetres)">Model scale <input type="number" min={0.001} max={1000} step="any" value={meshScale} aria-label="Model import scale"
          onChange={e => { const v = Number(e.currentTarget.value); if (v > 0 && v <= 1000) setMeshScale(v); }} /></label>
        <button type="button" onClick={() => meshRef.current?.click()} title="Self-contained .glb (glTF 2.0), up to 20 MiB and 50k triangles; no animation">Import 3D model…</button>
        <input ref={meshRef} type="file" accept=".glb,model/gltf-binary" hidden onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void chooseModel(f); }} />
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
          {grid.rows * grid.columns > 1 && <FlipbookPlayer url={pending.url} rows={grid.rows} columns={grid.columns} />}
          <div className="tp-preview-info">
            <strong>{pending.file.name}</strong>
            <span>{pending.size ? `${pending.size[0]}×${pending.size[1]} px` : 'reading…'} · {ROLE_TEXT[role]}{grid.rows * grid.columns > 1 ? ` · ${grid.columns}×${grid.rows} = ${grid.rows * grid.columns} frames${pending.size ? ` of ${Math.floor(pending.size[0] / grid.columns)}×${Math.floor(pending.size[1] / grid.rows)} px` : ''}` : ' · single image'}</span>
            <span className="pv2-muted">Check the grid lines sit between the frames, then add. Role and Grid above update this preview.</span>
            <span>
              <button type="button" onClick={() => { const f = pending.file; clearPending(); void importFile(f); }}>Add texture</button>
              <button type="button" onClick={clearPending}>Cancel</button>
            </span>
          </div>
        </div>
      )}
      {pendingModel && (
        <div className="tp-preview" aria-label="Model preview">
          <div className="tp-frame">{pendingModel.preview ? <img src={pendingModel.preview.thumbnail} alt={`Preview of ${pendingModel.file.name}`} /> : <span className="pv2-muted">{pendingModel.error ? 'No picture' : 'Rendering…'}</span>}</div>
          <div className="tp-preview-info">
            <strong>{pendingModel.file.name}</strong>
            <span>{pendingModel.summary.triangles} triangles · {pendingModel.summary.meshes} mesh(es) · {pendingModel.summary.materials} material(s)</span>
            {pendingModel.preview && (() => { const [x, y, z] = pendingModel.preview.size, m = (v: number) => (v * meshScale).toFixed(v * meshScale < 1 ? 3 : 2);
              return <span>Size {x.toFixed(2)} × {y.toFixed(2)} × {z.toFixed(2)} file units = {m(x)} × {m(y)} × {m(z)} m at Model scale {meshScale} (used when a MeshRenderer's Imported size is "real"; "fit" makes it ≈1 m).</span>; })()}
            {pendingModel.error && <span className="pv2-muted">Could not picture it ({pendingModel.error}); it passed the import checks.</span>}
            <span>
              <button type="button" onClick={() => { const f = pendingModel.file; setPendingModel(null); void importModel(f); }}>Add model</button>
              <button type="button" onClick={() => setPendingModel(null)}>Cancel</button>
            </span>
          </div>
        </div>
      )}
      <input ref={relinkRef} type="file" accept="image/png,image/webp,image/jpeg,.glb,model/gltf-binary" hidden onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f && relinkTarget) void relink(relinkTarget, f); }} />
      {status && <p className="pv2-note" role="status">{status}</p>}
      {replaceOffer && (
        <p className="pv2-warn" role="alert">
          {replaceOffer.file.name} is not the original {replaceOffer.asset.provenance.originalFilename} (different content), so the effect would look different.
          <button type="button" onClick={() => void replaceAsNew()}>Replace as new asset</button>
          <button type="button" onClick={() => setReplaceOffer(null)}>Cancel</button>
        </p>
      )}
      {textures.length === 0 ? <p className="pv2-muted">No imported textures in this effect.</p> : (
        <ul className="tp-list">
          {textures.map(a => (
            <li key={a.id}>
              <span>{missingIds.includes(a.id) && <strong className="pv2-warn">MISSING </strong>}{a.provenance.originalFilename} — {a.width}×{a.height}{a.interpretation.flipbook ? ` · ${a.interpretation.flipbook.columns}×${a.interpretation.flipbook.rows}` : ''} · {a.colorSpace}</span>
              {assetButtons(a)}
              <button type="button" disabled={!material} onClick={() => useOn(a.id, a.provenance.originalFilename, a.colorSpace)} title={material ? `Set ${material.label} to this texture` : 'Select a Material node first'}>Use on selected Material</button>
            </li>
          ))}
        </ul>
      )}
      {models.length > 0 && (
        <ul className="tp-list">
          {models.map(a => (
            <li key={a.id}>
              <span>{missingIds.includes(a.id) && <strong className="pv2-warn">MISSING </strong>}{a.provenance.originalFilename} · 3D model</span>
              {assetButtons(a)}
              <button type="button" disabled={!meshRenderer} onClick={() => useModel(a.id, a.provenance.originalFilename)} title={meshRenderer ? `Draw ${meshRenderer.label} particles as this model` : 'Select a MeshRenderer node first'}>Use on selected MeshRenderer</button>
            </li>
          ))}
        </ul>
      )}
      <style>{`.tp-root{display:flex;flex-direction:column;gap:6px;font-size:13px}.tp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.tp-row input[type=number]{width:44px}.tp-list{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px}.tp-list li span{margin-right:6px}.tp-preview{display:flex;gap:10px;align-items:flex-start;border:1px solid #2a3140;border-radius:6px;padding:6px}.tp-frame{position:relative;width:160px;flex:none;background:repeating-conic-gradient(#222 0 25%,#333 0 50%) 0 0/16px 16px}.tp-frame img{display:block;width:100%;height:auto}.tp-grid{position:absolute;inset:0;width:100%;height:100%}.tp-grid line{stroke:#4cc3ff;stroke-width:.6;vector-effect:non-scaling-stroke}.tp-player{display:flex;flex-direction:column;gap:4px;width:120px;flex:none}.tp-cell{width:120px;height:120px;background-repeat:no-repeat;background-color:#111}.tp-preview-info{display:flex;flex-direction:column;gap:4px}.tp-preview-info button{margin-right:6px}`}</style>
    </div>
  );
}
