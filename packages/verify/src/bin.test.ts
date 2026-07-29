import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runKovoVerify } from './bin.js';
import { KOVO_CERTIFICATE_CAPABILITY_DOMAIN } from './index.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('kovo-verify CLI', () => {
  it('prints a stable success report and returns zero', async () => {
    const { artifactRoot, certificatePath, policyPath } = cliFixture();
    let stdout = '';
    let stderr = '';
    const exitCode = await runKovoVerify(
      [certificatePath, '--policy', policyPath, '--artifacts', artifactRoot],
      {
        stderr: (text) => (stderr += text),
        stdout: (text) => (stdout += text),
      },
    );
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toBe(
      'kovo-verify/v1 PASS artifacts=1 edges=0 roots=0 doors=0 opaque=0 capabilities=0 findings=0\n',
    );
  });

  it('prints help and the installed version to stdout with exit zero', async () => {
    const version = (
      JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version: string;
      }
    ).version;

    for (const flag of ['-h', '--help']) {
      const output = await runWithIo([flag]);
      expect(output.exitCode).toBe(0);
      expect(output.stderr).toBe('');
      expect(output.stdout).toContain('Usage:\n  kovo-verify <certificate.json>');
      expect(output.stdout).toContain('0  Certificate verified.');
      expect(output.stdout).toContain('2  Usage, I/O, or parse error');
    }

    await expect(runWithIo(['--version'])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `kovo-verify ${version}\n`,
    });
  });

  it('accepts every documented flag group in any order and emits versioned JSON', async () => {
    const fixture = cliFixture();
    const groups = [
      [fixture.certificatePath],
      ['--policy', fixture.policyPath],
      ['--artifacts', fixture.artifactRoot],
      ['--format', 'json'],
    ];

    for (const ordered of permutations(groups)) {
      const output = await runWithIo(ordered.flat());
      expect(output.exitCode).toBe(0);
      expect(output.stderr).toBe('');
      expect(JSON.parse(output.stdout)).toEqual({
        schema: 'kovo.verify-report/v1',
        status: 'verified',
        ok: true,
        stats: {
          artifacts: 1,
          capabilities: 0,
          doors: 0,
          edges: 0,
          opaque: 0,
          roots: 0,
        },
        findings: [],
      });
    }
  });

  it('renders the exact same findings in versioned human and JSON reports', async () => {
    const fixture = cliFixture({ source: "import 'node:fs';" });
    const args = [
      fixture.certificatePath,
      '--policy',
      fixture.policyPath,
      '--artifacts',
      fixture.artifactRoot,
    ];
    const human = await runWithIo([...args, '--format', 'human']);
    const json = await runWithIo([...args, '--format', 'json']);

    expect(human.exitCode).toBe(1);
    expect(json.exitCode).toBe(1);
    expect(human.stderr).toBe('');
    expect(json.stderr).toBe('');
    const payload = JSON.parse(json.stdout) as {
      findings: { code: string; message: string; obligation: string }[];
      schema: string;
      status: string;
    };
    expect(payload.schema).toBe('kovo.verify-report/v1');
    expect(payload.status).toBe('findings');
    expect(findingsFromHuman(human.stdout)).toEqual(payload.findings);
    expect(payload.findings).toEqual([
      {
        code: 'local-capability-missing',
        message:
          '@kovojs/server/dist/index.mjs imports raw capability filesystem absent from cap summary',
        obligation: 'stability',
      },
    ]);
  });

  it('rejects a vacuous certificate instead of ignoring an installed artifact tree', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-verify-cli-empty-certificate-'));
    roots.push(root);
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(path.join(artifactRoot, '@kovojs/server/dist'), { recursive: true });
    writeFileSync(
      path.join(artifactRoot, '@kovojs/server/dist/index.mjs'),
      "import 'node:child_process';",
      'utf8',
    );
    const module = '@kovojs/server/dist/index.mjs';
    const manifest = { exports: { '.': './dist/index.mjs' }, name: '@kovojs/server' };
    writeFileSync(path.join(artifactRoot, '@kovojs/server/package.json'), JSON.stringify(manifest));
    const policy = policyFor(module, manifest);
    const policyPath = path.join(root, 'policy.json');
    writeFileSync(policyPath, policy);
    const certificatePath = path.join(root, 'certificate.json');
    writeFileSync(
      certificatePath,
      `${JSON.stringify({
        artifacts: [],
        cap: {},
        domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
        doors: [],
        edges: [],
        opaque: [],
        policySha512: sha512(policy),
        roots: [],
        schema: 'kovo.certificate/v1',
      })}\n`,
    );

    let stdout = '';
    let stderr = '';
    const exitCode = await runKovoVerify(
      [certificatePath, '--policy', policyPath, '--artifacts', artifactRoot],
      {
        stderr: (text) => (stderr += text),
        stdout: (text) => (stdout += text),
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toBe('');
    expect(stdout).toContain('kovo-verify/v1 FAIL');
  });

  it('uses exit 2 for usage errors', async () => {
    await expect(runWithIo([])).resolves.toEqual({
      exitCode: 2,
      stderr:
        'kovo-verify/v1 ERROR certificate path is required\nRun "kovo-verify --help" for usage.\n',
      stdout: '',
    });

    for (const args of [
      ['certificate.json', '--unknown'],
      ['certificate.json', '--policy'],
      ['certificate.json', '--policy', 'one', '--policy', 'two', '--artifacts', 'root'],
      ['certificate.json', '--policy', 'policy', '--artifacts', 'root', '--format', 'yaml'],
      ['one.json', 'two.json', '--policy', 'policy', '--artifacts', 'root'],
    ]) {
      const output = await runWithIo(args);
      expect(output.exitCode).toBe(2);
      expect(output.stdout).toBe('');
      expect(output.stderr).toMatch(/^kovo-verify\/v1 ERROR /u);
    }

    const jsonUsage = await runWithIo(['--format', 'json']);
    expect(jsonUsage.exitCode).toBe(2);
    expect(jsonUsage.stdout).toBe('');
    expect(JSON.parse(jsonUsage.stderr)).toMatchObject({
      schema: 'kovo.verify-command-error/v1',
      status: 'indeterminate',
    });
  });

  it('rejects symlink, FIFO, and max+1 evidence inputs before reading them', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-verify-cli-inputs-'));
    roots.push(root);
    const artifactRoot = path.join(root, 'artifacts');
    const regular = path.join(root, 'regular.json');
    writeFileSync(regular, '{}\n');
    const symlink = path.join(root, 'symlink.json');
    symlinkSync(regular, symlink);
    const fifo = path.join(root, 'evidence.fifo');
    execFileSync('mkfifo', [fifo]);
    const oversizedCertificate = path.join(root, 'oversized-certificate.json');
    writeFileSync(oversizedCertificate, Buffer.alloc(2 * 1024 * 1024 + 1));
    const oversizedPolicy = path.join(root, 'oversized-policy.json');
    writeFileSync(oversizedPolicy, Buffer.alloc(1024 * 1024 + 1));

    for (const [certificatePath, policyPath] of [
      [symlink, regular],
      [fifo, regular],
      [oversizedCertificate, regular],
      [regular, symlink],
      [regular, fifo],
      [regular, oversizedPolicy],
    ]) {
      let stderr = '';
      await expect(
        runKovoVerify([certificatePath, '--policy', policyPath, '--artifacts', artifactRoot], {
          stderr: (text) => (stderr += text),
          stdout: () => {},
        }),
      ).resolves.toBe(2);
      expect(stderr).toMatch(/regular non-symlink file|no larger|byte limit/u);
    }
  });

  it('uses exit 2 for malformed JSON and emits a versioned JSON error when requested', async () => {
    const fixture = cliFixture();
    writeFileSync(fixture.certificatePath, '{not-json}\n');

    const output = await runWithIo([
      '--format',
      'json',
      '--artifacts',
      fixture.artifactRoot,
      fixture.certificatePath,
      '--policy',
      fixture.policyPath,
    ]);

    expect(output.exitCode).toBe(2);
    expect(output.stdout).toBe('');
    expect(JSON.parse(output.stderr)).toMatchObject({
      schema: 'kovo.verify-command-error/v1',
      status: 'indeterminate',
      message: expect.any(String),
    });
  });
});

function cliFixture({
  capabilities = [],
  source = 'export {};',
}: {
  capabilities?: readonly (typeof KOVO_CERTIFICATE_CAPABILITY_DOMAIN)[number][];
  source?: string;
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-verify-cli-'));
  roots.push(root);
  const artifactRoot = path.join(root, 'artifacts');
  const module = '@kovojs/server/dist/index.mjs';
  mkdirSync(path.join(artifactRoot, '@kovojs/server/dist'), { recursive: true });
  writeFileSync(path.join(artifactRoot, module), source, 'utf8');
  const manifest = { exports: { '.': './dist/index.mjs' }, name: '@kovojs/server' };
  writeFileSync(path.join(artifactRoot, '@kovojs/server/package.json'), JSON.stringify(manifest));
  const policy = policyFor(module, manifest, source);
  const policyPath = path.join(root, 'policy.json');
  writeFileSync(policyPath, policy);
  const certificatePath = path.join(root, 'certificate.json');
  writeFileSync(
    certificatePath,
    `${JSON.stringify({
      artifacts: [module],
      cap: { [module]: capabilities },
      domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
      doors: [],
      edges: [],
      opaque: [],
      policySha512: sha512(policy),
      roots: [],
      schema: 'kovo.certificate/v1',
    })}\n`,
  );
  return { artifactRoot, certificatePath, policyPath };
}

async function runWithIo(args: readonly string[]) {
  let stderr = '';
  let stdout = '';
  const exitCode = await runKovoVerify(args, {
    stderr: (text) => (stderr += text),
    stdout: (text) => (stdout += text),
  });
  return { exitCode, stderr, stdout };
}

function findingsFromHuman(
  report: string,
): { code: string; message: string; obligation: string }[] {
  return report
    .trimEnd()
    .split('\n')
    .slice(1)
    .map((line) => {
      const match = /^(CLOSURE|COVERAGE|SCHEMA|STABILITY) (\S+) (.*)$/u.exec(line);
      if (match === null) throw new Error(`invalid human finding: ${line}`);
      return {
        code: match[2],
        message: match[3],
        obligation: match[1].toLowerCase(),
      };
    });
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [
      value,
      ...tail,
    ]),
  );
}

function policyFor(
  module: string,
  manifest: { exports: { '.': string }; name: string },
  source = 'export {};',
): string {
  return `${JSON.stringify(
    {
      artifacts: [{ path: module, sha512: sha512(source) }],
      doors: [],
      opaque: [],
      packages: [
        {
          manifest,
          name: manifest.name,
        },
      ],
      roots: [],
      schema: 'kovo.certificate-policy/v1',
    },
    null,
    2,
  )}\n`;
}

function sha512(bytes: string): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}
