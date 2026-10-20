export function classifyCaptureStatus(raw: unknown, expectedSig: string, tick: number, url: string): { ok: true } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  if (raw === undefined) return fail(`The editor at ${url} rendered tick ${tick} but did not report its status, so it is probably an old or prebuilt build. Start the dev server from this checkout (Start-VFX.cmd or \`vite --port 5174\`) and retry.`);
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return fail(`Tick ${tick} returned invalid capture status JSON.`); } }
  if (!raw || typeof raw !== 'object') return fail(`Tick ${tick} returned invalid capture status.`);
  const s = raw as Record<string, unknown>;
  if (typeof s.registry !== 'string') return fail(`Tick ${tick} returned capture status without a registry signature.`);
  if (s.registry !== expectedSig) return fail(`Editor/MCP version mismatch: the editor at ${url} was built from different node definitions than this MCP (editor ${s.registry}, MCP ${expectedSig}). Restart the dev server from this checkout.`);
  if (s.tick !== tick) return fail(`Tick ${tick} returned capture status for a different tick (${String(s.tick)}).`);
  if (s.state === 'error') return fail(`Tick ${tick} failed to render: ${typeof s.message === 'string' ? s.message : 'Unknown capture error'}`);
  if (s.state !== 'ok') return fail(`Tick ${tick} returned invalid capture state.`);
  return { ok: true };
}
