import test from 'node:test';
import assert from 'node:assert/strict';
import { UNSPECIFIED_LICENSE, type EffectDocumentV2, type ParameterSpec } from '../src/model/types.ts';
import { validateParameterValue, type RecordRegistry } from '../src/model/values.ts';
import { CanonicalError, canonicalJson, canonicalSemanticJson, semanticHash, sha256Hex, type Sha256 } from '../src/model/canonical.ts';
import { minimalDocument } from '../src/model/fixtures.ts';

const spec = (over: Partial<ParameterSpec>): ParameterSpec => ({
  id: 'p', label: 'P', type: 'number', unit: 'none', default: 0,
  domains: ['constant'], editPolicy: 'live', description: '', ...over,
});
const codes = (v: unknown, s: ParameterSpec, reg?: RecordRegistry) => validateParameterValue(v, s, 'params.p', reg).map(d => `${d.code}@${d.fieldPath}`);
const valid = (v: unknown, s: ParameterSpec, reg?: RecordRegistry) => assert.deepEqual(codes(v, s, reg), []);
const invalid = (v: unknown, s: ParameterSpec, reg?: RecordRegistry) => assert.notDeepEqual(codes(v, s, reg), []);

test('numbers: finite, inclusive range boundaries, integers', () => {
  const s = spec({ min: 0, max: 10 });
  valid(0, s); valid(10, s); valid(5.5, s);
  invalid(-1e-9, s); invalid(10.000001, s);
  invalid(Number.NaN, s); invalid(Infinity, s); invalid('5', s);
  const i = spec({ type: 'integer', min: 1, max: 128 });
  valid(1, i); valid(128, i); invalid(0, i); invalid(129, i); invalid(4.5, i);
  assert.deepEqual(codes(8.5, i), ['INVALID_VALUE@params.p']);
});

test('boolean, enum, string and asset types', () => {
  valid(true, spec({ type: 'boolean' })); invalid(1, spec({ type: 'boolean' }));
  const e = spec({ type: 'enum', choices: ['linear', 'hold'] });
  valid('hold', e); invalid('cubic', e); invalid(undefined, e);
  valid('any text', spec({ type: 'string' }));
  valid('tex-01', spec({ type: 'asset' })); invalid('https://x/y.png', spec({ type: 'asset' })); invalid('', spec({ type: 'asset' }));
});

test('colors accept either-case #RRGGBB and alpha in [0,1] with no extra fields', () => {
  const c = spec({ type: 'color' });
  valid({ srgb: '#FF8800', alpha: 0 }, c); valid({ srgb: '#000000', alpha: 1 }, c);
  valid({ srgb: '#ff8800', alpha: 1 }, c); valid({ srgb: '#aB12eF', alpha: 0.5 }, c);
  invalid('#FF8800', c); invalid({ srgb: '#FFF', alpha: 1 }, c); invalid({ srgb: 'FF8800', alpha: 1 }, c);
  invalid({ srgb: '#FF8800', alpha: 1.01 }, c); invalid({ srgb: '#FF8800', alpha: -0.01 }, c);
  assert.deepEqual(codes({ srgb: '#FF8800', alpha: 1, html: '<b>' }, c), ['INVALID_VALUE@params.p']);
});

test('vectors and quaternions', () => {
  valid([1, 2], spec({ type: 'vec2' })); invalid([1, 2, 3], spec({ type: 'vec2' }));
  valid([0, -9.81, 0], spec({ type: 'vec3' }));
  assert.deepEqual(codes([0, Infinity, 0], spec({ type: 'vec3' })), ['INVALID_VALUE@params.p[1]']);
  const q = spec({ type: 'quaternion' });
  valid([0, 0, 0, 1], q); valid([0, Math.SQRT1_2, 0, Math.SQRT1_2], q); valid([0, 0, 0, 1 + 5e-7], q);
  invalid([0, 0.7071, 0, 0.7071], q); invalid([0, 0, 0, 1 + 2e-6], q);
  invalid([0, 0, 0, 0], q); invalid([0, 0, 0, 2], q); invalid([0, 0, 1], q);
  const bounded = spec({ type: 'vec3', min: -1, max: 1 });
  valid([-1, 0, 1], bounded);
  assert.deepEqual(codes([0, 1.5, -2], bounded), ['INVALID_VALUE@params.p[1]', 'INVALID_VALUE@params.p[2]']);
});

test('sparse tuples, curve keys and gradient stops are rejected at the hole', () => {
  // eslint-disable-next-line no-sparse-arrays
  assert.deepEqual(codes([1, , 3], spec({ type: 'vec3' })), ['INVALID_VALUE@params.p[1]']);
  const keys: unknown[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }];
  delete keys[1];
  assert.deepEqual(codes({ domain: 'normalized', interpolation: 'linear', keys }, spec({ type: 'curve' })), ['INVALID_VALUE@params.p.keys[1]']);
  const white = { srgb: '#FFFFFF', alpha: 1 };
  const stops: unknown[] = [{ position: 0, color: white }, { position: 0.5, color: white }, { position: 1, color: white }];
  delete stops[1];
  assert.deepEqual(codes({ stops }, spec({ type: 'gradient' })), ['INVALID_VALUE@params.p.stops[1]']);
});

test('exact-key checks use own fields only; null-prototype records are accepted', () => {
  const c = spec({ type: 'color' });
  const inherited = Object.create({ alpha: 1 }) as Record<string, unknown>;
  inherited.srgb = '#FFFFFF';
  invalid(inherited, c);
  const bare = Object.assign(Object.create(null) as Record<string, unknown>, { srgb: '#FFFFFF', alpha: 1 });
  valid(bare, c);
  const registry: RecordRegistry = new Map([['r', { recordType: 'r', fields: [spec({ id: 'constructor', type: 'boolean' })] }]]);
  const r = spec({ type: 'registeredRecord', recordType: 'r' });
  assert.deepEqual(codes({ recordType: 'r', fields: {} }, r, registry), ['INVALID_VALUE@params.p.fields']);
});

test('curves: 2–16 sorted unique keys, domain bounds, spec range on y', () => {
  const c = spec({ type: 'curve', min: 0, max: 1, curveDomain: 'normalized' });
  const keys = (xs: number[]) => xs.map(x => ({ x, y: 0.5 }));
  valid({ domain: 'normalized', interpolation: 'linear', keys: keys([0, 1]) }, c);
  valid({ domain: 'normalized', interpolation: 'hold', keys: keys(Array.from({ length: 16 }, (_, i) => i / 15)) }, c);
  invalid({ domain: 'normalized', interpolation: 'linear', keys: keys([0]) }, c);
  invalid({ domain: 'normalized', interpolation: 'linear', keys: keys(Array.from({ length: 17 }, (_, i) => i / 16)) }, c);
  invalid({ domain: 'normalized', interpolation: 'linear', keys: keys([0, 0.5, 0.5]) }, c);
  invalid({ domain: 'normalized', interpolation: 'linear', keys: keys([0.5, 0]) }, c);
  invalid({ domain: 'normalized', interpolation: 'linear', keys: keys([0, 1.5]) }, c);
  invalid({ domain: 'normalized', interpolation: 'cubic', keys: keys([0, 1]) }, c);
  invalid({ domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 1, y: 2 }] }, c);
  assert.deepEqual(codes({ domain: 'effectSeconds', interpolation: 'linear', keys: keys([0, 3]) }, c), ['DOMAIN_MISMATCH@params.p.domain']);
});

test('effectSeconds curve x: standalone bound [0,10], document duration narrows it', () => {
  const c = spec({ type: 'curve', curveDomain: 'effectSeconds' });
  const curve = (xs: number[]) => ({ domain: 'effectSeconds', interpolation: 'linear', keys: xs.map(x => ({ x, y: 0 })) });
  valid(curve([0, 10]), c); valid(curve([0.25, 3]), c);
  assert.deepEqual(codes(curve([0, 10.001]), c), ['INVALID_VALUE@params.p.keys[1].x']);
  invalid(curve([-0.1, 1]), c);
  const at = (xs: number[], durationTicks: number) => validateParameterValue(curve(xs), c, 'p', new Map(), { durationTicks }).map(d => d.fieldPath);
  assert.deepEqual(at([0, 1], 60), []);
  assert.deepEqual(at([0, 1.01], 60), ['p.keys[1].x']);
});

test('gradients: 2–8 stops, sorted unique, required 0 and 1 endpoints', () => {
  const g = spec({ type: 'gradient' });
  const stop = (position: number) => ({ position, color: { srgb: '#FFFFFF', alpha: 1 } });
  valid({ stops: [stop(0), stop(1)] }, g);
  valid({ stops: [0, 1, 2, 3, 4, 5, 6, 7].map(i => stop(i / 7)) }, g);
  invalid({ stops: [stop(0)] }, g);
  invalid({ stops: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => stop(i / 8)) }, g);
  invalid({ stops: [stop(0.1), stop(1)] }, g);
  invalid({ stops: [stop(0), stop(0.9)] }, g);
  invalid({ stops: [stop(0), stop(0.5), stop(0.5), stop(1)] }, g);
  invalid({ stops: [stop(0), { position: 1, color: { srgb: '#GGGGGG', alpha: 1 } }] }, g);
});

test('registered records are validated field-by-field against an explicit registry', () => {
  const registry: RecordRegistry = new Map([['flipbook', { recordType: 'flipbook', fields: [
    spec({ id: 'rows', type: 'integer', min: 1, max: 16 }),
    spec({ id: 'loop', type: 'boolean' }),
  ] }]]);
  const r = spec({ type: 'registeredRecord', recordType: 'flipbook' });
  valid({ recordType: 'flipbook', fields: { rows: 4, loop: false } }, r, registry);
  assert.deepEqual(codes({ recordType: 'flipbook', fields: { rows: 17, loop: false } }, r, registry), ['INVALID_VALUE@params.p.fields.rows']);
  invalid({ recordType: 'flipbook', fields: { rows: 4 } }, r, registry);
  invalid({ recordType: 'flipbook', fields: { rows: 4, loop: false, code: 'alert(1)' } }, r, registry);
  invalid({ recordType: 'other', fields: {} }, r, registry);
  invalid({ recordType: 'flipbook', fields: { rows: 4, loop: false } }, r);
  invalid(() => 1, r, registry);
  const odd: RecordRegistry = new Map([['odd', { recordType: 'odd', fields: [spec({ id: 'a-b', type: 'boolean' }), spec({ id: 'x"y', type: 'boolean' })] }]]);
  assert.deepEqual(
    codes({ recordType: 'odd', fields: { 'a-b': 1, 'x"y': 'no' } }, spec({ type: 'registeredRecord', recordType: 'odd' }), odd),
    ['TYPE_MISMATCH@params.p.fields["a-b"]', 'TYPE_MISMATCH@params.p.fields["x\\"y"]'],
  );
});

test('F1: malformed duration context fails explicitly instead of widening the bound', () => {
  const c = spec({ type: 'curve', curveDomain: 'effectSeconds' });
  const v = { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] };
  const ok = { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
  const run = (value: unknown, context: unknown) =>
    validateParameterValue(value, c, 'p', new Map(), context as { durationTicks?: number }).map(d => `${d.code}@${d.fieldPath}`);
  for (const durationTicks of [Number.NaN, -1, 0, Infinity, 1.5, 601, 2 ** 53, '60', null]) {
    assert.deepEqual(run(ok, { durationTicks }), ['INVALID_VALUE@p'], String(durationTicks));
    assert.deepEqual(run(v, { durationTicks }), ['INVALID_VALUE@p'], String(durationTicks));
  }
  assert.deepEqual(run(ok, null), ['INVALID_VALUE@p']);
  assert.deepEqual(run(ok, { durationTicks: 60, extra: 1 }), ['INVALID_VALUE@p']);
  let called = 0;
  assert.deepEqual(run(ok, Object.defineProperty({}, 'durationTicks', { enumerable: true, get: () => { called++; return 60; } })), ['INVALID_VALUE@p']);
  assert.equal(called, 0);
  assert.deepEqual(run(ok, { durationTicks: 1 }), ['INVALID_VALUE@p.keys[1].x']);
  assert.deepEqual(run(ok, { durationTicks: 600 }), []);
  assert.deepEqual(run(ok, {}), []);
});

test('F2: values reject accessors without calling them, hidden members and exotic containers', () => {
  let called = 0;
  const get = (x: unknown) => ({ enumerable: true, get: () => { called++; return x; } });
  const c = spec({ type: 'color' });
  assert.deepEqual(codes(Object.defineProperty({ alpha: 1 }, 'srgb', get('#FFFFFF')), c), ['INVALID_VALUE@params.p.srgb']);
  assert.deepEqual(codes(Object.defineProperty({ srgb: '#FFFFFF' }, 'alpha', get(1)), c), ['INVALID_VALUE@params.p.alpha']);
  const key = Object.defineProperty({ y: 0 }, 'x', get(0.5));
  assert.deepEqual(codes({ domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 0 }, key] }, spec({ type: 'curve' })), ['INVALID_VALUE@params.p.keys[1].x']);
  const tuple = [1, 2, 3]; Object.defineProperty(tuple, 1, get(2));
  assert.deepEqual(codes(tuple, spec({ type: 'vec3' })), ['INVALID_VALUE@params.p[1]']);
  assert.equal(called, 0);
  invalid({ srgb: '#FFFFFF', alpha: 1, [Symbol('s')]: 1 }, c);
  invalid(Object.defineProperty({ srgb: '#FFFFFF', alpha: 1 }, 'hidden', { value: 1, enumerable: false }), c);
  const named = [1, 2] as unknown[] & { tag?: string }; named.tag = 'x';
  assert.deepEqual(codes(named, spec({ type: 'vec2' })), ['INVALID_VALUE@params.p']);
  class Vec extends Array<number> {}
  invalid(Vec.from([1, 2]), spec({ type: 'vec2' }));
  invalid(new Date(0), c);
  const frozen = Object.freeze({ srgb: '#FFFFFF', alpha: 1 });
  valid(frozen, c);
});

test('F3: semantic canonicalization rejects malformed edge order before sorting', () => {
  for (const order of [Number.NaN, '1', 1.5, null]) {
    const d = withEdges();
    (d.graphs[0].edges[0] as { order: unknown }).order = order;
    assert.throws(() => canonicalSemanticJson(d), (e: unknown) => e instanceof CanonicalError && e.fieldPath === '$.graphs[0].edges[0].order', String(order));
  }
});

test('F4: semantic canonicalization rejects malformed projection shapes with exact paths', () => {
  const cases: [string, (d: Record<string, any>) => void][] = [
    ['$.tags', d => { d.tags = 'ba'; }],
    ['$.tags', d => { delete d.tags; }],
    ['$.tags[0]', d => { d.tags = [1]; }],
    ['$.anchors[0]', d => { d.anchors = [null]; }],
    ['$.controls', d => { d.controls = {}; }],
    ['$.graphs[0].nodes[0]', d => { d.graphs[0].nodes = ['n']; }],
    ['$.graphs[0].nodes[0].id', d => { d.graphs[0].nodes = [{ id: 1 }]; }],
    ['$.assets[0].id', d => { d.assets = [{ id: null }]; }],
    ['$.graphs[0].id', d => { d.graphs[0].id = 7; }],
  ];
  for (const [path, mutate] of cases) {
    const d = withEdges() as unknown as Record<string, any>;
    mutate(d);
    assert.throws(() => canonicalSemanticJson(d as unknown as EffectDocumentV2),
      (e: unknown) => e instanceof CanonicalError && e.fieldPath === path, path);
  }
  const good = withEdges(); good.tags = ['a', 'b'];
  assert.doesNotThrow(() => canonicalSemanticJson(good));
});

/** Returns the fieldPath of the CanonicalError thrown by canonicalJson. */
const canonicalFailure = (v: unknown): string => {
  try { canonicalJson(v); } catch (e) { assert.ok(e instanceof CanonicalError, String(e)); return e.fieldPath; }
  assert.fail('expected canonicalJson to throw');
};

test('canonical JSON golden vector (hand-derived: sorted keys, no whitespace, -0 as 0)', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'], c: { e: -0, d: 0.5 } }), '{"a":[true,null,"x"],"b":1,"c":{"d":0.5,"e":0}}');
  assert.equal(canonicalJson({ B: 1, a: 2, 'é': 3, _: 4 }), '{"B":1,"_":4,"a":2,"é":3}');
  const bare = Object.assign(Object.create(null) as object, { z: 1, y: '#aBcDeF' });
  assert.equal(canonicalJson(bare), '{"y":"#aBcDeF","z":1}');
  assert.throws(() => canonicalJson({ a: Number.NaN }), /\$\.a/);
  assert.throws(() => canonicalJson({ a: new Date(0) }), /non-plain/);
});

test('canonical JSON rejects undefined, holes, cycles, symbols, accessors and exotic objects', () => {
  assert.equal(canonicalFailure({ c: { u: undefined } }), '$.c.u');
  assert.equal(canonicalFailure([undefined]), '$[0]');
  // eslint-disable-next-line no-sparse-arrays
  assert.equal(canonicalFailure({ a: [1, , 3] }), '$.a[1]');
  const cyc: Record<string, unknown> = { a: {} }; (cyc.a as Record<string, unknown>).back = cyc;
  assert.equal(canonicalFailure(cyc), '$.a.back');
  assert.equal(canonicalFailure({ [Symbol('s')]: 1 }), '$');
  assert.equal(canonicalFailure({ s: Symbol('s') }), '$.s');
  assert.equal(canonicalFailure({ f: () => 1 }), '$.f');
  assert.equal(canonicalFailure({ n: BigInt(1) }), '$.n');
  assert.equal(canonicalFailure({ m: new Map() }), '$.m');
  assert.equal(canonicalFailure({ t: new Uint8Array(2) }), '$.t');
  const extra = [1, 2] as unknown[] & { tag?: string }; extra.tag = 'x';
  assert.equal(canonicalFailure(extra), '$');
  // Diagnostics quote unusual keys and stay bounded.
  assert.equal(canonicalFailure({ 'a b': { 'q"': Infinity } }), '$["a b"]["q\\""]');
  const k = 'k'.repeat(64);
  const longPath = `$.${k}.${k}.${k}.${k}.bad`;
  assert.equal(longPath.length, 265);
  assert.equal(canonicalFailure({ [k]: { [k]: { [k]: { [k]: { bad: Number.NaN } } } } }), longPath);
  try { canonicalJson({ ['k'.repeat(1000)]: Number.NaN }); assert.fail('expected throw'); } catch (e) {
    assert.ok(e instanceof CanonicalError);
    assert.equal(e.fieldPath, `$.${'k'.repeat(1000)}`);
    assert.ok(e.message.length < 300, e.message);
  }
  let deep: unknown = 1;
  for (let i = 0; i < 40; i++) deep = [deep];
  assert.throws(() => canonicalJson(deep), CanonicalError);
});

test('canonical JSON never invokes getters or toJSON and does not mutate input', () => {
  let called = 0;
  const getter = Object.defineProperty({}, 'g', { enumerable: true, get: () => { called++; return 1; } });
  assert.equal(canonicalFailure({ o: getter }), '$.o.g');
  const toJson = { toJSON: () => { called++; return 'x'; } };
  assert.equal(canonicalFailure(toJson), '$.toJSON');
  assert.equal(called, 0);
  const doc = minimalDocument();
  doc.tags = ['b', 'a'];
  const before = JSON.stringify(doc);
  canonicalSemanticJson(doc);
  assert.equal(JSON.stringify(doc), before);
  const trapped = minimalDocument();
  Object.defineProperty(trapped, 'name', { enumerable: true, get: () => { called++; return 'x'; } });
  assert.throws(() => canonicalSemanticJson(trapped), CanonicalError);
  assert.equal(called, 0);
});

test('Web Crypto SHA-256 adapter matches FIPS 180-2 vectors; adapter is injectable and checked', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  let seen = '';
  const fake: Sha256 = async data => { seen = new TextDecoder().decode(data); return new Uint8Array(32).fill(0xab); };
  assert.equal(await semanticHash(minimalDocument(), fake), 'ab'.repeat(32));
  assert.equal(seen, canonicalSemanticJson(minimalDocument()));
  assert.ok(!seen.includes('editor'));
  await assert.rejects(sha256Hex('x', async () => new Uint8Array([0, 255])), /32 bytes/);
  await assert.rejects(sha256Hex('x', async () => new Uint8Array(33)), /32 bytes/);
});

test('Web Crypto adapter matches independent node:crypto on the fixture', async () => {
  const { createHash } = await import('node:crypto');
  const expected = createHash('sha256').update(canonicalSemanticJson(minimalDocument()), 'utf8').digest('hex');
  assert.equal(await semanticHash(minimalDocument()), expected);
});

/** Rebuilds every object with reversed key insertion order. */
const reverseKeys = <T>(v: T): T => {
  if (Array.isArray(v)) return v.map(reverseKeys) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) as T;
  return v;
};

const withEdges = (): EffectDocumentV2 => {
  const d = minimalDocument();
  d.graphs[0].edges = [
    { id: 'edge-b', source: { nodeId: 'node-source', port: 'anchor' }, target: { nodeId: 'node-output', port: 'visual' }, order: 0 },
    { id: 'edge-a', source: { nodeId: 'node-target', port: 'anchor' }, target: { nodeId: 'node-output', port: 'visual' }, order: 1 },
  ];
  d.controls = [{
    id: 'ctl-size', scopeGraphId: 'graph-root', label: 'Size', type: 'number', unit: 'meter', value: 2, default: 1,
    section: 'Look', description: '', editPolicy: 'live',
    bindings: [{ nodeId: 'node-source', parameter: 'a', scale: 0.5, offset: 0.1 }, { nodeId: 'node-target', parameter: 'b' }],
  }];
  return d;
};

test('T06: hash ignores layout, key order and unordered definition order', async () => {
  const base = await semanticHash(withEdges());
  const moved = withEdges();
  moved.editor.graphs['graph-root'].nodes['node-output'] = { x: -900, y: 3 };
  moved.editor.graphs['graph-root'].viewport.zoom = 3.5;
  moved.editor.openedGraphId = 'elsewhere';
  assert.equal(await semanticHash(moved), base);
  assert.equal(await semanticHash(reverseKeys(withEdges())), base);
  const reordered = withEdges();
  reordered.anchors.reverse(); reordered.graphs[0].nodes.reverse(); reordered.graphs[0].edges.reverse();
  assert.equal(await semanticHash(reordered), base);
  const tagged = (tags: string[]) => { const d = withEdges(); d.tags = tags; return d; };
  assert.equal(await semanticHash(tagged(['b', 'a', 'B'])), await semanticHash(tagged(['B', 'a', 'b'])));
  assert.ok(canonicalSemanticJson(tagged(['b', 'a', 'B'])).includes('"tags":["B","a","b"]'));
});

test('canonical identity preserves authored color case (conservative invalidation)', async () => {
  const colored = (srgb: string) => { const d = withEdges(); d.graphs[0].nodes[0].params.tint = { srgb, alpha: 1 }; return d; };
  assert.ok(canonicalSemanticJson(colored('#aBcDeF')).includes('"srgb":"#aBcDeF"'));
  assert.notEqual(await semanticHash(colored('#abcdef')), await semanticHash(colored('#ABCDEF')));
});

test('T06: hash detects semantic, ordering, asset and version changes', async () => {
  const base = await semanticHash(withEdges());
  const mutations: [string, (d: EffectDocumentV2) => void][] = [
    ['seed', d => { d.seed = 43; }],
    ['node param', d => { d.graphs[0].nodes[0].params.size = 1; }],
    ['node enabled', d => { d.graphs[0].nodes[2].enabled = false; }],
    ['random stream', d => { d.graphs[0].nodes[0].randomStreamId = 'rs-other'; }],
    ['definition version', d => { d.graphs[0].nodes[0].definitionVersion = 2; }],
    ['edge multi-input order', d => { d.graphs[0].edges[0].order = 2; }],
    ['binding order', d => { d.controls[0].bindings.reverse(); }],
    ['control value', d => { d.controls[0].value = 3; }],
    ['anchor position', d => { d.anchors[0].position = [0, 1.5, 0]; }],
    ['duration', d => { d.durationTicks = 61; }],
    ['asset bytes', d => { d.assets = [{
      id: 'tex', sha256: 'a'.repeat(64), kind: 'texture', mime: 'image/png', bytes: 10,
      source: { kind: 'bundle', path: 'assets/tex.png' }, colorSpace: 'color',
      interpretation: { kind: 'texture', colorSpace: 'color' },
      provenance: { origin: 'authored', originalFilename: 'tex.png', modificationNotes: '' },
      license: { identifier: UNSPECIFIED_LICENSE },
    }]; }],
  ];
  const seen = new Set([base]);
  for (const [name, mutate] of mutations) {
    const d = withEdges(); mutate(d);
    const h = await semanticHash(d);
    assert.notEqual(h, base, name);
    seen.add(h);
  }
  assert.equal(seen.size, mutations.length + 1);
  const withAsset = withEdges(); mutations[10][1](withAsset);
  const otherBytes = withEdges(); mutations[10][1](otherBytes); otherBytes.assets[0].sha256 = 'b'.repeat(64);
  assert.notEqual(await semanticHash(withAsset), await semanticHash(otherBytes));
});
