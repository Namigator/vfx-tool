import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emitterParentRandomKey, fnv1a32Utf8, mulberry32First, particleEventRandomKey, randomTupleHash,
  sampleUnit, scheduleEventRandomKey, serializeRandomTuple, type RandomSampleKey,
} from '../src/runtime/random.ts';

// Independent reference: BigInt arithmetic written from plan24 formulas, over hand-listed bytes.
const M = 1n << 32n;
const u = (x: bigint) => ((x % M) + M) % M;
function refFnv(bytes: readonly number[]): number {
  let h = 2166136261n;
  for (const b of bytes) h = u((h ^ BigInt(b)) * 16777619n);
  return Number(h);
}
const asciiBytes = (s: string) => [...s].map((c) => { const n = c.charCodeAt(0); assert.ok(n < 128); return n; });
function refMulberry(seed: number): number {
  const a = u(BigInt(seed) + 0x6d2b79f5n);
  let t = u((a ^ (a >> 15n)) * (a | 1n));
  t = u(t ^ u(t + u((t ^ (t >> 7n)) * (t | 61n))));
  return Number(t ^ (t >> 14n)) / 4294967296;
}

const base: RandomSampleKey = {
  documentSeed: 42, randomStreamId: 'stream_a', eventRandomKey: '', entityOrdinal: 0, propertyKey: 'velocityX', sampleOrdinal: 0,
};

test('FNV-1a matches published 32-bit vectors', () => {
  assert.equal(fnv1a32Utf8(''), 0x811c9dc5);
  assert.equal(fnv1a32Utf8('a'), 0xe40c292c);
  assert.equal(fnv1a32Utf8('b'), 0xe70c2de5);
  assert.equal(fnv1a32Utf8('foobar'), 0xbf9cf968);
});

test('FNV-1a hashes UTF-8 bytes of Unicode text', () => {
  assert.equal(fnv1a32Utf8('é'), refFnv([0xc3, 0xa9]));
  assert.equal(fnv1a32Utf8('€'), refFnv([0xe2, 0x82, 0xac]));
  assert.equal(fnv1a32Utf8('\u{1f600}'), refFnv([0xf0, 0x9f, 0x98, 0x80]));
  assert.notEqual(fnv1a32Utf8('é'), refFnv([0xe9]));
});

test('Mulberry32 first output matches BigInt reference, in [0,1)', () => {
  for (const seed of [0, 1, 42, 0x7fffffff, 0x80000000, 0xffffffff, 0x92d68ca2]) {
    const v = mulberry32First(seed);
    assert.equal(v, refMulberry(seed));
    assert.ok(v >= 0 && v < 1);
  }
});

test('tuple serialization order and sample for seeds 0 and 42', () => {
  for (const seed of [0, 42]) {
    const key = { ...base, documentSeed: seed };
    const text = `[2,${seed},"stream_a","",0,"velocityX",0]`;
    assert.equal(serializeRandomTuple(key), text);
    assert.equal(randomTupleHash(key), refFnv(asciiBytes(text)));
    assert.equal(sampleUnit(key), refMulberry(refFnv(asciiBytes(text))));
  }
  assert.notEqual(sampleUnit(base), sampleUnit({ ...base, documentSeed: 0 }));
});

test('streams, properties, entities and samples are independent; order-free', () => {
  const variants = [
    base, { ...base, randomStreamId: 'stream_b' }, { ...base, propertyKey: 'velocityY' },
    { ...base, entityOrdinal: 1 }, { ...base, sampleOrdinal: 1 }, { ...base, eventRandomKey: 'x' },
  ];
  const forward = variants.map(sampleUnit);
  const backward = [...variants].reverse().map(sampleUnit).reverse();
  assert.deepEqual(forward, backward);
  assert.equal(new Set(forward).size, variants.length);
});

test('schedule, parent and particle keys follow plan formulas', () => {
  const sched = scheduleEventRandomKey('sched_1', 30, 2);
  assert.equal(sched, '["schedule","sched_1",30,2]');
  const parent = emitterParentRandomKey({ documentSeed: 42, randomStreamId: 'emit_1', eventRandomKey: sched, entityOrdinal: 3 });
  assert.equal(parent, '[2,42,"emit_1","[\\"schedule\\",\\"sched_1\\",30,2]",3]');
  const full = serializeRandomTuple({ documentSeed: 42, randomStreamId: 'emit_1', eventRandomKey: sched, entityOrdinal: 3, propertyKey: 'p', sampleOrdinal: 0 });
  assert.ok(full.startsWith(parent.slice(0, -1) + ','));
  const particle = particleEventRandomKey(parent, 'death', 0);
  assert.deepEqual(JSON.parse(particle), ['particle', parent, 'death', 0]);
  // eventRandomKey is serialized text, not an ID: nested keys are accepted.
  assert.doesNotThrow(() => sampleUnit({ ...base, eventRandomKey: particle }));
});

test('preserve-pattern copy: distinct object identity, equal samples', () => {
  const original = { objectId: 'node_1', label: 'Sparks', groupPath: 'g1', randomStreamId: 'stream_a' };
  const copy = { objectId: 'node_2', label: 'Sparks copy', groupPath: 'g2/inner', randomStreamId: original.randomStreamId };
  const k = (o: typeof original): RandomSampleKey => ({ ...base, randomStreamId: o.randomStreamId });
  assert.notEqual(copy.objectId, original.objectId);
  assert.equal(sampleUnit(k(copy)), sampleUnit(k(original)));
  assert.equal(serializeRandomTuple(k(copy)).includes('node_'), false);
});

test('input validation', () => {
  for (const bad of [-1, 1.5, 2 ** 32, Number.NaN, '1' as unknown as number]) {
    assert.throws(() => sampleUnit({ ...base, documentSeed: bad }), RangeError);
    assert.throws(() => sampleUnit({ ...base, sampleOrdinal: bad }), RangeError);
    assert.throws(() => sampleUnit({ ...base, entityOrdinal: bad }), RangeError);
    assert.throws(() => mulberry32First(bad), RangeError);
  }
  assert.throws(() => sampleUnit({ ...base, randomStreamId: 'bad id' }), TypeError);
  assert.throws(() => sampleUnit({ ...base, propertyKey: '' }), TypeError);
  assert.throws(() => sampleUnit({ ...base, eventRandomKey: 1 as unknown as string }), TypeError);
  assert.throws(() => scheduleEventRandomKey('s', -1, 0), RangeError);
  assert.throws(() => particleEventRandomKey('p', 'no spaces', 0), TypeError);
});

test('manager-derived fixed golden vectors pin the algorithm and UTF-8 interpretation', () => {
  // Independently derived with BigInt modulo arithmetic; see evidence/wp03-random/manager-reference.mjs.
  assert.equal(fnv1a32Utf8('é'), 513665217);
  assert.equal(fnv1a32Utf8('€'), 697271083);
  assert.equal(fnv1a32Utf8('\u{1f600}'), 866293256);
  assert.equal(mulberry32First(0), 1144304738 / 4294967296);
  assert.equal(mulberry32First(42), 2581720956 / 4294967296);
  assert.equal(randomTupleHash({ ...base, documentSeed: 0 }), 1368964078);
  assert.equal(randomTupleHash(base), 389257244);
  assert.equal(sampleUnit({ ...base, documentSeed: 0 }), 3409570521 / 4294967296);
  assert.equal(sampleUnit(base), 3477470563 / 4294967296);
});
