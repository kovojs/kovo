import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BASELINE_KNOWN_FAILURE_IDS,
  DESIRED_BEHAVIOR_EXIT_CODE,
  INFRASTRUCTURE_ERROR_EXIT_CODE,
  KNOWN_FAILURE_PROBE_RESULT_SCHEMA,
  REPRODUCED_DEFECT_EXIT_CODE,
  knownFailureSummary,
  runKnownFailureProbes,
  validateKnownFailureRegister,
} from './known-failure-register.mjs';
import {
  packedCliContractOutcome,
  packedFirstLoopContractOutcome,
} from './lib/known-failure-probe-classifier.mjs';
import {
  DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS,
  DEV_READY_POST_BIND_BUDGET_MS,
  DEV_READY_PROBE_PROCESS_TIMEOUT_MS,
} from './lib/dev-ready-probe-contract.mjs';
import {
  KNOWN_FAILURE_FIRST_RESPONSE_INFRASTRUCTURE_TIMEOUT_MS,
  KNOWN_FAILURE_FIRST_LOOP_OUTER_TIMEOUT_FLOORS_MS,
} from './lib/known-failure-probe-deadlines.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const register = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts/known-failure-register.json'), 'utf8'),
);
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const ciWorkflowSource = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'devex-budgets.json'), 'utf8'));
const ownershipLedgerPath = path.join(
  repoRoot,
  'scripts/fixtures/known-failure-register/devex-gates.md',
);
const ownershipLedgerText = readFileSync(ownershipLedgerPath, 'utf8');
const ledgerResolver = () => ownershipLedgerText;
const packedProbeSource = readFileSync(
  path.join(repoRoot, 'scripts/known-failure-probes/packed-cli-contract.mjs'),
  'utf8',
);
const packedFirstLoopProbeSource = readFileSync(
  path.join(repoRoot, 'scripts/known-failure-probes/packed-first-loop-contract.mjs'),
  'utf8',
);
const packedReleaseHarnessSource = readFileSync(
  path.join(repoRoot, 'scripts/lib/known-failure-packed-release.mjs'),
  'utf8',
);
const authenticatedPackedConsumerSource = readFileSync(
  path.join(repoRoot, 'scripts/lib/authenticated-packed-consumer.mjs'),
  'utf8',
);

describe('known-failure register', () => {
  it('covers the exact ten named baseline defects with stable IDs and bounded packed mappings', () => {
    expect(validateRegister(register)).toEqual([]);
    expect(register.entries.map((entry) => entry.id)).toEqual(BASELINE_KNOWN_FAILURE_IDS);
    expect(knownFailureSummary(register)).toEqual({
      executable: 0,
      'pending-repro': 0,
      retired: 10,
    });
    expect(
      register.entries.every(
        (entry) =>
          entry.owner.length > 0 &&
          entry.childLedger === 'plans/devex-gates.md' &&
          entry.planOwnership.registerTrack === 'Track 0' &&
          entry.planOwnership.reproducerTrack === 'Track 2' &&
          entry.planOwnership.scorecardGates.length > 0 &&
          entry.observedLayer.length > 0 &&
          entry.retirementCondition.length > 0 &&
          entry.probe.packedInput === true &&
          entry.probe.resultSchema === KNOWN_FAILURE_PROBE_RESULT_SCHEMA &&
          entry.probe.command.includes('{packedManifest}') &&
          entry.probe.timeoutMs >= 1000 &&
          entry.probe.timeoutMs <= 900000,
      ),
    ).toBe(true);
  });

  it('reports schema validity and complete executable closure independently', () => {
    const script = path.join(repoRoot, 'scripts/known-failure-register.mjs');
    const schema = spawnSync(
      'node',
      [script, '--validate-schema', '--ownership-ledger', ownershipLedgerPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );
    const closure = spawnSync(
      'node',
      [script, '--require-executable', '--ownership-ledger', ownershipLedgerPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );

    expect(schema.status).toBe(0);
    expect(schema.stdout).toContain('SCHEMA_VALID');
    expect(schema.stdout).toContain('EXECUTABLE_CLOSURE_COMPLETE');
    expect(closure.status).toBe(0);
    expect(closure.stdout).toContain('EXECUTABLE_CLOSURE_COMPLETE');
  });

  it('publishes a packed-manifest-backed available-probe gate in CI', () => {
    expect(rootPackage.scripts['test:devex-foundation-schema']).toContain(
      'scripts/lib/known-failure-http-response.test.mjs',
    );
    expect(rootPackage.scripts['test:devex-foundation-schema']).toContain(
      'scripts/lib/known-failure-probe-process.test.mjs',
    );
    expect(rootPackage.scripts['test:devex-foundation-schema']).toContain(
      'scripts/lib/known-failure-packed-release.test.mjs',
    );
    expect(rootPackage.scripts['test:devex-known-failures-available']).toBe(
      'node scripts/known-failure-register.mjs --run-available --cadence per-pr --packed-manifest .release/packed-packages.json --json',
    );
    expect(rootPackage.scripts['devex:known-failures']).toBe(
      'pnpm run test:devex-known-failures-available',
    );
    expect(ciWorkflowSource).toContain(
      'run: timeout --kill-after=30s 78m vp exec pnpm run test:devex-known-failures-available',
    );

    const perPrProbeTimeoutBudgetMs = register.entries
      .filter(
        (entry) =>
          entry.state !== 'pending-repro' && (entry.probe.cadence ?? 'per-pr') === 'per-pr',
      )
      .reduce((total, entry) => total + entry.probe.timeoutMs, 0);
    const watchdog = ciWorkflowSource.match(
      /run: timeout --kill-after=(\d+)s (\d+)m vp exec pnpm run test:devex-known-failures-available/u,
    );
    expect(perPrProbeTimeoutBudgetMs).toBe(71 * 60_000);
    expect(watchdog).not.toBeNull();
    expect(Number(watchdog?.[1])).toBeGreaterThan(0);
    expect(Number(watchdog?.[1])).toBeLessThanOrEqual(60);
    const watchdogMs = Number(watchdog?.[2]) * 60_000;
    expect(watchdogMs).toBeGreaterThanOrEqual(perPrProbeTimeoutBudgetMs + 5 * 60_000);
    expect(watchdogMs).toBeLessThanOrEqual(perPrProbeTimeoutBudgetMs + 10 * 60_000);
  });

  it('keeps whole-probe deadlines outside the serial first-loop phase ceilings', () => {
    const modesById = {
      'KF-DEVEX-001': 'sqlite-login',
      'KF-DEVEX-002': 'dev-ready',
      'KF-DEVEX-005': 'transactional-build',
      'KF-DEVEX-006': 'fresh-check',
      'KF-DEVEX-010': 'opaque-boundary',
    };

    for (const [id, mode] of Object.entries(modesById)) {
      const entry = register.entries.find((candidate) => candidate.id === id);
      const floor = KNOWN_FAILURE_FIRST_LOOP_OUTER_TIMEOUT_FLOORS_MS[mode];
      expect(entry?.probe.timeoutMs, id).toBeGreaterThanOrEqual(floor);
      expect(entry?.probe.timeoutMs, id).toBeLessThan(floor + 60_000);
    }
    expect(register.entries.find((entry) => entry.id === 'KF-DEVEX-001')?.probe.timeoutMs).toBe(
      840_000,
    );
    expect(register.entries.find((entry) => entry.id === 'KF-DEVEX-010')?.probe.timeoutMs).toBe(
      840_000,
    );
    expect(KNOWN_FAILURE_FIRST_LOOP_OUTER_TIMEOUT_FLOORS_MS['sqlite-login']).toBe(822_100);
    expect(KNOWN_FAILURE_FIRST_LOOP_OUTER_TIMEOUT_FLOORS_MS['opaque-boundary']).toBe(822_100);
  });

  it('keeps dev-ready infrastructure ceilings separate from post-bind and G2 budgets', () => {
    const devReady = register.entries.find((entry) => entry.id === 'KF-DEVEX-002');
    const coldG2 = budgets.metrics['dev.ready.cold.durationMs'];
    const warmG2 = budgets.metrics['dev.ready.warm.durationMs'];

    expect(devReady.probe.timeoutMs).toBe(720_000);
    expect(devReady.probe.timeoutMs).toBeGreaterThanOrEqual(
      KNOWN_FAILURE_FIRST_LOOP_OUTER_TIMEOUT_FLOORS_MS['dev-ready'],
    );
    expect(DEV_READY_PROBE_PROCESS_TIMEOUT_MS).toBe(180_000);
    expect(DEV_READY_PROBE_PROCESS_TIMEOUT_MS).toBeGreaterThan(
      DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS,
    );
    expect(DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS).toBeGreaterThan(coldG2.provisionalTarget);
    expect(coldG2).toMatchObject({ provisionalTarget: 15_000, ratification: null });
    expect(warmG2).toMatchObject({ provisionalTarget: 5_000, ratification: null });
    expect(devReady.retirementCondition).toBe(
      'The packed dev journey emits the required structured ready report within five seconds after socket bind.',
    );
    expect(packedFirstLoopProbeSource).toContain('waitForKovoDevReadiness({');
    expect(packedFirstLoopProbeSource).toContain('DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS');
    expect(packedFirstLoopProbeSource).not.toContain('45_000');
    expect(packedFirstLoopProbeSource).toContain('readyDelayKind: ready.observedAfterMsKind');
    expect(packedFirstLoopProbeSource).toContain('readyDelayMs: ready.observedAfterMs');
    expect(packedFirstLoopProbeSource).not.toContain('waitForTcpListener(');
    expect(packedFirstLoopProbeSource).not.toContain('Date.now() - listenedAt');
  });

  it('owns served-app startup, first-response, and packed command deadlines independently', () => {
    expect(KNOWN_FAILURE_FIRST_RESPONSE_INFRASTRUCTURE_TIMEOUT_MS).toBe(120_000);
    expect(packedFirstLoopProbeSource.match(/waitForPackedDevListener\(/gu)).toHaveLength(3);
    expect(packedFirstLoopProbeSource.match(/waitForPackedDevReadiness\(/gu)).toHaveLength(2);
    expect(packedFirstLoopProbeSource).toContain(
      'listenerTimeoutMs: DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS',
    );
    expect(packedFirstLoopProbeSource).toContain('reportTimeoutMs: DEV_READY_POST_BIND_BUDGET_MS');
    expect(packedFirstLoopProbeSource).toContain(
      'KNOWN_FAILURE_FIRST_RESPONSE_INFRASTRUCTURE_TIMEOUT_MS',
    );
    expect(packedFirstLoopProbeSource).toContain("'first-response infrastructure'");
    expect(packedFirstLoopProbeSource).toContain('requestKnownFailureHttpResponse(');
    expect(packedFirstLoopProbeSource.match(/isKnownFailurePackedHealthResponse/gu)).toHaveLength(
      3,
    );
    expect(packedFirstLoopProbeSource).toContain('startedAt: dev.startedAt');
    const sqliteModeSource = packedFirstLoopProbeSource.slice(
      packedFirstLoopProbeSource.indexOf('async function sqliteLoginObservation'),
      packedFirstLoopProbeSource.indexOf('async function devReadyObservation'),
    );
    const devReadyModeSource = packedFirstLoopProbeSource.slice(
      packedFirstLoopProbeSource.indexOf('async function devReadyObservation'),
      packedFirstLoopProbeSource.indexOf('async function transactionalBuildObservation'),
    );
    const opaqueModeSource = packedFirstLoopProbeSource.slice(
      packedFirstLoopProbeSource.indexOf('async function opaqueBoundaryObservation'),
      packedFirstLoopProbeSource.indexOf('function startDevServer'),
    );
    expect(sqliteModeSource).toContain('waitForPackedDevListener(');
    expect(sqliteModeSource).not.toContain('waitForPackedDevReadiness(');
    expect(opaqueModeSource).toContain('waitForPackedDevListener(');
    expect(opaqueModeSource).not.toContain('waitForPackedDevReadiness(');
    expect(devReadyModeSource).toContain('waitForPackedDevReadiness(');
    expect(devReadyModeSource).not.toContain('waitForPackedDevListener(');
    for (const servedModeSource of [sqliteModeSource, devReadyModeSource, opaqueModeSource]) {
      expect(servedModeSource).toContain('await createKnownFailureServedScaffold(packedRelease');
      expect(servedModeSource).not.toContain('prepareInstalledCommandScaffoldFixture');
    }
    expect(
      packedFirstLoopProbeSource.match(/prepareInstalledCommandScaffoldFixture/gu),
    ).toHaveLength(4);
    expect(packedFirstLoopProbeSource).toContain('linkPackedNodeModules: false');
    expect(packedFirstLoopProbeSource).toContain("['exec', 'kovo', 'check', 'lifecycle']");
    expect(packedFirstLoopProbeSource).toContain("['rebuild']");
    expect(packedFirstLoopProbeSource).toContain(
      'assertInstalledPackedCli(appRoot, packedPackages)',
    );
    expect(packedFirstLoopProbeSource).toContain("entry.name === 'package/dist/bin.mjs'");
    expect(packedFirstLoopProbeSource).toContain(
      'last body=${boundedHttpResponseBody(lastResponse.body)}',
    );
    expect(packedFirstLoopProbeSource).toContain('runKnownFailureProbeCommand({');
    expect(packedFirstLoopProbeSource).not.toContain('spawnSync');
    expect(packedFirstLoopProbeSource).toContain('knownFailureInstalledRuntimeEnvironment(');
  });

  it('keeps the retired full-catalog regression nightly without weakening its result contract', () => {
    const nightly = runKnownFailureProbes(register, {
      repoRoot,
      packedManifest: ownershipLedgerPath,
      cadence: 'nightly',
      ledgerResolver,
      spawnSync: (_executable, args) => {
        const id = commandId(args);
        const entry = register.entries.find((candidate) => candidate.id === id);
        return processResult(
          id,
          entry?.state === 'retired' ? 'desired-behavior' : 'defect-reproduced',
        );
      },
    });
    expect(nightly.results.find((result) => result.id === 'KF-DEVEX-007')).toMatchObject({
      status: 'retired-pass',
    });
    expect(nightly.results.find((result) => result.id === 'KF-DEVEX-004')).toMatchObject({
      status: 'deferred',
      cadence: 'per-pr',
    });
  });

  it('owns probe exit semantics in code and rejects a data-defined protocol', () => {
    expect(DESIRED_BEHAVIOR_EXIT_CODE).toBe(0);
    expect(REPRODUCED_DEFECT_EXIT_CODE).toBe(1);
    expect(INFRASTRUCTURE_ERROR_EXIT_CODE).toBe(2);
    const redefined = structuredClone(register);
    redefined.protocol = { reproducedDefectExitCode: 0 };
    expect(validateRegister(redefined)).toContain(
      'protocol is runner-owned and must not be redefined by register data',
    );
  });

  it('requires the integrated Track 2 ledger to resolve and map every owner/G-ID', () => {
    expect(
      validateKnownFailureRegister(register, {
        repoRoot,
        ledgerResolver: () => null,
      }),
    ).toContain('plans/devex-gates.md: ownership ledger could not be resolved');

    const incompleteLedger = ownershipLedgerText
      .replace(/^.*KF-DEVEX-003.*$/mu, '| KF-DEVEX-003 | unowned | Track 2 | |')
      .replace(/^.*KF-DEVEX-010.*$/mu, '');
    expect(
      validateKnownFailureRegister(register, {
        repoRoot,
        ledgerResolver: () => incompleteLedger,
      }),
    ).toEqual(
      expect.arrayContaining([
        'plans/devex-gates.md: KF-DEVEX-003 does not name its implementation owner',
        'plans/devex-gates.md: KF-DEVEX-003 does not name scorecard gate G5',
        'plans/devex-gates.md: missing ownership row for KF-DEVEX-010',
      ]),
    );
  });

  it('keeps command probes synthetic while served probes install private authenticated tarballs', () => {
    for (const source of [packedProbeSource, packedReleaseHarnessSource]) {
      expect(source).not.toMatch(/\bpnpm\s+install\b/u);
      expect(source).not.toContain('--no-frozen-lockfile');
      expect(source).not.toContain('--ignore-scripts');
    }
    expect(packedReleaseHarnessSource).toContain('loadAuthenticatedPackedConsumerInputs');
    expect(packedReleaseHarnessSource).toContain('materializeAuthenticatedTarballSet');
    expect(authenticatedPackedConsumerSource).toContain('readBoundedRegularFile(');
    expect(authenticatedPackedConsumerSource).toContain(
      'writeFileSync(tarballPath, pkg.tarballBytes',
    );
    expect(authenticatedPackedConsumerSource).toContain('mode: 0o400');
    expect(packedFirstLoopProbeSource).toContain("'--ignore-scripts'");
    expect(packedFirstLoopProbeSource).toContain("'--strict-peer-dependencies'");
    expect(packedFirstLoopProbeSource).toContain("'--store-dir'");
    expect(packedFirstLoopProbeSource).toContain('applyEgressFloorEnv(');
    expect(packedFirstLoopProbeSource).toContain('allowlist: ciEgressPolicies.install');
    expect(packedFirstLoopProbeSource).toContain("allowlist: [], mode: 'deny'");
  });

  it('runs login and opaque-boundary retirement probes against the exact packed starter', () => {
    expect(packedFirstLoopProbeSource).not.toContain('isolateAuthOriginFixture');
    expect(packedFirstLoopProbeSource).not.toContain('auth-origin minimization sentinel');
  });

  it('keeps the retired full-catalog regression on a non-binding provisional RSS target', () => {
    expect(budgets.metrics['ui.fullCatalog.peakRssBytes']).toMatchObject({
      unit: 'bytes',
      provisionalTarget: 2 * 1024 * 1024 * 1024,
      ratification: null,
    });
    expect(budgets.metrics['ui.fullCatalog.peakRssBytes']).not.toHaveProperty('knownFailure');
    expect(packedFirstLoopProbeSource).toContain('collectProcessTreeRssKiB');
    expect(packedFirstLoopProbeSource).toContain('2_048');
    expect(packedFirstLoopProbeSource).toContain('knownFailurePackedRuntimeEnvironment');
    expect(packedReleaseHarnessSource).toContain('NODE_OPTIONS: null');
  });

  it('reports missing IDs, missing probe files, and stale unregistered probe files', () => {
    const missingId = structuredClone(register);
    missingId.entries = missingId.entries.slice(1);
    expect(validateRegister(missingId)).toContain(
      'missing baseline known-failure ID: KF-DEVEX-001',
    );

    const missingProbe = structuredClone(register);
    missingProbe.entries[0].probe.path = 'scripts/known-failure-probes/absent.mjs';
    missingProbe.entries[0].probe.command[1] = 'scripts/known-failure-probes/absent.mjs';
    expect(validateRegister(missingProbe)).toContain(
      'KF-DEVEX-001: scripts/known-failure-probes/absent.mjs: mapped probe is missing: scripts/known-failure-probes/absent.mjs',
    );

    const noMappings = structuredClone(register);
    noMappings.entries = noMappings.entries.map((entry) => ({
      ...entry,
      probe: {
        ...entry.probe,
        path: 'scripts/known-failure-probes/absent.mjs',
        command: ['node', 'scripts/known-failure-probes/absent.mjs'],
      },
    }));
    expect(validateRegister(noMappings)).toEqual(
      expect.arrayContaining([
        'stale unregistered probe: scripts/known-failure-probes/packed-cli-contract.mjs',
        'stale unregistered probe: scripts/known-failure-probes/packed-first-loop-contract.mjs',
      ]),
    );
  });

  it('rejects traversal, self-probes, symlinks, and undeclared packed inputs', () => {
    const traversal = structuredClone(register);
    traversal.entries[0].probe.path = 'scripts/known-failure-probes/../known-failure-register.mjs';
    traversal.entries[0].probe.command[1] = traversal.entries[0].probe.path;
    expect(validateRegister(traversal)).toContain(
      'KF-DEVEX-001: probe.path must be canonical and strictly under scripts/known-failure-probes',
    );

    const selfProbe = structuredClone(register);
    selfProbe.entries[0].probe.path =
      'scripts/known-failure-probes/../../scripts/known-failure-register.mjs';
    selfProbe.entries[0].probe.command[1] = selfProbe.entries[0].probe.path;
    expect(validateRegister(selfProbe)).toContain(
      'KF-DEVEX-001: probe.path must be canonical and strictly under scripts/known-failure-probes',
    );

    const missingInput = structuredClone(register);
    missingInput.entries[0].probe.command = missingInput.entries[0].probe.command.filter(
      (part) => !['--packed-manifest', '{packedManifest}'].includes(part),
    );
    expect(validateRegister(missingInput)).toContain(
      'KF-DEVEX-001: probe.command must bind exactly one declared packed manifest input',
    );

    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-probe-path-'));
    try {
      const probeDirectory = path.join(temporaryRoot, 'scripts/known-failure-probes');
      mkdirSync(probeDirectory, { recursive: true });
      for (const name of ['packed-cli-contract.mjs', 'packed-first-loop-contract.mjs']) {
        copyFileSync(
          path.join(repoRoot, 'scripts/known-failure-probes', name),
          path.join(probeDirectory, name),
        );
      }
      symlinkSync(
        path.join(repoRoot, 'scripts/known-failure-probes/packed-first-loop-contract.mjs'),
        path.join(probeDirectory, 'linked.mjs'),
      );
      symlinkSync(probeDirectory, path.join(probeDirectory, 'alias'), 'dir');
      const nestedProbeDirectory = path.join(probeDirectory, 'nested');
      mkdirSync(nestedProbeDirectory);
      copyFileSync(
        path.join(repoRoot, 'scripts/known-failure-probes/packed-first-loop-contract.mjs'),
        path.join(nestedProbeDirectory, 'stale.mjs'),
      );
      const linked = structuredClone(register);
      linked.entries[0].probe.path = 'scripts/known-failure-probes/linked.mjs';
      linked.entries[0].probe.command[1] = linked.entries[0].probe.path;
      const findings = validateKnownFailureRegister(linked, {
        repoRoot: temporaryRoot,
        ledgerResolver,
      });
      expect(findings).toContain(
        'KF-DEVEX-001: scripts/known-failure-probes/linked.mjs: mapped probe contains a symbolic-link path segment: scripts/known-failure-probes/linked.mjs',
      );
      expect(findings).toContain(
        'stale unregistered probe: scripts/known-failure-probes/nested/stale.mjs',
      );

      const aliased = structuredClone(register);
      aliased.entries[0].probe.path =
        'scripts/known-failure-probes/alias/packed-first-loop-contract.mjs';
      aliased.entries[0].probe.command[1] = aliased.entries[0].probe.path;
      expect(
        validateKnownFailureRegister(aliased, {
          repoRoot: temporaryRoot,
          ledgerResolver,
        }),
      ).toContain(
        'KF-DEVEX-001: scripts/known-failure-probes/alias/packed-first-loop-contract.mjs: mapped probe contains a symbolic-link path segment: scripts/known-failure-probes/alias/packed-first-loop-contract.mjs',
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('accepts only a bounded row-authenticated result as expected failure or unexpected pass', () => {
    const executableRegister = registerWithExecutableDevReady();
    const xfail = runKnownFailureProbes(executableRegister, {
      repoRoot,
      packedManifest: ownershipLedgerPath,
      ledgerResolver,
      spawnSync: (_executable, args) => {
        const id = commandId(args);
        const entry = executableRegister.entries.find((candidate) => candidate.id === id);
        return processResult(
          id,
          entry?.state === 'retired' ? 'desired-behavior' : 'defect-reproduced',
        );
      },
    });
    const xpass = runKnownFailureProbes(executableRegister, {
      repoRoot,
      packedManifest: ownershipLedgerPath,
      ledgerResolver,
      spawnSync: (_executable, args) => processResult(commandId(args), 'desired-behavior'),
    });

    expect(xfail.executableClosureComplete).toBe(true);
    expect(xfail.availablePass).toBe(true);
    expect(xfail.pass).toBe(true);
    expect(xfail.results.filter((result) => result.status === 'xfail')).toEqual([
      expect.objectContaining({ id: 'KF-DEVEX-002' }),
    ]);
    expect(xpass.executableClosureComplete).toBe(true);
    expect(xpass.availablePass).toBe(false);
    expect(xpass.pass).toBe(false);
    expect(xpass.results.filter((result) => result.status === 'xpass')).toEqual([
      expect.objectContaining({ id: 'KF-DEVEX-002' }),
    ]);
  });

  it('does not mistake arbitrary exit 1, crashes, usage errors, or forged row results for XFAIL', () => {
    const hostileResults = [
      processResult(null, null, { status: 1 }),
      processResult(null, null, {
        status: null,
        error: new Error('crash'),
      }),
      processResult(null, null, {
        status: 1,
        stderr: 'Usage: fake probe',
      }),
      processResult('KF-DEVEX-999', 'defect-reproduced'),
      processResult('KF-DEVEX-003', 'desired-behavior', { status: 1 }),
    ];
    for (const hostile of hostileResults) {
      const result = runKnownFailureProbes(register, {
        repoRoot,
        packedManifest: ownershipLedgerPath,
        ledgerResolver,
        spawnSync: () => hostile,
      });
      expect(result.availablePass).toBe(false);
      expect(result.pass).toBe(false);
      expect(result.results.some((item) => item.status === 'xfail')).toBe(false);
      expect(result.results.filter((item) => item.status === 'infrastructure-error')).toHaveLength(
        10,
      );
    }

    const ledgerFailure = runKnownFailureProbes(register, {
      repoRoot,
      packedManifest: ownershipLedgerPath,
      ledgerResolver: () => null,
      spawnSync: () => {
        throw new Error('must not execute');
      },
    });
    expect(ledgerFailure).toMatchObject({
      availablePass: false,
      pass: false,
      results: [],
      schemaValid: false,
    });
  });

  it('executes retired rows as ordinary passing regressions and turns recurrence red', () => {
    const executed = [];
    const passing = runKnownFailureProbes(register, {
      repoRoot,
      packedManifest: ownershipLedgerPath,
      ledgerResolver,
      spawnSync: (_executable, args) => {
        const id = commandId(args);
        executed.push(id);
        const entry = register.entries.find((candidate) => candidate.id === id);
        return processResult(
          id,
          entry?.state === 'retired' ? 'desired-behavior' : 'defect-reproduced',
        );
      },
    });
    expect(executed).toContain('KF-DEVEX-003');
    expect(passing.results.filter((result) => result.status === 'retired-pass')).toEqual([
      { id: 'KF-DEVEX-001', status: 'retired-pass' },
      { id: 'KF-DEVEX-002', status: 'retired-pass' },
      { id: 'KF-DEVEX-003', status: 'retired-pass' },
      { id: 'KF-DEVEX-004', status: 'retired-pass' },
      { id: 'KF-DEVEX-005', status: 'retired-pass' },
      { id: 'KF-DEVEX-006', status: 'retired-pass' },
      { id: 'KF-DEVEX-007', status: 'retired-pass' },
      { id: 'KF-DEVEX-008', status: 'retired-pass' },
      { id: 'KF-DEVEX-009', status: 'retired-pass' },
      { id: 'KF-DEVEX-010', status: 'retired-pass' },
    ]);
    expect(passing.availablePass).toBe(true);
    expect(passing.pass).toBe(true);

    const regression = runKnownFailureProbes(register, {
      repoRoot,
      packedManifest: ownershipLedgerPath,
      ledgerResolver,
      spawnSync: (_executable, args) => processResult(commandId(args), 'defect-reproduced'),
    });
    expect(regression.availablePass).toBe(false);
    expect(regression.pass).toBe(false);
    expect(regression.results.filter((result) => result.status === 'retired-regression')).toEqual([
      { id: 'KF-DEVEX-001', status: 'retired-regression' },
      { id: 'KF-DEVEX-002', status: 'retired-regression' },
      { id: 'KF-DEVEX-003', status: 'retired-regression' },
      { id: 'KF-DEVEX-004', status: 'retired-regression' },
      { id: 'KF-DEVEX-005', status: 'retired-regression' },
      { id: 'KF-DEVEX-006', status: 'retired-regression' },
      { id: 'KF-DEVEX-007', status: 'retired-regression' },
      { id: 'KF-DEVEX-008', status: 'retired-regression' },
      { id: 'KF-DEVEX-009', status: 'retired-regression' },
      { id: 'KF-DEVEX-010', status: 'retired-regression' },
    ]);
  });

  it('classifies empty-check only for the exact missing-graph contract, never generic failures', () => {
    expect(
      packedCliContractOutcome('empty-check', {
        status: 1,
        signal: null,
        error: null,
        stdout: '',
        stderr: 'kovo: graph input is required when no explicit artifact exists',
      }),
    ).toBe('desired-behavior');
    expect(
      packedCliContractOutcome('empty-check', {
        status: 2,
        stdout: '',
        stderr:
          'kovo-check/v1\nERROR kovo check app module is missing or unreadable: "/tmp/app/src/app.tsx".\n',
      }),
    ).toBe('desired-behavior');
    expect(
      packedCliContractOutcome('empty-check', {
        status: 1,
        stdout:
          'kovo-check/v1\nERROR kovo check app module is missing or unreadable: "/tmp/app/src/app.tsx".\n',
        stderr: '',
      }),
    ).toBe('desired-behavior');
    for (const stderr of [
      'Usage: kovo check <graph>',
      'unknown command check',
      'ERR_MODULE_NOT_FOUND',
      'permission denied',
    ]) {
      expect(
        packedCliContractOutcome('empty-check', {
          status: 1,
          signal: null,
          error: null,
          stdout: '',
          stderr,
        }),
      ).toBeNull();
    }
    expect(
      packedCliContractOutcome('empty-check', {
        status: 0,
        signal: null,
        error: null,
        stdout: 'kovo-check/v1\nOK\n',
        stderr: '',
      }),
    ).toBe('defect-reproduced');
  });

  it('classifies the SQLite login and dev-ready reproducers only from complete observations', () => {
    expect(
      packedFirstLoopContractOutcome('sqlite-login', {
        body: '<form><label>Email</label><button>Sign in</button></form>',
        healthStatus: 200,
        listened: true,
        serverOutput: '',
        status: 200,
      }),
    ).toBe('desired-behavior');
    expect(
      packedFirstLoopContractOutcome('sqlite-login', {
        body: 'Internal Server Error',
        healthStatus: 200,
        listened: true,
        serverOutput: 'Better Auth session provider failed inside the trusted plaintext boundary',
        status: 500,
      }),
    ).toBe('defect-reproduced');
    expect(
      packedFirstLoopContractOutcome('sqlite-login', {
        body: 'Internal Server Error',
        healthStatus: 200,
        listened: true,
        serverOutput: 'permission denied',
        status: 500,
      }),
    ).toBeNull();

    const report = [
      'Kovo dev ready in 12ms',
      '  Local URL    http://127.0.0.1:5173/',
      '  Network URL  http://127.0.0.1:5173/ (loopback only)',
      '  Mode         development',
      '  App          src/app.tsx',
      '  Database     SQLite (experimental)',
      '  Devtool      http://127.0.0.1:5173/__kovo',
      '',
    ].join('\n');
    expect(
      packedFirstLoopContractOutcome('dev-ready', {
        graceExpired: false,
        listened: true,
        readyDelayKind: 'interval-censored',
        readyDelayMs: DEV_READY_POST_BIND_BUDGET_MS,
        stdout: report,
      }),
    ).toBe('desired-behavior');
    expect(
      packedFirstLoopContractOutcome('dev-ready', {
        graceExpired: true,
        listened: true,
        readyDelayKind: null,
        readyDelayMs: null,
        stdout: '',
      }),
    ).toBe('defect-reproduced');
    expect(
      packedFirstLoopContractOutcome('dev-ready', {
        graceExpired: false,
        listened: true,
        readyDelayKind: 'exact',
        readyDelayMs: 12,
        stdout: 'Local: http://127.0.0.1:5173',
      }),
    ).toBeNull();
    expect(
      packedFirstLoopContractOutcome('dev-ready', {
        graceExpired: false,
        listened: true,
        readyDelayKind: 'exact',
        readyDelayMs: DEV_READY_POST_BIND_BUDGET_MS + 1,
        stdout: report,
      }),
    ).toBeNull();
  });

  it('classifies stale build promotion and KV417 coupling without accepting generic failures', () => {
    const beforeDigest = `sha256:${'a'.repeat(64)}`;
    const afterDigest = `sha256:${'b'.repeat(64)}`;
    const failedOutput =
      'ERROR KV417 deployment retention proof is required for client-module history';
    expect(
      packedFirstLoopContractOutcome('transactional-build', {
        afterDigest: beforeDigest,
        beforeDigest,
        failedExit: 1,
        failedGraphPromoted: false,
        failedOutput,
        initialExit: 0,
      }),
    ).toBe('desired-behavior');
    expect(
      packedFirstLoopContractOutcome('transactional-build', {
        afterDigest,
        beforeDigest,
        failedExit: 1,
        failedGraphPromoted: true,
        failedOutput,
        initialExit: 0,
      }),
    ).toBe('defect-reproduced');
    expect(
      packedFirstLoopContractOutcome('transactional-build', {
        afterDigest,
        beforeDigest,
        failedExit: 1,
        failedGraphPromoted: true,
        failedOutput: 'TypeScript failed',
        initialExit: 0,
      }),
    ).toBeNull();

    expect(
      packedFirstLoopContractOutcome('fresh-check', {
        variants: [
          { dialect: 'postgres', exit: 0, output: 'kovo-check/v1\nCOVERAGE component=App\n' },
          {
            dialect: 'sqlite',
            exit: 0,
            output: 'kovo-check/v1\nWARN KV447 Table session declares owner scoping\n',
          },
        ],
      }),
    ).toBe('desired-behavior');
    expect(
      packedFirstLoopContractOutcome('fresh-check', {
        variants: [
          { dialect: 'postgres', exit: 0, output: 'kovo-check/v1\n' },
          { dialect: 'sqlite', exit: 1, output: failedOutput },
        ],
      }),
    ).toBe('defect-reproduced');
    expect(
      packedFirstLoopContractOutcome('fresh-check', {
        variants: [
          { dialect: 'postgres', exit: 0, output: 'kovo-check/v1\n' },
          { dialect: 'sqlite', exit: 1, output: 'permission denied' },
        ],
      }),
    ).toBeNull();
    expect(
      packedFirstLoopContractOutcome('fresh-check', {
        variants: [
          { dialect: 'postgres', exit: 0, output: 'check passed\n' },
          { dialect: 'sqlite', exit: 0, output: 'check passed\n' },
        ],
      }),
    ).toBeNull();
  });

  it('classifies the bounded full-catalog OOM and opaque 500 without laundering failures', () => {
    expect(
      packedFirstLoopContractOutcome('full-catalog', {
        buildExit: 0,
        buildMemoryExceeded: false,
        buildOutput: '',
        buildPeakRssMiB: 1_000,
        checkExit: 0,
        checkMemoryExceeded: false,
        checkOutput: '',
        checkPeakRssMiB: 1_000,
        componentCount: 44,
        typecheckExit: 0,
        typecheckMemoryExceeded: false,
        typecheckOutput: '',
        typecheckPeakRssMiB: 1_000,
        unimported: true,
      }),
    ).toBe('desired-behavior');
    expect(
      packedFirstLoopContractOutcome('full-catalog', {
        buildExit: 0,
        buildMemoryExceeded: false,
        buildOutput: '',
        buildPeakRssMiB: 1_000,
        checkExit: 0,
        checkMemoryExceeded: false,
        checkOutput: '',
        checkPeakRssMiB: 1_000,
        componentCount: 44,
        typecheckExit: 134,
        typecheckMemoryExceeded: true,
        typecheckOutput:
          'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
        typecheckPeakRssMiB: 2_049,
        unimported: true,
      }),
    ).toBe('defect-reproduced');
    expect(
      packedFirstLoopContractOutcome('full-catalog', {
        buildExit: 0,
        buildMemoryExceeded: false,
        buildOutput: '',
        buildPeakRssMiB: 1_000,
        checkExit: 0,
        checkMemoryExceeded: false,
        checkOutput: '',
        checkPeakRssMiB: 1_000,
        componentCount: 44,
        typecheckExit: 1,
        typecheckMemoryExceeded: false,
        typecheckOutput: 'TypeScript error',
        typecheckPeakRssMiB: 1_000,
        unimported: true,
      }),
    ).toBeNull();
    expect(
      packedFirstLoopContractOutcome('full-catalog', {
        buildExit: 0,
        buildMemoryExceeded: false,
        buildOutput: '',
        buildPeakRssMiB: 1_000,
        checkExit: 1,
        checkMemoryExceeded: false,
        checkOutput:
          'ERROR KV448 compiler-owned posture installed implementation digest does not match',
        checkPeakRssMiB: 5_700,
        componentCount: 44,
        typecheckExit: 0,
        typecheckMemoryExceeded: false,
        typecheckOutput: '',
        typecheckPeakRssMiB: 1_000,
        unimported: true,
      }),
    ).toBeNull();
    expect(
      packedFirstLoopContractOutcome('full-catalog', {
        buildExit: 0,
        buildMemoryExceeded: false,
        buildOutput: '',
        buildPeakRssMiB: 1_000,
        checkExit: 0,
        checkMemoryExceeded: false,
        checkOutput: '',
        checkPeakRssMiB: 1_000,
        componentCount: 44,
        typecheckExit: 137,
        typecheckMemoryExceeded: true,
        typecheckOutput: 'killed',
        typecheckPeakRssMiB: 1_000,
        unimported: true,
      }),
    ).toBeNull();

    expect(
      packedFirstLoopContractOutcome('opaque-boundary', {
        body: 'ok',
        healthStatus: 200,
        listened: true,
        status: 200,
      }),
    ).toBe('desired-behavior');
    expect(
      packedFirstLoopContractOutcome('opaque-boundary', {
        body: 'KV490\nCause: invalid origin\nNext step: run kovo doctor',
        healthStatus: 200,
        listened: true,
        status: 500,
      }),
    ).toBe('desired-behavior');
    expect(
      packedFirstLoopContractOutcome('opaque-boundary', {
        body: 'Internal Server Error',
        healthStatus: 200,
        listened: true,
        status: 500,
      }),
    ).toBe('defect-reproduced');
    expect(
      packedFirstLoopContractOutcome('opaque-boundary', {
        body: 'upstream unavailable',
        healthStatus: 200,
        listened: true,
        status: 502,
      }),
    ).toBeNull();
  });
});

function registerWithExecutableDevReady() {
  const copy = JSON.parse(JSON.stringify(register));
  const devReady = copy.entries.find((entry) => entry.id === 'KF-DEVEX-002');
  devReady.state = 'executable';
  delete devReady.retirement;
  return copy;
}

function validateRegister(value) {
  return validateKnownFailureRegister(value, { repoRoot, ledgerResolver });
}

function commandId(args) {
  return args[args.indexOf('--id') + 1];
}

function processResult(id, outcome, overrides = {}) {
  const status =
    outcome === 'desired-behavior'
      ? DESIRED_BEHAVIOR_EXIT_CODE
      : outcome === 'defect-reproduced'
        ? REPRODUCED_DEFECT_EXIT_CODE
        : INFRASTRUCTURE_ERROR_EXIT_CODE;
  return {
    status,
    signal: null,
    error: null,
    stdout:
      id && outcome
        ? `${JSON.stringify({
            schema: KNOWN_FAILURE_PROBE_RESULT_SCHEMA,
            id,
            outcome,
          })}\n`
        : '',
    stderr: '',
    ...overrides,
  };
}
