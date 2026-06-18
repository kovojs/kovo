import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineTheme } from '@kovojs/style';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buttonStyles } from './button.js';
import { dialogStyles } from './dialog.js';
import { fieldStyles } from './field.js';

const srcDir = fileURLToPath(new URL('./', import.meta.url));

describe('@kovojs/ui theme token contract', () => {
  it('drives multiple component families from one seed theme', () => {
    const violet = defineTheme({ seed: '#6750A4' });
    const teal = defineTheme({ seed: '#0f766e' });

    expect(violet.sys.color.primary).not.toBe(teal.sys.color.primary);
    expect(violet.sys.color.primaryContainer).not.toBe(teal.sys.color.primaryContainer);
    expect(violet.css).toContain('--kovo-theme-sys-color-primary:');
    expect(teal.css).toContain('--kovo-theme-sys-color-primary:');

    expect(styleValues(buttonStyles)).toContain('var(--kovo-theme-sys-color-primary)');
    expect(styleValues(fieldStyles)).toContain('var(--kovo-theme-sys-color-outline-variant)');
    expect(styleValues(dialogStyles)).toContain('var(--kovo-theme-sys-color-surface)');
  });

  it('keeps UI component source free of raw hex color literals', () => {
    const offenders = sourceFiles(srcDir)
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => ({
          file: path.relative(srcDir, file),
          value: match[0],
        })),
      )
      .filter(({ file }) => !file.endsWith('.test.tsx') && !file.includes('__snapshots__/'));

    expect(offenders).toEqual([]);
  });

  it('passes author style overrides as the final StyleX merge argument', () => {
    const offenders: Array<{ args: string; file: string }> = [];
    for (const file of componentSourceFiles()) {
      const source = readFileSync(file, 'utf8');
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        if (node.expression.getText(sourceFile) !== 'style.attrs') return;
        const args = node.arguments.map((arg) => arg.getText(sourceFile));
        const overrideIndex = args.findIndex((arg) => arg.includes('props.style'));
        if (overrideIndex >= 0 && overrideIndex !== args.length - 1) {
          offenders.push({
            args: args.join(', '),
            file: path.relative(srcDir, file),
          });
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

function styleValues(value: unknown): string {
  return JSON.stringify(value);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return entry.isFile() && file.endsWith('.tsx') ? [file] : [];
  });
}

function componentSourceFiles(): string[] {
  return sourceFiles(srcDir).filter(
    (file) => !file.endsWith('.test.tsx') && !file.includes('__snapshots__/'),
  );
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}
