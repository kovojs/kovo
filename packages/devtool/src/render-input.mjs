import {
  arrayAppend,
  arrayLength,
  arrayValue,
  assertPlainCarrier,
  createMap,
  defineOwnData,
  freeze,
  isArray,
  isSafeInteger,
  mapHas,
  mapSet,
  regexpTest,
  stableOwnData,
} from './output-security.mjs';
import { snapshotDiagnostic } from './diagnostics.mjs';

const NODE_KINDS = freeze([
  'agent',
  'tool',
  'task',
  'mutation',
  'domain',
  'query',
  'component',
  'handler',
  'trigger',
  'derive',
  'binding-position',
  'page',
  'diagnostic',
]);
const EDGE_KINDS = freeze([
  'uses',
  'invokes',
  'dispatches',
  'reads',
  'schedules',
  'writes',
  'backs',
  'feeds',
  'emits',
  'renders',
  'handles',
  'triggers',
  'derives',
  'owns',
  'updates',
]);
const OPTIMISTIC_STATUSES = freeze(['UNHANDLED', 'derived', 'hand-written', 'await-fragment']);
const DERIVATION_STATUSES = freeze(['derived', 'PUNTED']);
const MAX_MANIFEST_ENTRIES = 256;
const MAX_GRAPH_NODES = 50_000;
const MAX_GRAPH_EDGES = 200_000;
const MAX_LIST_ENTRIES = 50_000;
const MAX_TEXT_LENGTH = 1_048_576;
const MAX_SOURCE_LENGTH = 2_097_152;
const MAX_RUNTIME_FRAMES = 8;
const MAX_RUNTIME_FACTS = 64;
const MAX_RUNTIME_BODY_BYTES = 512 * 1024;
const MAX_RUNTIME_NAME_LENGTH = 256;
const RUNTIME_GRAPH_NAME = /^[A-Za-z0-9_./:@-]+$/u;

function required(record, key, label) {
  const entry = stableOwnData(record, key, label);
  if (!entry.found) throw new TypeError(`${label}.${key} is required.`);
  return entry.value;
}

function optional(record, key, label) {
  return stableOwnData(record, key, label).value;
}

function text(value, label, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
  if (value.length > maxLength) throw new TypeError(`${label} exceeds the devtool text budget.`);
  return value;
}

function optionalText(value, label, fallback = '') {
  return value === undefined ? fallback : text(value, label);
}

function enumText(value, values, label) {
  const candidate = text(value, label);
  for (let index = 0; index < arrayLength(values, `${label} vocabulary`); index += 1) {
    if (candidate === arrayValue(values, index, `${label} vocabulary`)) return candidate;
  }
  throw new TypeError(`${label} is not supported.`);
}

function list(value, label, maxLength, snapshot) {
  if (!isArray(value)) throw new TypeError(`${label} must be an array.`);
  const length = arrayLength(value, label);
  if (length > maxLength) throw new TypeError(`${label} exceeds the devtool collection budget.`);
  const output = [];
  for (let index = 0; index < length; index += 1) {
    arrayAppend(output, snapshot(arrayValue(value, index, label), `${label}[${index}]`), label);
  }
  return freeze(output);
}

function stringList(value, label, fallback = freeze([])) {
  if (value === undefined) return fallback;
  return list(value, label, MAX_LIST_ENTRIES, text);
}

function snapshotManifest(value) {
  const ids = createMap();
  const manifest = list(
    value,
    'renderPage options.manifest',
    MAX_MANIFEST_ENTRIES,
    (entry, label) => {
      const record = assertPlainCarrier(entry, label);
      const id = text(required(record, 'id', label), `${label}.id`);
      if (mapHas(ids, id))
        throw new TypeError(`renderPage manifest contains duplicate app id ${id}.`);
      mapSet(ids, id, true);
      return freeze({
        blurb: optionalText(optional(record, 'blurb', label), `${label}.blurb`),
        id,
        label: text(required(record, 'label', label), `${label}.label`),
      });
    },
  );
  if (arrayLength(manifest, 'renderPage manifest') === 0) {
    throw new TypeError('renderPage options.manifest must not be empty.');
  }
  return { ids, manifest };
}

function snapshotMutationForm(value, label) {
  const record = assertPlainCarrier(value, label);
  return freeze({
    fields: stringList(optional(record, 'fields', label), `${label}.fields`),
    mutation: text(required(record, 'mutation', label), `${label}.mutation`),
  });
}

function snapshotReason(value, label) {
  const record = assertPlainCarrier(value, label);
  const reason = {
    code: text(required(record, 'code', label), `${label}.code`),
    column: optionalText(optional(record, 'column', label), `${label}.column`),
    columns: stringList(optional(record, 'columns', label), `${label}.columns`),
    detail: optionalText(optional(record, 'detail', label), `${label}.detail`),
    expr: optionalText(optional(record, 'expr', label), `${label}.expr`),
    field: optionalText(optional(record, 'field', label), `${label}.field`),
    shape: optionalText(optional(record, 'shape', label), `${label}.shape`),
    site: optionalText(optional(record, 'site', label), `${label}.site`),
    table: optionalText(optional(record, 'table', label), `${label}.table`),
  };
  return freeze(reason);
}

function snapshotDerivation(value, label) {
  if (value === undefined) return undefined;
  const record = assertPlainCarrier(value, label);
  const reasonValue = optional(record, 'reason', label);
  return freeze({
    reason: reasonValue === undefined ? undefined : snapshotReason(reasonValue, `${label}.reason`),
    status: enumText(required(record, 'status', label), DERIVATION_STATUSES, `${label}.status`),
  });
}

function snapshotOptimistic(value, label) {
  const record = assertPlainCarrier(value, label);
  return freeze({
    derivation: snapshotDerivation(optional(record, 'derivation', label), `${label}.derivation`),
    query: text(required(record, 'query', label), `${label}.query`),
    status: enumText(required(record, 'status', label), OPTIMISTIC_STATUSES, `${label}.status`),
  });
}

function snapshotOperation(value, label) {
  const record = assertPlainCarrier(value, label);
  return freeze({
    kind: text(required(record, 'kind', label), `${label}.kind`),
  });
}

function snapshotData(value, kind, label) {
  const record = assertPlainCarrier(value, label);
  const empty = freeze([]);
  const data = {
    agent: '',
    category: '',
    code: '',
    cron: '',
    domName: '',
    domains: empty,
    fragments: empty,
    guards: empty,
    help: '',
    inputFields: empty,
    meta: freeze({ description: '', title: '' }),
    mutationForms: empty,
    minimumIntegrity: '',
    message: '',
    modelOperations: empty,
    mutation: '',
    operations: empty,
    optimistic: empty,
    queries: empty,
    resultIntegrity: '',
    severity: '',
    sourceAnchor: undefined,
    version: '',
    writes: empty,
  };
  data.guards = stringList(optional(record, 'guards', label), `${label}.guards`, empty);
  if (kind === 'agent') {
    const operations = optional(record, 'modelOperations', label);
    data.modelOperations =
      operations === undefined
        ? empty
        : list(operations, `${label}.modelOperations`, MAX_LIST_ENTRIES, snapshotOperation);
  } else if (kind === 'tool') {
    data.agent = optionalText(optional(record, 'agent', label), `${label}.agent`);
    data.minimumIntegrity = optionalText(
      optional(record, 'minimumIntegrity', label),
      `${label}.minimumIntegrity`,
    );
    data.mutation = optionalText(optional(record, 'mutation', label), `${label}.mutation`);
    const operations = optional(record, 'operations', label);
    data.operations =
      operations === undefined
        ? empty
        : list(operations, `${label}.operations`, MAX_LIST_ENTRIES, snapshotOperation);
    data.resultIntegrity = optionalText(
      optional(record, 'resultIntegrity', label),
      `${label}.resultIntegrity`,
    );
  } else if (kind === 'task') {
    data.cron = optionalText(optional(record, 'cron', label), `${label}.cron`);
  } else if (kind === 'diagnostic') {
    const diagnostic = snapshotDiagnostic(record, label);
    data.category = diagnostic.category;
    data.code = diagnostic.code;
    data.help = diagnostic.help ?? '';
    data.message = diagnostic.message;
    data.severity = diagnostic.severity;
    data.sourceAnchor = diagnostic.source;
    data.version = diagnostic.version;
  } else if (kind === 'component') {
    data.domName = optionalText(optional(record, 'domName', label), `${label}.domName`);
    data.fragments = stringList(optional(record, 'fragments', label), `${label}.fragments`, empty);
    data.queries = stringList(optional(record, 'queries', label), `${label}.queries`, empty);
    const forms = optional(record, 'mutationForms', label);
    data.mutationForms =
      forms === undefined
        ? empty
        : list(forms, `${label}.mutationForms`, MAX_LIST_ENTRIES, snapshotMutationForm);
  } else if (kind === 'mutation') {
    data.inputFields = stringList(
      optional(record, 'inputFields', label),
      `${label}.inputFields`,
      empty,
    );
    data.writes = stringList(optional(record, 'writes', label), `${label}.writes`, empty);
    const optimistic = optional(record, 'optimistic', label);
    data.optimistic =
      optimistic === undefined
        ? empty
        : list(optimistic, `${label}.optimistic`, MAX_LIST_ENTRIES, snapshotOptimistic);
  } else if (kind === 'query') {
    data.domains = stringList(optional(record, 'domains', label), `${label}.domains`, empty);
  } else if (kind === 'page') {
    const metaValue = optional(record, 'meta', label);
    if (metaValue !== undefined && metaValue !== null) {
      const meta = assertPlainCarrier(metaValue, `${label}.meta`);
      data.meta = freeze({
        description: optionalText(
          optional(meta, 'description', `${label}.meta`),
          `${label}.meta.description`,
        ),
        title: optionalText(optional(meta, 'title', `${label}.meta`), `${label}.meta.title`),
      });
    }
  }
  return freeze(data);
}

function positiveLine(value, label) {
  if (!isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function runtimeGraphName(value, label) {
  const candidate = text(value, label, MAX_RUNTIME_NAME_LENGTH);
  if (!regexpTest(RUNTIME_GRAPH_NAME, candidate)) {
    throw new TypeError(`${label} is not a safe graph name.`);
  }
  return candidate;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
  return value;
}

function snapshotRuntimeChange(value, label) {
  const record = assertPlainCarrier(value, label);
  return freeze({
    domain: runtimeGraphName(required(record, 'domain', label), `${label}.domain`),
    keyCount: boundedInteger(
      required(record, 'keyCount', label),
      0,
      MAX_RUNTIME_FACTS,
      `${label}.keyCount`,
    ),
  });
}

function snapshotRuntimeQuery(value, label) {
  const record = assertPlainCarrier(value, label);
  if (required(record, 'value', label) !== 'redacted') {
    throw new TypeError(`${label}.value must stay redacted.`);
  }
  return freeze({
    bytes: boundedInteger(
      required(record, 'bytes', label),
      0,
      MAX_RUNTIME_BODY_BYTES,
      `${label}.bytes`,
    ),
    delta: boolean(required(record, 'delta', label), `${label}.delta`),
    keyed: boolean(required(record, 'keyed', label), `${label}.keyed`),
    name: runtimeGraphName(required(record, 'name', label), `${label}.name`),
    settlesPendingWork: boolean(
      required(record, 'settlesPendingWork', label),
      `${label}.settlesPendingWork`,
    ),
    value: 'redacted',
  });
}

function snapshotRuntimeFrame(value, label) {
  const record = assertPlainCarrier(value, label);
  if (required(record, 'schema', label) !== 'kovo-devtool-runtime-frame/v1') {
    throw new TypeError(`${label}.schema is invalid.`);
  }
  const mutationValue = required(record, 'mutation', label);
  const phase = enumText(
    required(record, 'phase', label),
    freeze(['pending', 'settled']),
    `${label}.phase`,
  );
  const statusValue = optional(record, 'status', label);
  const targets = assertPlainCarrier(required(record, 'targets', label), `${label}.targets`);
  return freeze({
    app: runtimeGraphName(required(record, 'app', label), `${label}.app`),
    changes: list(
      required(record, 'changes', label),
      `${label}.changes`,
      MAX_RUNTIME_FACTS,
      snapshotRuntimeChange,
    ),
    mutation: mutationValue === null ? null : runtimeGraphName(mutationValue, `${label}.mutation`),
    phase,
    queries: list(
      required(record, 'queries', label),
      `${label}.queries`,
      MAX_RUNTIME_FACTS,
      snapshotRuntimeQuery,
    ),
    schema: 'kovo-devtool-runtime-frame/v1',
    sequence: positiveLine(required(record, 'sequence', label), `${label}.sequence`),
    status:
      statusValue === undefined
        ? undefined
        : boundedInteger(statusValue, 100, 599, `${label}.status`),
    targets: freeze({
      count: boundedInteger(
        required(targets, 'count', `${label}.targets`),
        0,
        MAX_RUNTIME_FACTS,
        `${label}.targets.count`,
      ),
      queryNames: list(
        required(targets, 'queryNames', `${label}.targets`),
        `${label}.targets.queryNames`,
        MAX_RUNTIME_FACTS,
        runtimeGraphName,
      ),
      truncated: boolean(
        required(targets, 'truncated', `${label}.targets`),
        `${label}.targets.truncated`,
      ),
    }),
    truncated: boolean(required(record, 'truncated', label), `${label}.truncated`),
  });
}

function snapshotRuntime(value) {
  if (value === undefined) return undefined;
  const record = assertPlainCarrier(value, 'renderPage options.runtime');
  return freeze({
    frames: list(
      required(record, 'frames', 'renderPage options.runtime'),
      'renderPage options.runtime.frames',
      MAX_RUNTIME_FRAMES,
      snapshotRuntimeFrame,
    ),
    href: text(
      required(record, 'href', 'renderPage options.runtime'),
      'renderPage options.runtime.href',
    ),
    moduleHref: text(
      required(record, 'moduleHref', 'renderPage options.runtime'),
      'renderPage options.runtime.moduleHref',
    ),
  });
}

function snapshotTouch(value, label) {
  const record = assertPlainCarrier(value, label);
  const keysValue = optional(record, 'keys', label);
  return freeze({
    domain: text(required(record, 'domain', label), `${label}.domain`),
    keys: keysValue === null ? null : optionalText(keysValue, `${label}.keys`),
    site: optionalText(optional(record, 'site', label), `${label}.site`),
    via: text(required(record, 'via', label), `${label}.via`),
  });
}

function snapshotSource(value, label) {
  if (value === undefined || value === null) return null;
  const record = assertPlainCarrier(value, label);
  const startLine = positiveLine(required(record, 'startLine', label), `${label}.startLine`);
  const anchorLine = positiveLine(required(record, 'anchorLine', label), `${label}.anchorLine`);
  const endLine = positiveLine(required(record, 'endLine', label), `${label}.endLine`);
  if (anchorLine < startLine || endLine < anchorLine) {
    throw new TypeError(`${label} line range must satisfy startLine <= anchorLine <= endLine.`);
  }
  const touches = optional(record, 'touches', label);
  return freeze({
    anchorLine,
    code: text(required(record, 'code', label), `${label}.code`, MAX_SOURCE_LENGTH),
    endLine,
    file: text(required(record, 'file', label), `${label}.file`),
    lang: text(required(record, 'lang', label), `${label}.lang`),
    startLine,
    touches:
      touches === undefined
        ? freeze([])
        : list(touches, `${label}.touches`, MAX_LIST_ENTRIES, snapshotTouch),
  });
}

function snapshotNode(value, label) {
  const record = assertPlainCarrier(value, label);
  const kind = enumText(required(record, 'kind', label), NODE_KINDS, `${label}.kind`);
  return freeze({
    data: snapshotData(required(record, 'data', label), kind, `${label}.data`),
    id: text(required(record, 'id', label), `${label}.id`),
    kind,
    label: text(required(record, 'label', label), `${label}.label`),
    lane: undefined,
    name: text(required(record, 'name', label), `${label}.name`),
    source: snapshotSource(optional(record, 'source', label), `${label}.source`),
    x: undefined,
    y: undefined,
  });
}

function mutableLayoutNode(node) {
  return {
    data: node.data,
    id: node.id,
    kind: node.kind,
    label: node.label,
    lane: node.lane,
    name: node.name,
    source: node.source,
    x: node.x,
    y: node.y,
  };
}

function snapshotEdge(value, label) {
  const record = assertPlainCarrier(value, label);
  return freeze({
    data: freeze({}),
    from: text(required(record, 'from', label), `${label}.from`),
    id: text(required(record, 'id', label), `${label}.id`),
    kind: enumText(required(record, 'kind', label), EDGE_KINDS, `${label}.kind`),
    to: text(required(record, 'to', label), `${label}.to`),
  });
}

function snapshotBundle(value) {
  const record = assertPlainCarrier(value, 'renderPage options.bundle');
  const rawNodes = list(
    required(record, 'nodes', 'renderPage options.bundle'),
    'renderPage bundle.nodes',
    MAX_GRAPH_NODES,
    snapshotNode,
  );
  const nodeIds = createMap();
  const nodes = [];
  const counts = {};
  for (let index = 0; index < NODE_KINDS.length; index += 1) {
    defineOwnData(counts, NODE_KINDS[index], 0);
  }
  for (let index = 0; index < arrayLength(rawNodes, 'renderPage bundle.nodes'); index += 1) {
    const node = arrayValue(rawNodes, index, 'renderPage bundle.nodes');
    if (mapHas(nodeIds, node.id)) {
      throw new TypeError(`renderPage bundle contains duplicate node id ${node.id}.`);
    }
    mapSet(nodeIds, node.id, true);
    counts[node.kind] += 1;
    arrayAppend(nodes, mutableLayoutNode(node), 'renderPage bundle node snapshots');
  }
  const edges = list(
    required(record, 'edges', 'renderPage options.bundle'),
    'renderPage bundle.edges',
    MAX_GRAPH_EDGES,
    snapshotEdge,
  );
  const edgeIds = createMap();
  for (let index = 0; index < arrayLength(edges, 'renderPage bundle.edges'); index += 1) {
    const edge = arrayValue(edges, index, 'renderPage bundle.edges');
    if (mapHas(edgeIds, edge.id)) {
      throw new TypeError(`renderPage bundle contains duplicate edge id ${edge.id}.`);
    }
    if (!mapHas(nodeIds, edge.from) || !mapHas(nodeIds, edge.to)) {
      throw new TypeError(`renderPage edge ${edge.id} references an unknown node.`);
    }
    mapSet(edgeIds, edge.id, true);
  }
  return freeze({
    app: text(required(record, 'app', 'renderPage options.bundle'), 'renderPage bundle.app'),
    blurb: optionalText(
      optional(record, 'blurb', 'renderPage options.bundle'),
      'renderPage bundle.blurb',
    ),
    counts: freeze(counts),
    edges,
    label: text(required(record, 'label', 'renderPage options.bundle'), 'renderPage bundle.label'),
    limitations: stringList(
      optional(record, 'limitations', 'renderPage options.bundle'),
      'renderPage bundle.limitations',
    ),
    nodes: freeze(nodes),
    provenance: optionalText(
      optional(record, 'provenance', 'renderPage options.bundle'),
      'renderPage bundle.provenance',
      'derived from generated/graph.json',
    ),
    view:
      optional(record, 'view', 'renderPage options.bundle') === undefined
        ? 'source-graph'
        : enumText(
            optional(record, 'view', 'renderPage options.bundle'),
            freeze(['source-graph', 'runtime-registry']),
            'renderPage bundle.view',
          ),
  });
}

export function snapshotRenderOptions(value) {
  const options = assertPlainCarrier(value, 'renderPage options');
  if (stableOwnData(options, 'css', 'renderPage options').found) {
    throw new TypeError(
      'renderPage no longer accepts caller CSS; createDevtoolApp owns the encoded bundled stylesheet.',
    );
  }
  const { ids, manifest } = snapshotManifest(required(options, 'manifest', 'renderPage options'));
  const bundle = snapshotBundle(required(options, 'bundle', 'renderPage options'));
  const app = text(required(options, 'app', 'renderPage options'), 'renderPage options.app');
  if (!mapHas(ids, app)) throw new TypeError(`renderPage app ${app} is missing from the manifest.`);
  if (bundle.app !== app) throw new TypeError('renderPage bundle.app must match options.app.');
  const qValue = optional(options, 'q', 'renderPage options');
  const runtime = snapshotRuntime(optional(options, 'runtime', 'renderPage options'));
  const selValue = optional(options, 'sel', 'renderPage options');
  if (runtime !== undefined) {
    for (let index = 0; index < arrayLength(runtime.frames, 'runtime frames'); index += 1) {
      if (arrayValue(runtime.frames, index, 'runtime frames').app !== app) {
        throw new TypeError('renderPage runtime frames must match options.app.');
      }
    }
  }
  return freeze({
    app,
    bundle,
    manifest,
    pzHref: text(required(options, 'pzHref', 'renderPage options'), 'renderPage options.pzHref'),
    q: qValue === undefined ? undefined : text(qValue, 'renderPage options.q'),
    runtime,
    sel: selValue === undefined ? undefined : text(selValue, 'renderPage options.sel'),
  });
}
