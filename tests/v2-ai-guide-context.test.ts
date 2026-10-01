import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAiGuide, aiGuideContext, MAX_GUIDE_CONTEXT } from '../tools/ai-guide-context.ts';
import { createAiServer } from '../tools/ai-server.ts';
import { requestAi } from '../src/ai/provider.ts';
import { runAiSession } from '../src/ai/session.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import type { AiRequest } from '../src/ai/types.ts';

const guide = loadAiGuide();
const request = (prompt: string): AiRequest => ({ connection: { provider: 'openai', model: 'test', baseUrl: 'http://localhost:1234/v1', vision: false }, system: 'Edit the effect using JSON.', messages: [{ role: 'user', text: `Request: ${prompt}\nCurrent document: {"type":"Schedule"}` }], guideTopics: [], maxTokens: 128 });

test('guide includes published chapters, recipes and references but excludes internal gap/acceptance notes', () => {
  for (const topic of ['concepts', 'editor', 'workflow', 'recipes/lightning', 'reference/nodes', 'reference/components', 'reference/limits']) assert.ok(guide.some(s => s.topic === topic), topic);
  assert.equal(guide.some(s => s.topic.includes('_')), false);
  assert.equal(new Set(guide.map(s => s.id)).size, guide.length);
});

test('repeat and keyframe requests include original guide text and bounded context', () => {
  const r = request('Change schedule repeat interval and keyframes');
  const context = aiGuideContext(guide, r);
  assert.ok(context.length <= MAX_GUIDE_CONTEXT);
  const schedule = guide.find(s => s.title === 'Schedule')!;
  assert.ok(schedule);
  assert.ok(context.includes(schedule.text));
  const concepts = readFileSync(new URL('../docs/ai-guide/concepts.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(context.includes(concepts.split('\n').find(l => l.includes('keyframe'))!));
  assert.match(context, /Guide index:/);
});

test('explicit recipe/node lookups use exact sections, unknown topic cannot read another file', () => {
  const r = request('Make a smoke plume');
  r.guideTopics = ['reference/nodes#screenflash', 'recipes/lightning', '../../package.json'];
  const context = aiGuideContext(guide, r);
  assert.ok(context.includes(guide.find(s => s.title === 'ScreenFlash')!.text));
  assert.match(context, /docs\/ai-guide\/recipes\/lightning/);
  assert.match(context, /Unknown guide topic: ..\/..\/package.json/);
  assert.doesNotMatch(context, /"dependencies"/);
  assert.ok(context.length <= MAX_GUIDE_CONTEXT);
});

test('retrieval does not copy graph credentials into its documentation context', () => {
  const r = request('Repeat screen flash');
  r.messages[0].text += '\nsecret=do-not-include';
  r.connection.apiKey = 'private-provider-secret';
  const context = aiGuideContext(guide, r);
  assert.ok(!context.includes('do-not-include'));
  assert.ok(!context.includes('private-provider-secret'));
});

test('model can read another guide section next round without editing the document', async () => {
  const original = createF01Document(), before = JSON.stringify(original); let calls = 0;
  const result = await runAiSession({ document: original, prompt: 'Change schedule timing', connection: request('').connection, maxRounds: 3,
    render: async () => [], request: async r => {
      assert.deepEqual(r.guideTopics, calls ? ['reference/nodes#schedule'] : []);
      return { text: JSON.stringify({ summary: 'Read the guide.', patches: [], ticks: [], done: ++calls > 1, ...(calls === 1 ? { guideTopics: ['reference/nodes#schedule'] } : {}) }) };
    } });
  assert.equal(calls, 2); assert.equal(JSON.stringify(result.document), before);
});

test('actual companion relays docs through every provider payload and leaves connection probes small', async () => {
  const token = 'guide-test-token-long', origin = 'http://127.0.0.1:5177'; let checked = 0;
  const server = createAiServer({ token, origins: [origin], request: (r, options) => requestAi(r, { ...options, fetch: async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const system = r.connection.provider === 'openai' ? body.messages[0].content : r.connection.provider === 'anthropic' ? body.system : body.systemInstruction.parts[0].text;
    if (r.guideTopics !== undefined) { assert.match(system, /VFX DOCUMENTATION/); assert.ok(system.includes(guide.find(s => s.title === 'Schedule')!.text)); checked++; }
    else assert.equal(system, 'Edit the effect using JSON.');
    return Response.json(r.connection.provider === 'openai' ? { choices: [{ message: { content: 'ready' } }] } : r.connection.provider === 'anthropic' ? { content: [{ type: 'text', text: 'ready' }] } : { candidates: [{ content: { parts: [{ text: 'ready' }] } }] });
  } }) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/chat`;
  const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
      const r = request('Repeat the schedule'); r.connection.provider = provider; r.connection.apiKey = 'test-key';
      const reply = await fetch(url, { method: 'POST', headers, body: JSON.stringify(r) });
      assert.equal(reply.status, 200); assert.deepEqual(await reply.json(), { text: 'ready' });
    }
    const probe = request('Connection ready'); delete probe.guideTopics;
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(probe) })).status, 200);
    const invalid = request('test'); invalid.guideTopics = Array(7).fill('concepts');
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(invalid) })).status, 400);
    assert.equal(checked, 3);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
