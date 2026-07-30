#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { authenticatedPackedJourneyPackages } from './golden-journey.mjs';
import {
  discoverEnvSecrets,
  preserveRedactedFailureArtifact,
  redactSecrets,
} from './golden-journey/artifacts.mjs';
import {
  materializePackedPackage,
  rewriteScaffoldDependenciesToPackedTarballs,
} from './golden-journey/packed-app.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { measureProcessTreeCommand } from './lib/process-tree-rss.mjs';
import { manifestPath as defaultManifestPath, repoRoot } from './release-packages.mjs';

export const FULL_CATALOG_REPORT_SCHEMA = 'kovo-devex-full-catalog/v1';
export const FULL_CATALOG_SAMPLE_SCHEMA = 'kovo-devex-full-catalog-sample/v1';

const EXPECTED_COMPONENTS = 44;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const REQUIRED_CATALOG_PACKAGE_NAMES = Object.freeze([
  '@kovojs/core',
  '@kovojs/headless-ui',
  '@kovojs/icons',
  '@kovojs/ui',
  'create-kovo',
]);

export function packedUiComponentNames(packedPackages) {
  const ui = packedPackages.get('@kovojs/ui');
  const exports = ui?.manifest?.exports;
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) {
    throw new TypeError('authenticated @kovojs/ui manifest has no public exports');
  }
  const names = Object.keys(exports)
    .filter((subpath) => subpath !== '.')
    .map((subpath) => {
      if (!/^\.\/[a-z][a-z0-9-]*$/u.test(subpath)) {
        throw new TypeError(`@kovojs/ui contains a non-component public subpath ${subpath}`);
      }
      return subpath.slice(2);
    })
    .sort(compareUtf8);
  if (names.length !== EXPECTED_COMPONENTS || new Set(names).size !== EXPECTED_COMPONENTS) {
    throw new Error(
      `authenticated @kovojs/ui must expose exactly ${String(EXPECTED_COMPONENTS)} component subpaths; found ${String(names.length)}`,
    );
  }
  return Object.freeze(names);
}

export function runFullCatalogReproducer({
  artifactRoot,
  budgets,
  commandRunner = runMeasuredCommand,
  packedPackages,
  samples = 1,
  temporaryParent = tmpdir(),
} = {}) {
  if (!(packedPackages instanceof Map)) {
    throw new TypeError('full-catalog reproducer requires authenticated packed packages');
  }
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20) {
    throw new TypeError('full-catalog samples must be an integer from 1 through 20');
  }
  const components = packedUiComponentNames(packedPackages);
  const budget = fullCatalogBudget(budgets);
  const resolvedArtifactRoot = path.resolve(
    artifactRoot ?? path.join(repoRoot, '.release/devex/full-catalog'),
  );
  mkdirSync(resolvedArtifactRoot, { recursive: true });
  const observations = [];
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    observations.push(
      runFullCatalogSample({
        artifactRoot: resolvedArtifactRoot,
        budget,
        commandRunner,
        components,
        packedPackages,
        sampleIndex,
        temporaryParent,
      }),
    );
  }
  const statisticalPeakRssBytes = observations
    .map((sample) => sample.peakProcessTreeRssBytes)
    .filter((value) => Number.isFinite(value));
  const report = {
    schema: FULL_CATALOG_REPORT_SCHEMA,
    packageSet: [...packedPackages.values()]
      .map((pkg) => ({ name: pkg.name, sha512: pkg.sha512, version: pkg.version }))
      .sort((left, right) => compareUtf8(left.name, right.name)),
    catalog: {
      componentCount: components.length,
      components,
      source: '@kovojs/ui packed manifest exports',
    },
    budget,
    sampleCount: samples,
    samples: observations,
    metrics: {
      'ui.fullCatalog.peakRssBytes': {
        samples: statisticalPeakRssBytes,
        unit: 'bytes',
      },
    },
    pass: observations.every((sample) => sample.pass),
  };
  const findings = validateFullCatalogReport(report);
  if (findings.length > 0) {
    throw new Error(
      `full-catalog reproducer emitted invalid evidence:\n- ${findings.join('\n- ')}`,
    );
  }
  return Object.freeze(report);
}

export function runFullCatalogSample({
  artifactRoot,
  budget,
  commandRunner,
  components,
  packedPackages,
  sampleIndex,
  temporaryParent,
}) {
  const temporaryRoot = mkdtempSync(path.join(temporaryParent, 'kovo-full-catalog-'));
  const creatorRoot = path.join(temporaryRoot, 'creator');
  const appRoot = path.join(temporaryRoot, 'app');
  const storeRoot = path.join(temporaryRoot, 'pnpm-store');
  const transcripts = [];
  const phases = [];
  let secretValues = Object.freeze([]);
  let copiedComponentCount = 0;
  let catalogUnimported = false;
  try {
    mkdirSync(path.join(creatorRoot, 'node_modules', '@kovojs'), { recursive: true });
    materializePackedPackage(
      packedPackages.get('create-kovo'),
      path.join(creatorRoot, 'node_modules/create-kovo'),
    );
    materializePackedPackage(
      packedPackages.get('@kovojs/core'),
      path.join(creatorRoot, 'node_modules/@kovojs/core'),
    );
    const creator = path.join(creatorRoot, 'node_modules/create-kovo/dist/index.mjs');
    phases.push(
      requireCatalogPhaseSuccess(
        'create',
        observe(
          'create',
          commandRunner(fullCatalogCreatorCommand(creator, appRoot, sampleIndex), {
            cwd: temporaryRoot,
            phase: 'create',
          }),
          transcripts,
        ),
      ),
    );
    secretValues = discoverEnvSecrets(appRoot).values;
    rewriteScaffoldDependenciesToPackedTarballs(appRoot, packedPackages);
    declarePackedCatalogDependencies(appRoot, packedPackages);
    phases.push(
      requireCatalogPhaseSuccess(
        'install',
        observe(
          'install',
          commandRunner(
            [
              'pnpm',
              'install',
              '--ignore-workspace',
              '--no-frozen-lockfile',
              '--store-dir',
              storeRoot,
            ],
            { cwd: appRoot, phase: 'install' },
          ),
          transcripts,
        ),
      ),
    );

    const outputDirectory = 'src/components/ui';
    phases.push(
      requireCatalogPhaseSuccess(
        'copy',
        observe(
          'copy',
          commandRunner(['pnpm', 'exec', 'kovo', 'add', ...components, '--out', outputDirectory], {
            cwd: appRoot,
            phase: 'copy',
          }),
          transcripts,
        ),
      ),
    );
    copiedComponentCount = copiedCatalogComponentCount(appRoot, outputDirectory, components);
    assertCopiedCatalog(appRoot, outputDirectory, components);
    assertCatalogUnimported(appRoot, outputDirectory);
    catalogUnimported = true;

    for (const [phase, command] of [
      ['typecheck', ['pnpm', 'exec', 'tsc', '--noEmit']],
      ['check', ['pnpm', 'run', 'check']],
      ['build', ['pnpm', 'run', 'build:prod']],
    ]) {
      phases.push(
        requireCatalogPhaseSuccess(
          phase,
          observe(phase, commandRunner(command, { cwd: appRoot, phase }), transcripts),
        ),
      );
    }
    const peakProcessTreeRssBytes = Math.max(
      ...phases
        .map((phase) => phase.peakProcessTreeRssBytes)
        .filter((value) => Number.isFinite(value)),
    );
    const withinThreshold = peakProcessTreeRssBytes <= budget.thresholdBytes;
    return Object.freeze({
      schema: FULL_CATALOG_SAMPLE_SCHEMA,
      sampleIndex,
      copiedComponents: components.length,
      copiedSourceFiles: copiedCatalogFiles(appRoot, outputDirectory).length,
      unimportedDuringProof: true,
      phases,
      peakProcessTreeRssBytes,
      budget: {
        binding: budget.binding,
        thresholdBytes: budget.thresholdBytes,
        withinThreshold,
      },
      functionalPass: true,
      pass: budget.binding ? withinThreshold : true,
      failure: null,
    });
  } catch (error) {
    if (error instanceof CatalogPhaseError && error.evidence !== null) {
      phases.push(error.evidence);
    }
    const peakProcessTreeRssBytes = Math.max(
      0,
      ...phases
        .map((phase) => phase.peakProcessTreeRssBytes)
        .filter((value) => Number.isFinite(value)),
    );
    const artifact = existsSync(appRoot)
      ? preserveRedactedFailureArtifact({
          appRoot,
          artifactRoot,
          label: `full-catalog-${String(sampleIndex + 1)}`,
          transcripts,
        })
      : null;
    return Object.freeze({
      schema: FULL_CATALOG_SAMPLE_SCHEMA,
      sampleIndex,
      copiedComponents:
        copiedComponentCount ||
        copiedCatalogComponentCount(appRoot, 'src/components/ui', components),
      copiedSourceFiles: copiedCatalogFiles(appRoot, 'src/components/ui').length,
      unimportedDuringProof: catalogUnimported,
      phases,
      peakProcessTreeRssBytes,
      budget: {
        binding: budget.binding,
        thresholdBytes: budget.thresholdBytes,
        withinThreshold:
          peakProcessTreeRssBytes > 0 && peakProcessTreeRssBytes <= budget.thresholdBytes,
      },
      functionalPass: false,
      pass: false,
      failure: {
        artifact:
          artifact === null
            ? null
            : {
                directory: path
                  .relative(artifactRoot, artifact.directory)
                  .split(path.sep)
                  .join('/'),
                sha256: artifact.sha256,
              },
        message: redactSecrets(
          boundedText(error instanceof Error ? error.message : String(error), 16 * 1024),
          secretValues,
        ),
        phase: error instanceof CatalogPhaseError ? error.phase : 'infrastructure',
      },
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/**
 * Create the production-build fixture with an explicit deploy-skew retention proof.
 *
 * The full-catalog journey is a controlled local measurement, not a deployment recommendation.
 * Its build phase must exercise emitted production artifacts rather than stop at the starter's
 * intentionally unconfigured KV417 posture.
 */
export function fullCatalogCreatorCommand(creator, appRoot, sampleIndex) {
  return Object.freeze([
    process.execPath,
    creator,
    appRoot,
    '--name',
    `kovo-full-catalog-${String(sampleIndex + 1)}`,
    '--postgres',
    '--retention',
    'retained-24h',
    '--disable-git',
  ]);
}

export function validateFullCatalogReport(report) {
  const findings = [];
  if (report?.schema !== FULL_CATALOG_REPORT_SCHEMA) {
    findings.push(`schema must be ${FULL_CATALOG_REPORT_SCHEMA}`);
  }
  const packageNames = new Set();
  if (!Array.isArray(report?.packageSet)) {
    findings.push('packageSet must be an authenticated package identity array');
  } else {
    for (const [index, pkg] of report.packageSet.entries()) {
      if (
        typeof pkg?.name !== 'string' ||
        typeof pkg?.version !== 'string' ||
        !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(pkg?.sha512 ?? '')
      ) {
        findings.push(`packageSet[${String(index)}] has invalid identity evidence`);
        continue;
      }
      if (packageNames.has(pkg.name)) findings.push(`packageSet duplicates ${pkg.name}`);
      packageNames.add(pkg.name);
    }
    for (const packageName of REQUIRED_CATALOG_PACKAGE_NAMES) {
      if (!packageNames.has(packageName)) findings.push(`packageSet omits ${packageName}`);
    }
  }
  const catalogComponents = report?.catalog?.components;
  if (
    report?.catalog?.componentCount !== EXPECTED_COMPONENTS ||
    !Array.isArray(catalogComponents) ||
    catalogComponents.length !== EXPECTED_COMPONENTS ||
    new Set(catalogComponents).size !== EXPECTED_COMPONENTS ||
    catalogComponents.some((component) => !/^[a-z][a-z0-9-]*$/u.test(component)) ||
    JSON.stringify(catalogComponents) !== JSON.stringify([...catalogComponents].sort(compareUtf8))
  ) {
    findings.push('catalog must contain exactly 44 unique sorted authenticated components');
  }
  if (
    typeof report?.budget?.binding !== 'boolean' ||
    !Number.isFinite(report?.budget?.thresholdBytes) ||
    report.budget.thresholdBytes <= 0
  ) {
    findings.push('budget must identify a positive threshold and binding posture');
  }
  if (!Number.isSafeInteger(report?.sampleCount) || report.sampleCount < 1) {
    findings.push('sampleCount must be positive');
  }
  if (!Array.isArray(report?.samples) || report.samples.length !== report?.sampleCount) {
    findings.push('samples must match sampleCount');
    return findings;
  }
  for (const [index, sample] of report.samples.entries()) {
    const label = `samples[${index}]`;
    if (sample?.schema !== FULL_CATALOG_SAMPLE_SCHEMA) {
      findings.push(`${label}.schema is invalid`);
    }
    if (sample?.sampleIndex !== index) findings.push(`${label}.sampleIndex is invalid`);
    if (typeof sample?.pass !== 'boolean' || typeof sample?.functionalPass !== 'boolean') {
      findings.push(`${label} pass fields are invalid`);
    }
    if (!Number.isFinite(sample?.peakProcessTreeRssBytes)) {
      findings.push(`${label}.peakProcessTreeRssBytes is invalid`);
    }
    const phaseNames = new Set();
    const phasePeaks = [];
    if (!Array.isArray(sample?.phases)) {
      findings.push(`${label}.phases must be an array`);
    } else {
      for (const [phaseIndex, phase] of sample.phases.entries()) {
        if (
          typeof phase?.name !== 'string' ||
          !Number.isFinite(phase?.durationMs) ||
          phase.durationMs < 0 ||
          (phase.status !== null && !Number.isInteger(phase.status)) ||
          !Number.isFinite(phase?.peakProcessTreeRssBytes) ||
          phase.peakProcessTreeRssBytes < 0
        ) {
          findings.push(`${label}.phases[${String(phaseIndex)}] has invalid evidence`);
          continue;
        }
        if (phaseNames.has(phase.name)) findings.push(`${label}.phases duplicates ${phase.name}`);
        phaseNames.add(phase.name);
        phasePeaks.push(phase.peakProcessTreeRssBytes);
      }
    }
    if (phasePeaks.length === 0 || sample.peakProcessTreeRssBytes !== Math.max(...phasePeaks)) {
      findings.push(`${label}.peakProcessTreeRssBytes does not match phase evidence`);
    }
    if (
      sample?.budget?.binding !== report?.budget?.binding ||
      sample?.budget?.thresholdBytes !== report?.budget?.thresholdBytes ||
      sample?.budget?.withinThreshold !==
        (sample?.peakProcessTreeRssBytes > 0 &&
          sample.peakProcessTreeRssBytes <= report?.budget?.thresholdBytes)
    ) {
      findings.push(`${label}.budget does not match report threshold and observed peak`);
    }
    if (
      !Number.isSafeInteger(sample?.copiedComponents) ||
      sample.copiedComponents < 0 ||
      sample.copiedComponents > EXPECTED_COMPONENTS
    ) {
      findings.push(`${label}.copiedComponents is invalid`);
    }
    if (sample?.functionalPass) {
      if (sample.copiedComponents !== EXPECTED_COMPONENTS || !sample.unimportedDuringProof) {
        findings.push(`${label} did not prove all 44 unimported copied components`);
      }
      for (const phase of ['create', 'install', 'copy', 'typecheck', 'check', 'build']) {
        if (!sample.phases.some((entry) => entry.name === phase && entry.status === 0)) {
          findings.push(`${label} is missing successful ${phase}`);
        }
      }
      if (sample.failure !== null) findings.push(`${label}.failure must be null on success`);
    } else if (
      typeof sample?.failure?.phase !== 'string' ||
      typeof sample?.failure?.message !== 'string'
    ) {
      findings.push(`${label}.failure is invalid`);
    }
    const expectedPass =
      sample?.functionalPass === true &&
      (sample?.budget?.binding !== true || sample?.budget?.withinThreshold === true);
    if (sample?.pass !== expectedPass) {
      findings.push(`${label} does not enforce functional and binding RSS outcomes`);
    }
  }
  if (report.pass !== report.samples.every((sample) => sample.pass)) {
    findings.push('report.pass does not match sample outcomes');
  }
  const metricSamples = report?.metrics?.['ui.fullCatalog.peakRssBytes']?.samples;
  if (
    !Array.isArray(metricSamples) ||
    metricSamples.length !== report.samples.length ||
    metricSamples.some((value, index) => value !== report.samples[index].peakProcessTreeRssBytes)
  ) {
    findings.push('full-catalog metric samples do not match sample evidence');
  }
  return findings;
}

export function fullCatalogBudget(budgets) {
  const metric = budgets?.metrics?.['ui.fullCatalog.peakRssBytes'];
  if (!metric || metric.unit !== 'bytes' || metric.direction !== 'max') {
    throw new TypeError('devex budgets do not define ui.fullCatalog.peakRssBytes');
  }
  if (metric.ratification !== null) {
    if (!Number.isFinite(metric.ratification?.threshold)) {
      throw new TypeError('ratified full-catalog threshold is invalid');
    }
    return Object.freeze({
      binding: true,
      source: 'ratified',
      thresholdBytes: metric.ratification.threshold,
    });
  }
  if (!Number.isFinite(metric.provisionalTarget)) {
    throw new TypeError('unratified full-catalog metric requires an explicit provisional target');
  }
  return Object.freeze({
    binding: false,
    source: 'provisional',
    thresholdBytes: metric.provisionalTarget,
  });
}

export function assertCopiedCatalog(appRoot, outputDirectory, components) {
  const files = copiedCatalogFiles(appRoot, outputDirectory);
  for (const component of components) {
    if (!files.includes(`${component}.tsx`)) {
      throw new CatalogPhaseError('copy', `copied catalog omitted ${component}.tsx`);
    }
  }
}

/**
 * The memory reproducer isolates checking the complete copied source closure. Predeclaring the two
 * catalog-only runtime packages keeps `kovo add` from testing its separate dependency-spec
 * inference path, while still installing those dependencies from authenticated tarballs.
 */
export function declarePackedCatalogDependencies(appRoot, packedPackages) {
  const manifestPath = path.join(appRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dependencies = { ...manifest.dependencies };
  for (const packageName of ['@kovojs/headless-ui', '@kovojs/icons']) {
    const pkg = packedPackages.get(packageName);
    if (!pkg?.tarballPath) {
      throw new TypeError(`full-catalog reproducer is missing authenticated ${packageName}`);
    }
    dependencies[packageName] = pathToFileURL(pkg.tarballPath).href;
  }
  manifest.dependencies = Object.fromEntries(
    Object.entries(dependencies).sort(([left], [right]) => compareUtf8(left, right)),
  );
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function assertCatalogUnimported(appRoot, outputDirectory) {
  const normalizedOutput = outputDirectory.split(path.sep).join('/');
  for (const relative of sourceFiles(path.join(appRoot, 'src'))) {
    const appRelative = `src/${relative}`;
    if (appRelative.startsWith(`${normalizedOutput}/`)) continue;
    const source = readFileSync(path.join(appRoot, 'src', ...relative.split('/')), 'utf8');
    if (
      source.includes('/components/ui/') ||
      source.includes('./components/ui') ||
      source.includes('../components/ui')
    ) {
      throw new CatalogPhaseError(
        'copy',
        `${appRelative} imports copied UI; the reproducer requires unimported files`,
      );
    }
  }
}

function copiedCatalogFiles(appRoot, outputDirectory) {
  const root = path.join(appRoot, ...outputDirectory.split('/'));
  if (!existsSync(root)) return [];
  return sourceFiles(root);
}

function copiedCatalogComponentCount(appRoot, outputDirectory, components) {
  const files = new Set(copiedCatalogFiles(appRoot, outputDirectory));
  return components.filter((component) => files.has(`${component}.tsx`)).length;
}

function sourceFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareUtf8(left.name, right.name),
    )) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
      else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) files.push(relative);
    }
  };
  walk(root);
  return files;
}

function runMeasuredCommand(command, { cwd, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  return measureProcessTreeCommand(command, {
    cwd,
    env: { CI: '1', NO_COLOR: '1', npm_config_audit: 'false', npm_config_fund: 'false' },
    maxBuffer: 128 * 1024 * 1024,
    timeoutMs,
  });
}

function observe(phase, observation, transcripts) {
  transcripts.push({
    phase,
    signal: observation.signal,
    status: observation.exitCode,
    stderr: observation.stderr,
    stdout: observation.stdout,
  });
  return observation;
}

export function requireCatalogPhaseSuccess(phase, observation) {
  const evidence = {
    durationMs: observation.durationMs,
    name: phase,
    peakProcessTreeRssBytes: observation.peakRssBytes,
    status: observation.exitCode,
  };
  if (observation.exitCode !== 0 || observation.signal || observation.error) {
    throw new CatalogPhaseError(
      phase,
      [
        `${phase} failed exit=${String(observation.exitCode)} signal=${String(observation.signal)}`,
        observation.error,
        observation.stderr,
        observation.stdout,
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 16 * 1024),
      evidence,
    );
  }
  return evidence;
}

function parseArgs(argv) {
  const options = {
    artifactRoot: path.join(repoRoot, '.release/devex/full-catalog'),
    budgets: path.join(repoRoot, 'devex-budgets.json'),
    packedManifest: defaultManifestPath,
    samples: 1,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (
      token === '--artifacts' ||
      token === '--budgets' ||
      token === '--output' ||
      token === '--packed-manifest' ||
      token === '--samples'
    ) {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new Error(`${token} requires a value`);
      if (token === '--artifacts') options.artifactRoot = path.resolve(repoRoot, value);
      if (token === '--budgets') options.budgets = path.resolve(repoRoot, value);
      if (token === '--output') options.output = path.resolve(repoRoot, value);
      if (token === '--packed-manifest') options.packedManifest = path.resolve(repoRoot, value);
      if (token === '--samples') options.samples = Number(value);
      continue;
    }
    if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`unknown full-catalog argument ${token}`);
  }
  return options;
}

export function runFullCatalogCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(
      'Usage: node scripts/full-catalog-reproducer.mjs [--packed-manifest FILE] [--samples N] [--output FILE] [--artifacts DIR]\n',
    );
    return 0;
  }
  const report = runFullCatalogReproducer({
    artifactRoot: options.artifactRoot,
    budgets: JSON.parse(readFileSync(options.budgets, 'utf8')),
    packedPackages: authenticatedPackedJourneyPackages(options.packedManifest),
    samples: options.samples,
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    mkdirSync(path.dirname(options.output), { recursive: true });
    writeFileSync(options.output, output, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(output);
  return report.pass ? 0 : 1;
}

class CatalogPhaseError extends Error {
  constructor(phase, message, evidence = null) {
    super(message);
    this.name = 'CatalogPhaseError';
    this.phase = phase;
    this.evidence = evidence;
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function boundedText(value, maxBytes) {
  const text = String(value);
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const marker = '\n[TRUNCATED]';
  const contentBytes = Math.max(0, maxBytes - Buffer.byteLength(marker));
  let truncated = Buffer.from(text).subarray(0, contentBytes).toString('utf8');
  while (Buffer.byteLength(truncated) > contentBytes) truncated = truncated.slice(0, -1);
  return `${truncated}${marker}`;
}

if (isMainEntry(import.meta.url)) await runGate(runFullCatalogCli);
