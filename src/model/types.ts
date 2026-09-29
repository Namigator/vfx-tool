// v2 document contracts (docs/v2-plan/04-DOCUMENT-FORMAT.md, 25-INTERFACE-CONTRACTS.md).
// Pure data types: no DOM, React or Three dependencies. Saved files contain plain JSON only.

export const DOCUMENT_FORMAT = 'vfx-studio';
export const SCHEMA_VERSION = 2;
export const RUNTIME_VERSION = '2.0.0';
export const TICKS_PER_SECOND = 60;
export const MIN_DURATION_TICKS = 1;
export const MAX_DURATION_TICKS = 600;
/** 13-PERSISTENCE.md: JSON nesting depth limit. */
export const MAX_JSON_DEPTH = 32;
/** 13-PERSISTENCE.md: document JSON byte limit. */
export const MAX_JSON_BYTES = 5 * 1024 * 1024;
/** 04: IDs are 1–64 ASCII letters/digits/underscore/hyphen. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Stored limits (plan 15 and WP01-REPRESENTATION-DECISIONS.md). Declared here; enforcement is WP01b/WP02.
export const MAX_EXPANDED_NODES = 512;
export const MAX_EXPANDED_EDGES = 1024;
export const MAX_GROUP_DEPTH = 4;
export const MAX_ASSET_REFERENCES = 128;
export const MAX_GRAPHS = 128;
export const MAX_STORED_NODES = 512;
export const MAX_STORED_EDGES = 1024;
export const MAX_CONTROLS = 512;
export const MAX_ANCHORS = 128;
export const MAX_CONTROL_BINDINGS = 2048;
export const MAX_TAGS = 32;
export const MAX_INTERFACE_PORTS_PER_DIRECTION = 128;
/** Lengths below count Unicode code points; overlong values are rejected, never truncated. */
export const MAX_LABEL_CODE_POINTS = 128;
export const MAX_DESCRIPTION_CODE_POINTS = 4096;
export const MAX_TAG_CODE_POINTS = 64;
export const MAX_PATH_CODE_POINTS = 1024;
/** Standalone upper bound (seconds) for effectSeconds curve x when no document duration is supplied. */
export const MAX_EFFECT_SECONDS = MAX_DURATION_TICKS / TICKS_PER_SECOND;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** Quaternion stored xyzw. */
export type Quaternion = [number, number, number, number];
/** {srgb:"#RRGGBB", alpha:0..1}; converted to linear for shading/interpolation. */
export type ColorValue = { srgb: string; alpha: number };

export type CurveDomain = 'normalized' | 'effectSeconds';
export type CurveInterpolation = 'linear' | 'hold';
export type CurveKey = { x: number; y: number };
/** 2–16 ordered unique keys; values clamp beyond the key domain. */
export type CurveValue = { domain: CurveDomain; interpolation: CurveInterpolation; keys: CurveKey[] };
export type GradientStop = { position: number; color: ColorValue };
/** 2–8 stops, sorted unique positions in [0,1], endpoints 0 and 1 required. */
export type GradientValue = { stops: GradientStop[] };
/**
 * Structured registered settings. The plan does not fix a representation; this minimal form
 * names a registered record type and holds plain field values validated against its schema.
 */
export type RegisteredRecordValue = { recordType: string; fields: Record<string, ParameterValue> };

/** Asset IDs and enum choices are plain strings; the ParameterSpec type disambiguates. */
export type ParameterValue =
  | boolean | number | string
  | ColorValue | Vec2 | Vec3 | Quaternion
  | CurveValue | GradientValue | RegisteredRecordValue;

export type ValueType =
  | 'boolean' | 'number' | 'integer' | 'color' | 'vec2' | 'vec3' | 'quaternion'
  | 'enum' | 'string' | 'asset' | 'curve' | 'gradient' | 'registeredRecord';

export type Unit =
  | 'none' | 'meter' | 'second' | 'tick' | 'radian' | 'metersPerSecond'
  | 'metersPerSecondSquared' | 'hertz' | 'perSecond' | 'linearGain' | 'normalized';

export type EvaluationDomain = 'constant' | 'effectTime' | 'normalizedAge' | 'pathU';
export type EditPolicy = 'live' | 'resample';

/**
 * Connection vocabulary (WP01-REPRESENTATION-DECISIONS.md). Domain/unit compatibility and
 * driver precedence are compiler obligations; this list does not implement them.
 */
export type PortType =
  | 'event' | 'timeWindow' | 'anchor' | 'paths' | 'particles' | 'material'
  | 'visual' | 'audio' | 'presentation' | 'scalarSignal' | 'colorSignal'
  | 'vec2Signal' | 'vec3Signal' | 'quaternionSignal' | 'booleanSignal' | 'asset'
  | 'meshAsset' | 'textureAsset' | 'audioAsset'
  /** 05 Curve / Gradient value nodes feeding curve / gradient parameters (one curve can drive several nodes). */
  | 'curveValue' | 'gradientValue';

export type PortSpec = {
  id: string; label: string; type: PortType; unit?: Unit;
  domains?: EvaluationDomain[]; cardinality: 'one' | 'many';
  required: boolean; defaultValue?: ParameterValue;
};
export type InterfacePort = PortSpec & { direction: 'input' | 'output' };

export type ParameterSpec = {
  id: string; label: string; type: ValueType; unit: Unit;
  default: ParameterValue; min?: number; max?: number; step?: number;
  choices?: string[]; domains: EvaluationDomain[];
  editPolicy: EditPolicy; description: string;
  /** Only for type 'registeredRecord': the registered record type accepted. */
  recordType?: string;
  /** Only for type 'curve': the required curve domain. */
  curveDomain?: CurveDomain;
};

/** Opaque capability identifier; the capability vocabulary is defined with the renderer (WP later). */
export type CapabilityRequirement = string;

export type NodeSpec = {
  type: string; definitionVersion: number;
  inputs: PortSpec[]; outputs: PortSpec[]; parameters: ParameterSpec[];
  disabledBehavior: 'empty' | 'bypass' | 'fallback' | 'protected';
  /** Explicit primary passthrough for a disabled modifier. */
  bypass?: { input: string; output: string };
  capabilities: CapabilityRequirement[];
};

/** Schema for a registered record; fields reuse ParameterSpec (nested records allowed). */
export type RegisteredRecordSpec = { recordType: string; fields: ParameterSpec[] };

/** `axis` (0..2): a numeric control drives one component of a vec2/vec3 parameter; the other components keep their literal. */
export type ControlBinding = { nodeId: string; parameter: string; scale?: number; offset?: number; axis?: number };
export type PublicControl = {
  id: string; scopeGraphId: string; label: string; type: ValueType; unit: Unit;
  value: ParameterValue; default: ParameterValue;
  min?: number; max?: number; step?: number; choices?: string[];
  section: string; description: string; editPolicy: EditPolicy;
  /** Ordered. */
  bindings: ControlBinding[];
};

/** Position vec3, rotation quaternion xyzw, positive uniform scale. */
export type Transform = { position: Vec3; rotation: Quaternion; scale: number };
export type AnchorDefinition = { id: string; name: string; position: Vec3 };

export type AssetSource =
  | { kind: 'bundle'; path: string }
  | { kind: 'builtin'; builtinId: string; version: number };
export type AssetKind = 'texture' | 'flipbook' | 'mesh' | 'sound';
export type AssetColorSpace = 'color' | 'mask' | 'normal' | 'noise' | 'none';
/** kind/colorSpace match the enclosing reference; kind-specific fields are omitted for other kinds. */
export type AssetInterpretation = {
  kind: AssetKind;
  colorSpace: AssetColorSpace;
  /** cells: 'sequence' (default) plays the cells in order; 'variants' picks one cell per particle (included-library variant sets). */
  flipbook?: { rows: number; columns: number; frameCount: number; paddingPixels: number; cells?: 'sequence' | 'variants' };
  mesh?: { importScale: number };
};
/** sourceUrl is provenance text only, never permission to fetch. */
export type AssetProvenance = {
  origin: 'authored' | 'imported' | 'external';
  originalFilename: string;
  author?: string;
  sourceUrl?: string;
  modificationNotes: string;
};
export type AssetLicense = { identifier: string; text?: string };
export const UNSPECIFIED_LICENSE = 'user-provided; license unspecified';
/**
 * `id` is the interpretation ID: SHA-256 of canonical JSON {sha256, interpretation} (derived and
 * verified in WP05). `sha256` is the original-byte lowercase hex digest.
 */
export type AssetReference = {
  id: string;
  sha256: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  source: AssetSource;
  width?: number; height?: number; durationSeconds?: number;
  colorSpace: AssetColorSpace;
  interpretation: AssetInterpretation;
  provenance: AssetProvenance;
  license: AssetLicense;
};

export type NodeDefinition = {
  id: string; type: string; definitionVersion: number; label: string;
  enabled: boolean; randomStreamId: string;
  params: Record<string, ParameterValue>;
};
/** Per-connection mix settings (WP04-AUDIO-MIX-CONTRACT.md); only valid on edges into AudioMix "inputs". */
export type EdgeMixParams = { gain: number; pan: number };
export const DEFAULT_EDGE_MIX: Readonly<EdgeMixParams> = Object.freeze({ gain: 1, pan: 0 });
/** Closed, finite ranges; invalid values are rejected, never clamped. */
export const MIN_EDGE_MIX_GAIN = 0;
export const MAX_EDGE_MIX_GAIN = 2;
export const MIN_EDGE_MIX_PAN = -1;
export const MAX_EDGE_MIX_PAN = 1;
export const AUDIO_MIX_NODE_TYPE = 'AudioMix';
export const AUDIO_MIX_INPUT_PORT = 'inputs';

export type EdgeDefinition = {
  id: string;
  source: { nodeId: string; port: string };
  target: { nodeId: string; port: string };
  order: number;
  /** Absent = DEFAULT_EDGE_MIX. Present only when the target is AudioMix "inputs". */
  mix?: EdgeMixParams;
};
export type GraphDefinition = {
  id: string; inputs: InterfacePort[]; outputs: InterfacePort[];
  nodes: NodeDefinition[]; edges: EdgeDefinition[];
};

export type LayoutPoint = { x: number; y: number };
export type EditorLayout = {
  graphs: Record<string, { nodes: Record<string, LayoutPoint>; viewport: { x: number; y: number; zoom: number } }>;
  openedGraphId: string;
};

export type EffectDocumentV2 = {
  format: typeof DOCUMENT_FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  runtimeVersion: typeof RUNTIME_VERSION;
  id: string; name: string; tags: string[]; seed: number;
  rootTransform: Transform;
  anchors: AnchorDefinition[];
  durationTicks: number;
  rootGraphId: string;
  graphs: GraphDefinition[];
  controls: PublicControl[];
  assets: AssetReference[];
  editor: EditorLayout;
};

export type ErrorCode =
  | 'UNSUPPORTED_VERSION' | 'UNKNOWN_NODE' | 'INVALID_VALUE' | 'DUPLICATE_ID'
  | 'MISSING_REFERENCE' | 'MISSING_ASSET' | 'TYPE_MISMATCH' | 'DOMAIN_MISMATCH'
  | 'MULTIPLE_DRIVERS' | 'GRAPH_CYCLE' | 'GROUP_RECURSION' | 'BUDGET_EXCEEDED'
  | 'IMPORT_LIMIT' | 'CHECKSUM_MISMATCH' | 'STORAGE_CONFLICT' | 'STORAGE_QUOTA'
  | 'WORKER_FAILURE' | 'RENDERER_UNAVAILABLE';

export type Diagnostic = {
  code: ErrorCode;
  /** User-facing, actionable. */
  message: string;
  /** Exact field path, e.g. "graphs[0].nodes[2].params.rate". */
  fieldPath?: string;
  nodeId?: string;
  severity: 'error' | 'warning';
};

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: Diagnostic[] }
  | { ok: false; errors: Diagnostic[]; recoverableRaw?: unknown };
