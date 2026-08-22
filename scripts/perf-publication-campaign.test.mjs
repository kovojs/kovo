import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectorHandoff,
  declarePublicationCampaign,
  launchOrResumePublicationCampaign,
  monitorPublicationCampaign,
  PERF_PUBLICATION_CAMPAIGN_PULSES,
  PERF_PUBLICATION_TRIGGER_LABEL,
  preflightPublicationCampaign,
  sealPublicationCampaign,
} from './perf-publication-campaign.mjs';

const SOURCE = 'a'.repeat(40);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('metrics-blind publication campaign operator', () => {
  it('declares, preflights, registers exactly 24 pulses, seals, monitors, and hands off IDs', async () => {
    const fixture = campaignFixture();
    await declareAndPreflight(fixture);
    for (let index = 0; index < PERF_PUBLICATION_CAMPAIGN_PULSES; index += 1) {
      const result = await launch(fixture);
      expect(result.registeredPulses).toBe(index + 1);
      expect(fixture.labels).not.toContain(PERF_PUBLICATION_TRIGGER_LABEL);
    }
    const sealed = await sealPublicationCampaign(stateOption(fixture), injected(fixture));
    expect(sealed).toMatchObject({ phase: 'sealed', registeredPulses: 24, sealed: true });

    fixture.status = 'queued';
    await expect(
      monitorPublicationCampaign(stateOption(fixture), injected(fixture)),
    ).resolves.toEqual({ complete: false, terminalCount: 0, total: 24 });
    fixture.status = 'completed';
    await expect(
      monitorPublicationCampaign(stateOption(fixture), injected(fixture)),
    ).resolves.toEqual({ complete: true, terminalCount: 24, total: 24 });
    const handoff = await collectorHandoff(stateOption(fixture), injected(fixture));
    expect(handoff.runIds).toHaveLength(24);
    expect(handoff.runArguments).toHaveLength(48);
    expect(handoff.runArguments.filter((value) => value === '--run')).toHaveLength(24);
    expect(fixture.outcomeReads).toBe(0);
  });

  for (const checkpoint of [
    'after-trigger-add',
    'after-registration-observed',
    'after-trigger-remove',
  ]) {
    it(`resumes safely after a crash at ${checkpoint}`, async () => {
      const fixture = campaignFixture({ crashCheckpoint: checkpoint });
      await declareAndPreflight(fixture);
      await expect(launch(fixture)).rejects.toThrow(`crash:${checkpoint}`);
      fixture.crashCheckpoint = null;
      await expect(launch(fixture)).resolves.toMatchObject({ registeredPulses: 1 });
      expect(fixture.runs).toHaveLength(1);
      expect(fixture.labels).not.toContain(PERF_PUBLICATION_TRIGGER_LABEL);
    });
  }

  it('rejects zero, multiple, and unexpected newly registered runs', async () => {
    const zero = campaignFixture({ addRunCount: 0 });
    await declareAndPreflight(zero);
    await expect(launch(zero)).rejects.toThrow('registered zero');

    const multiple = campaignFixture({ addRunCount: 2 });
    await declareAndPreflight(multiple);
    await expect(launch(multiple)).rejects.toThrow('registered 2');

    const unexpected = campaignFixture();
    await declareAndPreflight(unexpected);
    unexpected.runs.push(runTuple(900));
    await expect(launch(unexpected)).rejects.toThrow('census drifted');
  });

  it('rejects stale trigger and any frozen-label mutation', async () => {
    const stale = campaignFixture();
    await declareAndPreflight(stale);
    stale.labels.push(PERF_PUBLICATION_TRIGGER_LABEL);
    await expect(launch(stale)).rejects.toThrow('trigger label must be absent');

    const changed = campaignFixture({ labels: ['documentation'] });
    await declareAndPreflight(changed);
    changed.labels.push('unexpected');
    await expect(launch(changed)).rejects.toThrow('trigger label must be absent');
  });

  it('rejects focus labels and a CPU label not declared in the frozen census', async () => {
    const focus = campaignFixture({ labels: ['perf-baseline-focus-browser'] });
    await expect(declare(focus)).rejects.toThrow('forbids every focus label');

    const cpu = campaignFixture({ labels: ['perf-baseline-cpu-amd-7763'] });
    await expect(declare(cpu)).rejects.toThrow('declared CPU alias');
    await expect(declare(cpu, { cpuAlias: 'perf-baseline-cpu-amd-7763' })).resolves.toMatchObject({
      phase: 'declared',
    });
  });

  it('rejects source movement, dirty checkout, and immutable attempt drift', async () => {
    const moved = campaignFixture();
    await declareAndPreflight(moved);
    moved.head = 'b'.repeat(40);
    await expect(launch(moved)).rejects.toThrow('source moved');

    const dirty = campaignFixture();
    await declareAndPreflight(dirty);
    dirty.checkoutStatus = ' M tracked';
    await expect(launch(dirty)).rejects.toThrow('dirty');

    const attempt = campaignFixture();
    await declareAndPreflight(attempt);
    await launch(attempt);
    attempt.runs[0].run_attempt = 2;
    await expect(launch(attempt)).rejects.toThrow(/census drifted|immutable tuple/u);
  });

  it('rejects a census whose current count plus 24 exceeds the one-page boundary', async () => {
    const fixture = campaignFixture({ initialRuns: 77 });
    await expect(declare(fixture)).rejects.toThrow('plus fixed pulses exceeds 100');
  });

  it('creates state exclusively outside the checkout and rejects clobbers and symlinks', async () => {
    const clobber = campaignFixture();
    writeFileSync(clobber.statePath, 'occupied');
    await expect(declare(clobber)).rejects.toThrow();

    const symlink = campaignFixture();
    const target = path.join(symlink.root, 'target.json');
    writeFileSync(target, '{}');
    symlinkSync(target, symlink.statePath);
    await expect(declare(symlink)).rejects.toThrow();

    const nested = campaignFixture();
    nested.statePath = path.join(nested.checkout, 'state.json');
    await expect(declare(nested)).rejects.toThrow('outside the measured checkout');
  });

  it('rejects outcome-bearing fields in PR, census, and monitor projections', async () => {
    const pr = campaignFixture();
    pr.prExtra = { outcome: 'hidden' };
    await expect(declare(pr)).rejects.toThrow('unreviewed fields');

    const census = campaignFixture();
    census.runExtra = { outcome: 'hidden' };
    census.runs.push(runTuple(1));
    await expect(declare(census)).rejects.toThrow('unreviewed fields');

    const monitor = campaignFixture();
    await declareAndPreflight(monitor);
    for (let index = 0; index < 24; index += 1) await launch(monitor);
    await sealPublicationCampaign(stateOption(monitor), injected(monitor));
    monitor.statusExtra = { outcome: 'hidden' };
    await expect(
      monitorPublicationCampaign(stateOption(monitor), injected(monitor)),
    ).rejects.toThrow('outcome-bearing or unreviewed');
    expect(monitor.outcomeReads).toBe(0);
  });

  it('requires explicit mutation authorization', async () => {
    const fixture = campaignFixture();
    await declareAndPreflight(fixture);
    await expect(
      launchOrResumePublicationCampaign(
        { execute: false, statePath: fixture.statePath },
        injected(fixture),
      ),
    ).rejects.toThrow('explicit execute=true');
    expect(fixture.addCalls).toBe(0);
  });
});

function campaignFixture({
  addRunCount = 1,
  crashCheckpoint = null,
  initialRuns = 0,
  labels = [],
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-campaign-test-'));
  roots.push(root);
  const checkout = path.join(root, 'checkout');
  mkdirSync(checkout);
  const fixture = {
    addCalls: 0,
    addRunCount,
    checkout,
    checkoutStatus: '',
    crashCheckpoint,
    head: SOURCE,
    labels: [...labels],
    nextRunId: 1_000,
    outcomeReads: 0,
    prExtra: {},
    root,
    runExtra: {},
    runs: Array.from({ length: initialRuns }, (_unused, index) => runTuple(index + 1)),
    statePath: path.join(root, 'campaign-state.json'),
    status: 'queued',
    statusExtra: {},
  };
  fixture.operations = {
    addLabel(_state, label) {
      fixture.addCalls += 1;
      fixture.labels.push(label);
      for (let index = 0; index < fixture.addRunCount; index += 1) {
        fixture.runs.push(runTuple(fixture.nextRunId++));
      }
    },
    checkpoint(name) {
      if (fixture.crashCheckpoint === name) throw new Error(`crash:${name}`);
    },
    getPullRequest() {
      return {
        headRefOid: fixture.head,
        isDraft: true,
        labels: [...fixture.labels],
        number: 7,
        state: 'OPEN',
        url: 'https://github.com/kovojs/kovo/pull/7',
        ...fixture.prExtra,
      };
    },
    getRunStatus(_state, runId) {
      const run = fixture.runs.find((entry) => entry.id === runId);
      return { ...run, status: fixture.status, ...fixture.statusExtra };
    },
    getWorkflowRuns() {
      return {
        total_count: fixture.runs.length,
        workflow_runs: fixture.runs.map((run) => ({ ...run, ...fixture.runExtra })),
      };
    },
    inspectCheckout() {
      return { head: fixture.head, root: fixture.checkout, status: fixture.checkoutStatus };
    },
    pollMs: 0,
    registrationPolls: 1,
    removeLabel(_state, label) {
      fixture.labels = fixture.labels.filter((entry) => entry !== label);
    },
    async wait() {},
  };
  return fixture;
}

function runTuple(id) {
  return {
    created_at: new Date(Date.UTC(2026, 7, 21, 0, 0, id % 60)).toISOString(),
    event: 'pull_request',
    head_sha: SOURCE,
    id,
    name: 'Perf Realistic Tier',
    path: '.github/workflows/perf-realistic.yml',
    run_attempt: 1,
  };
}

function injected(fixture) {
  return { operations: fixture.operations };
}

function stateOption(fixture) {
  return { statePath: fixture.statePath };
}

function declare(fixture, overrides = {}) {
  return declarePublicationCampaign(
    {
      checkout: fixture.checkout,
      cpuAlias: 'none',
      prNumber: 7,
      repository: 'kovojs/kovo',
      source: SOURCE,
      statePath: fixture.statePath,
      ...overrides,
    },
    injected(fixture),
  );
}

async function declareAndPreflight(fixture) {
  await declare(fixture);
  await preflightPublicationCampaign(stateOption(fixture), injected(fixture));
}

function launch(fixture) {
  return launchOrResumePublicationCampaign(
    { execute: true, statePath: fixture.statePath },
    injected(fixture),
  );
}
