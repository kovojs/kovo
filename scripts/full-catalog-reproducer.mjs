#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus, release as osRelease, tmpdir, version as osVersion } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEVEX_FULL_CATALOG_REPORT_SCHEMA,
  DEVEX_FULL_CATALOG_SAMPLE_SCHEMA,
  collectDevexEnvironment,
  createFullCatalogWorkloadDefinition,
  createRunnerFingerprint,
  fullCatalogPackageSetDigest,
  fullCatalogScenarioDigest,
  validateBudgets,
  validateFullCatalogReportIdentity,
} from './devex-benchmark.mjs';
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

export const FULL_CATALOG_REPORT_SCHEMA = DEVEX_FULL_CATALOG_REPORT_SCHEMA;
export const FULL_CATALOG_SAMPLE_SCHEMA = DEVEX_FULL_CATALOG_SAMPLE_SCHEMA;

const EXPECTED_COMPONENTS = 44;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

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
  packedRelease,
  runner,
  samples = 1,
  source,
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
  const packageSet = [...packedPackages.values()]
    .map((pkg) => ({ name: pkg.name, sha512: pkg.sha512, version: pkg.version }))
    .sort((left, right) => compareUtf8(left.name, right.name));
  const catalog = {
    componentCount: components.length,
    components,
    source: '@kovojs/ui packed manifest exports',
  };
  const workload = createFullCatalogWorkloadDefinition(catalog, packageSet);
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
    runner,
    source,
    packedRelease: {
      ...packedRelease,
      packageSetSha256: fullCatalogPackageSetDigest(packageSet),
    },
    scenario: {
      name: workload.name,
      digest: fullCatalogScenarioDigest(workload),
      definition: workload,
    },
    packageSet,
    catalog,
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
  return validateFullCatalogReportIdentity(report);
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
  const environment = collectFullCatalogEnvironment();
  const packedManifestBytes = readFileSync(options.packedManifest);
  const packedManifest = JSON.parse(packedManifestBytes.toString('utf8'));
  const budgets = JSON.parse(readFileSync(options.budgets, 'utf8'));
  const budgetFindings = validateBudgets(budgets, {
    repoRoot: path.dirname(options.budgets),
  });
  if (budgetFindings.length > 0) {
    throw new Error(
      `full-catalog reproducer requires valid DevEx budgets:\n- ${budgetFindings.join('\n- ')}`,
    );
  }
  const report = runFullCatalogReproducer({
    artifactRoot: options.artifactRoot,
    budgets,
    packedPackages: authenticatedPackedJourneyPackages(options.packedManifest),
    packedRelease: {
      schema: packedManifest.schema,
      manifestSha256: digestSha256(packedManifestBytes),
    },
    runner: createRunnerFingerprint({
      name: environment.runnerName,
      platform: environment.platform,
      arch: environment.arch,
      node: environment.node,
      cpuModel: environment.cpuModel,
      packageManager: environment.packageManager,
      osImage: environment.osImage,
    }),
    samples: options.samples,
    source: {
      commit: environment.sourceCommit,
      tree: environment.sourceTree,
    },
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

function digestSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function collectFullCatalogEnvironment() {
  if (process.env.KOVO_DEVEX_OS_IMAGE || process.env.KOVO_DEVEX_RUNNER_NAME) {
    return collectDevexEnvironment();
  }
  const sourceCommit = checkedOutput('git', ['rev-parse', 'HEAD']);
  const dirtyPaths = checkedOutput('git', ['status', '--porcelain=v1', '--untracked-files=all']);
  if (dirtyPaths !== '') {
    throw new Error('full-catalog evidence requires a clean source revision');
  }
  const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packageManager = rootManifest.packageManager;
  if (
    typeof packageManager !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(packageManager)
  ) {
    throw new Error('root package.json must pin an exact package manager');
  }
  return {
    runnerName: 'local-full-catalog-observation',
    sourceCommit,
    sourceTree: 'clean',
    packageManager,
    osImage: `local/${process.platform}@${digestSha256(
      Buffer.from(`${osRelease()}\0${osVersion()}`),
    )}`,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpuModel: cpus()[0]?.model ?? 'unknown',
  };
}

function checkedOutput(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(
      `${executable} ${args.join(' ')} failed while identifying full-catalog evidence: ${
        result.error?.message ?? result.signal ?? result.stderr ?? `exit ${String(result.status)}`
      }`,
    );
  }
  return result.stdout.trim();
}

if (isMainEntry(import.meta.url)) await runGate(runFullCatalogCli);
