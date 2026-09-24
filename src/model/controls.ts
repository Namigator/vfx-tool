// Pure public-control and parameter resolution (04 "Public controls and macro binding",
// 25 "Group control storage", WP01B-WORKER-CONTRACT.md). Precedence per parameter:
// connected value > bound control value > stored literal > registry default. Group nodes expose
// the controls scoped to their child graph as parameters keyed by control ID; the resolved Group
// parameter feeds that child control. Nothing is mutated, clamped or coerced; results are clones.
// Connection values are supplied already evaluated (WP02); no time signals are evaluated here.
import {
  MAX_GROUP_DEPTH,
  type Diagnostic, type EditPolicy, type EffectDocumentV2, type NodeDefinition, type NodeSpec,
  type ParameterSpec, type ParameterValue, type PublicControl, type ValidationResult,
} from './types.ts';
import { validateParameterValue, type RecordRegistry } from './values.ts';
import { pathKey } from './canonical.ts';
// Keep the resolver independent of whole-document validation (WP01b contract).
const GROUP_INPUT_NODE_TYPE = 'GroupInput';
const GROUP_OUTPUT_NODE_TYPE = 'GroupOutput';

export const GROUP_NODE_TYPE = 'Group';
/** Group.params key holding the structural child-graph reference; never a control ID. */
export const GROUP_GRAPH_PARAM = 'graphId';
/** GroupInput/GroupOutput.params key naming the bridged group port; structural, never driven. */
export const GROUP_PORT_PARAM = 'portId';

/** Structural parameters resolve only from their literal; bindings and connections are rejected. */
const isStructuralParam = (n: NodeDefinition, parameter: string) =>
  (n.type === GROUP_NODE_TYPE && parameter === GROUP_GRAPH_PARAM) ||
  ((n.type === GROUP_INPUT_NODE_TYPE || n.type === GROUP_OUTPUT_NODE_TYPE) && parameter === GROUP_PORT_PARAM);

export type ParameterSource =
  | { kind: 'connection' }
  | { kind: 'control'; controlId: string }
  /** Group exposed parameter taken from ResolveOptions.controlOverrides. */
  | { kind: 'controlOverride'; controlId: string }
  /** Stored literal; for Group exposed parameters the stored child-control value (controlId set). */
  | { kind: 'literal'; controlId?: string }
  | { kind: 'default' };

export type ResolvedParameter = {
  nodeId: string;
  graphId: string;
  parameter: string;
  value: ParameterValue;
  source: ParameterSource;
  /** True when a connection or control drives the field (UI shows it read-only with Jump to driver). */
  readOnly: boolean;
  /** Conservative: a control-driven field reports its driving control's inherited policy. */
  editPolicy: EditPolicy;
};

/** An already-evaluated value arriving at a parameter-driven input port. */
export type ParameterConnection = { nodeId: string; parameter: string; value: ParameterValue };

export type ResolveOptions = {
  records?: RecordRegistry;
  connections?: readonly ParameterConnection[];
  controlOverrides?: ReadonlyMap<string, ParameterValue>;
};

export const registryKey = (type: string, definitionVersion: number) => `${type}@${definitionVersion}`;

type NodeEntry = { node: NodeDefinition; graphId: string; path: string };
type BindingRef = { control: PublicControl; ci: number; bi: number; path: string };
type ConnectionRef = { value: ParameterValue; path: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumericType = (t: string) => t === 'number' || t === 'integer';
const targetKey = (nodeId: string, parameter: string) => `${nodeId}\u0000${parameter}`;
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const recordTypeOf = (v: unknown): string | undefined =>
  isPlainObject(v) && typeof v.recordType === 'string' ? v.recordType : undefined;

/** A control viewed as parameter metadata; recordType derives from the authored record value. */
function controlSpec(c: PublicControl, editPolicy: EditPolicy = c.editPolicy): ParameterSpec {
  const spec: ParameterSpec = {
    id: c.id, label: c.label, type: c.type, unit: c.unit, default: c.default,
    domains: ['constant'], editPolicy, description: c.description,
  };
  if (c.min !== undefined) spec.min = c.min;
  if (c.max !== undefined) spec.max = c.max;
  if (c.step !== undefined) spec.step = c.step;
  if (c.choices !== undefined) spec.choices = c.choices;
  const recordType = c.type === 'registeredRecord' ? recordTypeOf(c.value) : undefined;
  if (recordType !== undefined) spec.recordType = recordType;
  return spec;
}

export function resolveParameters(
  doc: EffectDocumentV2,
  registry: ReadonlyMap<string, NodeSpec>,
  options: ResolveOptions = {},
): ValidationResult<ResolvedParameter[]> {
  const records = options.records ?? new Map();
  const overrides = options.controlOverrides ?? new Map<string, ParameterValue>();
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const err = (code: Diagnostic['code'], message: string, fieldPath?: string, nodeId?: string) => {
    const d: Diagnostic = { code, message, severity: 'error' };
    if (fieldPath !== undefined) d.fieldPath = fieldPath;
    if (nodeId !== undefined) d.nodeId = nodeId;
    errors.push(d);
  };
  const valueContext = { durationTicks: doc.durationTicks };

  // Index graphs, nodes and controls.
  const graphIndex = new Map<string, number>();
  doc.graphs.forEach((g, gi) => {
    if (graphIndex.has(g.id)) err('DUPLICATE_ID', `Graph ID "${g.id}" is used more than once.`, `graphs[${gi}].id`);
    else graphIndex.set(g.id, gi);
  });
  const nodes = new Map<string, NodeEntry>();
  doc.graphs.forEach((g, gi) => g.nodes.forEach((n, ni) => {
    const path = `graphs[${gi}].nodes[${ni}]`;
    if (nodes.has(n.id)) err('DUPLICATE_ID', `Node ID "${n.id}" is used more than once.`, `${path}.id`, n.id);
    else nodes.set(n.id, { node: n, graphId: g.id, path });
  }));
  const controls = new Map<string, { control: PublicControl; ci: number }>();
  const controlsByScope = new Map<string, PublicControl[]>();
  doc.controls.forEach((c, ci) => {
    const path = `controls[${ci}]`;
    if (controls.has(c.id)) { err('DUPLICATE_ID', `Control ID "${c.id}" is used more than once.`, `${path}.id`); return; }
    controls.set(c.id, { control: c, ci });
    if (c.id === GROUP_GRAPH_PARAM) err('INVALID_VALUE', `Control ID "${GROUP_GRAPH_PARAM}" is reserved for the Group graph reference.`, `${path}.id`);
    if (!graphIndex.has(c.scopeGraphId)) err('MISSING_REFERENCE', `Control scope graph "${c.scopeGraphId}" does not exist.`, `${path}.scopeGraphId`);
    const list = controlsByScope.get(c.scopeGraphId) ?? [];
    list.push(c);
    controlsByScope.set(c.scopeGraphId, list);
    errors.push(...validateParameterValue(c.value, controlSpec(c), `${path}.value`, records, valueContext));
    if (c.type === 'registeredRecord' && recordTypeOf(c.value) === undefined) {
      err('TYPE_MISMATCH', 'Registered-record control value must name its recordType.', `${path}.value`);
    }
  });
  for (const [id, value] of overrides) {
    const entry = controls.get(id);
    const path = pathKey('options.controlOverrides', id);
    if (!entry) { err('MISSING_REFERENCE', `Override targets unknown control "${id}".`, path); continue; }
    errors.push(...validateParameterValue(value, controlSpec(entry.control), path, records, valueContext));
  }

  // Group instantiation: every child graph has exactly one instantiating Group node, no recursion.
  const groupGraphOf = (n: NodeDefinition): unknown => n.params[GROUP_GRAPH_PARAM];
  const instantiator = new Map<string, string>(); // graphId -> Group nodeId ('' for root)
  const graphOrder: string[] = [];
  if (!graphIndex.has(doc.rootGraphId)) {
    err('MISSING_REFERENCE', `Root graph "${doc.rootGraphId}" does not exist.`, 'rootGraphId');
    return { ok: false, errors };
  }
  const walk = (graphId: string, stack: string[]) => {
    graphOrder.push(graphId);
    const gi = graphIndex.get(graphId) as number;
    doc.graphs[gi].nodes.forEach((n, ni) => {
      if (n.type !== GROUP_NODE_TYPE) return;
      const path = `graphs[${gi}].nodes[${ni}].params`;
      const extra = Object.keys(n.params).filter(k => k !== GROUP_GRAPH_PARAM);
      if (extra.length) err('INVALID_VALUE', `Group params store only "${GROUP_GRAPH_PARAM}"; exposed values live in controls.`, pathKey(path, extra[0]), n.id);
      const child = groupGraphOf(n);
      const cp = pathKey(path, GROUP_GRAPH_PARAM);
      if (typeof child !== 'string' || !graphIndex.has(child)) {
        err('MISSING_REFERENCE', 'Group references a graph that does not exist.', cp, n.id);
        return;
      }
      if (stack.includes(child)) { err('GROUP_RECURSION', `Group recursively instantiates graph "${child}".`, cp, n.id); return; }
      if (instantiator.has(child)) {
        err('INVALID_VALUE', `Graph "${child}" is instantiated more than once; group instances must be independent copies.`, cp, n.id);
        return;
      }
      if (stack.length > MAX_GROUP_DEPTH) { err('BUDGET_EXCEEDED', `Group nesting exceeds depth ${MAX_GROUP_DEPTH}.`, cp, n.id); return; }
      instantiator.set(child, n.id);
      walk(child, [...stack, child]);
    });
  };
  instantiator.set(doc.rootGraphId, '');
  walk(doc.rootGraphId, [doc.rootGraphId]);
  for (const g of doc.graphs) {
    if (!instantiator.has(g.id)) warnings.push({ code: 'MISSING_REFERENCE', message: `Graph "${g.id}" is not instantiated and is not resolved.`, severity: 'warning' });
  }

  // Parameter metadata per node. Group nodes expose their child graph's controls.
  const specCache = new Map<string, ParameterSpec[] | null>();
  const paramSpecs = (entry: NodeEntry): ParameterSpec[] | null => {
    const n = entry.node;
    if (specCache.has(n.id)) return specCache.get(n.id) as ParameterSpec[] | null;
    let specs: ParameterSpec[] | null;
    if (n.type === GROUP_NODE_TYPE) {
      const child = groupGraphOf(n);
      specs = typeof child === 'string' && graphIndex.has(child)
        ? (controlsByScope.get(child) ?? []).filter(c => c.id !== GROUP_GRAPH_PARAM).map(c => controlSpec(c, effectivePolicy(c.id)))
        : null;
    } else {
      specs = registry.get(registryKey(n.type, n.definitionVersion))?.parameters ?? null;
    }
    specCache.set(n.id, specs);
    return specs;
  };

  // Inherited live/resample policy: any resample target (transitively through groups) makes the
  // driving control resample. Guarded against cycles; metadata is not mutated.
  const policyMemo = new Map<string, EditPolicy>();
  function effectivePolicy(controlId: string, visiting: Set<string> = new Set()): EditPolicy {
    const memo = policyMemo.get(controlId);
    if (memo) return memo;
    const c = controls.get(controlId)?.control;
    if (!c) return 'resample';
    if (visiting.has(controlId)) return 'resample';
    visiting.add(controlId);
    let policy: EditPolicy = c.editPolicy;
    for (const b of c.bindings) {
      if (policy === 'resample') break;
      const t = nodes.get(b.nodeId);
      if (!t) continue;
      if (t.node.type === GROUP_NODE_TYPE) {
        const child = groupGraphOf(t.node);
        const cc = controls.get(b.parameter)?.control;
        if (cc && cc.scopeGraphId === child && effectivePolicy(cc.id, visiting) === 'resample') policy = 'resample';
      } else {
        const p = registry.get(registryKey(t.node.type, t.node.definitionVersion))?.parameters.find(s => s.id === b.parameter);
        if (p?.editPolicy === 'resample') policy = 'resample';
      }
    }
    visiting.delete(controlId);
    policyMemo.set(controlId, policy);
    return policy;
  }

  // Unknown node types are diagnosed once.
  for (const entry of nodes.values()) {
    if (entry.node.type !== GROUP_NODE_TYPE && paramSpecs(entry) === null) {
      err('UNKNOWN_NODE', `Node type "${entry.node.type}" version ${entry.node.definitionVersion} is not registered.`, entry.path, entry.node.id);
    }
  }

  // Bindings: scope, target, type, unit and affine checks; ownership index.
  const owners = new Map<string, BindingRef[]>();
  doc.controls.forEach((c, ci) => c.bindings.forEach((b, bi) => {
    const path = `controls[${ci}].bindings[${bi}]`;
    const ref: BindingRef = { control: c, ci, bi, path };
    const key = targetKey(b.nodeId, b.parameter);
    const list = owners.get(key) ?? [];
    list.push(ref);
    owners.set(key, list);
    const target = nodes.get(b.nodeId);
    if (!target) { err('MISSING_REFERENCE', `Binding targets unknown node "${b.nodeId}".`, `${path}.nodeId`); return; }
    if (target.graphId !== c.scopeGraphId) {
      err('INVALID_VALUE', `Control "${c.id}" may bind only nodes in its scope graph "${c.scopeGraphId}".`, `${path}.nodeId`, b.nodeId);
      return;
    }
    if (isStructuralParam(target.node, b.parameter)) {
      err('INVALID_VALUE', `"${b.parameter}" is a structural ${target.node.type} parameter and cannot be bound.`, `${path}.parameter`, b.nodeId);
      return;
    }
    const specs = paramSpecs(target);
    if (!specs) return; // UNKNOWN_NODE already reported.
    const spec = specs.find(s => s.id === b.parameter);
    if (!spec) { err('MISSING_REFERENCE', `Node "${b.nodeId}" has no parameter "${b.parameter}".`, `${path}.parameter`, b.nodeId); return; }
    const numeric = isNumericType(c.type) && isNumericType(spec.type);
    if (!numeric && c.type !== spec.type) {
      err('TYPE_MISMATCH', `Control type "${c.type}" cannot drive "${spec.type}" parameter "${b.parameter}".`, path, b.nodeId);
    }
    if (c.unit !== spec.unit) {
      err('TYPE_MISMATCH', `Control unit "${c.unit}" is incompatible with parameter unit "${spec.unit}".`, path, b.nodeId);
    }
    for (const k of ['scale', 'offset'] as const) {
      if (b[k] === undefined) continue;
      if (!isNumericType(c.type)) err('INVALID_VALUE', `Only numeric controls support affine ${k}.`, `${path}.${k}`, b.nodeId);
      else if (typeof b[k] !== 'number' || !Number.isFinite(b[k])) err('INVALID_VALUE', `Binding ${k} must be a finite number.`, `${path}.${k}`, b.nodeId);
    }
  }));
  for (const list of owners.values()) {
    if (list.length < 2) continue;
    const ids = list.map(r => r.control.id).join(', ');
    for (const r of list.slice(1)) err('MULTIPLE_DRIVERS', `Parameter has multiple control owners (${ids}).`, r.path, list[0].control.bindings[list[0].bi].nodeId);
  }

  // Connections: references and duplicate drivers.
  const connections = new Map<string, ConnectionRef>();
  (options.connections ?? []).forEach((c, i) => {
    const path = `options.connections[${i}]`;
    const target = nodes.get(c.nodeId);
    if (!target) { err('MISSING_REFERENCE', `Connection targets unknown node "${c.nodeId}".`, `${path}.nodeId`); return; }
    if (isStructuralParam(target.node, c.parameter)) {
      err('INVALID_VALUE', `"${c.parameter}" is a structural ${target.node.type} parameter and cannot be connected.`, `${path}.parameter`, c.nodeId);
      return;
    }
    const specs = paramSpecs(target);
    if (specs && !specs.some(s => s.id === c.parameter)) {
      err('MISSING_REFERENCE', `Node "${c.nodeId}" has no parameter "${c.parameter}".`, `${path}.parameter`, c.nodeId);
      return;
    }
    const key = targetKey(c.nodeId, c.parameter);
    if (connections.has(key)) { err('MULTIPLE_DRIVERS', `Parameter "${c.parameter}" has more than one connection.`, path, c.nodeId); return; }
    connections.set(key, { value: c.value, path });
  });

  // Resolve top-down so a Group's resolved exposed parameter feeds its child controls.
  const controlValue = new Map<string, ParameterValue>();
  for (const [id, { control }] of controls) {
    if (control.scopeGraphId === doc.rootGraphId) controlValue.set(id, overrides.has(id) ? overrides.get(id) as ParameterValue : control.value);
  }
  const results: ResolvedParameter[] = [];
  for (const graphId of graphOrder) {
    const gi = graphIndex.get(graphId) as number;
    doc.graphs[gi].nodes.forEach((n, ni) => {
      const entry = nodes.get(n.id);
      if (!entry || entry.node !== n) return;
      const specs = paramSpecs(entry);
      if (!specs) return;
      const isGroup = n.type === GROUP_NODE_TYPE;
      for (const spec of specs) {
        const key = targetKey(n.id, spec.id);
        const path = pathKey(`graphs[${gi}].nodes[${ni}].params`, spec.id);
        let value: ParameterValue;
        let source: ParameterSource;
        const conn = connections.get(key);
        const owner = owners.get(key)?.[0];
        if (conn) {
          value = conn.value;
          source = { kind: 'connection' };
        } else if (owner && controlValue.has(owner.control.id)) {
          const v = controlValue.get(owner.control.id) as ParameterValue;
          const b = owner.control.bindings[owner.bi];
          value = typeof v === 'number' && isNumericType(owner.control.type) ? v * (b.scale ?? 1) + (b.offset ?? 0) : v;
          source = { kind: 'control', controlId: owner.control.id };
        } else if (isGroup && overrides.has(spec.id)) {
          value = overrides.get(spec.id) as ParameterValue;
          source = { kind: 'controlOverride', controlId: spec.id };
        } else if (isGroup) {
          value = (controls.get(spec.id) as { control: PublicControl }).control.value;
          source = { kind: 'literal', controlId: spec.id };
        } else if (Object.prototype.hasOwnProperty.call(n.params, spec.id)) {
          value = n.params[spec.id];
          source = { kind: 'literal' };
        } else {
          value = spec.default;
          source = { kind: 'default' };
        }
        errors.push(...validateParameterValue(value, spec, conn ? conn.path : path, records, valueContext).map(d => ({ ...d, nodeId: n.id })));
        if (isGroup) controlValue.set(spec.id, value);
        results.push({
          nodeId: n.id, graphId, parameter: spec.id,
          value: structuredClone(value),
          source,
          readOnly: source.kind === 'connection' || source.kind === 'control',
          editPolicy: source.kind === 'control' ? effectivePolicy(source.controlId) : spec.editPolicy,
        });
      }
    });
  }

  if (errors.length) return { ok: false, errors };
  results.sort((a, b) => byCodeUnit(a.nodeId, b.nodeId) || byCodeUnit(a.parameter, b.parameter));
  return { ok: true, value: results, warnings };
}
