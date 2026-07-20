import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  createFrameworkFileSystemBoundary,
  type FrameworkFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';
import type { KovoArtifactProvenance } from '@kovojs/core/internal/graph';

import {
  ADVISORY_ARGV_SPEC,
  ADVISORY_USAGE,
  commandArgvError,
  parsedStringOption,
  parseCommandArgv,
} from '../commands-manifest.js';
import { discoverGraphInputPaths } from '../graph-input.js';
import type { CliCommandResult, CliProcessResult } from '../shared.js';

const DEFAULT_ADVISORY_FEED_URL =
  'https://raw.githubusercontent.com/kovojs/kovo/main/security/advisories/feed.json';
const DEFAULT_ATTESTATION_API = 'https://api.github.com/repos/kovojs/kovo/attestations';
const EXPECTED_CERTIFICATE_ISSUER = 'https://token.actions.githubusercontent.com';
const EXPECTED_CERTIFICATE_IDENTITY =
  '^https://github\\.com/kovojs/kovo/\\.github/workflows/release\\.yml@refs/heads/main$';
const EXPECTED_WORKFLOW_URL = 'https://github.com/kovojs/kovo/.github/workflows/release.yml';
const MAX_DOCUMENT_BYTES = 1_048_576;
const MAX_ADVISORIES = 512;
const MAX_LIST_ENTRIES = 128;
const MAX_TEXT = 1_024;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MIN_ADVISORY_EPOCH = 1;

export const KOVO_ADVISORY_SCHEMA = 'kovo.security.advisory/v1' as const;
export const KOVO_ADVISORY_FEED_SCHEMA = 'kovo.security.advisory-feed/v1' as const;
export const KOVO_ADVISORY_STATE_SCHEMA = 'kovo.security.advisory-state/v1' as const;

export type AdvisorySeverity = 'critical' | 'high' | 'low' | 'moderate';

export interface KovoSecurityAdvisory {
  readonly affectedRange: string;
  readonly fixedIn: string;
  readonly graphSchemaVersion: string;
  readonly id: string;
  readonly retracts: readonly string[];
  readonly schema: typeof KOVO_ADVISORY_SCHEMA;
  readonly severity: AdvisorySeverity;
  readonly tcbChokes: readonly string[];
}

export interface KovoSecurityAdvisoryFeed {
  readonly advisories: readonly KovoSecurityAdvisory[];
  readonly epoch: number;
  readonly issuedAt: string;
  readonly maxFeedAgeSeconds: number;
  readonly schema: typeof KOVO_ADVISORY_FEED_SCHEMA;
}

export interface AdvisoryCheckOptions {
  readonly attestation?: string;
  readonly feed?: string;
  readonly graphPath?: string;
  readonly severityFloor: AdvisorySeverity;
  readonly statePath: string;
}

export type AdvisoryArgParseResult =
  | { readonly ok: true; readonly options: AdvisoryCheckOptions }
  | { readonly message: string; readonly ok: false };

interface AdvisoryCheckDependencies {
  readonly fetchBytes?: (source: string) => Promise<Uint8Array>;
  readonly now?: () => number;
  readonly verifyBundle?: (bundle: unknown) => Promise<void>;
}

interface ArtifactPosture {
  readonly graphSchemaVersion: string;
  readonly versions: readonly string[];
}

interface AdvisoryState {
  readonly feedDigest: `sha256:${string}`;
  readonly highestEpoch: number;
  readonly schema: typeof KOVO_ADVISORY_STATE_SCHEMA;
}

interface ParsedSemver {
  readonly build: readonly string[];
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

/** @internal Parse `kovo check advisories` through the manifest-owned grammar. */
export function parseAdvisoryArgs(args: readonly string[]): AdvisoryArgParseResult {
  const duplicate = duplicateScalarOption(args, [
    '--attestation',
    '--feed',
    '--severity-floor',
    '--state',
  ]);
  if (duplicate !== undefined) {
    return {
      message: `kovo: check advisories option ${duplicate} may appear only once.\n${ADVISORY_USAGE}`,
      ok: false,
    };
  }
  const parsed = parseCommandArgv(args, ADVISORY_ARGV_SPEC);
  if (!parsed.ok) return commandArgvError('check advisories', parsed, ADVISORY_USAGE);
  if (parsed.value.positionals[0] !== 'advisories' || parsed.value.positionals.length > 2) {
    return { message: `kovo: ${ADVISORY_USAGE}`, ok: false };
  }
  const severity = parsedStringOption(parsed.value, '--severity-floor') ?? 'high';
  if (!isSeverity(severity)) {
    return {
      message: `kovo: --severity-floor must be low, moderate, high, or critical.\n${ADVISORY_USAGE}`,
      ok: false,
    };
  }
  const attestation = parsedStringOption(parsed.value, '--attestation');
  const feed = parsedStringOption(parsed.value, '--feed');
  const graphPath = parsed.value.positionals[1];
  return {
    ok: true,
    options: {
      ...(attestation === undefined ? {} : { attestation }),
      ...(feed === undefined ? {} : { feed }),
      ...(graphPath === undefined ? {} : { graphPath }),
      severityFloor: severity,
      statePath: parsedStringOption(parsed.value, '--state') ?? '.kovo/advisory-state.json',
    },
  };
}

/**
 * Verify and evaluate the signed Kovo advisory feed.
 *
 * UNKNOWN is deliberately non-zero: inability to fetch, authenticate, freshness-check, or
 * rollback-check the feed is not equivalent to an empty affected set (SPEC §11.4).
 *
 * @internal
 */
export async function runAdvisoryCheck(
  options: AdvisoryCheckOptions,
  invocationCwd: string,
  dependencies: AdvisoryCheckDependencies = {},
): Promise<CliProcessResult> {
  try {
    const discoveredGraphs =
      options.graphPath === undefined ? discoverGraphInputPaths(invocationCwd) : [];
    if (options.graphPath === undefined && discoveredGraphs.length > 1) {
      const names = discoveredGraphs
        .map((path) => relative(resolve(invocationCwd), path))
        .join(', ');
      throw new TypeError(`multiple graph artifacts were found (${names}); pass one explicitly`);
    }
    const graphPath = options.graphPath ?? discoveredGraphs[0];
    if (graphPath === undefined)
      throw new TypeError('no graph artifact was found; build the app or pass graph.json');
    const artifact = readArtifactPosture(invocationCwd, graphPath);
    const feedSource = options.feed ?? DEFAULT_ADVISORY_FEED_URL;
    const fetchBytes = dependencies.fetchBytes ?? defaultFetchBytes;
    const feedBytes = await fetchBytes(resolveInputSource(invocationCwd, feedSource));
    const feedDigest = `sha256:${createHash('sha256').update(feedBytes).digest('hex')}` as const;
    const feed = parseAdvisoryFeed(parseBoundedJson(feedBytes, 'advisory feed'));
    const now = (dependencies.now ?? Date.now)();
    assertFeedFresh(feed, now);

    const bundles = await loadAttestationBundles(
      options.attestation,
      feedDigest,
      invocationCwd,
      fetchBytes,
    );
    await verifyFeedAttestation(
      bundles,
      feedDigest,
      dependencies.verifyBundle ?? verifySigstoreBundle,
    );

    const statePath = safeStatePath(invocationCwd, options.statePath);
    const stateFileSystem = await createFrameworkFileSystemBoundary(resolve(invocationCwd));
    await updateAdvisoryState(stateFileSystem, statePath, feed, {
      feedDigest,
      highestEpoch: feed.epoch,
      schema: KOVO_ADVISORY_STATE_SCHEMA,
    });

    return evaluateAdvisories(feed, artifact, options.severityFloor);
  } catch (error) {
    return {
      exitCode: 2,
      output: `UNKNOWN advisories reason=${singleLineError(error)}\nNONCLAIM advisory checking detects only authenticated published advisories; UNKNOWN is not no-impact.\n`,
    };
  }
}

/** @internal Strict schema parser shared by the repository gate and CLI. */
export function parseAdvisoryFeed(value: unknown): KovoSecurityAdvisoryFeed {
  const record = exactRecord(value, 'advisory feed', [
    'advisories',
    'epoch',
    'issuedAt',
    'maxFeedAgeSeconds',
    'schema',
  ]);
  if (record.schema !== KOVO_ADVISORY_FEED_SCHEMA) {
    throw new TypeError('advisory feed has an unsupported schema');
  }
  if (!Number.isSafeInteger(record.epoch) || (record.epoch as number) < MIN_ADVISORY_EPOCH) {
    throw new TypeError('advisory feed epoch must be a positive safe integer');
  }
  const issuedAt = exactIsoTimestamp(record.issuedAt, 'advisory feed issuedAt');
  if (
    !Number.isSafeInteger(record.maxFeedAgeSeconds) ||
    (record.maxFeedAgeSeconds as number) < 60 ||
    (record.maxFeedAgeSeconds as number) > 31_536_000
  ) {
    throw new TypeError('advisory feed maxFeedAgeSeconds must be between 60 and 31536000');
  }
  const rawAdvisories = denseArray(record.advisories, 'advisory feed advisories', MAX_ADVISORIES);
  const advisories = rawAdvisories.map((advisory, index) => parseAdvisory(advisory, index));
  const ids = new Set<string>();
  for (const advisory of advisories) {
    if (ids.has(advisory.id)) throw new TypeError(`duplicate advisory id ${advisory.id}`);
    ids.add(advisory.id);
  }
  return Object.freeze({
    advisories: Object.freeze(advisories),
    epoch: record.epoch as number,
    issuedAt,
    maxFeedAgeSeconds: record.maxFeedAgeSeconds as number,
    schema: KOVO_ADVISORY_FEED_SCHEMA,
  });
}

function parseAdvisory(value: unknown, index: number): KovoSecurityAdvisory {
  const label = `advisory feed advisories[${index}]`;
  const record = exactRecord(value, label, [
    'affectedRange',
    'fixedIn',
    'graphSchemaVersion',
    'id',
    'retracts',
    'schema',
    'severity',
    'tcbChokes',
  ]);
  if (record.schema !== KOVO_ADVISORY_SCHEMA) {
    throw new TypeError(`${label} has an unsupported schema`);
  }
  const id = boundedIdentifier(record.id, `${label}.id`);
  const severity = record.severity;
  if (!isSeverity(severity)) throw new TypeError(`${label}.severity is unsupported`);
  const range = parseAffectedRange(record.affectedRange, `${label}.affectedRange`);
  const fixedIn = boundedText(record.fixedIn, `${label}.fixedIn`, 128);
  const fixedVersion = parseSemver(fixedIn, `${label}.fixedIn`);
  if (compareSemver(fixedVersion, range.maximum) < 0) {
    throw new TypeError(`${label}.fixedIn must not precede the exclusive affected upper bound`);
  }
  const retracts = identifierArray(record.retracts, `${label}.retracts`);
  const tcbChokes = identifierArray(record.tcbChokes, `${label}.tcbChokes`);
  if (retracts.length === 0 || tcbChokes.length === 0) {
    throw new TypeError(`${label} must name at least one retracted guarantee and TCB choke`);
  }
  return Object.freeze({
    affectedRange: `>=${formatSemver(range.minimum)} <${formatSemver(range.maximum)}`,
    fixedIn: formatSemver(fixedVersion),
    graphSchemaVersion: boundedIdentifier(record.graphSchemaVersion, `${label}.graphSchemaVersion`),
    id,
    retracts: Object.freeze(retracts),
    schema: KOVO_ADVISORY_SCHEMA,
    severity,
    tcbChokes: Object.freeze(tcbChokes),
  });
}

function evaluateAdvisories(
  feed: KovoSecurityAdvisoryFeed,
  artifact: ArtifactPosture,
  floor: AdvisorySeverity,
): CliCommandResult {
  const affected: KovoSecurityAdvisory[] = [];
  for (const advisory of feed.advisories) {
    if (advisory.graphSchemaVersion !== artifact.graphSchemaVersion) continue;
    const range = parseAffectedRange(advisory.affectedRange, `${advisory.id}.affectedRange`);
    if (
      artifact.versions.some((version) => {
        const parsed = parseSemver(version, 'artifact framework package version');
        return (
          compareSemver(parsed, range.minimum) >= 0 && compareSemver(parsed, range.maximum) < 0
        );
      })
    ) {
      affected.push(advisory);
    }
  }

  if (affected.length === 0) {
    return {
      exitCode: 0,
      output:
        `NOT-AFFECTED advisories epoch=${feed.epoch} checked=${feed.advisories.length}\n` +
        'NONCLAIM no authenticated published advisory in this feed matches the artifact; this is not proof of absence of vulnerabilities.\n',
    };
  }

  affected.sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) || left.id.localeCompare(right.id),
  );
  let output = '';
  let blocking = false;
  for (const advisory of affected) {
    const atFloor = severityRank(advisory.severity) >= severityRank(floor);
    if (atFloor) blocking = true;
    output += `AFFECTED ${advisory.id} severity=${advisory.severity} fixedIn=${advisory.fixedIn} floor=${floor} blocking=${String(atFloor)}\n`;
  }
  output +=
    'NONCLAIM advisory matching is detection over the authenticated feed, not proof outside its published scope.\n';
  return { exitCode: blocking ? 1 : 0, output };
}

function readArtifactPosture(invocationCwd: string, inputPath: string): ArtifactPosture {
  const path = safeInputPath(invocationCwd, inputPath, 'graph');
  const value = parseBoundedJson(readBoundedFile(path, 'graph'), 'graph');
  const graph = recordValue(value, 'graph');
  const provenance = recordValue(graph.provenance, 'graph provenance');
  if (provenance.schema !== 'kovo.artifact.provenance/v1') {
    throw new TypeError('graph provenance has an unsupported schema');
  }
  const typed = provenance as unknown as KovoArtifactProvenance;
  const graphSchemaVersion = boundedIdentifier(
    typed.graphSchemaVersion,
    'graph provenance graphSchemaVersion',
  );
  if (graphSchemaVersion !== 'kovo.graph/v1') {
    throw new TypeError('graph provenance graphSchemaVersion is unsupported by this checker');
  }
  const packages = denseArray(typed.frameworkPackages, 'graph provenance frameworkPackages', 128);
  const versions: string[] = [];
  for (let index = 0; index < packages.length; index += 1) {
    const entry = exactRecord(packages[index], `graph provenance frameworkPackages[${index}]`, [
      'name',
      'version',
    ]);
    const name = boundedText(entry.name, `graph provenance frameworkPackages[${index}].name`, 128);
    if (!name.startsWith('@kovojs/')) {
      throw new TypeError(`graph provenance frameworkPackages[${index}].name is not Kovo-owned`);
    }
    versions.push(formatSemver(parseSemver(entry.version, `${name} version`)));
  }
  if (versions.length === 0) throw new TypeError('graph provenance has no Kovo package versions');
  return { graphSchemaVersion, versions: Object.freeze(versions) };
}

async function loadAttestationBundles(
  source: string | undefined,
  feedDigest: `sha256:${string}`,
  invocationCwd: string,
  fetchBytes: (source: string) => Promise<Uint8Array>,
): Promise<readonly unknown[]> {
  const resolved =
    source === undefined
      ? `${DEFAULT_ATTESTATION_API}/${feedDigest}?per_page=100`
      : resolveInputSource(invocationCwd, source);
  const document = new TextDecoder('utf-8', { fatal: true }).decode(await fetchBytes(resolved));
  const lines = document
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length > 1) return lines.map((line) => JSON.parse(line) as unknown);
  const parsed = JSON.parse(document) as unknown;
  if (isRecord(parsed) && Array.isArray(parsed.attestations)) {
    return denseArray(parsed.attestations, 'attestation response', 100).map((entry, index) => {
      const record = recordValue(entry, `attestation response[${index}]`);
      return record.bundle;
    });
  }
  if (isRecord(parsed) && 'bundle' in parsed) return [parsed.bundle];
  return [parsed];
}

async function verifyFeedAttestation(
  bundles: readonly unknown[],
  digest: `sha256:${string}`,
  verifyBundle: (bundle: unknown) => Promise<void>,
): Promise<void> {
  for (const bundle of bundles) {
    try {
      await verifyBundle(bundle);
      assertBundleStatement(bundle, digest);
      return;
    } catch {
      // Repository attestation APIs may return attestations from other reviewed workflows. Only the
      // exact release identity and exact feed subject can satisfy this command.
    }
  }
  throw new TypeError('no valid release-workflow attestation covers the feed digest');
}

/** @internal Production Sigstore policy; the optional trust source supports offline fixtures. */
export async function verifySigstoreBundle(
  bundle: unknown,
  trust: Readonly<{ tufCachePath?: string; tufForceCache?: boolean }> = {},
): Promise<void> {
  await verifySigstoreBundleWithPolicy(
    bundle,
    {
      certificateIdentityURI: EXPECTED_CERTIFICATE_IDENTITY,
      certificateIssuer: EXPECTED_CERTIFICATE_ISSUER,
      ctLogThreshold: 1,
      tlogThreshold: 1,
    },
    trust,
  );
}

/**
 * Exercise the real Sigstore verifier with an explicit policy and optional offline TUF cache.
 * Production callers use the closed policy above; this seam exists for trust-boundary fixtures.
 *
 * @internal
 */
export async function verifySigstoreBundleWithPolicy(
  bundle: unknown,
  policy: Readonly<{
    certificateIdentityURI: string;
    certificateIssuer: string;
    ctLogThreshold: number;
    tlogThreshold: number;
  }>,
  trust: Readonly<{ tufCachePath?: string; tufForceCache?: boolean }> = {},
): Promise<void> {
  const { verify } = await import('sigstore');
  await verify(bundle as Parameters<typeof verify>[0], {
    certificateIdentityURI: policy.certificateIdentityURI,
    certificateIssuer: policy.certificateIssuer,
    ctLogThreshold: policy.ctLogThreshold,
    retry: 1,
    timeout: 5_000,
    tlogThreshold: policy.tlogThreshold,
    ...(trust.tufCachePath === undefined ? {} : { tufCachePath: trust.tufCachePath }),
    ...(trust.tufForceCache === undefined ? {} : { tufForceCache: trust.tufForceCache }),
  });
}

function assertBundleStatement(bundle: unknown, digest: `sha256:${string}`): void {
  const record = recordValue(bundle, 'Sigstore bundle');
  if (record.mediaType !== 'application/vnd.dev.sigstore.bundle.v0.3+json') {
    throw new TypeError('Sigstore bundle media type is unsupported');
  }
  const envelope = recordValue(record.dsseEnvelope, 'Sigstore DSSE envelope');
  if (envelope.payloadType !== 'application/vnd.in-toto+json') {
    throw new TypeError('Sigstore DSSE payload type is unsupported');
  }
  const payload = boundedText(envelope.payload, 'Sigstore DSSE payload', MAX_DOCUMENT_BYTES * 2);
  const statement = recordValue(
    parseBoundedJson(Buffer.from(payload, 'base64'), 'Sigstore statement'),
    'Sigstore statement',
  );
  if (
    statement._type !== 'https://in-toto.io/Statement/v1' ||
    statement.predicateType !== 'https://slsa.dev/provenance/v1'
  ) {
    throw new TypeError('Sigstore statement is not SLSA v1 provenance');
  }
  const subjects = denseArray(statement.subject, 'Sigstore statement subjects', 16);
  const expectedHex = digest.slice('sha256:'.length);
  const matchingSubjects = subjects.filter((subject, index) => {
    const row = exactRecord(subject, `Sigstore statement subjects[${index}]`, ['digest', 'name']);
    const digests = exactRecord(row.digest, `Sigstore statement subjects[${index}].digest`, [
      'sha256',
    ]);
    return row.name === 'security/advisories/feed.json' && digests.sha256 === expectedHex;
  });
  if (matchingSubjects.length !== 1) {
    throw new TypeError('Sigstore statement must bind the feed digest exactly once');
  }
  const predicate = recordValue(statement.predicate, 'Sigstore statement predicate');
  const definition = recordValue(predicate.buildDefinition, 'Sigstore build definition');
  const parameters = recordValue(
    definition.externalParameters,
    'Sigstore external build parameters',
  );
  const workflow = recordValue(parameters.workflow, 'Sigstore workflow parameters');
  if (
    workflow.repository !== 'https://github.com/kovojs/kovo' ||
    workflow.ref !== 'refs/heads/main' ||
    (workflow.path !== EXPECTED_WORKFLOW_URL && workflow.path !== '.github/workflows/release.yml')
  ) {
    throw new TypeError('Sigstore statement was not produced by the pinned main release workflow');
  }
}

function assertFeedFresh(feed: KovoSecurityAdvisoryFeed, now: number): void {
  if (!Number.isFinite(now)) throw new TypeError('advisory clock is invalid');
  const issuedAt = Date.parse(feed.issuedAt);
  if (issuedAt > now + MAX_FUTURE_SKEW_MS) throw new TypeError('advisory feed is future-dated');
  if (now - issuedAt > feed.maxFeedAgeSeconds * 1_000) {
    throw new TypeError('advisory feed is stale beyond maxFeedAgeSeconds');
  }
}

function assertNoFeedRollback(
  feed: KovoSecurityAdvisoryFeed,
  digest: `sha256:${string}`,
  state: AdvisoryState | undefined,
): void {
  if (feed.epoch < MIN_ADVISORY_EPOCH) throw new TypeError('advisory feed predates this client');
  if (state === undefined) return;
  if (feed.epoch < state.highestEpoch) throw new TypeError('advisory feed epoch rolled back');
  if (feed.epoch === state.highestEpoch && digest !== state.feedDigest) {
    throw new TypeError('advisory feed equivocated within one epoch');
  }
}

function readAdvisoryState(bytes: Uint8Array | undefined): AdvisoryState | undefined {
  if (bytes === undefined) return undefined;
  const value = recordValue(parseBoundedJson(bytes, 'advisory state'), 'advisory state');
  const state = exactRecord(value, 'advisory state', ['feedDigest', 'highestEpoch', 'schema']);
  if (
    state.schema !== KOVO_ADVISORY_STATE_SCHEMA ||
    typeof state.feedDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(state.feedDigest) ||
    !Number.isSafeInteger(state.highestEpoch) ||
    (state.highestEpoch as number) < MIN_ADVISORY_EPOCH
  ) {
    throw new TypeError('advisory state is invalid');
  }
  return {
    feedDigest: state.feedDigest as `sha256:${string}`,
    highestEpoch: state.highestEpoch as number,
    schema: KOVO_ADVISORY_STATE_SCHEMA,
  };
}

async function updateAdvisoryState(
  fileSystem: FrameworkFileSystemBoundary,
  relativePath: string,
  feed: KovoSecurityAdvisoryFeed,
  state: AdvisoryState,
): Promise<void> {
  await fileSystem.updateDurableFile(relativePath, (currentBytes) => {
    const current = readAdvisoryState(currentBytes);
    assertNoFeedRollback(feed, state.feedDigest, current);
    if (current?.highestEpoch === state.highestEpoch && current.feedDigest === state.feedDigest) {
      return undefined;
    }
    return `${JSON.stringify(state, null, 2)}\n`;
  });
}

async function defaultFetchBytes(source: string): Promise<Uint8Array> {
  if (!source.startsWith('https://')) return readBoundedFile(source, 'advisory input');
  const response = await fetch(source, {
    headers: {
      Accept: source.startsWith(DEFAULT_ATTESTATION_API)
        ? 'application/vnd.github+json'
        : 'application/json, text/plain;q=0.9',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new TypeError(`advisory fetch returned HTTP ${response.status}`);
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > MAX_DOCUMENT_BYTES) {
    throw new TypeError('advisory response exceeds the byte limit');
  }
  if (!response.body) throw new TypeError('advisory response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new TypeError('advisory response exceeds the byte limit');
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function readBoundedFile(path: string, label: string): Uint8Array {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError(`${label} must be a regular non-symlink file`);
  }
  if (stat.size > MAX_DOCUMENT_BYTES) throw new TypeError(`${label} exceeds the byte limit`);
  return readFileSync(path);
}

function parseBoundedJson(bytes: Uint8Array, label: string): unknown {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new TypeError(`${label} exceeds the byte limit`);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new TypeError(`${label} is not valid UTF-8 JSON`);
  }
}

function safeInputPath(invocationCwd: string, inputPath: string, label: string): string {
  const root = resolve(invocationCwd);
  const path = resolve(root, inputPath);
  const child = relative(root, path);
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new TypeError(`${label} path resolves outside the invocation root`);
  }
  assertSafeExistingDirectoryChain(root, dirname(path), `${label} parent`);
  return path;
}

function safeStatePath(invocationCwd: string, inputPath: string): string {
  const root = resolve(invocationCwd);
  return relative(root, safeInputPath(root, inputPath, 'advisory state'));
}

function resolveInputSource(invocationCwd: string, source: string): string {
  if (source.startsWith('https://')) return source;
  if (source.includes('://'))
    throw new TypeError('advisory inputs support only HTTPS or local files');
  return safeInputPath(invocationCwd, source, 'advisory input');
}

function assertSafeExistingDirectoryChain(root: string, parent: string, label: string): void {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new TypeError('advisory invocation root must be a regular non-symlink directory');
  }
  const child = relative(root, parent);
  const segments = child === '' ? [] : child.split(sep);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new TypeError(`${label} must contain only regular non-symlink directories`);
    }
  }
}

function parseAffectedRange(
  value: unknown,
  label: string,
): { readonly maximum: ParsedSemver; readonly minimum: ParsedSemver } {
  const source = boundedText(value, label, 280);
  const match = /^>=(\S+) <(\S+)$/u.exec(source);
  if (!match?.[1] || !match[2]) {
    throw new TypeError(`${label} must use the closed ">=VERSION <VERSION" grammar`);
  }
  const minimum = parseSemver(match[1], `${label} minimum`);
  const maximum = parseSemver(match[2], `${label} maximum`);
  if (compareSemver(minimum, maximum) >= 0) {
    throw new TypeError(`${label} must have an increasing exclusive upper bound`);
  }
  return { maximum, minimum };
}

function parseSemver(value: unknown, label: string): ParsedSemver {
  const source = boundedText(value, label, 128);
  const match =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
      source,
    );
  if (!match?.[1] || !match[2] || !match[3]) throw new TypeError(`${label} is not strict SemVer`);
  const prerelease = match[4]?.split('.') ?? [];
  for (const identifier of prerelease) {
    if (/^[0-9]+$/u.test(identifier) && identifier.length > 1 && identifier[0] === '0') {
      throw new TypeError(`${label} has a zero-padded numeric prerelease identifier`);
    }
  }
  const parsed = {
    build: Object.freeze(match[5]?.split('.') ?? []),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: Object.freeze(prerelease),
  };
  if (![parsed.major, parsed.minor, parsed.patch].every(Number.isSafeInteger)) {
    throw new TypeError(`${label} exceeds safe numeric SemVer bounds`);
  }
  return parsed;
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    if (a === b) continue;
    const aNumeric = /^[0-9]+$/u.test(a);
    const bNumeric = /^[0-9]+$/u.test(b);
    if (aNumeric && bNumeric) {
      if (a.length !== b.length) return a.length < b.length ? -1 : 1;
      return a < b ? -1 : 1;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function formatSemver(value: ParsedSemver): string {
  let output = `${value.major}.${value.minor}.${value.patch}`;
  if (value.prerelease.length > 0) output += `-${value.prerelease.join('.')}`;
  if (value.build.length > 0) output += `+${value.build.join('.')}`;
  return output;
}

function identifierArray(value: unknown, label: string): string[] {
  const values = denseArray(value, label, MAX_LIST_ENTRIES);
  const output = values.map((entry, index) => boundedIdentifier(entry, `${label}[${index}]`));
  const unique = new Set(output);
  if (unique.size !== output.length) throw new TypeError(`${label} contains duplicates`);
  return output;
}

function boundedIdentifier(value: unknown, label: string, maximum = 256): string {
  const text = boundedText(value, label, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@#-]*$/u.test(text)) {
    throw new TypeError(`${label} is not a stable machine identifier`);
  }
  return text;
}

function boundedText(value: unknown, label: string, maximum = MAX_TEXT): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    hasForbiddenTextCodePoint(value)
  ) {
    throw new TypeError(`${label} must be bounded printable text`);
  }
  return value;
}

function hasForbiddenTextCodePoint(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      return true;
    }
  }
  return false;
}

function exactIsoTimestamp(value: unknown, label: string): string {
  const text = boundedText(value, label, 64);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  return text;
}

function denseArray(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new TypeError(`${label} must be dense`);
    }
  }
  return value;
}

function exactRecord(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  const record = recordValue(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(', ')}`);
  }
  return record;
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be a JSON object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is AdvisorySeverity {
  return value === 'low' || value === 'moderate' || value === 'high' || value === 'critical';
}

function duplicateScalarOption(
  args: readonly string[],
  flags: readonly string[],
): string | undefined {
  const admitted = new Set(flags);
  const seen = new Set<string>();
  for (const argument of args) {
    const equals = argument.indexOf('=');
    const flag = equals < 0 ? argument : argument.slice(0, equals);
    if (!admitted.has(flag)) continue;
    if (seen.has(flag)) return flag;
    seen.add(flag);
  }
  return undefined;
}

function severityRank(value: AdvisorySeverity): number {
  switch (value) {
    case 'low':
      return 0;
    case 'moderate':
      return 1;
    case 'high':
      return 2;
    case 'critical':
      return 3;
  }
}

function singleLineError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/gu, ' ');
}
