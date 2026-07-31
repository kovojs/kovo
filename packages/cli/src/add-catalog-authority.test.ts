import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedUiPackage = vi.hoisted(() => ({ root: '' }));

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire(url: string | URL) {
      const original = actual.createRequire(url);
      return new Proxy(original, {
        get(target, property, receiver) {
          if (property !== 'resolve') return Reflect.get(target, property, receiver);
          return (specifier: string, ...args: unknown[]) => {
            if (mockedUiPackage.root !== '' && specifier.startsWith('@kovojs/ui/')) {
              const name = specifier.slice('@kovojs/ui/'.length);
              return `${mockedUiPackage.root}/src/${name}.tsx`;
            }
            return Reflect.apply(original.resolve, original, [specifier, ...args]) as string;
          };
        },
      });
    },
  };
});

interface UiManifest {
  kovo: {
    vendoredSourceHashes: Record<string, string>;
    vendoredSourceHelperHashes: Record<string, string>;
  };
}

let testRoot = '';
let uiRoot = '';

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'kovo-add-catalog-authority-'));
  uiRoot = join(testRoot, 'ui');
  mkdirSync(uiRoot, { recursive: true });
  cpSync(new URL('../../ui/package.json', import.meta.url), join(uiRoot, 'package.json'));
  cpSync(new URL('../../ui/src', import.meta.url), join(uiRoot, 'src'), { recursive: true });
  mockedUiPackage.root = uiRoot;
  vi.resetModules();
});

afterEach(() => {
  mockedUiPackage.root = '';
  vi.resetModules();
  rmSync(testRoot, { force: true, recursive: true });
});

describe('kovo add catalog source authority', () => {
  it('rejects a safe-url helper hash mismatch before opening an output transaction', async () => {
    const safeUrlPath = join(uiRoot, 'src/safe-url.ts');
    writeFileSync(safeUrlPath, `${readFileSync(safeUrlPath, 'utf8')}\n// tampered\n`);
    const outDir = join(testRoot, 'app/src/components/ui');

    await expect(import('./commands/compile.js')).rejects.toThrow(
      /authenticated vendored helper source hash mismatch for src\/safe-url\.ts/,
    );

    expect(existsSync(outDir)).toBe(false);
    expect(readdirSync(testRoot).filter((name) => name.startsWith('.kovo-add-staging-'))).toEqual(
      [],
    );
  });

  it('rejects a public component hash mismatch', async () => {
    const buttonPath = join(uiRoot, 'src/button.tsx');
    writeFileSync(buttonPath, `${readFileSync(buttonPath, 'utf8')}\n// tampered\n`);

    await expect(import('./add-catalog.js')).rejects.toThrow(
      /authenticated vendored component source hash mismatch for src\/button\.tsx/,
    );
  });

  it.each([
    ['helper', 'safe-url.ts', 'safe-url-target.ts'],
    ['component', 'button.tsx', 'button-target.tsx'],
  ] as const)(
    'rejects a symlinked %s source even when its target bytes match',
    async (_, file, target) => {
      const sourcePath = join(uiRoot, 'src', file);
      const targetPath = join(uiRoot, 'src', target);
      writeFileSync(targetPath, readFileSync(sourcePath));
      rmSync(sourcePath);
      symlinkSync(target, sourcePath);
      vi.resetModules();

      await expect(import('./add-catalog.js')).rejects.toThrow(/bounded regular non-symlink file/);
    },
  );

  it.each([
    ['helper', 'safe-url.ts'],
    ['component', 'button.tsx'],
  ] as const)('rejects an oversized %s source before hashing it', async (_, file) => {
    writeFileSync(join(uiRoot, 'src', file), 'x'.repeat(2 * 1024 * 1024 + 1));
    vi.resetModules();

    await expect(import('./add-catalog.js')).rejects.toThrow(
      /could not be read within the source-size and non-symlink bounds/,
    );
  });

  it('rejects missing and extra helper hash authority', async () => {
    const manifest = readManifest();
    delete manifest.kovo.vendoredSourceHelperHashes['src/safe-url.ts'];
    writeManifest(manifest);

    await expect(import('./add-catalog.js')).rejects.toThrow(
      /relative import \.\/safe-url\.js is missing from the authenticated vendored source helper ledger/,
    );

    const extraSource = 'export const unused = true;\n';
    writeFileSync(join(uiRoot, 'src/unused-helper.ts'), extraSource);
    manifest.kovo.vendoredSourceHelperHashes['src/safe-url.ts'] = sourceHash(
      readFileSync(join(uiRoot, 'src/safe-url.ts'), 'utf8'),
    );
    manifest.kovo.vendoredSourceHelperHashes['src/unused-helper.ts'] = sourceHash(extraSource);
    writeManifest(manifest);
    vi.resetModules();

    await expect(import('./add-catalog.js')).rejects.toThrow(
      /relative helper import closure; this path is extra: src\/unused-helper\.ts/,
    );
  });

  it.each(['missing', 'extra'] as const)(
    'rejects %s public-component hash authority',
    async (mode) => {
      const manifest = readManifest();
      if (mode === 'missing') {
        delete manifest.kovo.vendoredSourceHashes.button;
      } else {
        manifest.kovo.vendoredSourceHashes.extra = manifest.kovo.vendoredSourceHashes.button ?? '';
      }
      writeManifest(manifest);

      await expect(import('./add-catalog.js')).rejects.toThrow(
        /vendoredSourceHashes must exactly cover the public component subpaths/,
      );
    },
  );
});

function readManifest(): UiManifest {
  return JSON.parse(readFileSync(join(uiRoot, 'package.json'), 'utf8')) as UiManifest;
}

function writeManifest(manifest: UiManifest): void {
  writeFileSync(join(uiRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function sourceHash(source: string): string {
  return `sha256-${createHash('sha256')
    .update(source.endsWith('\n') ? source : `${source}\n`)
    .digest('base64url')}`;
}
