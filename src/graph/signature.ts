// Concrete per-instance node signatures (06 "Typed connections", 25 "Group control storage",
// WP02A-WORKER-CONTRACT.md). Pure: no DOM, React or Three. Inputs are never mutated; every returned
// PortSpec/ParameterSpec is a clone.
//
// - Ordinary nodes: registered ports plus one optional, cardinality-one input per parameter whose value
//   type maps to a signal/asset port (unit, domains and defaultValue copied from the ParameterSpec;
//   domains only for signal ports). Every concrete signal port must declare nonempty domains.
//   An explicit registered input with the same ID is kept, but must match that metadata exactly.
// - Group: child graph interface plus one input per child-scoped control whose type maps to a port.
//   Group.params stores only graphId; exposed control values stay in the controls list.
// - GroupInput/GroupOutput: stable ports `out`/`in` typed from the interface port named by portId.
//
// Not implemented in this slice: Constant and PublicParameter specialization. They are absent from the
// production registry; their output type depends on a per-instance literal/control schema that needs a
// separate document/resolver design, so they are rejected here instead of receiving placeholder ports.
import type {
  Diagnostic, EffectDocumentV2, EvaluationDomain, GraphDefinition, InterfacePort, NodeDefinition,
  NodeSpec, ParameterSpec, PortSpec, PortType, Unit, ValidationResult, ValueType,
} from '../model/types.ts';

export type ResolvedSignature = {
  nodeId: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  parameters: ParameterSpec[];
  disabledBehavior: NodeSpec['disabledBehavior'];
  bypass?: { input: string; output: string };
};

export type SignatureContext = { doc: EffectDocumentV2; graphId: string };

export const GROUP_NODE_TYPE = 'Group';
export const GROUP_INPUT_NODE_TYPE = 'GroupInput';
export const GROUP_OUTPUT_NODE_TYPE = 'GroupOutput';
export const GROUP_GRAPH_PARAM = 'graphId';
export const BRIDGE_PORT_PARAM = 'portId';
/** Stable bridge port IDs: GroupInput emits on `out`, GroupOutput receives on `in`. */
export const GROUP_INPUT_PORT = 'out';
export const GROUP_OUTPUT_PORT = 'in';
/** Dynamic literal nodes whose specialization is deliberately not implemented yet. */
const UNSPECIALIZED_TYPES = ['Constant', 'PublicParameter'];

const VALUE_PORT: Partial<Record<ValueType, PortType>> = {
  number: 'scalarSignal', integer: 'scalarSignal', boolean: 'booleanSignal', color: 'colorSignal',
  vec2: 'vec2Signal', vec3: 'vec3Signal', quaternion: 'quaternionSignal',
  // Legacy generic asset port; never implicitly converted to meshAsset/textureAsset/audioAsset.
  asset: 'asset',
};

/** Port type carrying a value type, or undefined (enum/string/curve/gradient/registeredRecord). */
export function valueTypeToPortType(type: ValueType): PortType | undefined {
  return Object.hasOwn(VALUE_PORT, type) ? VALUE_PORT[type] : undefined;
}

const isSignal = (t: PortType) => t.endsWith('Signal');
const unitOf = (p: PortSpec): Unit => p.unit ?? 'none';

/** Structural parameters are identifiers, never ports. */
function isStructural(nodeType: string, parameter: string): boolean {
  if (nodeType === GROUP_NODE_TYPE) return parameter === GROUP_GRAPH_PARAM;
  if (nodeType === GROUP_INPUT_NODE_TYPE || nodeType === GROUP_OUTPUT_NODE_TYPE) return parameter === BRIDGE_PORT_PARAM;
  return nodeType === 'Anchor' && parameter === 'anchorId';
}

/**
 * Edge/passthrough compatibility: exact type, exact unit (missing = none), and source domains a subset of
 * target domains, except `constant`, which always promotes to any allowed target domain. Signal ports must
 * declare nonempty domains on both ends.
 */
export function checkPortCompatibility(source: PortSpec, target: PortSpec, fieldPath: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const e = (code: Diagnostic['code'], message: string) => out.push({ code, message, fieldPath, severity: 'error' });
  if (source.type !== target.type) {
    e('TYPE_MISMATCH', `Cannot connect ${source.type} "${source.id}" to ${target.type} "${target.id}"; types must match exactly.`);
    return out;
  }
  if (unitOf(source) !== unitOf(target)) {
    e('TYPE_MISMATCH', `Unit ${unitOf(source)} of "${source.id}" does not match unit ${unitOf(target)} of "${target.id}"; add an explicit conversion.`);
  }
  const sd = source.domains, td = target.domains;
  if (isSignal(target.type) && (!sd?.length || !td?.length)) {
    e('DOMAIN_MISMATCH', `Signal ports "${source.id}" and "${target.id}" must both declare evaluation domains.`);
    return out;
  }
  if (sd && td) {
    const bad = sd.filter(d => d !== 'constant' && !td.includes(d));
    if (bad.length) e('DOMAIN_MISMATCH', `"${target.id}" does not accept ${bad.join(', ')} signals from "${source.id}" (allowed: ${td.join(', ')}).`);
  } else if (sd?.length !== td?.length && (sd?.length || td?.length)) {
    e('DOMAIN_MISMATCH', `Only one of "${source.id}" and "${target.id}" declares evaluation domains.`);
  }
  return out;
}

const clonePort = (p: PortSpec): PortSpec => structuredClone(p);
const sameDomains = (a: readonly EvaluationDomain[] | undefined, b: readonly EvaluationDomain[]) =>
  a !== undefined && a.length === b.length && b.every(d => a.includes(d));

function fromInterface(p: InterfacePort, id: string): PortSpec {
  const { direction: _direction, ...rest } = structuredClone(p);
  return { ...rest, id };
}

export function resolveSignature(node: NodeDefinition, spec: NodeSpec, context: SignatureContext): ValidationResult<ResolvedSignature> {
  const errors: Diagnostic[] = [];
  const gi = context.doc.graphs.findIndex(g => g.id === context.graphId);
  const graph: GraphDefinition | undefined = context.doc.graphs[gi];
  const ni = graph ? graph.nodes.findIndex(n => n.id === node.id) : -1;
  const np = ni >= 0 ? `graphs[${gi}].nodes[${ni}]` : `graphs[${gi}]`;
  const err = (code: Diagnostic['code'], fieldPath: string, message: string) =>
    errors.push({ code, message, fieldPath, nodeId: node.id, severity: 'error' });
  const fail = (): ValidationResult<ResolvedSignature> => ({ ok: false, errors });

  if (!graph) { err('MISSING_REFERENCE', 'rootGraphId', `Graph "${context.graphId}" does not exist.`); return fail(); }
  if (ni < 0) { err('MISSING_REFERENCE', `graphs[${gi}].nodes`, `Node "${node.id}" is not in graph "${graph.id}".`); return fail(); }
  if (node.type !== spec.type) { err('UNKNOWN_NODE', `${np}.type`, `Node type "${node.type}" does not match registry entry "${spec.type}".`); return fail(); }
  if (node.definitionVersion !== spec.definitionVersion) {
    err('UNSUPPORTED_VERSION', `${np}.definitionVersion`, `Node "${node.type}" version ${node.definitionVersion} does not match registered version ${spec.definitionVersion}.`);
    return fail();
  }
  if (UNSPECIALIZED_TYPES.includes(node.type)) {
    err('UNKNOWN_NODE', `${np}.type`, `"${node.type}" nodes are not supported yet: their typed ports need a separate specialization design.`);
    return fail();
  }
  if (spec.disabledBehavior === 'protected' && !node.enabled) {
    err('INVALID_VALUE', `${np}.enabled`, `"${node.type}" nodes cannot be disabled; enable this node.`);
  }

  const inputs = spec.inputs.map(clonePort);
  const outputs = spec.outputs.map(clonePort);
  const parameters = spec.parameters.map(p => structuredClone(p));
  // Field path of each generated port, for domain diagnostics; registered ports fall back to `${np}.type`.
  const origin = new Map<PortSpec, string>();
  const addUnique = (list: PortSpec[], port: PortSpec, fieldPath: string, what: string) => {
    if (list.some(p => p.id === port.id)) err('DUPLICATE_ID', fieldPath, `Port "${port.id}" is ambiguous: ${what} collides with another port of this node.`);
    else { list.push(port); origin.set(port, fieldPath); }
  };

  if (node.type === GROUP_NODE_TYPE) {
    const childId = node.params[GROUP_GRAPH_PARAM];
    const child = typeof childId === 'string' ? context.doc.graphs.find(g => g.id === childId) : undefined;
    if (!child) err('MISSING_REFERENCE', `${np}.params.${GROUP_GRAPH_PARAM}`, `Group graph "${String(childId)}" does not exist.`);
    else {
      const ci = context.doc.graphs.indexOf(child);
      child.inputs.forEach((p, i) => addUnique(inputs, fromInterface(p, p.id), `graphs[${ci}].inputs[${i}].id`, 'interface input'));
      child.outputs.forEach((p, i) => addUnique(outputs, fromInterface(p, p.id), `graphs[${ci}].outputs[${i}].id`, 'interface output'));
      context.doc.controls.forEach((c, i) => {
        if (c.scopeGraphId !== child.id) return;
        const type = valueTypeToPortType(c.type);
        if (!type) return; // Inspector-editable only; no connection port.
        // Only signal ports carry evaluation domains; asset controls stay domain-less.
        addUnique(inputs, {
          id: c.id, label: c.label, type, unit: c.unit, ...(isSignal(type) ? { domains: ['constant'] as EvaluationDomain[] } : {}),
          cardinality: 'one', required: false, defaultValue: structuredClone(c.value),
        }, `controls[${i}].id`, 'exposed control');
      });
    }
  } else if (node.type === GROUP_INPUT_NODE_TYPE || node.type === GROUP_OUTPUT_NODE_TYPE) {
    const isInput = node.type === GROUP_INPUT_NODE_TYPE;
    const portId = node.params[BRIDGE_PORT_PARAM];
    const own = isInput ? graph.inputs : graph.outputs;
    const other = isInput ? graph.outputs : graph.inputs;
    const ref = own.find(p => p.id === portId);
    const fp = `${np}.params.${BRIDGE_PORT_PARAM}`;
    const dir = isInput ? 'input' : 'output';
    if (!ref) {
      const wrong = other.some(p => p.id === portId);
      err('MISSING_REFERENCE', fp, wrong
        ? `Interface port "${String(portId)}" is an ${isInput ? 'output' : 'input'}; ${node.type} must reference an ${dir} port.`
        : `This graph has no ${dir} interface port "${String(portId)}".`);
    } else if (ref.direction !== dir) {
      err('MISSING_REFERENCE', fp, `Interface port "${ref.id}" has direction "${ref.direction}"; expected "${dir}".`);
    } else if (isInput) {
      addUnique(outputs, { ...fromInterface(ref, GROUP_INPUT_PORT), required: false }, fp, 'bridge port');
    } else {
      addUnique(inputs, fromInterface(ref, GROUP_OUTPUT_PORT), fp, 'bridge port');
    }
  } else {
    for (const p of spec.parameters) {
      if (isStructural(node.type, p.id)) continue;
      const type = valueTypeToPortType(p.type);
      if (!type) continue;
      const fp = `${np}.params.${p.id}`;
      const explicit = inputs.find(i => i.id === p.id);
      if (explicit) {
        const domainsOk = isSignal(type) ? sameDomains(explicit.domains, p.domains) : !explicit.domains?.length;
        if (explicit.type !== type || unitOf(explicit) !== p.unit || !domainsOk) {
          err('TYPE_MISMATCH', fp, `Registered input "${p.id}" of "${node.type}" disagrees with its parameter's type, unit or domains.`);
        }
        continue;
      }
      const generated: PortSpec = {
        id: p.id, label: p.label, type, unit: p.unit, ...(isSignal(type) ? { domains: [...p.domains] } : {}),
        cardinality: 'one', required: false, defaultValue: structuredClone(p.default),
      };
      inputs.push(generated);
      origin.set(generated, fp);
    }
  }

  // Every concrete signal port must declare nonempty domains, connected or not.
  for (const [list, kind] of [[inputs, 'input'], [outputs, 'output']] as const) {
    for (const p of list) {
      if (isSignal(p.type) && !p.domains?.length) {
        err('DOMAIN_MISMATCH', origin.get(p) ?? `${np}.type`, `Signal ${kind} "${p.id}" of "${node.type}" must declare at least one evaluation domain.`);
      }
    }
  }

  let bypass: ResolvedSignature['bypass'];
  const bp = `${np}.type`;
  if (spec.disabledBehavior === 'bypass') {
    if (!spec.bypass) err('INVALID_VALUE', bp, `"${node.type}" declares bypass but no passthrough input/output mapping.`);
    else {
      const i = spec.inputs.find(p => p.id === spec.bypass!.input);
      const o = spec.outputs.find(p => p.id === spec.bypass!.output);
      if (!i) err('MISSING_REFERENCE', bp, `Bypass input "${spec.bypass.input}" is not a registered input of "${node.type}".`);
      if (!o) err('MISSING_REFERENCE', bp, `Bypass output "${spec.bypass.output}" is not a registered output of "${node.type}".`);
      if (i && o) {
        const d = checkPortCompatibility(i, o, bp);
        for (const x of d) errors.push({ ...x, nodeId: node.id });
        if (!d.length) bypass = { input: i.id, output: o.id };
      }
    }
  } else if (spec.bypass) {
    err('INVALID_VALUE', bp, `"${node.type}" has a bypass mapping but its disabled behavior is "${spec.disabledBehavior}".`);
  }

  if (errors.length) return fail();
  const value: ResolvedSignature = { nodeId: node.id, inputs, outputs, parameters, disabledBehavior: spec.disabledBehavior };
  if (bypass) value.bypass = bypass;
  return { ok: true, value, warnings: [] };
}
