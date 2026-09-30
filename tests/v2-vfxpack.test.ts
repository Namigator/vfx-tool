import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, crc32, readPack, readZip, writeZip } from '../src/model/vfxpack.ts';
import { zipSync } from 'fflate';
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

test('zip: unsafe paths, duplicates and unsupported (bzip2) compression are rejected', () => {
  for (const p of ['../evil', '/abs', 'C:/x', 'a\\b', 'a//b', './a']) {
    const r = readZip(writeZip([{ path: p, bytes: enc('x') }]));
    assert.ok(!r.ok && /Unsafe/.test(r.message), p);
  }
  const dup = readZip(writeZip([{ path: 'A.txt', bytes: enc('1') }, { path: 'a.txt', bytes: enc('2') }]));
  assert.ok(!dup.ok && /Duplicate/.test(dup.message));
  const z = writeZip([{ path: 'a.txt', bytes: enc('x') }]);
  const v = new DataView(z.buffer), cen = v.getUint32(z.length - 22 + 16, true);
  v.setUint16(cen + 10, 12, true);
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

test('zip: Deflate archives from another writer open; a lying uncompressed size is caught; packs compress JSON', async () => {
  const text = enc('effect '.repeat(500));
  const other = readZip(zipSync({ 'notes/a.txt': text, 'b.bin': new Uint8Array([1, 2, 3]) }, { level: 9 }));
  assert.ok(other.ok, !other.ok ? other.message : '');
  assert.deepEqual(other.ok && [...other.entries.find(e => e.path === 'notes/a.txt')!.bytes], [...text]);
  const z = writeZip([{ path: 'a.txt', bytes: text }], { deflate: true });
  assert.ok(z.length < text.length / 5, 'deflated');
  const v = new DataView(z.buffer), cen = v.getUint32(z.length - 22 + 16, true);
  v.setUint32(cen + 24, 100, true);
  const lie = readZip(z);
  assert.ok(!lie.ok && /inflated|valid Deflate|CRC/.test(lie.message), !lie.ok ? lie.message : 'accepted');
  const { doc, bytes, sha } = await docWithTexture();
  const p = await buildPack(doc, new Map([[sha, { sha256: sha, mime: 'image/png', bytes }]]));
  assert.ok(p.ok && (await readPack(p.value)).ok);
});

test('T31 pack: included sprites are embedded; a library change on the other side pins the packed copy (variants kept)', async () => {
  const { insertComponent } = await import('../src/graph/components.ts');
  const { createBlankDocument } = await import('../src/graph/fixtures.ts');
  const { referencedBuiltinSprites, pinBuiltins } = await import('../src/model/packBuiltins.ts');
  const { BUILTIN_SPRITES } = await import('../src/assets/builtinSprites.generated.ts');
  const { materialSheet } = await import('../src/graph/materialSprite.ts');
  const { readFileSync } = await import('node:fs');
  const doc = insertComponent(createBlankDocument(), 'impact-flash').doc;
  const ids = referencedBuiltinSprites(doc);
  assert.deepEqual(ids, ['ripple-ring', 'soft-glow', 'spark-streak']);
  const builtins = ids.map(id => { const sheet = BUILTIN_SPRITES.find(x => x.id === id)!; return { id, sheet: structuredClone(sheet), bytes: new Uint8Array(readFileSync(`assets/sprites/${sheet.file}`)) }; });
  const missing = await buildPack(doc, new Map());
  assert.ok(!missing.ok && /included sprite/.test(missing.message), 'a validated pack refuses to leave built-ins out');
  const packed = await buildPack(doc, new Map(), { builtins });
  if (!packed.ok) assert.fail(packed.message);
  const r = await readPack(packed.value);
  if (!r.ok) assert.fail(r.message);
  assert.deepEqual(r.value.builtins.map(b => b.id), ids);
  assert.ok(r.value.manifest.capabilities.includes('particles') && r.value.manifest.capabilities.includes('presentation'));
  // Same library on the other side: nothing changes.
  const same = await pinBuiltins(doc, r.value.builtins, id => (id ? r.value.manifest.files.find(f => f.path === `builtins/${id}.png`)!.sha256 : undefined));
  assert.ok(same.ok && same.pinned.length === 0 && JSON.stringify(same.doc) === JSON.stringify(doc));
  // Library changed: every Material drawing soft-glow now draws the packed copy, with the same grid and variant mode.
  const pinned = await pinBuiltins(doc, r.value.builtins, id => (id === 'soft-glow' ? 'changed' : r.value.manifest.files.find(f => f.path === `builtins/${id}.png`)!.sha256));
  if (!pinned.ok) assert.fail(pinned.message);
  assert.deepEqual(pinned.pinned.map(p => p.id), ['soft-glow']);
  assert.ok(validateDocument(pinned.doc, { registry: createRegistry() }).ok);
  const mats = pinned.doc.graphs.flatMap(g => g.nodes).filter(n => n.type === 'Material' && n.params.sprite !== 'ripple-ring' && n.params.sprite !== 'spark-streak');
  assert.ok(mats.length > 0 && mats.every(m => m.params.textureAsset === pinned.pinned[0].assetId));
  const sheet = materialSheet(pinned.doc, 'soft-glow', pinned.pinned[0].assetId);
  assert.ok('sheet' in sheet && sheet.sheet.kind === 'variants' && sheet.sheet.columns === 2 && sheet.sheet.rows === 2);
});

test('pack: rendered sound mix travels as rendered/mix.wav; .json export names the imported files it leaves out', async () => {
  const { jsonExportWarning } = await import('../src/model/packBuiltins.ts');
  const { doc, bytes, sha } = await docWithTexture();
  const wav = enc('RIFF....WAVE');
  const p = await buildPack(doc, new Map([[sha, { sha256: sha, mime: 'image/png', bytes }]]), { mixWav: wav });
  if (!p.ok) assert.fail(p.message);
  const r = await readPack(p.value);
  assert.ok(r.ok && r.value.mixWav && new TextDecoder().decode(r.value.mixWav) === 'RIFF....WAVE');
  assert.match(jsonExportWarning(doc) ?? '', /glow\.png/);
  assert.equal(jsonExportWarning(createF01Document()), undefined);
});
