import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = 'tests/integration/specs';

const HARNESS_IMPORTS = new Set([
  '@kovojs/test/internal/integration',
  '@kovojs/test/internal/integration/define',
]);

const ALLOWED_INTERNAL_IMPORTS: Record<string, Record<string, string>> = {
  'tests/integration/specs/diagnostic-dev-document.spec.ts': {
    '@kovojs/server/internal/app-shell-vite':
      'Dev diagnostic surfacing test drives the Vite app-shell middleware ABI directly.',
  },
  'tests/integration/specs/diagnostic-warning-nonblocking.spec.ts': {
    '@kovojs/server/internal/app-shell-vite':
      'Dev diagnostic surfacing test drives the Vite app-shell middleware ABI directly.',
  },
  'tests/integration/specs/hmr-dev-client.spec.ts': {
    '@kovojs/server/internal/app-shell-vite':
      'HMR integration test drives the Vite app-shell middleware ABI directly.',
    '@kovojs/server/internal/wire':
      'HMR integration test needs the live-target renderer ABI used by the dev server.',
  },
};

describe('integration import boundary', () => {
  it('requires non-harness package-internal imports to be explicitly allowlisted', () => {
    const violations: string[] = [];

    for (const file of sourceFiles(ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of staticImportSpecifiers(source)) {
        if (!isPackageInternalImport(specifier) || HARNESS_IMPORTS.has(specifier)) continue;

        const relativeFile = relative(process.cwd(), file).replaceAll('\\', '/');
        const reason = ALLOWED_INTERNAL_IMPORTS[relativeFile]?.[specifier];
        if (!reason) {
          violations.push(
            `${relativeFile} imports ${specifier}; use public app APIs or add a narrow allowlist reason.`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...sourceFiles(full));
    } else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function staticImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /import\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(importPattern)) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}

function isPackageInternalImport(specifier: string): boolean {
  return /^@kovojs\/[^/]+\/(?:internal|generated)(?:\/|$)/.test(specifier);
}
