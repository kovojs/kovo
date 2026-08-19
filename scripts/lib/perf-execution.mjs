import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';

import { canonicalJson } from './perf-host.mjs';

export const PERF_EXECUTION_SCHEMA = 'kovo-performance-execution/v1';
const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const lowercaseHexPattern = /^[0-9a-f]+$/u;
const nativeBufferToString = Buffer.prototype.toString;
const nativeNumberIsSafeInteger = Number.isSafeInteger;
const nativeObjectFreeze = Object.freeze;
const nativeRandomBytes = randomBytes;
const nativeReflectApply = Reflect.apply;
const nativeRegExpTest = lowercaseHexPattern.test.bind(lowercaseHexPattern);
const serverBenchmarkDeploymentIdPrefix = 'deployment:kovo-server-benchmark-';

/** Mint the production server benchmark's exact process runtime environment. */
export function mintServerBenchmarkRuntimeEnvironment() {
  return nativeObjectFreeze({
    KOVO_ATTESTATION_DEPLOYMENT_ID: `${serverBenchmarkDeploymentIdPrefix}${randomHex(6)}`,
    KOVO_ATTESTATION_SECRET: randomHex(32),
    NODE_ENV: 'production',
  });
}

/**
 * Identify one independent benchmark execution without pretending local metadata is CI authority.
 * GitHub Actions facts become a directly linkable run identity. Local runs receive a fresh nonce;
 * they remain useful evidence, but a publication policy can require the GitHub provider explicitly.
 */
export function performanceExecutionIdentity({
  env = process.env,
  nonce = randomHex(16),
  pid = process.pid,
  startedAt = new Date().toISOString(),
} = {}) {
  const github = githubExecutionFacts(env);
  const facts =
    github === null
      ? {
          complete: true,
          local: { nonce, pid },
          provider: 'local',
          startedAt,
        }
      : {
          complete: github.complete,
          github: github.facts,
          provider: 'github-actions',
          startedAt,
        };
  return {
    ...facts,
    digest: sha256Canonical(facts),
    schema: PERF_EXECUTION_SCHEMA,
  };
}

export function executionIdentityFindings(execution, { requireProvider } = {}) {
  if (!execution || execution.schema !== PERF_EXECUTION_SCHEMA) {
    return ['execution identity is unavailable'];
  }
  const { digest, schema: _schema, ...facts } = execution;
  const findings = [];
  if (digest !== sha256Canonical(facts)) {
    findings.push('execution digest is not derived from its facts');
  }
  if (execution.complete !== true) findings.push('execution identity is incomplete');
  if (requireProvider && execution.provider !== requireProvider) {
    findings.push(
      `execution provider is ${String(execution.provider)}, expected ${requireProvider}`,
    );
  }
  if (execution.provider === 'github-actions') {
    const github = execution.github;
    if (
      !github ||
      github.runUrl !== `${github.serverUrl}/${github.repository}/actions/runs/${github.runId}`
    ) {
      findings.push('GitHub execution URL is not derived from its facts');
    }
    if (!commitPattern.test(github?.eventSha ?? '')) {
      findings.push('GitHub event SHA is malformed');
    }
    if (!commitPattern.test(github?.sha ?? '')) {
      findings.push('GitHub source SHA is malformed');
    }
    if (!commitPattern.test(github?.workflowSha ?? '')) {
      findings.push('GitHub workflow SHA is malformed');
    }
  } else if (
    execution.provider !== 'local' ||
    !/^[0-9a-f]{32}$/u.test(execution.local?.nonce ?? '') ||
    !Number.isSafeInteger(execution.local?.pid) ||
    execution.local.pid < 1
  ) {
    findings.push('local execution facts are malformed');
  }
  return findings;
}

function githubExecutionFacts(env) {
  const names = [
    'GITHUB_JOB',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_RUN_ID',
    'GITHUB_SERVER_URL',
    'GITHUB_SHA',
    'GITHUB_WORKFLOW_REF',
    'GITHUB_WORKFLOW_SHA',
  ];
  if (![...names, 'KOVO_PERF_SOURCE_SHA'].some((name) => nonEmptyString(env[name]))) {
    return null;
  }
  const eventSha = env.GITHUB_SHA ?? null;
  const sourceSha = nonEmptyString(env.KOVO_PERF_SOURCE_SHA) ? env.KOVO_PERF_SOURCE_SHA : eventSha;
  const complete =
    names.every((name) => nonEmptyString(env[name])) &&
    commitPattern.test(eventSha ?? '') &&
    commitPattern.test(sourceSha ?? '') &&
    commitPattern.test(env.GITHUB_WORKFLOW_SHA ?? '');
  const facts = {
    eventSha,
    job: env.GITHUB_JOB ?? null,
    repository: env.GITHUB_REPOSITORY ?? null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    serverUrl: env.GITHUB_SERVER_URL ?? null,
    sha: sourceSha,
    workflowRef: env.GITHUB_WORKFLOW_REF ?? null,
    workflowSha: env.GITHUB_WORKFLOW_SHA ?? null,
  };
  facts.runUrl = complete
    ? `${facts.serverUrl}/${facts.repository}/actions/runs/${facts.runId}`
    : null;
  return { complete, facts };
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function randomHex(byteLength) {
  if (!nativeNumberIsSafeInteger(byteLength) || byteLength < 1 || byteLength > 32) {
    throw new TypeError('performance entropy byte length must be an integer between 1 and 32');
  }
  const value = nativeReflectApply(nativeBufferToString, nativeRandomBytes(byteLength), ['hex']);
  if (value.length !== byteLength * 2 || !nativeRegExpTest(value)) {
    throw new TypeError('performance entropy was not exact lowercase hexadecimal text');
  }
  return value;
}
