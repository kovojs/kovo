const MAX_PROFILE_NODES = 1_000_000;
const MAX_PROFILE_SAMPLES = 10_000_000;

export const PERF_BUILD_PROFILE_CLASSIFIER = 'kovo-build-session-eligibility/phase-v1';
export const PERF_BUILD_PROFILE_ELIGIBLE_CAUSES = Object.freeze([
  'config-trust',
  'typescript',
  'stylesheet',
]);

const BUILD_EXPORT_MODULES = cliModules('commands/build-export.ts', 'commands/build-export.js');
const MARKERS = Object.freeze([
  phaseMarker(
    'lifecycle-policy',
    'runLifecyclePolicyCheck',
    cliModules('commands/lifecycle-policy.ts', 'commands/lifecycle-policy.js'),
  ),
  phaseMarker('config-trust', 'runPreEvaluationBuildConfigTrustPreflightInWorker'),
  phaseMarker('typescript', 'runTypeScriptBuildPreflight'),
  phaseMarker(
    'project-quality',
    'runProjectQualityCheck',
    cliModules('commands/project-quality.ts', 'commands/project-quality.js'),
  ),
  phaseMarker(
    'sound-subset',
    'runSoundSubsetCheck',
    cliModules('commands/sound-subset.mjs', 'commands/sound-subset.mjs'),
  ),
  phaseMarker('session-authority', 'sessionAuthorityFactsFromEntry'),
  phaseMarker('app-source-trust', 'runPreEvaluationStaticTrustPreflightInWorker'),
  phaseMarker('stylesheet', 'kovoBuildStylesheetCss'),
  phaseMarker('app-evaluation', 'loadBuildAppModule'),
  phaseMarker('build-check-graph', 'buildCheckGraph'),
  phaseMarker(
    'graph-diagnostics',
    'kovoCheckWithDiagnosticSourceCatalog',
    cliModules('graph-output.ts', 'graph-output.js'),
  ),
  workerMarker('analyze', 'produceKovoBuildOneShotAnalysis'),
  workerMarker('client', 'produceKovoBuildOneShotClientPhase'),
  workerMarker('server', 'produceKovoBuildOneShotServerPhase'),
  workerMarker('final', 'finishKovoBuildOneShot'),
]);

/**
 * Derive the fixed build-session cause ranking from raw V8 CPU-profile samples. A stack receives a
 * cause only through an exact reviewed function/module marker. Specific source phases outrank their
 * enclosing one-shot worker; unknown stacks remain `unattributed`, and ambiguous marker stacks fail
 * closed instead of turning wall-clock phase labels into invented CPU attribution.
 */
export function deriveBuildProfileTopFive(profileBytes) {
  if (!Buffer.isBuffer(profileBytes) || profileBytes.length === 0) {
    throw new TypeError('raw build CPU profile must be non-empty bytes');
  }
  let profile;
  try {
    profile = JSON.parse(profileBytes.toString('utf8'));
  } catch {
    throw new TypeError('raw build CPU profile is not valid JSON');
  }
  const { nodes, samples, timeDeltas } = profile ?? {};
  if (
    !Array.isArray(nodes) ||
    nodes.length < 1 ||
    nodes.length > MAX_PROFILE_NODES ||
    !Array.isArray(samples) ||
    samples.length < 1 ||
    samples.length > MAX_PROFILE_SAMPLES ||
    !Array.isArray(timeDeltas) ||
    timeDeltas.length !== samples.length ||
    timeDeltas.some((delta) => !Number.isSafeInteger(delta) || delta < 0)
  ) {
    throw new TypeError('raw build CPU profile has an invalid node/sample/time-delta census');
  }

  const nodesById = new Map();
  const parentById = new Map();
  for (const node of nodes) {
    if (
      !ownRecord(node) ||
      !Number.isSafeInteger(node.id) ||
      node.id < 1 ||
      nodesById.has(node.id) ||
      !ownRecord(node.callFrame) ||
      typeof node.callFrame.functionName !== 'string' ||
      typeof node.callFrame.url !== 'string' ||
      (node.children !== undefined && !Array.isArray(node.children))
    ) {
      throw new TypeError('raw build CPU profile contains a malformed or duplicate node');
    }
    nodesById.set(node.id, node);
  }
  for (const node of nodes) {
    for (const childId of node.children ?? []) {
      if (
        !Number.isSafeInteger(childId) ||
        childId < 1 ||
        !nodesById.has(childId) ||
        parentById.has(childId)
      ) {
        throw new TypeError('raw build CPU profile has an invalid or ambiguous parent graph');
      }
      parentById.set(childId, node.id);
    }
  }

  const counts = new Map();
  let recognizedSamples = 0;
  for (const sampleId of samples) {
    if (!Number.isSafeInteger(sampleId) || !nodesById.has(sampleId)) {
      throw new TypeError('raw build CPU profile sample references an unavailable node');
    }
    const cause = sampleCause(sampleId, nodesById, parentById);
    if (cause !== 'unattributed') recognizedSamples += 1;
    counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }
  if (recognizedSamples === 0) {
    throw new TypeError('raw build CPU profile contains no exact reviewed build marker sample');
  }
  const ranking = [...counts]
    .map(([cause, selfSamples]) => ({
      cause,
      selfSamples,
      sessionEligibility: PERF_BUILD_PROFILE_ELIGIBLE_CAUSES.includes(cause)
        ? 'session-eligible'
        : 'one-shot-or-ineligible',
    }))
    .sort(
      (left, right) =>
        right.selfSamples - left.selfSamples || left.cause.localeCompare(right.cause),
    )
    .slice(0, 5)
    .map((entry, index) => ({ rank: index + 1, ...entry }));
  if (ranking.length !== 5) {
    throw new TypeError('raw build CPU profile does not yield five positive ranked causes');
  }
  return ranking;
}

function sampleCause(sampleId, nodesById, parentById) {
  const markers = [];
  const visited = new Set();
  let nodeId = sampleId;
  while (nodeId !== undefined) {
    if (visited.has(nodeId)) throw new TypeError('raw build CPU profile parent graph is cyclic');
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    for (const marker of MARKERS) {
      if (
        node.callFrame.functionName === marker.functionName &&
        marker.moduleSuffixes.some((suffix) => node.callFrame.url.endsWith(suffix))
      ) {
        markers.push(marker);
      }
    }
    nodeId = parentById.get(nodeId);
  }
  if (markers.length === 0) return 'unattributed';
  const highestPriority = Math.max(...markers.map(({ priority }) => priority));
  const causes = new Set(
    markers.filter(({ priority }) => priority === highestPriority).map(({ cause }) => cause),
  );
  if (causes.size !== 1) {
    throw new TypeError('raw build CPU profile stack has ambiguous reviewed phase markers');
  }
  return [...causes][0];
}

function phaseMarker(cause, functionName, moduleSuffixes = BUILD_EXPORT_MODULES) {
  return Object.freeze({ cause, functionName, moduleSuffixes, priority: 2 });
}

function workerMarker(cause, functionName) {
  return Object.freeze({ cause, functionName, moduleSuffixes: BUILD_EXPORT_MODULES, priority: 1 });
}

function cliModules(sourceRelative, distributionRelative) {
  return Object.freeze([
    `/packages/cli/src/${sourceRelative}`,
    `/node_modules/@kovojs/cli/src/${sourceRelative}`,
    `/packages/cli/dist/${distributionRelative}`,
    `/node_modules/@kovojs/cli/dist/${distributionRelative}`,
  ]);
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
