// Deterministic random primitives (plan24 "Exact random identity").
// Pure functions only: no global RNG, no hidden state, no call-order dependence.
// Object IDs, labels and group paths are never part of a random key.
import { ID_PATTERN } from '../model/types.ts';

export const RANDOM_TUPLE_VERSION = 2;
export const FNV1A_OFFSET_BASIS = 2166136261;
export const FNV1A_PRIME = 16777619;
export const MULBERRY32_INCREMENT = 0x6d2b79f5;

export interface RandomSampleKey {
  documentSeed: number;
  randomStreamId: string;
  eventRandomKey: string;
  entityOrdinal: number;
  propertyKey: string;
  sampleOrdinal: number;
}

export type EmitterParentKeyInput = Pick<RandomSampleKey, 'documentSeed' | 'randomStreamId' | 'eventRandomKey' | 'entityOrdinal'>;

export function assertUint32(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer.`);
  }
}

export function assertStoredId(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a stored identifier matching ${String(ID_PATTERN)}.`);
  }
}

function assertText(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
}

const encoder = new TextEncoder();

/** FNV-1a 32-bit over the UTF-8 bytes of text. */
export function fnv1a32Utf8(text: string): number {
  assertText(text, 'text');
  let h = FNV1A_OFFSET_BASIS;
  for (const b of encoder.encode(text)) h = Math.imul(h ^ b, FNV1A_PRIME) >>> 0;
  return h;
}

/** First output of Mulberry32 for a uint32 seed, in [0,1). */
export function mulberry32First(seed: number): number {
  assertUint32(seed, 'seed');
  const a = (seed + MULBERRY32_INCREMENT) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function validateSampleKey(key: RandomSampleKey): void {
  assertUint32(key.documentSeed, 'documentSeed');
  assertStoredId(key.randomStreamId, 'randomStreamId');
  assertText(key.eventRandomKey, 'eventRandomKey');
  assertUint32(key.entityOrdinal, 'entityOrdinal');
  assertStoredId(key.propertyKey, 'propertyKey');
  assertUint32(key.sampleOrdinal, 'sampleOrdinal');
}

/** JSON text of [2,seed,stream,eventRandomKey,entityOrdinal,propertyKey,sampleOrdinal]. */
export function serializeRandomTuple(key: RandomSampleKey): string {
  validateSampleKey(key);
  return JSON.stringify([
    RANDOM_TUPLE_VERSION, key.documentSeed, key.randomStreamId, key.eventRandomKey,
    key.entityOrdinal, key.propertyKey, key.sampleOrdinal,
  ]);
}

export function randomTupleHash(key: RandomSampleKey): number {
  return fnv1a32Utf8(serializeRandomTuple(key));
}

/** Deterministic sample in [0,1) for one property sample. */
export function sampleUnit(key: RandomSampleKey): number {
  return mulberry32First(randomTupleHash(key));
}

/** JSON.stringify(["schedule",randomStreamId,tick,repeatOrdinal]). */
export function scheduleEventRandomKey(randomStreamId: string, tick: number, repeatOrdinal: number): string {
  assertStoredId(randomStreamId, 'randomStreamId');
  assertUint32(tick, 'tick');
  assertUint32(repeatOrdinal, 'repeatOrdinal');
  return JSON.stringify(['schedule', randomStreamId, tick, repeatOrdinal]);
}

/** Emitter tuple without property/sample fields: [2,seed,stream,eventRandomKey,entityOrdinal]. */
export function emitterParentRandomKey(key: EmitterParentKeyInput): string {
  assertUint32(key.documentSeed, 'documentSeed');
  assertStoredId(key.randomStreamId, 'randomStreamId');
  assertText(key.eventRandomKey, 'eventRandomKey');
  assertUint32(key.entityOrdinal, 'entityOrdinal');
  return JSON.stringify([RANDOM_TUPLE_VERSION, key.documentSeed, key.randomStreamId, key.eventRandomKey, key.entityOrdinal]);
}

/** JSON.stringify(["particle",parentRandomKey,eventKind,eventOrdinal]). */
export function particleEventRandomKey(parentRandomKey: string, eventKind: string, eventOrdinal: number): string {
  assertText(parentRandomKey, 'parentRandomKey');
  assertStoredId(eventKind, 'eventKind');
  assertUint32(eventOrdinal, 'eventOrdinal');
  return JSON.stringify(['particle', parentRandomKey, eventKind, eventOrdinal]);
}
