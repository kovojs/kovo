import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  lintPrimitiveHandlerPackageSources,
  runPrimitiveHandlerLintCommand,
} from './lint-primitives.js';

describe('primitive handler lint CLI gate', () => {
  it('passes over the real @jiso/headless-ui primitive sources', () => {
    const result = lintPrimitiveHandlerPackageSources({
      packageRoot: new URL('../../', import.meta.url),
    });

    expect(result.findings).toEqual([]);
    expect(result.files.map((file) => file.path)).toContain('src/primitives/disclosure.ts');
  });

  it('returns a zero exit code when marked primitive source is guarded', () => {
    const root = temporaryPackageRoot({
      'src/primitives/tooltip.ts': `
/** @jisoPrimitiveHandler */
export function tooltipPointerEnter(event: Event): void {
  if (event.defaultPrevented) return;
  showTooltip();
}
`,
    });

    try {
      const result = runPrimitiveHandlerLintCommand(['--package-root', root]);

      expect(result).toEqual({
        errorOutput: '',
        exitCode: 0,
        output: 'primitive-handler-lint: checked 1 file, found 0 issues\n',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('returns a failing exit code with formatted findings for unguarded marked handlers', () => {
    const root = temporaryPackageRoot({
      'src/primitives/popover.ts': `
/** @jisoPrimitiveHandler */
export const popoverTriggerClick = (event: Event): void => {
  openPopover();
};
`,
    });

    try {
      const result = runPrimitiveHandlerLintCommand(['--package-root', root]);

      expect(result.exitCode).toBe(1);
      expect(result.output).toBe('');
      expect(result.errorOutput).toBe(
        'src/primitives/popover.ts:3:14 JISO_HUI001 popoverTriggerClick Primitive handler must begin by no-oping when event.defaultPrevented is true; SPEC.md §4.6 keeps chained on:* handlers running left-to-right and assigns cancellation handling to primitive handlers.\n',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects unknown command arguments', () => {
    expect(runPrimitiveHandlerLintCommand(['--unknown'])).toEqual({
      errorOutput: 'Usage: lint:primitives [--package-root <path>]\nUnknown argument: --unknown\n',
      exitCode: 1,
      output: '',
    });
  });
});

function temporaryPackageRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jiso-headless-ui-lint-'));

  for (const [path, source] of Object.entries(files)) {
    const filePath = join(root, path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source, 'utf8');
  }

  return root;
}
