import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { clampColorSequence, clampNumberSequence, DEFAULT_TEXTURE, ENUM, writeRbxmx } from '../src/export/roblox/rbxmx.ts';
import { effectPlayerSource } from '../src/export/roblox/playerSource.node.ts';
import type { RobloxEffect } from '../src/export/roblox/types.ts';

const PLAYER = effectPlayerSource();

export function handBuiltEffect(): RobloxEffect {
  const many = Array.from({ length: 30 }, (_, i) => ({ t: i / 29, v: 1 + (i % 3), e: 5 }));
  return {
    name: 'Test <Effect> & "co"',
    durationTicks: 120,
    studsPerMeter: 3.571,
    anchors: { source: [0, 0, 0], target: [3, 0, 0] },
    travel: { startTick: 10, travelTicks: 30 },
    trails: [{ name: 'streak', position: [0, 4, 0], path: [[10, [0, 4, 0]], [11, [1, 4, 0]], [12, [2, 4, 0]]], window: [10, 40], lifetime: 0.3, width: 1.2, color: [1, 0.5, 0.1], transparency: [{ t: 0, v: 0, e: 0 }, { t: 0.8, v: 0, e: 0 }, { t: 1, v: 1, e: 0 }], widthScale: [{ t: 0, v: 1, e: 0 }, { t: 1, v: 0.3, e: 0 }], lightEmission: 1, brightness: 2 }],
    emitters: [
      {
        name: 'flame', position: [0, 1, 0], direction: [0, 1, 0], partSize: [2, 0.5, 2],
        shape: 'Cylinder', shapeStyle: 'Volume', shapeInOut: 'Outward', spreadAngle: [10, 10],
        speed: [4, 8], lifetime: [0.5, 1], acceleration: [0, 2, 0], drag: 1,
        size: many, transparency: [{ t: 0.2, v: 0.1, e: 0.5 }, { t: 0.8, v: 1.4, e: 0 }],
        color: [{ t: 0, c: [1, 0.9, 0.5] }, { t: 1, c: [0.8, 0.1, 0] }],
        lightEmission: 1, lightInfluence: 0, brightness: 2, textureKey: 'flame.png',
        flipbook: { layout: 'Grid4x4', mode: 'Loop', framerate: [16, 24], startRandom: true },
        orientation: 'FacingCamera', rotation: [0, 360], rotSpeed: [-30, 30], zOffset: 0.5, lockedToPart: false,
        rate: [[0, 30], [90, 0]], bursts: [], path: [[0, [0, 1, 0]], [60, [3, 1, 0]]],
        tracks: [{ property: 'SpeedScale', keys: [[0, 1], [120, 2]] }],
        colorFrames: [
          { tick: 0, color: [{ t: 0, c: [1, 0, 0] }, { t: 1, c: [1, 1, 0] }], transparency: [{ t: 0, v: 0, e: 0 }, { t: 1, v: 1, e: 0 }] },
          { tick: 60, color: [{ t: 0, c: [0, 0, 1] }, { t: 1, c: [0, 1, 1] }], transparency: [{ t: 0, v: 0, e: 0 }, { t: 1, v: 1, e: 0 }] },
        ],
      },
      {
        name: 'spark', position: [1, 2, 3], direction: [1, 0, 0], partSize: [1, 1, 1],
        shape: 'Sphere', shapeStyle: 'Surface', shapeInOut: 'InAndOut', spreadAngle: [180, 180],
        speed: [10, 20], lifetime: [0.3, 0.6], acceleration: [0, -20, 0], drag: 0,
        size: [{ t: 0, v: 0.4, e: 0 }, { t: 1, v: 0, e: 0 }], transparency: [{ t: 0, v: 0, e: 0 }, { t: 1, v: 1, e: 0 }],
        color: [{ t: 0, c: [1, 1, 1] }, { t: 1, c: [1, 0.5, 0] }],
        lightEmission: 0.5, lightInfluence: 1, brightness: 1, orientation: 'VelocityParallel',
        rotation: [0, 0], rotSpeed: [0, 0], zOffset: 0, lockedToPart: true,
        rate: [], bursts: [{ tick: 10, count: 12, position: [1, 2, 3] }, { tick: 50, count: 5 }],
      },
    ],
    beams: [{
      name: 'bolt', color: [0.6, 0.8, 1], transparency: 0.2, lightEmission: 1, brightness: 3,
      textureMode: 'Wrap', textureLength: 2, textureSpeed: 1, zOffset: 0, maxSegments: 3,
      frames: [
        { tick: 0, paths: [{ alpha: 1, points: [[0, 0, 0, 0.5], [1, 1, 0, 0.4], [2, 0, 0, 0.1]] }] },
        { tick: 30, paths: [{ alpha: 0.5, points: [[0, 0, 0, 0.5], [1, 2, 0, 0.3], [2, 1, 1, 0.1], [3, 0, 0, 0.05]] }] },
        { tick: 45, widthScale: 2 },
      ],
      interpolate: true,
    }, {
      name: 'bolt_core', color: [1, 1, 1], transparency: 0, lightEmission: 1, brightness: 3,
      textureMode: 'Stretch', textureLength: 1, textureSpeed: 0, zOffset: 0, maxSegments: 3,
      frames: [], sameGeometryAs: 'bolt', widthRatio: 0.5,
    }],
    lights: [{ name: 'glow', color: [1, 0.6, 0.2], range: 20, position: [0, 3, 0], brightness: [[0, 2], [100, 0]] }],
    meshes: [
      { name: 'rocks', shape: 'Block', material: 'Slate', source: 'rock-a', color: [0.5, 0.4, 0.3], transparency: 0, reflectance: 0, castShadow: true, colorVaries: false, pieces: [
        { birthTick: 10, deathTick: 14, frames: [
          { tick: 10, pos: [1, 0.5, 2], rot: [0, 0, 0, 1], size: [2, 1.5, 1.8] },
          { tick: 12, pos: [1, 1.5, 2], rot: [0, 0.7071, 0, 0.7071], size: [2, 1.5, 1.8] },
          { tick: 14, pos: [1, 0.5, 2], rot: [0, 1, 0, 0], size: [0, 0, 0] },
        ] },
      ] },
      { name: 'ice', shape: 'Wedge', material: 'Ice', source: 'crystal', color: [0.6, 0.8, 1], transparency: 0.2, reflectance: 0.25, castShadow: false, colorVaries: true, pieces: [
        { birthTick: 0, deathTick: 2, frames: [
          { tick: 0, pos: [0, 1, 0], rot: [0, 0, 0, 1], size: [1, 2, 1], color: [1, 1, 1], transparency: 0.1 },
          { tick: 2, pos: [0, 2, 0], rot: [0, 0, 0, 1], size: [1, 2, 1], color: [0.2, 0.4, 0.6], transparency: 0.9 },
        ] },
      ] },
    ],
    textures: ['flame.png'],
    report: [],
  };
}

/** Minimal well-formedness check: balanced tags, CDATA skipped. Returns the number of elements. */
function checkBalanced(xml: string): number {
  const stripped = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const re = /<(\/?)([A-Za-z0-9_]+)([^>]*?)(\/?)>/g;
  const stack: string[] = [];
  let count = 0;
  let last = 0;
  for (let m = re.exec(stripped); m; m = re.exec(stripped)) {
    assert.ok(!/[<]/.test(stripped.slice(last, m.index)), 'stray < in text');
    last = m.index + m[0].length;
    if (m[4]) { count++; continue; }
    if (m[1]) {
      assert.equal(stack.pop(), m[2], `unbalanced </${m[2]}>`);
    } else { stack.push(m[2]); count++; }
  }
  assert.equal(stack.length, 0, 'unclosed tags');
  return count;
}

test('rbxmx is well-formed and has the expected structure', () => {
  const xml = writeRbxmx(handBuiltEffect(), { assetIds: { 'flame.png': '12345' }, playerSource: PLAYER });
  assert.ok(checkBalanced(xml) > 50);
  assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>\n<roblox version="4">/);
  for (const cls of ['Model', 'Folder', 'Part', 'ParticleEmitter', 'Beam', 'PointLight', 'ModuleScript', 'Script']) {
    assert.ok(xml.includes(`class="${cls}"`), cls);
  }
  for (const n of ['Emitters', 'Beams', 'Lights', 'EffectData', 'EffectPlayer', 'Demo', 'flame', 'spark', 'bolt', 'glow', 'Template']) {
    assert.ok(xml.includes(`>${n}</string>`), n);
  }
  // model name is XML-escaped
  assert.ok(xml.includes('Test &lt;Effect&gt; &amp; &quot;co&quot;'));
  // referents unique
  const refs = [...xml.matchAll(/referent="(RBX[0-9A-F]+)"/g)].map(m => m[1]);
  assert.equal(new Set(refs).size, refs.length);
  assert.ok(xml.includes('<bool name="Disabled">true</bool>'));
  // enum tokens: flame = Cylinder(2) Volume(0) Outward(0) Grid4x4(2) Loop(0) FacingCamera(0); spark = Sphere(1) Surface(1) InAndOut(2) VelocityParallel(2)
  assert.ok(xml.includes('<token name="Shape">2</token>'));
  assert.ok(xml.includes('<token name="Shape">1</token>'));
  assert.ok(xml.includes('<token name="ShapeInOut">2</token>'));
  assert.ok(xml.includes('<token name="FlipbookLayout">2</token>'));
  assert.ok(xml.includes('<token name="Orientation">2</token>'));
  assert.ok(xml.includes('<token name="EmissionDirection">1</token>'));
  assert.ok(xml.includes('<token name="TextureMode">1</token>'));
  assert.deepEqual(ENUM.Shape, { Box: 0, Sphere: 1, Cylinder: 2, Disc: 3 });
  // Rate 0 (player drives it), Enabled true, ParticleEmitter Rate
  assert.ok(xml.includes('<float name="Rate">0</float>'));
  // emitter part CFrame: direction +X => UpVector column (R01,R11,R21) = 1,0,0
  assert.ok(/<X>1<\/X><Y>2<\/Y><Z>3<\/Z><R00>0<\/R00><R01>1<\/R01><R02>0<\/R02><R10>0<\/R10><R11>0<\/R11>/.test(xml) || xml.includes('<R01>1</R01>'));
  // identity for +Y emitter
  assert.ok(xml.includes('<R00>1</R00><R01>0</R01><R02>0</R02><R10>0</R10><R11>1</R11><R12>0</R12><R20>0</R20><R21>0</R21><R22>1</R22>'));
});

test('texture: assetIds map or the default fallback', () => {
  const withId = writeRbxmx(handBuiltEffect(), { assetIds: { 'flame.png': '12345' }, playerSource: PLAYER });
  assert.ok(withId.includes('<url>rbxassetid://12345</url>'));
  const without = writeRbxmx(handBuiltEffect(), { playerSource: PLAYER });
  assert.ok(without.includes(`<url>${DEFAULT_TEXTURE}</url>`));
  assert.ok(!without.includes('rbxassetid://12345'));
});

test('sequences are clamped to Roblox rules', () => {
  const size = clampNumberSequence(handBuiltEffect().emitters[0].size, 'size');
  assert.ok(size.length <= 20);
  assert.equal(size[0].t, 0);
  assert.equal(size[size.length - 1].t, 1);
  for (const k of size) assert.ok(k.e <= k.v);
  for (let i = 1; i < size.length; i++) assert.ok(size[i].t > size[i - 1].t);
  const tr = clampNumberSequence(handBuiltEffect().emitters[0].transparency, 'transparency');
  assert.equal(tr[0].t, 0);
  assert.equal(tr[tr.length - 1].t, 1);
  for (const k of tr) { assert.ok(k.v >= 0 && k.v <= 1); assert.ok(k.v + k.e <= 1 && k.v - k.e >= 0); }
  const col = clampColorSequence([{ t: 0.3, c: [2, -1, 0.5] }]);
  assert.equal(col.length, 3);
  assert.deepEqual(col[0].c, [1, 0, 0.5]);
  assert.deepEqual([col[0].t, col[2].t], [0, 1]);
  const xml = writeRbxmx(handBuiltEffect(), { playerSource: PLAYER });
  const seq = /<NumberSequence name="Size">([^<]*)<\/NumberSequence>/.exec(xml)![1].trim().split(/\s+/);
  assert.ok(seq.length / 3 <= 20);
});

/** EffectData JSON text (StringValue Value, XML-unescaped); checked to parse. */
function dataOf(xml: string): string {
  const m = /<Item class="StringValue"[^>]*><Properties><string name="Name">EffectData<\/string><string name="Value">([\s\S]*?)<\/string>/.exec(xml);
  assert.ok(m, 'EffectData StringValue');
  const text = m![1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  JSON.parse(text);
  return text;
}

test('EffectData carries bursts, paths and tracks; players are embedded', () => {
  const xml = writeRbxmx(handBuiltEffect(), { playerSource: PLAYER });
  const data = dataOf(xml);
  assert.ok(data.includes('"bursts":[[10,12,1,2,3],[50,5]]'), data);
  assert.ok(data.includes('"durationTicks":120'));
  assert.ok(data.includes('"tracks":{"SpeedScale":[[0,1],[120,2]]}'));
  assert.ok(data.includes('"path":[[0,0,1,0],[60,3,1,0]]'));
  assert.ok(data.includes('"maxSegments":3'));
  assert.ok(data.includes('[0,[[1,"0 0 0 0.5 1 1 0 0.4 2 0 0 0.1"]]]'), data);
  assert.ok(data.includes('[45,false,2]'));
  assert.ok(data.includes('"interpolate":true'));
  assert.ok(data.includes('"src":"bolt"'));
  assert.ok(data.includes('"ratio":0.5'));
  assert.ok(data.includes('"brightness":[[0,2],[100,0]]'));
  assert.ok(!/\d\.\d{4}/.test(data));
  const player = readFileSync(new URL('../src/export/roblox/EffectPlayer.luau', import.meta.url), 'utf8');
  assert.ok(player.includes('EffectPlayer.play'));
  assert.ok(xml.includes('function EffectPlayer.play'));
  assert.ok(xml.includes('name="Source"><![CDATA[' + player.slice(0, 40)));
});

test('mesh layers: template Parts (WedgePart for wedges) and compact frame strings in EffectData', () => {
  const xml = writeRbxmx(handBuiltEffect(), { playerSource: PLAYER });
  checkBalanced(xml);
  assert.ok(xml.includes('>Meshes</string>'));
  assert.ok(xml.includes('class="WedgePart"'));
  assert.ok(xml.includes(`<token name="Material">${ENUM.Material.Slate}</token>`));
  assert.ok(xml.includes(`<token name="Material">${ENUM.Material.Ice}</token>`));
  assert.ok(xml.includes(`<token name="shape">${ENUM.PartType.Block}</token>`), 'the Block layer sets Part.shape');
  assert.equal([...xml.matchAll(/<token name="shape">/g)].length, 1, 'the WedgePart has no shape');
  assert.ok(xml.includes('<float name="Reflectance">0.25</float>'));
  assert.match(xml, /<Color3uint8 name="Color3uint8">\d+<\/Color3uint8>/);
  const data = dataOf(xml);
  // stride 10: tick pos(3) quat xyz(3) size(3)
  assert.ok(data.includes('"stride":10'), data);
  assert.ok(data.includes('[10,14,"10 1 0.5 2 0 0 0 2 1.5 1.8 12 1 1.5 2 0 0.707 0 2 1.5 1.8 14 1 0.5 2 0 1 0 0 0 0"]'), data);
  // stride 14 adds colour and transparency
  assert.ok(data.includes('"stride":14'));
  assert.ok(data.includes('"0 0 1 0 0 0 0 1 2 1 1 1 1 0.1 2 0 2 0 0 0 0 1 2 1 0.2 0.4 0.6 0.9"'), data);
  assert.ok(!/\d\.\d{4}/.test(data));
  // a layer-free effect still writes an (empty) Meshes folder
  const bare = handBuiltEffect();
  bare.meshes = [];
  assert.ok(writeRbxmx(bare, { playerSource: PLAYER }).includes('>Meshes</string>'));
});

test('duplicate names are made unique and the source escapes CDATA terminators', () => {
  const e = handBuiltEffect();
  e.emitters[1].name = 'flame';
  const xml = writeRbxmx(e, { playerSource: 'local s = "]]>"' });
  assert.ok(xml.includes('flame_2'));
  checkBalanced(xml);
  assert.ok(xml.includes(']]]]><![CDATA[>'));
});

test('real IR files export (chains resolved, well-formed)', () => {
  for (const name of ['lightning-strike', 'flamethrower']) {
    const url = new URL(`../work/roblox/${name}.ir.json`, import.meta.url);
    let ir: RobloxEffect;
    try { ir = JSON.parse(readFileSync(url, 'utf8')); } catch { continue; }
    const ids = Object.fromEntries(ir.textures.map(t => [t, '1']));
    const xml = writeRbxmx(ir, { assetIds: ids, playerSource: PLAYER });
    assert.ok(checkBalanced(xml) > 100);
    writeFileSync(new URL(`../work/roblox/${name}.rbxmx`, import.meta.url), xml);
    const data = dataOf(xml);
    assert.equal((data.match(/"src":"/g) ?? []).length, ir.beams.filter(l => l.sameGeometryAs !== undefined).length);
  }
});

test('rbxmx.ts is browser-safe (no node: imports, no Buffer)', () => {
  for (const f of ['rbxmx.ts', 'types.ts']) {
    const src = readFileSync(new URL(`../src/export/roblox/${f}`, import.meta.url), 'utf8');
    assert.ok(!/from\s+['"]node:/.test(src) && !/Buffer/.test(src), f);
  }
});

test('write the hand-built effect for tools/roblox-check.mjs', () => {
  mkdirSync(new URL('../work/roblox/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../work/roblox/test.rbxmx', import.meta.url), writeRbxmx(handBuiltEffect(), { assetIds: { 'flame.png': '12345' }, playerSource: PLAYER }));
});
