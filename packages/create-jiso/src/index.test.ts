import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { fwCheck, fwExplain, type FwExplainInput } from '../../../packages/cli/src/index.js';
import { createJisoProject, main, writeJisoProject } from './index.js';

describe('create-jiso starter', () => {
  it('scaffolds real template files with CI and fw-check recipe', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-jiso-scaffold-'));
    const expectedFiles = [
      'package.json',
      'vite.config.ts',
      '.github/workflows/ci.yml',
      'README.md',
      'graph.json',
      'scripts/export-static.mjs',
      'scripts/serve.mjs',
      'scripts/emit-graph.mjs',
      'scripts/graph-assertions.mjs',
      'docs/graph-assertions.md',
      'docs/deployment.md',
      'docs/framework-rules.md',
      'src/styles.css',
      'src/client.ts',
      'index.html',
      'src/app.tsx',
      'src/app-shell.ts',
      'src/app-shell.test.ts',
      'src/auth.tsx',
      'src/app.fixpoint.test.ts',
    ];

    try {
      const templateUrl = new URL('../templates/', import.meta.url);
      for (const file of expectedFiles) {
        expect(existsSync(new URL(file, templateUrl))).toBe(true);
      }

      const result = writeJisoProject(root, { name: 'My App' });
      expect(result).toEqual({ files: expectedFiles, name: 'my-app', root });

      for (const file of expectedFiles) {
        const source = readFileSync(join(root, file), 'utf8');
        expect(source).not.toContain('{{');
        expect(source).not.toContain('}}');
      }

      const project = createJisoProject({ name: 'My App' });
      expect(project.name).toBe('my-app');
      expect(project.files.map((file) => file.path)).toEqual(expectedFiles);

      const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        name?: string;
        scripts?: Record<string, string>;
      };
      expect(packageJson.name).toBe('my-app');
      expect(packageJson.dependencies).toMatchObject({
        '@jiso/better-auth': 'workspace:*',
        '@jiso/core': 'workspace:*',
        '@jiso/runtime': 'workspace:*',
        '@jiso/server': 'workspace:*',
      });
      expect(packageJson.devDependencies).toMatchObject({
        '@jiso/compiler': 'workspace:*',
        '@tailwindcss/vite': '^4.1.0',
        '@types/node': '^25.0.0',
        fw: 'workspace:*',
        tailwindcss: '^4.1.0',
        vite: '^8.0.16',
      });
      expect(packageJson.scripts).toMatchObject({
        check: 'vp check',
        dev: 'vp dev',
        'emit-graph': 'node scripts/emit-graph.mjs',
        serve: 'node scripts/serve.mjs',
        start: 'node scripts/serve.mjs',
        static: 'vp run export',
        test: 'vp test',
      });

      const graph = JSON.parse(readFileSync(join(root, 'graph.json'), 'utf8')) as FwExplainInput;
      expect(graph.components?.map((component) => component.name)).toEqual([
        'CartBadge',
        'CartPanel',
      ]);
      expect(graph.mutations).toEqual([
        expect.objectContaining({
          inputFields: ['productId', 'quantity'],
          invalidates: ['cart'],
          key: 'cart/add',
          session: 'starterSession',
        }),
      ]);
      expect(graph.pages).toEqual([
        expect.objectContaining({
          i18n: ['en-US:cartTitle'],
          meta: {
            description: 'Starter cart backed by query data.',
            title: 'Jiso Starter Cart',
          },
          route: '/cart',
        }),
      ]);
      expect(graph.optimistic).toEqual([
        { mutation: 'cart/add', query: 'cart', status: 'await-fragment' },
      ]);
      expect(graph.queries).toEqual([{ domains: ['cart'], query: 'cart' }]);
      expect(graph.touchGraph?.['cart.addItem']?.touches).toEqual([
        expect.objectContaining({ domain: 'cart' }),
      ]);
      expect(fwCheck(graph)).toEqual({
        exitCode: 0,
        output: 'fw-check/v1\nOK\n',
      });
      expect(fwExplain(graph, { kind: 'query', target: 'cart' })).toEqual({
        exitCode: 0,
        output:
          'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,component:CartPanel,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
      });
      expect(fwExplain(graph, { kind: 'mutation', optimistic: true, target: 'cart/add' })).toEqual({
        exitCode: 0,
        output: [
          'fw-explain/v1',
          'MUTATION cart/add',
          'guards: authed',
          'session: starterSession',
          'input-fields: productId,quantity',
          'writes: cart',
          'invalidates: cart',
          'manual-invalidates: -',
          'updates: cart->component:CartBadge,component:CartPanel,page:/cart',
          'OPTIMISTIC cart await-fragment',
          'OPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=1 UNHANDLED=0',
          '',
        ].join('\n'),
      });
      expect(fwExplain(graph, { kind: 'page', target: '/cart' })).toEqual({
        exitCode: 0,
        output: [
          'fw-explain/v1',
          'PAGE /cart',
          'prefetch: false',
          'meta: title=Jiso Starter Cart description=Starter cart backed by query data. image=-',
          'i18n: en-US:cartTitle',
          'modulepreloads: -',
          'stylesheets: /src/styles.css',
          'queries: cart',
          'view-transitions: -',
          '',
        ].join('\n'),
      });

      expect(readFileSync(join(root, 'docs/graph-assertions.md'), 'utf8')).toContain(
        'SPEC.md section 11.4.3',
      );
      const readme = readFileSync(join(root, 'README.md'), 'utf8');
      expect(readme).toContain('starter-export/v1');
      expect(readme).toContain('npm run static');
      expect(readme).toContain('npm run serve');
      expect(readFileSync(join(root, 'docs/deployment.md'), 'utf8')).toContain(
        'SPEC.md section 9.3',
      );
      expect(readFileSync(join(root, 'docs/framework-rules.md'), 'utf8')).toContain('SPEC.md');
      expect(readFileSync(join(root, 'src/app.fixpoint.test.ts'), 'utf8')).toContain(
        'SPEC.md section 5.2',
      );
      const appSource = readFileSync(join(root, 'src/app.tsx'), 'utf8');
      expect(appSource).toContain('@jsxImportSource @jiso/server');
      expect(appSource).toContain('<main');
      expect(appSource).toContain('on:click="/c/starter.client.js?v=starter-r7#Starter$announce"');
      expect(appSource).not.toMatch(/render:\s*\(\)\s*=>\s*['"`]</);
      const appShellSource = readFileSync(join(root, 'src/app-shell.ts'), 'utf8');
      expect(appShellSource).toContain("route('/',");
      expect(appShellSource).toContain('createRequestHandler(app)');
      expect(appShellSource).toContain("path: '/c/starter.client.js'");
      expect(appShellSource).toContain("version: 'starter-r7'");
      expect(appShellSource).not.toContain('starterNodeHandler');
      expect(appShellSource).not.toContain('nodeRequestToWebRequest');
      expect(appShellSource).not.toContain('writeWebResponseToNode');
      expect(readFileSync(join(root, 'src/app-shell.test.ts'), 'utf8')).toContain(
        'SPEC.md section 9.5',
      );
      const authSource = readFileSync(join(root, 'src/auth.tsx'), 'utf8');
      expect(authSource).toContain("from '@jiso/better-auth'");
      expect(authSource).toContain('betterAuthSession');
      expect(authSource).toContain('betterAuthSignInEmailMutation');
      expect(authSource).toContain('betterAuthSignOutMutation');
      expect(authSource).toContain("role<StarterAuthRequest>('admin')");
      expect(authSource).toContain('method="post"');
      expect(authSource).toContain('action="/_m/auth/sign-in"');
      expect(authSource).toContain('data-mutation="auth/sign-in"');
      expect(authSource).toContain('action="/_m/auth/sign-out"');
      expect(authSource).toContain('data-mutation="auth/sign-out"');
      expect(authSource).toContain('csrfField(options.request, starterAuthCsrf)');
      expect(authSource).toContain('csrfField(request, starterAuthCsrf)');
      expect(authSource).not.toContain('@better-auth/client');
      expect(readFileSync(join(root, 'src/styles.css'), 'utf8')).toContain(
        '@source "./**/*.{ts,tsx,html}";',
      );
      const indexSource = readFileSync(join(root, 'index.html'), 'utf8');
      expect(indexSource).toContain('/src/styles.css');
      expect(indexSource).toContain('Build-only Vite asset entry');
      expect(indexSource).toContain('SPEC.md section 9.5');
      expect(indexSource).not.toContain('/src/client.ts');
      expect(indexSource).not.toContain('Hello from Jiso');
      const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');
      expect(viteConfig).toContain('starterSharedAppShellDevPlugin()');
      expect(viteConfig).toContain("server.ssrLoadModule('@jiso/server')");
      expect(viteConfig).toContain('jisoAppShellViteSsrDevPlugin');
      expect(viteConfig).toContain('earlyHints: false');
      expect(viteConfig).toContain("name: 'jiso-starter-app-shell-dev'");
      expect(viteConfig).not.toContain('nodeHandlerExportName');
      expect(viteConfig).toContain('manifest: true');
      expect(viteConfig).toContain('node scripts/export-static.mjs');
      expect(viteConfig).not.toContain("pathname === '/'");
      expect(viteConfig).not.toContain("pathname.startsWith('/c/')");
      const exportStaticScript = readFileSync(join(root, 'scripts/export-static.mjs'), 'utf8');
      expect(exportStaticScript).toContain("execFileSync('vp', ['build']");
      expect(exportStaticScript).toContain(
        'jisoAppShellViteManifestStylesheetHrefFromFile(manifestFile)',
      );
      expect(exportStaticScript).toContain('formatStaticExportDiagnostic');
      expect(exportStaticScript).toContain('formatStaticExportDiagnostics');
      expect(exportStaticScript).toContain("ssrLoadModule('/src/app-shell.ts')");
      expect(exportStaticScript).toContain('exportJisoAppShellViteBuildFromManifestFile');
      expect(exportStaticScript).toContain(
        'staticExportManifestForJisoAppShellViteBuildFromManifestFile',
      );
      expect(exportStaticScript).toContain('JISO_STARTER_STYLESHEET_HREF');
      expect(exportStaticScript).toContain('isStaticExportDiagnosticError');
      expect(exportStaticScript).toContain('starter-export/v1');
      expect(exportStaticScript).not.toContain('function formatStaticExportDiagnostic');
      expect(exportStaticScript).not.toContain('function isStaticExportDiagnostic');
      expect(exportStaticScript).not.toContain('htmlPathStyle');
      const serveScript = readFileSync(join(root, 'scripts/serve.mjs'), 'utf8');
      expect(serveScript).toContain('createStarterServeServer');
      expect(serveScript).toContain('configFile: fileURLToPath(new URL');
      expect(serveScript).toContain('starter-serve/v1');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('writes createJisoProject files to an empty target directory deterministically', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-jiso-'));

    try {
      const result = writeJisoProject(root, { name: 'Example Shop' });
      const project = createJisoProject({ name: 'Example Shop' });

      expect(result).toEqual({
        files: project.files.map((file) => file.path),
        name: 'example-shop',
        root,
      });

      for (const file of project.files) {
        expect(readFileSync(join(root, file.path), 'utf8')).toBe(file.source);
      }

      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
        name: 'example-shop',
        private: true,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('builds generated starter CSS with static and safelisted Tailwind utilities', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-jiso-build-'));

    try {
      writeJisoProject(root, { name: 'Build Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(resolveBin('vite'), ['build', '--clearScreen', 'false'], {
        cwd: root,
        stdio: 'pipe',
      });

      const cssFile = readdirSync(join(root, 'dist/assets')).find((file) => file.endsWith('.css'));
      expect(cssFile).toBeTypeOf('string');
      const css = readFileSync(join(root, 'dist/assets', cssFile ?? ''), 'utf8');

      expect(css).toContain('.text-jiso-accent');
      expect(css).toContain('.bg-emerald-50');
      expect(css).toContain('.border-emerald-200');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('typechecks the generated auth recipe with starter dependencies', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-jiso-auth-'));

    try {
      writeJisoProject(root, { name: 'Auth Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(
        resolveBin('tsc'),
        [
          '--ignoreConfig',
          '--noEmit',
          '--jsx',
          'react-jsx',
          '--jsxImportSource',
          '@jiso/server',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2024',
          '--strict',
          '--skipLibCheck',
          '--exactOptionalPropertyTypes',
          '--noUncheckedIndexedAccess',
          '--types',
          'node',
          'src/auth.tsx',
          'src/app.tsx',
          'src/app-shell.ts',
        ],
        { cwd: root, stdio: 'pipe' },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('runs the generated starter app-shell request and export proof', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-jiso-app-shell-'));

    try {
      writeJisoProject(root, { name: 'App Shell Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(resolveBin('vitest'), ['--run', 'src/app-shell.test.ts'], {
        cwd: root,
        stdio: 'pipe',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('serves the generated starter app-shell through the vp dev task', async () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-jiso-vp-dev-'));
    const port = await reservePort();
    let devServer: ChildProcessWithoutNullStreams | undefined;

    try {
      writeJisoProject(root, { name: 'Dev Task Proof' });
      linkStarterBuildDependencies(root);

      devServer = spawn(
        resolveBin('vp'),
        ['dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        {
          cwd: root,
          detached: process.platform !== 'win32',
          env: withRepoBinOnPath(),
        },
      );
      const output = collectOutput(devServer);
      const origin = `http://127.0.0.1:${port}`;

      const documentBody = await fetchTextWhenReady(`${origin}/`, output);
      expect(documentBody).toContain(
        'on:click="/c/starter.client.js?v=starter-r7#Starter$announce"',
      );

      const moduleBody = await fetchTextWhenReady(
        `${origin}/c/starter.client.js?v=starter-r7`,
        output,
      );
      expect(moduleBody).toContain('export function Starter$announce');

      const sourceCss = await fetchTextWhenReady(`${origin}/src/styles.css`, output);
      expect(sourceCss).toContain('tailwindcss v');

      const sourceEntry = await fetchTextWhenReady(`${origin}/index.html`, output);
      expect(sourceEntry).toContain('Build-only Vite asset entry');
      expect(sourceEntry).not.toContain('Hello from Jiso');
      expect(sourceEntry).not.toContain('/src/client.ts');
    } finally {
      await stopProcess(devServer);
      rmSync(root, { force: true, recursive: true });
    }
  });

  for (const serveCommand of generatedStarterServeCommands()) {
    it(`serves the generated starter app-shell through ${serveCommand.label}`, async () => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-jiso-serve-'));
      const port = await reservePort();
      let serveServer: ChildProcessWithoutNullStreams | undefined;

      try {
        writeJisoProject(root, { name: 'Serve Task Proof' });
        linkStarterBuildDependencies(root);

        serveServer = spawn(serveCommand.command, serveCommand.args(port), {
          cwd: root,
          detached: process.platform !== 'win32',
          env: withGeneratedBinOnPath(root),
        });
        const output = collectOutput(serveServer);
        const origin = `http://127.0.0.1:${port}`;

        const documentBody = await fetchTextWhenReady(`${origin}/`, output);
        expect(output()).toContain('starter-serve/v1');
        expect(documentBody).toContain(
          'on:click="/c/starter.client.js?v=starter-r7#Starter$announce"',
        );

        const moduleBody = await fetchTextWhenReady(
          `${origin}/c/starter.client.js?v=starter-r7`,
          output,
        );
        expect(moduleBody).toContain('export function Starter$announce');

        const sourceCss = await fetchTextWhenReady(`${origin}/src/styles.css`, output);
        expect(sourceCss).toContain('tailwindcss v');
      } finally {
        await stopProcess(serveServer);
        rmSync(root, { force: true, recursive: true });
      }
    }, 30000);
  }

  for (const exportCommand of generatedStarterExportCommands()) {
    it(`runs ${exportCommand.label} with the built stylesheet href`, () => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-jiso-export-task-'));

      try {
        writeJisoProject(root, { name: 'Export Task Proof' });
        linkStarterBuildDependencies(root);

        const output = execFileSync(exportCommand.command, exportCommand.args, {
          cwd: root,
          encoding: 'utf8',
          env: withGeneratedBinOnPath(root),
          stdio: 'pipe',
        });

        const distIndex = readFileSync(join(root, 'dist/index.html'), 'utf8');
        const cssFile = readdirSync(join(root, 'dist/assets')).find((file) =>
          file.endsWith('.css'),
        );

        expect(cssFile).toBeTypeOf('string');
        expect(output).toContain('starter-export/v1\nhtml=1\nclient-modules=1\nassets=1\n');
        expect(output).toContain('manifest-html=1\nmanifest-client-modules=1\nmanifest-assets=1\n');
        expect(distIndex).toContain(`href="/assets/${cssFile}"`);
        expect(distIndex).toContain(
          'on:click="/c/starter.client.js?v=starter-r7#Starter$announce"',
        );
        expect(distIndex).not.toContain('/src/styles.css');
        expect(distIndex).not.toContain('/src/client.ts');
        expect(distIndex).not.toContain('Build-only Vite asset entry');
        expect(readFileSync(join(root, 'dist/assets', cssFile ?? ''), 'utf8')).toContain(
          '.text-jiso-accent',
        );
        expect(readFileSync(join(root, 'dist/c/starter.client.js'), 'utf8')).toContain(
          'Starter$announce',
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    });
  }

  it('formats generated export task diagnostics when a starter route is not exportable', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-jiso-export-diagnostic-'));

    try {
      writeJisoProject(root, { name: 'Export Diagnostic Proof' });
      linkStarterBuildDependencies(root);

      const appShellPath = join(root, 'src/app-shell.ts');
      const appShell = readFileSync(appShellPath, 'utf8');
      writeFileSync(
        appShellPath,
        appShell.replace(
          "export const homeRoute = route('/', {\n",
          "export const homeRoute = route('/', {\n  guard: () => true,\n",
        ),
        'utf8',
      );

      let exportError: unknown;
      try {
        execFileSync(resolveBin('vp'), ['run', 'export'], {
          cwd: root,
          env: withRepoBinOnPath(),
          stdio: 'pipe',
        });
      } catch (error) {
        exportError = error;
      }

      expect(exportError).toMatchObject({ status: 1 });
      const stderr = (exportError as { stderr?: unknown }).stderr;
      expect(Buffer.isBuffer(stderr)).toBe(true);
      expect((stderr as Buffer).toString('utf8')).toContain(
        "starter-export/v1\nERROR FW229 route=/ FW229 static export cannot export guarded route '/'",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('creates a new target directory from the CLI and derives the package name', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-jiso-cli-'));
    const root = join(parent, 'Hello CLI');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(main([root])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(`create-jiso: wrote 20 files to ${root}\n`);
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
        name: 'hello-cli',
      });
      expect(existsSync(join(root, 'src/app.fixpoint.test.ts'))).toBe(true);
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('writes CLI failure output to stderr while returning a non-zero exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-jiso-cli-error-'));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(join(root, 'README.md'), 'existing', 'utf8');

      expect(main([root])).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(`create-jiso: Target directory is not empty: ${root}\n`);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('runs as a CLI entrypoint when the script path contains spaces', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-jiso-entry-'));
    const spacedDir = join(parent, 'entry path with spaces');
    const entryPath = join(spacedDir, 'create-jiso.ts');

    try {
      mkdirSync(spacedDir, { recursive: true });
      symlinkSync(new URL('./index.ts', import.meta.url), entryPath);

      const output = execFileSync(
        process.execPath,
        ['--preserve-symlinks-main', entryPath, '--help'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      expect(output).toBe('usage: create-jiso <target-directory> [--name <package-name>]\n');
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('refuses to write into a non-empty target directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-jiso-collision-'));
    const existingPath = join(root, 'README.md');
    writeFileSync(existingPath, 'existing', 'utf8');

    try {
      expect(() => writeJisoProject(root, { name: 'Collision' })).toThrow(
        `Target directory is not empty: ${root}`,
      );
      expect(readFileSync(existingPath, 'utf8')).toBe('existing');
      expect(existsSync(join(root, 'package.json'))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function linkStarterBuildDependencies(root: string): void {
  const nodeModules = join(root, 'node_modules');
  const nodeModulesBin = join(nodeModules, '.bin');
  mkdirSync(join(nodeModules, '@jiso'), { recursive: true });
  mkdirSync(join(nodeModules, '@tailwindcss'), { recursive: true });
  mkdirSync(join(nodeModules, '@types'), { recursive: true });
  mkdirSync(nodeModulesBin, { recursive: true });

  symlinkSync(join(resolveDependencyRoot('vite-plus'), 'bin/vp'), join(nodeModulesBin, 'vp'));
  symlinkSync(resolveDependencyRoot('@types/node'), join(nodeModules, '@types/node'));
  symlinkSync(resolveDependencyRoot('@tailwindcss/vite'), join(nodeModules, '@tailwindcss/vite'));
  symlinkSync(resolveDependencyRoot('@jiso/better-auth'), join(nodeModules, '@jiso/better-auth'));
  symlinkSync(resolveDependencyRoot('@jiso/compiler'), join(nodeModules, '@jiso/compiler'));
  symlinkSync(resolveDependencyRoot('@jiso/core'), join(nodeModules, '@jiso/core'));
  symlinkSync(resolveDependencyRoot('@jiso/runtime'), join(nodeModules, '@jiso/runtime'));
  symlinkSync(resolveDependencyRoot('@jiso/server'), join(nodeModules, '@jiso/server'));
  symlinkSync(resolveDependencyRoot('fw'), join(nodeModules, 'fw'));
  symlinkSync(resolveDependencyRoot('tailwindcss'), join(nodeModules, 'tailwindcss'));
  symlinkSync(resolveDependencyRoot('vite'), join(nodeModules, 'vite'));
  symlinkSync(resolveDependencyRoot('vitest'), join(nodeModules, 'vitest'));
  symlinkSync(resolveDependencyRoot('vite-plus'), join(nodeModules, 'vite-plus'));
}

function withRepoBinOnPath(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [join(process.cwd(), 'node_modules/.bin'), process.env.PATH ?? ''].join(':'),
  };
}

function withGeneratedBinOnPath(root: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [join(root, 'node_modules/.bin'), process.env.PATH ?? ''].join(':'),
  };
}

function vpCommand(): string {
  return process.platform === 'win32' ? 'vp.cmd' : 'vp';
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function generatedStarterServeCommands(): Array<{
  args(port: number): string[];
  command: string;
  label: string;
}> {
  const serveArgs = (port: number) => [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ];

  return [
    {
      args: (port) => ['run', '--no-cache', 'serve', ...serveArgs(port)],
      command: vpCommand(),
      label: 'vp run serve',
    },
    {
      args: (port) => ['run', 'serve', '--', ...serveArgs(port)],
      command: npmCommand(),
      label: 'npm run serve',
    },
    {
      args: (port) => ['start', '--', ...serveArgs(port)],
      command: npmCommand(),
      label: 'npm start',
    },
  ];
}

function generatedStarterExportCommands(): Array<{
  args: string[];
  command: string;
  label: string;
}> {
  return [
    {
      args: ['run', 'export'],
      command: vpCommand(),
      label: 'vp run export',
    },
    {
      args: ['run', 'static'],
      command: npmCommand(),
      label: 'npm run static',
    },
  ];
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  if (typeof address !== 'object' || address === null) {
    throw new Error('Unable to reserve a TCP port for generated vp dev proof.');
  }

  return address.port;
}

function collectOutput(process: ChildProcessWithoutNullStreams): () => string {
  const chunks: Buffer[] = [];
  process.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  process.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks).toString('utf8');
}

async function fetchTextWhenReady(url: string, output: () => string): Promise<string> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok) return body;
      lastError = new Error(`HTTP ${response.status}: ${body}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const cause = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out fetching ${url}: ${cause}\n${output()}`);
}

async function stopProcess(
  childProcess: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (!childProcess || childProcess.exitCode !== null) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      killProcessTree(childProcess, 'SIGKILL');
      reject(new Error('Timed out stopping generated vp dev process.'));
    }, 5_000);
    childProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    killProcessTree(childProcess, 'SIGTERM');
  });
}

function killProcessTree(
  childProcess: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (childProcess.pid === undefined) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-childProcess.pid, signal);
      return;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw error;
  }

  childProcess.kill(signal);
}

function resolveDependencyRoot(packageName: string): string {
  const dependencyRoot = join(process.cwd(), 'node_modules');
  const linkedPackageJson = join(dependencyRoot, packageName, 'package.json');

  if (existsSync(linkedPackageJson)) {
    return realpathSync(dirname(linkedPackageJson));
  }

  if (packageName.startsWith('@jiso/')) {
    const workspacePackageJson = join(
      process.cwd(),
      'packages',
      packageName.slice('@jiso/'.length),
      'package.json',
    );
    if (existsSync(workspacePackageJson)) {
      return realpathSync(dirname(workspacePackageJson));
    }
  }

  if (packageName === 'fw') {
    const workspacePackageJson = join(process.cwd(), 'packages/cli/package.json');
    if (existsSync(workspacePackageJson)) {
      return realpathSync(dirname(workspacePackageJson));
    }
  }

  const pnpmStore = join(dependencyRoot, '.pnpm');
  for (const entry of readdirSync(pnpmStore)) {
    const packageJson = join(pnpmStore, entry, 'node_modules', packageName, 'package.json');
    if (existsSync(packageJson)) {
      return realpathSync(dirname(packageJson));
    }
  }

  throw new Error(`Unable to resolve generated starter dependency: ${packageName}`);
}

function resolveBin(name: string): string {
  const linkedBin = join(process.cwd(), 'node_modules', '.bin', name);
  if (existsSync(linkedBin)) {
    return realpathSync(linkedBin);
  }

  const pnpmBin = join(process.cwd(), 'node_modules', '.pnpm', 'node_modules', '.bin', name);
  if (existsSync(pnpmBin)) {
    return realpathSync(pnpmBin);
  }

  throw new Error(`Unable to resolve binary: ${name}`);
}
