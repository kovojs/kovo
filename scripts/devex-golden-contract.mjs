import { createHash } from 'node:crypto';

export const DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA = 'kovo.golden-journey/release-scorecard/v1';
export const DEVEX_GOLDEN_WORKLOAD_SCHEMA = 'kovo-devex-golden-workload/v1';
export const DEVEX_GOLDEN_RELEASE_SCENARIO = 'release-scorecard';
export const DEVEX_GOLDEN_PACKED_APPS_SCHEMA = 'kovo.golden-journey/packed-apps/v1';
export const DEVEX_GOLDEN_PACKED_APP_SCHEMA = 'kovo.golden-journey/packed-app/v1';
export const DEVEX_GOLDEN_OFFLINE_AGENT_SCHEMA = 'kovo.golden-journey/offline-agent/v1';

export const DEVEX_GOLDEN_METRIC_IDS = Object.freeze([
  'create.install.cold.durationMs',
  'create.install.installedBytes',
  'dev.ready.cold.durationMs',
  'dev.ready.warm.durationMs',
]);

export const DEVEX_GOLDEN_PHASE_CONTRACT = Object.freeze({
  app: Object.freeze([
    'create',
    'install',
    'ready',
    'first-200',
    'login',
    'crud',
    'ready-warm',
    'check',
    'build',
    'test',
  ]),
  agent: Object.freeze([
    'scaffold',
    'install',
    'update-docs',
    'check-failing',
    'docs',
    'check-fixed',
  ]),
});

export const DEVEX_GOLDEN_COMMAND_DIGEST = sha256(
  canonicalJson({
    schema: 'kovo.golden-journey/command-contract/v1',
    scenarios: ['postgres', 'sqlite', 'offline-agent'],
    phases: DEVEX_GOLDEN_PHASE_CONTRACT,
    packageManager: 'pnpm',
    network: {
      appInstall: 'registry-or-cache',
      agentInstall: 'strict-offline',
      agentRuntime: 'deny-all-including-loopback',
    },
  }),
);

const EXPECTED_PACKAGE_NAMES = Object.freeze([
  '@kovojs/better-auth',
  '@kovojs/browser',
  '@kovojs/cli',
  '@kovojs/compiler',
  '@kovojs/core',
  '@kovojs/drizzle',
  '@kovojs/headless-ui',
  '@kovojs/icons',
  '@kovojs/server',
  '@kovojs/style',
  '@kovojs/test',
  '@kovojs/ui',
  '@kovojs/verify',
  'create-kovo',
]);

export function buildGoldenReleaseScorecard({
  agent,
  environment,
  manifestSha256,
  packedApps,
  runner,
}) {
  const metrics = goldenJourneyMetrics(packedApps);
  const definition = {
    schema: 'kovo.golden-journey/release-definition/v1',
    commandDigest: DEVEX_GOLDEN_COMMAND_DIGEST,
    dialects: [...packedApps.dialects],
    packageNames: packedApps.packageSet.map((pkg) => pkg.name),
    scenario: DEVEX_GOLDEN_RELEASE_SCENARIO,
  };
  const report = {
    schema: DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA,
    scenario: {
      name: DEVEX_GOLDEN_RELEASE_SCENARIO,
      digest: sha256(canonicalJson(definition)),
      definition,
    },
    provenance: {
      sourceCommit: environment.sourceCommit,
      sourceTree: environment.sourceTree,
      packageManager: environment.packageManager,
      osImage: environment.osImage,
      packedManifestSha256: manifestSha256,
      commandDigest: DEVEX_GOLDEN_COMMAND_DIGEST,
    },
    runner,
    sampleCount: packedApps.sampleCount,
    packageSet: packedApps.packageSet,
    packedApps,
    agent,
    metrics,
    pass: packedApps.pass === true && agent.pass === true,
  };
  const findings = validateGoldenReleaseScorecard(report);
  if (findings.length > 0) {
    throw new Error(`invalid golden release scorecard:\n- ${findings.join('\n- ')}`);
  }
  return Object.freeze(report);
}

export function goldenJourneyMetrics(packedApps) {
  const variants = Array.isArray(packedApps?.variants) ? packedApps.variants : [];
  const phaseSamples = (name) =>
    variants.map((variant) => variant.phases?.find((phase) => phase.name === name)?.durationMs);
  const installedBytes = variants.map((variant) => variant.install?.installedBytes);
  const records = {
    'create.install.cold.durationMs': metric(
      variants.map((variant) => variant.install?.durationMs),
      'ms',
    ),
    'create.install.installedBytes': metric(installedBytes, 'bytes'),
    'dev.ready.cold.durationMs': metric(phaseSamples('ready'), 'ms'),
    'dev.ready.warm.durationMs': metric(phaseSamples('ready-warm'), 'ms'),
  };
  return Object.fromEntries(
    Object.entries(records).sort(([left], [right]) => compareUtf8(left, right)),
  );
}

export function goldenJourneyWorkloadIdentity(report) {
  return {
    schema: DEVEX_GOLDEN_WORKLOAD_SCHEMA,
    scenarioName: report?.scenario?.name,
    commandDigest: report?.scenario?.definition?.commandDigest,
    dialects: structuredClone(report?.scenario?.definition?.dialects),
    packageNames: structuredClone(report?.scenario?.definition?.packageNames),
  };
}

export function validateGoldenWorkloadIdentity(identity, label = 'workloadIdentity') {
  const findings = [];
  if (
    !exactKeys(identity, ['commandDigest', 'dialects', 'packageNames', 'scenarioName', 'schema']) ||
    identity?.schema !== DEVEX_GOLDEN_WORKLOAD_SCHEMA
  ) {
    return [`${label} must be an exact ${DEVEX_GOLDEN_WORKLOAD_SCHEMA} record`];
  }
  if (
    identity.scenarioName !== DEVEX_GOLDEN_RELEASE_SCENARIO ||
    identity.commandDigest !== DEVEX_GOLDEN_COMMAND_DIGEST
  ) {
    findings.push(`${label} must bind the code-owned golden release command`);
  }
  if (!sameJson(identity.dialects, ['postgres', 'sqlite'])) {
    findings.push(`${label}.dialects must bind both supported starter variants`);
  }
  if (!sameJson(identity.packageNames, EXPECTED_PACKAGE_NAMES)) {
    findings.push(`${label}.packageNames must bind the exact packed release census`);
  }
  return findings;
}

export function validateGoldenReleaseScorecard(report, label = 'report') {
  const findings = [];
  if (report?.schema !== DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA) {
    findings.push(`${label}.schema must be ${DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA}`);
    return findings;
  }
  const definition = report?.scenario?.definition;
  if (
    !exactKeys(definition, ['commandDigest', 'dialects', 'packageNames', 'scenario', 'schema']) ||
    definition.schema !== 'kovo.golden-journey/release-definition/v1' ||
    definition.commandDigest !== DEVEX_GOLDEN_COMMAND_DIGEST ||
    definition.scenario !== DEVEX_GOLDEN_RELEASE_SCENARIO
  ) {
    findings.push(`${label}.scenario.definition must bind the code-owned release journey`);
    return findings;
  }
  if (
    report.scenario.name !== DEVEX_GOLDEN_RELEASE_SCENARIO ||
    report.scenario.digest !== sha256(canonicalJson(definition))
  ) {
    findings.push(`${label}.scenario identity does not match its definition`);
  }
  if (!sameJson(definition.dialects, ['postgres', 'sqlite'])) {
    findings.push(`${label}.scenario.definition must retain both starter dialects`);
  }
  if (!sameJson(definition.packageNames, EXPECTED_PACKAGE_NAMES)) {
    findings.push(`${label}.scenario.definition must retain the exact package census`);
  }
  findings.push(...validateRunner(report.runner, `${label}.runner`));
  const provenance = report?.provenance;
  if (
    !exactKeys(provenance, [
      'commandDigest',
      'osImage',
      'packageManager',
      'packedManifestSha256',
      'sourceCommit',
      'sourceTree',
    ]) ||
    !/^[0-9a-f]{40,64}$/u.test(provenance?.sourceCommit ?? '') ||
    provenance?.sourceTree !== 'clean' ||
    typeof provenance?.packageManager !== 'string' ||
    provenance.packageManager.length === 0 ||
    typeof provenance?.osImage !== 'string' ||
    provenance.osImage.length === 0 ||
    !validDigest(provenance?.packedManifestSha256) ||
    provenance?.commandDigest !== DEVEX_GOLDEN_COMMAND_DIGEST
  ) {
    findings.push(
      `${label}.provenance must bind clean source, manifest, runner image, and command`,
    );
  }
  if (
    provenance?.osImage !== report.runner?.osImage ||
    provenance?.packageManager !== report.runner?.packageManager
  ) {
    findings.push(`${label}.provenance must match the named runner fingerprint`);
  }
  if (!Number.isSafeInteger(report.sampleCount) || report.sampleCount < 1) {
    findings.push(`${label}.sampleCount must be positive`);
  }
  const packageFindings = validatePackageSet(report.packageSet, `${label}.packageSet`);
  findings.push(...packageFindings);
  if (
    !sameJson(
      report.packageSet?.map((pkg) => pkg.name),
      EXPECTED_PACKAGE_NAMES,
    )
  ) {
    findings.push(`${label}.packageSet must retain the exact release package order`);
  }

  const packed = report?.packedApps;
  if (
    packed?.schema !== DEVEX_GOLDEN_PACKED_APPS_SCHEMA ||
    packed?.scenario !== 'packed-apps' ||
    packed?.sampleCount !== report.sampleCount ||
    !sameJson(packed?.dialects, ['postgres', 'sqlite']) ||
    !sameJson(packed?.packageSet, report.packageSet) ||
    !Array.isArray(packed?.variants) ||
    packed.variants.length !== report.sampleCount * 2
  ) {
    findings.push(`${label}.packedApps must contain both packed variants for every sample`);
  } else {
    const actualCensus = packed.variants.map((variant) => ({
      dialect: variant?.dialect,
      sampleIndex: variant?.sampleIndex,
    }));
    const expectedCensus = [];
    for (let sampleIndex = 0; sampleIndex < report.sampleCount; sampleIndex += 1) {
      for (const dialect of ['postgres', 'sqlite']) {
        expectedCensus.push({ dialect, sampleIndex });
      }
    }
    if (!sameJson(actualCensus, expectedCensus)) {
      findings.push(
        `${label}.packedApps must bind one postgres and one sqlite variant for every sample`,
      );
    }
    if (packed.pass !== packed.variants.every((variant) => variant?.pass === true)) {
      findings.push(`${label}.packedApps.pass must match every variant outcome`);
    }
    for (const [index, variant] of packed.variants.entries()) {
      if (
        variant?.schema !== DEVEX_GOLDEN_PACKED_APP_SCHEMA ||
        !['postgres', 'sqlite'].includes(variant?.dialect) ||
        !Array.isArray(variant?.phases)
      ) {
        findings.push(`${label}.packedApps.variants[${String(index)}] is invalid`);
        continue;
      }
      if (variant.pass === true) {
        if (
          !sameJson(
            variant.phases.map((phase) => phase?.name),
            DEVEX_GOLDEN_PHASE_CONTRACT.app,
          ) ||
          variant.phases.some(
            (phase) => phase?.status !== 0 || !finiteNonNegative(phase?.durationMs),
          )
        ) {
          findings.push(
            `${label}.packedApps.variants[${String(index)}] must retain the exact successful phase contract`,
          );
        }
        if (
          variant.accessibility?.schema !== 'kovo.golden-journey/accessibility/v1' ||
          variant.accessibility?.violations !== 0 ||
          !Array.isArray(variant.accessibility?.states) ||
          !['login', 'authenticated-crud'].every((state) =>
            variant.accessibility.states.some(
              (entry) => entry?.name === state && Array.isArray(entry?.violations),
            ),
          )
        ) {
          findings.push(
            `${label}.packedApps.variants[${String(index)}] omits terminal accessibility evidence`,
          );
        }
        if (
          !Number.isSafeInteger(variant.styledUi?.bytes) ||
          variant.styledUi.bytes < 1 ||
          !validDigest(variant.styledUi?.sha256) ||
          !/^evidence\/(?:postgres|sqlite)-\d+\/styled-ui\.png$/u.test(
            variant.styledUi?.path ?? '',
          ) ||
          !Number.isSafeInteger(variant.styledUi?.styled?.styleSheets) ||
          variant.styledUi.styled.styleSheets < 1
        ) {
          findings.push(
            `${label}.packedApps.variants[${String(index)}] omits its styled screenshot evidence`,
          );
        }
        if (
          !finiteNonNegative(variant.install?.durationMs) ||
          !Number.isSafeInteger(variant.install?.installedBytes) ||
          variant.install.installedBytes < 1 ||
          !Number.isSafeInteger(variant.install?.installedFiles) ||
          variant.install.installedFiles < 1 ||
          !Number.isSafeInteger(variant.install?.directProductionDependencies) ||
          variant.install.directProductionDependencies < 1 ||
          !Number.isSafeInteger(variant.install?.transitiveProductionDependencies) ||
          variant.install.transitiveProductionDependencies < 0
        ) {
          findings.push(
            `${label}.packedApps.variants[${String(index)}] omits install size evidence`,
          );
        }
        if (variant.concepts?.counts?.environmentEdits !== 0) {
          findings.push(
            `${label}.packedApps.variants[${String(index)}] required an environment edit`,
          );
        }
        if (
          variant.buildPosture?.schema !== 'kovo.golden-journey/build-posture/v1' ||
          variant.buildPosture?.retention?.hours < 24 ||
          variant.buildPosture?.retention?.immutableClientModules !== 'retained' ||
          variant.buildPosture?.retention?.priorTokenQueryReads !== 'retained'
        ) {
          findings.push(
            `${label}.packedApps.variants[${String(index)}] omits its SPEC §14 build posture`,
          );
        }
      }
    }
  }

  const agent = report?.agent;
  if (
    agent?.schema !== DEVEX_GOLDEN_OFFLINE_AGENT_SCHEMA ||
    agent?.scenario !== 'offline-agent' ||
    typeof agent?.pass !== 'boolean'
  ) {
    findings.push(`${label}.agent must be the exact offline-agent report`);
  } else if (agent.pass === true) {
    if (
      !Array.isArray(agent.phases) ||
      !sameJson(
        agent.phases.map((phase) => phase?.name),
        DEVEX_GOLDEN_PHASE_CONTRACT.agent,
      ) ||
      agent.phases.some((phase) => phase?.status !== 0 || !finiteNonNegative(phase?.durationMs))
    ) {
      findings.push(`${label}.agent must retain the exact successful phase contract`);
    }
    if (
      agent.network?.mode !== 'deny' ||
      agent.network?.loopback !== 'denied' ||
      agent.network?.packageManagerOffline !== true ||
      !sameJson(agent.network?.allowlist, [])
    ) {
      findings.push(`${label}.agent did not prove strict offline execution`);
    }
  }

  const expectedMetrics =
    packed?.variants?.every((variant) => variant?.pass === true) === true
      ? goldenJourneyMetrics(packed)
      : null;
  if (expectedMetrics !== null && !sameJson(report.metrics, expectedMetrics)) {
    findings.push(`${label}.metrics must project exact packed journey observations`);
  }
  if (
    report.pass !== (packed?.pass === true && agent?.pass === true) ||
    (report.pass === true &&
      (!packed?.variants?.every((variant) => variant.pass === true) || agent.pass !== true))
  ) {
    findings.push(`${label}.pass must match both journey families`);
  }
  return findings;
}

function metric(samples, unit) {
  if (
    !Array.isArray(samples) ||
    samples.length === 0 ||
    samples.some((sample) => !finiteNonNegative(sample))
  ) {
    return { unit, samples, summary: null };
  }
  return {
    unit,
    samples,
    summary: {
      count: samples.length,
      min: Math.min(...samples),
      median: median(samples),
      p95: percentile(samples, 0.95),
      max: Math.max(...samples),
      medianAbsoluteDeviation: medianAbsoluteDeviation(samples),
    },
  };
}

function validatePackageSet(packageSet, label) {
  const findings = [];
  if (!Array.isArray(packageSet) || packageSet.length !== EXPECTED_PACKAGE_NAMES.length) {
    return [`${label} must contain the exact packed release census`];
  }
  const names = new Set();
  for (const [index, pkg] of packageSet.entries()) {
    if (
      !exactKeys(pkg, ['name', 'sha512', 'version']) ||
      typeof pkg.name !== 'string' ||
      typeof pkg.version !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(pkg.sha512 ?? '')
    ) {
      findings.push(`${label}[${String(index)}] is invalid`);
    }
    if (names.has(pkg?.name)) findings.push(`${label} duplicates ${String(pkg?.name)}`);
    names.add(pkg?.name);
  }
  return findings;
}

function validateRunner(runner, label) {
  const fields = ['name', 'platform', 'arch', 'node', 'cpuModel', 'packageManager', 'osImage'];
  const findings = [];
  if (!exactKeys(runner, [...fields, 'id'])) {
    return [`${label} must be an exact named runner fingerprint`];
  }
  for (const field of fields) {
    if (typeof runner[field] !== 'string' || runner[field].trim().length === 0) {
      findings.push(`${label}.${field} must be non-empty`);
    }
  }
  if (findings.length === 0) {
    const identity = Object.fromEntries(fields.map((field) => [field, runner[field]]));
    if (runner.id !== sha256(JSON.stringify(identity))) {
      findings.push(`${label}.id does not match its runner identity`);
    }
  }
  return findings;
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(compareUtf8), [...expected].sort(compareUtf8))
  );
}

function validDigest(value) {
  return /^sha256:[0-9a-f]{64}$/u.test(value ?? '');
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

function medianAbsoluteDeviation(values) {
  const middle = median(values);
  return median(values.map((value) => Math.abs(value - middle)));
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('golden journey identity contains a non-JSON value');
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
