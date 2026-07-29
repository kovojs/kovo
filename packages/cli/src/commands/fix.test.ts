import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mainAsync } from '../index.js';
import {
  API_V1_MIGRATION_BATCH_IDS,
  apiV1MigrationRuntime,
  runApiV1Migration,
} from './api-v1-migration.js';
import { fixFormatCommandShell, parseFixArgs, runFixCommand } from './fix.js';

afterEach(() => vi.restoreAllMocks());

describe('kovo fix', () => {
  it('parses source, check, and cost-report modes through the closed argv grammar', () => {
    expect(parseFixArgs(['src/cart.tsx'])).toEqual({
      ok: true,
      options: { check: false, sourcePath: 'src/cart.tsx' },
    });
    expect(parseFixArgs(['src/cart.tsx', '--check'])).toEqual({
      ok: true,
      options: { check: true, sourcePath: 'src/cart.tsx' },
    });
    expect(parseFixArgs(['--cost-report'])).toEqual({
      ok: true,
      options: { costReport: true },
    });
    expect(parseFixArgs(['api-v1', 'src', 'packages/app/theme.ts', '--check'])).toEqual({
      ok: true,
      options: {
        apiV1: true,
        mode: 'check',
        sourcePaths: ['src', 'packages/app/theme.ts'],
      },
    });
    expect(parseFixArgs(['api-v1', 'src', '--write'])).toEqual({
      ok: true,
      options: {
        apiV1: true,
        mode: 'write',
        sourcePaths: ['src'],
      },
    });
    expect(parseFixArgs(['api-v1', 'src'])).toMatchObject({ ok: false });
    expect(parseFixArgs(['api-v1', 'src', '--check', '--write'])).toMatchObject({ ok: false });
    expect(parseFixArgs(['format', 'src', 'package.json', '--check'])).toEqual({
      ok: true,
      options: {
        check: true,
        format: true,
        sourcePaths: ['src', 'package.json'],
      },
    });
    expect(parseFixArgs(['src/cart.tsx', '--cost-report'])).toMatchObject({ ok: false });
    expect(parseFixArgs(['--unknown'])).toMatchObject({ ok: false });
  });

  it('keeps the formatter implementation behind the semantic kovo fix command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-fix-format-'));
    const sourceRoot = join(root, 'src');
    mkdirSync(sourceRoot);
    const spawn = vi.spyOn(fixFormatCommandShell, 'spawnSync').mockReturnValue({
      output: [],
      pid: 10,
      signal: null,
      status: 0,
      stderr: null,
      stdout: null,
    });
    try {
      const result = await runFixCommand(
        { check: false, format: true, sourcePaths: ['src'] },
        root,
      );

      expect(result).toEqual({
        exitCode: 0,
        output: 'kovo-fix-format/v1\nOK mode=write paths=1\n',
      });
      expect(spawn).toHaveBeenCalledOnce();
      expect(spawn.mock.calls[0]?.[0]).toBe(process.execPath);
      expect(spawn.mock.calls[0]?.[1]).toEqual([
        expect.stringMatching(/node_modules[/\\]vite-plus[/\\]bin[/\\]vp$/u),
        'fmt',
        '--write',
        'src',
      ]);
      expect(spawn.mock.calls[0]?.[2]).toMatchObject({
        cwd: realpathSync(root),
        stdio: 'inherit',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('dispatches the real kovo fix command against the invocation cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-fix-dispatch-'));
    const sourcePath = join(root, 'cart-badge.tsx');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const previousCwd = process.cwd();
    try {
      writeFileSync(
        sourcePath,
        `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
      );
      process.chdir(root);

      await expect(mainAsync(['fix', 'cart-badge.tsx'])).resolves.toBe(0);

      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('FIX KV223 cart-badge.tsx:4:31');
      expect(output).toContain('analyzer=green');
      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(sourcePath, 'utf8')).not.toContain('data-bind="cart.count"');
    } finally {
      process.chdir(previousCwd);
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rewrites a fixable file only after the compiler proves it green', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-fix-'));
    const sourcePath = join(root, 'cart-badge.tsx');
    writeFileSync(
      sourcePath,
      `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
    );

    const result = await runFixCommand({ check: false, sourcePath: 'cart-badge.tsx' }, root);

    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.output).toContain('FIX KV223');
    expect(result.output).toContain('analyzer=green');
    expect(readFileSync(sourcePath, 'utf8')).not.toContain('data-bind="cart.count"');
  });

  it.skipIf(process.platform === 'win32')(
    'preserves authored source permissions across the proved atomic rewrite',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'kovo-fix-mode-'));
      const sourcePath = join(root, 'cart-badge.tsx');
      try {
        writeFileSync(
          sourcePath,
          `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
        );
        chmodSync(sourcePath, 0o751);

        await expect(
          runFixCommand({ check: false, sourcePath: 'cart-badge.tsx' }, root),
        ).resolves.toMatchObject({ exitCode: 0 });
        expect(statSync(sourcePath).mode & 0o777).toBe(0o751);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  it('keeps --check read-only and fails when a safe rewrite is available', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-fix-check-'));
    const sourcePath = join(root, 'toggle.tsx');
    const source = `
export const Toggle = component({
  render: () => (
    <Tooltip.Trigger attrs={{ 'data-state': 'closed' }}>
      {(attrs) => <button {...attrs} data-state="open">Toggle</button>}
    </Tooltip.Trigger>
  ),
});
`;
    writeFileSync(sourcePath, source);

    const result = await runFixCommand({ check: true, sourcePath: 'toggle.tsx' }, root);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.output).toContain('WOULD_FIX KV232');
    expect(readFileSync(sourcePath, 'utf8')).toBe(source);
  });

  it('refuses ambiguous diagnostics, generated paths, and symlink carriers without writing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-fix-refuse-'));
    const sourcePath = join(root, 'link.tsx');
    const source = `
export const Link = component({
  render: ({ profile }) => <script>{profile.inline}</script>,
});
`;
    writeFileSync(sourcePath, source);

    const ambiguous = await runFixCommand({ check: false, sourcePath: 'link.tsx' }, root);
    expect(ambiguous).toMatchObject({ exitCode: 1 });
    expect(ambiguous.output).toContain('BLOCKED KV236');
    expect(readFileSync(sourcePath, 'utf8')).toBe(source);

    const generated = await runFixCommand({ check: false, sourcePath: 'dist/component.tsx' }, root);
    expect(generated).toMatchObject({ exitCode: 1 });

    const linkPath = join(root, 'linked.tsx');
    symlinkSync(sourcePath, linkPath);
    const linked = await runFixCommand({ check: false, sourcePath: 'linked.tsx' }, root);
    expect(linked).toMatchObject({ exitCode: 1 });
    expect(readFileSync(sourcePath, 'utf8')).toBe(source);
  });

  it('runs every checked api-v1 batch in read-only check mode and fail-closed refusal mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-fix-api-v1-'));
    const rewritePath = join(root, 'button.tsx');
    const refusalPath = join(root, 'theme.ts');
    const rewriteSource = `
import type { StyleRecord } from '@kovojs/style';
export interface ButtonProps { style?: StyleRecord }
`;
    const refusalSource = `
// unicode proves byte anchors: 🧭
import { createTheme, defineVars } from '@kovojs/style';
const vars = defineVars({ accent: 'red' });
export const dark = createTheme(vars, { accent: 'black' });
`;
    try {
      writeFileSync(rewritePath, rewriteSource);
      writeFileSync(refusalPath, refusalSource);

      const checked = await runApiV1Migration(
        { mode: 'check', sourcePaths: ['button.tsx', 'theme.ts'] },
        root,
      );
      expect(checked).toMatchObject({ exitCode: 1 });
      const result = JSON.parse(checked.output ?? '') as {
        files: {
          path: string;
          refusals?: { anchor: { end: number; start: number }; category: string }[];
          state: string;
        }[];
        schema: string;
        summary: { refused: number; rewritten: number; unchanged: number };
      };
      expect(result).toMatchObject({
        batch: 'api-v1',
        migrationBatches: API_V1_MIGRATION_BATCH_IDS,
        schema: 'kovo-api-migration-result/v1',
        summary: { refused: 1, rewritten: 1, unchanged: 0 },
      });
      expect(result.files[0]).toEqual({
        batches: ['style-opaque-handles'],
        path: 'button.tsx',
        state: 'rewritten',
      });
      expect(result.files[1]).toMatchObject({
        path: 'theme.ts',
        refusals: [
          {
            batch: 'style-opaque-handles',
            category: 'app-context',
            manualAction: expect.stringContaining(
              'docs/releases/api-v1.md#migrate-styles-and-themes',
            ),
            reason: expect.any(String),
          },
        ],
        state: 'refused',
      });
      const refusalStart = refusalSource.indexOf('createTheme');
      expect(result.files[1]?.refusals?.[0]?.anchor.start).toBe(
        Buffer.byteLength(refusalSource.slice(0, refusalStart), 'utf8'),
      );
      expect(readFileSync(rewritePath, 'utf8')).toBe(rewriteSource);
      expect(readFileSync(refusalPath, 'utf8')).toBe(refusalSource);

      const refusedWrite = await runApiV1Migration(
        { mode: 'write', sourcePaths: ['button.tsx', 'theme.ts'] },
        root,
      );
      expect(refusedWrite).toMatchObject({ exitCode: 1 });
      expect(readFileSync(rewritePath, 'utf8')).toBe(rewriteSource);
      expect(readFileSync(refusalPath, 'utf8')).toBe(refusalSource);

      const written = await runApiV1Migration({ mode: 'write', sourcePaths: ['button.tsx'] }, root);
      expect(written).toMatchObject({ exitCode: 0 });
      expect(readFileSync(rewritePath, 'utf8')).toContain(
        "import type { StyleHandle } from '@kovojs/style';",
      );
      expect(readFileSync(rewritePath, 'utf8')).toContain('style?: StyleHandle');

      const idempotent = await runApiV1Migration(
        { mode: 'check', sourcePaths: ['button.tsx'] },
        root,
      );
      expect(idempotent).toMatchObject({ exitCode: 0 });
      expect(JSON.parse(idempotent.output ?? '')).toMatchObject({
        files: [{ path: 'button.tsx', state: 'unchanged' }],
        summary: { refused: 0, rewritten: 0, unchanged: 1 },
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('writes the structured api-v1 finding result to stdout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-fix-api-v1-stdout-'));
    const sourcePath = join(root, 'button.ts');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const previousCwd = process.cwd();
    try {
      writeFileSync(sourcePath, `import type { StyleRecord } from '@kovojs/style';\n`);
      process.chdir(root);

      await expect(mainAsync(['fix', 'api-v1', 'button.ts', '--check'])).resolves.toBe(1);

      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(JSON.parse(output)).toMatchObject({
        batch: 'api-v1',
        mode: 'check',
        summary: { refused: 0, rewritten: 1, unchanged: 0 },
      });
      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(sourcePath, 'utf8')).toContain('StyleRecord');
    } finally {
      process.chdir(previousCwd);
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('binds the cumulative command to every removed batch in the checked migration ledger', () => {
    const ledger = JSON.parse(readFileSync(join(process.cwd(), 'api-migrations.json'), 'utf8')) as {
      batches: { id: string; state: string }[];
    };
    expect(API_V1_MIGRATION_BATCH_IDS).toEqual(
      ledger.batches.filter((batch) => batch.state === 'removed').map((batch) => batch.id),
    );
  });

  it('rolls back prior files when a later captured rewrite cannot commit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-fix-api-v1-rollback-'));
    const firstPath = join(root, 'a.ts');
    const secondPath = join(root, 'b.ts');
    const source = `import type { StyleRecord } from '@kovojs/style';\n`;
    const createBoundary = apiV1MigrationRuntime.createFileSystemBoundary;
    try {
      writeFileSync(firstPath, source);
      writeFileSync(secondPath, source);
      const boundary = await createBoundary(realpathSync(root));
      let replacements = 0;
      vi.spyOn(apiV1MigrationRuntime, 'createFileSystemBoundary').mockResolvedValue({
        ...boundary,
        async replaceCapturedFile(snapshot, body) {
          replacements += 1;
          await boundary.replaceCapturedFile(snapshot, body);
          if (replacements === 2) throw new Error('injected post-commit failure');
        },
      });

      const result = await runApiV1Migration(
        { mode: 'write', sourcePaths: ['a.ts', 'b.ts'] },
        root,
      );

      expect(result).toMatchObject({
        error: expect.stringContaining('2 migration output file(s) rolled back'),
        exitCode: 1,
      });
      expect(readFileSync(firstPath, 'utf8')).toBe(source);
      expect(readFileSync(secondPath, 'utf8')).toBe(source);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('prints the measured corpus with an owner on every framework defect', async () => {
    const result = await runFixCommand({ costReport: true }, process.cwd());

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.output).toContain('COST_TO_GREEN kovo.cost-to-green/v1');
    expect(result.output).toContain(
      'DIAGNOSTIC KV236 traffic=5 safe=- escape=2 delta=- status=framework-defect owner=compiler-output-safety',
    );
    expect(result.output).toContain(
      'DIAGNOSTIC KV232 traffic=4 safe=1 escape=2 delta=-1 status=safe-rewrite owner=-',
    );
    expect(result.output).toContain('SUMMARY diagnostics=3 cases=12 defects=1');
  });
});
