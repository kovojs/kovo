import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { build as viteBuild, type Plugin } from 'vite-plus';

import {
  kovoFrameworkSourcePathFromTrustForTesting,
  kovoFrameworkSourcePathForTesting,
  kovoFrameworkSourceRootsForTesting,
  kovoFrameworkSourceTrustForTesting,
  kovoFrameworkSourceVitePluginForTesting,
} from './build-export.js';

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

function writePackedPackage(
  installRoot: string,
  name: string,
  dependencies: Readonly<Record<string, string>> = {},
): {
  readonly asset: string;
  readonly chunk: string;
  readonly entry: string;
  readonly root: string;
} {
  const packageRoot = join(installRoot, 'node_modules', ...name.split('/'));
  const distRoot = join(packageRoot, 'dist');
  mkdirSync(distRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ dependencies, main: './dist/index.mjs', name, type: 'module' }),
    'utf8',
  );
  const entry = join(distRoot, 'index.mjs');
  const chunk = join(distRoot, 'chunk-R4ND0M.mjs');
  const asset = join(distRoot, 'theme.css');
  writeFileSync(
    entry,
    "\ufeffimport './theme.css';\nexport { packed } from './chunk-R4ND0M.mjs';\n//# sourceMappingURL=index.mjs.map\n",
    'utf8',
  );
  writeFileSync(
    chunk,
    '\ufeffexport const packed = true;\n//# sourceMappingURL=chunk-R4ND0M.mjs.map\n',
    'utf8',
  );
  writeFileSync(
    asset,
    '\ufeff.packed { color: rebeccapurple; }\n/*# sourceMappingURL=theme.css.map */\n',
    'utf8',
  );
  writeFileSync(
    join(distRoot, 'index.mjs.map'),
    JSON.stringify({ file: 'index.mjs', mappings: '', names: [], sources: [], version: 3 }),
    'utf8',
  );
  writeFileSync(
    join(distRoot, 'chunk-R4ND0M.mjs.map'),
    JSON.stringify({
      file: 'chunk-R4ND0M.mjs',
      mappings: '',
      names: [],
      sources: ['chunk.ts'],
      sourcesContent: ['export const packed = true;\n'],
      version: 3,
    }),
    'utf8',
  );
  writeFileSync(
    join(distRoot, 'theme.css.map'),
    JSON.stringify({ file: 'theme.css', mappings: '', names: [], sources: [], version: 3 }),
    'utf8',
  );
  return { asset, chunk, entry, root: packageRoot };
}

async function viteBuildPackedFramework(
  root: string,
  entry: string,
  outDir: string,
  plugins: readonly Plugin[],
): Promise<void> {
  await viteBuild({
    build: {
      emptyOutDir: true,
      outDir,
      rollupOptions: { input: entry },
      sourcemap: true,
    },
    configFile: false,
    logLevel: 'silent',
    plugins: [...plugins],
    root,
  });
}

describe('Kovo framework source roots', () => {
  it('keeps the genuine workspace dependency chain trusted', () => {
    const cliEntry = realpathSync(join(process.cwd(), 'packages/cli/src/index.ts'));
    const serverEntry = realpathSync(createRequire(cliEntry).resolve('@kovojs/server'));
    const browserEntry = realpathSync(createRequire(serverEntry).resolve('@kovojs/browser'));

    const roots = kovoFrameworkSourceRootsForTesting(cliEntry);

    expect(roots).toContain(dirname(serverEntry));
    expect(roots).toContain(dirname(browserEntry));
  });

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

  it('does not trust a host-supplied Kovo peer dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-framework-peer-roots-'));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      const fakeDevtoolRoot = writePackage(root, '@kovojs/devtool');
      writeFileSync(
        join(serverRoot, 'package.json'),
        JSON.stringify({
          main: './index.js',
          name: '@kovojs/server',
          peerDependencies: { '@kovojs/devtool': '0.2.0' },
          type: 'module',
        }),
        'utf8',
      );

      // Peers are selected by the consuming app, so declaration alone cannot make one
      // framework-owned for the SPEC §5.2/§6.6 source exemption.
      expect(createRequire(join(serverRoot, 'index.js')).resolve('@kovojs/devtool')).toBe(
        realpathSync(join(fakeDevtoolRoot, 'index.js')),
      );

      const roots = kovoFrameworkSourceRootsForTesting(join(cliRoot, 'index.js'));

      expect(roots).not.toContain(dirname(realpathSync(join(fakeDevtoolRoot, 'index.js'))));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not trust a host-selected optional Kovo dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-framework-optional-roots-'));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      const fakeDevtoolRoot = writePackage(root, '@kovojs/devtool');
      writeFileSync(
        join(serverRoot, 'package.json'),
        JSON.stringify({
          main: './index.js',
          name: '@kovojs/server',
          optionalDependencies: { '@kovojs/devtool': '0.2.0' },
          type: 'module',
        }),
        'utf8',
      );

      const roots = kovoFrameworkSourceRootsForTesting(join(cliRoot, 'index.js'));

      expect(roots).not.toContain(dirname(realpathSync(join(fakeDevtoolRoot, 'index.js'))));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed on malformed declared dependency ranges', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-framework-malformed-deps-'));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      writeFileSync(
        join(serverRoot, 'package.json'),
        JSON.stringify({
          dependencies: { '@kovojs/devtool': { attacker: true } },
          main: './index.js',
          name: '@kovojs/server',
          type: 'module',
        }),
        'utf8',
      );

      expect(() => kovoFrameworkSourceRootsForTesting(join(cliRoot, 'index.js'))).toThrow(
        /must be a string/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not let a trusted package root absorb an undeclared nested package', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-framework-nested-roots-'));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      const fakeDevtoolRoot = writePackage(serverRoot, '@kovojs/devtool');
      const fakeDevtoolEntry = realpathSync(join(fakeDevtoolRoot, 'index.js'));

      // The fake package is not in the declared graph, even though it sits lexically below the
      // trusted server entry directory.
      expect(createRequire(join(serverRoot, 'index.js')).resolve('@kovojs/devtool')).toBe(
        fakeDevtoolEntry,
      );
      expect(kovoFrameworkSourceRootsForTesting(join(cliRoot, 'index.js'))).not.toContain(
        dirname(fakeDevtoolEntry),
      );

      expect(kovoFrameworkSourcePathForTesting(join(cliRoot, 'index.js'), fakeDevtoolEntry)).toBe(
        false,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('still accepts a nested package through its own declared root', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-declared-nested-')));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server', { '@kovojs/devtool': '0.2.0' });
      const devtoolRoot = writePackage(serverRoot, '@kovojs/devtool');
      const devtoolEntry = realpathSync(join(devtoolRoot, 'index.js'));

      expect(kovoFrameworkSourceRootsForTesting(join(cliRoot, 'index.js'))).toContain(
        dirname(devtoolEntry),
      );
      expect(kovoFrameworkSourcePathForTesting(join(cliRoot, 'index.js'), devtoolEntry)).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not trust an external source through a symlinked descendant', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-symlink-roots-')));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      const externalSource = join(root, 'app-owned.ts');
      const linkedSource = join(serverRoot, 'linked.ts');
      writeFileSync(externalSource, 'export const appOwned = true;\n', 'utf8');
      symlinkSync(externalSource, linkedSource);

      expect(realpathSync(linkedSource)).toBe(realpathSync(externalSource));
      expect(kovoFrameworkSourcePathForTesting(join(cliRoot, 'index.js'), linkedSource)).toBe(
        false,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not follow a trusted root that is retargeted after bootstrap', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-retargeted-root-')));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      const trust = kovoFrameworkSourceTrustForTesting(join(cliRoot, 'index.js'));
      const roots = kovoFrameworkSourceRootsForTesting(join(cliRoot, 'index.js'));
      const movedServerRoot = join(root, 'original-server');
      const appOwnedRoot = join(root, 'app-owned-root');
      const appOwnedSource = join(appOwnedRoot, 'app-owned.ts');
      renameSync(serverRoot, movedServerRoot);
      mkdirSync(appOwnedRoot);
      writeFileSync(appOwnedSource, 'export const appOwned = true;\n', 'utf8');
      symlinkSync(appOwnedRoot, serverRoot, 'dir');

      expect(roots).toContain(serverRoot);
      expect(realpathSync(join(serverRoot, 'app-owned.ts'))).toBe(realpathSync(appOwnedSource));
      expect(
        kovoFrameworkSourcePathFromTrustForTesting(trust, join(serverRoot, 'app-owned.ts')),
      ).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not trust a replacement directory at a boot-pinned root path', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-replaced-root-')));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      const trust = kovoFrameworkSourceTrustForTesting(join(cliRoot, 'index.js'));
      const roots = kovoFrameworkSourceRootsForTesting(join(cliRoot, 'index.js'));
      renameSync(serverRoot, join(root, 'original-server'));
      mkdirSync(serverRoot);
      const replacementSource = join(serverRoot, 'app-owned.ts');
      writeFileSync(replacementSource, 'export const appOwned = true;\n', 'utf8');

      expect(roots).toContain(serverRoot);
      expect(kovoFrameworkSourcePathFromTrustForTesting(trust, replacementSource)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not trust a new source introduced into a framework root after bootstrap', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-new-source-')));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      const trust = kovoFrameworkSourceTrustForTesting(join(cliRoot, 'index.js'));
      const introducedSource = join(serverRoot, 'introduced-after-bootstrap.ts');
      writeFileSync(introducedSource, 'export const appOwned = true;\n', 'utf8');

      expect(kovoFrameworkSourcePathFromTrustForTesting(trust, introducedSource)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('pins packed dist chunks and assets to their boot-time bytes', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-packed-files-')));
    try {
      const cli = writePackedPackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const server = writePackedPackage(root, '@kovojs/server');
      const trust = kovoFrameworkSourceTrustForTesting(cli.entry);

      expect(kovoFrameworkSourcePathFromTrustForTesting(trust, server.chunk)).toBe(true);
      expect(kovoFrameworkSourcePathFromTrustForTesting(trust, server.asset)).toBe(true);

      writeFileSync(server.chunk, 'export const packed = false;\n', 'utf8');
      writeFileSync(server.asset, '.packed { color: red; }\n', 'utf8');

      expect(kovoFrameworkSourcePathFromTrustForTesting(trust, server.chunk)).toBe(false);
      expect(kovoFrameworkSourcePathFromTrustForTesting(trust, server.asset)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('passes byte-exact packed chunks and text assets through the real Vite transform path', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-packed-vite-')));
    try {
      const cli = writePackedPackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const server = writePackedPackage(root, '@kovojs/server');
      const observed = new Map<string, string>();
      const observedPaths = new Set([server.entry, server.chunk, server.asset]);
      const observer: Plugin = {
        enforce: 'pre',
        name: 'observe-post-kovo-security-source',
        transform(code, id) {
          const fileName = id.replace(/[?#].*$/u, '');
          if (observedPaths.has(fileName)) observed.set(fileName, code);
          return null;
        },
      };

      await viteBuildPackedFramework(root, server.entry, join(root, 'out'), [
        kovoFrameworkSourceVitePluginForTesting(cli.entry, root),
        observer,
      ]);

      for (const fileName of observedPaths) {
        const source = observed.get(fileName);
        expect(source, `Vite did not transform ${fileName}`).toBeDefined();
        expect(Buffer.from(source!, 'utf8')).toEqual(readFileSync(fileName));
        expect(source!.charCodeAt(0)).toBe(0xfeff);
        expect(source).toContain('sourceMappingURL=');
      }
      expect(
        kovoFrameworkSourcePathForTesting(cli.entry, join(server.root, 'dist/index.mjs.map')),
      ).toBe(true);
      expect(
        kovoFrameworkSourcePathForTesting(cli.entry, join(server.root, 'dist/theme.css.map')),
      ).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects changed packed chunk bytes through the real Vite transform path', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-mutated-vite-')));
    try {
      const cli = writePackedPackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const server = writePackedPackage(root, '@kovojs/server');
      const securityPlugin = kovoFrameworkSourceVitePluginForTesting(cli.entry, root);
      writeFileSync(server.chunk, 'export const packed = false;\n', 'utf8');

      await expect(
        viteBuildPackedFramework(root, server.entry, join(root, 'out'), [securityPlugin]),
      ).rejects.toThrow(/refused changed framework source/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('detects mutation through a hardlinked alias after bootstrap', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-hardlink-')));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      const serverEntry = join(serverRoot, 'index.js');
      const alias = join(root, 'app-owned-hardlink.js');
      const trust = kovoFrameworkSourceTrustForTesting(join(cliRoot, 'index.js'));
      linkSync(serverEntry, alias);
      writeFileSync(alias, 'export const packageMarker = false;\n', 'utf8');

      expect(kovoFrameworkSourcePathFromTrustForTesting(trust, serverEntry)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed when a declared package exceeds the snapshot byte cap', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-byte-cap-')));
    try {
      const cliRoot = writePackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const serverRoot = writePackage(root, '@kovojs/server');
      const oversized = join(serverRoot, 'oversized.bin');
      writeFileSync(oversized, '', 'utf8');
      truncateSync(oversized, 16 * 1024 * 1024 + 1);

      expect(() => kovoFrameworkSourceRootsForTesting(join(cliRoot, 'index.js'))).toThrow(
        /file byte limit/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
