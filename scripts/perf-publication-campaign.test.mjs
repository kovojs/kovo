import {
  chmodSync,
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

  for (const [checkpoint, expectedAdds, expectedRuns] of [
    ['before-trigger-add', 0, 0],
    ['after-trigger-add', 1, 1],
    ['after-registration-observed', 1, 1],
  ]) {
    it(`invalidates instead of re-attributing an ambiguous pulse after ${checkpoint}`, async () => {
      const fixture = campaignFixture({ crashCheckpoint: checkpoint });
      await declareAndPreflight(fixture);
      await expect(launch(fixture)).rejects.toThrow(`crash:${checkpoint}`);
      expect(fixture.addCalls).toBe(expectedAdds);
      expect(fixture.runs).toHaveLength(expectedRuns);
      fixture.crashCheckpoint = null;
      await expect(launch(fixture)).rejects.toThrow(/campaign invalidated.*fresh campaign/u);
      expect(readState(fixture)).toMatchObject({
        activePulse: { stage: 'armed' },
        invalidation: { code: 'ambiguous-trigger-registration' },
        phase: 'invalid',
      });
      expect(fixture.addCalls).toBe(expectedAdds);
      expect(fixture.removeCalls).toBe(0);
      await expect(launch(fixture)).rejects.toThrow('unavailable from campaign phase invalid');
      expect(fixture.addCalls).toBe(expectedAdds);
    });
  }

  for (const checkpoint of ['after-registration-journaled', 'after-trigger-remove']) {
    it(`resumes only after an exact run was durably journaled at ${checkpoint}`, async () => {
      const fixture = campaignFixture({ crashCheckpoint: checkpoint });
      await declareAndPreflight(fixture);
      await expect(launch(fixture)).rejects.toThrow(`crash:${checkpoint}`);
      fixture.crashCheckpoint = null;
      await expect(launch(fixture)).resolves.toMatchObject({ registeredPulses: 1 });
      expect(fixture.addCalls).toBe(1);
      expect(fixture.removeCalls).toBe(1);
      expect(fixture.runs).toHaveLength(1);
      expect(fixture.labels).not.toContain(PERF_PUBLICATION_TRIGGER_LABEL);
    });
  }

  for (const [activity, mutate] of [
    ['external trigger add', (fixture) => fixture.labels.push(PERF_PUBLICATION_TRIGGER_LABEL)],
    [
      'external trigger removal',
      (fixture) => {
        fixture.labels = fixture.labels.filter((label) => label !== PERF_PUBLICATION_TRIGGER_LABEL);
      },
    ],
    ['external run registration', (fixture) => fixture.runs.push(runTuple(777))],
  ]) {
    it(`never accepts ${String(activity)} while an armed pulse is ambiguous`, async () => {
      const checkpoint =
        activity === 'external trigger removal' ? 'after-trigger-add' : 'before-trigger-add';
      const fixture = campaignFixture({ crashCheckpoint: checkpoint });
      await declareAndPreflight(fixture);
      await expect(launch(fixture)).rejects.toThrow(`crash:${checkpoint}`);
      const operatorAdds = fixture.addCalls;
      mutate(fixture);
      fixture.crashCheckpoint = null;
      await expect(launch(fixture)).rejects.toThrow(/campaign invalidated.*do not add again/u);
      expect(fixture.addCalls).toBe(operatorAdds);
      expect(fixture.removeCalls).toBe(0);
      expect(readState(fixture).phase).toBe('invalid');
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

  it('binds state to its canonical path and rechecks that custody path on every command', async () => {
    const fixture = campaignFixture();
    await declare(fixture);
    const copiedPath = path.join(fixture.root, 'copied-state.json');
    copyFileSync(fixture.statePath, copiedPath);
    chmodSync(copiedPath, 0o600);
    await expect(
      preflightPublicationCampaign({ statePath: copiedPath }, injected(fixture)),
    ).rejects.toThrow('declared canonical custody path');

    const nestedPath = path.join(fixture.checkout, 'copied-state.json');
    copyFileSync(fixture.statePath, nestedPath);
    chmodSync(nestedPath, 0o600);
    await expect(
      preflightPublicationCampaign({ statePath: nestedPath }, injected(fixture)),
    ).rejects.toThrow(/canonical custody path|outside the measured checkout/u);

    const nestedState = JSON.parse(readFileSync(fixture.statePath, 'utf8'));
    nestedState.statePath = realpathSync(nestedPath);
    writeFileSync(nestedPath, `${JSON.stringify(nestedState, null, 2)}\n`, { mode: 0o600 });
    await expect(
      preflightPublicationCampaign({ statePath: nestedPath }, injected(fixture)),
    ).rejects.toThrow('outside the measured checkout');
  });

  it('rejects symlink swaps, hardlinks, and same-path inode replacement', async () => {
    const symlink = campaignFixture();
    await declare(symlink);
    symlink.workflowRunsHook = () => {
      symlink.workflowRunsHook = null;
      const originalPath = path.join(symlink.root, 'original-state.json');
      renameSync(symlink.statePath, originalPath);
      symlinkSync(originalPath, symlink.statePath);
    };
    await expect(
      preflightPublicationCampaign(stateOption(symlink), injected(symlink)),
    ).rejects.toThrow();
    expect(lstatSync(symlink.statePath).isSymbolicLink()).toBe(true);

    const hardlink = campaignFixture();
    await declare(hardlink);
    linkSync(hardlink.statePath, path.join(hardlink.root, 'second-link.json'));
    await expect(
      preflightPublicationCampaign(stateOption(hardlink), injected(hardlink)),
    ).rejects.toThrow('stable private regular file');

    const replaced = campaignFixture();
    await declare(replaced);
    let replacementBytes = '';
    replaced.workflowRunsHook = () => {
      replaced.workflowRunsHook = null;
      const replacement = path.join(replaced.root, 'replacement-state.json');
      replacementBytes = `${readFileSync(replaced.statePath, 'utf8')}\n`;
      writeFileSync(replacement, replacementBytes, { mode: 0o600 });
      renameSync(replacement, replaced.statePath);
    };
    await expect(
      preflightPublicationCampaign(stateOption(replaced), injected(replaced)),
    ).rejects.toThrow('concurrently advanced or replaced');
    expect(readFileSync(replaced.statePath, 'utf8')).toBe(replacementBytes);
  });

  it('serializes concurrent commands and fails closed on a stale or crashed lock', async () => {
    const waitControl = deferredWait();
    const concurrent = campaignFixture({
      addRunCount: 0,
      registrationPolls: 2,
      waitControl,
    });
    await declareAndPreflight(concurrent);
    const first = launch(concurrent);
    await waitControl.entered;
    await expect(launch(concurrent)).rejects.toThrow('campaign lock already exists');
    concurrent.runs.push(runTuple(concurrent.nextRunId++));
    waitControl.release();
    await expect(first).resolves.toMatchObject({ registeredPulses: 1 });
    expect(concurrent.addCalls).toBe(1);

    const stale = campaignFixture();
    await declareAndPreflight(stale);
    const lockPath = `${stale.statePath}.lock`;
    writeFileSync(lockPath, '{"crashed":true}\n', { mode: 0o600 });
    await expect(launch(stale)).rejects.toThrow(/stale.*fail closed/u);
    expect(readState(stale).phase).toBe('preflighted');
    expect(readFileSync(lockPath, 'utf8')).toContain('crashed');
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
  registrationPolls = 1,
  waitControl = null,
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
    removeCalls: 0,
    root,
    runExtra: {},
    runs: Array.from({ length: initialRuns }, (_unused, index) => runTuple(index + 1)),
    statePath: path.join(root, 'campaign-state.json'),
    status: 'queued',
    statusExtra: {},
    workflowRunsHook: null,
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
      fixture.workflowRunsHook?.();
      return {
        total_count: fixture.runs.length,
        workflow_runs: fixture.runs.map((run) => ({ ...run, ...fixture.runExtra })),
      };
    },
    inspectCheckout() {
      return { head: fixture.head, root: fixture.checkout, status: fixture.checkoutStatus };
    },
    pollMs: 0,
    registrationPolls,
    removeLabel(_state, label) {
      fixture.removeCalls += 1;
      fixture.labels = fixture.labels.filter((entry) => entry !== label);
    },
    async wait() {
      if (waitControl !== null) await waitControl.wait();
    },
  };
  return fixture;
}

function deferredWait() {
  let announceEntered;
  let releaseWait;
  const entered = new Promise((resolve) => {
    announceEntered = resolve;
  });
  const blocked = new Promise((resolve) => {
    releaseWait = resolve;
  });
  return {
    entered,
    release: releaseWait,
    async wait() {
      announceEntered();
      await blocked;
    },
  };
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

function readState(fixture) {
  return JSON.parse(readFileSync(fixture.statePath, 'utf8'));
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
