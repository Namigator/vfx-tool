// Pure parameter-value validation against ParameterSpec metadata (04 "Parameter definitions and values",
// WP01-REPRESENTATION-DECISIONS.md). Invalid values are reported with exact paths; nothing is clamped
// or coerced.
import {
  ID_PATTERN, MAX_DURATION_TICKS, MAX_EFFECT_SECONDS, MAX_JSON_DEPTH, TICKS_PER_SECOND,
  type Diagnostic, type ParameterSpec, type RegisteredRecordSpec,
} from './types.ts';
import { CanonicalError, canonicalJson, pathKey } from './canonical.ts';

export const CURVE_MIN_KEYS = 2;
export const CURVE_MAX_KEYS = 16;
export const GRADIENT_MIN_STOPS = 2;
export const GRADIENT_MAX_STOPS = 8;
/** Accepted |‖q‖−1|; zero-length and non-unit imports are rejected, never normalized. */
export const QUATERNION_NORM_TOLERANCE = 1e-6;
/** Either case is accepted; authored case is preserved in canonical JSON. */
export const SRGB_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Explicit registry of structured settings; unregistered record types are rejected. */
export type RecordRegistry = ReadonlyMap<string, RegisteredRecordSpec>;

/**
 * Optional document context. durationTicks (safe integer 1..MAX_DURATION_TICKS) bounds effectSeconds
 * curve x to durationTicks/60. A malformed context (wrong type, extra/accessor fields, bad ticks)
 * yields an error diagnostic instead of silently widening the bound.
 */
export type ValueContext = { durationTicks?: number };

type Ctx = { registry: RecordRegistry; maxEffectSeconds: number; depth: number; out: Diagnostic[] };

const fail = (ctx: Ctx, path: string, message: string, code: Diagnostic['code'] = 'INVALID_VALUE') => {
  ctx.out.push({ code, message, fieldPath: path, severity: 'error' });
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const hasOwn = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function hasExactKeys(ctx: Ctx, path: string, v: Record<string, unknown>, keys: string[]): boolean {
  const extra = Object.keys(v).filter(k => !keys.includes(k));
  const missing = keys.filter(k => !hasOwn(v, k));
  if (extra.length) fail(ctx, path, `Unexpected field(s): ${extra.join(', ')}.`);
  if (missing.length) fail(ctx, path, `Missing field(s): ${missing.join(', ')}.`);
  return extra.length === 0 && missing.length === 0;
}

/** Dense array check: holes are reported at their index rather than skipped. */
function checkDense(ctx: Ctx, path: string, v: unknown[]): boolean {
  for (let i = 0; i < v.length; i++) {
    if (!hasOwn(v, String(i))) { fail(ctx, `${path}[${i}]`, 'Array element is missing (sparse array).'); return false; }
  }
  return true;
}

function checkRange(ctx: Ctx, path: string, n: number, spec: Pick<ParameterSpec, 'min' | 'max'>) {
  if (spec.min !== undefined && n < spec.min) fail(ctx, path, `Value ${n} is below the minimum ${spec.min}.`);
  if (spec.max !== undefined && n > spec.max) fail(ctx, path, `Value ${n} is above the maximum ${spec.max}.`);
}

function checkNumberTuple(ctx: Ctx, path: string, v: unknown, length: number, label: string): v is number[] {
  if (!Array.isArray(v) || v.length !== length) {
    fail(ctx, path, `Expected a ${label} of ${length} numbers.`, 'TYPE_MISMATCH');
    return false;
  }
  if (!checkDense(ctx, path, v)) return false;
  let ok = true;
  for (let i = 0; i < v.length; i++) {
    if (!isFiniteNumber(v[i])) { fail(ctx, `${path}[${i}]`, 'Component must be a finite number.'); ok = false; }
  }
  return ok;
}

function checkColor(ctx: Ctx, path: string, v: unknown) {
  if (!isPlainObject(v)) { fail(ctx, path, 'Expected a color {srgb:"#RRGGBB", alpha}.', 'TYPE_MISMATCH'); return; }
  if (!hasExactKeys(ctx, path, v, ['srgb', 'alpha'])) return;
  if (typeof v.srgb !== 'string' || !SRGB_PATTERN.test(v.srgb)) fail(ctx, `${path}.srgb`, 'Color must be sRGB hex "#RRGGBB".');
  if (!isFiniteNumber(v.alpha) || v.alpha < 0 || v.alpha > 1) fail(ctx, `${path}.alpha`, 'Alpha must be a finite number in [0,1].');
}

function checkCurve(ctx: Ctx, path: string, v: unknown, spec: ParameterSpec) {
  if (!isPlainObject(v)) { fail(ctx, path, 'Expected a curve {domain, interpolation, keys}.', 'TYPE_MISMATCH'); return; }
  if (!hasExactKeys(ctx, path, v, ['domain', 'interpolation', 'keys'])) return;
  if (v.domain !== 'normalized' && v.domain !== 'effectSeconds') fail(ctx, `${path}.domain`, 'Curve domain must be "normalized" or "effectSeconds".');
  else if (spec.curveDomain && v.domain !== spec.curveDomain) fail(ctx, `${path}.domain`, `This curve requires domain "${spec.curveDomain}".`, 'DOMAIN_MISMATCH');
  if (v.interpolation !== 'linear' && v.interpolation !== 'hold') fail(ctx, `${path}.interpolation`, 'Curve interpolation must be "linear" or "hold".');
  const keys = v.keys;
  if (!Array.isArray(keys) || keys.length < CURVE_MIN_KEYS || keys.length > CURVE_MAX_KEYS) {
    fail(ctx, `${path}.keys`, `Curve needs ${CURVE_MIN_KEYS}–${CURVE_MAX_KEYS} keys.`);
    return;
  }
  if (!checkDense(ctx, `${path}.keys`, keys)) return;
  let prev = -Infinity;
  for (let i = 0; i < keys.length; i++) {
    const k: unknown = keys[i];
    const kp = `${path}.keys[${i}]`;
    if (!isPlainObject(k)) { fail(ctx, kp, 'Curve key must be {x, y}.', 'TYPE_MISMATCH'); continue; }
    if (!hasExactKeys(ctx, kp, k, ['x', 'y'])) continue;
    if (!isFiniteNumber(k.x)) fail(ctx, `${kp}.x`, 'Key x must be a finite number.');
    else {
      if (k.x <= prev) fail(ctx, `${kp}.x`, 'Curve keys must be sorted with unique x.');
      if (v.domain === 'normalized' && (k.x < 0 || k.x > 1)) fail(ctx, `${kp}.x`, 'Normalized curve key x must be in [0,1].');
      if (v.domain === 'effectSeconds' && (k.x < 0 || k.x > ctx.maxEffectSeconds)) {
        fail(ctx, `${kp}.x`, `Effect-time key x must be in [0,${ctx.maxEffectSeconds}] seconds.`);
      }
      prev = k.x;
    }
    if (!isFiniteNumber(k.y)) fail(ctx, `${kp}.y`, 'Key y must be a finite number.');
    else checkRange(ctx, `${kp}.y`, k.y, spec);
  }
}

function checkGradient(ctx: Ctx, path: string, v: unknown) {
  if (!isPlainObject(v)) { fail(ctx, path, 'Expected a gradient {stops}.', 'TYPE_MISMATCH'); return; }
  if (!hasExactKeys(ctx, path, v, ['stops'])) return;
  const stops = v.stops;
  if (!Array.isArray(stops) || stops.length < GRADIENT_MIN_STOPS || stops.length > GRADIENT_MAX_STOPS) {
    fail(ctx, `${path}.stops`, `Gradient needs ${GRADIENT_MIN_STOPS}–${GRADIENT_MAX_STOPS} stops.`);
    return;
  }
  if (!checkDense(ctx, `${path}.stops`, stops)) return;
  let prev = -Infinity;
  for (let i = 0; i < stops.length; i++) {
    const s: unknown = stops[i];
    const sp = `${path}.stops[${i}]`;
    if (!isPlainObject(s)) { fail(ctx, sp, 'Gradient stop must be {position, color}.', 'TYPE_MISMATCH'); continue; }
    if (!hasExactKeys(ctx, sp, s, ['position', 'color'])) continue;
    const p = s.position;
    if (!isFiniteNumber(p) || p < 0 || p > 1) fail(ctx, `${sp}.position`, 'Stop position must be a finite number in [0,1].');
    else {
      if (p <= prev) fail(ctx, `${sp}.position`, 'Gradient stops must be sorted with unique positions.');
      if (i === 0 && p !== 0) fail(ctx, `${sp}.position`, 'First gradient stop must be at position 0.');
      if (i === stops.length - 1 && p !== 1) fail(ctx, `${sp}.position`, 'Last gradient stop must be at position 1.');
      prev = p;
    }
    checkColor(ctx, `${sp}.color`, s.color);
  }
}

function checkRecord(ctx: Ctx, path: string, v: unknown, spec: ParameterSpec) {
  if (!spec.recordType) { fail(ctx, path, `Parameter "${spec.id}" does not declare a recordType.`, 'TYPE_MISMATCH'); return; }
  const recordSpec = ctx.registry.get(spec.recordType);
  if (!recordSpec) { fail(ctx, path, `Record type "${spec.recordType}" is not registered.`, 'UNKNOWN_NODE'); return; }
  if (!isPlainObject(v)) { fail(ctx, path, `Expected a "${spec.recordType}" record.`, 'TYPE_MISMATCH'); return; }
  if (!hasExactKeys(ctx, path, v, ['recordType', 'fields'])) return;
  if (v.recordType !== spec.recordType) { fail(ctx, `${path}.recordType`, `Expected record type "${spec.recordType}".`, 'TYPE_MISMATCH'); return; }
  const fields = v.fields;
  if (!isPlainObject(fields)) { fail(ctx, `${path}.fields`, 'Record fields must be an object.', 'TYPE_MISMATCH'); return; }
  if (!hasExactKeys(ctx, `${path}.fields`, fields, recordSpec.fields.map(f => f.id))) return;
  for (const f of recordSpec.fields) {
    checkValue({ ...ctx, depth: ctx.depth + 2 }, pathKey(`${path}.fields`, f.id), fields[f.id], f);
  }
}

function checkValue(ctx: Ctx, path: string, v: unknown, spec: ParameterSpec) {
  if (ctx.depth > MAX_JSON_DEPTH) { fail(ctx, path, `Value nesting exceeds depth ${MAX_JSON_DEPTH}.`, 'IMPORT_LIMIT'); return; }
  switch (spec.type) {
    case 'boolean':
      if (typeof v !== 'boolean') fail(ctx, path, 'Expected true or false.', 'TYPE_MISMATCH');
      return;
    case 'number':
    case 'integer':
      if (typeof v !== 'number') { fail(ctx, path, 'Expected a number.', 'TYPE_MISMATCH'); return; }
      if (!Number.isFinite(v)) { fail(ctx, path, 'Number must be finite.'); return; }
      if (spec.type === 'integer' && !Number.isInteger(v)) { fail(ctx, path, `Expected a whole number, got ${v}.`); return; }
      checkRange(ctx, path, v, spec);
      return;
    case 'enum':
      if (typeof v !== 'string') { fail(ctx, path, 'Expected a choice string.', 'TYPE_MISMATCH'); return; }
      if (!spec.choices?.includes(v)) fail(ctx, path, `"${v}" is not one of: ${(spec.choices ?? []).join(', ')}.`);
      return;
    case 'string':
      if (typeof v !== 'string') fail(ctx, path, 'Expected text.', 'TYPE_MISMATCH');
      return;
    case 'asset':
      // Reference resolution against document.assets belongs to whole-document validation (WP01b).
      if (typeof v !== 'string' || !ID_PATTERN.test(v)) fail(ctx, path, 'Asset reference must be a valid asset ID.');
      return;
    case 'color':
      checkColor(ctx, path, v);
      return;
    case 'vec2':
    case 'vec3': {
      const n = spec.type === 'vec2' ? 2 : 3;
      if (checkNumberTuple(ctx, path, v, n, spec.type)) {
        for (let i = 0; i < n; i++) checkRange(ctx, `${path}[${i}]`, v[i], spec);
      }
      return;
    }
    case 'quaternion':
      if (checkNumberTuple(ctx, path, v, 4, 'quaternion xyzw')) {
        const norm = Math.hypot(v[0], v[1], v[2], v[3]);
        if (Math.abs(norm - 1) > QUATERNION_NORM_TOLERANCE) fail(ctx, path, `Quaternion must be unit length (length is ${norm}).`);
      }
      return;
    case 'curve':
      checkCurve(ctx, path, v, spec);
      return;
    case 'gradient':
      checkGradient(ctx, path, v);
      return;
    case 'registeredRecord':
      checkRecord(ctx, path, v, spec);
      return;
    default:
      fail(ctx, path, `Unknown value type "${String((spec as { type: unknown }).type)}".`, 'TYPE_MISMATCH');
  }
}

/** Validates one stored parameter value against its spec. Returns diagnostics; empty means valid. */
export function validateParameterValue(
  value: unknown, spec: ParameterSpec, path: string,
  registry: RecordRegistry = new Map(),
  context: ValueContext = {},
): Diagnostic[] {
  const ctx: Ctx = { registry, maxEffectSeconds: MAX_EFFECT_SECONDS, depth: 0, out: [] };
  const ticks = readDurationTicks(context);
  if (ticks === null) {
    fail(ctx, path, `Invalid value context: durationTicks must be a whole number in [1,${MAX_DURATION_TICKS}].`);
    return ctx.out;
  }
  if (ticks !== undefined) ctx.maxEffectSeconds = Math.min(ticks / TICKS_PER_SECOND, MAX_EFFECT_SECONDS);
  // Structured values must be plain JSON before any field is read: canonicalJson inspects
  // descriptors only, so accessors are rejected without being called, and symbol/non-enumerable
  // members, holes, extra array members and non-plain objects are reported at their exact path.
  // After this passes, direct field reads below touch data properties only. A Proxy cannot be
  // detected from plain JavaScript; its traps may still run and are outside this boundary.
  if (typeof value === 'object' && value !== null) {
    try {
      canonicalJson(value, path);
    } catch (e) {
      if (e instanceof CanonicalError) fail(ctx, e.fieldPath, e.message);
      else fail(ctx, path, 'Value is not plain JSON data.');
      return ctx.out;
    }
  }
  checkValue(ctx, path, value, spec);
  return ctx.out;
}

/** Returns the context duration, undefined when absent, or null when the context is malformed. */
function readDurationTicks(context: unknown): number | undefined | null {
  try {
    if (typeof context !== 'object' || context === null) return null;
    canonicalJson(context);
    const keys = Object.keys(context);
    if (keys.some(k => k !== 'durationTicks')) return null;
    if (keys.length === 0) return undefined;
    const t = (context as { durationTicks: unknown }).durationTicks;
    return Number.isSafeInteger(t) && (t as number) >= 1 && (t as number) <= MAX_DURATION_TICKS ? t as number : null;
  } catch {
    return null;
  }
}
