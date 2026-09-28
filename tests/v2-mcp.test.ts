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
  for (const t of ['vfx_new_document', 'vfx_add_node', 'vfx_connect', 'vfx_compile', 'vfx_sample_particles', 'vfx_render_audio', 'vfx_preview_url', 'vfx_render_frames', 'vfx_list_components', 'vfx_add_component']) assert.ok(tools.includes(t), t);
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

test('components and knobs through MCP: insert, list, set, recompile', async () => {
  const { call } = await connect();
  await call('vfx_new_document', { template: 'blank', id: 'k' });
  assert.match((await call('vfx_list_components', {})).text, /fireball: Fireball/);
  assert.equal((await call('vfx_add_component', { docId: 'k', component: 'impact-flash' })).error, false);
  assert.match((await call('vfx_list_controls', { docId: 'k' })).text, /Sparks = 80/);
  assert.equal((await call('vfx_set_control', { docId: 'k', control: 'Sparks', value: 150 })).error, false);
  assert.match((await call('vfx_list_controls', { docId: 'k' })).text, /Sparks = 150/);
  assert.equal((await call('vfx_set_control', { docId: 'k', control: 'Sparks', value: -3 })).error, true, 'out of bounds is rejected');
  assert.match((await call('vfx_compile', { docId: 'k' })).text, /particles OK: 3 system/);
});

test('MCP: import a texture onto a Material, export a .vfxpack, reopen it with the bytes restored', async () => {
  const { root, call } = await connect();
  const { mkdirSync, writeFileSync, copyFileSync } = await import('node:fs');
  mkdirSync(join(root, 'in'), { recursive: true });
  copyFileSync(join(process.cwd(), 'mcp/examples/assets/four-blobs.png'), join(root, 'in/blobs.png'));
  writeFileSync(join(root, 'in/not-an-image.png'), 'hello');
  await call('vfx_new_document', { template: 'blank', id: 't' });
  await call('vfx_add_node', { docId: 't', type: 'Material', id: 'mat' });
  assert.match((await call('vfx_import_texture', { docId: 't', path: 'in/not-an-image.png' })).text, /Only PNG/);
  assert.equal((await call('vfx_import_texture', { docId: 't', path: '../outside.png' })).error, true);
  const imp = await call('vfx_import_texture', { docId: 't', path: 'in/blobs.png', rows: 2, columns: 2, materialId: 'mat' });
  assert.equal(imp.error, false, imp.text);
  const id = /id ([0-9a-f]{64})/.exec(imp.text)![1];
  assert.match((await call('vfx_get_document', { docId: 't', full: true })).text, new RegExp(`"textureAsset": "${id}"`));
  assert.match((await call('vfx_export_pack', { docId: 't' })).text, /Wrote/);
  assert.ok(existsSync(join(root, 'work/mcp/t.vfxpack')));
  const opened = await call('vfx_open_pack', { path: 'work/mcp/t.vfxpack', docId: 't2' });
  assert.match(opened.text, /validated; 1 asset file/);
  const sha = JSON.parse(readFileSync(join(root, 'work/mcp/t2.json'), 'utf8')).assets[0].sha256;
  assert.ok(existsSync(join(root, `work/mcp/assets/${sha}.png`)));
});

test('MCP: import a GLB onto a MeshRenderer; non-GLB and bad renderer ids are rejected', async () => {
  const { root, call } = await connect();
  const { mkdirSync, copyFileSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(root, 'in'), { recursive: true });
  copyFileSync(join(process.cwd(), 'mcp/examples/assets/star.glb'), join(root, 'in/star.glb'));
  writeFileSync(join(root, 'in/fake.glb'), 'this is plainly not a glb file at all');
  await call('vfx_new_document', { template: 'blank', id: 'm' });
  await call('vfx_add_node', { docId: 'm', type: 'MeshRenderer', id: 'mr' });
  assert.match((await call('vfx_import_mesh', { docId: 'm', path: 'in/fake.glb' })).text, /Not a GLB/);
  assert.equal((await call('vfx_import_mesh', { docId: 'm', path: 'in/star.glb', rendererId: 'nope' })).error, true);
  const r = await call('vfx_import_mesh', { docId: 'm', path: 'in/star.glb', rendererId: 'mr' });
  assert.match(r.text, /40 triangles/);
  const d = JSON.parse(readFileSync(join(root, 'work/mcp/m.json'), 'utf8'));
  assert.equal(d.graphs[0].nodes.find((n: { id: string }) => n.id === 'mr').params.meshAsset, d.assets[0].id);
  assert.ok(existsSync(join(root, `work/mcp/assets/${d.assets[0].sha256}.glb`)));
  // importScale is recorded and reaches the mesh layer when the renderer uses the model's real size.
  await call('vfx_new_document', { template: 'blank', id: 'm2' });
  await call('vfx_add_node', { docId: 'm2', type: 'MeshRenderer', id: 'mr', params: { importedSize: 'real' } });
  await call('vfx_import_mesh', { docId: 'm2', path: 'in/star.glb', rendererId: 'mr', importScale: 0.01 });
  const d2 = JSON.parse(readFileSync(join(root, 'work/mcp/m2.json'), 'utf8'));
  assert.equal(d2.assets[0].interpretation.mesh.importScale, 0.01);
});

test('MCP parity: group nodes, save a group as a user component, insert it twice, compile reports travel', async () => {
  const { call } = await connect();
  await call('vfx_new_document', { template: 'blank', id: 'u' });
  const ins = await call('vfx_add_component', { docId: 'u', component: 'energy-bolt', group: true });
  const gid = /Group node "([^"]+)"/.exec(ins.text)![1];
  const saved = await call('vfx_save_group_component', { docId: 'u', groupNodeId: gid, name: 'Parity bolt' });
  const uid = /as (user:[^.]+)\./.exec(saved.text)![1];
  assert.match((await call('vfx_list_components', {})).text, new RegExp(uid));
  await call('vfx_new_document', { template: 'blank', id: 'u2' });
  assert.equal((await call('vfx_add_component', { docId: 'u2', component: uid })).error, false);
  assert.equal((await call('vfx_add_component', { docId: 'u2', component: uid })).error, false);
  const compiled = (await call('vfx_compile', { docId: 'u2' })).text;
  assert.equal((compiled.match(/^travel /gm) ?? []).length, 2, compiled);
  await call('vfx_new_document', { template: 'f01', id: 'g' });
  const grouped = await call('vfx_group_nodes', { docId: 'g', nodeIds: ['node-emitter', 'node-initial'], label: 'Block' });
  assert.match(grouped.text, /Group node "group" wraps graph/);
  assert.equal((await call('vfx_group_nodes', { docId: 'g', nodeIds: ['node-output'] })).error, true);
  assert.match((await call('vfx_delete_user_component', { id: uid })).text, /Deleted/);
});

test('MCP parity: undo/redo, list documents, move node', async () => {
  const { call } = await connect();
  await call('vfx_new_document', { template: 'blank', id: 'h' });
  await call('vfx_add_node', { docId: 'h', type: 'Gravity', id: 'grav' });
  assert.match((await call('vfx_get_document', { docId: 'h' })).text, /grav Gravity/);
  assert.match((await call('vfx_undo', { docId: 'h' })).text, /Undone/);
  assert.doesNotMatch((await call('vfx_get_document', { docId: 'h' })).text, /grav Gravity/);
  assert.match((await call('vfx_redo', { docId: 'h' })).text, /Redone/);
  assert.match((await call('vfx_get_document', { docId: 'h' })).text, /grav Gravity/);
  assert.equal((await call('vfx_redo', { docId: 'h' })).error, true);
  assert.match((await call('vfx_move_node', { docId: 'h', nodeId: 'grav', x: 40, y: 80 })).text, /Moved/);
  assert.match((await call('vfx_get_document', { docId: 'h', full: true })).text, /"grav": \{\s*"x": 40,\s*"y": 80/);
  assert.match((await call('vfx_list_documents', {})).text, /work\/mcp\/h\.json/);
});

test('MCP: vfx_guide lists topics and returns a recipe', async () => {
  const { call } = await connect();
  assert.match((await call('vfx_guide', {})).text, /Topics: basics, glow, fire/);
  assert.match((await call('vfx_guide', { topic: 'fire' })).text, /flame-tongue-a/);
  assert.match((await call('vfx_guide', { topic: 'nope' })).text, /Unknown topic/);
});

test('MCP: vfx_convert_legacy converts a v1 default or a v1 file into a new graph document with a report', async () => {
  const { root, call } = await connect();
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { createRecipe } = await import('../src/core/recipe.ts');
  const r = await call('vfx_convert_legacy', { family: 'energy', docId: 'legacyenergy' });
  assert.equal(r.error, false, r.text);
  assert.match(r.text, /Converted v1 energy/);
  assert.match((await call('vfx_compile', { docId: 'legacyenergy' })).text, /particles OK/);
  mkdirSync(join(root, 'in'), { recursive: true });
  const recipe = createRecipe('ice'); recipe.parameters.count = 14;
  writeFileSync(join(root, 'in/old.json'), JSON.stringify(recipe));
  const f = await call('vfx_convert_legacy', { path: 'in/old.json' });
  assert.equal(f.error, false, f.text);
  assert.match(f.text, /count: 14 → mapped/);
  assert.equal((await call('vfx_convert_legacy', {})).error, true);
});
