#!/usr/bin/env node
/**
 * Metrics-blind operator for the fixed performance-publication PR-label campaign.
 *
 * This file deliberately owns only registration identity and terminal status. Report payloads,
 * job data, artifacts, logs, summaries, and run outcomes belong to the collector and live gate.
 */
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PERF_PUBLICATION_CAMPAIGN_SCHEMA = 'kovo-performance-campaign-operator/v1';
export const PERF_PUBLICATION_CAMPAIGN_PULSES = 24;
export const PERF_PUBLICATION_TRIGGER_LABEL = 'perf-measure-baselines';
export const PERF_PUBLICATION_WORKFLOW = Object.freeze({
  name: 'Perf Realistic Tier',
  path: '.github/workflows/perf-realistic.yml',
});
export const PERF_PUBLICATION_CPU_ALIASES = Object.freeze(['perf-baseline-cpu-amd-7763']);

const MAX_CAMPAIGN_RUNS = 100;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_REGISTRATION_POLLS = 120;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const FOCUS_PREFIX = 'perf-baseline-focus-';
const CPU_PREFIX = 'perf-baseline-cpu';
const RUN_TUPLE_KEYS = Object.freeze([
  'created_at',
  'event',
  'head_sha',
  'id',
  'name',
  'path',
  'run_attempt',
]);
const TERMINAL_RUN_KEYS = Object.freeze([...RUN_TUPLE_KEYS, 'status'].sort(bytewise));
const PR_KEYS = Object.freeze(['headRefOid', 'isDraft', 'labels', 'number', 'state', 'url']);

export async function declarePublicationCampaign(options, dependencies = {}) {
  const normalized = normalizeDeclarationOptions(options);
  const operations = campaignOperations(dependencies.operations);
  const checkout = operations.inspectCheckout(normalized.checkout);
  validateCheckout(checkout, normalized);
  const pullRequest = normalizePullRequest(operations.getPullRequest(normalized));
  validatePullRequest(pullRequest, normalized);
  const labels = normalizeLabels(pullRequest.labels);
  validateFrozenLabels(labels, normalized.cpuAlias);
  const census = normalizeIdentityCensus(operations.getWorkflowRuns(normalized), normalized.source);
  requireCensusCapacity(census, PERF_PUBLICATION_CAMPAIGN_PULSES);
  const state = {
    activePulse: null,
    checkout: normalized.checkout,
    cpuAlias: normalized.cpuAlias,
    frozenLabels: labels,
    initialCensus: census,
    phase: 'declared',
    pr: {
      isDraft: pullRequest.isDraft,
      number: pullRequest.number,
      url: pullRequest.url,
    },
    pulseCount: PERF_PUBLICATION_CAMPAIGN_PULSES,
    pulses: [],
    repository: normalized.repository,
    schema: PERF_PUBLICATION_CAMPAIGN_SCHEMA,
    seal: null,
    source: normalized.source,
    workflow: { ...PERF_PUBLICATION_WORKFLOW },
  };
  createStateExclusive(normalized.statePath, state, normalized.checkout);
  return publicSummary(state);
}

export async function preflightPublicationCampaign(options, dependencies = {}) {
  const context = loadCampaignContext(options, dependencies);
  requirePhase(context.state, ['declared'], 'preflight');
  validateLiveCampaignIdentity(context);
  const census = normalizeIdentityCensus(
    context.operations.getWorkflowRuns(context.state),
    context.state.source,
  );
  requireSameCensus(
    census,
    context.state.initialCensus,
    'preflight census changed after declaration',
  );
  requireCensusCapacity(census, context.state.pulseCount);
  context.state.phase = 'preflighted';
  writeStateAtomic(context.statePath, context.state);
  return publicSummary(context.state);
}

/** Advance exactly one pulse. Repeated invocations resume safely around every external mutation. */
export async function launchOrResumePublicationCampaign(options, dependencies = {}) {
  if (options?.execute !== true) {
    throw new TypeError('launch-or-resume requires explicit execute=true authorization');
  }
  const context = loadCampaignContext(options, dependencies);
  requirePhase(context.state, ['preflighted', 'launching'], 'launch-or-resume');
  if (context.state.pulses.length >= context.state.pulseCount) {
    throw new TypeError('all fixed campaign pulses are already registered');
  }
  validateCheckout(context.operations.inspectCheckout(context.state.checkout), context.state);
  validatePullRequestIdentityOnly(context);

  if (context.state.activePulse === null) {
    const pullRequest = normalizePullRequest(context.operations.getPullRequest(context.state));
    requireLabels(pullRequest.labels, context.state.frozenLabels, 'trigger label must be absent');
    const before = normalizeIdentityCensus(
      context.operations.getWorkflowRuns(context.state),
      context.state.source,
    );
    requireSameCensus(before, expectedCurrentCensus(context.state), 'exact-source census drifted');
    context.state.activePulse = {
      before,
      index: context.state.pulses.length + 1,
      registeredRun: null,
      stage: 'prepared',
    };
    context.state.phase = 'launching';
    writeStateAtomic(context.statePath, context.state);
  }

  let pullRequest = normalizePullRequest(context.operations.getPullRequest(context.state));
  validatePullRequest(pullRequest, context.state);
  let labels = normalizeLabels(pullRequest.labels);
  if (context.state.activePulse.registeredRun === null) {
    const triggerPresent = labels.includes(PERF_PUBLICATION_TRIGGER_LABEL);
    if (triggerPresent) {
      requireLabels(
        labels,
        [...context.state.frozenLabels, PERF_PUBLICATION_TRIGGER_LABEL],
        'labels changed while the trigger was present',
      );
    } else {
      requireLabels(labels, context.state.frozenLabels, 'non-trigger labels changed before launch');
      const observed = normalizeIdentityCensus(
        context.operations.getWorkflowRuns(context.state),
        context.state.source,
      );
      const newRuns = censusDifference(context.state.activePulse.before, observed);
      if (newRuns.length === 0) {
        context.operations.addLabel(context.state, PERF_PUBLICATION_TRIGGER_LABEL);
        context.operations.checkpoint('after-trigger-add');
      } else {
        const registered = requireOneRegisteredRun(context.state, observed, newRuns);
        context.operations.checkpoint('after-registration-observed');
        context.state.activePulse.registeredRun = registered;
        context.state.activePulse.stage = 'registered';
        writeStateAtomic(context.statePath, context.state);
      }
    }
  }

  if (context.state.activePulse.registeredRun === null) {
    const observed = await waitForOneRegisteredRun(context);
    const registered = requireOneRegisteredRun(
      context.state,
      observed,
      censusDifference(context.state.activePulse.before, observed),
    );
    context.operations.checkpoint('after-registration-observed');
    context.state.activePulse.registeredRun = registered;
    context.state.activePulse.stage = 'registered';
    writeStateAtomic(context.statePath, context.state);
  }

  pullRequest = normalizePullRequest(context.operations.getPullRequest(context.state));
  validatePullRequest(pullRequest, context.state);
  labels = normalizeLabels(pullRequest.labels);
  if (labels.includes(PERF_PUBLICATION_TRIGGER_LABEL)) {
    requireLabels(
      labels,
      [...context.state.frozenLabels, PERF_PUBLICATION_TRIGGER_LABEL],
      'labels changed before trigger removal',
    );
    context.operations.removeLabel(context.state, PERF_PUBLICATION_TRIGGER_LABEL);
    context.operations.checkpoint('after-trigger-remove');
  } else {
    requireLabels(labels, context.state.frozenLabels, 'labels changed after trigger removal');
  }
  await waitForTriggerRemoval(context);

  const pulse = {
    index: context.state.activePulse.index,
    run: context.state.activePulse.registeredRun,
  };
  context.state.pulses.push(pulse);
  context.state.activePulse = null;
  writeStateAtomic(context.statePath, context.state);
  return publicSummary(context.state);
}

export async function sealPublicationCampaign(options, dependencies = {}) {
  const context = loadCampaignContext(options, dependencies);
  requirePhase(context.state, ['launching'], 'seal');
  if (
    context.state.activePulse !== null ||
    context.state.pulses.length !== context.state.pulseCount
  ) {
    throw new TypeError('seal requires exactly 24 completed pulse registrations');
  }
  validateLiveCampaignIdentity(context);
  const census = normalizeIdentityCensus(
    context.operations.getWorkflowRuns(context.state),
    context.state.source,
  );
  requireSameCensus(census, expectedCurrentCensus(context.state), 'seal census drifted');
  const runIds = context.state.pulses.map((pulse) => pulse.run.id);
  const firstRunId = Math.min(...runIds);
  const lastRunId = Math.max(...runIds);
  const boundary = census.workflow_runs.filter(
    (run) => run.id >= firstRunId && run.id <= lastRunId,
  );
  if (
    boundary.length !== context.state.pulseCount ||
    canonicalJson(boundary.map((run) => run.id)) !== canonicalJson([...runIds].sort(numericOrder))
  ) {
    throw new TypeError('inclusive campaign endpoints contain a missing or unexpected run');
  }
  context.state.seal = {
    boundary: { firstRunId, lastRunId },
    census,
    runIds: [...runIds].sort(numericOrder),
  };
  context.state.phase = 'sealed';
  writeStateAtomic(context.statePath, context.state);
  return publicSummary(context.state);
}

export async function monitorPublicationCampaign(options, dependencies = {}) {
  const context = loadCampaignContext(options, dependencies);
  requirePhase(context.state, ['sealed', 'terminal'], 'monitor');
  validateLiveCampaignIdentity(context);
  const statuses = context.state.seal.runIds.map((runId) =>
    normalizeTerminalRun(context.operations.getRunStatus(context.state, runId)),
  );
  validateTerminalTupleCensus(statuses, context.state.seal.census);
  const terminalCount = statuses.filter((run) => run.status === 'completed').length;
  if (terminalCount === context.state.pulseCount) {
    context.state.phase = 'terminal';
    writeStateAtomic(context.statePath, context.state);
  }
  return { complete: terminalCount === context.state.pulseCount, terminalCount, total: 24 };
}

/** Final metrics-blind check immediately before invoking the existing collector. */
export async function collectorHandoff(options, dependencies = {}) {
  const context = loadCampaignContext(options, dependencies);
  requirePhase(context.state, ['terminal'], 'handoff');
  validateLiveCampaignIdentity(context);
  const census = normalizeIdentityCensus(
    context.operations.getWorkflowRuns(context.state),
    context.state.source,
  );
  requireSameCensus(census, context.state.seal.census, 'complete tuple census changed after seal');
  const statuses = context.state.seal.runIds.map((runId) =>
    normalizeTerminalRun(context.operations.getRunStatus(context.state, runId)),
  );
  validateTerminalTupleCensus(statuses, context.state.seal.census);
  if (statuses.some((run) => run.status !== 'completed')) {
    throw new TypeError('collector handoff requires all fixed campaign runs to be terminal');
  }
  return {
    campaignFirstRunId: context.state.seal.boundary.firstRunId,
    campaignLastRunId: context.state.seal.boundary.lastRunId,
    campaignPulses: context.state.pulseCount,
    runArguments: context.state.seal.runIds.flatMap((runId) => ['--run', String(runId)]),
    runIds: [...context.state.seal.runIds],
  };
}

function normalizeDeclarationOptions(options) {
  const checkout = canonicalDirectory(requiredString(options?.checkout, '--checkout'));
  const statePath = path.resolve(requiredString(options?.statePath, '--state'));
  const repository = requiredString(options?.repository, '--repository');
  if (repository !== 'kovojs/kovo') throw new TypeError('--repository must be kovojs/kovo');
  const source = requiredString(options?.source, '--source');
  if (!COMMIT_PATTERN.test(source))
    throw new TypeError('--source must be an exact lowercase commit');
  const prNumber = positiveInteger(options?.prNumber, '--pr');
  const cpuAlias =
    options?.cpuAlias === undefined || options.cpuAlias === 'none' ? null : options.cpuAlias;
  if (cpuAlias !== null && !PERF_PUBLICATION_CPU_ALIASES.includes(cpuAlias)) {
    throw new TypeError('unsupported publication CPU alias');
  }
  return { checkout, cpuAlias, prNumber, repository, source, statePath };
}

function loadCampaignContext(options, dependencies) {
  const statePath = path.resolve(requiredString(options?.statePath, '--state'));
  const state = readState(statePath);
  validateState(state);
  return { operations: campaignOperations(dependencies.operations), state, statePath };
}

function campaignOperations(operations) {
  const value = operations ?? defaultCampaignOperations();
  for (const name of [
    'addLabel',
    'checkpoint',
    'getPullRequest',
    'getRunStatus',
    'getWorkflowRuns',
    'inspectCheckout',
    'removeLabel',
    'wait',
  ]) {
    if (typeof value?.[name] !== 'function') throw new TypeError(`${name} operation is required`);
  }
  return value;
}

export function defaultCampaignOperations() {
  return {
    addLabel(state, label) {
      gh(['pr', 'edit', String(state.pr.number), '--repo', state.repository, '--add-label', label]);
    },
    checkpoint() {},
    getPullRequest(state) {
      return ghJson([
        'pr',
        'view',
        String(state.prNumber ?? state.pr.number),
        '--repo',
        state.repository,
        '--json',
        'number,url,state,isDraft,headRefOid,labels',
        '--jq',
        '{number,url,state,isDraft,headRefOid,labels:[.labels[].name]}',
      ]);
    },
    getRunStatus(state, runId) {
      return ghJson([
        'api',
        `repos/${state.repository}/actions/runs/${String(runId)}`,
        '--jq',
        '{id,run_attempt,created_at,event,head_sha,name,path,status}',
      ]);
    },
    getWorkflowRuns(state) {
      return ghJson([
        'api',
        `repos/${state.repository}/actions/workflows/perf-realistic.yml/runs?head_sha=${state.source}&per_page=100`,
        '--jq',
        '{total_count,workflow_runs:[.workflow_runs[]|{id,run_attempt,created_at,event,head_sha,name,path}]}',
      ]);
    },
    inspectCheckout(checkout) {
      return {
        head: git(checkout, ['rev-parse', '--verify', 'HEAD^{commit}']),
        root: git(checkout, ['rev-parse', '--show-toplevel']),
        status: git(checkout, ['status', '--porcelain=v1', '--untracked-files=all']),
      };
    },
    removeLabel(state, label) {
      gh([
        'pr',
        'edit',
        String(state.pr.number),
        '--repo',
        state.repository,
        '--remove-label',
        label,
      ]);
    },
    wait(milliseconds) {
      return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },
  };
}

async function waitForOneRegisteredRun(context) {
  const polls = positiveInteger(
    context.operations.registrationPolls ?? DEFAULT_REGISTRATION_POLLS,
    'registration polls',
  );
  const pollMs = nonNegativeInteger(context.operations.pollMs ?? DEFAULT_POLL_MS, 'poll interval');
  for (let poll = 0; poll < polls; poll += 1) {
    const observed = normalizeIdentityCensus(
      context.operations.getWorkflowRuns(context.state),
      context.state.source,
    );
    const newRuns = censusDifference(context.state.activePulse.before, observed);
    if (newRuns.length > 0) return observed;
    if (poll + 1 < polls) await context.operations.wait(pollMs);
  }
  throw new TypeError('trigger label registered zero new exact-source workflow runs');
}

async function waitForTriggerRemoval(context) {
  const polls = positiveInteger(
    context.operations.registrationPolls ?? DEFAULT_REGISTRATION_POLLS,
    'registration polls',
  );
  const pollMs = nonNegativeInteger(context.operations.pollMs ?? DEFAULT_POLL_MS, 'poll interval');
  for (let poll = 0; poll < polls; poll += 1) {
    const pullRequest = normalizePullRequest(context.operations.getPullRequest(context.state));
    validatePullRequest(pullRequest, context.state);
    const labels = normalizeLabels(pullRequest.labels);
    if (!labels.includes(PERF_PUBLICATION_TRIGGER_LABEL)) {
      requireLabels(labels, context.state.frozenLabels, 'non-trigger labels changed after removal');
      return;
    }
    requireLabels(
      labels,
      [...context.state.frozenLabels, PERF_PUBLICATION_TRIGGER_LABEL],
      'labels changed while waiting for trigger removal',
    );
    if (poll + 1 < polls) await context.operations.wait(pollMs);
  }
  throw new TypeError('trigger label removal was not visible before the next pulse');
}

function requireOneRegisteredRun(state, observed, newRuns) {
  requireExistingTupleStability(state.activePulse.before, observed);
  if (newRuns.length !== 1) {
    throw new TypeError(`trigger label registered ${String(newRuns.length)} new workflow runs`);
  }
  const run = newRuns[0];
  validateCampaignRun(run, state.source);
  if (observed.total_count > MAX_CAMPAIGN_RUNS) {
    throw new TypeError('exact-source workflow census exceeds one 100-run page');
  }
  return run;
}

function validateCampaignRun(run, source) {
  if (
    run.event !== 'pull_request' ||
    run.head_sha !== source ||
    run.name !== PERF_PUBLICATION_WORKFLOW.name ||
    run.path !== PERF_PUBLICATION_WORKFLOW.path ||
    run.run_attempt !== 1
  ) {
    throw new TypeError('newly registered run has foreign identity or attempt');
  }
}

function expectedCurrentCensus(state) {
  const runs = [
    ...state.initialCensus.workflow_runs,
    ...state.pulses.map((pulse) => pulse.run),
  ].sort(runOrder);
  return { total_count: runs.length, workflow_runs: runs };
}

function censusDifference(before, after) {
  requireExistingTupleStability(before, after);
  const ids = new Set(before.workflow_runs.map((run) => run.id));
  return after.workflow_runs.filter((run) => !ids.has(run.id));
}

function requireExistingTupleStability(before, after) {
  const byId = new Map(after.workflow_runs.map((run) => [run.id, run]));
  for (const run of before.workflow_runs) {
    if (canonicalJson(byId.get(run.id)) !== canonicalJson(run)) {
      throw new TypeError('exact-source workflow census lost or changed an immutable tuple');
    }
  }
  if (after.total_count !== after.workflow_runs.length) {
    throw new TypeError('exact-source workflow census is incomplete');
  }
}

function normalizeIdentityCensus(value, source) {
  if (
    !record(value) ||
    !exactKeys(value, ['total_count', 'workflow_runs']) ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 0 ||
    value.total_count > MAX_CAMPAIGN_RUNS ||
    !Array.isArray(value.workflow_runs) ||
    value.total_count !== value.workflow_runs.length
  ) {
    throw new TypeError('exact-source workflow census is incomplete or exceeds 100');
  }
  const runs = value.workflow_runs.map((run) => normalizeRunTuple(run, source)).sort(runOrder);
  if (new Set(runs.map((run) => run.id)).size !== runs.length) {
    throw new TypeError('exact-source workflow census contains duplicate run IDs');
  }
  return { total_count: runs.length, workflow_runs: runs };
}

function normalizeRunTuple(value, source) {
  if (!record(value) || !exactKeys(value, RUN_TUPLE_KEYS)) {
    throw new TypeError('workflow run identity projection contains unreviewed fields');
  }
  const tuple = runTuple(value);
  if (
    !Number.isSafeInteger(tuple.id) ||
    tuple.id < 1 ||
    !Number.isSafeInteger(tuple.run_attempt) ||
    tuple.run_attempt < 1 ||
    !validTimestamp(tuple.created_at) ||
    tuple.head_sha !== source ||
    tuple.name !== PERF_PUBLICATION_WORKFLOW.name ||
    tuple.path !== PERF_PUBLICATION_WORKFLOW.path ||
    !['pull_request', 'workflow_dispatch', 'schedule'].includes(tuple.event)
  ) {
    throw new TypeError('workflow run immutable identity is malformed or foreign');
  }
  return tuple;
}

function normalizeTerminalRun(value) {
  if (!record(value) || !exactKeys(value, TERMINAL_RUN_KEYS)) {
    throw new TypeError('terminal run projection contains outcome-bearing or unreviewed fields');
  }
  const status = value.status;
  if (!['completed', 'in_progress', 'pending', 'queued', 'requested', 'waiting'].includes(status)) {
    throw new TypeError('workflow run terminal status is unsupported');
  }
  return { ...runTuple(value), status };
}

function runTuple(value) {
  return Object.fromEntries(RUN_TUPLE_KEYS.map((key) => [key, value?.[key]]));
}

function validateTerminalTupleCensus(statuses, census) {
  for (const status of statuses) {
    const sealed = census.workflow_runs.find((run) => run.id === status.id);
    if (sealed === undefined || canonicalJson(runTuple(status)) !== canonicalJson(sealed)) {
      throw new TypeError('terminal monitor observed immutable run identity drift');
    }
  }
}

function normalizePullRequest(value) {
  if (!record(value) || !exactKeys(value, PR_KEYS)) {
    throw new TypeError('pull-request identity projection contains unreviewed fields');
  }
  return { ...value, labels: normalizeLabels(value.labels) };
}

function normalizeLabels(labels) {
  if (
    !Array.isArray(labels) ||
    !labels.every((label) => typeof label === 'string' && label !== '')
  ) {
    throw new TypeError('pull-request label census is malformed');
  }
  const normalized = [...labels].sort(bytewise);
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('pull-request label census is duplicated');
  }
  return normalized;
}

function validateFrozenLabels(labels, cpuAlias) {
  if (labels.includes(PERF_PUBLICATION_TRIGGER_LABEL)) {
    throw new TypeError('trigger label must be absent at declaration');
  }
  if (labels.some((label) => label.startsWith(FOCUS_PREFIX))) {
    throw new TypeError('publication campaign forbids every focus label');
  }
  const cpuLabels = labels.filter((label) => label.startsWith(CPU_PREFIX));
  const expected = cpuAlias === null ? [] : [cpuAlias];
  if (canonicalJson(cpuLabels) !== canonicalJson(expected)) {
    throw new TypeError('frozen label census differs from the declared CPU alias');
  }
}

function validateCheckout(value, state) {
  if (!record(value) || !exactKeys(value, ['head', 'root', 'status'])) {
    throw new TypeError('checkout identity is malformed');
  }
  if (canonicalDirectory(value.root) !== state.checkout || value.head !== state.source) {
    throw new TypeError('measured checkout root or source moved');
  }
  if (value.status !== '') throw new TypeError('measured checkout is dirty');
}

function validatePullRequest(value, state) {
  const expectedNumber = state.prNumber ?? state.pr.number;
  const expectedUrl = state.pr?.url;
  if (
    value.number !== expectedNumber ||
    value.headRefOid !== state.source ||
    value.state !== 'OPEN' ||
    (state.pr?.isDraft !== undefined && value.isDraft !== state.pr.isDraft) ||
    (expectedUrl !== undefined && value.url !== expectedUrl)
  ) {
    throw new TypeError('pull-request identity or frozen source changed');
  }
}

function validatePullRequestIdentityOnly(context) {
  validatePullRequest(
    normalizePullRequest(context.operations.getPullRequest(context.state)),
    context.state,
  );
}

function validateLiveCampaignIdentity(context) {
  validateCheckout(context.operations.inspectCheckout(context.state.checkout), context.state);
  const pullRequest = normalizePullRequest(context.operations.getPullRequest(context.state));
  validatePullRequest(pullRequest, context.state);
  requireLabels(pullRequest.labels, context.state.frozenLabels, 'frozen label census changed');
}

function requireLabels(actual, expected, message) {
  const normalized = normalizeLabels(actual);
  const expectedNormalized = normalizeLabels(expected);
  if (canonicalJson(normalized) !== canonicalJson(expectedNormalized)) throw new TypeError(message);
}

function requireCensusCapacity(census, remainingPulses) {
  if (census.total_count + remainingPulses > MAX_CAMPAIGN_RUNS) {
    throw new TypeError('current exact-source census plus fixed pulses exceeds 100');
  }
}

function requireSameCensus(actual, expected, message) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new TypeError(message);
}

function requirePhase(state, allowed, operation) {
  if (!allowed.includes(state.phase)) {
    throw new TypeError(`${operation} is unavailable from campaign phase ${String(state.phase)}`);
  }
}

function validateState(state) {
  const topLevelKeys = [
    'activePulse',
    'checkout',
    'cpuAlias',
    'frozenLabels',
    'initialCensus',
    'phase',
    'pr',
    'pulseCount',
    'pulses',
    'repository',
    'schema',
    'seal',
    'source',
    'workflow',
  ];
  if (
    !record(state) ||
    !exactKeys(state, topLevelKeys) ||
    state.schema !== PERF_PUBLICATION_CAMPAIGN_SCHEMA ||
    state.repository !== 'kovojs/kovo' ||
    state.pulseCount !== PERF_PUBLICATION_CAMPAIGN_PULSES ||
    !COMMIT_PATTERN.test(state.source ?? '') ||
    !Array.isArray(state.pulses) ||
    state.pulses.length > state.pulseCount ||
    !['declared', 'preflighted', 'launching', 'sealed', 'terminal'].includes(state.phase) ||
    typeof state.checkout !== 'string' ||
    canonicalJson(state.workflow) !== canonicalJson(PERF_PUBLICATION_WORKFLOW)
  ) {
    throw new TypeError('campaign state is malformed');
  }
  if (
    !record(state.pr) ||
    !exactKeys(state.pr, ['isDraft', 'number', 'url']) ||
    !Number.isSafeInteger(state.pr.number) ||
    state.pr.number < 1 ||
    typeof state.pr.isDraft !== 'boolean' ||
    typeof state.pr.url !== 'string'
  ) {
    throw new TypeError('campaign PR state is malformed');
  }
  if (state.cpuAlias !== null && !PERF_PUBLICATION_CPU_ALIASES.includes(state.cpuAlias)) {
    throw new TypeError('campaign CPU alias state is malformed');
  }
  const frozenLabels = normalizeLabels(state.frozenLabels);
  validateFrozenLabels(frozenLabels, state.cpuAlias);
  if (canonicalJson(frozenLabels) !== canonicalJson(state.frozenLabels)) {
    throw new TypeError('campaign frozen labels are not canonical');
  }
  const initialCensus = normalizeIdentityCensus(state.initialCensus, state.source);
  if (canonicalJson(initialCensus) !== canonicalJson(state.initialCensus)) {
    throw new TypeError('campaign initial census is not canonical');
  }
  const pulseIds = new Set();
  for (const [index, pulse] of state.pulses.entries()) {
    if (!record(pulse) || !exactKeys(pulse, ['index', 'run']) || pulse.index !== index + 1) {
      throw new TypeError('campaign pulse journal is malformed');
    }
    const run = normalizeRunTuple(pulse.run, state.source);
    validateCampaignRun(run, state.source);
    if (pulseIds.has(run.id)) throw new TypeError('campaign pulse journal duplicates a run');
    pulseIds.add(run.id);
  }
  if (state.activePulse !== null) {
    const active = state.activePulse;
    if (
      !record(active) ||
      !exactKeys(active, ['before', 'index', 'registeredRun', 'stage']) ||
      active.index !== state.pulses.length + 1 ||
      !['prepared', 'registered'].includes(active.stage) ||
      (active.stage === 'prepared' && active.registeredRun !== null) ||
      (active.stage === 'registered' && active.registeredRun === null)
    ) {
      throw new TypeError('campaign active pulse state is malformed');
    }
    normalizeIdentityCensus(active.before, state.source);
    if (active.registeredRun !== null) {
      validateCampaignRun(normalizeRunTuple(active.registeredRun, state.source), state.source);
    }
  }
  if (state.phase === 'declared' && (state.pulses.length !== 0 || state.activePulse !== null)) {
    throw new TypeError('declared campaign already contains pulse state');
  }
  if (['sealed', 'terminal'].includes(state.phase)) {
    if (
      state.activePulse !== null ||
      state.pulses.length !== state.pulseCount ||
      !record(state.seal) ||
      !exactKeys(state.seal, ['boundary', 'census', 'runIds'])
    ) {
      throw new TypeError('sealed campaign state is incomplete');
    }
    const sealedCensus = normalizeIdentityCensus(state.seal.census, state.source);
    if (canonicalJson(sealedCensus) !== canonicalJson(state.seal.census)) {
      throw new TypeError('sealed campaign census is not canonical');
    }
    if (
      !Array.isArray(state.seal.runIds) ||
      canonicalJson(state.seal.runIds) !==
        canonicalJson(state.pulses.map((pulse) => pulse.run.id).sort(numericOrder)) ||
      !record(state.seal.boundary) ||
      !exactKeys(state.seal.boundary, ['firstRunId', 'lastRunId']) ||
      state.seal.boundary.firstRunId !== Math.min(...state.seal.runIds) ||
      state.seal.boundary.lastRunId !== Math.max(...state.seal.runIds)
    ) {
      throw new TypeError('sealed campaign endpoints or run IDs are malformed');
    }
  } else if (state.seal !== null) {
    throw new TypeError('unsealed campaign contains a seal');
  }
}

function createStateExclusive(statePath, state, checkout) {
  const parent = canonicalDirectory(path.dirname(statePath));
  const canonicalCheckout = canonicalDirectory(checkout);
  if (containedBy(canonicalCheckout, path.join(parent, path.basename(statePath)))) {
    throw new TypeError('--state must remain outside the measured checkout');
  }
  let descriptor;
  try {
    descriptor = openSync(statePath, 'wx', 0o600);
    writeFileSync(descriptor, stateBytes(state));
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  fsyncDirectory(parent);
}

function readState(statePath) {
  const metadata = lstatSync(statePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new TypeError('campaign state must be one regular single-link file');
  }
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function writeStateAtomic(statePath, state) {
  const current = lstatSync(statePath);
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1) {
    throw new TypeError('campaign state changed type or link identity');
  }
  const parent = canonicalDirectory(path.dirname(statePath));
  const stageRoot = mkdtempSync(path.join(parent, '.kovo-campaign-state-'));
  const stage = path.join(stageRoot, 'state.json');
  try {
    const descriptor = openSync(stage, 'wx', 0o600);
    try {
      writeFileSync(descriptor, stateBytes(state));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(stage, statePath);
    fsyncDirectory(parent);
  } finally {
    rmSync(stageRoot, { force: true, recursive: true });
  }
}

function stateBytes(state) {
  return Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function publicSummary(state) {
  return {
    phase: state.phase,
    pulseCount: state.pulseCount,
    registeredPulses: state.pulses.length,
    sealed: state.seal !== null,
    source: state.source,
  };
}

function canonicalDirectory(value) {
  const resolved = realpathSync(path.resolve(value));
  if (!lstatSync(resolved).isDirectory()) throw new TypeError(`not a directory: ${String(value)}`);
  return resolved;
}

function containedBy(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function gh(args) {
  return String(
    execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    }),
  );
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function git(root, args) {
  return String(
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    }),
  ).trim();
}

function exactKeys(value, expected) {
  return (
    canonicalJson(Object.keys(value).sort(bytewise)) === canonicalJson([...expected].sort(bytewise))
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value)
      .sort(bytewise)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${label} must be positive`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${label} must be nonnegative`);
  }
  return number;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function runOrder(left, right) {
  return left.id - right.id;
}

function numericOrder(left, right) {
  return left - right;
}

function bytewise(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function parseCli(argv) {
  const phase = argv[0];
  const values = new Map();
  let execute = false;
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--execute') {
      if (execute) throw new TypeError('duplicate --execute');
      execute = true;
      continue;
    }
    if (
      !['--checkout', '--cpu-alias', '--pr', '--repository', '--source', '--state'].includes(flag)
    ) {
      throw new TypeError(`unknown campaign option ${String(flag)}`);
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) throw new TypeError(`incomplete ${flag}`);
    if (values.has(flag)) throw new TypeError(`duplicate ${flag}`);
    values.set(flag, value);
  }
  if (!['declare', 'preflight', 'launch-or-resume', 'seal', 'monitor', 'handoff'].includes(phase)) {
    throw new TypeError(
      'phase must be declare, preflight, launch-or-resume, seal, monitor, or handoff',
    );
  }
  const common = { statePath: requiredString(values.get('--state'), '--state') };
  if (phase === 'declare') {
    return {
      options: {
        ...common,
        checkout: requiredString(values.get('--checkout'), '--checkout'),
        cpuAlias: values.get('--cpu-alias') ?? 'none',
        prNumber: requiredString(values.get('--pr'), '--pr'),
        repository: requiredString(values.get('--repository'), '--repository'),
        source: requiredString(values.get('--source'), '--source'),
      },
      phase,
    };
  }
  if ([...values.keys()].some((key) => key !== '--state')) {
    throw new TypeError(
      `${phase} accepts only --state${phase === 'launch-or-resume' ? ' and --execute' : ''}`,
    );
  }
  if (execute && phase !== 'launch-or-resume') throw new TypeError('--execute is launch-only');
  return { options: { ...common, execute }, phase };
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseCli(argv);
  const operation = {
    declare: declarePublicationCampaign,
    handoff: collectorHandoff,
    'launch-or-resume': launchOrResumePublicationCampaign,
    monitor: monitorPublicationCampaign,
    preflight: preflightPublicationCampaign,
    seal: sealPublicationCampaign,
  }[parsed.phase];
  const result = await operation(parsed.options);
  if (parsed.phase === 'handoff') {
    process.stdout.write(`${result.runArguments.join(' ')}\n`);
  } else if (parsed.phase === 'monitor') {
    process.stdout.write(`${String(result.terminalCount)}/${String(result.total)} terminal\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
