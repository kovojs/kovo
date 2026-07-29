import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildExampleAssets,
  validateExampleSourceCatalog,
  validateExampleSourceInventory,
} from '../scripts/build-example-assets.mjs';
import {
  CREATE_KOVO_EXAMPLE_SOURCE_CATALOG,
  readKovoExampleSourceFiles,
} from './example-assets.js';

describe('create-kovo example assets', () => {
  it('builds a deterministic, integrity-bound payload from every accounted tracked source', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-example-assets-'));
    try {
      const firstRoot = join(root, 'first');
      const secondRoot = join(root, 'second');
      const first = buildExampleAssets({ outputRoot: firstRoot });
      const second = buildExampleAssets({ outputRoot: secondRoot });
      expect(first).toEqual(second);
      expect(first.examples.crm.files).toHaveLength(
        CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples.crm.sources.length,
      );
      expect(first.examples.commerce.files).toHaveLength(
        CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples.commerce.sources.length,
      );

      for (const example of ['crm', 'commerce'] as const) {
        const copied = readKovoExampleSourceFiles(example, { assetRoot: firstRoot });
        for (const file of copied) {
          expect(file.source).toBe(
            readFileSync(join(process.cwd(), 'examples', example, file.path), 'utf8'),
          );
        }
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects unaccounted and missing tracked files as source drift', () => {
    const example = CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples.crm;
    const tracked = [...example.sources, ...example.excluded.map((entry) => entry.path)];
    expect(() =>
      validateExampleSourceInventory('crm', example, [...tracked, 'src/new-feature.ts']),
    ).toThrow('Unaccounted tracked files: src/new-feature.ts');
    expect(() =>
      validateExampleSourceInventory(
        'crm',
        example,
        tracked.filter((path) => path !== 'src/model.ts'),
      ),
    ).toThrow('Catalog paths not tracked: src/model.ts');
  });

  it('rejects traversal and secret-shaped material before packaging', () => {
    const invalidCatalog = {
      ...CREATE_KOVO_EXAMPLE_SOURCE_CATALOG,
      examples: {
        ...CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples,
        crm: {
          ...CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples.crm,
          sources: [
            '../secret.ts',
            ...CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples.crm.sources.slice(1),
          ],
        },
      },
    };
    expect(() => validateExampleSourceCatalog(invalidCatalog)).toThrow(
      'Unsafe create-kovo example source path: ../secret.ts',
    );

    const root = mkdtempSync(join(tmpdir(), 'create-kovo-example-secret-'));
    try {
      cpSync(join(process.cwd(), 'examples'), join(root, 'examples'), { recursive: true });
      writeFileSync(
        join(root, 'examples/crm/src/scaffold-kovo.ts'),
        'KOVO_CSRF_SECRET=committed-secret-value\n',
        'utf8',
      );
      expect(() =>
        buildExampleAssets({
          outputRoot: join(root, 'output'),
          repositoryRoot: root,
          trackedFiles: (exampleName) => {
            const definition = CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples[exampleName];
            return [...definition.sources, ...definition.excluded.map((entry) => entry.path)];
          },
        }),
      ).toThrow(
        'create-kovo example crm source contains secret-shaped material: src/scaffold-kovo.ts',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed when a packed source no longer matches its manifest digest', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-example-tamper-'));
    try {
      buildExampleAssets({ outputRoot: root });
      writeFileSync(
        join(root, 'crm/src/scaffold-app.tsx'),
        'export const tampered = true;\n',
        'utf8',
      );
      expect(() => readKovoExampleSourceFiles('crm', { assetRoot: root })).toThrow(
        'Bundled create-kovo example source failed integrity: crm/src/scaffold-app.tsx',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
