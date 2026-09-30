// Headless Chrome over the DevTools protocol with Node's built-in WebSocket (no puppeteer): open a page, wait until its
// title says it is ready, evaluate an async expression in it and return the (JSON) value. Used by vfx_export_media, which
// needs several frames out of ONE page session (the screenshot flag of vfx_render_frames gives a single image).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ChromeEvalOptions = {
  chrome: string;
  url: string;
  /** Page title prefix that means "ready for requests" (a title starting with ERROR aborts). */
  readyTitle: string;
  /** JavaScript run in the page; may use top-level await and must `return` a JSON-serialisable value. */
  script: string;
  timeoutMs?: number;
  /** Use the machine's GPU instead of software rendering (default false for repeatable output). */
  gpu?: boolean;
  width?: number;
  height?: number;
};

export async function chromeEval<T>(o: ChromeEvalOptions): Promise<T> {
  const profile = mkdtempSync(join(tmpdir(), 'vfx-media-'));
  const port = 9600 + Math.floor(Math.random() * 600);
  const proc = spawn(o.chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${o.width ?? 800},${o.height ?? 600}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', ...(o.gpu ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), 'about:blank'], { stdio: 'ignore' });
  let spawnError: Error | null = null;
  proc.on('error', e => { spawnError = e; });
  const timeoutMs = o.timeoutMs ?? 600_000;
  let ws: WebSocket | undefined;
  const cleanup = () => { try { ws?.close(); } catch { /* ignore */ } try { proc.kill(); } catch { /* ignore */ } setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } }, 800); };
  const deadline = Date.now() + timeoutMs;
  try {
    let target: { webSocketDebuggerUrl: string; type: string } | undefined;
    for (let i = 0; i < 75 && !target; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (spawnError) throw new Error(`Could not start Chrome (${o.chrome}): ${(spawnError as Error).message}`);
      try { target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { webSocketDebuggerUrl: string; type: string }[]).find(t => t.type === 'page'); } catch { /* not up yet */ }
    }
    if (!target) throw new Error('Chrome did not open a debuggable page.');
    const socket = ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((res, rej) => { socket.onopen = () => res(); socket.onerror = () => rej(new Error('DevTools connection failed.')); });
    let id = 0;
    const pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
    socket.onmessage = m => { const d = JSON.parse(String(m.data)) as { id?: number; result?: unknown; error?: { message: string } }; if (d.id && pending.has(d.id)) { pending.get(d.id)!(d); pending.delete(d.id); } };
    const send = <R>(method: string, params: Record<string, unknown> = {}) => new Promise<R>((res, rej) => {
      const i = ++id, timer = setTimeout(() => rej(new Error(`DevTools call ${method} timed out.`)), Math.max(1000, deadline - Date.now()));
      pending.set(i, m => { clearTimeout(timer); if (m.error) rej(new Error(m.error.message)); else res(m.result as R); });
      socket.send(JSON.stringify({ id: i, method, params }));
    });
    const evalJs = async <R>(expression: string, awaitPromise: boolean): Promise<R> => {
      const r = await send<{ result?: { value?: R }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result?.value as R;
    };
    await send('Page.enable');
    await send('Page.navigate', { url: o.url });
    let title = '';
    while (!title.startsWith(o.readyTitle)) {
      if (Date.now() > deadline) throw new Error(`The page did not become ready (title "${title}").`);
      await new Promise(r => setTimeout(r, 150));
      title = (await evalJs<string>('document.title', false)) ?? '';
      if (title.startsWith('ERROR')) throw new Error(title.slice(6));
    }
    return await evalJs<T>(`(async () => { ${o.script} })()`, true);
  } finally { cleanup(); }
}
