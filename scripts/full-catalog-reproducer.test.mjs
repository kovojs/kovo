import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FULL_CATALOG_REPORT_SCHEMA,
  FULL_CATALOG_SAMPLE_SCHEMA,
  assertCatalogUnimported,
  assertCopiedCatalog,
  declarePackedCatalogDependencies,
  fullCatalogBudget,
  fullCatalogCreatorCommand,
  packedUiComponentNames,
  requireCatalogPhaseSuccess,
  validateFullCatalogReport,
} from './full-catalog-reproducer.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const uiManifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'packages/ui/package.json'), 'utf8'),
);
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'devex-budgets.json'), 'utf8'));

describe('packed full-catalog reproducer', () => {
  it('derives the exact 44-component census from the authenticated packed UI manifest', () => {
    const names = packedUiComponentNames(new Map([['@kovojs/ui', { manifest: uiManifest }]]));

    expect(names).toHaveLength(44);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('accordion');
    expect(names).toContain('toolbar');

    const missing = structuredClone(uiManifest);
    delete missing.exports['./toolbar'];
    expect(() => packedUiComponentNames(new Map([['@kovojs/ui', { manifest: missing }]]))).toThrow(
      'must expose exactly 44 component subpaths; found 43',
    );

    const forged = structuredClone(uiManifest);
    forged.exports['./internal/not-a-component'] = './dist/nope.js';
    expect(() => packedUiComponentNames(new Map([['@kovojs/ui', { manifest: forged }]]))).toThrow(
      'non-component public subpath',
    );
  });

  it('proves every expected copy exists while app-authored source leaves the copies unimported', () => {
    const appRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-catalog-proof-'));
    try {
      const output = path.join(appRoot, 'src/components/ui');
      mkdirSync(output, { recursive: true });
      const components = packedUiComponentNames(
        new Map([['@kovojs/ui', { manifest: uiManifest }]]),
      );
      for (const component of components) {
        writeFileSync(path.join(output, `${component}.tsx`), 'export {};\n');
      }
      writeFileSync(path.join(appRoot, 'src/app.tsx'), 'export const app = 1;\n');

      expect(() => assertCopiedCatalog(appRoot, 'src/components/ui', components)).not.toThrow();
      expect(() => assertCatalogUnimported(appRoot, 'src/components/ui')).not.toThrow();

      writeFileSync(
        path.join(appRoot, 'src/app.tsx'),
        "import { Button } from './components/ui/button';\nexport { Button };\n",
      );
      expect(() => assertCatalogUnimported(appRoot, 'src/components/ui')).toThrow(
        'imports copied UI',
      );
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it('keeps the provisional 2 GiB target non-binding and makes ratification binding', () => {
    expect(fullCatalogBudget(budgets)).toEqual({
      binding: false,
      source: 'provisional',
      thresholdBytes: 2 * 1024 * 1024 * 1024,
    });

    const ratified = structuredClone(budgets);
    ratified.metrics['ui.fullCatalog.peakRssBytes'].ratification = {
      threshold: 1_900_000_000,
    };
    expect(fullCatalogBudget(ratified)).toEqual({
      binding: true,
      source: 'ratified',
      thresholdBytes: 1_900_000_000,
    });
  });

  it('gives the production-build fixture an explicit retained deployment posture', () => {
    expect(fullCatalogCreatorCommand('/packed/create-kovo.mjs', '/tmp/catalog-app', 2)).toEqual([
      process.execPath,
      '/packed/create-kovo.mjs',
      '/tmp/catalog-app',
      '--name',
      'kovo-full-catalog-3',
      '--postgres',
      '--retention',
      'retained-24h',
      '--disable-git',
    ]);
  });

  it('retains failed-phase timing and process-tree RSS as reportable evidence', () => {
    const failed = {
      durationMs: 600_002,
      peakRssBytes: 3_000_000_000,
      exitCode: null,
      signal: 'SIGKILL',
      error: 'command exceeded 600000ms',
      stderr: '',
      stdout: '',
    };

    let failure;
    try {
      requireCatalogPhaseSuccess('check', failed);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      evidence: {
        durationMs: 600_002,
        name: 'check',
        peakProcessTreeRssBytes: 3_000_000_000,
        status: null,
      },
      phase: 'check',
    });
  });

  it('isolates the catalog check by predeclaring its two authenticated source dependencies', () => {
    const appRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-catalog-dependencies-'));
    try {
      writeFileSync(
        path.join(appRoot, 'package.json'),
        '{"dependencies":{"@kovojs/core":"0.2.0"}}\n',
      );
      declarePackedCatalogDependencies(
        appRoot,
        new Map([
          ['@kovojs/headless-ui', { tarballPath: '/packed/headless-ui.tgz' }],
          ['@kovojs/icons', { tarballPath: '/packed/icons.tgz' }],
        ]),
      );
      const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
      expect(manifest.dependencies).toEqual({
        '@kovojs/core': '0.2.0',
        '@kovojs/headless-ui': 'file:///packed/headless-ui.tgz',
        '@kovojs/icons': 'file:///packed/icons.tgz',
      });
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it('rejects incomplete, forged, and non-fail-closed report evidence', () => {
    const report = validReport();
    expect(validateFullCatalogReport(report)).toEqual([]);

    const incomplete = structuredClone(report);
    incomplete.samples[0].phases = incomplete.samples[0].phases.filter(
      (phase) => phase.name !== 'build',
    );
    expect(validateFullCatalogReport(incomplete)).toContain(
      'samples[0] is missing successful build',
    );

    const forgedMetric = structuredClone(report);
    forgedMetric.metrics['ui.fullCatalog.peakRssBytes'].samples[0] += 1;
    expect(validateFullCatalogReport(forgedMetric)).toContain(
      'full-catalog metric samples do not match sample evidence',
    );

    const ignoredBinding = structuredClone(report);
    ignoredBinding.samples[0].budget.binding = true;
    ignoredBinding.samples[0].budget.withinThreshold = false;
    expect(validateFullCatalogReport(ignoredBinding)).toContain(
      'samples[0].budget does not match report threshold and observed peak',
    );
    expect(validateFullCatalogReport(ignoredBinding)).toContain(
      'samples[0] does not enforce functional and binding RSS outcomes',
    );

    const duplicateComponent = structuredClone(report);
    duplicateComponent.catalog.components[1] = duplicateComponent.catalog.components[0];
    expect(validateFullCatalogReport(duplicateComponent)).toContain(
      'catalog must contain exactly 44 unique sorted authenticated components',
    );

    const forgedPackages = structuredClone(report);
    forgedPackages.packageSet = forgedPackages.packageSet.filter(
      (pkg) => pkg.name !== '@kovojs/ui',
    );
    expect(validateFullCatalogReport(forgedPackages)).toContain('packageSet omits @kovojs/ui');
  });
});

function validReport() {
  const components = packedUiComponentNames(new Map([['@kovojs/ui', { manifest: uiManifest }]]));
  const phases = ['create', 'install', 'copy', 'typecheck', 'check', 'build'].map((name) => ({
    durationMs: 1,
    name,
    peakProcessTreeRssBytes: 1024,
    status: 0,
  }));
  const sample = {
    schema: FULL_CATALOG_SAMPLE_SCHEMA,
    sampleIndex: 0,
    copiedComponents: 44,
    copiedSourceFiles: 44,
    unimportedDuringProof: true,
    phases,
    peakProcessTreeRssBytes: 1024,
    budget: {
      binding: false,
      thresholdBytes: 2 * 1024 * 1024 * 1024,
      withinThreshold: true,
    },
    functionalPass: true,
    pass: true,
    failure: null,
  };
  return {
    schema: FULL_CATALOG_REPORT_SCHEMA,
    packageSet: [
      '@kovojs/core',
      '@kovojs/headless-ui',
      '@kovojs/icons',
      '@kovojs/ui',
      'create-kovo',
    ].map((name) => ({ name, sha512: 'sha512-YQ==', version: '0.2.0' })),
    catalog: {
      componentCount: 44,
      components,
      source: '@kovojs/ui packed manifest exports',
    },
    budget: fullCatalogBudget(budgets),
    sampleCount: 1,
    samples: [sample],
    metrics: {
      'ui.fullCatalog.peakRssBytes': {
        samples: [1024],
        unit: 'bytes',
      },
    },
    pass: true,
  };
}
