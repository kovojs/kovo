import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

function installedKovoPackage(root: string, store: string, name: string, version: string): void {
  const path = join(
    root,
    'node_modules/.pnpm',
    store,
    'node_modules/@kovojs',
    name.slice('@kovojs/'.length),
  );
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version }));
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
