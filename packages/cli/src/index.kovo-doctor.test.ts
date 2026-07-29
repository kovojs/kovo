import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { doctorHost } from './commands/doctor.js';
import { mainAsync } from './index.js';

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('kovo doctor', () => {
  it('checks the complete local-coherence inventory and supports every shared format', async () => {
    const root = healthyFixture();
    vi.spyOn(doctorHost, 'execFileSync').mockReturnValue('10.12.1\n');

    const human = await capture(root, ['doctor']);
    expect(human.exitCode).toBe(0);
    expect(human.stderr).toBe('');
    expect(human.stdout).toContain('kovo-doctor/v1\n');
    for (const id of [
      'node',
      'package-manager',
      'packages',
      'config',
      'origin',
      'secret',
      'database',
      'migrations',
      'retention',
      'writable',
      'cache',
    ]) {
      expect(human.stdout).toContain(`PASS ${id}`);
    }

    const json = await capture(root, ['doctor', '--format', 'json']);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      diagnostics: [],
      result: {
        command: 'doctor',
        exitCode: 0,
        protocol: 'kovo-doctor/v1',
        text: expect.stringMatching(/^kovo-doctor\/v1\n/u),
      },
      version: 'kovo-diagnostic/v1',
    });

    const github = await capture(root, ['doctor', '--format', 'github']);
    expect(github.exitCode).toBe(0);
    expect(github.stderr).toBe('');
    expect(github.stdout).toMatch(/^kovo-doctor\/v1\n/u);
  });

  it('projects producer-owned doctor facts identically to JSON and GitHub adapters', async () => {
    const root = healthyFixture({
      engines: { node: '>=999.0.0' },
    });
    vi.spyOn(doctorHost, 'execFileSync').mockReturnValue('10.12.1\n');

    const human = await capture(root, ['doctor']);
    const json = await capture(root, ['doctor', '--format=json']);
    const github = await capture(root, ['doctor', '--format', 'github']);

    expect(human.exitCode).toBe(1);
    expect(human.stderr).toContain('ERROR node cause=');
    expect(human.stderr).toContain('does not satisfy');

    const envelope = JSON.parse(json.stderr) as {
      diagnostics: { code: string; help: string; message: string; source: object }[];
      version: string;
    };
    expect(envelope.version).toBe('kovo-diagnostic/v1');
    expect(envelope.diagnostics).toEqual([
      expect.objectContaining({
        code: 'KOVO_DOCTOR_NODE',
        help: 'Install the Node version required by package.json and rerun `kovo doctor`.',
        message: expect.stringContaining('does not satisfy'),
        source: expect.objectContaining({ file: 'package.json' }),
      }),
    ]);
    expect(github.stderr).toContain('::error file=package.json,title=KOVO_DOCTOR_NODE config');
    expect(github.stderr).toContain(envelope.diagnostics[0]!.message);
  });

  it('detects duplicate Kovo copies and never prints database credentials', async () => {
    const root = healthyFixture({ dependencies: { pg: '8.22.0' } });
    installedKovoPackage(root, 'one', '@kovojs/core', '0.2.0');
    installedKovoPackage(root, 'two', '@kovojs/core', '0.3.0');
    vi.spyOn(doctorHost, 'execFileSync').mockReturnValue('10.12.1\n');

    const result = await capture(root, ['doctor'], {
      KOVO_DB_SYSTEM_URL: 'postgres://system:SECRET_SYSTEM@db.example/app',
      KOVO_RUNTIME_DATABASE_URL: 'postgres://runtime:SECRET_RUNTIME@db.example/app',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ERROR packages cause=');
    const json = await capture(root, ['doctor', '--format', 'json'], {
      KOVO_DB_SYSTEM_URL: 'postgres://system:SECRET_SYSTEM@db.example/app',
      KOVO_RUNTIME_DATABASE_URL: 'postgres://runtime:SECRET_RUNTIME@db.example/app',
    });
    expect(json.stderr).toContain('KOVO_DOCTOR_DUPLICATE_PACKAGE');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('SECRET_SYSTEM');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('SECRET_RUNTIME');
  });

  it('fails each package, config, origin, database, migration, retention, and path axis closed', async () => {
    const cases: readonly {
      readonly code: string;
      readonly env?: NodeJS.ProcessEnv;
      readonly mutate: (root: string) => void;
    }[] = [
      {
        code: 'KOVO_DOCTOR_PACKAGE_MANAGER',
        mutate() {
          vi.spyOn(doctorHost, 'execFileSync').mockReturnValue('9.0.0\n');
        },
      },
      {
        code: 'KOVO_DOCTOR_PEER',
        mutate(root) {
          installedKovoPackage(root, 'core', '@kovojs/core', '0.2.0');
          installedKovoPackage(root, 'server', '@kovojs/server', '0.2.0', {
            peerDependencies: { '@kovojs/core': '^0.3.0' },
          });
        },
      },
      {
        code: 'KOVO_DOCTOR_CONFIG',
        mutate(root) {
          rmSync(join(root, 'kovo.config.ts'));
        },
      },
      {
        code: 'KOVO_DOCTOR_ORIGIN',
        env: { KOVO_ORIGIN: 'http://deploy.example.com' },
        mutate() {},
      },
      {
        code: 'KOVO_DOCTOR_SECRET',
        mutate(root) {
          updateManifest(root, { dependencies: { '@kovojs/better-auth': '0.1.0' } });
        },
      },
      {
        code: 'KOVO_DOCTOR_DATABASE',
        mutate(root) {
          updateManifest(root, { dependencies: { pg: '8.22.0' } });
        },
      },
      {
        code: 'KOVO_DOCTOR_MIGRATIONS',
        mutate(root) {
          rmSync(join(root, 'drizzle'), { recursive: true });
        },
      },
      {
        code: 'KOVO_DOCTOR_RETENTION',
        mutate(root) {
          writeFileSync(join(root, 'src/app.tsx'), 'export const app = island(Component);\n');
        },
      },
      {
        code: 'KOVO_DOCTOR_WRITABLE',
        mutate() {
          vi.spyOn(doctorHost, 'accessSync').mockImplementation(() => {
            throw new Error('read-only fixture');
          });
        },
      },
    ];

    for (const testCase of cases) {
      vi.restoreAllMocks();
      const root = healthyFixture();
      vi.spyOn(doctorHost, 'execFileSync').mockReturnValue('10.12.1\n');
      testCase.mutate(root);
      const result = await capture(root, ['doctor', '--format', 'json'], testCase.env);
      expect(result.exitCode, testCase.code).toBe(1);
      const envelope = JSON.parse(result.stderr) as {
        readonly diagnostics: readonly {
          readonly code: string;
          readonly help?: string;
          readonly message: string;
          readonly source?: { readonly end: number; readonly file: string; readonly start: number };
          readonly version: string;
        }[];
        readonly version: string;
      };
      const diagnostic = envelope.diagnostics.find((entry) => entry.code === testCase.code);
      expect(diagnostic, testCase.code).toEqual(expect.objectContaining({ code: testCase.code }));
      if (
        [
          'KOVO_DOCTOR_DATABASE',
          'KOVO_DOCTOR_MIGRATIONS',
          'KOVO_DOCTOR_ORIGIN',
          'KOVO_DOCTOR_RETENTION',
          'KOVO_DOCTOR_SECRET',
        ].includes(testCase.code)
      ) {
        expect(diagnostic, testCase.code).toEqual(
          expect.objectContaining({
            help: expect.stringMatching(/`(?:kovo|pnpm) /u),
            message: expect.stringMatching(/\S/u),
            source: expect.objectContaining({
              end: expect.any(Number),
              file: expect.stringMatching(/\S/u),
              start: expect.any(Number),
            }),
            version: 'kovo-diagnostic/v1',
          }),
        );
      }
      expect(envelope.version, testCase.code).toBe('kovo-diagnostic/v1');
    }
  });

  it('repairs only a stale real cache and reports the fix as completed', async () => {
    const root = healthyFixture();
    const cache = join(root, '.kovo/cache');
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, 'tsc-preflight.tsbuildinfo'), 'derived');
    const old = new Date(1_000);
    utimesSync(cache, old, old);
    utimesSync(join(cache, 'tsc-preflight.tsbuildinfo'), old, old);
    writeFileSync(join(root, 'src/app.tsx'), 'export const current = true;\n');
    vi.spyOn(doctorHost, 'execFileSync').mockReturnValue('10.12.1\n');

    const before = await capture(root, ['doctor']);
    expect(before.exitCode).toBe(1);
    expect(before.stderr).toContain('ERROR cache cause=');
    expect(existsSync(cache)).toBe(true);

    const fixed = await capture(root, ['doctor', '--fix']);
    expect(fixed.exitCode).toBe(0);
    expect(fixed.stdout).toContain('FIX cache removed=.kovo/cache');
    expect(existsSync(cache)).toBe(false);
  });

  it('refuses to follow a cache symlink during safe repair', async () => {
    const root = healthyFixture();
    const external = mkdtempSync(join(tmpdir(), 'kovo-doctor-external-cache-'));
    roots.push(external);
    mkdirSync(join(root, '.kovo'), { recursive: true });
    writeFileSync(join(external, 'sentinel'), 'must survive');
    symlinkSync(external, join(root, '.kovo/cache'), 'dir');
    vi.spyOn(doctorHost, 'execFileSync').mockReturnValue('10.12.1\n');

    const result = await capture(root, ['doctor', '--fix']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ERROR cache cause=');
    expect(result.stderr).toContain('will not be repaired');
    expect(existsSync(join(external, 'sentinel'))).toBe(true);
  });
});

function healthyFixture(overrides: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'kovo-doctor-'));
  roots.push(root);
  mkdirSync(join(root, 'drizzle'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/app.tsx'), 'export const app = true;\n');
  writeFileSync(
    join(root, 'kovo.config.ts'),
    "import { node } from '@kovojs/server/build';\nexport default { preset: node() };\n",
  );
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        dependencies: { '@electric-sql/pglite': '0.5.1' },
        engines: { node: '>=22.15.0' },
        packageManager: 'pnpm@10.12.1',
        ...overrides,
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function installedKovoPackage(
  root: string,
  store: string,
  name: string,
  version: string,
  manifest: Record<string, unknown> = {},
): void {
  const path = join(
    root,
    'node_modules/.pnpm',
    store,
    'node_modules/@kovojs',
    name.slice('@kovojs/'.length),
  );
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version, ...manifest }));
}

function updateManifest(root: string, patch: Record<string, unknown>): void {
  const path = join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  writeFileSync(path, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`);
}

async function capture(
  root: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let stdout = '';
  let stderr = '';
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write);
  try {
    const exitCode = await mainAsync(args, {
      invocationCwd: root,
      invocationEnv: env,
      paranoidStaticAdvisory: false,
    });
    return { exitCode, stderr, stdout };
  } finally {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  }
}
