import {
  existsSync,
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
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { build as viteBuild, createServer as createViteServer, type Plugin } from 'vite-plus';

import {
  approvedBuildSourcesVitePluginForTesting,
  cloudflareManagedSqlParserSourceForTesting,
  cloudflareSqlParserAuthorityReplacementForTesting,
  cloudflareUnavailableDgramFloorImportForTesting,
  cloudflareUnavailableDrizzlePgliteImportForTesting,
  cloudflareUnavailablePgliteImportForTesting,
  cloudflareUnavailablePgliteModuleSourceForTesting,
  generatedHandlerRuntimeHrefForTesting,
  kovoFrameworkSourcePathFromTrustForTesting,
  kovoFrameworkSourcePathForTesting,
  kovoFrameworkSourceRootsForTesting,
  kovoFrameworkSourceTrustForTesting,
  kovoFrameworkSourceVitePluginForTesting,
  kovoServerHandlerExternalDependencyForTesting,
  kovoServerHandlerModuleSideEffectFreeForTesting,
} from './build-export.js';

function declaredWorkspaceKovoDependencyEntries(entry: string, packageName: string): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  const pending = [{ entry, packageName }];
  for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
    const context = pending[pendingIndex]!;
    let directory = dirname(context.entry);
    let manifest: { dependencies?: Record<string, string>; name?: string } | undefined;
    for (let depth = 0; depth < 64; depth += 1) {
      const manifestPath = join(directory, 'package.json');
      if (existsSync(manifestPath)) {
        const candidate = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
        if (candidate?.name === context.packageName) manifest = candidate;
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    expect(manifest?.name).toBe(context.packageName);
    for (const dependencyName of Object.keys(manifest?.dependencies ?? {}).sort()) {
      if (!dependencyName.startsWith('@kovojs/')) continue;
      let dependencyEntry: string;
      try {
        dependencyEntry = realpathSync(createRequire(context.entry).resolve(dependencyName));
      } catch {
        continue;
      }
      if (seen.has(dependencyEntry)) continue;
      seen.add(dependencyEntry);
      entries.push(dependencyEntry);
      pending.push({ entry: dependencyEntry, packageName: dependencyName });
    }
  }
  return entries;
}

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
  it('rejects a config data URL module outside the immutable source snapshot', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-config-data-source-closure-')));
    const configPath = join(root, 'kovo.config.mjs');
    const outDir = join(root, 'dist');
    const source =
      "import 'data:text/javascript,globalThis.__KOVO_CONFIG_DATA_MODULE__%3Dtrue'; export default {};\n";
    try {
      writeFileSync(configPath, source, 'utf8');

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: configPath }, ssr: true },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            approvedBuildSourcesVitePluginForTesting(
              configPath,
              root,
              [{ fileName: 'kovo.config.mjs', source }],
              'config',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/config module edge.*security-preflight snapshot/u);
      expect(existsSync(outDir)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects a config module /@fs edge outside the immutable source snapshot', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-config-source-closure-')));
    const configPath = join(root, 'kovo.config.mjs');
    const outsidePath = join(tmpdir(), `kovo-config-outside-${process.pid}.mjs`);
    const outDir = join(root, 'dist');
    const source = `import ${JSON.stringify(`/@fs${outsidePath}`)}; export default {};\n`;
    try {
      writeFileSync(configPath, source, 'utf8');
      writeFileSync(outsidePath, 'globalThis.__KOVO_OUTSIDE_CONFIG__ = true;\n', 'utf8');

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: configPath }, ssr: true },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            approvedBuildSourcesVitePluginForTesting(
              configPath,
              root,
              [{ fileName: 'kovo.config.mjs', source }],
              'config',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/unapproved config source.*security preflight/u);
      expect(existsSync(outDir)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outsidePath, { force: true });
    }
  });

  it('keeps the genuine workspace dependency chain trusted', () => {
    const cliEntry = realpathSync(join(process.cwd(), 'packages/cli/src/index.ts'));
    const serverEntry = realpathSync(createRequire(cliEntry).resolve('@kovojs/server'));
    const browserEntry = realpathSync(createRequire(serverEntry).resolve('@kovojs/browser'));
    const compilerEntry = realpathSync(createRequire(cliEntry).resolve('@kovojs/compiler'));
    const verifyEntry = realpathSync(createRequire(compilerEntry).resolve('@kovojs/verify'));

    const roots = kovoFrameworkSourceRootsForTesting(cliEntry);

    expect(roots).toContain(dirname(serverEntry));
    expect(roots).toContain(dirname(browserEntry));
    expect(roots).toContain(dirname(compilerEntry));
    expect(roots).toContain(dirname(verifyEntry));
    for (const dependencyEntry of declaredWorkspaceKovoDependencyEntries(cliEntry, '@kovojs/cli')) {
      expect(roots).toContain(dirname(dependencyEntry));
    }
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

  it('substitutes the dgram floor only across byte-authenticated source and packed framework edges', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-cloudflare-dgram-floor-')));
    try {
      const cli = writePackedPackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const server = writePackedPackage(root, '@kovojs/server');
      const packedBootstrap = join(server.root, 'dist/egress-bootstrap-R4ND0M.mjs');
      const sourceBootstrap = join(server.root, 'dist/egress-bootstrap.ts');
      const appBootstrap = join(root, 'egress-bootstrap-R4ND0M.mjs');
      writeFileSync(packedBootstrap, "import './egress-dgram.mjs';\n", 'utf8');
      writeFileSync(sourceBootstrap, "import './egress-dgram.js';\n", 'utf8');
      writeFileSync(appBootstrap, "import './egress-dgram.mjs';\n", 'utf8');
      const trust = kovoFrameworkSourceTrustForTesting(cli.entry);

      expect(
        cloudflareUnavailableDgramFloorImportForTesting(
          trust,
          './egress-dgram.mjs',
          packedBootstrap,
        ),
      ).toBe(true);
      expect(
        cloudflareUnavailableDgramFloorImportForTesting(
          trust,
          './egress-dgram.js',
          sourceBootstrap,
        ),
      ).toBe(true);
      expect(
        cloudflareUnavailableDgramFloorImportForTesting(trust, './egress-dgram.mjs', appBootstrap),
      ).toBe(false);
      expect(
        cloudflareUnavailableDgramFloorImportForTesting(trust, 'node:dgram', packedBootstrap),
      ).toBe(false);

      writeFileSync(packedBootstrap, "import 'node:dgram';\n", 'utf8');
      expect(
        cloudflareUnavailableDgramFloorImportForTesting(
          trust,
          './egress-dgram.mjs',
          packedBootstrap,
        ),
      ).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('selects Workers database substitutes only across byte-authenticated server edges', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-cloudflare-database-runtime-')));
    try {
      for (const packed of [false, true]) {
        const installRoot = join(root, packed ? 'packed' : 'source');
        const cliRoot = packed
          ? writePackedPackage(installRoot, '@kovojs/cli', { '@kovojs/server': '0.2.0' })
          : undefined;
        const sourceCliRoot = packed
          ? undefined
          : writePackage(installRoot, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
        const server = packed ? writePackedPackage(installRoot, '@kovojs/server') : undefined;
        const sourceServerRoot = packed ? undefined : writePackage(installRoot, '@kovojs/server');
        const cliEntry = packed ? cliRoot!.entry : join(sourceCliRoot!, 'index.js');
        const serverEntry = packed ? server!.entry : join(sourceServerRoot!, 'index.js');
        const runtimeRoot = dirname(serverEntry);
        const extension = packed ? '.mjs' : '.js';
        const parserSpecifier = packed ? './sql-parser-authority.mjs' : './sql-parser-authority.js';
        const postgresRuntime = join(runtimeRoot, `postgres-runtime${extension}`);
        const parserBootstrap = join(runtimeRoot, `sql-parser-authority-bootstrap${extension}`);
        const parserAuthority = join(runtimeRoot, `sql-parser-authority-cloudflare${extension}`);
        const appLookalike = join(installRoot, `postgres-runtime${extension}`);
        writeFileSync(
          postgresRuntime,
          "import { PGlite } from '@electric-sql/pglite';\nimport './sql-parser-authority.js';\n",
          'utf8',
        );
        writeFileSync(parserBootstrap, "import './sql-parser-authority.js';\n", 'utf8');
        writeFileSync(parserAuthority, 'export const parse = true;\n', 'utf8');
        writeFileSync(appLookalike, "import { PGlite } from '@electric-sql/pglite';\n", 'utf8');
        const trust = kovoFrameworkSourceTrustForTesting(cliEntry);

        expect(
          cloudflareUnavailablePgliteImportForTesting(
            trust,
            '@electric-sql/pglite',
            postgresRuntime,
          ),
        ).toBe(true);
        expect(
          cloudflareUnavailablePgliteImportForTesting(trust, '@electric-sql/pglite', appLookalike),
        ).toBe(false);
        expect(
          cloudflareUnavailablePgliteImportForTesting(trust, 'node:dgram', postgresRuntime),
        ).toBe(false);
        expect(
          cloudflareUnavailableDrizzlePgliteImportForTesting(
            trust,
            'drizzle-orm/pglite',
            postgresRuntime,
          ),
        ).toBe(true);
        expect(
          cloudflareUnavailableDrizzlePgliteImportForTesting(
            trust,
            'drizzle-orm/pglite',
            appLookalike,
          ),
        ).toBe(false);
        expect(
          cloudflareSqlParserAuthorityReplacementForTesting(
            trust,
            serverEntry,
            parserSpecifier,
            postgresRuntime,
          ),
        ).toBe(parserAuthority);
        expect(
          cloudflareSqlParserAuthorityReplacementForTesting(
            trust,
            serverEntry,
            parserSpecifier,
            parserBootstrap,
          ),
        ).toBe(parserAuthority);
        expect(
          cloudflareSqlParserAuthorityReplacementForTesting(
            trust,
            serverEntry,
            parserSpecifier,
            appLookalike,
          ),
        ).toBeUndefined();

        writeFileSync(parserAuthority, 'export const parse = false;\n', 'utf8');
        expect(
          cloudflareSqlParserAuthorityReplacementForTesting(
            trust,
            serverEntry,
            parserSpecifier,
            postgresRuntime,
          ),
        ).toBeUndefined();
      }
      expect(
        kovoServerHandlerExternalDependencyForTesting('@electric-sql/pglite', 'cloudflare'),
      ).toBe(false);
      expect(kovoServerHandlerExternalDependencyForTesting('@electric-sql/pglite', 'node')).toBe(
        true,
      );
      expect(kovoServerHandlerExternalDependencyForTesting('@electric-sql/pglite', 'vercel')).toBe(
        true,
      );
      expect(kovoServerHandlerExternalDependencyForTesting('pg', 'cloudflare')).toBe(true);
      const pgliteSubstitute = (await import(
        `data:text/javascript;charset=utf-8,${encodeURIComponent(
          cloudflareUnavailablePgliteModuleSourceForTesting(),
        )}`
      )) as { PGlite: new () => unknown };
      expect(() => new pgliteSubstitute.PGlite()).toThrowError(
        'Kovo Cloudflare builds require an external Postgres database; the embedded development database is unavailable.',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('normalizes only the boot-authenticated Workers parser diagnostic payload', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-cloudflare-parser-payload-')));
    const parserEntry = join(root, 'index.js');
    const lookalike = join(root, 'lookalike.js');
    const parserSource = `function parse(sql) {
  throw new Error(\`💀 Ambiguous SQL syntax: Please file an issue stating the request that has failed at https://github.com/oguimbal/pgsql-ast-parser:

        \${sql}

        \`);
}
`;
    try {
      writeFileSync(parserEntry, parserSource, 'utf8');
      writeFileSync(lookalike, parserSource, 'utf8');
      const subject = { entry: realpathSync(parserEntry), source: parserSource };
      const normalized = cloudflareManagedSqlParserSourceForTesting(
        subject,
        parserSource,
        parserEntry,
      );

      expect(normalized).toContain('throw new Error("Ambiguous SQL syntax");');
      expect(normalized).not.toContain('pgsql-ast-parser');
      expect(normalized).not.toContain('${sql}');
      expect(
        cloudflareManagedSqlParserSourceForTesting(subject, parserSource, lookalike),
      ).toBeUndefined();
      expect(() =>
        cloudflareManagedSqlParserSourceForTesting(
          subject,
          `${parserSource}\n// changed after bootstrap\n`,
          parserEntry,
        ),
      ).toThrow(/changed Workers SQL parser bytes/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('normalizes the installed reviewed parser subject without retaining raw SQL diagnostics', () => {
    const serverEntry = realpathSync(createRequire(import.meta.url).resolve('@kovojs/server'));
    const parserEntry = realpathSync(
      createRequire(pathToFileURL(serverEntry)).resolve('pgsql-ast-parser'),
    );
    const parserSource = readFileSync(parserEntry, 'utf8');
    const normalized = cloudflareManagedSqlParserSourceForTesting(
      { entry: parserEntry, source: parserSource },
      parserSource,
      parserEntry,
    );

    expect(normalized).toContain('throw new Error("Ambiguous SQL syntax");');
    expect(normalized).not.toContain('request that has failed at');
    expect(normalized).not.toContain('${sql}');
  });

  it('applies server tree-shaking posture only to byte-authenticated source and packed modules', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-server-side-effects-')));
    const stems = [
      'managed-db-public',
      'password',
      'postgres-runtime',
      'sqlite-runtime',
      'sql-parser-authority',
      'sql-parser-authority-bootstrap',
    ];
    try {
      for (const packed of [false, true]) {
        const installRoot = join(root, packed ? 'packed' : 'source');
        const cliRoot = packed
          ? writePackedPackage(installRoot, '@kovojs/cli', { '@kovojs/server': '0.2.0' })
          : undefined;
        const sourceCliRoot = packed
          ? undefined
          : writePackage(installRoot, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
        const server = packed ? writePackedPackage(installRoot, '@kovojs/server') : undefined;
        const sourceServerRoot = packed ? undefined : writePackage(installRoot, '@kovojs/server');
        const cliEntry = packed ? cliRoot!.entry : join(sourceCliRoot!, 'index.js');
        const serverEntry = packed ? server!.entry : join(sourceServerRoot!, 'index.js');
        const runtimeRoot = dirname(serverEntry);
        const extension = packed ? '.mjs' : '.ts';
        const modules = stems.map((stem) => join(runtimeRoot, `${stem}${extension}`));
        for (const module of modules) {
          writeFileSync(module, 'export const prepared = true;\n', 'utf8');
        }
        const appLookalike = join(installRoot, `password${extension}`);
        writeFileSync(appLookalike, 'export const appOwned = true;\n', 'utf8');
        const trust = kovoFrameworkSourceTrustForTesting(cliEntry);

        for (const module of modules) {
          expect(kovoServerHandlerModuleSideEffectFreeForTesting(trust, serverEntry, module)).toBe(
            true,
          );
        }
        expect(
          kovoServerHandlerModuleSideEffectFreeForTesting(trust, serverEntry, appLookalike),
        ).toBe(false);

        writeFileSync(modules[0]!, 'export const prepared = false;\n', 'utf8');
        expect(
          kovoServerHandlerModuleSideEffectFreeForTesting(trust, serverEntry, modules[0]!),
        ).toBe(false);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps source and packed handlers on one fixed-name internal runtime graph', () => {
    const sourceAppShell = join(
      tmpdir(),
      'kovo-source',
      'packages/server/src/internal/app-shell-vite.ts',
    );
    const packedAppShell = join(
      tmpdir(),
      'kovo-packed',
      'node_modules/@kovojs/server/dist/internal/app-shell-vite.mjs',
    );

    expect(generatedHandlerRuntimeHrefForTesting(sourceAppShell)).toBe(
      pathToFileURL(join(dirname(sourceAppShell), 'generated-handler-runtime.ts')).href,
    );
    expect(generatedHandlerRuntimeHrefForTesting(packedAppShell)).toBe(
      pathToFileURL(join(dirname(packedAppShell), 'generated-handler-runtime.mjs')).href,
    );
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

  it('pins packed framework bytes before Vite SSR dependency normalization', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-packed-ssr-')));
    let viteServer: Awaited<ReturnType<typeof createViteServer>> | undefined;
    try {
      const cli = writePackedPackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const server = writePackedPackage(root, '@kovojs/server');
      viteServer = await createViteServer({
        appType: 'custom',
        configFile: false,
        logLevel: 'silent',
        plugins: [kovoFrameworkSourceVitePluginForTesting(cli.entry, root)],
        root,
        server: { hmr: false },
        ssr: { noExternal: [/^@kovojs\//] },
      });

      const loaded = (await viteServer.ssrLoadModule(server.chunk)) as { packed?: unknown };
      expect(loaded.packed).toBe(true);
    } finally {
      await viteServer?.close();
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

  it('rejects changed packed text-asset bytes through the real Vite transform path', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-framework-mutated-asset-vite-')));
    try {
      const cli = writePackedPackage(root, '@kovojs/cli', { '@kovojs/server': '0.2.0' });
      const server = writePackedPackage(root, '@kovojs/server');
      const securityPlugin = kovoFrameworkSourceVitePluginForTesting(cli.entry, root);
      writeFileSync(server.asset, '.packed { color: red; }\n', 'utf8');

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
