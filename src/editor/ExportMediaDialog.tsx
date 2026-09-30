// "Export media…" (sprite sheet / PNG sequence / GIF / video). Renders the open effect tick by tick in an offscreen viewport
// (never a recording of the live canvas) and downloads the result. The heavy modules (WebGL renderer, encoders, muxers)
// load only when an export starts. MCP twin: vfx_export_media.
import { useMemo, useRef, useState } from 'react';
import type { EffectDocumentV2 } from '../model/types.ts';
import { defaultBackground, resolveMediaOptions, type MediaBackground, type MediaFormat } from '../export/media/layout.ts';

type Pose = { position: [number, number, number]; target: [number, number, number]; fov: number };
export type ExportMediaProps = {
  /** The current document (read when the export starts). */
  getDocument: () => EffectDocumentV2;
  /** The editor's current camera, for "Current view". */
  getCameraPose: () => Pose | null;
  /** Glow state of the editor; the dialog starts from it. */
  glow: boolean;
  onNote: (text: string) => void;
  onClose: () => void;
};

const FORMATS: { id: MediaFormat; label: string }[] = [
  { id: 'spritesheet', label: 'Sprite sheet (PNG + JSON)' }, { id: 'png-sequence', label: 'PNG sequence (.zip)' },
  { id: 'gif', label: 'GIF (animated)' }, { id: 'mp4', label: 'Video (MP4, WebM if needed)' }, { id: 'webm', label: 'Video (WebM)' },
];
const SIZES = [64, 128, 256, 512, 1024];

function save(bytes: Uint8Array, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ExportMediaDialog({ getDocument, getCameraPose, glow, onNote, onClose }: ExportMediaProps) {
  const doc = getDocument();
  const [format, setFormat] = useState<MediaFormat>('spritesheet');
  const [size, setSize] = useState(256);
  const [custom, setCustom] = useState(false);
  const [w, setW] = useState(256), [h, setH] = useState(256);
  const [fps, setFps] = useState(30);
  const [background, setBackground] = useState<MediaBackground>('transparent');
  const [camera, setCamera] = useState<'fit' | 'current'>('fit');
  const [glowOn, setGlowOn] = useState(glow);
  const [columns, setColumns] = useState(0);
  const [start, setStart] = useState(0), [end, setEnd] = useState(doc.durationTicks);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [error, setError] = useState('');
  const cancelRef = useRef(false);
  const busy = progress !== null;

  const width = custom ? w : size, height = custom ? h : size, isVideo = format === 'mp4' || format === 'webm';
  const plan = useMemo(() => resolveMediaOptions({ format, width, height, fps, startTick: start, endTick: end, background, glow: glowOn, ...(columns > 0 ? { columns } : {}) }, doc.durationTicks), [format, width, height, fps, start, end, background, glowOn, columns, doc.durationTicks]);

  const pickFormat = (f: MediaFormat) => {
    setFormat(f);
    // Each format starts from its natural background: sheets/sequences transparent, GIF/video solid dark.
    setBackground(defaultBackground(f));
    if (f === 'gif') setFps(v => (v > 50 ? 30 : v));
  };

  const run = async () => {
    setError(''); cancelRef.current = false;
    setProgress({ done: 0, total: plan.ok ? plan.ticks.length : 1, phase: 'starting' });
    try {
      const { renderMedia, ExportCancelled, safeBaseName } = await import('../export/media/render.ts');
      const pose = camera === 'current' ? getCameraPose() : null;
      const d = getDocument();
      const result = await renderMedia(d, { format, width, height, fps, startTick: start, endTick: end, background, glow: glowOn, ...(columns > 0 ? { columns } : {}), ...(pose ? { camera: { position: pose.position, target: pose.target, fov: pose.fov } } : { camera: 'fit' as const }), name: safeBaseName(d.name || d.id) },
        { onProgress: (done, total, phase) => setProgress({ done, total, phase }), cancelled: () => cancelRef.current }).catch(e => { if (e instanceof ExportCancelled) return null; throw e; });
      if (!result) { onNote('Export cancelled.'); setProgress(null); return; }
      for (const f of result.files) save(f.bytes, f.name, f.mime);
      const kb = Math.round(result.files.reduce((n, f) => n + f.bytes.length, 0) / 1024);
      onNote(`Exported ${result.frameCount} frame(s) of ${result.width}x${result.height} (${result.files.map(f => f.name).join(', ')}, ${kb} KB).${result.notes.length ? ' ' + result.notes.join(' ') : ''}`);
      setProgress(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };

  return (
    <div className="pv2-banner pv2-media" role="dialog" aria-label="Export media">
      <strong>Export media</strong> Renders the effect frame by frame (the floor, grid and Source/Target markers are left out).
      <div className="pv2-media-grid">
        <label>Format <select value={format} disabled={busy} onChange={e => pickFormat(e.currentTarget.value as MediaFormat)}>{FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
        <label>Frame size <select value={custom ? 'custom' : String(size)} disabled={busy} onChange={e => { const v = e.currentTarget.value; if (v === 'custom') setCustom(true); else { setCustom(false); setSize(Number(v)); } }}>
          {SIZES.map(s => <option key={s} value={s}>{s} x {s}</option>)}<option value="custom">Custom…</option></select></label>
        {custom && <label>Width x Height <input type="number" min={16} max={4096} value={w} disabled={busy} onChange={e => setW(Number(e.currentTarget.value))} style={{ width: 70 }} /> x <input type="number" min={16} max={4096} value={h} disabled={busy} onChange={e => setH(Number(e.currentTarget.value))} style={{ width: 70 }} /></label>}
        <label>Frames per second <select value={fps} disabled={busy} onChange={e => setFps(Number(e.currentTarget.value))}>{[15, 20, 24, 30, 60].map(f => <option key={f} value={f}>{f}</option>)}</select></label>
        <label>Background <select value={background} disabled={busy} onChange={e => setBackground(e.currentTarget.value as MediaBackground)}>
          <option value="transparent" disabled={isVideo}>Transparent{format === 'gif' ? ' (GIF: on/off only)' : ''}</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <label>Camera <select value={camera} disabled={busy} onChange={e => setCamera(e.currentTarget.value as 'fit' | 'current')}><option value="fit">Fit the whole effect</option><option value="current">Current view</option></select></label>
        <label><input type="checkbox" checked={glowOn} disabled={busy} onChange={e => setGlowOn(e.currentTarget.checked)} /> Glow</label>
        {format === 'spritesheet' && <label>Columns <input type="number" min={0} max={64} value={columns} disabled={busy} onChange={e => setColumns(Math.max(0, Number(e.currentTarget.value)))} style={{ width: 60 }} title="0 = automatic (about the square root of the frame count)" /></label>}
        <label>Ticks <input type="number" min={0} value={start} disabled={busy} onChange={e => setStart(Math.max(0, Number(e.currentTarget.value)))} style={{ width: 70 }} /> to <input type="number" min={1} value={end} disabled={busy} onChange={e => setEnd(Number(e.currentTarget.value))} style={{ width: 70 }} /> <span className="pv2-note">of {doc.durationTicks}</span></label>
      </div>
      <p className="pv2-note" role="status">
        {plan.ok
          ? `${plan.ticks.length} frame(s) of ${plan.options.width} x ${plan.options.height}${plan.layout ? `; sheet ${plan.layout.width} x ${plan.layout.height} px (${plan.layout.columns} columns x ${plan.layout.rows} rows)` : ''}; one frame every ${(60 / plan.options.fps).toFixed(2)} ticks.`
          : plan.message}
      </p>
      {busy && <div><progress max={Math.max(1, progress!.total)} value={progress!.done} style={{ width: 240 }} /> <span className="pv2-note">{progress!.phase} {progress!.done}/{progress!.total}</span></div>}
      {error && <p className="pv2-error" role="alert">{error}</p>}
      <button type="button" disabled={busy || !plan.ok} onClick={() => void run()}>Export</button>
      {busy ? <button type="button" onClick={() => { cancelRef.current = true; }}>Cancel</button> : <button type="button" onClick={onClose}>Close</button>}
    </div>
  );
}
