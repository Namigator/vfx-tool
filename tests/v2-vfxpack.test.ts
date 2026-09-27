import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, crc32, readPack, readZip, writeZip } from '../src/model/vfxpack.ts';
import { createTextureAsset } from '../src/assets/importTexture.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';

const png = (w: number, h: number, fill = 7) => { const b = new Uint8Array(96).fill(fill); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const enc = (s: string) => new TextEncoder().encode(s);

async function docWithTexture() {
  const bytes = png(512, 512);
  const r = await createTextureAsset(bytes, { filename: 'glow.png', role: 'color', flipbook: { rows: 2, columns: 2 } });
  if (!r.ok) assert.fail(r.message);
  return { doc: { ...createF01Document(), assets: [r.value.asset] }, bytes, sha: r.value.asset.sha256 };
}

test('zip: CRC-32 reference value; stored entries round-trip byte-exactly', () => {
  assert.equal(crc32(enc('123456789')), 0xcbf43926);
  const z = readZip(writeZip([{ path: 'a.txt', bytes: enc('hello') }, { path: 'dir/b.bin', bytes: new Uint8Array([0, 255, 1]) }]));
  assert.ok(z.ok);
  assert.deepEqual(z.ok && z.entries.map(e => [e.path, [...e.bytes]]), [['a.txt', [...enc('hello')]], ['dir/b.bin', [0, 255, 1]]]);
});

test('zip: unsafe paths, duplicates and compressed entries are rejected', () => {
  for (const p of ['../evil', '/abs', 'C:/x', 'a\\b', 'a//b', './a']) {
    const r = readZip(writeZip([{ path: p, bytes: enc('x') }]));
    assert.ok(!r.ok && /Unsafe/.test(r.message), p);
  }
  const dup = readZip(writeZip([{ path: 'A.txt', bytes: enc('1') }, { path: 'a.txt', bytes: enc('2') }]));
  assert.ok(!dup.ok && /Duplicate/.test(dup.message));
  const z = writeZip([{ path: 'a.txt', bytes: enc('x') }]);
  const v = new DataView(z.buffer), cen = v.getUint32(z.length - 22 + 16, true);
  v.setUint16(cen + 10, 8, true);
  const c = readZip(z);
  assert.ok(!c.ok && /compression/.test(c.message));
});

test('pack: document + texture round-trip with checksums; the document still validates', async () => {
  const { doc, bytes, sha } = await docWithTexture();
  const p = await buildPack(doc, new Map([[sha, { sha256: sha, mime: 'image/png', bytes }]]));
  if (!p.ok) assert.fail(p.message);
  const r = await readPack(p.value);
  if (!r.ok) assert.fail(r.message);
  assert.equal(r.value.manifest.state, 'validated');
  assert.deepEqual(r.value.manifest.files.map(f => f.role).sort(), ['asset', 'document', 'license', 'metadata']);
  assert.deepEqual([...r.value.assets[0].bytes], [...bytes]);
  const v = validateDocument(r.value.document, { registry: createRegistry() });
  assert.ok(v.ok && v.value.assets[0].sha256 === sha);
});

test('pack: tampered bytes, unlisted entries and missing assets fail; draft packs record missing bytes', async () => {
  const { doc, bytes, sha } = await docWithTexture();
  const p = await buildPack(doc, new Map([[sha, { sha256: sha, mime: 'image/png', bytes }]]));
  if (!p.ok) assert.fail(p.message);
  const zz = readZip(p.value);
  if (!zz.ok) assert.fail('zip');
  const tampered = zz.entries.map(e => e.path.startsWith('assets/') ? { ...e, bytes: png(512, 512, 9) } : e);
  const t = await readPack(writeZip(tampered));
  assert.ok(!t.ok && /Checksum mismatch/.test(t.message));
  const extra = await readPack(writeZip([...zz.entries, { path: 'payload.js', bytes: enc('alert(1)') }]));
  assert.ok(!extra.ok && /not listed/.test(extra.message));
  const miss = await buildPack(doc, new Map());
  assert.ok(!miss.ok && /glow.png/.test(miss.message));
  const draft = await buildPack(doc, new Map(), { draft: true });
  if (!draft.ok) assert.fail(draft.message);
  const d = await readPack(draft.value);
  assert.ok(d.ok && d.value.manifest.state === 'draft' && d.value.assets.length === 0);
});
