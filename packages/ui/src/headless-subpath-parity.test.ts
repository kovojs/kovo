import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const srcDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(srcDir);
const repoRoot = dirname(dirname(pkgRoot));

function jsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('@kovojs/ui headless-ui subpath parity', () => {
  it('imports headless behavior through direct public family subpaths', () => {
    const headlessPackage = jsonFile<{ exports: Record<string, string> }>(
      join(repoRoot, 'packages/headless-ui/package.json'),
    );
    const publicPackages = jsonFile<{
      packages: Array<{
        apiBoundary?: { public?: string[] };
        name: string;
      }>;
    }>(join(repoRoot, 'public-packages.json'));
    const headlessManifest = publicPackages.packages.find(
      (pkg) => pkg.name === '@kovojs/headless-ui',
    );
    const publicSubpaths = new Set(headlessManifest?.apiBoundary?.public ?? []);
    const directImports = new Map<string, Set<string>>();

    for (const fileName of readdirSync(srcDir).filter((entry) => entry.endsWith('.tsx'))) {
      const source = readFileSync(join(srcDir, fileName), 'utf8');
      expect(source, `${fileName} must not import the retired primitive namespace`).not.toContain(
        '@kovojs/headless-ui/primitives',
      );

      for (const match of source.matchAll(/@kovojs\/headless-ui\/([a-z0-9-]+)/g)) {
        const family = match[1];
        if (family === undefined) continue;
        const files = directImports.get(family) ?? new Set<string>();
        files.add(fileName);
        directImports.set(family, files);
      }
    }

    expect([...directImports.keys()].sort()).toEqual([
      'accordion',
      'alert-dialog',
      'autocomplete',
      'avatar',
      'checkbox',
      'checkbox-group',
      'collapsible',
      'combobox',
      'command',
      'context-menu',
      'dialog',
      'disclosure',
      'dropdown-menu',
      'field',
      'hover-card',
      'menubar',
      'meter',
      'navigation-menu',
      'number-field',
      'otp-field',
      'popover',
      'progress',
      'radio-group',
      'scroll-area',
      'select',
      'separator',
      'slider',
      'switch',
      'tabs',
      'toast',
      'toggle',
      'toggle-group',
      'toolbar',
      'tooltip',
    ]);

    for (const [family, files] of directImports) {
      const subpath = `./${family}`;
      expect(headlessPackage.exports, `${family} imported by ${[...files].join(', ')}`).toHaveProperty(
        subpath,
      );
      expect(publicSubpaths, `${family} must be public in public-packages.json`).toContain(subpath);
    }
  });
});
