import { describe, expect, it } from 'vitest';

import {
  duplicatePublicSymbolsReport,
  exportedSymbolsReport,
  formatDuplicateSymbolsText,
  formatSymbolsText,
  packageExportEntries,
} from './exported-symbols.mjs';
import { publicPackages } from './public-packages.mjs';

describe('exported-symbols script', () => {
  it('discovers package export paths backed by TS/TSX source', () => {
    expect(packageExportEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: '@kovojs/core',
          subpath: '.',
          importPath: '@kovojs/core',
          source: 'packages/core/src/index.ts',
        }),
        expect.objectContaining({
          packageName: '@kovojs/ui',
          subpath: './button',
          importPath: '@kovojs/ui/button',
          source: 'packages/ui/src/button.tsx',
        }),
      ]),
    );
  });

  it('reports real TypeScript module symbols grouped by package and export path', () => {
    const report = exportedSymbolsReport();
    const corePackage = report.packages.find((pkg) => pkg.name === '@kovojs/core');
    const coreRoot = corePackage?.exports.find((entry) => entry.subpath === '.');

    expect(coreRoot?.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'component' }),
        expect.objectContaining({ name: 'route' }),
      ]),
    );
  });

  it('keeps @kovojs/ui component symbols on component subpaths', () => {
    const report = exportedSymbolsReport();
    const uiPackage = report.packages.find((pkg) => pkg.name === '@kovojs/ui');
    const uiRoot = uiPackage?.exports.find((entry) => entry.subpath === '.');
    const uiButton = uiPackage?.exports.find((entry) => entry.subpath === './button');
    const uiSelect = uiPackage?.exports.find((entry) => entry.subpath === './select');
    const headlessSelect = report.packages
      .find((pkg) => pkg.name === '@kovojs/headless-ui')
      ?.exports.find((entry) => entry.subpath === './select');

    expect(uiRoot?.symbols).toEqual([]);
    expect(uiButton?.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Button' })]),
    );
    expect(uiSelect?.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Select' })]),
    );
    expect(headlessSelect?.importPath).toBe('@kovojs/headless-ui/select');
  });

  it('keeps provider-specific names out of public package exports', () => {
    const publicPackageNames = new Set(publicPackages().map((pkg) => pkg.name));
    const providerNamePattern = /stripe/iu;
    const leakedSymbols = exportedSymbolsReport().packages.flatMap((pkg) => {
      if (!publicPackageNames.has(pkg.name)) return [];
      return pkg.exports.flatMap((entry) =>
        entry.symbols
          .filter((symbol) => providerNamePattern.test(symbol.name))
          .map((symbol) => `${entry.importPath}#${symbol.name}`),
      );
    });

    expect(leakedSymbols).toEqual([]);
  });

  it('formats a compact text view', () => {
    expect(
      formatSymbolsText({
        packages: [
          {
            name: '@example/pkg',
            dir: 'pkg',
            exports: [
              {
                subpath: '.',
                importPath: '@example/pkg',
                source: 'packages/pkg/src/index.ts',
                symbols: [{ name: 'thing', kind: 'value' }],
              },
            ],
          },
        ],
      }),
    ).toBe('@example/pkg\n  @example/pkg (packages/pkg/src/index.ts)\n    thing [value]\n');
  });

  it('detects duplicate symbols across public import paths for the same package', () => {
    expect(
      duplicatePublicSymbolsReport({
        packages: [
          {
            name: '@kovojs/server',
            dir: 'packages/server',
            exports: [
              {
                subpath: '.',
                importPath: '@kovojs/server',
                source: 'packages/server/src/index.ts',
                symbols: [{ name: 'createApp', kind: 'value' }],
              },
              {
                subpath: './app-shell/static-export',
                importPath: '@kovojs/server/app-shell/static-export',
                source: 'packages/server/src/api/app-shell/static-export.ts',
                symbols: [{ name: 'createApp', kind: 'value' }],
              },
              {
                subpath: './internal/app-shell-vite',
                importPath: '@kovojs/server/internal/app-shell-vite',
                source: 'packages/server/src/internal/app-shell-vite.ts',
                symbols: [{ name: 'createApp', kind: 'value' }],
              },
            ],
          },
        ],
      }).duplicates,
    ).toEqual([
      {
        packageName: '@kovojs/server',
        symbol: 'createApp',
        homes: [
          { importPath: '@kovojs/server', kind: 'value', subpath: '.' },
          {
            importPath: '@kovojs/server/app-shell/static-export',
            kind: 'value',
            subpath: './app-shell/static-export',
          },
        ],
      },
    ]);
  });

  it('formats duplicate public symbols with every public home', () => {
    expect(
      formatDuplicateSymbolsText({
        duplicates: [
          {
            packageName: '@example/pkg',
            symbol: 'Thing',
            homes: [
              { importPath: '@example/pkg', kind: 'type', subpath: '.' },
              { importPath: '@example/pkg/thing', kind: 'type', subpath: './thing' },
            ],
          },
        ],
      }),
    ).toBe('@example/pkg#Thing: @example/pkg [type], @example/pkg/thing [type]\n');
  });
});
