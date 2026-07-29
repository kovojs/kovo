const RUNTIME_FAILURE =
  /(?:ERR_MODULE_NOT_FOUND|Cannot find package|node:internal\/|SyntaxError:|ReferenceError:)/u;
const USAGE_FAILURE = /(?:usage:|unknown command)/iu;
const MISSING_GRAPH_DIAGNOSTIC =
  /(?:ERROR KV\d{3}[^\n]*(?:source graph|graph input|explicit artifact)|kovo(?:-check\/v1\r?\nERROR|:)[^\n]*(?:(?:source graph|graph input|explicit artifact)[^\n]*(?:required|missing|not found)|app module is missing or unreadable))/iu;
const TRUSTED_BOUNDARY_FAILURE =
  /Better Auth (?:session|credential) provider failed inside the trusted plaintext boundary/iu;
const KOVO_READY_REPORT =
  /Kovo dev ready in \d+ms\r?\n\s+Local URL\s+http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/\r?\n\s+Network URL\s+http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/ \(loopback only\)\r?\n\s+Mode\s+\S+\r?\n\s+App\s+\S+\r?\n\s+Database\s+.+\r?\n\s+Devtool\s+http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/__kovo\r?\n?/u;
const MEMORY_EXHAUSTION =
  /(?:Allocation failed|heap out of memory|Reached heap limit|JavaScript heap out of memory|exit signal SIG(?:ABRT|KILL))/iu;
const KV417_DEPLOYMENT_PROOF =
  /(?:ERROR\s+)?KV417[^\n]*(?:retention|client-module|deploy|deployment)/iu;
const SAFE_RUNTIME_DIAGNOSTIC =
  /KV\d{3}[\s\S]*(?:cause|reason)[\s\S]*(?:next step|remediation|run\s+[`"']?kovo)/iu;
const FULL_CATALOG_RSS_CEILING_MIB = 2_048;

/**
 * Convert one fully observed packed CLI execution into the bounded known-failure outcome.
 * Unrecognized non-zero exits remain infrastructure errors rather than accidental passes.
 */
export function packedCliContractOutcome(mode, result) {
  if (
    result?.error ||
    result?.signal ||
    result?.status === null ||
    !Number.isInteger(result?.status)
  ) {
    return null;
  }
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const combined = `${stdout}\n${stderr}`;
  if (RUNTIME_FAILURE.test(combined)) return null;

  if (mode === 'help') {
    const renderedHelp = /(?:usage|commands):/iu.test(combined);
    if (result.status === 0 && renderedHelp && stderr.trim().length === 0) {
      return 'desired-behavior';
    }
    if (
      result.status === 1 &&
      (renderedHelp || /unknown command ["']--help["']/iu.test(combined))
    ) {
      return 'defect-reproduced';
    }
    return null;
  }

  if (mode === 'empty-check') {
    if (
      (result.status === 1 || result.status === 2) &&
      MISSING_GRAPH_DIAGNOSTIC.test(combined) &&
      !USAGE_FAILURE.test(combined)
    ) {
      return 'desired-behavior';
    }
    if (
      result.status === 0 &&
      stderr.trim().length === 0 &&
      /^kovo-check\/v1\r?\nOK\r?\n?$/u.test(stdout)
    ) {
      return 'defect-reproduced';
    }
  }
  return null;
}

/**
 * Classify the normalized observation emitted by the packed first-loop probe. These predicates
 * deliberately recognize only each named defect: an arbitrary HTTP error, failed command, signal,
 * or changed output remains an infrastructure error at the probe boundary.
 */
export function packedFirstLoopContractOutcome(mode, observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return null;

  if (mode === 'sqlite-login') {
    if (
      observation.listened === true &&
      observation.healthStatus === 200 &&
      observation.status === 200 &&
      typeof observation.body === 'string' &&
      /<form\b[\s\S]*(?:sign in|email)/iu.test(observation.body)
    ) {
      return 'desired-behavior';
    }
    if (
      observation.listened === true &&
      observation.healthStatus === 200 &&
      observation.status === 500 &&
      typeof observation.serverOutput === 'string' &&
      TRUSTED_BOUNDARY_FAILURE.test(observation.serverOutput ?? '')
    ) {
      return 'defect-reproduced';
    }
    return null;
  }

  if (mode === 'dev-ready') {
    if (
      observation.listened === true &&
      Number.isFinite(observation.readyDelayMs) &&
      observation.readyDelayMs >= 0 &&
      observation.readyDelayMs <= 5_000 &&
      typeof observation.stdout === 'string' &&
      KOVO_READY_REPORT.test(observation.stdout ?? '')
    ) {
      return 'desired-behavior';
    }
    if (
      observation.listened === true &&
      observation.graceExpired === true &&
      typeof observation.stdout === 'string' &&
      !KOVO_READY_REPORT.test(observation.stdout ?? '')
    ) {
      return 'defect-reproduced';
    }
    return null;
  }

  if (mode === 'transactional-build') {
    if (
      observation.initialExit !== 0 ||
      observation.failedExit !== 1 ||
      typeof observation.failedOutput !== 'string' ||
      !KV417_DEPLOYMENT_PROOF.test(observation.failedOutput ?? '') ||
      !/^sha256:[0-9a-f]{64}$/u.test(observation.beforeDigest ?? '') ||
      !/^sha256:[0-9a-f]{64}$/u.test(observation.afterDigest ?? '')
    ) {
      return null;
    }
    return observation.beforeDigest === observation.afterDigest &&
      observation.failedGraphPromoted === false
      ? 'desired-behavior'
      : 'defect-reproduced';
  }

  if (mode === 'fresh-check') {
    if (
      !Array.isArray(observation.variants) ||
      observation.variants.length !== 2 ||
      observation.variants[0]?.dialect !== 'postgres' ||
      observation.variants[1]?.dialect !== 'sqlite' ||
      observation.variants.some(
        (variant) => !Number.isInteger(variant?.exit) || typeof variant?.output !== 'string',
      )
    ) {
      return null;
    }
    if (
      observation.variants.every(
        (variant) =>
          variant.exit === 0 &&
          /check passed/iu.test(variant.output) &&
          !/\bKV417\b/u.test(variant.output),
      )
    ) {
      return 'desired-behavior';
    }
    if (
      observation.variants.some(
        (variant) => variant.exit === 1 && KV417_DEPLOYMENT_PROOF.test(variant.output),
      )
    ) {
      return 'defect-reproduced';
    }
    return null;
  }

  if (mode === 'full-catalog') {
    if (
      observation.componentCount !== 44 ||
      observation.unimported !== true ||
      !Number.isInteger(observation.typecheckExit) ||
      typeof observation.typecheckOutput !== 'string' ||
      typeof observation.typecheckMemoryExceeded !== 'boolean' ||
      !Number.isFinite(observation.typecheckPeakRssMiB) ||
      !Number.isInteger(observation.checkExit) ||
      typeof observation.checkOutput !== 'string' ||
      typeof observation.checkMemoryExceeded !== 'boolean' ||
      !Number.isFinite(observation.checkPeakRssMiB) ||
      !Number.isInteger(observation.buildExit) ||
      typeof observation.buildOutput !== 'string' ||
      typeof observation.buildMemoryExceeded !== 'boolean' ||
      !Number.isFinite(observation.buildPeakRssMiB)
    ) {
      return null;
    }
    const phases = [
      {
        exit: observation.typecheckExit,
        memoryExceeded: observation.typecheckMemoryExceeded,
        output: observation.typecheckOutput,
        peakRssMiB: observation.typecheckPeakRssMiB,
      },
      {
        exit: observation.checkExit,
        memoryExceeded: observation.checkMemoryExceeded,
        output: observation.checkOutput,
        peakRssMiB: observation.checkPeakRssMiB,
      },
      {
        exit: observation.buildExit,
        memoryExceeded: observation.buildMemoryExceeded,
        output: observation.buildOutput,
        peakRssMiB: observation.buildPeakRssMiB,
      },
    ];
    if (
      phases.some(
        ({ memoryExceeded, peakRssMiB }) =>
          peakRssMiB < 0 || (memoryExceeded && peakRssMiB <= FULL_CATALOG_RSS_CEILING_MIB),
      )
    ) {
      return null;
    }
    const desired = phases.every(
      ({ exit, memoryExceeded, peakRssMiB }) =>
        exit === 0 && !memoryExceeded && peakRssMiB <= FULL_CATALOG_RSS_CEILING_MIB,
    );
    if (desired) return 'desired-behavior';
    const defect = phases.every(
      ({ exit, output, peakRssMiB }) =>
        (exit === 0 && peakRssMiB <= FULL_CATALOG_RSS_CEILING_MIB) ||
        peakRssMiB > FULL_CATALOG_RSS_CEILING_MIB ||
        (exit !== 0 && MEMORY_EXHAUSTION.test(output)),
    );
    if (
      defect &&
      phases.some(({ exit, peakRssMiB }) => exit !== 0 || peakRssMiB > FULL_CATALOG_RSS_CEILING_MIB)
    ) {
      return 'defect-reproduced';
    }
    return null;
  }

  if (mode === 'opaque-boundary') {
    if (
      observation.listened !== true ||
      observation.healthStatus !== 200 ||
      !Number.isInteger(observation.status) ||
      observation.status < 200 ||
      observation.status > 599
    ) {
      return null;
    }
    if (observation.status < 500) return 'desired-behavior';
    if (observation.status !== 500 || typeof observation.body !== 'string') return null;
    const body = observation.body;
    if (SAFE_RUNTIME_DIAGNOSTIC.test(body)) return 'desired-behavior';
    return 'defect-reproduced';
  }
  return null;
}
