import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const compilerSrcDir = dirname(fileURLToPath(import.meta.url));
const lowerDir = join(compilerSrcDir, 'lower');
const boundaryDocumentPath = join(lowerDir, 'structural-boundary.md');

describe('structural IR ownership boundary', () => {
  it('registers every lowerer that emits SourceReplacement patches', () => {
    const boundaryDocument = readFileSync(boundaryDocumentPath, 'utf8');
    const registeredLowerers = registeredLowererNames(boundaryDocument);
    const sourcePatchLowerers = lowererSourceFiles().flatMap((fileName) =>
      sourceReplacementLowererNames(fileName),
    );

    expect(sourcePatchLowerers).toEqual([
      'lowerInlineAttributeDerives',
      'navigationHrefLowering',
      'navigationLinkLowering',
      'platformBehaviorLowering',
      'lowerPrimitiveAttributeSpreads',
      'lowerStructuralJsx',
      'viewTransitionLowering',
    ]);
    expect(sourcePatchLowerers.filter((name) => !registeredLowerers.has(name))).toEqual([]);
  });

  it('documents JSX IR-owned, terminal, debt, or legacy ownership for registered patch lowerers', () => {
    const boundaryDocument = readFileSync(boundaryDocumentPath, 'utf8');
    const rows = boundaryTableRows(boundaryDocument);

    for (const lowerer of registeredLowererNames(boundaryDocument)) {
      expect(rows.get(lowerer), lowerer).toMatch(
        /\|\s*`[^`]+`\s*\|\s*`[^`]+`\s*\|\s*`(?:jsx-ir-owner|terminal-only|structural-debt|legacy-structural-entrypoint)`\s*\|/,
      );
    }
  });
});

function lowererSourceFiles(): string[] {
  return readdirSync(lowerDir)
    .filter((fileName) => fileName.endsWith('.ts'))
    .sort();
}

function sourceReplacementLowererNames(fileName: string): string[] {
  const source = readFileSync(join(lowerDir, fileName), 'utf8');
  if (!source.includes('SourceReplacement')) return [];

  return [...source.matchAll(/export function\s+([A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
    .filter((name) => /(?:lower|Lowering)/.test(name))
    .sort();
}

function registeredLowererNames(boundaryDocument: string): Set<string> {
  return new Set(
    [...boundaryDocument.matchAll(/\|\s*`([A-Za-z0-9_]+)`\s*\|\s*`[^`]+`\s*\|/g)].map(
      (match) => match[1]!,
    ),
  );
}

function boundaryTableRows(boundaryDocument: string): Map<string, string> {
  return new Map(
    boundaryDocument
      .split('\n')
      .map((line): [string, string] | null => {
        const match = line.match(/^\|\s*`([A-Za-z0-9_]+)`\s*\|/);
        return match?.[1] ? [match[1], line] : null;
      })
      .filter((row): row is [string, string] => row !== null),
  );
}
