import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authenticateReadyProfileControllerSource,
  DEV_READY_PROFILE_CONTROLLER_BINDING_SCHEMA,
  materializeReadyProfileController,
  readBootstrapStableFile,
  runReadyProfileBootstrap,
  verifyProfileArtifactCustody,
} from './perf-dev-ready-profile-bootstrap.mjs';

const roots = [];
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const LOCKS = [
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
];
const CONTROLLER = [
  'benchmarks/corpora/dev-loop.mjs',
  'benchmarks/corpora/dev-process-marker.mjs',
  'benchmarks/corpora/generate.mjs',
  'benchmarks/harness/dev-port-allocation.mjs',
  'packages/icons/scripts/icon-plan.mjs',
  'scripts/component-catalog-schema.mjs',
  'scripts/lib/bounded-regular-file.mjs',
  'scripts/lib/cli-entry.mjs',
  'scripts/lib/deterministic-tarball.mjs',
  'scripts/lib/pack-without-lifecycle.mjs',
  'scripts/lib/perf-dev-session-evidence.mjs',
  'scripts/lib/perf-execution.mjs',
  'scripts/lib/perf-host.mjs',
  'scripts/lib/perf-packed-kovo-product.mjs',
  'scripts/lib/perf-provenance.mjs',
  'scripts/lib/perf-ready-route.mjs',
  'scripts/lib/process-tree-rss.mjs',
  'scripts/lib/repo-root.mjs',
  'scripts/package-exports.mjs',
  'scripts/perf-cli-startup-benchmark.mjs',
  'scripts/perf-dev-edit-profile.mjs',
  'scripts/perf-dev-generation-spike.mjs',
  'scripts/perf-dev-ready-profile-bootstrap.mjs',
  'scripts/perf-dev-ready-profile.mjs',
  'scripts/public-packages.mjs',
  'scripts/release-packages.mjs',
];
const BOUND = ['package.json', ...LOCKS, ...CONTROLLER].sort();

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('immutable ready-profile controller bootstrap', () => {
  it('derives every tree/blob from one commit and materializes a read-only private controller', async () => {
    const fixture = await sourceFixture();
    const calls = [];
    const dependencies = gitDependencies(fixture, { calls });
    const authenticated = authenticateReadyProfileControllerSource(
      { root: fixture.root },
      dependencies,
    );

    expect(authenticated).toMatchObject({
      commit: fixture.commit,
      packageManager: 'pnpm@10.15.1',
      pnpmVersion: '10.15.1',
      tree: fixture.tree,
    });
    expect(
      calls
        .filter((args) => args[0] === 'rev-parse' && args.at(-1).includes(':'))
        .every((args) => args.at(-1).startsWith(`${fixture.commit}:`)),
    ).toBe(true);

    const materialized = materializeReadyProfileController(authenticated, {
      ...dependencies,
      spawn(_command, args, label) {
        if (label !== 'controller archive extraction') return;
        const destination = args[args.indexOf('-C') + 1];
        for (const file of BOUND) {
          const target = path.join(destination, file);
          mkdirSyncParent(target);
          copyFileSync(path.join(fixture.root, file), target);
        }
      },
    });
    try {
      expect(materialized.binding).toMatchObject({
        commit: fixture.commit,
        privateRoot: materialized.privateRoot,
        schema: DEV_READY_PROFILE_CONTROLLER_BINDING_SCHEMA,
        tree: fixture.tree,
      });
      expect(Object.values(materialized.binding.files)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            snapshotIdentity: expect.objectContaining({
              ctimeNs: expect.stringMatching(/^[0-9]+$/u),
              ino: expect.stringMatching(/^[0-9]+$/u),
              mtimeNs: expect.stringMatching(/^[0-9]+$/u),
              nlink: 1,
            }),
          }),
        ]),
      );
      expect(
        lstatSync(path.join(materialized.privateRoot, 'scripts/perf-dev-ready-profile.mjs')).mode &
          0o222,
      ).toBe(0);
      expect(
        await readFile(path.join(materialized.privateRoot, 'scripts/perf-dev-ready-profile.mjs')),
      ).toEqual(await readFile(path.join(fixture.root, 'scripts/perf-dev-ready-profile.mjs')));
    } finally {
      materialized.cleanup();
    }
  });

  it('binds the archived module to canonical-equivalent roots and rejects every other archive', async () => {
    const controllerSource = await realControllerRepository();
    const authenticated = authenticateReadyProfileControllerSource({ root: controllerSource });
    const materialized = materializeReadyProfileController(authenticated);
    const secondArchive = materializeReadyProfileController(authenticated);
    try {
      const positiveRoots = [
        { label: 'exact', root: materialized.privateRoot },
        { label: 'trailing separator', root: `${materialized.privateRoot}${path.sep}` },
      ];
      if (process.platform === 'darwin') {
        expect(materialized.privateRoot.startsWith('/private/var/')).toBe(true);
        const macosAlias = materialized.privateRoot.slice('/private'.length);
        expect(realpathSync(macosAlias)).toBe(materialized.privateRoot);
        positiveRoots.push({ label: 'macOS /var canonical alias', root: macosAlias });
      }

      for (const bindingCase of positiveRoots) {
        const probeRoot = await temporaryRoot();
        const probe = spawnArchivedBindingProbe(
          materialized,
          { ...materialized.binding, privateRoot: bindingCase.root },
          probeRoot,
        );
        expect(probe, bindingCase.label).toMatchObject({ signal: null, status: 0 });
        expect(probe.stderr, bindingCase.label).toBe('');
        expect(JSON.parse(probe.stdout), bindingCase.label).toEqual({
          privateRoot: bindingCase.root,
        });
      }

      const siblingRoot = path.join(path.dirname(materialized.privateRoot), 'sibling-controller');
      mkdirSync(siblingRoot);
      const symlinkRoot = path.join(await temporaryRoot(), 'controller-final-symlink');
      symlinkSync(materialized.privateRoot, symlinkRoot, 'dir');
      expect(
        await readFile(path.join(materialized.privateRoot, 'scripts/perf-dev-ready-profile.mjs')),
      ).toEqual(
        await readFile(path.join(secondArchive.privateRoot, 'scripts/perf-dev-ready-profile.mjs')),
      );
      const negativeRoots = [
        {
          binding: { ...materialized.binding, privateRoot: siblingRoot },
          error: /not imported from its bound immutable checkout/u,
          label: 'sibling directory',
        },
        {
          binding: secondArchive.binding,
          error: /not imported from its bound immutable checkout/u,
          label: 'independent byte-identical archive',
        },
        {
          binding: { ...materialized.binding, privateRoot: symlinkRoot },
          error: /must be a non-symlink directory/u,
          label: 'direct final-component symlink',
        },
      ];

      for (const bindingCase of negativeRoots) {
        const probe = spawnArchivedBindingProbe(
          materialized,
          bindingCase.binding,
          await temporaryRoot(),
        );
        expect(probe, bindingCase.label).toMatchObject({ signal: null, status: 1 });
        expect(probe.stderr, bindingCase.label).toMatch(bindingCase.error);
      }
    } finally {
      secondArchive.cleanup();
      materialized.cleanup();
    }
  });

  it('runs the archived script CLI through main and advances to candidate authentication', async () => {
    const controllerSource = await realControllerRepository();
    const candidate = await realCandidateRepository();
    const authenticated = authenticateReadyProfileControllerSource({ root: controllerSource });
    const materialized = materializeReadyProfileController(authenticated);
    try {
      const reportRoot = await temporaryRoot();
      const child = spawnSync(
        process.execPath,
        [
          path.join(materialized.privateRoot, 'scripts/perf-dev-ready-profile.mjs'),
          '--diagnose',
          '--baseline-root',
          candidate.baseline,
          '--spike-root',
          candidate.repository,
          '--out',
          path.join(reportRoot, 'report.json'),
          '--profile-dir',
          path.join(reportRoot, 'profiles'),
          '--host-settle-max-ms',
          '0',
          '--max-load-per-cpu',
          '1000000000',
        ],
        {
          cwd: materialized.privateRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING: materialized.bindingPath,
            KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING_SHA256: materialized.bindingSha256,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      expect(child).toMatchObject({ signal: null, status: 1 });
      expect(child.stderr).not.toMatch(/bound immutable checkout/u);
      expect(child.stderr).toMatch(
        /refs\/heads\/perf-spike\/dev-query-mode-safe-20260821\^\{commit\}/u,
      );
      expect(readdirSync(reportRoot)).toEqual([]);
    } finally {
      materialized.cleanup();
    }
  });

  it('spawns the archived controller and reaches real Git candidate authentication before pack', async () => {
    const controllerRoot = await realControllerRepository();
    const candidate = await realCandidateRepository();
    const authenticated = authenticateReadyProfileControllerSource({ root: controllerRoot });
    const materialized = materializeReadyProfileController(authenticated);
    try {
      const reportRoot = await temporaryRoot();
      const controllerUrl = pathToFileURL(
        path.join(materialized.privateRoot, 'scripts/perf-dev-ready-profile.mjs'),
      ).href;
      const generationUrl = pathToFileURL(
        path.join(materialized.privateRoot, 'scripts/perf-dev-generation-spike.mjs'),
      ).href;
      const portAllocationUrl = pathToFileURL(
        path.join(materialized.privateRoot, 'benchmarks/harness/dev-port-allocation.mjs'),
      ).href;
      const childSource = `
        import { controllerBindingFromEnvironment, runDevReadyProfile } from ${JSON.stringify(controllerUrl)};
        import { authenticateGenerationCandidateRoots } from ${JSON.stringify(generationUrl)};
        import { inspectDevPortAllocation } from ${JSON.stringify(portAllocationUrl)};

        const candidate = ${JSON.stringify(candidate.candidate)};
        const expectedCandidateRepository = ${JSON.stringify(candidate.repository)};
        const controllerBinding = controllerBindingFromEnvironment();
        let authenticatedCandidate = null;
        let packedLaneInvoked = false;
        try {
          await runDevReadyProfile(
            {
              baselineRoot: ${JSON.stringify(candidate.baseline)},
              diagnose: true,
              out: ${JSON.stringify(path.join(reportRoot, 'report.json'))},
              profileDir: ${JSON.stringify(path.join(reportRoot, 'profiles'))},
              spikeRoot: expectedCandidateRepository,
            },
            {
              controllerBinding,
              createHostAdmission: () => ({
                async admit(label) { return { comparable: true, label }; },
                markBenchmarkWork() {},
              }),
              inspectPortAllocation: (options) => inspectDevPortAllocation(options),
              preparationDependencies: {
                authenticateRoots(options) {
                  if (options.candidateRepository !== expectedCandidateRepository) {
                    throw new Error('candidate repository escaped the spike worktree');
                  }
                  authenticatedCandidate = authenticateGenerationCandidateRoots({
                    ...options,
                    candidate,
                  });
                  throw new Error('integration-stop-after-real-candidate-auth');
                },
                preparePackedLane() {
                  packedLaneInvoked = true;
                  throw new Error('pack must not run in the archived-child regression');
                },
              },
            },
          );
          throw new Error('archived-child regression unexpectedly completed');
        } catch (error) {
          if (error?.message !== 'integration-stop-after-real-candidate-auth') throw error;
        }
        process.stdout.write(JSON.stringify({
          baselineRoot: authenticatedCandidate?.baseline?.root,
          bindingPrivateRoot: controllerBinding.privateRoot,
          candidateAuthenticated: authenticatedCandidate !== null,
          packedLaneInvoked,
          spikeRoot: authenticatedCandidate?.spike?.root,
        }) + '\\n');
      `;
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
        cwd: materialized.privateRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING: materialized.bindingPath,
          KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING_SHA256: materialized.bindingSha256,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      expect(child).toMatchObject({ signal: null, status: 0 });
      expect(child.stderr).toBe('');
      expect(JSON.parse(child.stdout)).toEqual({
        baselineRoot: candidate.baseline,
        bindingPrivateRoot: materialized.privateRoot,
        candidateAuthenticated: true,
        packedLaneInvoked: false,
        spikeRoot: candidate.repository,
      });
      expect(readdirSync(reportRoot)).toEqual([]);
    } finally {
      materialized.cleanup();
    }
  });

  it('publishes a final-path seal only after non-clobber profile publication', async () => {
    const fixture = await bootstrapRunFixture();
    await expect(runReadyProfileBootstrap(fixture.argv, fixture.dependencies)).resolves.toBe(0);
    const report = JSON.parse(await readFile(fixture.out, 'utf8'));
    const finalDirectory = fileIdentity(lstatSync(fixture.profileDir, { bigint: true }));
    const controllerAnalysisSha256 = canonicalDigest(fixture.controllerReport.analysis);
    const controllerArtifactSealSha256 = canonicalDigest(fixture.controllerReport.artifactSeal);

    expect(report.controller.bootstrap).toMatchObject({
      controllerAnalysisSha256,
      controllerArtifactSealSha256,
      headStableThroughPublication: true,
      publishedArtifactSealSha256: canonicalDigest(report.artifactSeal),
      artifactPublication: {
        controllerDirectoryIdentity: fixture.controllerReport.artifactSeal.directory.identity,
        controllerSealSha256: controllerArtifactSealSha256,
        finalDirectoryIdentity: finalDirectory,
        publication: 'exclusive-directory-plus-hardlinks/v1',
      },
    });
    expect(report.artifactSeal.directory.identity).toEqual(finalDirectory);
    expect(fixture.controllerEnvironment).not.toHaveProperty('NODE_OPTIONS');
    expect(fixture.controllerEnvironment).not.toHaveProperty('NODE_PATH');
    expect(readdirSync(fixture.profileDir)).toHaveLength(8);
    for (const [index, cell] of report.artifactSeal.cells.entries()) {
      for (const kind of ['cpu', 'coverage']) {
        const before = fixture.controllerReport.artifactSeal.cells[index].artifacts[kind];
        const after = cell.artifacts[kind];
        expect(after).toMatchObject({
          dev: before.dev,
          ino: before.ino,
          sha256: before.sha256,
        });
      }
    }
  });

  it('does not overwrite an appearing report and rolls back the published profile target', async () => {
    const fixture = await bootstrapRunFixture();
    fixture.dependencies.beforeReportPublication = () => {
      writeFileSync(fixture.out, '{"owner":"other"}\n', { flag: 'wx' });
    };

    await expect(runReadyProfileBootstrap(fixture.argv, fixture.dependencies)).rejects.toThrow();
    expect(await readFile(fixture.out, 'utf8')).toBe('{"owner":"other"}\n');
    expect(existsSync(fixture.profileDir)).toBe(false);
  });

  it('fails closed and rolls back when source or artifacts change across publication', async () => {
    const mutations = [
      {
        hook: 'afterPrepublicationVerification',
        mutate({ report }) {
          report.analysis.overall.windows = 3;
        },
      },
      {
        hook: 'afterPrepublicationVerification',
        mutate({ report, stagedProfiles }) {
          const file = report.artifactSeal.cells[0].artifacts.cpu.file;
          writeFileSync(path.join(stagedProfiles, file), '{"tampered":true}\n');
        },
      },
      {
        hook: 'afterProfilePublication',
        mutate(_context, fixture) {
          writeFileSync(fixture.source.head, 'changed head guard\n');
        },
      },
      {
        hook: 'afterReportPublication',
        mutate(_context, fixture) {
          writeFileSync(fixture.source.head, 'changed after report publication\n');
        },
      },
    ];

    for (const mutation of mutations) {
      const fixture = await bootstrapRunFixture();
      fixture.dependencies[mutation.hook] = (context) => mutation.mutate(context, fixture);
      await expect(runReadyProfileBootstrap(fixture.argv, fixture.dependencies)).rejects.toThrow();
      expect(existsSync(fixture.out)).toBe(false);
      expect(existsSync(fixture.profileDir)).toBe(false);
    }
  });

  it.each(['afterPrepublicationVerification', 'afterProfilePublication'])(
    'rejects a structurally valid coordinated analysis/seal substitution at %s',
    async (hook) => {
      const fixture = await bootstrapRunFixture();
      fixture.dependencies[hook] = (context) => {
        const replacement = substitutedReadyAnalysis();
        expect(canonicalDigest(replacement)).not.toBe(canonicalDigest(context.report.analysis));
        context.report.analysis = structuredClone(replacement);
        context.report.artifactSeal.analysis = structuredClone(replacement);
        expect(() =>
          verifyProfileArtifactCustody(
            context.report,
            context.stagedProfiles ?? context.publishedProfile.target,
          ),
        ).not.toThrow();
      };

      await expect(runReadyProfileBootstrap(fixture.argv, fixture.dependencies)).rejects.toThrow(
        /authenticated report analysisSha256 and artifactSealSha256 changed/u,
      );
      expect(existsSync(fixture.out)).toBe(false);
      expect(existsSync(fixture.profileDir)).toBe(false);
    },
  );

  it('rejects commit/tree movement and committed-blob or filesystem-byte confusion', async () => {
    {
      const fixture = await sourceFixture();
      let headReads = 0;
      const base = gitDependencies(fixture);
      expect(() =>
        authenticateReadyProfileControllerSource(
          { root: fixture.root },
          {
            ...base,
            gitText(root, args) {
              if (args.at(-1) === 'HEAD^{commit}' && ++headReads > 1) return 'e'.repeat(40);
              return base.gitText(root, args);
            },
          },
        ),
      ).toThrow(/HEAD moved/u);
    }
    {
      const fixture = await sourceFixture();
      let treeReads = 0;
      const base = gitDependencies(fixture);
      expect(() =>
        authenticateReadyProfileControllerSource(
          { root: fixture.root },
          {
            ...base,
            gitText(root, args) {
              if (args.at(-1) === `${fixture.commit}^{tree}` && ++treeReads > 1) {
                return 'e'.repeat(40);
              }
              return base.gitText(root, args);
            },
          },
        ),
      ).toThrow(/tree changed/u);
    }
    {
      const fixture = await sourceFixture();
      const base = gitDependencies(fixture);
      expect(() =>
        authenticateReadyProfileControllerSource(
          { root: fixture.root },
          { ...base, gitBytes: () => Buffer.from('wrong committed bytes') },
        ),
      ).toThrow(/filesystem bytes differ from committed blob/u);
    }
    {
      const fixture = await sourceFixture();
      await writeFile(path.join(fixture.root, CONTROLLER[0]), 'changed filesystem bytes\n');
      expect(() =>
        authenticateReadyProfileControllerSource({ root: fixture.root }, gitDependencies(fixture)),
      ).toThrow(/filesystem bytes differ from committed blob/u);
    }
  });

  it('rejects symlinks and an lstat-to-open replacement race in the bootstrap TCB', async () => {
    const fixture = await sourceFixture();
    const authenticated = authenticateReadyProfileControllerSource(
      { root: fixture.root },
      gitDependencies(fixture),
    );
    expect(() =>
      materializeReadyProfileController(authenticated, {
        ...gitDependencies(fixture),
        spawn(_command, args, label) {
          if (label !== 'controller archive extraction') return;
          const destination = args[args.indexOf('-C') + 1];
          for (const boundFile of BOUND) {
            const target = path.join(destination, boundFile);
            mkdirSyncParent(target);
            copyFileSync(path.join(fixture.root, boundFile), target);
          }
          symlinkSync(fixture.root, path.join(destination, 'escaped-source'));
        },
      }),
    ).toThrow(/archive symlink escapes/u);

    const root = await temporaryRoot();
    const declared = path.join(root, 'controller.mjs');
    const replacement = path.join(root, 'replacement.mjs');
    await Promise.all([
      writeFile(declared, 'export {};\n'),
      writeFile(replacement, 'export {};\n'),
    ]);
    const file = await realpath(declared);
    const link = path.join(root, 'link.mjs');
    symlinkSync(file, link);
    expect(() => readBootstrapStableFile(link, 1024, 'bootstrap symlink')).toThrow(/regular file/u);
    expect(() =>
      readBootstrapStableFile(file, 1024, 'bootstrap race', {
        afterLstat() {
          unlinkSync(file);
          copyFileSync(replacement, file);
        },
      }),
    ).toThrow(/changed identity/u);
  });
});

function spawnArchivedBindingProbe(materialized, binding, probeRoot) {
  const bindingPath = path.join(probeRoot, 'controller-binding.json');
  const bindingBytes = Buffer.from(`${JSON.stringify(binding)}\n`);
  writeFileSync(bindingPath, bindingBytes, { flag: 'wx', mode: 0o400 });
  const controllerUrl = pathToFileURL(
    path.join(materialized.privateRoot, 'scripts/perf-dev-ready-profile.mjs'),
  ).href;
  const childSource = `
    import { controllerBindingFromEnvironment } from ${JSON.stringify(controllerUrl)};
    const binding = controllerBindingFromEnvironment();
    process.stdout.write(JSON.stringify({ privateRoot: binding.privateRoot }) + '\\n');
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
    cwd: materialized.privateRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING: bindingPath,
      KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING_SHA256: `sha256:${createHash('sha256')
        .update(bindingBytes)
        .digest('hex')}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function bootstrapRunFixture() {
  const source = await sourceFixture();
  const outputRoot = await temporaryRoot();
  const out = path.join(outputRoot, 'report.json');
  const profileDir = path.join(outputRoot, 'profiles');
  const argv = ['--diagnose', '--out', out, '--profile-dir', profileDir];
  const base = gitDependencies(source);
  const fixture = { argv, controllerReport: null, dependencies: null, out, profileDir, source };
  fixture.dependencies = {
    ...base,
    controllerRoot: source.root,
    spawn(_command, args, label) {
      if (label !== 'controller archive extraction') return;
      const destination = args[args.indexOf('-C') + 1];
      for (const file of BOUND) {
        const target = path.join(destination, file);
        mkdirSyncParent(target);
        copyFileSync(path.join(source.root, file), target);
      }
    },
    environment: {
      ...process.env,
      NODE_OPTIONS: '--require=/tmp/untrusted.cjs',
      NODE_PATH: '/tmp/untrusted',
    },
    spawnController(_command, args, options) {
      fixture.controllerEnvironment = options.env;
      const childArgv = args.slice(1);
      const stagedOut = childArgv[childArgv.indexOf('--out') + 1];
      const stagedProfiles = childArgv[childArgv.indexOf('--profile-dir') + 1];
      fixture.controllerReport = writeSyntheticControllerReport(
        stagedOut,
        stagedProfiles,
        source.commit,
        source.tree,
      );
      return { error: undefined, signal: null, status: 0 };
    },
    writeStdout() {},
  };
  return fixture;
}

function writeSyntheticControllerReport(out, profileDir, commit, tree) {
  mkdirSync(profileDir, { mode: 0o700 });
  const cells = [];
  const sealedCells = [];
  const files = [];
  for (let scheduleIndex = 0; scheduleIndex < 4; scheduleIndex += 1) {
    const lane = scheduleIndex === 0 || scheduleIndex === 3 ? 'baseline' : 'spike';
    const stem = `cell-${String(scheduleIndex).padStart(3, '0')}-${lane}`;
    const binding = {
      cell: { scheduleIndex },
      inspectorProcess: {
        pid: 10_000 + scheduleIndex,
        processMarkerSha256: `sha256:${String(scheduleIndex).repeat(64)}`,
        targetId: `target-${String(scheduleIndex)}`,
      },
      productDigest: `sha256:${'a'.repeat(64)}`,
      schema: 'kovo-dev-ready-profile-window-binding/v1',
    };
    const attribution = { coverage: [], cpu: [] };
    const calls = [];
    const product = { digest: binding.productDigest, scriptAssets: [] };
    const cpuFile = `${stem}.cpuprofile`;
    const coverageFile = `${stem}.coverage.json`;
    const cpuEnvelope = {
      attribution: attribution.cpu,
      binding,
      profile: {},
      schema: 'kovo-dev-ready-profile-cpu/v1',
    };
    const coverageEnvelope = {
      attribution: attribution.coverage,
      binding,
      calls,
      coverage: {},
      product,
      schema: 'kovo-dev-ready-profile-coverage/v1',
    };
    writeFileSync(path.join(profileDir, cpuFile), `${JSON.stringify(cpuEnvelope)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    writeFileSync(path.join(profileDir, coverageFile), `${JSON.stringify(coverageEnvelope)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    const cpu = syntheticArtifactEvidence(profileDir, cpuFile, 'kovo-dev-ready-profile-cpu/v1');
    const coverage = syntheticArtifactEvidence(
      profileDir,
      coverageFile,
      'kovo-dev-ready-profile-coverage/v1',
    );
    files.push(cpuFile, coverageFile);
    cells.push({ profile: { artifact: { coverage, cpu }, attribution, binding, calls, product } });
    sealedCells.push({
      artifacts: {
        coverage: { ...coverage, sealed: true },
        cpu: { ...cpu, sealed: true },
      },
      binding,
    });
  }
  files.sort((left, right) => left.localeCompare(right));
  const analysis = syntheticReadyAnalysis();
  const report = {
    analysis: structuredClone(analysis),
    artifactSeal: {
      analysis,
      cells: sealedCells,
      directory: {
        files,
        identity: fileIdentity(lstatSync(profileDir, { bigint: true })),
      },
      schema: 'kovo-dev-ready-profile-artifact-seal/v1',
    },
    cells,
    controller: {
      before: { commit, tree },
      stable: true,
    },
    integrity: {
      analysisBound: true,
      artifactsSealed: true,
      complete: true,
      exactSchedule: true,
    },
    schema: 'kovo-dev-ready-profile/v1',
    verdict: { status: 'diagnostic-only' },
  };
  writeFileSync(out, `${JSON.stringify(report)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

function syntheticReadyAnalysis() {
  const ranking = () => ({
    calls: {
      census: {
        authenticatedCallCount: 0,
        authenticatedFunctions: 0,
        authenticatedIdentities: 0,
        totalCallCount: 0,
        totalFunctions: 0,
        unattributedCallCount: 0,
        unattributedFunctions: 0,
      },
      topFive: [],
    },
    cpu: {
      census: {
        authenticatedFrames: 0,
        idleSamples: 0,
        rankedSamples: 0,
        totalSamples: 0,
        unattributedSamples: 0,
      },
      topFive: [],
    },
    schema: 'kovo-dev-ready-profile-ranking/v1',
  });
  return {
    cells: [
      { lane: 'baseline', ranking: ranking(), scheduleIndex: 0 },
      { lane: 'spike', ranking: ranking(), scheduleIndex: 1 },
      { lane: 'spike', ranking: ranking(), scheduleIndex: 2 },
      { lane: 'baseline', ranking: ranking(), scheduleIndex: 3 },
    ],
    lanes: [
      { lane: 'baseline', ranking: ranking(), windows: 2 },
      { lane: 'spike', ranking: ranking(), windows: 2 },
    ],
    overall: { ranking: ranking(), windows: 4 },
    policy: {
      coverageMetric: 'precise-coverage-outer-range-call-count',
      cpuMetric: 'inspector-self-sample-count',
      top: 5,
      wallTimeClaims: false,
    },
    schema: 'kovo-dev-ready-profile-analysis/v1',
  };
}

function substitutedReadyAnalysis() {
  const ranking = () => ({
    calls: {
      census: {
        authenticatedCallCount: 3,
        authenticatedFunctions: 2,
        authenticatedIdentities: 2,
        totalCallCount: 3,
        totalFunctions: 2,
        unattributedCallCount: 0,
        unattributedFunctions: 0,
      },
      topFive: [
        {
          callCount: 2,
          identity: {
            endOffset: 20,
            functionName: 'substituteHot',
            path: 'substitute/hot.mjs',
            root: 'consumer',
            startOffset: 10,
          },
          rank: 1,
        },
        {
          callCount: 1,
          identity: {
            endOffset: 40,
            functionName: 'substituteWarm',
            path: 'substitute/warm.mjs',
            root: 'consumer',
            startOffset: 30,
          },
          rank: 2,
        },
      ],
    },
    cpu: {
      census: {
        authenticatedFrames: 2,
        idleSamples: 0,
        rankedSamples: 3,
        totalSamples: 3,
        unattributedSamples: 0,
      },
      topFive: [
        {
          identity: {
            columnNumber: 2,
            functionName: 'substituteHot',
            lineNumber: 12,
            path: 'substitute/hot.mjs',
            root: 'consumer',
          },
          rank: 1,
          selfSamples: 2,
        },
        {
          identity: {
            columnNumber: 4,
            functionName: 'substituteWarm',
            lineNumber: 34,
            path: 'substitute/warm.mjs',
            root: 'consumer',
          },
          rank: 2,
          selfSamples: 1,
        },
      ],
    },
    schema: 'kovo-dev-ready-profile-ranking/v1',
  });
  const analysis = syntheticReadyAnalysis();
  for (const cell of analysis.cells) cell.ranking = ranking();
  for (const lane of analysis.lanes) lane.ranking = ranking();
  analysis.overall.ranking = ranking();
  return analysis;
}

function canonicalDigest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function syntheticArtifactEvidence(root, file, schema) {
  const bytes = readFileSync(path.join(root, file));
  const stat = lstatSync(path.join(root, file), { bigint: true });
  return {
    bytes: bytes.byteLength,
    ctimeNs: String(stat.ctimeNs),
    dev: String(stat.dev),
    file,
    ino: String(stat.ino),
    mode: String(stat.mode),
    mtimeNs: String(stat.mtimeNs),
    nlink: Number(stat.nlink),
    schema,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function fileIdentity(stat) {
  return {
    bytes: Number(stat.size),
    ctimeNs: String(stat.ctimeNs),
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    mtimeNs: String(stat.mtimeNs),
    nlink: Number(stat.nlink),
  };
}

async function realControllerRepository() {
  const root = await temporaryRoot();
  gitCommand(root, ['init', '--quiet']);
  gitCommand(root, ['config', 'user.name', 'Kovo test']);
  gitCommand(root, ['config', 'user.email', 'kovo-test@invalid.example']);
  for (const file of BOUND) {
    const target = path.join(root, file);
    mkdirSyncParent(target);
    copyFileSync(path.join(projectRoot, file), target);
  }
  writeFileSync(path.join(root, '.git/info/exclude'), 'node_modules\n');
  const dependencyRoot = path.join(root, 'node_modules');
  mkdirSync(dependencyRoot);
  symlinkSync(
    await realpath(path.join(projectRoot, 'node_modules/playwright')),
    path.join(dependencyRoot, 'playwright'),
    'dir',
  );
  gitCommand(root, ['add', '--', ...BOUND]);
  gitCommand(root, ['commit', '--quiet', '-m', 'controller']);
  return root;
}

async function realCandidateRepository() {
  const root = await temporaryRoot();
  const repository = path.join(root, 'repository');
  const baseline = path.join(root, 'baseline');
  mkdirSync(repository);
  gitCommand(repository, ['init', '--quiet']);
  gitCommand(repository, ['config', 'user.name', 'Kovo test']);
  gitCommand(repository, ['config', 'user.email', 'kovo-test@invalid.example']);
  writeFileSync(path.join(repository, 'one.ts'), 'export const one = 1;\n');
  writeFileSync(path.join(repository, 'two.ts'), 'export const two = 2;\n');
  gitCommand(repository, ['add', '.']);
  gitCommand(repository, ['commit', '--quiet', '-m', 'base']);
  const parent = gitText(repository, ['rev-parse', 'HEAD']);
  const parentTree = gitText(repository, ['rev-parse', 'HEAD^{tree}']);
  gitCommand(repository, ['checkout', '--quiet', '-b', 'candidate']);

  writeFileSync(path.join(repository, 'one.ts'), 'export const one = 11;\n');
  gitCommand(repository, ['add', 'one.ts']);
  gitCommand(repository, ['commit', '--quiet', '-m', 'candidate one']);
  const firstCommit = gitText(repository, ['rev-parse', 'HEAD']);
  const firstTree = gitText(repository, ['rev-parse', 'HEAD^{tree}']);

  writeFileSync(path.join(repository, 'two.ts'), 'export const two = 22;\n');
  gitCommand(repository, ['add', 'two.ts']);
  gitCommand(repository, ['commit', '--quiet', '-m', 'candidate two']);
  const secondCommit = gitText(repository, ['rev-parse', 'HEAD']);
  const secondTree = gitText(repository, ['rev-parse', 'HEAD^{tree}']);

  writeFileSync(path.join(repository, 'one.ts'), 'export const one = 111;\n');
  gitCommand(repository, ['add', 'one.ts']);
  gitCommand(repository, ['commit', '--quiet', '-m', 'candidate three']);
  const commit = gitText(repository, ['rev-parse', 'HEAD']);
  const tree = gitText(repository, ['rev-parse', 'HEAD^{tree}']);
  gitCommand(repository, ['worktree', 'add', '--quiet', '--detach', baseline, parent]);

  return {
    baseline: await realpath(baseline),
    candidate: {
      commit,
      parent,
      parentTree,
      paths: ['one.ts', 'two.ts'],
      ref: 'refs/heads/candidate',
      series: [
        { commit: firstCommit, parent, tree: firstTree },
        { commit: secondCommit, parent: firstCommit, tree: secondTree },
        { commit, parent: secondCommit, tree },
      ],
      tree,
    },
    repository: await realpath(repository),
  };
}

function gitCommand(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitText(cwd, args) {
  return String(gitCommand(cwd, args)).trim();
}

async function sourceFixture() {
  const root = await temporaryRoot();
  await Promise.all(
    BOUND.map(async (file) => {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(
        target,
        file === 'package.json'
          ? `${JSON.stringify({ packageManager: 'pnpm@10.15.1' })}\n`
          : `${file}\n`,
      );
    }),
  );
  await mkdir(path.join(root, 'node_modules'));
  const head = path.join(root, '.head-guard');
  const headLog = path.join(root, '.head-log-guard');
  await Promise.all([writeFile(head, 'ref: refs/heads/test\n'), writeFile(headLog, 'log\n')]);
  const committed = Object.fromEntries(
    await Promise.all(BOUND.map(async (file) => [file, await readFile(path.join(root, file))])),
  );
  const blobs = Object.fromEntries(
    BOUND.map((file) => [file, createHash('sha1').update(file).digest('hex')]),
  );
  return {
    blobs,
    commit: 'a'.repeat(40),
    committed,
    head,
    headLog,
    root,
    tree: 'b'.repeat(40),
  };
}

function gitDependencies(fixture, { calls = [] } = {}) {
  const filesByBlob = Object.fromEntries(
    Object.entries(fixture.blobs).map(([file, blob]) => [blob, fixture.committed[file]]),
  );
  return {
    calls,
    gitBytes(_root, args) {
      return Buffer.from(filesByBlob[args.at(-1)]);
    },
    gitText(_root, args) {
      calls.push(args);
      const request = args.at(-1);
      if (args[0] === 'symbolic-ref') throw new Error('detached test HEAD');
      if (request === 'HEAD^{commit}') return fixture.commit;
      if (request === `${fixture.commit}^{tree}`) return fixture.tree;
      if (request === 'HEAD') return fixture.head;
      if (request === 'logs/HEAD') return fixture.headLog;
      if (request === '--untracked-files=all') return '';
      const separator = request.indexOf(':');
      if (request.startsWith(`${fixture.commit}:`) && separator > 0) {
        return fixture.blobs[request.slice(separator + 1)];
      }
      throw new Error(`unexpected git request: ${args.join(' ')}`);
    },
    pnpmVersion: '10.15.1',
  };
}

function mkdirSyncParent(file) {
  mkdirSync(path.dirname(file), { recursive: true });
}

async function temporaryRoot() {
  const declared = await mkdtemp(path.join(os.tmpdir(), 'kovo-ready-bootstrap-test-'));
  const root = await realpath(declared);
  roots.push(root);
  return root;
}
