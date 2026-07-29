import type {
  KovoAnalysisInputSource,
  KovoCheckInput,
  KovoGraphProof,
} from '@kovojs/core/internal/graph';
import { clientModuleRepresentationDigest } from '@kovojs/core/internal/client-module-url';
import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import {
  computeRenderPlanFingerprint,
  versionedClientModuleHref,
  type VersionedClientModuleInput,
} from '@kovojs/server/internal/client-modules';
import { runtimePostureFactsFromGraph } from '@kovojs/server/internal/runtime-registry-wire';
import { createHash } from 'node:crypto';

const graphProofKeys = [
  'appBuildToken',
  'compilerVersion',
  'completion',
  'configDigest',
  'postureProfile',
  'schema',
  'sourceSetDigest',
] as const;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;

/**
 * Mint the completion record only after the deployment graph and app-build token are final.
 *
 * The record is deterministic and path-independent; `assertKovoArtifactGraphProof` independently
 * recomputes every derivable identity when an operator later selects the artifact (SPEC §5.2.4).
 */
export function createKovoGraphProof(
  graph: KovoCheckInput,
  appBuildToken: string,
): KovoGraphProof {
  const inputs = requiredAnalysisInputs(graph);
  const compilerVersion = requiredCompilerVersion(graph);
  const token: `sha256:${string}` = `sha256:${appBuildToken}`;
  if (!sha256Pattern.test(token)) {
    throw new TypeError('Kovo build produced an invalid app build token.');
  }
  return Object.freeze({
    appBuildToken: token,
    compilerVersion,
    completion: 'complete',
    configDigest: digestSources(
      inputs.sources.filter((source) => source.role === 'config'),
      'kovo-config-source-set/v1',
    ),
    postureProfile: inputs.runtimeTarget,
    schema: 'kovo.graph.proof/v1',
    sourceSetDigest: digestSources(inputs.sources, 'kovo-analyzed-source-set/v1'),
  });
}

/** Fail closed unless a selected built graph carries one exact, internally consistent stamp. */
export function assertKovoArtifactGraphProof(graph: KovoCheckInput): KovoGraphProof {
  const proof = graph.proof;
  if (!isRecord(proof)) {
    throw new TypeError(
      'Kovo artifact graph is missing kovo.graph.proof/v1 completion; rebuild the artifact.',
    );
  }
  const keys = Object.keys(proof).sort();
  if (
    keys.length !== graphProofKeys.length ||
    keys.some((key, index) => key !== [...graphProofKeys].sort()[index])
  ) {
    throw new TypeError('Kovo artifact graph proof has an unknown or missing field.');
  }
  if (proof.schema !== 'kovo.graph.proof/v1') {
    throw new TypeError('Kovo artifact graph proof schema is unsupported.');
  }
  if (proof.completion !== 'complete') {
    throw new TypeError('Kovo artifact graph is incomplete or failed.');
  }
  if (
    !sha256Pattern.test(proof.appBuildToken) ||
    !sha256Pattern.test(proof.configDigest) ||
    !sha256Pattern.test(proof.sourceSetDigest)
  ) {
    throw new TypeError('Kovo artifact graph proof contains an invalid SHA-256 identity.');
  }

  const inputs = requiredAnalysisInputs(graph);
  if (proof.postureProfile !== inputs.runtimeTarget) {
    throw new TypeError('Kovo artifact graph proof posture does not match analyzed inputs.');
  }
  if (proof.compilerVersion !== requiredCompilerVersion(graph)) {
    throw new TypeError('Kovo artifact graph proof compiler identity is stale.');
  }
  const sourceSetDigest = digestSources(inputs.sources, 'kovo-analyzed-source-set/v1');
  if (proof.sourceSetDigest !== sourceSetDigest) {
    throw new TypeError('Kovo artifact graph proof source-set identity is stale.');
  }
  const configDigest = digestSources(
    inputs.sources.filter((source) => source.role === 'config'),
    'kovo-config-source-set/v1',
  );
  if (proof.configDigest !== configDigest) {
    throw new TypeError('Kovo artifact graph proof config identity is stale.');
  }
  assertRuntimePostureProof(graph);
  return proof;
}

export function hasKovoArtifactGraphProof(graph: KovoCheckInput): boolean {
  return graph.proof !== undefined;
}

/** Bind every completed graph fact, including the app-build token, into one artifact subject. */
export function createKovoRuntimePostureManifest(
  graph: KovoCheckInput,
): NonNullable<KovoCheckInput['runtimePosture']> {
  const facts = runtimePostureFactsFromGraph(graph);
  return {
    artifactSubject: digestCanonicalGraph(graph),
    facts,
    postureDigest: digestCanonicalGraph(facts),
    schema: 'kovo-runtime-posture/v1',
  };
}

/**
 * Derive the exact SPEC §5.2.1 token before artifact emission, from the same complete compiler and
 * stable/manual module set the neutral builder will atomically publish.
 */
export function deriveKovoAppBuildToken(
  compiledModules: readonly (VersionedClientModuleInput & {
    readonly renderPlanFingerprint?: string;
  })[],
  stableModules: readonly VersionedClientModuleInput[],
): string {
  let renderPlanFingerprint: string | undefined;
  for (const module of compiledModules) {
    if (
      typeof module.renderPlanFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(module.renderPlanFingerprint)
    ) {
      throw new TypeError(
        `Compiled client module ${module.path} lacks an exact render-plan fingerprint.`,
      );
    }
    if (renderPlanFingerprint === undefined) {
      renderPlanFingerprint = module.renderPlanFingerprint;
    } else if (renderPlanFingerprint !== module.renderPlanFingerprint) {
      throw new TypeError('Compiled client modules disagree on the render-plan fingerprint.');
    }
  }
  renderPlanFingerprint ??= computeRenderPlanFingerprint({});

  const hrefs = new Set<string>();
  for (const module of [...compiledModules, ...stableModules]) {
    hrefs.add(
      versionedClientModuleHref(
        module.path,
        clientModuleRepresentationDigest(module.source),
      ),
    );
  }
  const hash = createHash('sha256');
  updateBuildTokenFrame(hash, 'domain', 'kovo-app-build-token/v1');
  updateBuildTokenFrame(hash, 'render-plan', renderPlanFingerprint);
  for (const href of [...hrefs].sort()) {
    updateBuildTokenFrame(hash, 'active-module-href', href);
  }
  return hash.digest('hex');
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
    throw new TypeError('Kovo artifact graph lacks complete analyzed-input identity.');
  }
  for (let index = 0; index < inputs.sources.length; index += 1) {
    const source = inputs.sources[index];
    if (
      !isRecord(source) ||
      typeof source.path !== 'string' ||
      source.path.length === 0 ||
      source.path.startsWith('/') ||
      source.path.includes('\\') ||
      source.path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
      source.encoding !== 'utf16le' ||
      (source.role !== 'app' && source.role !== 'client-entry' && source.role !== 'config') ||
      typeof source.codeUnitLength !== 'number' ||
      !Number.isSafeInteger(source.codeUnitLength) ||
      source.codeUnitLength < 0 ||
      typeof source.contentHash !== 'string' ||
      !sha256Pattern.test(source.contentHash)
    ) {
      throw new TypeError(`Kovo artifact graph analyzed input ${index} is invalid.`);
    }
  }
  return inputs;
}

function requiredCompilerVersion(graph: KovoCheckInput): string {
  const packages = graph.provenance?.frameworkPackages;
  if (!Array.isArray(packages)) {
    throw new TypeError('Kovo artifact graph lacks framework package provenance.');
  }
  const versions = packages
    .filter((entry) => entry.name === '@kovojs/compiler')
    .map((entry) => entry.version);
  if (versions.length !== 1 || typeof versions[0] !== 'string' || versions[0].length === 0) {
    throw new TypeError('Kovo artifact graph must name exactly one executing compiler version.');
  }
  return versions[0];
}

function assertRuntimePostureProof(graph: KovoCheckInput): void {
  const runtimePosture = graph.runtimePosture;
  if (!isRecord(runtimePosture)) {
    throw new TypeError('Kovo artifact graph lacks its runtime posture subject.');
  }
  const keys = Object.keys(runtimePosture).sort();
  const expectedKeys = ['artifactSubject', 'facts', 'postureDigest', 'schema'];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError('Kovo artifact runtime posture has an unknown or missing field.');
  }
  if (
    runtimePosture.schema !== 'kovo-runtime-posture/v1' ||
    typeof runtimePosture.artifactSubject !== 'string' ||
    typeof runtimePosture.postureDigest !== 'string' ||
    !sha256Pattern.test(runtimePosture.artifactSubject) ||
    !sha256Pattern.test(runtimePosture.postureDigest)
  ) {
    throw new TypeError('Kovo artifact runtime posture identity is invalid.');
  }

  const { runtimePosture: _runtimePosture, ...subjectGraph } = graph;
  const expected = createKovoRuntimePostureManifest(subjectGraph);
  if (
    runtimePosture.artifactSubject !== expected.artifactSubject ||
    runtimePosture.postureDigest !== expected.postureDigest ||
    canonicalJsonStringify(runtimePosture.facts) !== canonicalJsonStringify(expected.facts)
  ) {
    throw new TypeError('Kovo artifact runtime posture subject is stale.');
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

function digestCanonicalGraph(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJsonStringify(value), 'utf8').digest('hex')}`;
}

function updateBuildTokenFrame(
  hash: ReturnType<typeof createHash>,
  tag: string,
  value: string,
): void {
  hash.update(`${Buffer.byteLength(tag, 'utf8')}:`, 'utf8');
  hash.update(tag, 'utf8');
  hash.update(`${Buffer.byteLength(value, 'utf8')}:`, 'utf8');
  hash.update(value, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
