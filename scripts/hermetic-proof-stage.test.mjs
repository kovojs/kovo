import { describe, expect, it } from 'vitest';

import {
  assertHermeticDockerArgs,
  readHermeticProofManifest,
  validateHermeticProofContract,
} from './hermetic-proof-stage.mjs';

describe('hermetic proof stage', () => {
  it('pins the three-stage isolation contract', () => {
    const manifest = readHermeticProofManifest();
    const packageJson = {
      scripts: { 'check:hermetic-proof-stage': 'node scripts/hermetic-proof-stage.mjs' },
    };
    const workflow = `name: Hermetic proof sandbox self-test\n${manifest.linuxRunner.image}\nvp exec node scripts/hermetic-proof-stage.mjs`;
    expect(
      validateHermeticProofContract({
        manifest,
        packageJson,
        workflow,
      }),
    ).toEqual([]);

    const widened = structuredClone(manifest);
    widened.stages[0].reads.push('app dependency closure');
    expect(validateHermeticProofContract({ manifest: widened, packageJson, workflow })).toContain(
      'analysis does not match the exact reviewed stage contract',
    );
  });

  it('kills network, lifecycle, mount-source, mount-destination, and mount-mode weakenings', () => {
    const root = '/proof-stage';
    const context = { gid: 1000, port: 31_337, root, uid: 1000 };
    const image = readHermeticProofManifest().linuxRunner.image;
    const common = [
      `KOVO_HERMETIC_STAGE_ROOT=${root}`,
      'run',
      '--rm',
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
      `--mount=type=bind,src=${root}/sealed,dst=/sealed,readonly`,
      `--mount=type=bind,src=${root}/subject,dst=/subject,readonly`,
      `--mount=type=bind,src=${root}/analysis,dst=/analysis`,
      image,
      '--permission',
      '--allow-fs-read=/sealed',
      '--allow-fs-read=/subject',
      '--allow-fs-write=/analysis',
      '/sealed/worker.mjs',
      'analyze',
      '/subject/subject.json',
      '/analysis/analysis.json',
      '/key/key.bin',
      '/app/node_modules/untrusted-app/canary',
    ];
    const signing = [
      ...common,
      `--mount=type=bind,src=${root}/sealed,dst=/sealed,readonly`,
      `--mount=type=bind,src=${root}/unsigned,dst=/unsigned,readonly`,
      `--mount=type=bind,src=${root}/signing,dst=/key,readonly`,
      `--mount=type=bind,src=${root}/signature,dst=/signature`,
      image,
      '--permission',
      '--allow-fs-read=/sealed',
      '--allow-fs-read=/unsigned',
      '--allow-fs-read=/key',
      '--allow-fs-write=/signature',
      '/sealed/worker.mjs',
      'sign',
      '/unsigned/certificate.json',
      '/key/key.bin',
      '/signature/signature.json',
      '/repo/package.json',
      '/app/node_modules/untrusted-app/canary',
    ];

    expect(() => assertHermeticDockerArgs(analysis, 'analysis', context)).not.toThrow();
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
