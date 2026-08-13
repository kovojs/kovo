import { createHash, randomBytes } from 'node:crypto';

import { canonicalJson } from './perf-host.mjs';

export const PERF_EXECUTION_SCHEMA = 'kovo-performance-execution/v1';

/**
 * Identify one independent benchmark execution without pretending local metadata is CI authority.
 * GitHub Actions facts become a directly linkable run identity. Local runs receive a fresh nonce;
 * they remain useful evidence, but a publication policy can require the GitHub provider explicitly.
 */
export function performanceExecutionIdentity({
  env = process.env,
  nonce = randomBytes(16).toString('hex'),
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
  const { digest, schema, ...facts } = execution;
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
  ];
  if (!names.some((name) => nonEmptyString(env[name]))) return null;
  const complete = names.every((name) => nonEmptyString(env[name]));
  const facts = {
    job: env.GITHUB_JOB ?? null,
    repository: env.GITHUB_REPOSITORY ?? null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    serverUrl: env.GITHUB_SERVER_URL ?? null,
    sha: env.GITHUB_SHA ?? null,
    workflowRef: env.GITHUB_WORKFLOW_REF ?? null,
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
