import { describe, expect, it } from 'vitest';

import { derivePublishPlan } from './build-publish.mjs';
import {
  importPathForPackageSubpath,
  normalizePackageExports,
  resolveExportTarget,
  resolveSourceExportTarget,
  sourceStem,
} from './package-exports.mjs';

describe('package export resolver', () => {
  it('normalizes root exports and subpath maps', () => {
    expect(normalizePackageExports('./src/index.ts')).toEqual({ '.': './src/index.ts' });
    expect(
      normalizePackageExports({
        '.': './src/index.ts',
        './build': './src/build.ts',
      }),
    ).toEqual({
      '.': './src/index.ts',
      './build': './src/build.ts',
    });
  });

  it('resolves conditional and array exports with source precedence', () => {
    expect(
      resolveSourceExportTarget({
        types: './dist/index.d.mts',
        default: './dist/index.mjs',
        source: './src/index.ts',
      }),
    ).toBe('./src/index.ts');

    expect(
      resolveSourceExportTarget([
        './dist/fallback.mjs',
        { development: './src/development.tsx', default: './dist/development.mjs' },
      ]),
    ).toBe('./src/development.tsx');

    expect(
      resolveSourceExportTarget({
        browser: { default: './dist/browser.mjs' },
        node: { import: './src/node.ts' },
      }),
    ).toBe('./src/node.ts');
  });

  it('distinguishes any resolved target from source-backed targets', () => {
    const target = {
      types: './dist/index.d.mts',
      default: './dist/index.mjs',
    };
    expect(resolveExportTarget(target)).toBe('./dist/index.mjs');
    expect(resolveSourceExportTarget(target)).toBeNull();
  });

  it('formats import paths and source stems deterministically', () => {
    expect(importPathForPackageSubpath('@kovojs/server', '.')).toBe('@kovojs/server');
    expect(importPathForPackageSubpath('@kovojs/server', './build')).toBe('@kovojs/server/build');
    expect(sourceStem('./src/internal/app-shell-vite.ts')).toBe('internal/app-shell-vite');
    expect(sourceStem('./src/button.tsx')).toBe('button');
  });

  it('drives publish plan entries, exports, and bin targets from the same resolver', () => {
    expect(
      derivePublishPlan({
        bin: {
          kovo: { source: './src/bin.ts', default: './dist/bin.mjs' },
        },
        exports: {
          '.': {
            source: './src/index.ts',
            types: './dist/index.d.mts',
            default: './dist/index.mjs',
          },
          './button': [{ default: './dist/button.mjs' }, { development: './src/button.tsx' }],
        },
      }),
    ).toEqual({
      entries: ['src/bin.ts', 'src/button.tsx', 'src/index.ts'],
      publishConfig: {
        bin: { kovo: './dist/bin.mjs' },
        exports: {
          '.': {
            types: './dist/index.d.mts',
            default: './dist/index.mjs',
          },
          './button': {
            types: './dist/button.d.mts',
            default: './dist/button.mjs',
          },
        },
      },
      targetFiles: [
        'dist/bin.mjs',
        'dist/button.d.mts',
        'dist/button.mjs',
        'dist/index.d.mts',
        'dist/index.mjs',
      ],
    });
  });
});
