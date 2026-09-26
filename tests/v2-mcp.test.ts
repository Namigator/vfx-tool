import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVfxServer } from '../mcp/server.ts';

async function connect() {
  const root = mkdtempSync(join(tmpdir(), 'vfx-mcp-'));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createVfxServer({ root });
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content.map(c => c.text).join('\n'), error: r.isError === true };
  };
  return { root, client, call };
}

test('MCP lists the catalog and describes node types', async () => {
  const { client, call } = await connect();
  const tools = (await client.listTools()).tools.map(t => t.name);
  for (const t of ['vfx_new_document', 'vfx_add_node', 'vfx_connect', 'vfx_compile', 'vfx_sample_particles', 'vfx_render_audio', 'vfx_preview_url']) assert.ok(tools.includes(t), t);
  assert.match((await call('vfx_list_node_types', {})).text, /Emitter +in\[anchor:anchor/);
  assert.match((await call('vfx_describe_node_type', { type: 'Gravity' })).text, /acceleration/);
});

test('an agent can build a gravity fountain from blank through tools only', async () => {
  const { root, call } = await connect();
  assert.equal((await call('vfx_new_document', { template: 'blank', id: 'fountain' })).error, false);
  const steps: [string, Record<string, unknown>][] = [
    ['vfx_add_node', { docId: 'fountain', type: 'Schedule', id: 'sched', params: { startTicks: 0, durationTicks: 60, mode: 'window' } }],
    ['vfx_add_node', { docId: 'fountain', type: 'Emitter', id: 'em', params: { shape: 'cone', direction: [0, 1, 0], coneAngle: 0.3, rate: 120, burst: 0, speedMin: 4, speedMax: 6 } }],
    ['vfx_add_node', { docId: 'fountain', type: 'Gravity', id: 'grav' }],
    ['vfx_add_node', { docId: 'fountain', type: 'Material', id: 'mat' }],
    ['vfx_add_node', { docId: 'fountain', type: 'BillboardRenderer', id: 'bb' }],
    ['vfx_connect', { docId: 'fountain', from: 'node-source.out', to: 'em.anchor' }],
    ['vfx_connect', { docId: 'fountain', from: 'sched.window', to: 'em.window' }],
    ['vfx_connect', { docId: 'fountain', from: 'em.particles', to: 'grav.particles' }],
    ['vfx_connect', { docId: 'fountain', from: 'grav.particles', to: 'bb.particles' }],
    ['vfx_connect', { docId: 'fountain', from: 'mat.material', to: 'bb.material' }],
    ['vfx_connect', { docId: 'fountain', from: 'bb.visual', to: 'node-output.visual' }],
  ];
  for (const [name, args] of steps) { const r = await call(name, args); assert.equal(r.error, false, `${name}: ${r.text}`); }
  const compiled = await call('vfx_compile', { docId: 'fountain' });
  assert.match(compiled.text, /particles OK: 1 system/);
  assert.match(compiled.text, /shape cone.*ops \[gravity\]/);
  const s = await call('vfx_sample_particles', { docId: 'fountain', tick: 40 });
  assert.match(s.text, /grav: \d+ live/);
  assert.ok(existsSync(join(root, 'work', 'mcp', 'fountain.json')));
  assert.match((await call('vfx_preview_url', { docId: 'fountain' })).text, /\?workspace=v2&doc=\/work\/mcp\/fountain\.json/);
  const saved = await call('vfx_save_document', { docId: 'fountain', path: 'out/f.json' });
  assert.equal(saved.error, false);
  assert.equal(JSON.parse(readFileSync(join(root, 'out', 'f.json'), 'utf8')).id, 'fountain');
});

test('invalid edits are rejected and leave the document unchanged; audio renders to WAV', async () => {
  const { root, call } = await connect();
  await call('vfx_new_document', { template: 'f01', id: 'd' });
  const before = (await call('vfx_get_document', { docId: 'd', full: true })).text;
  const r = await call('vfx_set_params', { docId: 'd', nodeId: 'node-emitter', params: { burst: -5 } });
  assert.equal(r.error, true);
  assert.equal((await call('vfx_get_document', { docId: 'd', full: true })).text, before);
  assert.equal((await call('vfx_add_node', { docId: 'd', type: 'NotANode' })).error, true);
  await call('vfx_new_document', { template: 'lightning-audio', id: 'snd' });
  const w = await call('vfx_render_audio', { docId: 'snd' });
  assert.equal(w.error, false, w.text);
  assert.equal(readFileSync(join(root, 'work', 'mcp', 'snd.wav')).subarray(0, 4).toString(), 'RIFF');
});
