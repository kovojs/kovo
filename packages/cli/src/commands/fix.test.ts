import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from '../index.js';
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
