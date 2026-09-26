import test from 'node:test';
import assert from 'node:assert/strict';
import type { Diagnostic, EffectDocumentV2, NodeDefinition, ValidationResult, Vec3 } from '../src/model/types.ts';
import { compilePathPreview, MAX_PREVIEW_PATHS, MAX_PREVIEW_POINTS, type PathPreviewPlan } from '../src/graph/toPaths.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { bezierPath, jaggedPath, linePath, revealPath } from '../src/runtime/paths.ts';
import { branchPaths, BRANCH_DEFAULTS } from '../src/runtime/branches.ts';

const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });
const root = (d: EffectDocumentV2) => d.graphs[0];
const find = (d: EffectDocumentV2, id: string) => root(d).nodes.find(n => n.id === id) as NodeDefinition;

const S: Vec3 = [0, 1, 0];
const T: Vec3 = [0, 1, 5];

/** F01 (its billboard layer is skipped here) plus a ribbon per path output: source → line → ribbon. */
function withRibbons(nodes: NodeDefinition[], paths: [string, string][], extraEdges: ReturnType<typeof edge>[] = []): EffectDocumentV2 {
  const d = createF01Document();
  const g = root(d);
  g.nodes.push(node('n-line', 'LinePath'), ...nodes);
  g.edges.push(edge('e-ls', 'node-source', 'out', 'n-line', 'start'), edge('e-le', 'node-target', 'out', 'n-line', 'end'), ...extraEdges);
  paths.forEach(([src, port], i) => {
    g.nodes.push(node(`n-rib${i}`, 'RibbonRenderer'));
    g.edges.push(
      edge(`e-rp${i}`, src, port, `n-rib${i}`, 'paths'),
      edge(`e-rm${i}`, 'node-material', 'material', `n-rib${i}`, 'material'),
      edge(`e-ro${i}`, `n-rib${i}`, 'visual', 'node-output', 'visual', i + 1),
    );
  });
  return d;
}
/** line → jag → branch; ribbon0 = branch.trunk → reveal, ribbon1 = branch.branches. */
function chain(mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = withRibbons(
    [node('n-jag', 'JaggedPath'), node('n-branch', 'BranchPath', { count: 5 }), node('n-reveal', 'RevealPath', { fraction: 0.5 })],
    [['n-reveal', 'paths'], ['n-branch', 'branches']],
    [edge('e-lj', 'n-line', 'paths', 'n-jag', 'paths'), edge('e-jb', 'n-jag', 'paths', 'n-branch', 'paths'), edge('e-br', 'n-branch', 'trunk', 'n-reveal', 'paths')],
  );
  mutate?.(d);
  return d;
}
function plan(d: EffectDocumentV2, tick = 0): PathPreviewPlan {
  const r = compilePathPreview(d, tick);
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  return r.value;
}
function errorsOf(r: ValidationResult<unknown>): Diagnostic[] {
  if (r.ok) assert.fail('expected compile errors');
  return r.errors;
}
const jagOpts = (tick: number) => ({
  documentSeed: 42, randomStreamId: 'rs-n-jag', pathOrdinal: 0, amplitude: 0.3, samples: 42, regenerationHz: 24,
  effectLocalSeconds: tick / 60, pinned: true,
});

test('LinePath ribbon matches the pure runtime and carries renderer/material metadata', () => {
  const p = plan(withRibbons([], [['n-line', 'paths']]));
  assert.equal(p.layers.length, 1);
  const l = p.layers[0];
  assert.deepEqual(l.paths, [linePath('p0', S, T, 2)]);
  assert.deepEqual({ ...l, paths: [] }, {
    nodeId: 'n-rib0', window: { startTick: 0, endTick: 120 }, active: true, paths: [], width: 0.04,
    widthOverPath: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] }, endFade: 0.12,
    uvMode: 'stretch', uvTileLength: 1, orientation: 'camera', renderOrderOffset: 0, visualOrder: 1,
    color: { srgb: '#FFFFFF', alpha: 1 }, opacity: 1, emission: 0, blend: 'additive', alphaCutoff: 0.5,
  });
});

test('BezierPath uses endpoint-relative handles', () => {
  const d = withRibbons([node('n-bez', 'BezierPath', { samples: 16, startHandle: [1, 0, 0], endHandle: [0, 2, 0] })], [['n-bez', 'paths']], [
    edge('e-bs', 'node-source', 'out', 'n-bez', 'start'), edge('e-be', 'node-target', 'out', 'n-bez', 'end'),
  ]);
  assert.deepEqual(plan(d).layers[0].paths, [bezierPath('p0', S, [1, 1, 0], [0, 3, 5], T, 16)]);
});

test('Jagged, Branch (trunk and branches) and Reveal match the runtime composition', () => {
  const tick = 30;
  const p = plan(chain(), tick);
  const jag = jaggedPath(linePath('p0', S, T, 2), jagOpts(tick));
  const br = branchPaths([jag], { documentSeed: 42, randomStreamId: 'rs-n-branch', count: 5 });
  assert.deepEqual(p.layers.map(l => l.nodeId), ['n-rib0', 'n-rib1']);
  assert.deepEqual(p.layers[0].paths, br.trunks.map(t => revealPath(t, 0.5)));
  assert.deepEqual(p.layers[1].paths, br.branches);
  assert.deepEqual(p.layers[1].paths.map(b => b.id), ['p0/b0', 'p0/b1', 'p0/b2', 'p0/b3', 'p0/b4']);
  assert.ok(p.layers[1].paths.every(b => b.widthScale >= BRANCH_DEFAULTS.widthMin && b.widthScale <= BRANCH_DEFAULTS.widthMax));
});

test('jagged regeneration follows effect time and is deterministic', () => {
  const at = (tick: number) => plan(chain(), tick).layers[1].paths;
  assert.deepEqual(at(30), at(30));
  assert.deepEqual(at(30), at(31)); // floor(30/60*24) = floor(31/60*24) = 12
  assert.notDeepEqual(at(30), at(33)); // 13
  const still = (tick: number) => plan(chain(d => { find(d, 'n-jag').params.regenerationHz = 0; }), tick).layers[1].paths;
  assert.deepEqual(still(0), still(100));
});

test('disabled path nodes: generators empty, modifiers bypass, renderer drops its layer', () => {
  const line = linePath('p0', S, T, 2);
  const noJag = plan(chain(d => { find(d, 'n-jag').enabled = false; }));
  assert.deepEqual(noJag.layers[0].paths, [revealPath(line, 0.5)]);

  const noBranch = plan(chain(d => { find(d, 'n-branch').enabled = false; }), 30);
  assert.deepEqual(noBranch.layers[0].paths, [revealPath(jaggedPath(line, jagOpts(30)), 0.5)]);
  assert.deepEqual(noBranch.layers[1].paths, []);

  const noReveal = plan(chain(d => { find(d, 'n-reveal').enabled = false; }), 30);
  assert.deepEqual(noReveal.layers[0].paths, [jaggedPath(line, jagOpts(30))]);

  const noLine = plan(chain(d => { find(d, 'n-line').enabled = false; }));
  assert.deepEqual(noLine.layers.map(l => l.paths), [[], []]);

  const noRibbon = plan(chain(d => { find(d, 'n-rib0').enabled = false; }));
  assert.deepEqual(noRibbon.layers.map(l => l.nodeId), ['n-rib1']);
});

test('ribbon window gates visibility; document end empties everything', () => {
  const d = withRibbons([], [['n-line', 'paths']], [edge('e-w', 'node-schedule', 'window', 'n-rib0', 'window')]);
  assert.equal(plan(d, 59).layers[0].active, true);
  const off = plan(d, 60).layers[0];
  assert.deepEqual([off.active, off.paths, off.window], [false, [], { startTick: 0, endTick: 60 }]);
  const whole = withRibbons([], [['n-line', 'paths']]);
  assert.equal(plan(whole, 119).layers[0].active, true);
  assert.equal(plan(whole, 120).layers[0].active, false);
  find(d, 'node-schedule').enabled = false;
  assert.deepEqual([plan(d, 0).layers[0].window, plan(d, 0).layers[0].active], [null, false]);
});

test('root transform is applied once to points; width and tile length scale', () => {
  const s = Math.SQRT1_2;
  const d = withRibbons([], [['n-line', 'paths']]);
  d.rootTransform = { position: [1, 2, 3], rotation: [0, 0, s, s], scale: 2 };
  const l = plan(d).layers[0];
  const near = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `${a} vs ${b}`));
  near(l.paths[0].points[0], [-1, 2, 3]);
  near(l.paths[0].points[1], [-1, 2, 13]);
  assert.equal(l.width, 0.08);
  assert.equal(l.uvTileLength, 2);
});

test('semantic path IDs and geometry survive renames and Preserve-pattern copies; stream IDs change pattern', () => {
  const base = plan(chain(), 30);
  const renamed = chain(d => {
    const g = root(d);
    const map: Record<string, string> = { 'n-line': 'x-line', 'n-jag': 'x-jag', 'n-branch': 'x-branch', 'n-reveal': 'x-reveal' };
    for (const n of g.nodes) if (map[n.id]) n.id = map[n.id];
    for (const e of g.edges) {
      if (map[e.source.nodeId]) e.source.nodeId = map[e.source.nodeId];
      if (map[e.target.nodeId]) e.target.nodeId = map[e.target.nodeId];
    }
  });
  const r = compilePathPreview(renamed, 30);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  assert.deepEqual(r.value.layers.map(l => l.paths), base.layers.map(l => l.paths));

  // A Preserve-pattern copy inside the same document: new node IDs, same stream IDs, same geometry.
  const copy = chain(d => {
    const g = root(d);
    const clone = (id: string, type: string) => ({ ...node(`c${id}`, type, { ...find(d, id).params }), randomStreamId: find(d, id).randomStreamId });
    g.nodes.push(clone('n-line', 'LinePath'), clone('n-jag', 'JaggedPath'), clone('n-branch', 'BranchPath'), node('c-rib', 'RibbonRenderer'));
    g.edges.push(
      edge('c-ls', 'node-source', 'out', 'cn-line', 'start'), edge('c-le', 'node-target', 'out', 'cn-line', 'end'),
      edge('c-lj', 'cn-line', 'paths', 'cn-jag', 'paths'), edge('c-jb', 'cn-jag', 'paths', 'cn-branch', 'paths'),
      edge('c-rp', 'cn-branch', 'branches', 'c-rib', 'paths'), edge('c-rm', 'node-material', 'material', 'c-rib', 'material'),
      edge('c-ro', 'c-rib', 'visual', 'node-output', 'visual', 9),
    );
  });
  const cp = plan(copy, 30);
  assert.deepEqual(cp.layers[2].paths, cp.layers[1].paths);

  const repattern = plan(chain(d => { find(d, 'n-branch').randomStreamId = 'rs-other'; }), 30);
  assert.deepEqual(repattern.layers[1].paths.map(b => b.id), base.layers[1].paths.map(b => b.id));
  assert.notDeepEqual(repattern.layers[1].paths, base.layers[1].paths);
});

test('a shared path output feeds several ribbons without aliasing', () => {
  const p = plan(withRibbons([], [['n-line', 'paths'], ['n-line', 'paths']]));
  assert.deepEqual(p.layers[0].paths, p.layers[1].paths);
  p.layers[0].paths[0].points[0][0] = 99;
  assert.equal(p.layers[1].paths[0].points[0][0], 0);
});

test('invalid reachable settings return addressed errors', () => {
  const mat = errorsOf(compilePathPreview(chain(d => { find(d, 'node-material').enabled = false; }), 0));
  assert.ok(mat.some(e => e.nodeId === 'n-rib0' && e.code === 'MISSING_REFERENCE'));

  const anchor = errorsOf(compilePathPreview(chain(d => { find(d, 'node-target').enabled = false; }), 0));
  assert.ok(anchor.some(e => e.nodeId === 'n-line' && e.code === 'MISSING_REFERENCE'));

  const missing = errorsOf(compilePathPreview(chain(d => { find(d, 'node-target').params.anchorId = 'nowhere'; }), 0));
  assert.ok(missing.some(e => e.nodeId === 'node-target' && e.fieldPath?.endsWith('.params.anchorId')));

  const rd = withRibbons([], [['n-line', 'paths']], [edge('e-w', 'node-schedule', 'window', 'n-rib0', 'window')]);
  find(rd, 'node-schedule').params.mode = 'repeat';
  const repeat = errorsOf(compilePathPreview(rd, 0));
  assert.ok(repeat.some(e => e.nodeId === 'node-schedule' && e.code === 'INVALID_VALUE'));

  for (const bad of [-1, 1.5, Number.NaN]) {
    assert.equal(errorsOf(compilePathPreview(chain(), bad))[0].code, 'INVALID_VALUE');
  }
});

test('path budget rejects runaway branching before evaluating it', () => {
  const d = withRibbons(
    [node('n-b1', 'BranchPath', { count: 64, countMode: 'perParent' }), node('n-b2', 'BranchPath', { count: 64, countMode: 'perParent' })],
    [['n-b2', 'branches']],
    [edge('e-1', 'n-line', 'paths', 'n-b1', 'paths'), edge('e-2', 'n-b1', 'branches', 'n-b2', 'paths')],
  );
  const errs = errorsOf(compilePathPreview(d, 0));
  assert.ok(errs.some(e => e.code === 'BUDGET_EXCEEDED' && e.nodeId === 'n-b2'), JSON.stringify(errs));
  assert.ok(64 * 64 + 65 > MAX_PREVIEW_PATHS);
});

test('runtime RangeError becomes one addressed diagnostic even when two ribbons share the node', () => {
  // lengthMin > lengthMax passes per-parameter registry bounds but fails the runtime cross-field check.
  const errs = errorsOf(compilePathPreview(chain(d => { Object.assign(find(d, 'n-branch').params, { lengthMin: 3, lengthMax: 1 }); }), 0));
  const branch = errs.filter(e => e.nodeId === 'n-branch');
  assert.equal(branch.length, 1, JSON.stringify(errs));
  assert.equal(branch[0].code, 'INVALID_VALUE');
  assert.match(branch[0].fieldPath ?? '', /^graphs\[0\]\.nodes\[\d+\]$/);
  assert.equal(errs.length, 1, JSON.stringify(errs));
});

test('emitted world-space points are budgeted per ribbon, so fanout of a shared output cannot exceed the cap', () => {
  // line → 64 branches → jagged at 128 samples: 8192 evaluated points, well under budget once.
  const perRibbon = 64 * 128;
  const ribbons = Math.floor(MAX_PREVIEW_POINTS / perRibbon) + 1;
  const build = (n: number) => withRibbons(
    [node('n-b', 'BranchPath', { count: 64 }), node('n-jag', 'JaggedPath', { samples: 128 })],
    Array.from({ length: n }, (): [string, string] => ['n-jag', 'paths']),
    [edge('e-lb', 'n-line', 'paths', 'n-b', 'paths'), edge('e-bj', 'n-b', 'branches', 'n-jag', 'paths')],
  );
  const ok = plan(build(ribbons - 1));
  assert.equal(ok.layers[0].paths.reduce((s, p) => s + p.points.length, 0), perRibbon);
  const errs = errorsOf(compilePathPreview(build(ribbons), 0));
  assert.deepEqual(errs.map(e => [e.code, e.nodeId]), [['BUDGET_EXCEEDED', `n-rib${ribbons - 1}`]]);
  // Inactive layers emit nothing and so do not count.
  assert.equal(plan(build(ribbons), 120).layers.length, ribbons);
});
