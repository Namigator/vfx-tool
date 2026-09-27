import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeshAsset, inspectGlb } from '../src/assets/importMesh.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';

/** Minimal GLB: one triangle (3 float3 positions) plus optional JSON overrides. */
export function glb(extra: Record<string, unknown> = {}): Uint8Array {
  const bin = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json: Record<string, unknown> = {
    asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0, ...extra,
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  js = Uint8Array.from([...js, ...new Array(pad).fill(0x20)]);
  const total = 12 + 8 + js.length + 8 + 36, out = new Uint8Array(total), v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, total, true);
  v.setUint32(12, js.length, true); v.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  v.setUint32(20 + js.length, 36, true); v.setUint32(24 + js.length, 0x004e4942, true); out.set(new Uint8Array(bin.buffer), 28 + js.length);
  return out;
}

test('GLB inspection: counts triangles; rejects cameras, lights, animation, external URIs and unsupported required extensions', () => {
  const ok = inspectGlb(glb());
  assert.ok(ok.ok && ok.value.triangles === 1 && ok.value.primitives === 1);
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ cameras: [{ type: 'perspective' }] }, /cameras/],
    [{ animations: [{ channels: [], samplers: [] }] }, /animations/],
    [{ extensionsUsed: ['KHR_lights_punctual'] }, /lights/],
    [{ buffers: [{ byteLength: 36, uri: 'mesh.bin' }] }, /external/],
    [{ extensionsRequired: ['KHR_draco_mesh_compression'] }, /KHR_draco_mesh_compression/],
  ];
  for (const [extra, re] of cases) { const r = inspectGlb(glb(extra)); assert.ok(!r.ok && re.test(r.message), JSON.stringify(extra)); }
  assert.ok(inspectGlb(glb({ extensionsRequired: ['KHR_materials_unlit'] })).ok, 'unlit is allowed');
  const big = inspectGlb(glb({ accessors: [{ bufferView: 0, componentType: 5126, count: 3 * 60_000, type: 'VEC3' }] }));
  assert.ok(!big.ok && /triangles/.test(big.message));
  assert.ok(!inspectGlb(new TextEncoder().encode('solid stl')).ok);
});

test('mesh asset: content-hash id, scale in the interpretation, valid in a document', async () => {
  const r = await createMeshAsset(glb(), 'rock.glb', 0.01);
  if (!r.ok) assert.fail(r.message);
  assert.equal(r.value.asset.kind, 'mesh');
  assert.equal(r.value.path, `assets/${r.value.asset.sha256}.glb`);
  const other = await createMeshAsset(glb(), 'rock.glb', 1);
  assert.ok(other.ok && other.value.asset.id !== r.value.asset.id && other.value.asset.sha256 === r.value.asset.sha256);
  const v = validateDocument({ ...createBlankDocument(), assets: [r.value.asset] }, { registry: createRegistry() });
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
});
