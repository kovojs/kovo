import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('.', import.meta.url));
const publicTypes = [
  'CollectionOrientation',
  'DialogInvokerEvent',
  'NavigationIntent',
  'PrimitiveChangeDetail',
  'PrimitiveDataAttributes',
  'TextDirection',
  'TypeaheadState',
] as const;

function exportedTypeNames(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.isTypeOnly) {
      throw new Error('packages/headless-ui/src/types.ts may only contain type re-exports.');
    }
    const elements =
      statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements
        : [];
    for (const element of elements) names.push(element.name.text);
  }

  return names.sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('@kovojs/headless-ui/types public seam', () => {
  it('exports only the shared leaf types named by public primitive declarations', () => {
    expect(exportedTypeNames(join(srcDir, 'types.ts'))).toEqual([...publicTypes].sort());
  });

  it('keeps each shared type tied to at least one public primitive declaration', () => {
    const primitiveSources = sourceFiles(join(srcDir, 'primitives'));

    const references = new Map<string, string[]>(
      publicTypes.map((name) => {
        const pattern = new RegExp(`\\b${name}\\b`);
        const matches = primitiveSources
          .filter((file) => pattern.test(readFileSync(file, 'utf8')))
          .map((file) => relative(srcDir, file).split('/').join('/'))
          .sort();
        return [name, matches];
      }),
    );

    expect(Object.fromEntries(references)).toMatchObject({
      CollectionOrientation: expect.arrayContaining(['primitives/accordion.ts']),
      DialogInvokerEvent: expect.arrayContaining(['primitives/dialog.ts']),
      NavigationIntent: expect.arrayContaining(['primitives/radio-group.ts']),
      PrimitiveChangeDetail: expect.arrayContaining(['primitives/accordion.ts']),
      PrimitiveDataAttributes: expect.arrayContaining(['primitives/accordion.ts']),
      TextDirection: expect.arrayContaining(['primitives/accordion.ts']),
      TypeaheadState: expect.arrayContaining(['primitives/select.ts']),
    });
  });
});
