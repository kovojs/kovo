import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

import { afterEach, describe, expect, it } from 'vitest';

import { snapshotKovoInvocationEnvironment } from '../invocation-environment.js';
import { sourceCheckStylesheetPackageClosureDigestForTesting } from './build-export.js';
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
  it('re-exports the authenticated producer cache and destroys facts when it closes', () => {
    const enabled = new KovoSourceCheckSessionFactCache(true);
    expect(enabled.consumeProducerFact('stylesheet', digestA)).toBeUndefined();
    enabled.storeProducerFact('stylesheet', digestA, '{"passed":true}');
    expect(enabled.consumeProducerFact('stylesheet', digestA)).toBe('{"passed":true}');
    expect(enabled.consumeProducerFact('stylesheet', digestB)).toBeUndefined();
    expect(enabled.snapshot()).toMatchObject({
      closed: false,
      enabled: true,
      entries: 1,
      hits: 1,
      misses: 2,
      typescript: null,
    });
    enabled.close();
    expect(enabled.snapshot()).toMatchObject({
      closed: true,
      enabled: true,
      entries: 0,
      hits: 1,
      misses: 2,
      payloadBytes: 0,
      typescript: null,
    });
    expect(() => enabled.consumeProducerFact('stylesheet', digestA)).toThrow(/cache is closed/u);

    const disabled = new KovoSourceCheckSessionFactCache(false);
    disabled.storeProducerFact('stylesheet', digestA, '{"passed":true}');
    expect(disabled.consumeProducerFact('stylesheet', digestA)).toBeUndefined();
    expect(disabled.snapshot()).toMatchObject({ enabled: false, entries: 0, hits: 0, misses: 1 });
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
      if (baseline.name === 'app-source-trust' || baseline.name === 'stylesheet') {
        expect(baseline.status, baseline.name).toBe('executed');
        expect(edited.status, baseline.name).toBe('executed');
        expect(restored.status, baseline.name).toBe('reused-authenticated');
      } else {
        expect([baseline.status, edited.status, restored.status], baseline.name).not.toContain(
          'reused-authenticated',
        );
      }
    }
    for (const record of records) {
      const byName = new Map(
        record.phaseCensus.phases.map((phase: { name: string; status: string }) => [
          phase.name,
          phase.status,
        ]),
      );
      for (const requiredFreshPhase of [
        'session-authority',
        'app-evaluation',
        'build-check-graph',
        'graph-diagnostics',
      ]) {
        expect(byName.get(requiredFreshPhase), requiredFreshPhase).toBe('executed');
      }
    }
  }, 180_000);

  it('reuses only producer facts while freshly evaluating the app and rebuilding diagnostics', async () => {
    const root = fixtureRoot('session-reuse');
    const stylesheetPath = join(root, 'src/styles.css');
    const notesPath = join(root, 'NOTES.md');
    writeSourceCheckFixture(root, sourceCheckApp('session reuse'));
    writeFileSync(notesPath, 'design notes\n', 'utf8');
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
          if (revision === 0) writeFileSync(notesPath, 'design notes, expanded\n', 'utf8');
          if (revision === 1) {
            writeFileSync(stylesheetPath, '.fixture { color: blue; }\n', 'utf8');
          }
        },
      },
    );

    expect(lines).toHaveLength(3);
    const records = lines.map((line) => JSON.parse(line));
    if (exit === 1) {
      // Same stale-posture tolerance as the N-edit invocation proof above: an unsealed
      // implementation digest refuses every revision before reuse could ever be reached.
      expect(records.every((record) => record.input.status === 'rejected')).toBe(true);
      return;
    }
    expect(exit, lines.join('\n')).toBe(0);
    const [baseline, reused, edited] = records;

    // Revision 1 (docs-only edit): exact compiler producer facts may be reused, but SPEC §11.4
    // still requires fresh app evaluation, runtime authority, graph assembly, and diagnostics.
    expect(reused.check.result.text).toBe(baseline.check.result.text);
    expect(reused.input).toEqual(baseline.input);
    expect(reused.phaseCensus.checkGraphDigest).toBe(baseline.phaseCensus.checkGraphDigest);
    expect(reused).not.toHaveProperty('continuity');
    const reusedByName = new Map<string, { durationMs: number; status: string }>(
      reused.phaseCensus.phases.map(
        (phase: { durationMs: number; name: string; status: string }) => [
          phase.name,
          { durationMs: phase.durationMs, status: phase.status },
        ],
      ),
    );
    expect(reusedByName.get('app-source-trust')).toMatchObject({
      durationMs: expect.any(Number),
      status: 'reused-authenticated',
    });
    expect(reusedByName.get('app-source-trust')!.durationMs).toBeGreaterThan(0);
    expect(reusedByName.get('stylesheet')).toMatchObject({
      durationMs: expect.any(Number),
      status: 'reused-authenticated',
    });
    expect(reusedByName.get('stylesheet')!.durationMs).toBeGreaterThan(0);
    for (const requiredFreshPhase of [
      'session-authority',
      'app-evaluation',
      'build-check-graph',
      'graph-diagnostics',
    ]) {
      expect(reusedByName.get(requiredFreshPhase)?.status, requiredFreshPhase).toBe('executed');
    }

    // Revision 2 (raw stylesheet edit): `preEvaluationApprovedBuildFiles` enrolls every stable
    // src/**/*.css byte in the app-trust source digest, so neither trust nor style can reuse.
    expect(
      (edited.phaseCensus.phases as { status: string }[]).some(
        (phase) => phase.status === 'reused-authenticated',
      ),
    ).toBe(false);
    const editedByName = new Map<string, { status: string }>(
      edited.phaseCensus.phases.map((phase: { name: string; status: string }) => [
        phase.name,
        { status: phase.status },
      ]),
    );
    expect(editedByName.get('app-source-trust')?.status).toBe('executed');
    expect(editedByName.get('stylesheet')?.status).toBe('executed');
    expect(
      (edited.phaseCensus.phases as { status: string }[]).filter(
        (phase) => phase.status === 'executed',
      ).length,
    ).toBeGreaterThan(0);
  }, 180_000);

  it('binds stylesheet reuse to the UI implementation tree and raw vendored-source ledger', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-source-check-stylesheet-identity-'));
    roots.push(root);
    const packageRoot = join(root, 'node_modules/@kovojs/ui');
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    const appPath = join(root, 'src/app.tsx');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(appPath, 'export default {};\n', 'utf8');
    const manifest = (authority: string) =>
      JSON.stringify({
        exports: { './button': './src/button.tsx' },
        kovo: { authority, vendoredSource: true },
        name: '@kovojs/ui',
        type: 'module',
        version: '0.3.0',
      });
    writeFileSync(join(packageRoot, 'package.json'), manifest('first'), 'utf8');
    writeFileSync(join(packageRoot, 'src/button.tsx'), 'export const button = 1;\n', 'utf8');

    const baseline = sourceCheckStylesheetPackageClosureDigestForTesting(appPath);
    expect(baseline).toMatch(/^sha256:[0-9a-f]{64}$/u);
    writeFileSync(join(packageRoot, 'src/button.tsx'), 'export const button = 2;\n', 'utf8');
    const implementationChanged = sourceCheckStylesheetPackageClosureDigestForTesting(appPath);
    expect(implementationChanged).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(implementationChanged).not.toBe(baseline);

    // The generic capability fingerprint intentionally excludes package-specific `kovo` metadata;
    // stylesheet extraction consumes its vendored-source hash ledger, so raw manifest bytes are a
    // separate input and must invalidate reuse even at an unchanged package version.
    writeFileSync(join(packageRoot, 'package.json'), manifest('second'), 'utf8');
    const ledgerChanged = sourceCheckStylesheetPackageClosureDigestForTesting(appPath);
    expect(ledgerChanged).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(ledgerChanged).not.toBe(implementationChanged);
  });
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
  writeFileSync(join(root, 'src/styles.css'), '.fixture { color: red; }\n', 'utf8');
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
