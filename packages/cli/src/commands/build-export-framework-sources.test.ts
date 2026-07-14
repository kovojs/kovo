import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { kovoFrameworkSourceRootsForTesting } from './build-export.js';

function writePackage(
  installRoot: string,
  name: string,
  dependencies: Readonly<Record<string, string>> = {},
): string {
  const packageRoot = join(installRoot, 'node_modules', ...name.split('/'));
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ dependencies, main: './index.js', name, type: 'module' }),
    'utf8',
  );
  writeFileSync(join(packageRoot, 'index.js'), 'export const packageMarker = true;\n', 'utf8');
  return packageRoot;
}

describe('Kovo framework source roots', () => {
  it('follows only declared packed dependencies and rejects an app-planted Kovo name', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-framework-roots-'));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server', { '@kovojs/browser': '0.2.0' });
      const browserRoot = writePackage(root, '@kovojs/browser');
      const fakeDevtoolRoot = writePackage(root, '@kovojs/devtool');

      // This is the old bypass: the real server resolver can see the app's undeclared sibling.
      expect(createRequire(join(serverRoot, 'index.js')).resolve('@kovojs/devtool')).toBe(
        realpathSync(join(fakeDevtoolRoot, 'index.js')),
      );

      const roots = kovoFrameworkSourceRootsForTesting(join(cliRoot, 'index.js'));

      expect(roots).toContain(dirname(realpathSync(join(serverRoot, 'index.js'))));
      expect(roots).toContain(dirname(realpathSync(join(browserRoot, 'index.js'))));
      expect(roots).not.toContain(dirname(realpathSync(join(fakeDevtoolRoot, 'index.js'))));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
