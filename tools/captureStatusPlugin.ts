import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export function parseCaptureStatus(body: string): { run: string } & Record<string, unknown> {
  const s = JSON.parse(body);
  if (!s || typeof s.run !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(s.run)) throw new Error('Invalid run id');
  return s;
}

export function captureStatusHandler(root: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    if (req.url?.split('?')[0] !== '/__vfx/capture-status') { next(); return; }
    if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 64 * 1024) { res.statusCode = 413; res.end(); return; }
      }
    } catch { res.statusCode = 400; res.end(); return; }
    let status: ReturnType<typeof parseCaptureStatus>;
    try { status = parseCaptureStatus(body); } catch { res.statusCode = 400; res.end(); return; }
    try {
      const dir = join(root, 'work', 'mcp', 'frames', 'status');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${status.run}.json`), body);
      res.statusCode = 204;
    } catch { res.statusCode = 500; }
    res.end();
  };
}

export function captureStatusPlugin(): Plugin {
  return {
    name: 'capture-status',
    configureServer(server) { server.middlewares.use(captureStatusHandler(server.config.root)); },
    configurePreviewServer(server) { server.middlewares.use(captureStatusHandler(server.config.root)); },
  };
}
