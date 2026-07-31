import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addPostgresParanoidFollowup8Shapes,
  addPostgresParanoidPhase5DogfoodProof,
  formatGeneratedProjectSources,
} from './index.build.test-support.js';
import { writeKovoProject } from './index.js';
import {
  installStarterAppDependencies,
  resolveStarterInstallMode,
  stopProcess,
} from './index.test-support.js';

describe('create-kovo starter test support', () => {
  it('keeps local source fixtures linked unless CI supplies the same-run packed build', () => {
    expect(resolveStarterInstallMode('symlink', {})).toBe('symlink');
    expect(
      resolveStarterInstallMode('symlink', {
        KOVO_PACKED_PACKAGES_DIR: '/tmp/current-kovo-packages',
        KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'packed-current',
      }),
    ).toBe('packed');
  });

  it('moves link-local source fixtures onto current dist while preserving packed contracts', () => {
    const environment = {
      KOVO_PACKED_PACKAGES_DIR: '/tmp/current-kovo-packages',
      KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'packed-current',
    };
    expect(resolveStarterInstallMode('link-local', environment)).toBe('packed');
    expect(resolveStarterInstallMode('packed', environment)).toBe('packed');
  });

  it('fails closed on an absent same-run artifact or unknown CI posture', () => {
    expect(() =>
      resolveStarterInstallMode('symlink', {
        KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'packed-current',
      }),
    ).toThrow(/require KOVO_PACKED_PACKAGES_DIR/u);
    expect(() =>
      resolveStarterInstallMode('symlink', {
        KOVO_PACKED_PACKAGES_DIR: '/tmp/current-kovo-packages',
        KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'source-ish',
      }),
    ).toThrow(/must be "packed-current"/u);
  });

  it.each([
    ['missing manifest', undefined],
    [
      'invalid manifest',
      `${JSON.stringify({
        generatedBy: 'scripts/ci-shards.mjs pack-starter',
        tarballs: {},
      })}\n`,
    ],
  ])('does not delete or repack a packed-current artifact with a %s', (_label, manifest) => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-packed-current-failure-'));
    const artifact = join(root, 'artifact');
    mkdirSync(artifact);
    writeFileSync(join(artifact, 'download-marker.txt'), 'same-run artifact\n', 'utf8');
    if (manifest !== undefined) {
      writeFileSync(join(artifact, 'packed-kovo-packages.json'), manifest, 'utf8');
    }
    const before = readdirSync(artifact).toSorted();
    const previousDirectory = process.env.KOVO_PACKED_PACKAGES_DIR;
    const previousPosture = process.env.KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES;
    process.env.KOVO_PACKED_PACKAGES_DIR = artifact;
    process.env.KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES = 'packed-current';

    try {
      expect(() => installStarterAppDependencies(join(root, 'app'), 'symlink')).toThrow(
        /require a valid packed-kovo-packages\.json.+refusing to modify or repack/u,
      );
      expect(readdirSync(artifact).toSorted()).toEqual(before);
    } finally {
      restoreEnvironment('KOVO_PACKED_PACKAGES_DIR', previousDirectory);
      restoreEnvironment('KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES', previousPosture);
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('formats generated sources without evaluating the fixture Vite plugin graph', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-pinned-fixture-formatter-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'vite.config.ts'),
      [
        'export default {',
        '  fmt: {',
        '    semi: true,',
        '    singleQuote: true,',
        '    sortPackageJson: true,',
        '  },',
        '};',
        "throw new Error('fixture Vite config must not be evaluated by its formatter');",
        '',
      ].join('\n'),
      'utf8',
    );
    const fixturePath = join(root, 'src/fixture.ts');
    writeFileSync(fixturePath, 'export const fixture={label:"value"}\n', 'utf8');

    try {
      formatGeneratedProjectSources(root, ['src/fixture.ts']);

      expect(readFileSync(fixturePath, 'utf8')).toBe(
        "export const fixture = { label: 'value' };\n",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('composes the formatted Postgres paranoid fixture with its followup shapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-paranoid-followup-'));

    try {
      writeKovoProject(root, {
        dialect: 'postgres',
        name: 'Paranoid Followup Fixture',
      });
      addPostgresParanoidPhase5DogfoodProof(root);

      expect(() => addPostgresParanoidFollowup8Shapes(root)).not.toThrow();
      expect(readFileSync(join(root, 'src/paranoid-phase5-postgres-proof.ts'), 'utf8')).toContain(
        'export const phase5PgReferenceMembershipEndpoint',
      );
      expect(readFileSync(join(root, 'src/app.tsx'), 'utf8')).toContain(
        'phase5PgReferenceMembershipEndpoint',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'treats an already signaled process as terminal without waiting for a past exit event',
    async () => {
      const child = spawn(process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')"], {
        detached: true,
      });
      await waitForChildExit(child);

      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBe('SIGTERM');
      const startedAt = Date.now();
      await stopProcess(child);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'waits for the process group to exit after escalating an ignored SIGTERM to SIGKILL',
    async () => {
      const child = spawn(
        process.execPath,
        [
          '-e',
          [
            "process.on('SIGTERM', () => {});",
            "process.stdout.write('ready\\n');",
            'setInterval(() => {}, 1_000);',
          ].join(''),
        ],
        { detached: true },
      );

      try {
        await waitForChildOutput(child, 'ready\n');
        await stopProcess(child);
        expect(child.exitCode).toBeNull();
        expect(child.signalCode).toBe('SIGKILL');
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          process.kill(-child.pid!, 'SIGKILL');
          await waitForChildExit(child);
        }
      }
    },
    15_000,
  );
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function waitForChildExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
}

async function waitForChildOutput(
  child: ChildProcessWithoutNullStreams,
  expected: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}`)), 5_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (!output.includes(expected)) return;
      clearTimeout(timer);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Child exited before emitting ${expected}: code=${String(code)} signal=${String(signal)}`,
        ),
      );
    });
  });
}
