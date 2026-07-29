import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from '../index.js';
import { runApiV1Migration } from './api-v1-migration.js';
import { parseFixArgs, runFixCommand } from './fix.js';

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
        check: true,
        sourcePaths: ['src', 'packages/app/theme.ts'],
      },
    });
    expect(parseFixArgs(['src/cart.tsx', '--cost-report'])).toMatchObject({ ok: false });
    expect(parseFixArgs(['--unknown'])).toMatchObject({ ok: false });
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

  it('runs the api-v1 batch in read-only check mode and fail-closed refusal mode', async () => {
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
        schema: 'kovo-api-migration-result/v1',
        summary: { refused: 1, rewritten: 1, unchanged: 0 },
      });
      expect(result.files[0]).toEqual({ path: 'button.tsx', state: 'rewritten' });
      expect(result.files[1]).toMatchObject({
        path: 'theme.ts',
        refusals: [{ category: 'app-context' }],
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
