#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  readPackedReleaseManifest,
  validatePackedReleaseManifest,
  verifyPackedAttestation,
} from './publish-packed-packages.mjs';
import { releasePackages, repoRoot } from './release-packages.mjs';

export const G11_CLOUD_RUN_PROOF_SCHEMA = 'kovo.devex/g11-cloud-run-proof/v1';
export const G11_CLOUD_RUN_CONTEXT_SCHEMA = 'kovo.devex/g11-cloud-run-context/v1';
export const G11_CLOUD_RUN_SWEEP_SCHEMA = 'kovo.devex/g11-cloud-run-sweep/v1';
export const G11_CLOUD_RUN_RETENTION_HOURS = 24;
export const G11_CLOUD_RUN_SERVICE_PREFIX = 'kovo-g11-';

const RETENTION_BUFFER_HOURS = 2;
const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;
const PUBLIC_PROBE_TIMEOUT_MS = 30_000;
const REQUIRED_CREATOR_FLAGS = Object.freeze([
  '--disable-git',
  '--experimental-sqlite',
  '--no-install',
  '--sqlite',
  '--deployment',
  'node',
  '--retention',
  'retained-24h',
]);
const RETENTION_CONFIG_FRAGMENT = Object.freeze([
  'preset: node({',
  'retention: {',
  'hours: 24,',
  "immutableClientModules: 'retained',",
  "priorTokenQueryReads: 'retained',",
]);

export function cloudRunServiceName(runId, runAttempt) {
  const normalizedRunId = requiredDigits(runId, 'GitHub run id');
  const normalizedAttempt = requiredDigits(runAttempt, 'GitHub run attempt');
  const service = `${G11_CLOUD_RUN_SERVICE_PREFIX}${normalizedRunId}-${normalizedAttempt}`;
  if (service.length > 63) {
    throw new TypeError('G11 Cloud Run service name exceeds the 63-character platform limit.');
  }
  return service;
}

export function cloudRunJourneyPlan({ runAttempt, runId, sourceSha, startedAtEpochSeconds }) {
  const startedAt = requiredNonnegativeInteger(startedAtEpochSeconds, 'journey start epoch');
  const normalizedSourceSha = requiredSourceSha(sourceSha);
  const retentionUntilEpochSeconds =
    startedAt + (G11_CLOUD_RUN_RETENTION_HOURS + RETENTION_BUFFER_HOURS) * 60 * 60;
  return Object.freeze({
    retention: Object.freeze({
      hours: G11_CLOUD_RUN_RETENTION_HOURS,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
      strategy: 'version-addressed-cloud-run-service',
    }),
    retentionUntilEpochSeconds,
    schema: 'kovo.devex/g11-cloud-run-plan/v1',
    service: cloudRunServiceName(runId, runAttempt),
    sourceSha: normalizedSourceSha,
    startedAtEpochSeconds: startedAt,
  });
}

export function packedCreatorArguments(appRoot) {
  const resolvedAppRoot = path.resolve(requiredString(appRoot, 'app root'));
  return Object.freeze([
    resolvedAppRoot,
    '--name',
    'kovo-g11-cloud-run',
    ...REQUIRED_CREATOR_FLAGS,
  ]);
}

export function assertGeneratedNodeRetentionConfig(source) {
  const normalizedSource = requiredString(source, 'generated kovo.config.ts source');
  for (const fragment of RETENTION_CONFIG_FRAGMENT) {
    if (!normalizedSource.includes(fragment)) {
      throw new TypeError(
        `Generated G11 scaffold does not carry the exact Node retention posture: missing ${JSON.stringify(fragment)}.`,
      );
    }
  }
  if (
    normalizedSource.includes('preset: vercel(') ||
    normalizedSource.includes('preset: cloudflare(')
  ) {
    throw new TypeError('Generated G11 scaffold selected a non-Node deployment preset.');
  }
}

export function runtimeEnvironmentDocument(origin, environment = process.env) {
  const publicOrigin = canonicalHttpsOrigin(origin);
  const values = {
    BETTER_AUTH_SECRET: requiredRuntimeSecret(
      environment.KOVO_G11_BETTER_AUTH_SECRET,
      'KOVO_G11_BETTER_AUTH_SECRET',
    ),
    BETTER_AUTH_URL: publicOrigin,
    KOVO_ATTESTATION_DEPLOYMENT_ID: requiredString(
      environment.KOVO_G11_ATTESTATION_DEPLOYMENT_ID,
      'KOVO_G11_ATTESTATION_DEPLOYMENT_ID',
    ),
    KOVO_ATTESTATION_SECRET: requiredRuntimeSecret(
      environment.KOVO_G11_ATTESTATION_SECRET,
      'KOVO_G11_ATTESTATION_SECRET',
    ),
    KOVO_CSRF_SECRET: requiredRuntimeSecret(
      environment.KOVO_G11_CSRF_SECRET,
      'KOVO_G11_CSRF_SECRET',
    ),
    KOVO_NODE_TRUSTED_PROXY: '1',
    NODE_ENV: 'production',
  };
  return `${Object.entries(values)
    .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
    .join('\n')}\n`;
}

export function preparePackedCloudRunContext({ contextRoot, packedManifestPath, workRoot }) {
  const resolvedWorkRoot = newOutputDirectory(workRoot, 'G11 work root');
  const resolvedContextRoot = newOutputDirectory(contextRoot, 'G11 container context');
  const appRoot = path.join(resolvedWorkRoot, 'app');
  const creatorRoot = path.join(resolvedWorkRoot, 'creator');
  mkdirSync(appRoot, { recursive: false });
  mkdirSync(creatorRoot, { recursive: false });

  const manifestPath = path.resolve(
    packedManifestPath ?? path.join(repoRoot, '.release/packed-packages.json'),
  );
  const manifest = readPackedReleaseManifest(manifestPath);
  const packedPackages = validatePackedReleaseManifest(manifest, releasePackages());
  const packageByName = new Map(packedPackages.map((entry) => [entry.name, entry]));
  const createKovo = requiredPackedPackage(packageByName, 'create-kovo');
  const core = requiredPackedPackage(packageByName, '@kovojs/core');

  const createKovoRoot = path.join(creatorRoot, 'node_modules/create-kovo');
  materializePackedPackage(createKovo, createKovoRoot);
  materializePackedPackage(core, path.join(creatorRoot, 'node_modules/@kovojs/core'));
  const creatorBin = path.join(createKovoRoot, 'dist/index.mjs');
  if (!existsSync(creatorBin)) {
    throw new Error('Authenticated create-kovo tarball has no dist/index.mjs entry.');
  }

  execFileSync(process.execPath, [creatorBin, ...packedCreatorArguments(appRoot)], {
    cwd: resolvedWorkRoot,
    env: {
      ...process.env,
      PATH: [path.join(creatorRoot, 'node_modules/.bin'), process.env.PATH ?? ''].join(
        path.delimiter,
      ),
    },
    stdio: 'inherit',
  });
  assertGeneratedNodeRetentionConfig(readFileSync(path.join(appRoot, 'kovo.config.ts'), 'utf8'));

  const appTarballRoot = path.join(appRoot, '.kovo-deploy-packages');
  mkdirSync(appTarballRoot, { recursive: false });
  const tarballByName = copyPackedTarballs(packedPackages, appTarballRoot);
  rewriteManifestToPackedTarballs(path.join(appRoot, 'package.json'), tarballByName);

  runPnpm(['install', '--ignore-workspace', '--no-frozen-lockfile', '--ignore-scripts'], appRoot);
  runPnpm(['exec', 'kovo', 'check', 'lifecycle'], appRoot);
  runPnpm(['rebuild'], appRoot);
  runPnpm(['run', 'build:prod'], appRoot, {
    NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, '--max-old-space-size=8192'),
  });

  const emittedServerRoot = path.join(appRoot, 'dist/server');
  if (!existsSync(path.join(emittedServerRoot, 'server.mjs'))) {
    throw new Error('Packed G11 build did not emit dist/server/server.mjs.');
  }
  if (!existsSync(path.join(emittedServerRoot, 'Dockerfile'))) {
    throw new Error('Packed G11 build did not emit the Node preset Dockerfile.');
  }

  cpSync(emittedServerRoot, resolvedContextRoot, {
    errorOnExist: true,
    force: false,
    recursive: true,
  });
  const contextTarballRoot = path.join(resolvedContextRoot, '.kovo-deploy-packages');
  mkdirSync(contextTarballRoot, { recursive: false });
  for (const tarballName of tarballByName.values()) {
    copyFileSync(
      path.join(appTarballRoot, tarballName),
      path.join(contextTarballRoot, tarballName),
    );
  }
  rewriteManifestToPackedTarballs(path.join(resolvedContextRoot, 'package.json'), tarballByName);
  runPnpm(
    [
      'install',
      '--lockfile-only',
      '--ignore-workspace',
      '--no-frozen-lockfile',
      '--ignore-scripts',
    ],
    resolvedContextRoot,
  );

  const generatedDockerfile = readFileSync(path.join(resolvedContextRoot, 'Dockerfile'), 'utf8');
  const packedDockerfile = dockerfileWithPackedTarballs(generatedDockerfile);
  writeFileSync(path.join(resolvedContextRoot, 'Dockerfile.g11'), packedDockerfile, 'utf8');
  writeFileSync(
    path.join(resolvedContextRoot, '.dockerignore'),
    ['.env', '.env.*', '*.log', 'node_modules', ''].join('\n'),
    'utf8',
  );

  const sourceSha = gitSourceSha();
  const contextAttestation = {
    dockerfileSha256: sha256(packedDockerfile),
    generatedConfigSha256: sha256(readFileSync(path.join(appRoot, 'kovo.config.ts'))),
    packages: packedPackages.map((entry) => ({
      name: entry.name,
      sha512: entry.sha512,
      version: entry.version,
    })),
    preset: 'node',
    retention: {
      hours: G11_CLOUD_RUN_RETENTION_HOURS,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
      strategy: 'version-addressed-cloud-run-service',
    },
    schema: G11_CLOUD_RUN_CONTEXT_SCHEMA,
    sourceSha,
  };
  writeFileSync(
    path.join(resolvedContextRoot, 'kovo-g11-context.json'),
    `${JSON.stringify(contextAttestation, null, 2)}\n`,
    'utf8',
  );
  return Object.freeze({
    appRoot,
    contextRoot: resolvedContextRoot,
    sourceSha,
  });
}

export async function probePublicCloudRun(origin, fetchImplementation = fetch) {
  const publicOrigin = canonicalHttpsOrigin(origin);
  const health = await boundedFetch(new URL('/api/health', publicOrigin), fetchImplementation);
  if (health.status !== 200) {
    throw new Error(`G11 public health probe returned HTTP ${health.status}, expected 200.`);
  }
  if (!health.contentType.startsWith('application/json')) {
    throw new Error(`G11 public health probe returned ${health.contentType || 'no content type'}.`);
  }
  let healthJson;
  try {
    healthJson = JSON.parse(health.body);
  } catch {
    throw new Error('G11 public health probe did not return JSON.');
  }
  if (
    healthJson === null ||
    typeof healthJson !== 'object' ||
    Array.isArray(healthJson) ||
    healthJson.ok !== true
  ) {
    throw new Error('G11 public health probe did not return {"ok":true}.');
  }

  const login = await boundedFetch(new URL('/login', publicOrigin), fetchImplementation);
  if (login.status !== 200) {
    throw new Error(`G11 public document probe returned HTTP ${login.status}, expected 200.`);
  }
  if (!login.contentType.startsWith('text/html')) {
    throw new Error(
      `G11 public document probe returned ${login.contentType || 'no content type'}.`,
    );
  }
  if (!login.body.includes('Kovo Starter')) {
    throw new Error('G11 public document probe did not render the packed starter.');
  }
  if (login.buildToken === null || login.buildToken.length === 0) {
    throw new Error('G11 public document probe omitted the Kovo-Build response token.');
  }

  const stylesheetPath = firstSameOriginStylesheet(login.body, publicOrigin);
  if (stylesheetPath === undefined) {
    throw new Error('G11 public document probe did not expose a same-origin stylesheet.');
  }
  const stylesheet = await boundedFetch(new URL(stylesheetPath, publicOrigin), fetchImplementation);
  if (stylesheet.status !== 200 || !stylesheet.contentType.startsWith('text/css')) {
    throw new Error(
      `G11 public stylesheet probe returned HTTP ${stylesheet.status} ${stylesheet.contentType}.`,
    );
  }

  return Object.freeze({
    buildTokenSha256: sha256(login.buildToken),
    healthBodySha256: sha256(health.body),
    loginBodySha256: sha256(login.body),
    origin: publicOrigin,
    statuses: Object.freeze({
      health: health.status,
      login: login.status,
      stylesheet: stylesheet.status,
    }),
    stylesheetPath,
  });
}

export async function verifyPublicCloudRunJourney({
  fetchImplementation = fetch,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
  origin,
  retentionUntilEpochSeconds,
  service,
  sourceSha,
}) {
  const now = requiredNonnegativeInteger(nowEpochSeconds, 'verification epoch');
  const retentionUntil = requiredNonnegativeInteger(
    retentionUntilEpochSeconds,
    'retention-until epoch',
  );
  if (retentionUntil - now < G11_CLOUD_RUN_RETENTION_HOURS * 60 * 60) {
    throw new TypeError('G11 deployment does not preserve a full 24-hour retention horizon.');
  }
  const normalizedService = requiredManagedService(service);
  const probe = await probePublicCloudRun(origin, fetchImplementation);
  return Object.freeze({
    host: 'Google Cloud Run',
    probe,
    retention: Object.freeze({
      hours: G11_CLOUD_RUN_RETENTION_HOURS,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
      retainUntilEpochSeconds: retentionUntil,
      strategy: 'version-addressed-cloud-run-service',
    }),
    schema: G11_CLOUD_RUN_PROOF_SCHEMA,
    service: normalizedService,
    sourceSha: requiredSourceSha(sourceSha),
    verifiedAtEpochSeconds: now,
  });
}

export function selectRetentionSweepActions(inventory, nowEpochSeconds) {
  if (!Array.isArray(inventory)) {
    throw new TypeError('Cloud Run service inventory must be an array.');
  }
  const now = requiredNonnegativeInteger(nowEpochSeconds, 'retention sweep epoch');
  const actions = [];
  for (const [index, service] of inventory.entries()) {
    if (service === null || typeof service !== 'object' || Array.isArray(service)) {
      throw new TypeError(`Cloud Run service inventory row ${index} must be an object.`);
    }
    const labels = service.metadata?.labels;
    if (labels?.['kovo-g11-managed'] !== 'true') continue;
    const name = requiredManagedService(service.metadata?.name);
    const origin = canonicalHttpsOrigin(service.status?.url);
    const retentionUntil = requiredNonnegativeInteger(
      labels['kovo-g11-retain-until'],
      `${name} retention-until label`,
    );
    const sourceSha = requiredSourceSha(labels['kovo-g11-source-sha']);
    actions.push({
      action: now >= retentionUntil ? 'probe-and-delete' : 'probe',
      origin,
      retentionUntilEpochSeconds: retentionUntil,
      service: name,
      sourceSha,
    });
  }
  actions.sort((left, right) => left.service.localeCompare(right.service));
  return Object.freeze({
    actions: Object.freeze(actions.map((action) => Object.freeze(action))),
    generatedAtEpochSeconds: now,
    schema: G11_CLOUD_RUN_SWEEP_SCHEMA,
  });
}

function requiredPackedPackage(packageByName, name) {
  const entry = packageByName.get(name);
  if (entry === undefined) throw new Error(`Packed G11 journey is missing ${name}.`);
  return entry;
}

function materializePackedPackage(entry, destination) {
  const tarball = path.resolve(repoRoot, entry.tarball);
  const { entries } = verifyPackedAttestation(entry, tarball);
  mkdirSync(destination, { recursive: true });
  for (const file of entries) {
    if (!file.name.startsWith('package/')) {
      throw new TypeError(`${entry.name} has an invalid package tar entry.`);
    }
    const relative = file.name.slice('package/'.length);
    if (relative.length === 0) continue;
    const target = path.resolve(destination, ...relative.split('/'));
    if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) {
      throw new TypeError(`${entry.name} tar entry escapes its package root.`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.data, {
      flag: 'wx',
      mode: file.executable ? 0o755 : 0o644,
    });
  }
}

function copyPackedTarballs(packedPackages, destination) {
  const tarballByName = new Map();
  const seenFiles = new Set();
  for (const entry of packedPackages) {
    const source = realpathSync(path.resolve(repoRoot, entry.tarball));
    verifyPackedAttestation(entry, source);
    const file = path.basename(source);
    if (seenFiles.has(file)) throw new TypeError(`Packed tarball filename collision: ${file}.`);
    seenFiles.add(file);
    copyFileSync(source, path.join(destination, file));
    tarballByName.set(entry.name, file);
  }
  return tarballByName;
}

function rewriteManifestToPackedTarballs(manifestPath, tarballByName) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const dependencies = manifest[field];
    if (dependencies === undefined) continue;
    for (const [name, file] of tarballByName) {
      if (Object.hasOwn(dependencies, name)) {
        dependencies[name] = `file:.kovo-deploy-packages/${file}`;
      }
    }
  }
  manifest.pnpm = {
    ...manifest.pnpm,
    overrides: {
      ...manifest.pnpm?.overrides,
      ...Object.fromEntries(
        [...tarballByName].map(([name, file]) => [name, `file:.kovo-deploy-packages/${file}`]),
      ),
    },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function dockerfileWithPackedTarballs(source) {
  const lockfileAnchor =
    'COPY --chown=node:node package-lock.json* npm-shrinkwrap.json* pnpm-lock.yaml* yarn.lock* ./\n';
  const sourceAnchor = 'COPY --chown=node:node . .\n';
  if (!source.includes(lockfileAnchor) || !source.includes(sourceAnchor)) {
    throw new TypeError(
      'Generated Node Dockerfile no longer exposes its reviewed lockfile/source anchors.',
    );
  }
  return source
    .replace(
      lockfileAnchor,
      `${lockfileAnchor}COPY --chown=node:node .kovo-deploy-packages ./.kovo-deploy-packages\n`,
    )
    .replace(sourceAnchor, `RUN corepack pnpm rebuild better-sqlite3\n${sourceAnchor}`);
}

function runPnpm(args, cwd, environment = {}) {
  execFileSync('vp', ['exec', 'pnpm', ...args], {
    cwd,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  });
}

async function boundedFetch(url, fetchImplementation) {
  const response = await fetchImplementation(url, {
    headers: { Accept: '*/*', 'User-Agent': 'kovo-g11-cloud-run-journey/1' },
    redirect: 'error',
    signal: AbortSignal.timeout(PUBLIC_PROBE_TIMEOUT_MS),
  });
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_BODY_BYTES) {
    throw new Error(`G11 public probe refused a ${contentLength}-byte response.`);
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_HTTP_BODY_BYTES) {
    throw new Error('G11 public probe response exceeded its bounded body limit.');
  }
  return {
    body,
    buildToken: response.headers.get('kovo-build'),
    contentType: response.headers.get('content-type') ?? '',
    status: response.status,
  };
}

function firstSameOriginStylesheet(html, origin) {
  for (const match of html.matchAll(/<link\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>/giu)) {
    const href = match[1] ?? match[2];
    if (href === undefined || !/\.css(?:[?#]|$)/u.test(href)) continue;
    const url = new URL(href, origin);
    if (url.origin === origin) return `${url.pathname}${url.search}`;
  }
  return undefined;
}

function canonicalHttpsOrigin(value) {
  const normalized = requiredString(value, 'public Cloud Run origin');
  const url = new URL(normalized);
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new TypeError('G11 Cloud Run origin must be one canonical HTTPS origin.');
  }
  return url.origin;
}

function requiredManagedService(value) {
  const service = requiredString(value, 'managed Cloud Run service');
  if (!new RegExp(`^${G11_CLOUD_RUN_SERVICE_PREFIX}[0-9]+-[0-9]+$`, 'u').test(service)) {
    throw new TypeError(`Refusing non-G11 Cloud Run service ${JSON.stringify(service)}.`);
  }
  return service;
}

function requiredRuntimeSecret(value, label) {
  const secret = requiredString(value, label);
  if (secret.length < 32) throw new TypeError(`${label} must contain at least 32 characters.`);
  return secret;
}

function requiredSourceSha(value) {
  const sha = requiredString(value, 'source SHA');
  if (!/^[a-f0-9]{40}$/u.test(sha)) {
    throw new TypeError('G11 source SHA must be one full lowercase Git SHA-1.');
  }
  return sha;
}

function requiredDigits(value, label) {
  const normalized = String(value);
  if (!/^[1-9][0-9]*$/u.test(normalized)) throw new TypeError(`${label} must contain digits.`);
  return normalized;
}

function requiredNonnegativeInteger(value, label) {
  const normalized = typeof value === 'string' && /^[0-9]+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return normalized;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function newOutputDirectory(value, label) {
  const resolved = path.resolve(requiredString(value, label));
  if (existsSync(resolved)) {
    throw new TypeError(`${label} already exists; refusing to overwrite ${resolved}.`);
  }
  const parent = path.dirname(resolved);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new TypeError(`${label} parent directory does not exist: ${parent}.`);
  }
  mkdirSync(resolved, { recursive: false, mode: 0o700 });
  return realpathSync(resolved);
}

function mergeNodeOptions(existing, addition) {
  return [existing, addition].filter(Boolean).join(' ');
}

function gitSourceSha() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  return requiredSourceSha(sha);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readOptions(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new TypeError(`Expected --name value pairs; received ${JSON.stringify(args)}.`);
    }
    if (options.has(name)) throw new TypeError(`Duplicate G11 option ${name}.`);
    options.set(name, value);
  }
  return options;
}

function requiredOption(options, name) {
  const value = options.get(name);
  if (value === undefined) throw new TypeError(`Missing required G11 option ${name}.`);
  return value;
}

function writeJson(file, value) {
  const resolved = path.resolve(file);
  if (existsSync(resolved)) throw new TypeError(`Refusing to overwrite G11 output ${resolved}.`);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

async function main(args = process.argv.slice(2)) {
  const [command, ...optionArgs] = args;
  const options = readOptions(optionArgs);
  if (command === 'plan') {
    const plan = cloudRunJourneyPlan({
      runAttempt: requiredOption(options, '--run-attempt'),
      runId: requiredOption(options, '--run-id'),
      sourceSha: requiredOption(options, '--source-sha'),
      startedAtEpochSeconds: requiredOption(options, '--started-at'),
    });
    writeJson(requiredOption(options, '--output'), plan);
    return;
  }
  if (command === 'prepare') {
    const result = preparePackedCloudRunContext({
      contextRoot: requiredOption(options, '--context'),
      packedManifestPath: requiredOption(options, '--packed-manifest'),
      workRoot: requiredOption(options, '--work-root'),
    });
    process.stdout.write(
      `Prepared authenticated G11 Cloud Run context at ${result.contextRoot} from ${result.sourceSha}.\n`,
    );
    return;
  }
  if (command === 'runtime-env') {
    const document = runtimeEnvironmentDocument(requiredOption(options, '--origin'));
    const output = path.resolve(requiredOption(options, '--output'));
    if (existsSync(output)) throw new TypeError(`Refusing to overwrite runtime env ${output}.`);
    writeFileSync(output, document, { flag: 'wx', mode: 0o600 });
    return;
  }
  if (command === 'probe') {
    const probe = await probePublicCloudRun(requiredOption(options, '--url'));
    writeJson(requiredOption(options, '--output'), probe);
    return;
  }
  if (command === 'verify') {
    const proof = await verifyPublicCloudRunJourney({
      origin: requiredOption(options, '--url'),
      retentionUntilEpochSeconds: requiredOption(options, '--retention-until'),
      service: requiredOption(options, '--service'),
      sourceSha: requiredOption(options, '--source-sha'),
    });
    writeJson(requiredOption(options, '--output'), proof);
    return;
  }
  if (command === 'sweep') {
    const inventory = JSON.parse(
      readFileSync(path.resolve(requiredOption(options, '--inventory')), 'utf8'),
    );
    const sweep = selectRetentionSweepActions(inventory, requiredOption(options, '--now'));
    writeJson(requiredOption(options, '--output'), sweep);
    return;
  }
  throw new TypeError(
    'Usage: g11-cloud-run-journey.mjs <plan|prepare|runtime-env|probe|verify|sweep> --name value ...',
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
