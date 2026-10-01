// Local acceptance fixture only. No external model, credentials or paid inference.
import { createServer } from 'node:http';
import { createAiServer } from './ai-server.ts';
let calls = 0;
const model = createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  calls++; const text = JSON.stringify(input.messages ?? []);
  const isTest = text.includes('Reply with: Connection ready.');
  const user = input.messages?.at(-1)?.content;
  const current = typeof user === 'string' ? user : user?.find((p: any) => p.type === 'text')?.text ?? '';
  if (current.includes('cancel-test')) await new Promise(r => setTimeout(r, 5000));
  const added = current.includes('ai-smoke');
  const result = isTest ? 'Connection ready.' : JSON.stringify({ summary: added ? 'Inspected the smoke draft frames. This is a local mock result.' : 'Added a Smoke plume component as a draft.', patches: [], components: added ? [] : [{ id: 'smoke-plume', prefix: 'ai-smoke' }], ticks: [20, 40, 60], done: added });
  console.log(JSON.stringify({ call: calls, imageCount: Array.isArray(user) ? user.filter((p: any) => p.type === 'image_url').length : 0, phase: isTest ? 'connection' : added ? 'review' : 'edit' }));
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: result } }] }));
});
model.listen(5182, '127.0.0.1');
createAiServer({ token: 'vfx-local-test-token', origins: ['http://127.0.0.1:5177'] }).listen(5181, '127.0.0.1', () => console.log('LOCAL MOCK ONLY: companion 5181, model http://127.0.0.1:5182/v1, token vfx-local-test-token'));
