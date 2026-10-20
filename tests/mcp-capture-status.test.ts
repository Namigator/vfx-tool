import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { classifyCaptureStatus } from '../mcp/captureStatus.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { registrySignature } from '../src/graph/registrySignature.ts';
import { captureStatusHandler } from '../tools/captureStatusPlugin.ts';

const url = 'http://127.0.0.1:5174/';
test('capture status rejects missing, mismatched and failed captures', () => {
  for (const [raw, pattern] of [
    [undefined, /did not report/],
    [{ tick: 7, state: 'ok', registry: 'old' }, /version mismatch/],
    [{ tick: 7, state: 'error', registry: 'sig', message: 'Unknown axisMode' }, /Tick 7 failed to render: Unknown axisMode/],
    ['{', /invalid capture status JSON/],
    [{ tick: 8, state: 'ok', registry: 'sig' }, /different tick/],
    [{ tick: 7, state: 'ready', registry: 'sig' }, /invalid capture state/],
  ] as const) {
    const r = classifyCaptureStatus(raw, 'sig', 7, url);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, pattern);
  }
  assert.deepEqual(classifyCaptureStatus({ tick: 7, state: 'ok', registry: 'sig' }, 'sig', 7, url), { ok: true });
});

test('registry signature is deterministic, order independent and tracks added params', () => {
  const registry = createRegistry(), sig = registrySignature(registry);
  assert.equal(registrySignature(createRegistry()), sig);
  assert.equal(registrySignature(new Map([...registry].reverse())), sig);
  const copy = structuredClone(registry);
  const spec = [...copy.values()].find(s => s.parameters.length)!;
  spec.parameters.push({ ...spec.parameters[0], id: 'captureTestParam' });
  assert.notEqual(registrySignature(copy), sig);
  assert.equal(registrySignature(registry), sig);
});

test('capture status handler rejects unsafe runs and persists a valid beacon', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfx-status-'));
  const handler = captureStatusHandler(root);
  const post = async (body: string) => {
    const req = Object.assign(Readable.from([Buffer.from(body)]), { method: 'POST', url: '/__vfx/capture-status' });
    const res = { statusCode: 200, end() {} };
    await handler(req as unknown as IncomingMessage, res as ServerResponse, () => assert.fail('unexpected next'));
    return res.statusCode;
  };
  try {
    for (const run of ['../escape', '', 'a'.repeat(65), 'bad/id']) assert.equal(await post(JSON.stringify({ run })), 400);
    assert.equal(existsSync(join(root, 'work')), false);
    const body = JSON.stringify({ run: 'run_1-OK', tick: 7, state: 'ok', registry: 'sig' });
    assert.equal(await post(body), 204);
    assert.equal(readFileSync(join(root, 'work/mcp/frames/status/run_1-OK.json'), 'utf8'), body);
    assert.equal(await post('{'), 400);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
