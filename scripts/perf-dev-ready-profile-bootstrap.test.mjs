import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authenticateReadyProfileControllerSource,
  DEV_READY_PROFILE_CONTROLLER_BINDING_SCHEMA,
  materializeReadyProfileController,
  readBootstrapStableFile,
} from './perf-dev-ready-profile-bootstrap.mjs';

const roots = [];
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
  'scripts/lib/cli-entry.mjs',
  'scripts/lib/perf-dev-session-evidence.mjs',
  'scripts/lib/perf-execution.mjs',
  'scripts/lib/perf-host.mjs',
  'scripts/lib/perf-packed-kovo-product.mjs',
  'scripts/lib/perf-provenance.mjs',
  'scripts/lib/perf-ready-route.mjs',
  'scripts/lib/process-tree-rss.mjs',
  'scripts/perf-dev-edit-profile.mjs',
  'scripts/perf-dev-generation-spike.mjs',
  'scripts/perf-dev-ready-profile-bootstrap.mjs',
  'scripts/perf-dev-ready-profile.mjs',
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
