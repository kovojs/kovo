import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { importSpecifiers, nonPublicKovoImportTier } from '../scripts/import-boundary.mjs';

const ROOT = 'tests/integration';

const HARNESS_IMPORTS = new Set([
  '@kovojs/test/internal/integration',
  '@kovojs/test/internal/integration/define',
  '@kovojs/test/internal/integration/fixture-abi',
  '@kovojs/test/internal/integration/fixture-browser-abi',
  '@kovojs/test/internal/integration/optimistic-client',
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

const EXPECTED_ALLOWED_INTERNAL_IMPORTS = Object.entries(ALLOWED_INTERNAL_IMPORTS).flatMap(
  ([file, imports]) => Object.keys(imports).map((specifier) => `${file} imports ${specifier}`),
);

describe('integration import boundary', () => {
  it('requires non-harness package-internal imports to be explicitly allowlisted', () => {
    const violations: string[] = [];
    const allowed: string[] = [];

    for (const file of sourceFiles(ROOT)) {
      const source = readFileSync(file, 'utf8');
      const relativeFile = relative(process.cwd(), file).replaceAll('\\', '/');
      for (const specifier of importSpecifiers(source, { fileName: relativeFile })) {
        if (nonPublicKovoImportTier(specifier) === null || HARNESS_IMPORTS.has(specifier)) {
          continue;
        }

        const reason = ALLOWED_INTERNAL_IMPORTS[relativeFile]?.[specifier];
        if (!reason) {
          violations.push(
            `${relativeFile} imports ${specifier}; use public app APIs or add a narrow allowlist reason.`,
          );
        } else {
          allowed.push(`${relativeFile} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
    expect(allowed.sort()).toEqual(EXPECTED_ALLOWED_INTERNAL_IMPORTS.sort());
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
