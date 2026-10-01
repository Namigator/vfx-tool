import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MODEL_TIMEOUT_MS, requestAi, validateAiRequest } from '../src/ai/provider.ts';
import { loadAiGuide, aiGuideContext } from './ai-guide-context.ts';

export function createAiServer(options: { token: string; origins: string[]; request?: typeof requestAi }): Server {
  if (options.token.length < 16) throw new Error('Pairing token must contain at least 16 characters.');
  const origins = new Set(options.origins), expected = Buffer.from(`Bearer ${options.token}`);
  const guide = loadAiGuide();
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (!origin || !origins.has(origin)) { send(403, { error: 'Browser origin is not allowed by this companion.' }); return; }
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.writeHead(204); res.end(); return;
    }
    const auth = Buffer.from(req.headers.authorization ?? '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) { send(401, { error: 'Pair this browser with the companion token.' }); return; }
    if (req.url === '/health' && req.method === 'GET') { send(200, { ok: true, service: 'VFX Studio AI companion' }); return; }
    if (req.url !== '/chat' || req.method !== 'POST') { send(404, { error: 'Unknown companion route.' }); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { send(415, { error: 'Send JSON.' }); return; }
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), MODEL_TIMEOUT_MS + 5_000);
    req.on('aborted', () => abort.abort()); res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 8_000_000) { send(413, { error: 'AI request exceeds 8 MB.' }); return; } chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8')); validateAiRequest(input);
      // Connection probes stay small. Draft requests opt in even with no explicit topics.
      if (input.guideTopics !== undefined) {
        input.system += aiGuideContext(guide, input);
        validateAiRequest(input);
      }
      const result = await (options.request ?? requestAi)(input, { signal: abort.signal });
      if (!res.destroyed) send(200, result);
    } catch (e) { if (!res.destroyed) send(abort.signal.aborted ? 504 : 400, { error: e instanceof SyntaxError ? 'Invalid request JSON.' : e instanceof Error ? e.message : 'AI request failed.' }); }
    finally { clearTimeout(timer); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.VFX_AI_TOKEN || randomBytes(24).toString('hex');
  const origins = (process.env.VFX_AI_ORIGINS || 'http://127.0.0.1:5174,http://127.0.0.1:5176,http://127.0.0.1:5177,http://localhost:5174,https://demo.xpo.dev').split(',').map(s => s.trim()).filter(Boolean);
  const port = Number(process.env.VFX_AI_PORT || 5181);
  const server = createAiServer({ token, origins }); server.requestTimeout = MODEL_TIMEOUT_MS + 10_000;
  server.listen(port, '127.0.0.1', () => { console.log(`VFX AI companion: http://127.0.0.1:${port}\nPairing token: ${token}\nAllowed sites: ${origins.join(', ')}`); });
}
