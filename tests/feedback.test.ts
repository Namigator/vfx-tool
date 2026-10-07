import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendFeedback } from '../src/feedback.ts';

const mockFetch = (status: number, body: unknown, seen: { body?: Record<string, unknown> }) =>
  (async (_u: unknown, o: { body: string }) => { seen.body = JSON.parse(o.body); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;

test('sendFeedback posts the ticket with the access key and optional reply address', async () => {
  const seen: { body?: Record<string, unknown> } = {};
  await sendFeedback({ kind: 'Bug', message: '  smoke flickers  ', replyTo: 'a@b.co', source: 'test' }, mockFetch(200, { success: true }, seen));
  assert.equal(seen.body!.subject, 'VFX Studio ticket: Bug');
  assert.equal(seen.body!.message, 'smoke flickers');
  assert.equal(seen.body!.email, 'a@b.co');
  assert.equal(seen.body!.botcheck, false);
  assert.ok(String(seen.body!.access_key).length > 0);
});

test('sendFeedback rejects empty messages and reports server failures', async () => {
  const seen = {};
  await assert.rejects(sendFeedback({ kind: 'Other', message: ' ', source: 't' }, mockFetch(200, { success: true }, seen)), /empty/);
  await assert.rejects(sendFeedback({ kind: 'Other', message: 'hello', source: 't' }, mockFetch(403, { success: false, message: 'Invalid key' }, seen)), /Invalid key/);
});

test('feedbackLink round-trips through parseFeedbackHash', async () => {
  const { feedbackLink, parseFeedbackHash } = await import('../src/feedback.ts');
  const link = feedbackLink('Bug', 'snow & rain? #1 50%', 'https://x.test/index.html');
  assert.deepEqual(parseFeedbackHash(new URL(link).hash), { kind: 'Bug', message: 'snow & rain? #1 50%' });
  assert.equal(parseFeedbackHash('#other'), null);
});
