import { describe, expect, it } from 'vitest';

import { exportedSymbolsReport, formatSymbolsText, packageExportEntries } from './exported-symbols.mjs';
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
});
