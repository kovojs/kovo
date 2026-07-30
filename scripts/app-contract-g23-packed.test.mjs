import { describe, expect, it } from 'vitest';

import { analyzeAppContractG23 } from './app-contract-g23-gate.mjs';
import {
  assertPackedG23InstantiationBudget,
  packedG23ConsumerManifest,
  packedG23Corpora,
} from './app-contract-g23-packed.mjs';

describe('packed app-contract G23 acceptance', () => {
  it('selects the complete starter and advanced CRM corpora without the release sample', () => {
    const corpora = packedG23Corpora(analyzeAppContractG23());

    expect(corpora.map(({ fileCount, name }) => ({ fileCount, name }))).toEqual([
      { fileCount: 16, name: 'crm-advanced-example' },
      { fileCount: 14, name: 'packed-starter' },
    ]);
    expect(corpora.flatMap((corpus) => corpus.sourcePaths)).not.toEqual(
      expect.arrayContaining([
        'examples/crm/src/scaffold-app.tsx',
        'examples/crm/src/scaffold-kovo.ts',
        'examples/crm/src/scaffold-mutations.ts',
      ]),
    );
  });

  it('fails closed when either exact source census is narrowed', () => {
    const report = structuredClone(analyzeAppContractG23());
    const advanced = report.corpora.find((corpus) => corpus.name === 'crm-advanced-example');
    advanced.fileCount = 3;
    advanced.sourcePaths = advanced.sourcePaths.slice(0, 3);

    expect(() => packedG23Corpora(report)).toThrow(
      'Packed G23 crm-advanced-example source census drifted: expected 16, got 3.',
    );
  });

  it('rewrites direct and transitive Kovo dependencies to attested tarballs', () => {
    const packedPackages = [
      {
        name: '@kovojs/core',
        tarball: '.release/tarballs/kovojs-core-0.3.0.tgz',
      },
      {
        name: '@kovojs/server',
        tarball: '.release/tarballs/kovojs-server-0.3.0.tgz',
      },
    ];
    const manifest = packedG23ConsumerManifest({
      packageManager: 'pnpm@10.12.1',
      packedPackages,
      sourceManifest: {
        dependencies: {
          '@kovojs/core': 'workspace:*',
          'drizzle-orm': '1.0.0-rc.4',
        },
        devDependencies: {
          '@kovojs/server': '{{kovo_server_version}}',
        },
      },
      suffix: 'fixture',
    });

    expect(manifest.dependencies['@kovojs/core']).toMatch(/^file:.*kovojs-core-0\.3\.0\.tgz$/u);
    expect(manifest.devDependencies['@kovojs/server']).toMatch(
      /^file:.*kovojs-server-0\.3\.0\.tgz$/u,
    );
    expect(manifest.dependencies['drizzle-orm']).toBe('1.0.0-rc.4');
    expect(manifest.devDependencies.typescript).toBe('6.0.3');
    expect(Object.values(manifest.pnpm.overrides)).not.toEqual(
      expect.arrayContaining(['workspace:*']),
    );
  });

  it('rejects unresolved non-Kovo workspace dependencies', () => {
    expect(() =>
      packedG23ConsumerManifest({
        packageManager: 'pnpm@10.12.1',
        packedPackages: [],
        sourceManifest: {
          dependencies: { '@other/workspace': 'workspace:*' },
        },
        suffix: 'fixture',
      }),
    ).toThrow('Packed G23 cannot install unresolved dependency @other/workspace=workspace:*.');
  });

  it('applies the ratified app-contract instantiation ceiling to each packed corpus', () => {
    const typeBudget = { budgets: { instantiationsMaximum: 136_000 } };

    expect(() => assertPackedG23InstantiationBudget('packed-starter', 136_001, typeBudget)).toThrow(
      'Packed G23 packed-starter type instantiations 136001 exceed 136000.',
    );
    expect(() =>
      assertPackedG23InstantiationBudget('crm-advanced-example', 97_272, typeBudget),
    ).not.toThrow();
  });
});
