// RobloxEffect -> .rbxmx (Roblox XML model). See types.ts for the IR; EffectPlayer.luau is the runtime.
import type { RbxBeamLayer, RbxColorKey, RbxEmitter, RbxLight, RbxMeshLayer, RbxNumberKey, RbxTrail, RobloxEffect, Vec3 } from './types.ts';
import { MAX_SEQUENCE_KEYS } from './types.ts';

export const DEFAULT_TEXTURE = 'rbxasset://textures/particles/sparkles_main.dds';

// Roblox enum numeric values (Enum.X.Y.Value); tools/roblox-check.mjs compares them against a real engine.
export const ENUM = {
  Shape: { Box: 0, Sphere: 1, Cylinder: 2, Disc: 3 },
  ShapeStyle: { Volume: 0, Surface: 1 },
  ShapeInOut: { Outward: 0, Inward: 1, InAndOut: 2 },
  NormalId: { Right: 0, Top: 1, Back: 2, Left: 3, Bottom: 4, Front: 5 },
  Orientation: { FacingCamera: 0, FacingCameraWorldUp: 1, VelocityParallel: 2, VelocityPerpendicular: 3 },
  FlipbookLayout: { None: 0, Grid2x2: 1, Grid4x4: 2, Grid8x8: 3 },
  FlipbookMode: { Loop: 0, OneShot: 1, PingPong: 2, Random: 3 },
  TextureMode: { Stretch: 0, Wrap: 1, Static: 2 },
  /** Enum.PartType (Part.Shape); Wedge is its own class (WedgePart). */
  PartType: { Ball: 0, Block: 1, Cylinder: 2 },
  Material: { SmoothPlastic: 272, Neon: 288, Slate: 800, Metal: 1088, Ice: 1536 },
} as const;

export type WriteOptions = {
  /** textureKey -> numeric asset id (or full rbxassetid:// string). */
  assetIds?: Record<string, string>;
  /**
   * Source of the EffectPlayer ModuleScript = the text of EffectPlayer.luau (single source of truth). Browser code passes
   * `import('./EffectPlayer.luau?raw')`; Node code passes effectPlayerSource() from ./playerSource.node.ts.
   */
  playerSource: string;
  /**
   * The model's recolour settings (Studio Properties, no code): VfxColor (Color3Value, white = authored colours) and
   * VfxHueShift (NumberValue, degrees). Colourway exports set them; default white / 0.
   */
  color?: [number, number, number];
  hueShift?: number;
};

// ---------- numbers / escaping ----------

const fin = (x: number): number => (Number.isFinite(x) ? x : 0);
/** Up to 6 decimals, shortest form (XML properties). */
const num = (x: number): string => String(Number(fin(x).toFixed(6)));
/** 3 decimals (EffectData). */
const r3 = (x: number): number => Number(fin(x).toFixed(3));
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, fin(x)));

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const cdata = (s: string): string => `<![CDATA[${s.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

// ---------- sequences ----------

function reduceKeys<K extends { t: number }>(keys: K[], err: (prev: K, k: K, next: K) => number): K[] {
  const out = keys.slice();
  while (out.length > MAX_SEQUENCE_KEYS) {
    let best = 1;
    let bestErr = Infinity;
    for (let i = 1; i < out.length - 1; i++) {
      const e = err(out[i - 1], out[i], out[i + 1]);
      if (e < bestErr) { bestErr = e; best = i; }
    }
    out.splice(best, 1);
  }
  return out;
}

/** Sorted, t in 0..1 strictly increasing, first t=0, last t=1, at least 2 keys. */
function normalizeTimes<K extends { t: number }>(input: K[], fallback: K): K[] {
  const keys = (input.length ? input : [fallback]).map(k => ({ ...k, t: clamp(k.t, 0, 1) }));
  keys.sort((a, b) => a.t - b.t);
  const dedup: K[] = [];
  for (const k of keys) {
    if (dedup.length && dedup[dedup.length - 1].t === k.t) dedup[dedup.length - 1] = k;
    else dedup.push(k);
  }
  if (dedup[0].t > 0) dedup.unshift({ ...dedup[0], t: 0 });
  if (dedup[dedup.length - 1].t < 1) dedup.push({ ...dedup[dedup.length - 1], t: 1 });
  if (dedup.length === 1) dedup.push({ ...dedup[0], t: 1 });
  return dedup;
}

export type NumberKind = 'size' | 'transparency' | 'squash';

/** Clamp a NumberSequence to Roblox's rules for the property it is used on. */
export function clampNumberSequence(input: RbxNumberKey[], kind: NumberKind): RbxNumberKey[] {
  const fallback: RbxNumberKey = { t: 0, v: kind === 'size' ? 1 : 0, e: 0 };
  const valid = normalizeTimes(input.map(k => ({ t: fin(k.t), v: fin(k.v), e: fin(k.e) })), fallback);
  const fixed = valid.map(k => {
    if (kind === 'size') {
      const v = Math.max(0, k.v);
      return { t: k.t, v, e: Math.min(Math.max(0, k.e), v) };
    }
    if (kind === 'transparency') {
      const v = clamp(k.v, 0, 1);
      return { t: k.t, v, e: Math.min(Math.max(0, k.e), v, 1 - v) };
    }
    const v = clamp(k.v, -3, 3);
    return { t: k.t, v, e: Math.min(Math.max(0, k.e), 3 - Math.abs(v)) };
  });
  return reduceKeys(fixed, (p, k, n) => {
    const f = (k.t - p.t) / Math.max(1e-9, n.t - p.t);
    return Math.abs(p.v + (n.v - p.v) * f - k.v) + Math.abs(k.e) * 0.01;
  });
}

export function clampColorSequence(input: RbxColorKey[]): RbxColorKey[] {
  const fallback: RbxColorKey = { t: 0, c: [1, 1, 1] };
  const valid = normalizeTimes(
    input.map(k => ({ t: fin(k.t), c: [clamp(k.c[0], 0, 1), clamp(k.c[1], 0, 1), clamp(k.c[2], 0, 1)] as [number, number, number] })),
    fallback,
  );
  return reduceKeys(valid, (p, k, n) => {
    const f = (k.t - p.t) / Math.max(1e-9, n.t - p.t);
    return [0, 1, 2].reduce((s, i) => s + Math.abs(p.c[i] + (n.c[i] - p.c[i]) * f - k.c[i]), 0);
  });
}

const numberSeqText = (keys: RbxNumberKey[]): string => keys.map(k => `${num(k.t)} ${num(k.v)} ${num(k.e)} `).join('');
const colorSeqText = (keys: RbxColorKey[]): string => keys.map(k => `${num(k.t)} ${num(k.c[0])} ${num(k.c[1])} ${num(k.c[2])} 0 `).join('');

// ---------- XML builders ----------

class Refs {
  private n = 0;
  next(): string {
    this.n++;
    return 'RBX' + this.n.toString(16).toUpperCase().padStart(32, '0');
  }
}

const P = {
  str: (name: string, v: string) => `<string name="${name}">${xmlEscape(v)}</string>`,
  bool: (name: string, v: boolean) => `<bool name="${name}">${v ? 'true' : 'false'}</bool>`,
  float: (name: string, v: number) => `<float name="${name}">${num(v)}</float>`,
  int: (name: string, v: number) => `<int name="${name}">${Math.round(fin(v))}</int>`,
  token: (name: string, v: number) => `<token name="${name}">${v}</token>`,
  content: (name: string, url: string) => `<Content name="${name}"><url>${xmlEscape(url)}</url></Content>`,
  range: (name: string, a: number, b: number) => `<NumberRange name="${name}">${num(a)} ${num(b)} </NumberRange>`,
  vec2: (name: string, x: number, y: number) => `<Vector2 name="${name}"><X>${num(x)}</X><Y>${num(y)}</Y></Vector2>`,
  vec3: (name: string, v: Vec3) => `<Vector3 name="${name}"><X>${num(v[0])}</X><Y>${num(v[1])}</Y><Z>${num(v[2])}</Z></Vector3>`,
  numSeq: (name: string, keys: RbxNumberKey[]) => `<NumberSequence name="${name}">${numberSeqText(keys)}</NumberSequence>`,
  colSeq: (name: string, keys: RbxColorKey[]) => `<ColorSequence name="${name}">${colorSeqText(keys)}</ColorSequence>`,
  source: (name: string, src: string) => `<ProtectedString name="${name}">${cdata(src)}</ProtectedString>`,
  ref: (name: string, ref: string) => `<Ref name="${name}">${ref}</Ref>`,
};

function item(cls: string, ref: string, props: string[], children: string[] = []): string {
  return `<Item class="${cls}" referent="${ref}"><Properties>${props.join('')}</Properties>${children.join('')}</Item>`;
}

/** CFrame whose UpVector (column 1) = dir; identity for +Y. Returns the XML CoordinateFrame. */
export function coordinateFrame(name: string, pos: Vec3, dir: Vec3 = [0, 1, 0]): string {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const up: Vec3 = len > 1e-9 ? [dir[0] / len, dir[1] / len, dir[2] / len] : [0, 1, 0];
  const t: Vec3 = Math.abs(up[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let x = cross(up, t);
  const xl = Math.hypot(x[0], x[1], x[2]);
  x = [x[0] / xl, x[1] / xl, x[2] / xl];
  const z = cross(x, up);
  const m = [x[0], up[0], z[0], x[1], up[1], z[1], x[2], up[2], z[2]];
  const names = ['R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22'];
  return `<CoordinateFrame name="${name}"><X>${num(pos[0])}</X><Y>${num(pos[1])}</Y><Z>${num(pos[2])}</Z>${names.map((n, i) => `<${n}>${num(m[i])}</${n}>`).join('')}</CoordinateFrame>`;
}

function partItem(refs: Refs, name: string, size: Vec3, pos: Vec3, dir: Vec3, children: string[], ref = refs.next()): string {
  const sz: Vec3 = [clamp(size[0], 0.05, 2048), clamp(size[1], 0.05, 2048), clamp(size[2], 0.05, 2048)];
  return item('Part', ref, [
    P.str('Name', name),
    P.bool('Anchored', true),
    P.bool('CanCollide', false),
    P.bool('CanTouch', false),
    P.bool('CanQuery', false),
    P.bool('CastShadow', false),
    P.float('Transparency', 1),
    P.vec3('Size', sz),
    coordinateFrame('CFrame', pos, dir),
  ], children);
}

/**
 * Textures not uploaded yet fall back to a Roblox built-in particle texture of the same kind (every game can use
 * rbxasset:// textures), and their flipbook is switched off: slicing a single soft image into a 4×4 grid is what made
 * un-uploaded flames render as hard-edged squares (user 2026-09-30 "fire looks like shit").
 */
export function builtinFallback(key: string): string {
  const k = key.toLowerCase();
  if (/flame|fire|ember/.test(k)) return 'rbxasset://textures/particles/fire_main.dds';
  if (/smoke|dust|cloud|puff|wisp|vapou?r|fog/.test(k)) return 'rbxasset://textures/particles/smoke_main.dds';
  return DEFAULT_TEXTURE;
}
function withFallbacks(effect: RobloxEffect, ids: Record<string, string> = {}): { effect: RobloxEffect; ids: Record<string, string> } {
  const all = { ...ids };
  const missing = (key?: string) => key !== undefined && !ids[key];
  for (const key of effect.textures) if (!ids[key]) all[key] = builtinFallback(key);
  return {
    ids: all,
    effect: { ...effect, emitters: effect.emitters.map(e => (missing(e.textureKey) && e.flipbook ? { ...e, flipbook: undefined } : e)) },
  };
}

function textureUrl(key: string | undefined, ids?: Record<string, string>): string {
  const id = key !== undefined ? ids?.[key] : undefined;
  if (!id) return DEFAULT_TEXTURE;
  return /^[a-z]+:\/\//i.test(id) ? id : `rbxassetid://${id}`;
}

function emitterItem(refs: Refs, e: RbxEmitter, name: string, ids?: Record<string, string>): string {
  const fb = e.flipbook;
  const props = [
    P.str('Name', name),
    P.bool('Enabled', true),
    P.float('Rate', 0),
    P.token('Shape', ENUM.Shape[e.shape]),
    P.token('ShapeStyle', ENUM.ShapeStyle[e.shapeStyle]),
    P.token('ShapeInOut', ENUM.ShapeInOut[e.shapeInOut]),
    P.token('EmissionDirection', ENUM.NormalId.Top),
    P.vec2('SpreadAngle', e.spreadAngle[0], e.spreadAngle[1]),
    P.range('Speed', Math.max(0, e.speed[0]), Math.max(0, e.speed[1])),
    P.range('Lifetime', Math.max(0, e.lifetime[0]), Math.max(0, e.lifetime[1])),
    P.vec3('Acceleration', e.acceleration),
    P.float('Drag', Math.max(0, e.drag)),
    P.numSeq('Size', clampNumberSequence(e.size, 'size')),
    P.numSeq('Transparency', clampNumberSequence(e.transparency, 'transparency')),
    P.colSeq('Color', clampColorSequence(e.color)),
    ...(e.squash ? [P.numSeq('Squash', clampNumberSequence(e.squash, 'squash'))] : []),
    P.float('LightEmission', Math.max(0, e.lightEmission)),
    P.float('LightInfluence', clamp(e.lightInfluence, 0, 1)),
    P.float('Brightness', Math.max(0, e.brightness)),
    P.content('Texture', textureUrl(e.textureKey, ids)),
    P.token('FlipbookLayout', ENUM.FlipbookLayout[fb ? fb.layout : 'None']),
    P.token('FlipbookMode', ENUM.FlipbookMode[fb ? fb.mode : 'Loop']),
    P.range('FlipbookFramerate', fb ? fb.framerate[0] : 1, fb ? fb.framerate[1] : 1),
    P.bool('FlipbookStartRandom', fb ? fb.startRandom : false),
    P.token('Orientation', ENUM.Orientation[e.orientation]),
    P.range('Rotation', e.rotation[0], e.rotation[1]),
    P.range('RotSpeed', e.rotSpeed[0], e.rotSpeed[1]),
    P.float('ZOffset', e.zOffset),
    P.bool('LockedToPart', e.lockedToPart),
  ];
  return item('ParticleEmitter', refs.next(), props);
}

function beamItem(refs: Refs, b: RbxBeamLayer, ids?: Record<string, string>): string {
  const props = [
    P.str('Name', 'Template'),
    P.bool('Enabled', false),
    P.colSeq('Color', clampColorSequence([{ t: 0, c: b.color }, { t: 1, c: b.color }])),
    P.numSeq('Transparency', clampNumberSequence([{ t: 0, v: b.transparency, e: 0 }, { t: 1, v: b.transparency, e: 0 }], 'transparency')),
    P.float('LightEmission', Math.max(0, b.lightEmission)),
    P.float('Brightness', Math.max(0, b.brightness)),
    P.content('Texture', textureUrl(b.textureKey, ids)),
    P.token('TextureMode', ENUM.TextureMode[b.textureMode]),
    P.float('TextureLength', Math.max(0.001, b.textureLength)),
    P.float('TextureSpeed', b.textureSpeed),
    P.float('ZOffset', b.zOffset),
    P.bool('FaceCamera', true),
    P.int('Segments', 1),
    P.float('Width0', 1),
    P.float('Width1', 1),
  ];
  return item('Beam', refs.next(), props);
}

function lightItem(refs: Refs, l: RbxLight, name: string): string {
  const light = item('PointLight', refs.next(), [
    P.str('Name', name),
    P.bool('Enabled', true),
    `<Color3 name="Color"><R>${num(clamp(l.color[0], 0, 1))}</R><G>${num(clamp(l.color[1], 0, 1))}</G><B>${num(clamp(l.color[2], 0, 1))}</B></Color3>`,
    P.float('Range', clamp(l.range, 0, 60)),
    P.float('Brightness', 0),
    P.bool('Shadows', false),
  ]);
  return partItem(refs, name, [0.2, 0.2, 0.2], l.position, [0, 1, 0], [light]);
}

/** Native Trail between two attachments (±width/2 on the Part's up axis); the player moves the Part and toggles Enabled. */
function trailItem(refs: Refs, t: RbxTrail, name: string): string {
  const r0 = refs.next(), r1 = refs.next(), half = Math.max(0.01, t.width / 2);
  const att = (ref: string, n: string, y: number) => item('Attachment', ref, [P.str('Name', n), coordinateFrame('CFrame', [0, y, 0])]);
  const trail = item('Trail', refs.next(), [
    P.str('Name', name),
    P.bool('Enabled', false),
    P.ref('Attachment0', r0), P.ref('Attachment1', r1),
    P.float('Lifetime', clamp(t.lifetime, 0.01, 20)),
    P.float('MinLength', 0.05),
    P.bool('FaceCamera', true),
    P.colSeq('Color', [{ t: 0, c: t.color }, { t: 1, c: t.color }]),
    P.numSeq('Transparency', t.transparency.map(k => ({ ...k, v: clamp(k.v, 0, 1) }))),
    P.numSeq('WidthScale', t.widthScale),
    P.float('LightEmission', clamp(t.lightEmission, 0, 1)),
    P.float('Brightness', Math.max(0, t.brightness)),
    P.float('LightInfluence', 0),
  ]);
  return partItem(refs, name, [0.2, 0.2, 0.2], t.position, [0, 1, 0], [att(r0, 'A0', half), att(r1, 'A1', -half), trail]);
}

/** One template Part per mesh layer (hidden; the player clones it per live piece). Wedges are WedgeParts. */
function meshTemplateItem(refs: Refs, m: RbxMeshLayer, name: string): string {
  const c = m.color.map(x => Math.round(clamp(x, 0, 1) * 255));
  const props = [
    P.str('Name', name),
    P.bool('Anchored', true),
    P.bool('CanCollide', false),
    P.bool('CanTouch', false),
    P.bool('CanQuery', false),
    P.bool('CastShadow', m.castShadow),
    P.bool('Massless', true),
    P.token('Material', ENUM.Material[m.material]),
    `<Color3uint8 name="Color3uint8">${(0xff000000 | (c[0] << 16) | (c[1] << 8) | c[2]) >>> 0}</Color3uint8>`,
    P.float('Transparency', 1),
    P.float('Reflectance', clamp(m.reflectance, 0, 1)),
    P.vec3('Size', [1, 1, 1]),
    coordinateFrame('CFrame', [0, 0, 0]),
    ...(m.shape === 'Wedge' ? [] : [P.token('shape', ENUM.PartType[m.shape])]),
  ];
  return item(m.shape === 'Wedge' ? 'WedgePart' : 'Part', refs.next(), props);
}

// ---------- EffectData (Luau) ----------

const luaStr = (s: string): string => {
  let out = '"';
  for (const byte of new TextEncoder().encode(s)) {
    if (byte === 0x22) out += '\\"';
    else if (byte === 0x5c) out += '\\\\';
    else if (byte === 0x0a) out += '\\n';
    else if (byte >= 0x20 && byte < 0x7f) out += String.fromCharCode(byte);
    else out += '\\' + String(byte).padStart(3, '0');
  }
  return out + '"';
};

type LuaValue = number | string | boolean | LuaValue[] | { [k: string]: LuaValue | undefined };

function lua(v: LuaValue): string {
  if (typeof v === 'number') return String(r3(v));
  if (typeof v === 'string') return luaStr(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `{${v.map(lua).join(',')}}`;
  const parts: string[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    parts.push(`${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `[${luaStr(k)}]`}=${lua(val)}`);
  }
  return `{${parts.join(',')}}`;
}

const byTick = <T extends [number, ...unknown[]]>(list: T[]): T[] => list.slice().sort((a, b) => a[0] - b[0]);
const flatN = (keys: RbxNumberKey[]): number[] => keys.flatMap(k => [k.t, k.v, k.e]);
const flatC = (keys: RbxColorKey[]): number[] => keys.flatMap(k => [k.t, k.c[0], k.c[1], k.c[2]]);

function uniqueNamer(): (name: string) => string {
  const used = new Set<string>();
  return (name: string) => {
    const base = name || 'unnamed';
    let n = base;
    for (let i = 2; used.has(n); i++) n = `${base}_${i}`;
    used.add(n);
    return n;
  };
}

function effectDataSource(effect: RobloxEffect, names: { e: string[]; b: string[]; l: string[]; t: string[]; m: string[] }): string {
  const emitters = effect.emitters.map((e, i) => ({
    name: names.e[i],
    pos: e.position,
    rate: byTick(e.rate.map(([t, v]) => [t, v] as [number, number])),
    bursts: byTick(e.bursts.map(b => (b.position ? [b.tick, b.count, ...b.position] : [b.tick, b.count]) as [number, ...number[]])),
    path: e.path && e.path.length ? byTick(e.path.map(([t, p]) => [t, ...p] as [number, ...number[]])) : undefined,
    tracks: e.tracks && e.tracks.length
      ? Object.fromEntries(e.tracks.filter(t => t.keys.length).map(t => [t.property, byTick(t.keys.map(k => [k[0], k[1]] as [number, number]))]))
      : undefined,
    colorFrames: e.colorFrames && e.colorFrames.length
      ? byTick(e.colorFrames.map(f => [f.tick, flatC(clampColorSequence(f.color)), flatN(clampNumberSequence(f.transparency, 'transparency'))] as [number, number[], number[]]))
      : undefined,
    info: {
      shape: e.shape, shapeStyle: e.shapeStyle, shapeInOut: e.shapeInOut, orientation: e.orientation,
      flipbookLayout: e.flipbook ? e.flipbook.layout : 'None', flipbookMode: e.flipbook ? e.flipbook.mode : 'Loop',
    },
  }));
  const firstIndex = new Map<string, number>();
  effect.beams.forEach((b, i) => { if (!firstIndex.has(b.name)) firstIndex.set(b.name, i); });
  // sameGeometryAs chains resolve to their root layer with the product of the width ratios.
  const resolveRoot = (b: RbxBeamLayer): { root: number; ratio: number } | undefined => {
    let ratio = 1;
    let cur = b;
    for (let hops = 0; cur.sameGeometryAs !== undefined; hops++) {
      const idx = firstIndex.get(cur.sameGeometryAs);
      if (idx === undefined || hops > effect.beams.length) throw new Error(`beam layer "${b.name}": sameGeometryAs "${cur.sameGeometryAs}" not found or cyclic`);
      ratio *= cur.widthRatio ?? 1;
      cur = effect.beams[idx];
    }
    return { root: effect.beams.indexOf(cur), ratio };
  };
  const pathText = (points: [number, number, number, number][]): string => points.map(q => `${r3(q[0])} ${r3(q[1])} ${r3(q[2])} ${r3(q[3])}`).join(' ');
  const beams = effect.beams.map((b, i) => {
    const common = { name: names.b[i], transparency: clamp(b.transparency, 0, 1), maxSegments: b.maxSegments };
    if (b.sameGeometryAs !== undefined) {
      const { root, ratio } = resolveRoot(b)!;
      return { ...common, src: names.b[root], ratio };
    }
    // Frame: [tick, [[alpha, "x y z w ..."], ...]] or [tick, false, widthScale]; point lists are strings decoded lazily by the player.
    const frames = b.frames.slice().sort((p, q) => p.tick - q.tick).map(f =>
      f.paths
        ? [f.tick, f.paths.map(p => [clamp(p.alpha, 0, 1), pathText(p.points)] as LuaValue)] as LuaValue
        : [f.tick, false, f.widthScale ?? 1] as LuaValue);
    return { ...common, interpolate: b.interpolate ? true : undefined, frames };
  });
  const lights = effect.lights.map((l, i) => ({
    name: names.l[i],
    pos: l.position,
    brightness: byTick(l.brightness.map(([t, v]) => [t, v] as [number, number])),
    path: l.path && l.path.length ? byTick(l.path.map(([t, p]) => [t, ...p] as [number, ...number[]])) : undefined,
  }));
  // Mesh frames: one string per piece, `stride` numbers per frame: tick px py pz qx qy qz sx sy sz [r g b transparency];
  // the quaternion's w (>= 0) is rebuilt by the player.
  const d = (x: number, n: number): string => String(Number(fin(x).toFixed(n)));
  const meshes = (effect.meshes ?? []).map((m, i) => ({
    name: names.m[i],
    shape: m.shape, material: m.material,
    stride: m.colorVaries ? 14 : 10,
    transparency: clamp(m.transparency, 0, 1),
    pieces: m.pieces.map(p => [
      Math.round(p.birthTick), Math.round(p.deathTick),
      p.frames.map(f => [
        d(f.tick, 0), d(f.pos[0], 2), d(f.pos[1], 2), d(f.pos[2], 2), d(f.rot[0], 3), d(f.rot[1], 3), d(f.rot[2], 3),
        d(f.size[0], 2), d(f.size[1], 2), d(f.size[2], 2),
        ...(m.colorVaries ? [d(f.color?.[0] ?? m.color[0], 3), d(f.color?.[1] ?? m.color[1], 3), d(f.color?.[2] ?? m.color[2], 3), d(f.transparency ?? m.transparency, 2)] : []),
      ].join(' ')).join(' '),
    ] as LuaValue),
  }));
  const data: LuaValue = {
    name: effect.name,
    durationTicks: Math.max(1, Math.round(effect.durationTicks)),
    studsPerMeter: effect.studsPerMeter,
    anchors: { source: effect.anchors.source, target: effect.anchors.target } as unknown as LuaValue,
    travel: effect.travel ? ({ startTick: effect.travel.startTick, travelTicks: effect.travel.travelTicks } as unknown as LuaValue) : undefined,
    emitters: emitters as unknown as LuaValue,
    beams: beams as unknown as LuaValue,
    lights: lights as unknown as LuaValue,
    meshes: meshes as unknown as LuaValue,
    trails: (effect.trails ?? []).map((t, i) => ({
      name: names.t[i], pos: t.position, on: t.window[0], off: t.window[1],
      path: t.path.length ? byTick(t.path.map(([k, p]) => [k, ...p] as [number, ...number[]])) : undefined,
    })) as unknown as LuaValue,
  };
  return `-- Generated by the VFX tool Roblox exporter. Positions are origin-relative studs; ticks are 1/60 s.\nreturn ${lua(data)}\n`;
}

const DEMO_SOURCE = `-- Tick Enabled in the Properties panel to play this effect on loop at the model's pivot.
local model = script.Parent
local EffectPlayer = require(model:WaitForChild("EffectPlayer"))
EffectPlayer.play(model, nil, { loop = true })
`;

// ---------- main ----------

export function writeRbxmx(input: RobloxEffect, options: WriteOptions): string {
  const fb = withFallbacks(input, options.assetIds);
  const effect = fb.effect, opts = { ...options, assetIds: fb.ids };
  const refs = new Refs();
  const nameE = uniqueNamer();
  const nameB = uniqueNamer();
  const nameL = uniqueNamer();
  const nameT = uniqueNamer();
  const nameM = uniqueNamer();
  const names = { e: effect.emitters.map(e => nameE(e.name)), b: effect.beams.map(b => nameB(b.name)), l: effect.lights.map(l => nameL(l.name)), t: (effect.trails ?? []).map(t => nameT(t.name)), m: (effect.meshes ?? []).map(m => nameM(m.name)) };

  const originRef = refs.next();
  const originPart = partItem(refs, 'Origin', [0.2, 0.2, 0.2], [0, 0, 0], [0, 1, 0], [], originRef);

  const emitterParts = effect.emitters.map((e, i) =>
    partItem(refs, names.e[i], e.partSize, e.position, e.direction, [emitterItem(refs, e, names.e[i], opts.assetIds)]));
  const beamFolders = effect.beams.map((b, i) => item('Folder', refs.next(), [P.str('Name', names.b[i])], [beamItem(refs, b, opts.assetIds)]));
  const lightParts = effect.lights.map((l, i) => lightItem(refs, l, names.l[i]));

  const children = [
    originPart,
    item('Folder', refs.next(), [P.str('Name', 'Emitters')], emitterParts),
    item('Folder', refs.next(), [P.str('Name', 'Beams')], beamFolders),
    item('Folder', refs.next(), [P.str('Name', 'Lights')], lightParts),
    item('Folder', refs.next(), [P.str('Name', 'Trails')], (effect.trails ?? []).map((t, i) => trailItem(refs, t, names.t[i]))),
    item('Folder', refs.next(), [P.str('Name', 'Meshes')], (effect.meshes ?? []).map((m, i) => meshTemplateItem(refs, m, names.m[i]))),
    item('ModuleScript', refs.next(), [P.str('Name', 'EffectData'), P.source('Source', effectDataSource(effect, names))]),
    item('ModuleScript', refs.next(), [P.str('Name', 'EffectPlayer'), P.source('Source', opts.playerSource)]),
    item('Script', refs.next(), [P.str('Name', 'Demo'), P.bool('Disabled', true), P.source('Source', DEMO_SOURCE)]),
    item('Color3Value', refs.next(), [P.str('Name', 'VfxColor'), `<Color3 name="Value"><R>${num(opts.color?.[0] ?? 1)}</R><G>${num(opts.color?.[1] ?? 1)}</G><B>${num(opts.color?.[2] ?? 1)}</B></Color3>`]),
    item('NumberValue', refs.next(), [P.str('Name', 'VfxHueShift'), `<double name="Value">${num(opts.hueShift ?? 0)}</double>`]),
  ];
  const model = item('Model', refs.next(), [P.str('Name', effect.name || 'Effect'), P.ref('PrimaryPart', originRef)], children);
  return `<?xml version="1.0" encoding="utf-8"?>\n<roblox version="4">${model}</roblox>\n`;
}
