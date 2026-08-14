const MAX_PROFILE_NODES = 1_000_000;
const MAX_PROFILE_SAMPLES = 10_000_000;
const MAX_PROFILE_DOCUMENTS = 64;

export const PERF_BUILD_PROFILE_CLASSIFIER = 'kovo-build-session-eligibility/phase-v1';
export const PERF_BUILD_PROFILE_ELIGIBLE_CAUSES = Object.freeze([
  'config-trust',
  'typescript',
  'stylesheet',
]);
export const PERF_BUILD_PROFILE_REQUIRED_ROLES = Object.freeze([
  'bootstrap',
  'orchestrator',
  'analyze',
  'typescript',
  'app-static-trust',
  'client',
  'server',
  'final',
]);

const BUILD_EXPORT_MODULES = cliModules('commands/build-export.ts', 'commands/build-export.js');
const MARKERS = Object.freeze([
  phaseMarker(
    'lifecycle-policy',
    'runLifecyclePolicyCheck',
    cliModules('commands/lifecycle-policy.ts', 'commands/lifecycle-policy.js'),
  ),
  phaseMarker('config-trust', 'runPreEvaluationBuildConfigTrustPreflight'),
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
  phaseMarker('app-source-trust', 'runPreEvaluationStaticTrustPreflight'),
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
  phaseMarker('worker-launch-transport', 'runPreEvaluationBuildConfigTrustPreflightInWorker'),
  phaseMarker('worker-launch-transport', 'runPreEvaluationStaticTrustPreflightInWorker'),
]);
const ROLE_MARKERS = Object.freeze([
  roleFunction(
    'config-static-trust',
    'runPreEvaluationBuildConfigTrustPreflight',
    BUILD_EXPORT_MODULES,
    4,
  ),
  roleFunction('app-static-trust', 'runPreEvaluationStaticTrustPreflight', BUILD_EXPORT_MODULES, 4),
  roleModule(
    'typescript',
    [
      '/node_modules/typescript/lib/_tsc.js',
      '/node_modules/typescript/lib/tsc.js',
    ],
    3,
  ),
  roleFunction('analyze', 'produceKovoBuildOneShotAnalysis', BUILD_EXPORT_MODULES, 2),
  roleFunction('client', 'produceKovoBuildOneShotClientPhase', BUILD_EXPORT_MODULES, 2),
  roleFunction('server', 'produceKovoBuildOneShotServerPhase', BUILD_EXPORT_MODULES, 2),
  roleFunction('final', 'finishKovoBuildOneShot', BUILD_EXPORT_MODULES, 2),
  roleFunction(
    'orchestrator',
    'runKovoIsolatedOneShotInvocationAsync',
    cliModules(
      'commands/build-one-shot-orchestrator.ts',
      'commands/build-one-shot-orchestrator.js',
    ),
    1,
  ),
  roleModule(
    'bootstrap',
    cliModules('bin.ts', 'bin.js').map((suffix) => suffix.replace('/commands/', '/')),
    0,
  ),
]);
const ROLE_FALLBACK_CAUSES = Object.freeze({
  analyze: 'analyze',
  'app-static-trust': 'app-source-trust',
  bootstrap: 'cli-startup-tail',
  client: 'client',
  'config-static-trust': 'config-trust',
  final: 'final',
  orchestrator: 'worker-launch-transport',
  server: 'server',
  typescript: 'typescript',
});

/**
 * Derive the fixed build-session cause ranking from raw V8 CPU-profile samples. A stack receives a
 * cause only through an exact reviewed function/module marker. Specific source phases outrank their
 * enclosing one-shot worker; unknown stacks remain `unattributed`, and ambiguous marker stacks fail
 * closed instead of turning wall-clock phase labels into invented CPU attribution.
 */
export function deriveBuildProfileTopFive(profileBytes) {
  const inspected = inspectBuildProfile(profileBytes);
  if (inspected.exactMarkerSamples === 0) {
    throw new TypeError('raw build CPU profile contains no exact reviewed build marker sample');
  }
  return rankCauseCounts(inspected.causeCounts);
}

/**
 * Aggregate the original process-local V8 profiles without rewriting their node graphs. Process
 * identity supplies only a conservative fallback cause; exact phase markers still win, and idle
 * samples are retained in the census but never presented as CPU work. A separately proven native
 * residual may be added only as the fixed ineligible `native-or-unprofiled` cause.
 */
export function deriveBuildProfileSetAnalysis(
  profileDocuments,
  { nativeOrUnprofiledSamples = 0, requireConfigStaticTrust = false } = {},
) {
  if (
    !Array.isArray(profileDocuments) ||
    profileDocuments.length < 1 ||
    profileDocuments.length > MAX_PROFILE_DOCUMENTS
  ) {
    throw new TypeError('build CPU profile set has an invalid process census');
  }
  if (!Number.isSafeInteger(nativeOrUnprofiledSamples) || nativeOrUnprofiledSamples < 0) {
    throw new TypeError('native-or-unprofiled sample equivalent must be a non-negative integer');
  }
  if (typeof requireConfigStaticTrust !== 'boolean') {
    throw new TypeError('config static-trust role posture must be boolean');
  }

  const profiles = profileDocuments.map((bytes) => {
    const inspected = inspectBuildProfile(bytes);
    const role = profileRole(inspected.nodes);
    const fallbackCause = ROLE_FALLBACK_CAUSES[role];
    const causeCounts = new Map(inspected.causeCounts);
    if (inspected.unattributedSamples > 0) {
      causeCounts.delete('unattributed');
      causeCounts.set(
        fallbackCause,
        (causeCounts.get(fallbackCause) ?? 0) + inspected.unattributedSamples,
      );
    }
    return {
      activeSamples: inspected.activeSamples,
      causeCounts,
      exactMarkerSamples: inspected.exactMarkerSamples,
      idleSamples: inspected.idleSamples,
      negativeTimeDeltas: inspected.negativeTimeDeltas,
      nodes: inspected.nodes.length,
      role,
      samples: inspected.samples,
      zeroTimeDeltas: inspected.zeroTimeDeltas,
    };
  });
  const roles = profiles.map(({ role }) => role);
  const expectedRoles = [
    ...PERF_BUILD_PROFILE_REQUIRED_ROLES,
    ...(requireConfigStaticTrust ? ['config-static-trust'] : []),
  ].sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify([...roles].sort((left, right) => left.localeCompare(right))) !==
    JSON.stringify(expectedRoles)
  ) {
    throw new TypeError(
      `build CPU profile role census differs: observed ${roles.sort().join(', ')}, expected ${expectedRoles.join(', ')}`,
    );
  }

  const causeCounts = new Map();
  for (const profile of profiles) {
    for (const [cause, samples] of profile.causeCounts) {
      causeCounts.set(cause, (causeCounts.get(cause) ?? 0) + samples);
    }
  }
  if (nativeOrUnprofiledSamples > 0) {
    causeCounts.set(
      'native-or-unprofiled',
      (causeCounts.get('native-or-unprofiled') ?? 0) + nativeOrUnprofiledSamples,
    );
  }
  const topFive = rankCauseCounts(causeCounts);
  return {
    causeCensus: causeCountEntries(causeCounts).sort((left, right) =>
      left.cause.localeCompare(right.cause),
    ),
    profileCensus: profiles.map(({ causeCounts: profileCauseCounts, ...profile }) => ({
      ...profile,
      causeCensus: causeCountEntries(profileCauseCounts).sort((left, right) =>
        left.cause.localeCompare(right.cause),
      ),
    })),
    sampleCensus: {
      active: profiles.reduce((sum, profile) => sum + profile.activeSamples, 0),
      idle: profiles.reduce((sum, profile) => sum + profile.idleSamples, 0),
      nativeOrUnprofiled: nativeOrUnprofiledSamples,
      negativeTimeDeltas: profiles.reduce((sum, profile) => sum + profile.negativeTimeDeltas, 0),
      total: profiles.reduce((sum, profile) => sum + profile.samples, 0),
      zeroTimeDeltas: profiles.reduce((sum, profile) => sum + profile.zeroTimeDeltas, 0),
    },
    topFive,
  };
}

function inspectBuildProfile(profileBytes) {
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
    timeDeltas.some((delta) => !Number.isSafeInteger(delta))
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

  const causeCounts = new Map();
  let activeSamples = 0;
  let exactMarkerSamples = 0;
  let idleSamples = 0;
  for (const sampleId of samples) {
    if (!Number.isSafeInteger(sampleId) || !nodesById.has(sampleId)) {
      throw new TypeError('raw build CPU profile sample references an unavailable node');
    }
    if (exactIdleSample(sampleId, nodesById)) {
      idleSamples += 1;
      continue;
    }
    activeSamples += 1;
    const cause = sampleCause(sampleId, nodesById, parentById);
    if (cause !== 'unattributed') exactMarkerSamples += 1;
    causeCounts.set(cause, (causeCounts.get(cause) ?? 0) + 1);
  }
  return {
    activeSamples,
    causeCounts,
    exactMarkerSamples,
    idleSamples,
    negativeTimeDeltas: timeDeltas.filter((delta) => delta < 0).length,
    nodes,
    samples: samples.length,
    unattributedSamples: causeCounts.get('unattributed') ?? 0,
    zeroTimeDeltas: timeDeltas.filter((delta) => delta === 0).length,
  };
}

function rankCauseCounts(counts) {
  const ranking = causeCountEntries(counts)
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

function causeCountEntries(counts) {
  return [...counts].map(([cause, selfSamples]) => ({
    cause,
    selfSamples,
    sessionEligibility: PERF_BUILD_PROFILE_ELIGIBLE_CAUSES.includes(cause)
      ? 'session-eligible'
      : 'one-shot-or-ineligible',
  }));
}

function exactIdleSample(sampleId, nodesById) {
  const callFrame = nodesById.get(sampleId)?.callFrame;
  return callFrame?.functionName === '(idle)' && callFrame.url === '';
}

function profileRole(nodes) {
  const matches = ROLE_MARKERS.filter((marker) =>
    nodes.some(
      ({ callFrame }) =>
        (marker.functionName === null || callFrame.functionName === marker.functionName) &&
        marker.moduleSuffixes.some((suffix) => callFrame.url.endsWith(suffix)),
    ),
  );
  if (matches.length === 0) {
    throw new TypeError('raw build CPU profile has no exact reviewed process role marker');
  }
  const priority = Math.max(...matches.map((marker) => marker.priority));
  const roles = new Set(
    matches.filter((marker) => marker.priority === priority).map((marker) => marker.role),
  );
  if (roles.size !== 1) {
    throw new TypeError('raw build CPU profile has ambiguous reviewed process role markers');
  }
  return [...roles][0];
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

function roleFunction(role, functionName, moduleSuffixes, priority) {
  return Object.freeze({ functionName, moduleSuffixes, priority, role });
}

function roleModule(role, moduleSuffixes, priority) {
  return roleFunction(role, null, Object.freeze(moduleSuffixes), priority);
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
