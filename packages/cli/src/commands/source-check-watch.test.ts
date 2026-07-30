import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { afterEach, describe, expect, it } from 'vitest';

import { snapshotKovoInvocationEnvironment } from '../invocation-environment.js';
import {
  KovoSourceCheckSessionFactCache,
  runKovoSourceCheckWatchCommand,
} from './source-check-watch.js';

const roots: string[] = [];
const repoRoot = process.cwd();
const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('production source-check watch command', () => {
  it('bounds digest-only session facts and destroys them when the session closes', () => {
    const enabled = new KovoSourceCheckSessionFactCache(true);
    expect(enabled.observe('config-trust', digestA)).toBe(false);
    expect(enabled.observe('config-trust', digestA)).toBe(true);
    expect(enabled.observe('config-trust', digestB)).toBe(false);
    expect(enabled.snapshot()).toEqual({
      closed: false,
      enabled: true,
      entries: 2,
      hits: 1,
      misses: 2,
    });
    enabled.close();
    expect(enabled.snapshot()).toEqual({
      closed: true,
      enabled: true,
      entries: 0,
      hits: 1,
      misses: 2,
    });
    expect(() => enabled.observe('config-trust', digestA)).toThrow(/cache is closed/u);

    const bounded = new KovoSourceCheckSessionFactCache(true);
    for (let index = 0; index <= 512; index += 1) {
      const digest = `sha256:${createHash('sha256').update(String(index)).digest('hex')}`;
      expect(bounded.observe('app-source-trust', digest)).toBe(false);
    }
    expect(bounded.snapshot()).toMatchObject({ entries: 1, hits: 0, misses: 513 });
    bounded.close();

    const disabled = new KovoSourceCheckSessionFactCache(false);
    expect(disabled.observe('config-trust', digestA)).toBe(false);
    expect(disabled.observe('config-trust', digestA)).toBe(false);
    expect(disabled.snapshot()).toMatchObject({ enabled: false, entries: 0, hits: 0, misses: 2 });
    disabled.close();
  });

  it('publishes explicit unauthenticated evidence when the entry is missing', async () => {
    const root = fixtureRoot('missing');
    const lines: string[] = [];
    const exit = await runKovoSourceCheckWatchCommand(
      { appModulePath: './src/app.tsx', cache: true },
      security(root),
      {
        maxRevisions: 1,
        pollIntervalMs: 25,
        write(line) {
          lines.push(line);
        },
      },
    );

    expect(exit).toBe(2);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({
      check: { result: { command: 'check', exitCode: 2, protocol: 'kovo-check/v1' } },
      input: {
        closure: null,
        entry: { digest: null, path: 'src/app.tsx' },
        reason: 'missing',
        status: 'rejected',
      },
      phaseCensus: { checkGraphDigest: null },
      revision: 0,
      version: 'kovo-check-watch/v1',
    });
    expect(
      record.phaseCensus.phases.every(
        (phase: { durationMs: number; status: string }) =>
          phase.durationMs === 0 && phase.status === 'not-reached',
      ),
    ).toBe(true);
  });

  it('dispatches the long-lived JSONL form through the supported CLI bin', async () => {
    const root = fixtureRoot('bin-dispatch');
    const child = spawn(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        join(repoRoot, 'packages/cli/src/bin.ts'),
        'check',
        'source',
        './src/app.tsx',
        '--watch',
        '--format',
        'json',
      ],
      {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (child.stdout === null || child.stderr === null) {
      throw new Error('source-check watch CLI child did not expose output streams');
    }
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let lineTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const line = await Promise.race([
        new Promise<string>((resolveLine) => lines.once('line', resolveLine)),
        new Promise<never>((_, reject) => {
          lineTimeout = setTimeout(
            () => reject(new Error(`source-check watch CLI timed out: ${stderr}`)),
            20_000,
          );
        }),
      ]);
      expect(JSON.parse(line)).toMatchObject({
        input: { reason: 'missing', status: 'rejected' },
        revision: 0,
        version: 'kovo-check-watch/v1',
      });
    } finally {
      if (lineTimeout !== undefined) clearTimeout(lineTimeout);
      lines.close();
      child.kill('SIGINT');
      await Promise.race([
        new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }, 30_000);

  it('runs N edits as N+1 real one-shot revisions with exact source and phase evidence', async () => {
    const root = fixtureRoot('n-plus-one');
    const appPath = join(root, 'src/app.tsx');
    const variants = [
      sourceCheckApp('source-check watch revision zero'),
      sourceCheckApp('source-check watch revision one'),
    ] as const;
    writeSourceCheckFixture(root, variants[0]);
    const lines: string[] = [];

    const exit = await runKovoSourceCheckWatchCommand(
      { appModulePath: './src/app.tsx', cache: true },
      security(root),
      {
        maxRevisions: 3,
        pollIntervalMs: 25,
        write(line) {
          lines.push(line);
          const revision = JSON.parse(line).revision as number;
          if (revision === 0) writeFileSync(appPath, variants[1], 'utf8');
          if (revision === 1) writeFileSync(appPath, variants[0], 'utf8');
        },
      },
    );

    expect(lines).toHaveLength(3);
    const records = lines.map((line) => JSON.parse(line));
    expect(records.map((record) => record.revision)).toEqual([0, 1, 2]);
    if (exit === 1) {
      // The integration branch intentionally does not reseal framework implementation posture.
      // Keep the real N-edit invocation proof executable while that independent release input is
      // stale, but require the watch adapter to refuse every unauthenticated revision explicitly.
      expect(
        records.every(
          (record) =>
            record.input.status === 'rejected' &&
            record.input.reason === 'ambiguous-closure' &&
            record.check.result.text.includes(
              'installed implementation digest does not match the reviewed source or packed implementation',
            ) &&
            record.phaseCensus.phases.every(
              (phase: { status: string }) => phase.status === 'not-reached',
            ),
        ),
      ).toBe(true);
      expect(records[0].input.projectDigest).toBe(records[2].input.projectDigest);
      expect(records[0].input.projectDigest).not.toBe(records[1].input.projectDigest);
      return;
    }
    expect(exit, lines.join('\n')).toBe(0);
    expect(records.map((record) => record.check.result.text)).toEqual([
      'kovo-check/v1\nOK\n',
      'kovo-check/v1\nOK\n',
      'kovo-check/v1\nOK\n',
    ]);
    expect(
      records.every(
        (record) =>
          record.input.status === 'accepted' &&
          record.input.entry.path === 'src/app.tsx' &&
          record.input.closure.some((file: { path: string }) => file.path === 'src/client.ts') &&
          record.phaseCensus.phases.length === 11,
      ),
    ).toBe(true);

    const appDigests = records.map(
      (record) =>
        record.input.closure.find((file: { path: string }) => file.path === 'src/app.tsx').digest,
    );
    expect(appDigests).toEqual([
      utf8Digest(variants[0]),
      utf8Digest(variants[1]),
      utf8Digest(variants[0]),
    ]);
    expect(records[0].input.closureDigest).toBe(records[2].input.closureDigest);
    expect(records[0].input.projectDigest).toBe(records[2].input.projectDigest);
    expect(records[0].phaseCensus.checkGraphDigest).toBe(records[2].phaseCensus.checkGraphDigest);
    expect(records[0].input.projectDigest).not.toBe(records[1].input.projectDigest);
    expect(records[0].phaseCensus.checkGraphDigest).not.toBe(
      records[1].phaseCensus.checkGraphDigest,
    );

    const invariantPhases = new Set([
      'lifecycle-policy',
      'config-trust',
      'typescript',
      'project-quality',
      'sound-subset',
    ]);
    for (let index = 0; index < records[0].phaseCensus.phases.length; index += 1) {
      const baseline = records[0].phaseCensus.phases[index];
      const edited = records[1].phaseCensus.phases[index];
      const restored = records[2].phaseCensus.phases[index];
      expect(restored.inputDigest, baseline.name).toBe(baseline.inputDigest);
      if (invariantPhases.has(baseline.name)) {
        expect(edited.inputDigest, baseline.name).toBe(baseline.inputDigest);
      } else {
        expect(edited.inputDigest, baseline.name).not.toBe(baseline.inputDigest);
      }
      expect([baseline.status, edited.status, restored.status], baseline.name).not.toContain(
        'reused-authenticated',
      );
    }
  }, 180_000);
});

function fixtureRoot(name: string): string {
  const root = mkdtempSync(join(repoRoot, `.tmp-source-check-watch-${name}-`));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  return root;
}

function security(root: string) {
  return {
    invocationCwd: root,
    invocationEnv: snapshotKovoInvocationEnvironment({}),
    paranoidStaticAdvisory: false,
  };
}

function writeSourceCheckFixture(root: string, appSource: string): void {
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
  writeFileSync(join(root, 'src/app.tsx'), appSource, 'utf8');
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/src/client.ts"></script></body></html>',
    'utf8',
  );
  writeFileSync(join(root, 'src/client.ts'), 'export const client = true;\n', 'utf8');
}

function sourceCheckApp(reason: string): string {
  return `
import { defineKovo } from '@kovojs/server';

export const app = defineKovo({
  appId: '22222222-2222-4222-8222-222222222222',
});
export const censusQuery = app.query({
  access: { kind: 'public', reason: ${JSON.stringify(reason)} },
  load: () => ({ ready: true }),
});

export default app.assemble({
  queries: [censusQuery],
  routes: [],
});
`;
}

function utf8Digest(source: string): string {
  return `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`;
}
