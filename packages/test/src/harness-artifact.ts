import type {
  KovoAnalysisInputSource,
  KovoCheckInput,
  KovoGraphProof,
  TouchGraph,
} from '@kovojs/core/internal/graph';
import { validateKovoExplainInput } from '@kovojs/core/internal/graph';
import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import { declaredKovoAppId, resolveKovoAppToken } from '@kovojs/server/internal/build';
import { runtimePostureFactsFromGraph } from '@kovojs/server/internal/runtime-registry-wire';
import type { KovoApp } from '@kovojs/server/custom-adapters';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactByteLimit = 32 * 1024 * 1024;
const canonicalAppIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const graphProofKeys = [
  'appBuildToken',
  'appId',
  'compilerVersion',
  'completion',
  'configDigest',
  'postureProfile',
  'schema',
  'sourceSetDigest',
] as const;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;

export interface LoadedKovoTestArtifact {
  readonly graph: KovoCheckInput;
  readonly proof: KovoGraphProof & { readonly appId: string };
  readonly touchGraph: TouchGraph;
}

export async function loadKovoTestArtifact(
  app: KovoApp,
  artifactInput: string | URL,
  projectRootInput: string | URL,
): Promise<LoadedKovoTestArtifact> {
  const artifactPath = absolutePath(artifactInput, 'artifact');
  const projectRoot = absolutePath(projectRootInput, 'projectRoot');
  const artifactStats = await stat(artifactPath);
  if (!artifactStats.isFile() || artifactStats.size > artifactByteLimit) {
    throw new TypeError(
      `Kovo test artifact must be a file no larger than ${String(artifactByteLimit)} bytes.`,
    );
  }
  const source = await readFile(artifactPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new TypeError('Kovo test artifact is not valid JSON.');
  }
  if (!isRecord(parsed)) throw new TypeError('Kovo test artifact graph must be an object.');
  const graph = parsed as KovoCheckInput;
  const graphFindings = validateKovoExplainInput(graph);
  if (graphFindings.length > 0) {
    throw new TypeError(
      `Kovo test artifact graph is invalid: ${graphFindings[0]!.path}: ${graphFindings[0]!.message}`,
    );
  }

  const proof = assertKovoArtifactGraphProof(graph);
  await assertCurrentAnalysisInputs(graph, projectRoot);
  await assertCurrentLockfile(graph, projectRoot);

  const runtimeApp = resolveKovoAppToken(app, '@kovojs/test/harness');
  const runtimeAppId = declaredKovoAppId(runtimeApp);
  if (runtimeAppId === undefined) {
    throw new TypeError(
      'Kovo app-scoped tests require defineKovo({ appId }) so build evidence cannot be reused across apps.',
    );
  }
  if (proof.appId === null) {
    throw new TypeError(
      'Kovo test artifact omitted its app identity; rebuild after declaring defineKovo({ appId }).',
    );
  }
  if (proof.appId !== runtimeAppId) {
    throw new TypeError(
      `Kovo test artifact belongs to app ${proof.appId}, not the imported app ${runtimeAppId}.`,
    );
  }

  return Object.freeze({
    graph,
    proof: proof as KovoGraphProof & { readonly appId: string },
    touchGraph: graph.touchGraph ?? Object.freeze({}),
  });
}

function assertKovoArtifactGraphProof(graph: KovoCheckInput): KovoGraphProof {
  const proof = graph.proof;
  if (!isRecord(proof)) {
    throw new TypeError(
      'Kovo test artifact is missing kovo.graph.proof/v2 completion; run a successful kovo build.',
    );
  }
  const keys = Object.keys(proof).sort();
  const expectedKeys = [...graphProofKeys].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError('Kovo test artifact proof has an unknown or missing field.');
  }
  if (proof.schema !== 'kovo.graph.proof/v2') {
    throw new TypeError('Kovo test artifact proof schema is unsupported.');
  }
  if (proof.completion !== 'complete') {
    throw new TypeError('Kovo test artifact records an incomplete or failed build.');
  }
  if (
    !sha256Pattern.test(proof.appBuildToken as string) ||
    !sha256Pattern.test(proof.configDigest as string) ||
    !sha256Pattern.test(proof.sourceSetDigest as string)
  ) {
    throw new TypeError('Kovo test artifact proof contains an invalid SHA-256 identity.');
  }
  if (
    proof.appId !== null &&
    (typeof proof.appId !== 'string' || !canonicalAppIdPattern.test(proof.appId))
  ) {
    throw new TypeError('Kovo test artifact proof contains an invalid app identity.');
  }

  const inputs = requiredAnalysisInputs(graph);
  if (proof.postureProfile !== inputs.runtimeTarget) {
    throw new TypeError('Kovo test artifact proof posture does not match analyzed inputs.');
  }
  if (proof.compilerVersion !== requiredCompilerVersion(graph)) {
    throw new TypeError('Kovo test artifact compiler identity is stale.');
  }
  if (
    proof.sourceSetDigest !== digestSources(inputs.sources, 'kovo-analyzed-source-set/v1') ||
    proof.configDigest !==
      digestSources(
        inputs.sources.filter((entry) => entry.role === 'config'),
        'kovo-config-source-set/v1',
      )
  ) {
    throw new TypeError('Kovo test artifact source or config identity is stale.');
  }
  assertRuntimePostureProof(graph);
  return proof as unknown as KovoGraphProof;
}

async function assertCurrentAnalysisInputs(
  graph: KovoCheckInput,
  projectRoot: string,
): Promise<void> {
  const inputs = requiredAnalysisInputs(graph);
  for (let index = 0; index < inputs.sources.length; index += 1) {
    const expected = inputs.sources[index]!;
    const path = resolveContainedPath(projectRoot, expected.path);
    let current: string;
    try {
      current = await readFile(path, 'utf8');
    } catch {
      throw new TypeError(
        `Kovo test artifact source ${expected.path} is missing; rebuild before running tests.`,
      );
    }
    const contentHash = sha256Utf16le(current);
    if (current.length !== expected.codeUnitLength || contentHash !== expected.contentHash) {
      throw new TypeError(
        `Kovo test artifact source ${expected.path} changed after the build; rebuild before running tests.`,
      );
    }
  }
}

async function assertCurrentLockfile(graph: KovoCheckInput, projectRoot: string): Promise<void> {
  const expected = graph.provenance?.pnpmLock.contentHash;
  if (typeof expected !== 'string' || !sha256Pattern.test(expected)) {
    throw new TypeError('Kovo test artifact lacks exact pnpm lockfile provenance.');
  }
  const lockfile = await nearestLockfile(projectRoot);
  if (lockfile === undefined) {
    throw new TypeError('Kovo test project has no pnpm-lock.yaml to match artifact provenance.');
  }
  const bytes = await readFile(lockfile);
  const current = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (current !== expected) {
    throw new TypeError(
      'Kovo test project lockfile changed after the build; reinstall and rebuild before testing.',
    );
  }
}

async function nearestLockfile(start: string): Promise<string | undefined> {
  let current = start;
  for (;;) {
    const candidate = join(current, 'pnpm-lock.yaml');
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Walk to the parent.
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function requiredAnalysisInputs(graph: KovoCheckInput) {
  const inputs = graph.analysisInputs;
  if (
    !isRecord(inputs) ||
    inputs.schema !== 'kovo.analysis.inputs/v1' ||
    !Array.isArray(inputs.sources) ||
    (inputs.runtimeTarget !== 'cloudflare' &&
      inputs.runtimeTarget !== 'node' &&
      inputs.runtimeTarget !== 'vercel')
  ) {
    throw new TypeError('Kovo test artifact lacks complete analyzed-input identity.');
  }
  const sources = inputs.sources as unknown[];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (
      !isRecord(source) ||
      typeof source.path !== 'string' ||
      source.path.length === 0 ||
      source.path.startsWith('/') ||
      source.path.includes('\\') ||
      source.path
        .split('/')
        .some((segment) => segment === '' || segment === '.' || segment === '..') ||
      source.encoding !== 'utf16le' ||
      (source.role !== 'app' && source.role !== 'client-entry' && source.role !== 'config') ||
      typeof source.codeUnitLength !== 'number' ||
      !Number.isSafeInteger(source.codeUnitLength) ||
      source.codeUnitLength < 0 ||
      typeof source.contentHash !== 'string' ||
      !sha256Pattern.test(source.contentHash)
    ) {
      throw new TypeError(`Kovo test artifact analyzed input ${String(index)} is invalid.`);
    }
  }
  return inputs as {
    readonly runtimeTarget: 'cloudflare' | 'node' | 'vercel';
    readonly sources: readonly KovoAnalysisInputSource[];
  };
}

function requiredCompilerVersion(graph: KovoCheckInput): string {
  const packages = graph.provenance?.frameworkPackages;
  if (!Array.isArray(packages)) {
    throw new TypeError('Kovo test artifact lacks framework package provenance.');
  }
  const versions = packages
    .filter((entry) => entry.name === '@kovojs/compiler')
    .map((entry) => entry.version);
  if (versions.length !== 1 || typeof versions[0] !== 'string' || versions[0].length === 0) {
    throw new TypeError('Kovo test artifact must name one executing compiler version.');
  }
  return versions[0];
}

function assertRuntimePostureProof(graph: KovoCheckInput): void {
  if (!isRecord(graph.runtimePosture)) {
    throw new TypeError('Kovo test artifact lacks its completed runtime posture subject.');
  }
  const runtimePosture = graph.runtimePosture;
  const keys = Object.keys(runtimePosture).sort();
  const expectedKeys = ['artifactSubject', 'facts', 'postureDigest', 'schema'];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError('Kovo test artifact runtime posture has an unknown or missing field.');
  }
  const { runtimePosture: _runtimePosture, ...subjectGraph } = graph;
  const facts = runtimePostureFactsFromGraph(subjectGraph);
  const expectedSubject = digestCanonical(subjectGraph);
  const expectedPosture = digestCanonical(facts);
  if (
    runtimePosture.schema !== 'kovo-runtime-posture/v1' ||
    runtimePosture.artifactSubject !== expectedSubject ||
    runtimePosture.postureDigest !== expectedPosture ||
    canonicalJsonStringify(runtimePosture.facts) !== canonicalJsonStringify(facts)
  ) {
    throw new TypeError('Kovo test artifact runtime posture subject is stale.');
  }
}

function digestSources(
  sources: readonly KovoAnalysisInputSource[],
  domain: string,
): `sha256:${string}` {
  const canonical = [...sources]
    .map((source) => ({
      codeUnitLength: source.codeUnitLength,
      contentHash: source.contentHash,
      encoding: source.encoding,
      path: source.path,
      role: source.role,
    }))
    .sort((left, right) =>
      left.role === right.role
        ? left.path === right.path
          ? 0
          : left.path < right.path
            ? -1
            : 1
        : left.role < right.role
          ? -1
          : 1,
    );
  const body = JSON.stringify(canonical);
  const framed = `${Buffer.byteLength(domain, 'utf8')}:${domain}${Buffer.byteLength(body, 'utf8')}:${body}`;
  return `sha256:${createHash('sha256').update(framed, 'utf8').digest('hex')}`;
}

function digestCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJsonStringify(value), 'utf8').digest('hex')}`;
}

function sha256Utf16le(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(Buffer.from(value, 'utf16le')).digest('hex')}`;
}

function absolutePath(input: string | URL, label: string): string {
  const value = input instanceof URL ? fileURLToPath(input) : input;
  if (!isAbsolute(value)) {
    throw new TypeError(`Kovo test ${label} must be an explicit absolute path or file URL.`);
  }
  return resolve(value);
}

function resolveContainedPath(root: string, path: string): string {
  const resolved = resolve(root, path);
  const offset = relative(root, resolved);
  if (offset === '..' || offset.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new TypeError(`Kovo test artifact source escapes projectRoot: ${path}`);
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
