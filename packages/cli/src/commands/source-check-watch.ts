/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */
import { lstatSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  finishKovoSourceCheckOneShot,
  kovoSourceCheckOneShotIdentity,
  produceKovoSourceCheckOneShotAnalysis,
  type KovoSourceCheckOneShotAnalysis,
  type KovoSourceCheckOptions,
  type KovoSourceCheckPhaseCensus,
} from './build-export.js';
import {
  buildApply,
  buildArrayJoin,
  buildArrayLength,
  buildCreateMap,
  buildMapClear,
  buildMapHas,
  buildMapSet,
  buildMapSize,
  buildOwnDataValue,
  buildRegExpExec,
  buildSecurityArrayAppend,
  buildSnapshotDenseArray,
  buildStringEndsWith,
  buildStringSplit,
  buildStringStartsWith,
} from './build-security-intrinsics.js';
import { kovoBuildOneShotDigest, type KovoBuildOneShotIdentity } from './build-one-shot-handoff.js';
import { type KovoCommandSecurityDisposition } from './security-disposition.js';
import {
  createKovoSourceCheckInputProof,
  createRejectedKovoSourceCheckInputProof,
  KOVO_SOURCE_CHECK_PHASES,
  runKovoSourceCheckWatchSession,
  snapshotKovoSourceCheckProject,
  type KovoAcceptedSourceCheckInputProof,
  type KovoRejectedSourceCheckInputProof,
  type KovoSourceCheckPhaseObservation,
  type KovoSourceCheckRevisionResult,
  type KovoSourceCheckWatchSessionOptions,
  type KovoSourceCheckWatchSnapshot,
} from './source-check-session.js';
import { snapshotKovoInvocationEnvironment } from '../invocation-environment.js';
import { type CliCommandResult } from '../shared.js';

const phaseCensusEnvironmentName = 'KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE';
const phaseCensusLinePrefix = 'kovo-check-phase-census/v1 ';
const maximumSessionFactKeys = 512;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const NativeObject = Object;
const NativeObjectCreate = Object.create;
const NativeObjectDefineProperty = Object.defineProperty;
const NativeObjectFreeze = Object.freeze;
const NativeObjectKeys = Object.keys;
const NativeJSON = JSON;
const NativeJSONParse = JSON.parse;
const NativeNumber = Number;
const NativeNumberIsSafeInteger = Number.isSafeInteger;
const NativeStringLastIndexOf = String.prototype.lastIndexOf;
const NativeStringSlice = String.prototype.slice;
const NativeStringToLowerCase = String.prototype.toLowerCase;
const NativeTypeError = TypeError;
const positiveInfinity = Number.POSITIVE_INFINITY;
const preDiagnosticPhaseCount = KOVO_SOURCE_CHECK_PHASES.length - 1;

interface KovoInternalSourceCheckPhaseCensus {
  readonly checkGraphDigest: string;
  readonly phases: readonly {
    readonly durationMs: number;
    readonly name: string;
    readonly status: string;
  }[];
  readonly source: {
    readonly codeUnitLength: number;
    readonly contentHash: string;
    readonly encoding: 'utf16le';
    readonly path: string;
  };
}

/** @internal Test controls for the real command adapter; production supplies none of these. */
export interface KovoSourceCheckWatchCommandControls {
  readonly maxRevisions?: number;
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
  readonly snapshotProject?: (root: string) => KovoSourceCheckWatchSnapshot;
  readonly write?: (line: string) => void;
}

/** @internal Observable lifecycle only; cached values are digest keys, never compiler outputs. */
export interface KovoSourceCheckSessionFactCacheSnapshot {
  readonly closed: boolean;
  readonly enabled: boolean;
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
}

/**
 * Session-confined cache of authenticated phase-input identities.
 *
 * This cache deliberately cannot return diagnostics, graphs, app values, source text, or runtime
 * authority. A revision must first complete the fresh one-shot producer and handoff revalidation;
 * only then may its content-addressed phase keys be remembered. The current adapter executes every
 * diagnostic-producing phase and uses this ledger to prove bounded lifecycle/invalidation. Future
 * phase reuse must add an explicit compiler-owned fact payload and validator before it may publish
 * `reused-authenticated`.
 */
export class KovoSourceCheckSessionFactCache {
  readonly #enabled: boolean;
  readonly #keys = buildCreateMap<string, true>();
  #closed = false;
  #hits = 0;
  #misses = 0;

  constructor(enabled: boolean) {
    if (typeof enabled !== 'boolean') {
      throw new NativeTypeError('Source-check session cache posture must be boolean.');
    }
    this.#enabled = enabled;
  }

  observe(phaseName: string, inputDigest: string): boolean {
    this.#assertOpen();
    if (
      typeof phaseName !== 'string' ||
      phaseName === '' ||
      typeof inputDigest !== 'string' ||
      buildRegExpExec(digestPattern, inputDigest) === null
    ) {
      throw new NativeTypeError('Source-check session cache key is invalid.');
    }
    if (!this.#enabled) {
      this.#misses += 1;
      return false;
    }
    const key = kovoBuildOneShotDigest({
      inputDigest,
      phaseName,
      schema: 'kovo-check-session-fact-key/v1',
    });
    const hit = buildMapHas(this.#keys, key);
    if (hit) {
      this.#hits += 1;
      return true;
    }
    this.#misses += 1;
    if (buildMapSize(this.#keys) >= maximumSessionFactKeys) buildMapClear(this.#keys);
    buildMapSet(this.#keys, key, true);
    return false;
  }

  close(): void {
    if (this.#closed) return;
    buildMapClear(this.#keys);
    this.#closed = true;
  }

  snapshot(): KovoSourceCheckSessionFactCacheSnapshot {
    return buildApply(NativeObjectFreeze, undefined, [
      {
        closed: this.#closed,
        enabled: this.#enabled,
        entries: buildMapSize(this.#keys),
        hits: this.#hits,
        misses: this.#misses,
      },
    ]);
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new NativeTypeError('Source-check session cache is closed.');
    }
  }
}

/**
 * Execute `kovo check source --watch` through the same fresh one-shot producer and finisher used
 * by ordinary `kovo check source` (SPEC §11.4).
 */
export async function runKovoSourceCheckWatchCommand(
  options: KovoSourceCheckOptions,
  security: KovoCommandSecurityDisposition,
  controls: KovoSourceCheckWatchCommandControls = {},
): Promise<0 | 1 | 2> {
  const root = resolve(security.invocationCwd);
  const entryPath = projectRelativePath(root, options.appModulePath);
  const checkSecurity = sourceCheckCensusSecurity(security, entryPath);
  const cache = new KovoSourceCheckSessionFactCache(options.cache);
  const snapshotProject = controls.snapshotProject ?? snapshotKovoSourceCheckProject;
  const sessionOptions: KovoSourceCheckWatchSessionOptions = {
    appModulePath: options.appModulePath,
    invocationRoot: root,
    async runRevision(_revision, trigger) {
      return runKovoSourceCheckWatchRevision(
        options,
        checkSecurity,
        trigger,
        cache,
        snapshotProject,
      );
    },
    ...(controls.maxRevisions === undefined ? {} : { maxRevisions: controls.maxRevisions }),
    ...(controls.pollIntervalMs === undefined ? {} : { pollIntervalMs: controls.pollIntervalMs }),
    ...(controls.signal === undefined ? {} : { signal: controls.signal }),
    ...(controls.snapshotProject === undefined
      ? {}
      : { snapshotProject: controls.snapshotProject }),
    ...(controls.write === undefined ? {} : { write: controls.write }),
  };
  try {
    return await runKovoSourceCheckWatchSession(sessionOptions);
  } finally {
    cache.close();
  }
}

/** @internal One production revision, exported only for focused lifecycle/adversarial tests. */
export async function runKovoSourceCheckWatchRevision(
  options: KovoSourceCheckOptions,
  security: KovoCommandSecurityDisposition,
  trigger: KovoSourceCheckWatchSnapshot,
  cache: KovoSourceCheckSessionFactCache,
  snapshotProject: (root: string) => KovoSourceCheckWatchSnapshot = snapshotKovoSourceCheckProject,
): Promise<KovoSourceCheckRevisionResult> {
  const root = resolve(security.invocationCwd);
  const entryPath = projectRelativePath(root, options.appModulePath);
  const entryAbsolute = resolve(root, options.appModulePath);
  if (buildArrayLength(trigger.symlinks, 'Source-check revision trigger symlinks') > 0) {
    return rejectedRevision(
      entryPath,
      trigger,
      'symlink',
      sourceCheckWatchError('project symlinks make the compiler input closure ambiguous'),
    );
  }

  const before = stableRevisionSnapshot(root, trigger, snapshotProject);
  if (before === undefined) {
    return rejectedRevision(
      entryPath,
      trigger,
      entryFailureReason(entryAbsolute, false),
      sourceCheckWatchError('project bytes changed before the source proof started'),
    );
  }

  const produced = await produceKovoSourceCheckOneShotAnalysis(options, security);
  if (isCliCommandResult(produced)) {
    return rejectedRevision(entryPath, trigger, entryFailureReason(entryAbsolute, false), produced);
  }
  const analysis = produced;
  const phaseCensus = buildOwnDataValue(
    analysis,
    'phaseCensus',
    'Source-check one-shot analysis',
  ) as KovoSourceCheckPhaseCensus | undefined;
  const graphDigest = buildOwnDataValue(
    analysis,
    'devexCheckGraphDigest',
    'Source-check one-shot analysis',
  );
  if (
    phaseCensus === undefined ||
    typeof graphDigest !== 'string' ||
    buildRegExpExec(digestPattern, graphDigest) === null
  ) {
    return rejectedRevision(
      entryPath,
      trigger,
      'ambiguous-closure',
      sourceCheckWatchError('one-shot producer omitted authenticated phase or graph evidence'),
    );
  }

  let input: KovoAcceptedSourceCheckInputProof;
  let identity: KovoBuildOneShotIdentity;
  try {
    const sourceFiles = buildOwnDataValue(
      analysis,
      'sourceFiles',
      'Source-check one-shot analysis',
    ) as KovoSourceCheckOneShotAnalysis['sourceFiles'];
    const approvedConfig = buildOwnDataValue(
      analysis,
      'approvedConfig',
      'Source-check one-shot analysis',
    ) as KovoSourceCheckOneShotAnalysis['approvedConfig'];
    input = createKovoSourceCheckInputProof(
      entryPath,
      sourceFiles,
      approvedConfig === undefined ? [] : approvedConfig.files,
    );
    identity = kovoSourceCheckOneShotIdentity(options, analysis, security);
  } catch {
    return rejectedRevision(
      entryPath,
      trigger,
      'ambiguous-closure',
      sourceCheckWatchError('one-shot source/config closure could not be authenticated'),
    );
  }

  const resultWithCensus = await finishKovoSourceCheckOneShot(
    options,
    analysis,
    identity,
    security,
  );
  if (buildOwnDataValue(resultWithCensus, 'error', 'Source-check one-shot result') !== undefined) {
    return rejectedRevision(entryPath, trigger, 'ambiguous-closure', resultWithCensus);
  }

  const after = stableRevisionSnapshot(root, trigger, snapshotProject);
  if (after === undefined) {
    return rejectedRevision(
      entryPath,
      trigger,
      entryFailureReason(entryAbsolute, true),
      sourceCheckWatchError('project bytes changed while the source proof was running'),
    );
  }

  let census;
  let result;
  try {
    const extracted = extractInternalPhaseCensus(resultWithCensus);
    census = acceptedPhaseCensus(
      phaseCensus,
      extracted.census,
      input,
      identity,
      trigger,
      graphDigest,
      cache,
    );
    result = extracted.result;
  } catch {
    return rejectedRevision(
      entryPath,
      trigger,
      'ambiguous-closure',
      sourceCheckWatchError('one-shot phase evidence could not be authenticated'),
    );
  }
  return buildApply(NativeObjectFreeze, undefined, [{ census, input, result }]);
}

function acceptedPhaseCensus(
  raw: KovoSourceCheckPhaseCensus,
  finished: KovoInternalSourceCheckPhaseCensus,
  input: KovoAcceptedSourceCheckInputProof,
  identity: KovoBuildOneShotIdentity,
  trigger: KovoSourceCheckWatchSnapshot,
  graphDigest: string,
  cache: KovoSourceCheckSessionFactCache,
): KovoSourceCheckRevisionResult['census'] {
  const rawPhases = buildSnapshotDenseArray(
    buildOwnDataValue(raw, 'phases', 'Source-check one-shot phase census') as readonly {
      readonly durationMs: number;
      readonly name: string;
      readonly status: string;
    }[],
    'Source-check one-shot phase census',
  );
  if (
    buildArrayLength(rawPhases, 'Source-check one-shot phase census') !== preDiagnosticPhaseCount
  ) {
    throw new NativeTypeError('Source-check one-shot producer phase census is incomplete.');
  }
  const rawSourcePath = buildOwnDataValue(raw, 'sourcePath', 'Source-check one-shot phase census');
  if (
    rawSourcePath !== input.entry.path ||
    finished.source.path !== rawSourcePath ||
    finished.checkGraphDigest !== graphDigest
  ) {
    throw new NativeTypeError('Source-check one-shot phase census input evidence is stale.');
  }
  const finishedPhases = buildSnapshotDenseArray(
    finished.phases,
    'Source-check finished phase census',
  );
  const phases: KovoSourceCheckPhaseObservation[] = [];
  for (let index = 0; index < KOVO_SOURCE_CHECK_PHASES.length; index += 1) {
    const expectedName = KOVO_SOURCE_CHECK_PHASES[index]!;
    const phase = finishedPhases[index]!;
    const name = buildOwnDataValue(phase, 'name', 'Source-check one-shot phase');
    const status = buildOwnDataValue(phase, 'status', 'Source-check one-shot phase');
    const durationMs = buildOwnDataValue(phase, 'durationMs', 'Source-check one-shot phase');
    if (
      name !== expectedName ||
      (status !== 'executed' && status !== 'not-applicable') ||
      typeof durationMs !== 'number' ||
      !(durationMs >= 0 && durationMs < positiveInfinity) ||
      (status === 'not-applicable' && durationMs !== 0)
    ) {
      throw new NativeTypeError(`Source-check one-shot phase ${expectedName} is invalid.`);
    }
    if (index < preDiagnosticPhaseCount) {
      const producedPhase = rawPhases[index]!;
      if (
        buildOwnDataValue(producedPhase, 'name', 'Source-check producer phase') !== name ||
        buildOwnDataValue(producedPhase, 'status', 'Source-check producer phase') !== status ||
        buildOwnDataValue(producedPhase, 'durationMs', 'Source-check producer phase') !== durationMs
      ) {
        throw new NativeTypeError(
          `Source-check finished phase ${expectedName} does not match its producer evidence.`,
        );
      }
    } else if (status !== 'executed') {
      throw new NativeTypeError('Source-check graph diagnostics phase was not executed.');
    }
    const inputDigest = sourceCheckPhaseInputDigest(
      expectedName,
      status,
      input,
      identity,
      trigger,
      graphDigest,
    );
    cache.observe(expectedName, inputDigest);
    buildSecurityArrayAppend(
      phases,
      buildApply(NativeObjectFreeze, undefined, [
        { durationMs, inputDigest, name: expectedName, status },
      ]),
      'Source-check watch phase observations',
    );
  }
  return buildApply(NativeObjectFreeze, undefined, [
    {
      checkGraphDigest: graphDigest,
      phases: buildApply(NativeObjectFreeze, undefined, [phases]),
      schema: 'kovo-check-phase-census/v2' as const,
    },
  ]);
}

function sourceCheckPhaseInputDigest(
  name: (typeof KOVO_SOURCE_CHECK_PHASES)[number],
  status: 'executed' | 'not-applicable',
  input: KovoAcceptedSourceCheckInputProof,
  identity: KovoBuildOneShotIdentity,
  trigger: KovoSourceCheckWatchSnapshot,
  graphDigest: string,
): string {
  let facts: string;
  if (status === 'not-applicable') {
    facts = 'not-applicable';
  } else if (name === 'lifecycle-policy') {
    facts = trigger.digest;
  } else if (name === 'config-trust') {
    facts = input.configClosureDigest ?? 'no-config';
  } else if (name === 'typescript' || name === 'project-quality' || name === 'sound-subset') {
    // These analyzers may inspect project files outside the entry-reachable app closure.
    facts = trigger.digest;
  } else if (name === 'graph-diagnostics') {
    facts = graphDigest;
  } else {
    facts = input.projectDigest;
  }
  return kovoBuildOneShotDigest({
    compilerProvenanceDigest: identity.compilerProvenanceDigest,
    configSourceDigest: identity.configSourceDigest,
    facts,
    name,
    optionsDigest: identity.optionsDigest,
    schema: 'kovo-check-phase-input/v1',
    status,
  });
}

function rejectedRevision(
  entryPath: string,
  trigger: KovoSourceCheckWatchSnapshot,
  reason: KovoRejectedSourceCheckInputProof['reason'],
  result: CliCommandResult,
): KovoSourceCheckRevisionResult {
  const input = createRejectedKovoSourceCheckInputProof(entryPath, trigger.digest, reason);
  const phases: KovoSourceCheckPhaseObservation[] = [];
  for (let index = 0; index < KOVO_SOURCE_CHECK_PHASES.length; index += 1) {
    const name = KOVO_SOURCE_CHECK_PHASES[index]!;
    buildSecurityArrayAppend(
      phases,
      buildApply(NativeObjectFreeze, undefined, [
        {
          durationMs: 0,
          inputDigest: kovoBuildOneShotDigest({
            name,
            projectSnapshotDigest: trigger.digest,
            reason,
            schema: 'kovo-check-rejected-phase-input/v1',
          }),
          name,
          status: 'not-reached' as const,
        },
      ]),
      'Rejected source-check phase observations',
    );
  }
  return buildApply(NativeObjectFreeze, undefined, [
    {
      census: buildApply(NativeObjectFreeze, undefined, [
        {
          checkGraphDigest: null,
          phases: buildApply(NativeObjectFreeze, undefined, [phases]),
          schema: 'kovo-check-phase-census/v2' as const,
        },
      ]),
      input,
      result,
    },
  ]);
}

function stableRevisionSnapshot(
  root: string,
  trigger: KovoSourceCheckWatchSnapshot,
  snapshotProject: (root: string) => KovoSourceCheckWatchSnapshot,
): KovoSourceCheckWatchSnapshot | undefined {
  try {
    const snapshot = snapshotProject(root);
    return snapshot.digest === trigger.digest ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

function sourceCheckWatchError(message: string): CliCommandResult {
  return buildApply(NativeObjectFreeze, undefined, [
    {
      error: `kovo-check/v1\nERROR kovo check source --watch ${message}`,
      exitCode: 1 as const,
    },
  ]);
}

function entryFailureReason(
  absolute: string,
  previouslyAuthenticated: boolean,
): KovoRejectedSourceCheckInputProof['reason'] {
  try {
    const stat = lstatSync(absolute);
    const mode = buildOwnDataValue(stat, 'mode', 'Source-check entry filesystem metadata');
    if (typeof mode !== 'number') return 'ambiguous-closure';
    if ((mode & 0o170000) === 0o120000) return 'symlink';
    return 'ambiguous-closure';
  } catch (error) {
    const code =
      error !== null && typeof error === 'object'
        ? buildOwnDataValue(error, 'code', 'Source-check entry filesystem error')
        : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return previouslyAuthenticated ? 'renamed' : 'missing';
    }
    return 'ambiguous-closure';
  }
}

function extractInternalPhaseCensus(result: CliCommandResult): {
  readonly census: KovoInternalSourceCheckPhaseCensus;
  readonly result: CliCommandResult;
} {
  if (buildOwnDataValue(result, 'error', 'Source-check one-shot result') !== undefined) {
    throw new NativeTypeError('Source-check failed before it emitted phase evidence.');
  }
  const rawOutput = buildOwnDataValue(result, 'output', 'Source-check one-shot result');
  if (typeof rawOutput !== 'string') {
    throw new NativeTypeError('Source-check one-shot output is invalid.');
  }
  const marker = `\n${phaseCensusLinePrefix}`;
  const markerIndex = buildApply<number>(NativeStringLastIndexOf, rawOutput, [marker]);
  if (markerIndex < 0 || !buildStringEndsWith(rawOutput, '\n')) {
    throw new NativeTypeError('Source-check one-shot result omitted its internal phase census.');
  }
  const internalLine = buildApply<string>(NativeStringSlice, rawOutput, [markerIndex + 1]);
  if (!buildStringStartsWith(internalLine, phaseCensusLinePrefix)) {
    throw new NativeTypeError('Source-check one-shot phase census line is malformed.');
  }
  const payload = buildApply<string>(NativeStringSlice, internalLine, [
    phaseCensusLinePrefix.length,
  ]);
  const parsed = buildApply<unknown>(NativeJSONParse, NativeJSON, [payload]);
  const schema = buildOwnDataValue(parsed, 'schema', 'Source-check internal phase census');
  const checkGraphDigest = buildOwnDataValue(
    parsed,
    'checkGraphDigest',
    'Source-check internal phase census',
  );
  const source = buildOwnDataValue(parsed, 'source', 'Source-check internal phase census');
  const sourceCodeUnitLength = buildOwnDataValue(
    source,
    'codeUnitLength',
    'Source-check internal phase census source',
  );
  const sourceContentHash = buildOwnDataValue(
    source,
    'contentHash',
    'Source-check internal phase census source',
  );
  const sourceEncoding = buildOwnDataValue(
    source,
    'encoding',
    'Source-check internal phase census source',
  );
  const sourcePath = buildOwnDataValue(source, 'path', 'Source-check internal phase census source');
  if (
    schema !== 'kovo-check-phase-census/v1' ||
    typeof checkGraphDigest !== 'string' ||
    buildRegExpExec(digestPattern, checkGraphDigest) === null ||
    typeof sourceCodeUnitLength !== 'number' ||
    !buildApply<boolean>(NativeNumberIsSafeInteger, NativeNumber, [sourceCodeUnitLength]) ||
    sourceCodeUnitLength < 0 ||
    typeof sourceContentHash !== 'string' ||
    buildRegExpExec(digestPattern, sourceContentHash) === null ||
    sourceEncoding !== 'utf16le' ||
    typeof sourcePath !== 'string' ||
    sourcePath === ''
  ) {
    throw new NativeTypeError('Source-check internal phase census evidence is invalid.');
  }
  const parsedPhases = buildSnapshotDenseArray(
    buildOwnDataValue(parsed, 'phases', 'Source-check internal phase census') as readonly {
      readonly durationMs: number;
      readonly name: string;
      readonly status: string;
    }[],
    'Source-check internal phase census',
  );
  if (
    buildArrayLength(parsedPhases, 'Source-check internal phase census') !==
    KOVO_SOURCE_CHECK_PHASES.length
  ) {
    throw new NativeTypeError('Source-check internal phase census is incomplete.');
  }
  const output = buildApply<string>(NativeStringSlice, rawOutput, [0, markerIndex + 1]);
  const exitCode = buildOwnDataValue(result, 'exitCode', 'Source-check one-shot result');
  if (exitCode !== 0 && exitCode !== 1) {
    throw new NativeTypeError('Source-check one-shot output exit code is invalid.');
  }
  const clean: CliCommandResult = { exitCode, output };
  const diagnostics = buildOwnDataValue(result, 'diagnostics', 'Source-check one-shot result');
  if (diagnostics !== undefined) {
    buildApply(NativeObjectDefineProperty, NativeObject, [
      clean,
      'diagnostics',
      {
        configurable: false,
        enumerable: false,
        value: diagnostics,
        writable: false,
      },
    ]);
  }
  return buildApply(NativeObjectFreeze, undefined, [
    {
      census: buildApply(NativeObjectFreeze, undefined, [
        {
          checkGraphDigest,
          phases: parsedPhases,
          source: buildApply(NativeObjectFreeze, undefined, [
            {
              codeUnitLength: sourceCodeUnitLength,
              contentHash: sourceContentHash,
              encoding: sourceEncoding,
              path: sourcePath,
            },
          ]),
        },
      ]),
      result: clean,
    },
  ]);
}

function sourceCheckCensusSecurity(
  security: KovoCommandSecurityDisposition,
  entryPath: string,
): KovoCommandSecurityDisposition {
  const environment = buildApply<NodeJS.ProcessEnv>(NativeObjectCreate, NativeObject, [null]);
  const names = buildApply<string[]>(NativeObjectKeys, NativeObject, [security.invocationEnv]);
  const targetName = buildApply<string>(NativeStringToLowerCase, phaseCensusEnvironmentName, []);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    if (buildApply<string>(NativeStringToLowerCase, name, []) === targetName) continue;
    const value = buildOwnDataValue(
      security.invocationEnv,
      name,
      'Source-check invocation environment',
    );
    if (typeof value !== 'string') {
      throw new NativeTypeError(`Source-check invocation environment ${name} is invalid.`);
    }
    buildApply(NativeObjectDefineProperty, NativeObject, [
      environment,
      name,
      {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      },
    ]);
  }
  buildApply(NativeObjectDefineProperty, NativeObject, [
    environment,
    phaseCensusEnvironmentName,
    {
      configurable: true,
      enumerable: true,
      value: entryPath,
      writable: true,
    },
  ]);
  return buildApply(NativeObjectFreeze, undefined, [
    {
      invocationCwd: security.invocationCwd,
      invocationEnv: snapshotKovoInvocationEnvironment(environment),
      paranoidStaticAdvisory: security.paranoidStaticAdvisory,
    },
  ]);
}

function projectRelativePath(root: string, value: string): string {
  const absolute = resolve(root, value);
  const path = relative(root, absolute);
  if (path === '' || path === '..' || buildStringStartsWith(path, `..${sep}`) || isAbsolute(path)) {
    throw new NativeTypeError('Source-check watch entry must stay inside the invocation project.');
  }
  return sep === '/' ? path : buildArrayJoin(buildStringSplit(path, sep), '/');
}

function isCliCommandResult(
  value: KovoSourceCheckOneShotAnalysis | CliCommandResult,
): value is CliCommandResult {
  const exitCode = buildOwnDataValue(value, 'exitCode', 'Source-check one-shot result');
  return exitCode === 0 || exitCode === 1 || exitCode === 2;
}
