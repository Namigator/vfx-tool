import test from 'node:test';
import assert from 'node:assert/strict';
import { createF01Document } from '../src/graph/fixtures.ts';
import { aiApplyPatches, runAiSession, type AiSessionOptions } from '../src/ai/session.ts';
import type { AiFrame, AiRequest } from '../src/ai/types.ts';
const response = (patches: unknown[] = [], done = false, summary = 'Edited the effect.') => ({ text: JSON.stringify({ summary, patches, ticks: [0, 20, 40], done }) });
const make = (overrides: Partial<AiSessionOptions> = {}): AiSessionOptions => ({ document: createF01Document(), prompt: 'Move the source higher', connection: { provider: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'test', vision: true }, maxRounds: 3, request: async () => response([], true), render: async (_d, ticks) => ticks.map(tick => ({ tick, image: 'data:image/png;base64,AAAA' })), ...overrides });
const move = [{ op: 'set', path: ['anchors', 0, 'position', 1], value: 2 }];
test('draft changes preserve original, send actual frames, and require review after edits', async () => {
  const options = make(), before = JSON.stringify(options.document); let calls = 0;
  options.request = async (r: AiRequest) => { calls++; assert.equal(r.messages.at(-1)?.images?.length, 3); return calls === 1 ? response(move, true) : response([], true, 'Reviewed the edited frames.'); };
  const result = await runAiSession(options);
  assert.equal(calls, 2); assert.equal(result.document.anchors[0].position[1], 2); assert.equal(result.visuallyReviewed, true); assert.equal(JSON.stringify(options.document), before);
});
test('forbidden/invalid patches are rejected and diagnostics enable a repair', async () => {
  let calls = 0; const r = await runAiSession(make({ request: async req => { calls++; if (calls === 1) return response([{ op: 'set', path: ['id'], value: 'hacked' }]); if (calls === 2) { assert.match(req.messages.at(-1)!.text, /Rejected change/); return response(move); } return response([], true); } }));
  assert.notEqual(r.document.id, 'hacked'); assert.equal(r.document.anchors[0].position[1], 2);
  assert.throws(() => aiApplyPatches(createF01Document(), [{ op: 'set', path: ['durationTicks'], value: -5 }]), /Duration/);
  assert.throws(() => aiApplyPatches(createF01Document(), [{ op: 'set', path: ['assets'], value: [] }]), /effect fields/);
});
test('text-only private model never receives images or claims visual review', async () => {
  const options = make(); options.connection.vision = false;
  options.request = async req => { assert.equal(req.messages.at(-1)!.images, undefined); return response([], true); };
  const r = await runAiSession(options); assert.equal(r.visuallyReviewed, false); assert.equal(r.frames.length, 3);
});
test('model can request inspection at other ticks before making edits', async () => {
  let calls = 0;
  const result = await runAiSession(make({ request: async req => {
    if (++calls === 1) return { text: JSON.stringify({ summary: 'Inspect the peak.', patches: [], ticks: [27], done: false }) };
    assert.match(req.messages.at(-1)!.text, /Rendered ticks: 27/); return response([], true);
  } }));
  assert.deepEqual(result.frames.map(f => f.tick), [27]); assert.equal(result.visuallyReviewed, true);
});
test('last-round edits are explicitly unreviewed, not a completed visual pass', async () => {
  const r = await runAiSession(make({ maxRounds: 2, request: async () => response(move, true) }));
  assert.equal(r.visuallyReviewed, false); assert.match(r.summary, /not completed/);
});
test('cancellation never returns/apply a model edit', async () => {
  const controller = new AbortController(), options = make({ signal: controller.signal, request: async () => { controller.abort(); return response(move); } }); const before = JSON.stringify(options.document);
  await assert.rejects(runAiSession(options), /cancelled/); assert.equal(JSON.stringify(options.document), before);
});
test('already-cancelled run performs no rendering or inference', async () => {
  const c = new AbortController(); c.abort(); let calls = 0;
  await assert.rejects(runAiSession(make({ signal: c.signal, request: async () => { calls++; return response(); }, render: async () => { calls++; return []; } })), /cancelled/);
  assert.equal(calls, 0);
});
test('ticks can follow an extended duration in the same valid edit', async () => {
  let calls = 0;
  const result = await runAiSession(make({ request: async () => ++calls === 1 ? { text: JSON.stringify({ summary: 'Extended duration.', patches: [{ op: 'set', path: ['durationTicks'], value: 240 }], ticks: [0, 150, 220], done: false }) } : response([], true) }));
  assert.equal(result.document.durationTicks, 240); assert.deepEqual(result.frames.map(f => f.tick), [0, 150, 220]);
});
test('model can insert a reusable component, then review the new render', async () => {
  let calls = 0; const r = await runAiSession(make({ request: async () => ++calls === 1 ? { text: JSON.stringify({ summary: 'Added smoke.', patches: [], components: [{ id: 'smoke-plume', prefix: 'ai-smoke' }], ticks: [20, 40, 60], done: false }) } : response([], true) }));
  assert.ok(r.document.graphs[0].nodes.some(n => n.type === 'Group')); assert.equal(r.visuallyReviewed, true);
});

test('AI session: replies from thinking / chatty models still parse (think blocks, fences, prose)', async () => {
  const { parseModelJson } = await import('../src/ai/session.ts');
  const obj = { summary: 'ok', patches: [], ticks: [0], done: true };
  const json = JSON.stringify(obj);
  assert.deepEqual(parseModelJson(json), obj);
  assert.deepEqual(parseModelJson('<think>I should add sparks {not json}</think>\n' + json), obj);
  assert.deepEqual(parseModelJson('```json\n' + json + '\n```'), obj);
  assert.deepEqual(parseModelJson('Here is the edit:\n' + json + '\nLet me know.'), obj);
  assert.deepEqual(parseModelJson('reasoning without an opening tag</think>' + json), obj);
  assert.deepEqual(parseModelJson('{"summary":"a } brace \\" in a string","patches":[],"ticks":[],"done":false}'), { summary: 'a } brace " in a string', patches: [], ticks: [], done: false });
  assert.throws(() => parseModelJson('no json here'), /documented JSON object/);
});
