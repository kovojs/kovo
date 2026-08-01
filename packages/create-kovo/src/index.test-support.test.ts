import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  addPostgresParanoidFollowup8Shapes,
  addPostgresParanoidPhase5DogfoodProof,
  addRuntimeMutationSafetyProofs,
  formatGeneratedProjectSources,
} from './index.build.test-support.js';
import { writeKovoProject } from './index.js';
import { testProcessCensusArguments } from './index.test-process-supervisor.mjs';
import {
  GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS,
  GENERATED_STARTER_CLI_SIGNAL_GRACE_MS,
  generatedStarterTestTimeout,
  installStarterAppDependencies,
  resolveStarterInstallMode,
  runGeneratedStarterCommand,
  runGeneratedStarterFixtureSetupCommandForTest,
  STARTER_SERVER_READY_TIMEOUT_MS,
  stopProcess,
} from './index.test-support.js';

const soundSubsetScript = fileURLToPath(
  new URL('../../cli/src/commands/sound-subset.mjs', import.meta.url),
);
const repoNodeModules = fileURLToPath(new URL('../../../node_modules', import.meta.url));

describe('create-kovo starter test support', () => {
  it.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')(
    'uses one finite process-census command accepted by the supported host ps',
    () => {
      const args = testProcessCensusArguments();
      expect(args).toEqual(['eww', '-A', '-o', 'pid=,ppid=,pgid=,stat=,command=']);

      const census = spawnSync('ps', args, {
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 32 * 1024 * 1024,
      });
      expect(census.status, census.stderr).toBe(0);
      expect(census.stdout).toMatch(/^\s*\d+\s+\d+\s+\d+\s+\S+\s+/mu);
    },
  );

  it('keeps Vitest outside every generated-starter child and cleanup deadline', () => {
    const oneCli = generatedStarterTestTimeout({ cliProcessCount: 1 });
    const twoCli = generatedStarterTestTimeout({ cliProcessCount: 2 });
    const oneCliAndServer = generatedStarterTestTimeout({
      cliProcessCount: 1,
      serverProcessCount: 1,
    });
    const cleanupWindowMs = GENERATED_STARTER_CLI_SIGNAL_GRACE_MS * 4;

    expect(oneCli).toBeGreaterThan(GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS + cleanupWindowMs);
    expect(twoCli - oneCli).toBe(GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS + cleanupWindowMs);
    expect(oneCliAndServer - oneCli).toBe(STARTER_SERVER_READY_TIMEOUT_MS + cleanupWindowMs);
  });

  it('preserves generated-starter command output on success and semantic failure', async () => {
    const success = await runGeneratedStarterCommand(
      process.execPath,
      ['-e', "process.stdout.write('proof-ok')"],
      { cwd: process.cwd(), timeoutMs: 5_000 },
    );
    expect(success).toEqual({ stderr: '', stdout: 'proof-ok' });

    await expect(
      runGeneratedStarterCommand(
        process.execPath,
        [
          '-e',
          "process.stdout.write('semantic-stdout'); process.stderr.write('semantic-stderr'); process.exit(7)",
        ],
        { cwd: process.cwd(), timeoutMs: 5_000 },
      ),
    ).rejects.toMatchObject({ stderr: 'semantic-stderr', stdout: 'semantic-stdout' });
  });

  it.skipIf(process.platform === 'win32')(
    'kills a timed-out generated-starter command and its descendant before rejecting',
    async () => {
      let descendantPid: number | undefined;
      try {
        await runGeneratedStarterCommand(
          process.execPath,
          [
            '-e',
            [
              "const { spawn } = require('node:child_process');",
              "const descendant = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { detached: true, stdio: 'ignore' });",
              'descendant.unref();',
              "process.on('SIGTERM', () => {});",
              "process.stdout.write(String(descendant.pid) + '\\n');",
              'setInterval(() => {}, 1000);',
            ].join(''),
          ],
          { cwd: process.cwd(), signalGraceMs: 100, timeoutMs: 1_000 },
        );
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Command timed out after 1000ms');
        const stdout = (error as { stdout?: unknown }).stdout;
        expect(typeof stdout).toBe('string');
        descendantPid = Number.parseInt(String(stdout).trim(), 10);
      }

      expect(descendantPid).toBeTypeOf('number');
      expect(Number.isSafeInteger(descendantPid)).toBe(true);
      expect(await processStopsWithin(descendantPid!, 1_000)).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'fails deterministically when combined generated-starter output exceeds its cap',
    async () => {
      await expect(
        runGeneratedStarterCommand(
          process.execPath,
          [
            '-e',
            [
              "process.on('SIGTERM', () => {});",
              "process.stdout.write('o'.repeat(800));",
              "process.stderr.write('e'.repeat(800));",
              'setInterval(() => {}, 1000);',
            ].join(''),
          ],
          {
            cwd: process.cwd(),
            maxOutputBytes: 1_024,
            signalGraceMs: 100,
            timeoutMs: 5_000,
          },
        ),
      ).rejects.toThrow(/Command output exceeded the 1024-byte combined limit/u);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'enforces fixture setup headroom through the descendant-aware supervisor',
    async () => {
      let descendantPid: number | undefined;
      const startedAt = Date.now();
      try {
        await runGeneratedStarterFixtureSetupCommandForTest(
          process.execPath,
          [
            '-e',
            [
              "const { spawn } = require('node:child_process');",
              "const descendant = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { detached: true, stdio: 'ignore' });",
              'descendant.unref();',
              "process.stdout.write(String(descendant.pid) + '\\n');",
              "process.on('SIGTERM', () => {});",
              'setInterval(() => {}, 1000);',
            ].join(''),
          ],
          { cwd: process.cwd(), signalGraceMs: 100, timeoutMs: 2_500 },
        );
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(
          /fixture setup command timed out.+inside its aggregate deadline/u,
        );
        descendantPid = Number.parseInt(String((error as { stdout?: unknown }).stdout).trim(), 10);
      }

      // Timer callbacks cannot run while a hosted shard is descheduled. Keep the assertion tight
      // enough to catch a second cleanup window while allowing bounded wall-clock scheduler jitter;
      // the supervisor seam separately exercises the single absolute cleanup-deadline path.
      expect(Date.now() - startedAt).toBeLessThan(3_000);
      expect(Number.isSafeInteger(descendantPid)).toBe(true);
      expect(await processStopsWithin(descendantPid!, 1_000)).toBe(true);
    },
  );

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
  ])('does not delete or repack a packed-current artifact with a %s', async (_label, manifest) => {
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
      await expect(installStarterAppDependencies(join(root, 'app'), 'symlink')).rejects.toThrow(
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

  it.each([
    { dialect: undefined, label: 'default' },
    { dialect: 'sqlite' as const, label: 'SQLite' },
  ])(
    'keeps the $label readonly-mutation proof inside the SPEC §6.6 sound subset',
    ({ dialect }) => {
      const root = mkdtempSync(join(tmpdir(), 'create-kovo-readonly-proof-sound-subset-'));

      try {
        writeKovoProject(root, {
          ...(dialect === undefined ? {} : { dialect }),
          name: 'Readonly Proof Sound Subset',
        });
        addRuntimeMutationSafetyProofs(root, { includeReadonlyMutationAttempt: true });

        const classifier = spawnSync(process.execPath, [soundSubsetScript], {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            KOVO_SOUND_SUBSET_FORMAT: 'json',
            NODE_PATH: repoNodeModules,
          },
        });
        const report = JSON.parse(classifier.stdout) as {
          readonly findings?: readonly unknown[];
          readonly version?: string;
        };
        expect(report).toEqual({ findings: [], version: 'kovo-sound-subset/v1' });
        expect(classifier.status, classifier.stderr).toBe(0);

        const proofSource = readFileSync(join(root, 'src/runtime-safety-proofs.ts'), 'utf8');
        expect(proofSource).toContain('const sqlMethod = readonlyProperty(readonlyDb, method);');
        expect(proofSource).not.toContain('readonlyDb as Record');
        expect(proofSource).not.toMatch(/\[method\]!/u);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

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

async function processStopsWithin(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      throw error;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
