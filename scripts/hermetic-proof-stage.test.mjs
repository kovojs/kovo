import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertHermeticDockerArgs,
  forceRemoveDockerContainerEventually,
  hermeticDockerStageContainerName,
  readHermeticProofManifest,
  validateHermeticProofContract,
} from './hermetic-proof-stage.mjs';

describe('hermetic proof stage', () => {
  it('closes a delayed Docker cidfile race before interrupted-stage cleanup returns', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-hermetic-cid-race-'));
    const cidFile = path.join(root, 'analysis.cid');
    const containerId = 'a'.repeat(64);
    const containerName = hermeticDockerStageContainerName(root, 'analysis');
    const removals = [];
    try {
      writeFileSync(cidFile, '');
      setTimeout(() => writeFileSync(cidFile, containerId.slice(0, 16)), 10);
      setTimeout(() => writeFileSync(cidFile, `${containerId}\n`), 30);
      await forceRemoveDockerContainerEventually('/usr/bin/docker', cidFile, {
        containerName,
        execFileSync(file, args, options) {
          if (args[2] === containerName) {
            const error = new Error('No such container');
            error.stderr = 'No such container';
            throw error;
          }
          removals.push({ args, file, timeout: options.timeout });
        },
        pollIntervalMs: 5,
        timeoutMs: 250,
      });
      expect(readFileSync(cidFile, 'utf8').trim()).toBe(containerId);
      expect(removals).toEqual([
        {
          args: ['rm', '--force', containerId],
          file: '/usr/bin/docker',
          timeout: expect.any(Number),
        },
      ]);
      expect(removals[0].timeout).toBeLessThanOrEqual(250);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('removes an abnormal container by its preassigned name without a cidfile', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-hermetic-known-name-'));
    const cidFile = path.join(root, 'analysis.cid');
    const containerName = hermeticDockerStageContainerName(root, 'analysis');
    const removals = [];
    try {
      await forceRemoveDockerContainerEventually('/usr/bin/docker', cidFile, {
        containerName,
        execFileSync(file, args) {
          removals.push({ args, file });
        },
        timeoutMs: 250,
      });
      expect(removals).toEqual([
        { args: ['rm', '--force', containerName], file: '/usr/bin/docker' },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('pins the three-stage isolation contract', () => {
    const manifest = readHermeticProofManifest();
    expect(manifest.toolingBinding).toBe('kovo-certificate-v1-signed');
    const packageJson = {
      scripts: {
        'check:hermetic-proof-stage':
          'node scripts/security-cost-budget-runner.mjs --gate hermetic-proof-stage',
      },
    };
    const costManifest = {
      schema: 'kovo.plan3-security-gate-budgets/v1',
      gates: [
        {
          ciJob: 'hermetic-proof',
          entrypoint: 'pnpm run check:hermetic-proof-stage',
          id: 'hermetic-proof-stage',
          isolatedMemory: {
            ceilingMiB: manifest.linuxRunner.memoryMiB,
            combinedCeilingMiB: 4096,
            kind: 'docker-cgroup',
          },
          peakRssCeilingMiB: 4096 - manifest.linuxRunner.memoryMiB,
          steps: [{ command: ['node', 'scripts/hermetic-proof-stage.mjs'] }],
        },
      ],
    };
    const workflow = `hermetic-proof:\n    needs: publish-readiness\nname: Hermetic certificate proof stage\nvp install --frozen-lockfile --ignore-scripts\nname: kovo-package-dist\nkovo-package-dist.tgz\n${manifest.linuxRunner.image}\nvp exec pnpm run check:hermetic-proof-stage\n      - hermetic-proof`;
    expect(
      validateHermeticProofContract({
        costManifest,
        manifest,
        packageJson,
        workflow,
      }),
    ).toEqual([]);

    const widened = structuredClone(manifest);
    widened.stages[0].reads.push('app dependency closure');
    expect(
      validateHermeticProofContract({ costManifest, manifest: widened, packageJson, workflow }),
    ).toContain('analysis does not match the exact reviewed stage contract');

    const unbound = structuredClone(manifest);
    unbound.toolingBinding = 'sandbox-self-test-unbound';
    expect(
      validateHermeticProofContract({ costManifest, manifest: unbound, packageJson, workflow }),
    ).toContain(
      'hermetic proof tooling must be bound to kovo.certificate/v1 analysis, generation, and signing',
    );

    expect(
      validateHermeticProofContract({
        costManifest,
        manifest,
        packageJson,
        workflow: workflow.replace(' --ignore-scripts', ''),
      }),
    ).toContain('CI must install the proof toolchain without lifecycle scripts');

    const substitutedTool = structuredClone(manifest);
    substitutedTool.tooling.signing.sourceTreeSha256 = '0'.repeat(64);
    expect(
      validateHermeticProofContract({
        costManifest,
        manifest: substitutedTool,
        packageJson,
        workflow,
      }),
    ).toContain('hermetic proof tooling identities differ from the exact sealed source closures');

    const divertedCostManifest = structuredClone(costManifest);
    divertedCostManifest.gates[0].steps[0].command = ['node', 'scripts/no-op.mjs'];
    expect(
      validateHermeticProofContract({
        costManifest: divertedCostManifest,
        manifest,
        packageJson,
        workflow,
      }),
    ).toContain('Plan 3 cost manifest must wrap the exact hermetic proof worker command');
  });

  it('kills network, lifecycle, mount-source, mount-destination, and mount-mode weakenings', () => {
    const root = '/proof-stage';
    const context = {
      gid: 1000,
      memoryMiB: 3072,
      memorySwapMiB: 3072,
      port: 31_337,
      root,
      uid: 1000,
    };
    const image = readHermeticProofManifest().linuxRunner.image;
    const analysisName = hermeticDockerStageContainerName(root, 'analysis');
    const generationName = hermeticDockerStageContainerName(root, 'certificate-generation');
    const signingName = hermeticDockerStageContainerName(root, 'signing');
    const common = [
      `KOVO_HERMETIC_STAGE_ROOT=${root}`,
      'run',
      '--rm',
      '--memory=3072m',
      '--memory-swap=3072m',
      '--pull=never',
      '--network=none',
      '--add-host=kovo-network-canary:host-gateway',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
      '--user=1000:1000',
      '--entrypoint=/usr/local/bin/node',
      '--env=KOVO_HERMETIC_NETWORK_CANARY=kovo-network-canary:31337',
    ];
    const analysis = [
      ...common,
      `--cidfile=${root}/analysis.cid`,
      `--name=${analysisName}`,
      `--mount=type=bind,src=${root}/sealed-analysis,dst=/sealed,readonly`,
      `--mount=type=bind,src=${root}/subject,dst=/subject,readonly`,
      `--mount=type=bind,src=${root}/analysis,dst=/analysis`,
      image,
      '--preserve-symlinks',
      '--preserve-symlinks-main',
      '--permission',
      '--allow-fs-read=/sealed',
      '--allow-fs-read=/subject',
      '--allow-fs-write=/analysis',
      '/sealed/scripts/hermetic-proof-stage-worker.mjs',
      'analyze',
      '/subject/subject.json',
      '/analysis/analysis.json',
      '/key/key.pkcs8',
      '/app/node_modules/untrusted-app/canary',
    ];
    const signing = [
      ...common,
      `--cidfile=${root}/signing.cid`,
      `--name=${signingName}`,
      `--mount=type=bind,src=${root}/sealed-signing,dst=/sealed,readonly`,
      `--mount=type=bind,src=${root}/unsigned,dst=/unsigned,readonly`,
      `--mount=type=bind,src=${root}/signing,dst=/key,readonly`,
      `--mount=type=bind,src=${root}/signature,dst=/signature`,
      image,
      '--preserve-symlinks',
      '--preserve-symlinks-main',
      '--permission',
      '--allow-fs-read=/sealed',
      '--allow-fs-read=/unsigned',
      '--allow-fs-read=/key',
      '--allow-fs-write=/signature',
      '/sealed/scripts/hermetic-proof-stage-worker.mjs',
      'sign',
      '/unsigned/certificate.json',
      '/key/key.pkcs8',
      '/signature/signature.json',
      '/repo/package.json',
      '/app/node_modules/untrusted-app/canary',
    ];

    const generation = [
      ...common,
      `--cidfile=${root}/certificate-generation.cid`,
      `--name=${generationName}`,
      `--mount=type=bind,src=${root}/sealed-generation,dst=/sealed,readonly`,
      `--mount=type=bind,src=${root}/analysis,dst=/analysis,readonly`,
      `--mount=type=bind,src=${root}/subject,dst=/subject,readonly`,
      `--mount=type=bind,src=${root}/unsigned,dst=/unsigned`,
      image,
      '--preserve-symlinks',
      '--preserve-symlinks-main',
      '--permission',
      '--allow-fs-read=/sealed',
      '--allow-fs-read=/analysis',
      '--allow-fs-read=/subject',
      '--allow-fs-write=/unsigned',
      '/sealed/scripts/hermetic-proof-stage-worker.mjs',
      'generate',
      '/analysis/analysis.json',
      '/subject/kovo-certificate-policy-v1.json',
      '/unsigned/certificate.json',
      '/key/key.pkcs8',
      '/app/node_modules/untrusted-app/canary',
    ];

    expect(() => assertHermeticDockerArgs(analysis, 'analysis', context)).not.toThrow();
    expect(() =>
      assertHermeticDockerArgs(generation, 'certificate-generation', context),
    ).not.toThrow();
    expect(() => assertHermeticDockerArgs(signing, 'signing', context)).not.toThrow();
    expect(() =>
      assertHermeticDockerArgs(
        analysis.filter((arg) => arg !== '--network=none'),
        'analysis',
        context,
      ),
    ).toThrow(/vector/u);
    expect(() =>
      assertHermeticDockerArgs([...analysis, '--allow-child-process'], 'analysis', context),
    ).toThrow(/lifecycle/u);
    expect(() =>
      assertHermeticDockerArgs(
        generation.filter((arg) => arg !== '--allow-fs-read=/subject'),
        'certificate-generation',
        context,
      ),
    ).toThrow(/vector/u);
    expect(() =>
      assertHermeticDockerArgs(
        analysis.map((arg) => arg.replace(`${root}/subject`, '/host/app/node_modules')),
        'analysis',
        context,
      ),
    ).toThrow(/vector/u);
    expect(() =>
      assertHermeticDockerArgs(
        signing.map((arg) => arg.replace('dst=/sealed', 'dst=/subject/deps')),
        'signing',
        context,
      ),
    ).toThrow(/vector/u);
    expect(() =>
      assertHermeticDockerArgs(
        signing.map((arg) => arg.replace('dst=/key,readonly', 'dst=/key')),
        'signing',
        context,
      ),
    ).toThrow(/vector/u);
    for (const option of [
      '--network=host',
      '--privileged',
      '--volumes-from=app-graph',
      '--user=0:0',
      '--cap-add=ALL',
    ]) {
      expect(() => assertHermeticDockerArgs([...analysis, option], 'analysis', context)).toThrow(
        /vector/u,
      );
    }
  });
});
