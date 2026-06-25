import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = 'tests/integration';
const EXPECTED_ALLOWED_INTERNAL_IMPORTS = 55;

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

const LEGACY_FIXTURE_IMPORT_RULES: readonly {
  file: RegExp;
  reason: string;
  specifier: RegExp;
}[] = [
  {
    file: /^tests\/integration\/fixtures\/[^/]+\/app\.tsx$/,
    reason:
      'Legacy fixture app-source uses server internals until the lowered-IR/public fixture migration is complete.',
    specifier: /^@kovojs\/server\/internal\/(?:html|execution)$/,
  },
  {
    file: /^tests\/integration\/fixtures\/[^/]+\/client\.ts$/,
    reason:
      'Legacy fixture client glue uses browser internals until compiler-emitted wiring replaces it.',
    specifier: /^@kovojs\/browser\/(?:generated|internal\/(?:inline-loader|morph|mutation))$/,
  },
  {
    file: /^tests\/integration\/fixtures\/storage-download-route\/app\.tsx$/,
    reason: 'Storage capability fixture validates the internal storage adapter contract.',
    specifier: /^@kovojs\/core\/internal\/storage$/,
  },
  {
    file: /^tests\/integration\/fixtures\/webhook-idempotency\/app\.tsx$/,
    reason: 'Webhook fixture validates the internal mutation wire header sanitizer contract.',
    specifier: /^@kovojs\/server\/internal\/wire$/,
  },
];

describe('integration import boundary', () => {
  it('requires non-harness package-internal imports to be explicitly allowlisted', () => {
    const violations: string[] = [];
    const allowed: string[] = [];

    for (const file of sourceFiles(ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of staticImportSpecifiers(source)) {
        if (!isPackageInternalImport(specifier) || HARNESS_IMPORTS.has(specifier)) continue;

        const relativeFile = relative(process.cwd(), file).replaceAll('\\', '/');
        const reason =
          ALLOWED_INTERNAL_IMPORTS[relativeFile]?.[specifier] ??
          legacyFixtureImportReason(relativeFile, specifier);
        if (!reason) {
          violations.push(
            `${relativeFile} imports ${specifier}; use public app APIs or add a narrow allowlist reason.`,
          );
        } else {
          allowed.push(`${relativeFile} imports ${specifier}: ${reason}`);
        }
      }
    }

    expect(violations).toEqual([]);
    expect(allowed).toHaveLength(EXPECTED_ALLOWED_INTERNAL_IMPORTS);
  });

  it('fails closed for a new fixture internal import', () => {
    expect(
      legacyFixtureImportReason(
        'tests/integration/fixtures/example/client.ts',
        '@kovojs/browser/internal/new-abi',
      ),
    ).toBeUndefined();
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

function legacyFixtureImportReason(relativeFile: string, specifier: string): string | undefined {
  return LEGACY_FIXTURE_IMPORT_RULES.find(
    (rule) => rule.file.test(relativeFile) && rule.specifier.test(specifier),
  )?.reason;
}
