import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { applyEgressFloorEnv } from '../egress-floor.mjs';
import {
  discoverEnvSecrets,
  preserveRedactedFailureArtifact,
  redactSecrets,
} from './artifacts.mjs';

export const offlineAgentScenario = 'offline-agent';
export const offlineAgentReportSchema = 'kovo.golden-journey/offline-agent/v1';
export const diagnosticEnvelopeVersion = 'kovo-diagnostic/v1';
export const docsResultVersion = 'kovo-docs/v1';

const SOURCE_PATH = 'src/queries.ts';
const ACCESS_LINE = '  access: [appAuthed],\n';
const QUERY_OPEN = 'export const contactsQuery = query({\n';
const COMMAND_TIMEOUT_MS = 240_000;
const COMMAND_MAX_BUFFER = 128 * 1024 * 1024;
const DIAGNOSTIC_CATEGORIES = new Set(['build', 'config', 'proof', 'runtime', 'usage']);
const DIAGNOSTIC_SEVERITIES = new Set(['error', 'warn', 'lint', 'notice']);

/**
 * Run G12 against authenticated package tarballs. The fixture deliberately has no callback that
 * can supply diagnostic prose or docs content: the repair receives only a parsed
 * `kovo-diagnostic/v1` envelope, digest-checked installed-doc excerpts, and authored source.
 */
export function runOfflineAgentJourney({
  artifactRoot,
  commandRunner = runOfflineCommand,
  packedPackages,
  temporaryParent = tmpdir(),
} = {}) {
  const packages = normalizePackedPackages(packedPackages);
  const temporaryRoot = mkdtempSync(path.join(temporaryParent, 'kovo-golden-offline-agent-'));
  const creatorRoot = path.join(temporaryRoot, 'creator');
  const appRoot = path.join(temporaryRoot, 'app');
  const phases = [];

  try {
    mkdirSync(path.join(creatorRoot, 'node_modules', '@kovojs'), { recursive: true });
    materializePackedPackage(
      packages.get('create-kovo'),
      path.join(creatorRoot, 'node_modules/create-kovo'),
    );
    materializePackedPackage(
      packages.get('@kovojs/core'),
      path.join(creatorRoot, 'node_modules/@kovojs/core'),
    );

    const creatorBin = path.join(creatorRoot, 'node_modules/create-kovo/dist/index.mjs');
    phases.push(
      requireSuccessfulPhase(
        'scaffold',
        commandRunner(
          process.execPath,
          [
            creatorBin,
            appRoot,
            '--name',
            'kovo-offline-agent-fixture',
            '--postgres',
            '--disable-git',
          ],
          {
            cwd: temporaryRoot,
          },
        ),
      ),
    );

    rewriteScaffoldDependenciesToPackedTarballs(appRoot, packages);
    phases.push(
      requireSuccessfulPhase(
        'install',
        commandRunner(
          'pnpm',
          [
            'install',
            '--offline',
            '--ignore-scripts',
            '--ignore-workspace',
            '--no-frozen-lockfile',
          ],
          { cwd: appRoot },
        ),
      ),
    );

    const updateDocs = commandRunner('pnpm', ['exec', 'kovo', 'update-docs'], { cwd: appRoot });
    phases.push(requireSuccessfulPhase('update-docs', updateDocs));
    assertUpdateDocsObservation(updateDocs);

    const originalSource = readFileSync(path.join(appRoot, SOURCE_PATH), 'utf8');
    const editedSource = introduceMissingAccess(originalSource);
    writeFileSync(path.join(appRoot, SOURCE_PATH), editedSource, 'utf8');

    const failingCheck = commandRunner(
      'pnpm',
      ['exec', 'kovo', 'check', 'source', './src/app.tsx', '--no-cache', '--format', 'json'],
      { cwd: appRoot },
    );
    const failingDiagnostics = parseDiagnosticObservation(failingCheck, {
      expectedExitCode: 1,
      sourceRoot: appRoot,
    });
    const accessDiagnostic = requireSingleMissingAccessDiagnostic(failingDiagnostics, editedSource);
    phases.push(phaseRecord('check-failing', failingCheck, diagnosticEnvelopeVersion));

    const docsObservation = commandRunner(
      'pnpm',
      ['exec', 'kovo', 'docs', 'KV436 default-deny', '--limit', '5', '--format', 'json'],
      { cwd: appRoot },
    );
    const docs = validateInstalledDocsObservation(docsObservation, { appRoot });
    phases.push(phaseRecord('docs', docsObservation, docsResultVersion));

    const repairedSource = repairMissingAccess({
      diagnostic: accessDiagnostic,
      docs,
      source: editedSource,
    });
    writeFileSync(path.join(appRoot, SOURCE_PATH), repairedSource, 'utf8');
    if (repairedSource !== originalSource) {
      throw new Error('Offline agent repair did not restore the scaffolded source exactly.');
    }

    const passingCheck = commandRunner(
      'pnpm',
      ['exec', 'kovo', 'check', 'source', './src/app.tsx', '--no-cache', '--format', 'json'],
      { cwd: appRoot },
    );
    const passingDiagnostics = parseDiagnosticObservation(passingCheck, {
      expectedExitCode: 0,
      sourceRoot: appRoot,
    });
    if (passingDiagnostics.length !== 0) {
      throw new Error('Passing offline agent check retained diagnostics.');
    }
    phases.push(phaseRecord('check-fixed', passingCheck, diagnosticEnvelopeVersion));

    const cli = packages.get('@kovojs/cli');
    const pointer = readInstalledDocsPointer(appRoot);
    return Object.freeze({
      diagnostics: Object.freeze({
        code: accessDiagnostic.code,
        source: Object.freeze({
          end: accessDiagnostic.source.end,
          file: SOURCE_PATH,
          start: accessDiagnostic.source.start,
        }),
        version: diagnosticEnvelopeVersion,
      }),
      docs: Object.freeze({
        resultCount: docs.length,
        snapshotDigest: pointer.snapshotDigest,
        version: pointer.version,
      }),
      network: Object.freeze({
        allowlist: Object.freeze([]),
        loopback: 'denied',
        mode: 'deny',
        packageManagerOffline: true,
      }),
      package: Object.freeze({
        name: cli.name,
        sha512: cli.sha512,
        version: cli.version,
      }),
      pass: true,
      phases: Object.freeze(phases),
      scenario: offlineAgentScenario,
      schema: offlineAgentReportSchema,
      source: Object.freeze({
        editedSha256: sha256(editedSource),
        fixedSha256: sha256(repairedSource),
        originalSha256: sha256(originalSource),
        path: SOURCE_PATH,
      }),
    });
  } catch (error) {
    const secretInventory = existsSync(appRoot)
      ? discoverEnvSecrets(appRoot)
      : Object.freeze({ keys: Object.freeze([]), values: Object.freeze([]) });
    const artifact =
      artifactRoot !== undefined && existsSync(appRoot)
        ? preserveRedactedFailureArtifact({
            appRoot,
            artifactRoot,
            label: 'offline-agent',
          })
        : null;
    return Object.freeze({
      agent: 'offline-json-and-local-docs-only',
      failure: Object.freeze({
        artifact:
          artifact === null
            ? null
            : Object.freeze({
                directory: path
                  .relative(artifactRoot, artifact.directory)
                  .split(path.sep)
                  .join('/'),
                manifest: path.relative(artifactRoot, artifact.manifest).split(path.sep).join('/'),
                sha256: artifact.sha256,
              }),
        message: redactSecrets(
          error instanceof Error ? error.message : String(error),
          secretInventory.values,
        ).slice(0, 4_096),
      }),
      pass: false,
      phases: Object.freeze(phases),
      scenario: offlineAgentScenario,
      schema: offlineAgentReportSchema,
    });
  } finally {
    // Scaffolded `.env` contains generated credentials; only the bounded redacted artifact above
    // can survive the fixture.
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

/**
 * Every journey process inherits both pnpm's hard offline posture and Kovo's network floor.
 * `KOVO_EGRESS_ALLOW_LOOPBACK=0` closes the local-proxy/live-doc escape left open for dev servers
 * by the ordinary build policy.
 */
export function offlineCommandEnvironment(baseEnv = process.env) {
  const env = applyEgressFloorEnv(
    {
      ...baseEnv,
      CI: '1',
      NO_COLOR: '1',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_ignore_scripts: 'true',
      npm_config_offline: 'true',
      pnpm_config_ignore_scripts: 'true',
      pnpm_config_offline: 'true',
    },
    { allowlist: [], mode: 'deny' },
  );
  delete env.FORCE_COLOR;
  env.KOVO_EGRESS_ALLOW_LOOPBACK = '0';
  return env;
}

export function runOfflineCommand(file, args, { cwd, env = process.env } = {}) {
  const startedAt = performance.now();
  const result = spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    env: offlineCommandEnvironment(env),
    maxBuffer: COMMAND_MAX_BUFFER,
    timeout: COMMAND_TIMEOUT_MS,
  });
  const observation = {
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    signal: result.signal,
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
  if (result.error !== undefined) {
    throw new Error(`Failed to run ${file}: ${result.error.message}`);
  }
  if (result.status === null) {
    throw new Error(
      `Command ${file} did not produce an exit status (signal=${String(result.signal)}).`,
    );
  }
  return observation;
}

/**
 * Parse exactly one diagnostic envelope from the contract-owned stream. JSON wrapped in a human
 * prefix/suffix, ANSI text, or a second line is rejected by JSON.parse; the inactive stream must
 * remain byte-empty so the fixture can never fall back to prose.
 */
export function parseDiagnosticObservation(observation, { expectedExitCode, sourceRoot } = {}) {
  assertProcessObservation(observation, 'diagnostic command');
  if (observation.status !== expectedExitCode) {
    throw new Error(
      `Diagnostic command exited ${String(observation.status)}; expected ${String(expectedExitCode)}:\n${boundedFailureOutput(observation)}`,
    );
  }
  if (expectedExitCode !== 0 && expectedExitCode !== 1) {
    throw new TypeError('Diagnostic adapter fixtures accept only success (0) or finding (1).');
  }
  const output = expectedExitCode === 0 ? observation.stdout : observation.stderr;
  const inactive = expectedExitCode === 0 ? observation.stderr : observation.stdout;
  if (inactive !== '') {
    throw new Error('Diagnostic command emitted a non-JSON side-channel on the inactive stream.');
  }
  const envelope = parseJsonObject(output, 'diagnostic command output');
  assertExactKeys(envelope, ['diagnostics', 'version'], 'diagnostic envelope');
  if (envelope.version !== diagnosticEnvelopeVersion || !Array.isArray(envelope.diagnostics)) {
    throw new Error(`Diagnostic command must emit ${diagnosticEnvelopeVersion}.`);
  }
  const diagnostics = envelope.diagnostics.map((record, index) =>
    validateDiagnosticRecord(record, `diagnostics[${index}]`, sourceRoot),
  );
  if (expectedExitCode === 0 && diagnostics.length !== 0) {
    throw new Error('Successful diagnostic command must emit an empty diagnostics array.');
  }
  if (expectedExitCode === 1 && diagnostics.length === 0) {
    throw new Error('Finding diagnostic command must emit at least one diagnostic.');
  }
  return Object.freeze(diagnostics);
}

/**
 * Authenticate JSON docs results against the content-addressed pointer and actual installed bytes.
 * An excerpt copied from a website, workspace source, stale snapshot, or structural lookalike cannot
 * satisfy the path, digest, version, and substring checks together.
 */
export function validateInstalledDocsObservation(observation, { appRoot }) {
  assertProcessObservation(observation, 'docs command');
  if (observation.status !== 0 || observation.stderr !== '') {
    throw new Error('Docs command must succeed with JSON-only stdout.');
  }
  const payload = parseJsonObject(observation.stdout, 'docs command output');
  assertExactKeys(payload, ['results', 'version'], 'docs result envelope');
  if (payload.version !== docsResultVersion || !Array.isArray(payload.results)) {
    throw new Error(`Docs command must emit ${docsResultVersion}.`);
  }
  if (payload.results.length === 0 || payload.results.length > 5) {
    throw new Error('Docs command must return 1..5 bounded installed results.');
  }

  const pointer = readInstalledDocsPointer(appRoot);
  const digestDirectory = pointer.snapshotDigest.slice('sha256:'.length);
  const results = payload.results.map((raw, index) => {
    const label = `docs results[${index}]`;
    if (!isRecord(raw)) throw new Error(`${label} must be an object.`);
    assertExactKeys(raw, ['excerpt', 'path', 'sha256', 'snapshotDigest', 'version'], label);
    if (
      typeof raw.excerpt !== 'string' ||
      raw.excerpt.length === 0 ||
      !isSafeSnapshotPath(raw.path) ||
      !isDigest(raw.sha256) ||
      raw.snapshotDigest !== pointer.snapshotDigest ||
      raw.version !== pointer.version
    ) {
      throw new Error(`${label} is malformed or does not match the installed snapshot.`);
    }
    const installedPath = path.join(
      appRoot,
      '.kovo',
      'docs',
      'snapshots',
      digestDirectory,
      ...raw.path.split('/'),
    );
    const installedRoot = path.join(appRoot, '.kovo', 'docs', 'snapshots', digestDirectory);
    const relative = path.relative(installedRoot, installedPath);
    if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${label} escaped the installed snapshot.`);
    }
    const stat = lstatSync(installedPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${label} did not resolve to a regular installed docs file.`);
    }
    const content = readFileSync(installedPath, 'utf8');
    if (sha256(content) !== raw.sha256 || !content.includes(raw.excerpt)) {
      throw new Error(`${label} excerpt is not authenticated by the installed file.`);
    }
    return Object.freeze({
      excerpt: raw.excerpt,
      path: raw.path,
      sha256: raw.sha256,
      snapshotDigest: raw.snapshotDigest,
      version: raw.version,
    });
  });
  return Object.freeze(results);
}

export function introduceMissingAccess(source) {
  if (typeof source !== 'string') throw new TypeError('Offline agent source must be a string.');
  if (occurrences(source, ACCESS_LINE) !== 1 || occurrences(source, QUERY_OPEN) !== 1) {
    throw new Error(
      'Packed starter query fixture does not contain one expected access declaration.',
    );
  }
  return source.replace(ACCESS_LINE, '');
}

/**
 * The repair is intentionally narrow, but not a hidden before/after file replacement. It proceeds
 * only when the registry-owned diagnostic identifies KV436, installed docs explain the explicit
 * access/guard remedy, and the edited source already imports and documents its app-owned guard.
 */
export function repairMissingAccess({ diagnostic, docs, source }) {
  if (
    !isRecord(diagnostic) ||
    diagnostic.code !== 'KV436' ||
    diagnostic.severity !== 'error' ||
    typeof diagnostic.message !== 'string' ||
    !/access/iu.test(diagnostic.message)
  ) {
    throw new Error('Offline repair requires the KV436 missing-access diagnostic.');
  }
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error('Offline repair requires installed docs results.');
  }
  const guidance = docs
    .map((result) => (isRecord(result) && typeof result.excerpt === 'string' ? result.excerpt : ''))
    .join('\n');
  if (
    !/KV436/iu.test(guidance) ||
    !/explicit access/iu.test(guidance) ||
    !/(?:publicAccess|guard|access\s*:)/u.test(guidance)
  ) {
    throw new Error('Installed docs do not explain the KV436 explicit-access remedy.');
  }
  if (
    typeof source !== 'string' ||
    !source.includes("import { appAuthed } from './auth.js';") ||
    !source.includes('KV436 access decision is the session-presence guard') ||
    occurrences(source, QUERY_OPEN) !== 1 ||
    source.includes(ACCESS_LINE)
  ) {
    throw new Error('Edited source lacks the scaffold-owned guard context for a safe repair.');
  }
  return source.replace(QUERY_OPEN, `${QUERY_OPEN}${ACCESS_LINE}`);
}

export function rewriteScaffoldDependenciesToPackedTarballs(appRoot, packedPackages) {
  const packages = normalizePackedPackages(packedPackages);
  const manifestPath = path.join(appRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const field of ['dependencies', 'devDependencies']) {
    const dependencies = manifest[field];
    if (!isRecord(dependencies)) continue;
    for (const name of Object.keys(dependencies)) {
      const pkg = packages.get(name);
      if (pkg !== undefined) dependencies[name] = pathToFileURL(pkg.tarballPath).href;
    }
  }
  const overrides = {};
  for (const [name, pkg] of packages) overrides[name] = pathToFileURL(pkg.tarballPath).href;
  manifest.pnpm = {
    ...(isRecord(manifest.pnpm) ? manifest.pnpm : {}),
    overrides: {
      ...(isRecord(manifest.pnpm?.overrides) ? manifest.pnpm.overrides : {}),
      ...overrides,
    },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function normalizePackedPackages(value) {
  const packages =
    value instanceof Map
      ? value
      : Array.isArray(value)
        ? new Map(value.map((pkg) => [pkg?.name, pkg]))
        : null;
  if (packages === null || packages.size === 0) {
    throw new TypeError('Offline agent journey requires authenticated packed packages.');
  }
  for (const required of ['@kovojs/cli', '@kovojs/core', 'create-kovo']) {
    if (!packages.has(required)) {
      throw new Error(`Packed release is missing ${required}.`);
    }
  }
  for (const [name, pkg] of packages) {
    if (
      typeof name !== 'string' ||
      !isRecord(pkg) ||
      pkg.name !== name ||
      typeof pkg.version !== 'string' ||
      typeof pkg.sha512 !== 'string' ||
      typeof pkg.tarballPath !== 'string' ||
      !Array.isArray(pkg.entries)
    ) {
      throw new TypeError(`Packed package ${String(name)} is not authenticated journey input.`);
    }
  }
  return packages;
}

function materializePackedPackage(pkg, destination) {
  if (pkg === undefined) throw new TypeError('Packed package is missing.');
  const declaredDestinationRoot = path.resolve(destination);
  mkdirSync(declaredDestinationRoot, { recursive: true });
  const destinationRoot = realpathSync(declaredDestinationRoot);
  for (const entry of pkg.entries) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !Buffer.isBuffer(entry.data)) {
      throw new TypeError(`${pkg.name} contains an invalid authenticated tar entry.`);
    }
    if (!entry.name.startsWith('package/')) {
      throw new Error(`${pkg.name} tar entry is outside package/.`);
    }
    const relativePath = entry.name.slice('package/'.length);
    if (!isSafeSnapshotPath(relativePath)) {
      throw new Error(`${pkg.name} contains unsafe tar entry ${JSON.stringify(entry.name)}.`);
    }
    const target = path.join(destinationRoot, ...relativePath.split('/'));
    const relative = path.relative(destinationRoot, target);
    if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${pkg.name} tar entry escaped its materialization root.`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.data, {
      flag: 'wx',
      mode: entry.executable === true ? 0o755 : 0o644,
    });
  }
}

function assertUpdateDocsObservation(observation) {
  if (
    observation.stderr !== '' ||
    !/^kovo-update-docs\/v1\nOK source=installed-package version=[^\s]+ files=\d+\nOK snapshot=sha256:[a-f0-9]{64} current=\.kovo\/docs\/current\.json\n$/u.test(
      observation.stdout,
    )
  ) {
    throw new Error('Packed update-docs did not select its authenticated installed snapshot.');
  }
}

function readInstalledDocsPointer(appRoot) {
  const pointerPath = path.join(appRoot, '.kovo', 'docs', 'current.json');
  const stat = lstatSync(pointerPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) {
    throw new Error('Installed docs pointer must be one bounded regular file.');
  }
  const pointer = parseJsonObject(readFileSync(pointerPath, 'utf8'), 'installed docs pointer');
  assertExactKeys(
    pointer,
    ['publicManifestDigest', 'schema', 'snapshotDigest', 'sourceCommit', 'version'],
    'installed docs pointer',
  );
  if (
    pointer.schema !== 'kovo.installed-agent-docs-current/v1' ||
    !isDigest(pointer.publicManifestDigest) ||
    !isDigest(pointer.snapshotDigest) ||
    typeof pointer.sourceCommit !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(pointer.sourceCommit) ||
    typeof pointer.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(pointer.version)
  ) {
    throw new Error('Installed docs pointer is malformed.');
  }
  return pointer;
}

function requireSingleMissingAccessDiagnostic(diagnostics, source) {
  if (diagnostics.length !== 1 || diagnostics[0]?.code !== 'KV436') {
    throw new Error('Edited packed starter must produce exactly one KV436 diagnostic.');
  }
  const diagnostic = diagnostics[0];
  if (
    diagnostic.severity !== 'error' ||
    !/query/iu.test(diagnostic.message) ||
    !/access/iu.test(`${diagnostic.message} ${diagnostic.help}`) ||
    (!diagnostic.source.file.replaceAll('\\', '/').endsWith(`/${SOURCE_PATH}`) &&
      diagnostic.source.file.replaceAll('\\', '/') !== SOURCE_PATH)
  ) {
    throw new Error('KV436 diagnostic does not identify the edited query access decision.');
  }
  if (diagnostic.source.end > source.length) {
    throw new Error('KV436 source anchor is outside the edited authored source.');
  }
  return diagnostic;
}

function validateDiagnosticRecord(value, label, sourceRoot) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  assertExactKeys(
    value,
    ['category', 'code', 'help', 'message', 'severity', 'source', 'version'],
    label,
  );
  if (
    !DIAGNOSTIC_CATEGORIES.has(value.category) ||
    typeof value.code !== 'string' ||
    !/^(?:KV\d{3}|KOVO_[A-Z0-9_]+)$/u.test(value.code) ||
    typeof value.help !== 'string' ||
    value.help.length === 0 ||
    typeof value.message !== 'string' ||
    value.message.length === 0 ||
    !DIAGNOSTIC_SEVERITIES.has(value.severity) ||
    value.version !== diagnosticEnvelopeVersion
  ) {
    throw new Error(`${label} does not satisfy the structured diagnostic contract.`);
  }
  if (!isRecord(value.source)) throw new Error(`${label}.source must be an object.`);
  assertExactKeys(value.source, ['end', 'file', 'start'], `${label}.source`);
  if (
    typeof value.source.file !== 'string' ||
    value.source.file.length === 0 ||
    !Number.isSafeInteger(value.source.start) ||
    !Number.isSafeInteger(value.source.end) ||
    value.source.start < 0 ||
    value.source.end < value.source.start
  ) {
    throw new Error(`${label}.source must be a finite increasing UTF-16 range.`);
  }
  if (sourceRoot !== undefined) {
    const candidate = path.isAbsolute(value.source.file)
      ? path.resolve(value.source.file)
      : path.resolve(sourceRoot, value.source.file);
    const relative = path.relative(sourceRoot, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${label}.source escapes the scaffold root.`);
    }
  }
  return Object.freeze({
    category: value.category,
    code: value.code,
    help: value.help,
    message: value.message,
    severity: value.severity,
    source: Object.freeze({
      end: value.source.end,
      file: value.source.file,
      start: value.source.start,
    }),
    version: value.version,
  });
}

function requireSuccessfulPhase(name, observation) {
  assertProcessObservation(observation, name);
  if (observation.status !== 0) {
    throw new Error(
      `${name} failed with exit ${String(observation.status)}:\n${boundedFailureOutput(observation)}`,
    );
  }
  return phaseRecord(name, observation);
}

function phaseRecord(name, observation, outputProtocol) {
  return Object.freeze({
    durationMs: observation.durationMs,
    exitCode: observation.status,
    name,
    ...(outputProtocol === undefined ? {} : { outputProtocol }),
  });
}

function assertProcessObservation(value, label) {
  if (
    !isRecord(value) ||
    typeof value.stdout !== 'string' ||
    typeof value.stderr !== 'string' ||
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    (value.status !== 0 && value.status !== 1 && value.status !== 2)
  ) {
    throw new TypeError(`${label} observation is malformed.`);
  }
}

function boundedFailureOutput(observation) {
  const value = `${observation.stdout}${observation.stderr}`;
  return value.length > 8_192 ? `${value.slice(0, 8_192)}…` : value;
}

function parseJsonObject(source, label) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${label} must be exactly one JSON object.`);
  }
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareStrings);
  const sortedExpected = [...expected].sort(compareStrings);
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} must contain exactly ${sortedExpected.join(', ')}.`);
  }
}

function isSafeSnapshotPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 240 &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.startsWith('/') &&
    !value.includes('://') &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value)
  );
}

function isDigest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function compareStrings(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
