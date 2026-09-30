import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../src/graph/registry.ts';
import { COMPONENT_TEMPLATES } from '../src/graph/components.ts';
import { createVfxServer } from '../mcp/server.ts';
import { guideText } from '../mcp/guide.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = join(ROOT, 'docs', 'ai-guide');
const REF = join(GUIDE, 'reference');
const read = (p: string) => readFileSync(p, 'utf8');

test('AI guide: committed reference files match a fresh generation (run `npm run guide` if this fails)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vfx-guide-'));
  try {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', join(ROOT, 'tools', 'build-ai-guide.mjs'), '--out', tmp], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const names = readdirSync(tmp).sort();
    assert.deepEqual(names, readdirSync(REF).filter(n => n.endsWith('.md')).sort());
    for (const n of names) assert.equal(read(join(tmp, n)), read(join(REF, n)), `${n} is stale: run npm run guide`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('AI guide: reference is complete (nodes, components, tools, error codes, limits)', async () => {
  const nodes = read(join(REF, 'nodes.md'));
  for (const s of createRegistry().values()) assert.match(nodes, new RegExp(`^### ${s.type}$`, 'm'), `node ${s.type}`);
  assert.doesNotMatch(nodes, /no description written yet/);
  const components = read(join(REF, 'components.md'));
  for (const c of COMPONENT_TEMPLATES) assert.match(components, new RegExp(`^### ${c.id}$`, 'm'), `component ${c.id}`);
  assert.match(components, /ctl-flamethrower-start-at/);
  assert.match(components, /ctl-flamethrower-colour-shift/);
  assert.match(components, /ctl-flamethrower-colour-smoke/);

  const tools = Object.keys((createVfxServer({ root: tmpdir() }) as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
  assert.ok(tools.length >= 40);
  const mcp = read(join(REF, 'mcp-tools.md'));
  for (const t of tools) assert.match(mcp, new RegExp(`^## ${t}$`, 'm'), `tool ${t}`);

  const types = read(join(ROOT, 'src', 'model', 'types.ts'));
  const codes = [...types.match(/export type ErrorCode =([^;]+);/)![1].matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
  assert.ok(codes.length >= 10);
  const diag = read(join(REF, 'diagnostics.md'));
  for (const c of codes) assert.match(diag, new RegExp(`^## ${c}$`, 'm'), `code ${c}`);

  const limits = read(join(REF, 'limits.md'));
  assert.ok(limits.split('\n').filter(l => /^\| `[A-Z_0-9]+` \|/.test(l)).length >= 10, 'limits.md needs >= 10 rows');
  assert.match(limits, /MAX_DURATION_TICKS` \| 600 /);
  assert.match(limits, /16 MiB, 4096 px/);
  assert.match(limits, /20 MiB, 50000 triangles/);
  assert.equal((limits.match(/\| — \|/g) ?? []).length, 0, 'every limit has a meaning');
  assert.ok(read(join(REF, 'sprites.md')).includes('### flame-tongue-a'));
});

test('AI guide: vfx_guide serves the index, chapters, sections, node and component entries', () => {
  const index = guideText();
  for (const t of ['concepts', 'workflow', 'look', 'troubleshooting', 'export', 'editor', 'reference/nodes', 'reference/limits']) assert.ok(index.includes(t), t);
  assert.match(guideText({ topic: 'concepts' }), /^# Concepts/);
  const section = guideText({ topic: 'concepts', section: 'glow' });
  assert.match(section, /^## \d*\.? ?Glow/i);
  assert.ok(section.length < guideText({ topic: 'concepts' }).length);
  assert.match(guideText({ topic: 'readme' }), /guide for AI agents/);
  assert.match(guideText({ topic: 'reference/limits', section: 'Headline limits' }), /Live particles at once/);
  assert.match(guideText({ node: 'Emitter' }), /^### Emitter[\s\S]*\*\*Parameters\*\*/);
  assert.doesNotMatch(guideText({ node: 'emitter' }), /### Gravity/);
  assert.match(guideText({ component: 'flamethrower' }), /^### flamethrower[\s\S]*ctl-flamethrower-start-at/);
  assert.match(guideText({ node: 'Nope' }), /No node type "Nope"[\s\S]*All node types/);
  assert.match(guideText({ component: 'flamethrowe' }), /Did you mean: flamethrower/);
  assert.ok(guideText({ topic: 'reference/nodes' }).length < 10_000, 'a whole big reference returns an outline');
  assert.match(guideText({ topic: 'reference/nodes' }), /node: "<type>"/);
});

test('AI guide: old short topics and unknown or missing topics give helpful text and never throw', () => {
  assert.match(guideText('fire'), /flame-tongue-a/);
  assert.match(guideText({ topic: 'glow' }), /GLOW, BRIGHTNESS/);
  for (const t of ['basics', 'glow', 'fire', 'smoke', 'sparks', 'beams', 'projectile', 'props', 'materials', 'values', 'workflow']) assert.ok(guideText(t).length > 200, t);
  assert.match(guideText({ topic: 'tools' }), /WORKFLOW TOOLS/);
  assert.match(guideText({ topic: 'nope' }), /Unknown topic "nope"/);
  assert.match(guideText({ topic: 'recipes/does-not-exist' }), /No chapter "recipes\/does-not-exist"/);
  assert.match(guideText({ topic: 'concepts', section: 'zzzz' }), /No section "zzzz"[\s\S]*Sections:/);
  assert.match(guideText({ topic: '../../package.json' }), /Unknown topic/);
});

test('AI guide: the vfx_guide MCP tool forwards topic, section, node and component', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createVfxServer({ root: mkdtempSync(join(tmpdir(), 'vfx-guide-mcp-')) });
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (args: Record<string, unknown>) => ((await client.callTool({ name: 'vfx_guide', arguments: args })) as { content: { text: string }[] }).content[0].text;
  assert.match(await call({}), /Chapters/);
  assert.match(await call({ node: 'Gravity' }), /^### Gravity/);
  assert.match(await call({ component: 'flamethrower' }), /^### flamethrower/);
  assert.match(await call({ topic: 'look', section: '1' }), /^## 1\./);
  const roblox = (await client.listTools()).tools.find(t => t.name === 'vfx_export_roblox')!;
  assert.match(roblox.description ?? '', /setTarget/);
  assert.doesNotMatch(roblox.description ?? '', /default Roblox sparkle/);
});

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) markdownFiles(p, out); else if (n.endsWith('.md')) out.push(p); }
  return out;
}

test('AI guide: every relative markdown link points at an existing file and heading', () => {
  const recipesExist = existsSync(join(GUIDE, 'recipes'));
  let checked = 0;
  for (const file of markdownFiles(GUIDE)) {
    const text = read(file).replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
      const [path] = target.split('#');
      if (!path) continue;
      const full = resolve(dirname(file), path);
      if (!recipesExist && /[\\/]recipes([\\/]|$)/.test(full.slice(GUIDE.length))) continue;
      assert.ok(existsSync(full), `${file.slice(ROOT.length + 1)}: broken link ${target}`);
      checked++;
    }
  }
  assert.ok(checked > 10);
});
