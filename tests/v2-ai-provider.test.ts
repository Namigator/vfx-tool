import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAi, validateAiRequest } from '../src/ai/provider.ts';
import { createAiServer } from '../tools/ai-server.ts';
import type { AiRequest } from '../src/ai/types.ts';

const request = (provider: 'openai' | 'anthropic' | 'gemini' = 'openai'): AiRequest => ({ connection: { provider, model: 'private-model', baseUrl: 'http://127.0.0.1:1234/prefix/v1', apiKey: 'test-key', vision: true }, system: 'Edit a draft.', messages: [{ role: 'user', text: 'Inspect', images: ['data:image/png;base64,AAAA'] }], maxTokens: 128 });
test('private OpenAI-compatible server keeps path prefix, supports optional key and vision', async () => {
  const r = request(); delete r.connection.apiKey;
  const result = await requestAi(r, { fetch: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:1234/prefix/v1/chat/completions');
    assert.equal((init!.headers as any).Authorization, undefined);
    const body = JSON.parse(init!.body as string); assert.equal(body.model, 'private-model'); assert.equal(body.messages[1].content[1].image_url.url, r.messages[0].images![0]);
    assert.equal(init!.redirect, 'error'); return Response.json({ choices: [{ message: { content: 'ready' } }] });
  } }); assert.equal(result.text, 'ready');
});
test('Claude and Gemini use native messages/image payloads and header authentication', async () => {
  for (const provider of ['anthropic', 'gemini'] as const) {
    const result = await requestAi(request(provider), { fetch: async (url, init) => {
      assert.ok(String(url).endsWith(provider === 'anthropic' ? '/messages' : '/models/private-model:generateContent'));
      assert.ok(!String(url).includes('test-key')); const h = init!.headers as any, b = JSON.parse(init!.body as string);
      if (provider === 'anthropic') { assert.equal(h['x-api-key'], 'test-key'); assert.equal(b.messages[0].content[1].source.data, 'AAAA'); return Response.json({ content: [{ type: 'text', text: 'ready' }] }); }
      assert.equal(h['x-goog-api-key'], 'test-key'); assert.equal(b.contents[0].parts[1].inlineData.data, 'AAAA'); return Response.json({ candidates: [{ content: { parts: [{ text: 'ready' }] } }] });
    } }); assert.equal(result.text, 'ready');
  }
});
test('connection validation rejects unsafe URLs, external images and invalid settings', () => {
  for (const baseUrl of ['file:///secret', 'https://key:secret@example.org', 'http://localhost/v1?key=secret']) { const r = request(); r.connection.baseUrl = baseUrl; assert.throws(() => validateAiRequest(r)); }
  const r = request(); r.messages[0].images = ['https://example.org/frame.png']; assert.throws(() => validateAiRequest(r));
  const t = request(); t.connection.vision = false; assert.throws(() => validateAiRequest(t));
});
test('provider errors do not expose keys or raw upstream bodies; a JSON error message is shown with the key blanked', async () => {
  await assert.rejects(requestAi(request(), { fetch: async () => new Response(JSON.stringify({ error: { message: 'models/x is not found; key test-key rejected' } }), { status: 404 }) }),
    e => e instanceof Error && e.message.includes('HTTP 404') && e.message.includes('models/x is not found') && !e.message.includes('test-key'));
  await assert.rejects(requestAi(request(), { fetch: async () => new Response('secret test-key', { status: 401 }) }), e => e instanceof Error && e.message.includes('HTTP 401') && !e.message.includes('test-key'));
  await assert.rejects(requestAi(request(), { fetch: async () => { throw new Error('test-key'); } }), e => e instanceof Error && !e.message.includes('test-key'));
});
test('paired companion enforces Origin and token, relays requests, and exposes no credentials', async () => {
  const token = 'test-pairing-token-long', origin = 'http://127.0.0.1:5177'; let calls = 0;
  const server = createAiServer({ token, origins: [origin], request: async r => { calls++; assert.equal(r.connection.model, 'private-model'); return { text: 'ready' }; } });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const address = server.address() as { port: number }, url = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(url + '/health', { headers: { Origin: 'http://evil.test', Authorization: `Bearer ${token}` } })).status, 403);
    assert.equal((await fetch(url + '/health', { headers: { Origin: origin } })).status, 401);
    const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const health = await fetch(url + '/health', { headers }); assert.equal(health.status, 200); assert.equal(health.headers.get('Access-Control-Allow-Origin'), origin);
    const r = await fetch(url + '/chat', { method: 'POST', headers, body: JSON.stringify(request()) }); assert.deepEqual(await r.json(), { text: 'ready' }); assert.equal(calls, 1);
    assert.equal((await fetch(url + '/chat', { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await fetch(url + '/chat', { method: 'POST', headers, body: JSON.stringify({}) })).status, 400); assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
