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

import type { KovoExplainInput } from '@kovojs/core/internal/graph';

import { kovoCheck, kovoExplain } from '../../../packages/cli/src/index.js';
import { createKovoProject, main, writeKovoProject } from './index.js';

const legacyCssTool = ['tail', 'windcss'].join('');
const legacyCssVitePlugin = `@${legacyCssTool}/vite`;
const legacyCssSourceDirective = ['@sou', 'rce'].join('');

describe('create-kovo starter', () => {
  it('scaffolds real template files with CI and kovo-check recipe', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-scaffold-'));
    const expectedFiles = [
      'package.json',
      'vite.config.ts',
      '.github/workflows/ci.yml',
      'README.md',
      'graph.json',
      'scripts/export-static.mjs',
      'scripts/preview-static.mjs',
      'scripts/serve.mjs',
      'scripts/emit-graph.mjs',
      'scripts/graph-assertions.mjs',
      'docs/graph-assertions.md',
      'docs/deployment.md',
      'docs/framework-rules.md',
      'src/styles.css',
      'src/theme.ts',
      'src/client.ts',
      'index.html',
      'src/app.tsx',
      'src/app-shell.ts',
      'src/app-shell.test.ts',
      'src/auth.tsx',
    ];
    // SECURITY_FINDINGS.md M5: create-kovo also emits generated (non-template) files —
    // a gitignored .env carrying a per-project random CSRF secret, a committed
    // .env.example, and a .gitignore.
    const generatedFiles = ['.env', '.env.example', '.gitignore'];
    const expectedAllFiles = [...expectedFiles, ...generatedFiles];

    try {
      const templateUrl = new URL('../templates/', import.meta.url);
      for (const file of expectedFiles) {
        expect(existsSync(new URL(file, templateUrl))).toBe(true);
      }

      const result = writeKovoProject(root, { name: 'My App' });
      expect(result).toEqual({ files: expectedAllFiles, name: 'my-app', root });

      for (const file of expectedFiles) {
        const source = readFileSync(join(root, file), 'utf8');
        expect(source).not.toContain('{{');
        expect(source).not.toContain('}}');
      }

      const project = createKovoProject({ name: 'My App' });
      expect(project.name).toBe('my-app');
      expect(project.files.map((file) => file.path)).toEqual(expectedAllFiles);

      const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        name?: string;
        scripts?: Record<string, string>;
      };
      expect(packageJson.name).toBe('my-app');
      expect(packageJson.dependencies).toMatchObject({
        '@kovojs/better-auth': 'workspace:*',
        '@kovojs/core': 'workspace:*',
        '@kovojs/runtime': 'workspace:*',
        '@kovojs/server': 'workspace:*',
        '@kovojs/style': 'workspace:*',
      });
      expect(packageJson.devDependencies).toMatchObject({
        '@kovojs/cli': 'workspace:*',
        '@types/node': '^25.0.0',
        vite: '^8.0.16',
      });
      expect(packageJson.devDependencies).not.toHaveProperty('@kovojs/compiler');
      expect(packageJson.devDependencies).not.toHaveProperty(legacyCssVitePlugin);
      expect(packageJson.devDependencies).not.toHaveProperty(legacyCssTool);
      expect(packageJson.scripts).toMatchObject({
        check: 'vp check',
        dev: 'vp dev',
        'emit-graph': 'node scripts/emit-graph.mjs',
        'preview:static': 'node scripts/preview-static.mjs',
        serve: 'node scripts/serve.mjs',
        start: 'node scripts/serve.mjs',
        static: 'vp run export',
        test: 'vp test',
      });

      const graph = JSON.parse(readFileSync(join(root, 'graph.json'), 'utf8')) as KovoExplainInput;
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
            title: 'Kovo Starter Cart',
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
      expect(kovoCheck(graph)).toEqual({
        exitCode: 0,
        output: 'kovo-check/v1\nOK\n',
      });
      expect(kovoExplain(graph, { kind: 'query', target: 'cart' })).toEqual({
        exitCode: 0,
        output:
          'kovo-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,component:CartPanel,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
      });
      expect(
        kovoExplain(graph, { kind: 'mutation', optimistic: true, target: 'cart/add' }),
      ).toEqual({
        exitCode: 0,
        output: [
          'kovo-explain/v1',
          'MUTATION cart/add',
          'guards: authed',
          'session: starterSession',
          'input-fields: productId,quantity',
          'writes: cart',
          'invalidates: cart',
          'manual-invalidates: -',
          'updates: cart->component:CartBadge,component:CartPanel,page:/cart',
          'OPTIMISTIC cart await-fragment',
          'OPTIMISTIC-SUMMARY total=1 derived=0 hand-written=0 await-fragment=1 UNHANDLED=0 PUNTED=0',
          '',
        ].join('\n'),
      });
      expect(kovoExplain(graph, { kind: 'page', target: '/cart' })).toEqual({
        exitCode: 0,
        output: [
          'kovo-explain/v1',
          'PAGE /cart',
          'prefetch: false',
          'meta: title=Kovo Starter Cart description=Starter cart backed by query data. image=-',
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
      expect(readFileSync(join(root, 'docs/graph-assertions.md'), 'utf8')).toContain(
        'not direct compiler API ownership',
      );
      const readme = readFileSync(join(root, 'README.md'), 'utf8');
      expect(readme).toContain('starter-export/v1');
      expect(readme).toContain('starter-static-preview/v1');
      expect(readme).toContain('npm run static');
      expect(readme).toContain('npm run serve');
      expect(readFileSync(join(root, 'docs/deployment.md'), 'utf8')).toContain(
        'SPEC.md section 9.3',
      );
      const frameworkRules = readFileSync(join(root, 'docs/framework-rules.md'), 'utf8');
      expect(frameworkRules).toContain('SPEC.md');
      expect(frameworkRules).toContain(
        'Compiler fixpoint and render-equivalence coverage belongs to Kovo framework CI',
      );
      expect(existsSync(join(root, 'src/app.fixpoint.test.ts'))).toBe(false);
      const appSource = readFileSync(join(root, 'src/app.tsx'), 'utf8');
      expect(appSource).toContain('@jsxImportSource @kovojs/server');
      expect(appSource).toContain("import { tokens } from '@kovojs/style';");
      expect(appSource).toContain("import * as style from '@kovojs/style';");
      expect(appSource).toContain('style.create(');
      expect(appSource).toContain('style.attrs(appStyles.root)');
      expect(appSource).toContain('starterAppStyleCss');
      expect(appSource).toContain('props: { cartCount: Number }');
      expect(appSource).toContain('Starter cart count: {cartCount}');
      expect(appSource).toContain('<main');
      expect(appSource).toContain('on:click="/c/starter.client.js?v=starter-r7#Starter$announce"');
      expect(appSource).not.toContain('mx-auto');
      expect(appSource).not.toContain('text-kovo-accent');
      expect(appSource).toContain('tokens.sys.color.primary');
      expect(appSource).toContain("tokens.customColor('success').colorContainer");
      expect(appSource).not.toMatch(/render:\s*\(\)\s*=>\s*['"`]</);
      const appShellSource = readFileSync(join(root, 'src/app-shell.ts'), 'utf8');
      expect(appShellSource).toContain("from '@kovojs/server'");
      expect(appShellSource).toContain("from './theme.js'");
      expect(appShellSource).toContain('createMemoryVersionedClientModuleRegistry');
      expect(appShellSource).toContain('createRequestHandler');
      expect(appShellSource).toContain('layout');
      expect(appShellSource).toContain('route');
      expect(appShellSource).not.toContain('@kovojs/server/app-shell/core');
      expect(appShellSource).not.toContain('@kovojs/server/app-shell/client-modules');
      expect(appShellSource).toContain('criticalCss: starterCriticalCss');
      expect(appShellSource).toContain('export const starterLayout = layout<StarterRequest>');
      expect(appShellSource).toContain('data-session="${request.session?.user.id ?? \'guest\'}"');
      expect(appShellSource).toContain('db: () => starterDb');
      expect(appShellSource).toContain('sessionProvider: starterSessionProvider');
      expect(appShellSource).toContain("route('/',");
      expect(appShellSource).toContain('createRequestHandler(app)');
      expect(appShellSource).toContain("path: '/c/starter.client.js'");
      expect(appShellSource).toContain("version: 'starter-r7'");
      expect(appShellSource).not.toContain('starterNodeHandler');
      expect(appShellSource).not.toContain('nodeRequestToWebRequest');
      expect(appShellSource).not.toContain('writeWebResponseToNode');
      const appShellTestSource = readFileSync(join(root, 'src/app-shell.test.ts'), 'utf8');
      expect(appShellTestSource).toContain('SPEC.md section 9.5');
      expect(appShellTestSource).toContain("from '@kovojs/server'");
      expect(appShellTestSource).not.toContain('@kovojs/server/app-shell/core');
      expect(appShellTestSource).not.toContain('@kovojs/server/app-shell/static-export');
      expect(appShellTestSource).toContain('isKovoApp(app)');
      expect(appShellTestSource).toContain('isDirectoryIndexDocumentPath');
      expect(appShellTestSource).not.toContain(
        'assertStaticExportManifestUsesDirectoryIndexDocuments',
      );
      expect(appShellTestSource).not.toContain('staticExportManifest');
      const authSource = readFileSync(join(root, 'src/auth.tsx'), 'utf8');
      expect(authSource).toContain("from '@kovojs/better-auth'");
      expect(authSource).toContain("import * as style from '@kovojs/style';");
      expect(authSource).toContain('style.create(');
      expect(authSource).toContain('style.attrs(authStyles.form)');
      expect(authSource).toContain('starterAuthStyleCss');
      expect(authSource).toContain('betterAuthSession');
      expect(authSource).toContain('betterAuthSignInEmailMutation');
      expect(authSource).toContain('betterAuthSignOutMutation');
      expect(authSource).toContain("role<StarterAuthRequest>('admin')");
      expect(authSource).toContain('type StarterAuthBindings');
      expect(authSource).toContain('renderLoginForm(auth: StarterAuthBindings');
      expect(authSource).toContain('mutation={auth.signIn}');
      expect(authSource).toContain("FieldError({ failure: null, name: 'email'");
      expect(authSource).toContain("FieldError({ failure: null, name: 'password'");
      expect(authSource).toContain('FormError({');
      expect(authSource).toContain('renderLogoutForm(auth: StarterAuthBindings');
      expect(authSource).toContain('mutation={auth.signOut}');
      expect(authSource).not.toContain('action="/_m/auth/sign-in"');
      expect(authSource).not.toContain('data-mutation="auth/sign-in"');
      expect(authSource).not.toContain('action="/_m/auth/sign-out"');
      expect(authSource).not.toContain('data-mutation="auth/sign-out"');
      expect(authSource).toContain('csrfField(options.request, starterAuthCsrf)');
      expect(authSource).toContain('csrfField(request, starterAuthCsrf)');
      expect(authSource).not.toContain('@better-auth/client');
      expect(authSource).not.toContain('border-slate-200');
      expect(authSource).not.toContain('bg-kovo-accent');
      const themeSource = readFileSync(join(root, 'src/theme.ts'), 'utf8');
      expect(themeSource).toContain('defineTheme');
      expect(themeSource).toContain("seed: '#0f8b8d'");
      expect(themeSource).toContain('starterThemeCss');
      expect(readFileSync(join(root, 'src/styles.css'), 'utf8')).toContain(
        '@layer kovo-starter-base',
      );
      expect(readFileSync(join(root, 'src/styles.css'), 'utf8')).toContain(
        'var(--kovo-theme-sys-color-surface)',
      );
      expect(readFileSync(join(root, 'src/styles.css'), 'utf8')).not.toContain(
        legacyCssSourceDirective,
      );
      expect(readFileSync(join(root, 'src/styles.css'), 'utf8')).not.toContain(legacyCssTool);
      const indexSource = readFileSync(join(root, 'index.html'), 'utf8');
      expect(indexSource).toContain('/src/styles.css');
      expect(indexSource).toContain('Build-only Vite asset entry');
      expect(indexSource).toContain('SPEC.md section 9.5');
      expect(indexSource).not.toContain('/src/client.ts');
      expect(indexSource).not.toContain('Hello from Kovo');
      const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');
      expect(viteConfig).toContain('starterSharedAppShellDevPlugin()');
      expect(viteConfig).toContain("server.ssrLoadModule('@kovojs/server')");
      expect(viteConfig).toContain('createKovoAppShellViteDevIntegration');
      expect(viteConfig).not.toContain(legacyCssVitePlugin);
      expect(viteConfig).not.toContain(`${legacyCssTool}()`);
      expect(viteConfig).not.toContain('kovoAppShellViteSsrDevPlugin');
      expect(viteConfig).toContain('earlyHints: false');
      expect(viteConfig).toContain("name: 'kovo-starter-app-shell-dev'");
      expect(viteConfig).not.toContain('nodeHandlerExportName');
      expect(viteConfig).toContain('manifest: true');
      expect(viteConfig).toContain('node scripts/export-static.mjs');
      expect(viteConfig).not.toContain("pathname === '/'");
      expect(viteConfig).not.toContain("pathname.startsWith('/c/')");
      const exportStaticScript = readFileSync(join(root, 'scripts/export-static.mjs'), 'utf8');
      expect(exportStaticScript).toContain("execFileSync('vp', ['build']");
      expect(exportStaticScript).toContain("ssrLoadModule('@kovojs/cli')");
      expect(exportStaticScript).toContain('runKovoCommand');
      expect(exportStaticScript).toContain("'export'");
      expect(exportStaticScript).toContain("'--vite'");
      expect(exportStaticScript).toContain("'/src/app-shell.ts'");
      expect(exportStaticScript).not.toContain("server.ssrLoadModule('@kovojs/server')");
      expect(exportStaticScript).not.toContain("@kovojs/server/app-shell/vite");
      expect(exportStaticScript).not.toContain('@kovojs/server/app-shell/core');
      expect(exportStaticScript).not.toContain('@kovojs/server/app-shell/static-export');
      expect(exportStaticScript).not.toContain('kovoAppShellViteManifestStylesheetHrefFromFile');
      expect(exportStaticScript).not.toContain('formatStaticExportDiagnostic');
      expect(exportStaticScript).not.toContain('formatStaticExportDiagnostics');
      expect(exportStaticScript).not.toContain(
        'exportKovoAppShellViteBuildWithManifestFromManifestFile',
      );
      expect(exportStaticScript).toContain('KOVO_STARTER_STYLESHEET_HREF');
      expect(exportStaticScript).not.toContain('isKovoApp');
      expect(exportStaticScript).not.toContain('const app = appModule.default;');
      expect(exportStaticScript).not.toContain('isStaticExportDiagnosticError');
      expect(exportStaticScript).toContain('starter-export/v1');
      expect(exportStaticScript).not.toContain('function isKovoApp');
      expect(exportStaticScript).not.toContain('appModule.default ?? appModule.app');
      expect(exportStaticScript).not.toContain('htmlPathStyle');
      const emitGraphScript = readFileSync(join(root, 'scripts/emit-graph.mjs'), 'utf8');
      expect(emitGraphScript).toContain('const graph = {');
      expect(emitGraphScript).not.toContain('@kovojs/compiler');
      expect(emitGraphScript).not.toContain('deriveAppGraph');
      const previewStaticScript = readFileSync(join(root, 'scripts/preview-static.mjs'), 'utf8');
      expect(previewStaticScript).toContain('createStarterStaticPreviewServer');
      expect(previewStaticScript).toContain('starter-static-preview/v1');
      expect(previewStaticScript).toContain('Static export directory not found');
      expect(previewStaticScript).toContain("method !== 'GET' && method !== 'HEAD'");
      expect(previewStaticScript).toContain("'content-length': statSync(filePath).size");
      expect(previewStaticScript).toContain("decodedPath.startsWith('/c/')");
      expect(previewStaticScript).toContain(
        "headers['cache-control'] = 'public, max-age=31536000, immutable'",
      );
      const serveScript = readFileSync(join(root, 'scripts/serve.mjs'), 'utf8');
      expect(serveScript).toContain('createStarterServeServer');
      expect(serveScript).toContain('configFile: fileURLToPath(new URL');
      expect(serveScript).toContain('starter-serve/v1');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('writes createKovoProject files to an empty target directory deterministically', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-'));

    try {
      const result = writeKovoProject(root, { name: 'Example Shop' });
      const project = createKovoProject({ name: 'Example Shop' });

      expect(result).toEqual({
        files: project.files.map((file) => file.path),
        name: 'example-shop',
        root,
      });

      for (const file of project.files) {
        // SECURITY_FINDINGS.md M5: .env carries a freshly generated per-project random
        // secret, so its content is intentionally non-deterministic across calls and is
        // asserted separately below.
        if (file.path === '.env') continue;
        expect(readFileSync(join(root, file.path), 'utf8')).toBe(file.source);
      }

      const envSource = readFileSync(join(root, '.env'), 'utf8');
      const secretMatch = /^KOVO_CSRF_SECRET=(.+)$/m.exec(envSource);
      expect(secretMatch).not.toBeNull();
      const writtenSecret = secretMatch?.[1] ?? '';
      // A 32-byte base64url secret is 43 characters and never the shipped placeholder.
      expect(writtenSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(writtenSecret).not.toBe('replace-with-a-deployed-secret');
      // Each scaffold generates a distinct secret.
      expect(writtenSecret).not.toBe(
        /^KOVO_CSRF_SECRET=(.+)$/m.exec(
          project.files.find((file) => file.path === '.env')?.source ?? '',
        )?.[1],
      );

      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_CSRF_SECRET=replace-with-a-deployed-secret',
      );
      expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.env');

      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
        name: 'example-shop',
        private: true,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('builds generated starter CSS without legacy CSS tool setup', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-build-'));

    try {
      writeKovoProject(root, { name: 'Build Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(resolveBin('vite'), ['build', '--clearScreen', 'false'], {
        cwd: root,
        stdio: 'pipe',
      });

      const cssFile = readdirSync(join(root, 'dist/assets')).find((file) => file.endsWith('.css'));
      expect(cssFile).toBeTypeOf('string');
      const css = readFileSync(join(root, 'dist/assets', cssFile ?? ''), 'utf8');

      expect(css).toContain('@layer kovo-starter-base');
      expect(css).toContain('font-synthesis:none');
      expect(css).not.toContain(legacyCssTool);
      expect(css).not.toContain(legacyCssSourceDirective);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('typechecks the generated auth recipe with starter dependencies', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-auth-'));

    try {
      writeKovoProject(root, { name: 'Auth Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(
        resolveBin('tsc'),
        [
          '--ignoreConfig',
          '--noEmit',
          '--jsx',
          'react-jsx',
          '--jsxImportSource',
          '@kovojs/server',
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

  it('runs the generated starter app-shell request, export, and graph proof', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-app-shell-'));

    try {
      writeKovoProject(root, { name: 'App Shell Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(resolveBin('vitest'), ['--run', 'src/app-shell.test.ts'], {
        cwd: root,
        stdio: 'pipe',
      });
      expect(
        execFileSync(process.execPath, ['scripts/emit-graph.mjs'], {
          cwd: root,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      ).toBe('emit-graph/v1\nOK\n');
      const emittedGraph = JSON.parse(readFileSync(join(root, 'graph.json'), 'utf8'));
      expect(kovoCheck(emittedGraph)).toEqual({
        exitCode: 0,
        output: 'kovo-check/v1\nOK\n',
      });
      expect(
        kovoExplain(emittedGraph, { kind: 'mutation', optimistic: true, target: 'cart/add' }),
      ).toMatchObject({
        exitCode: 0,
        output: expect.stringContaining('OPTIMISTIC cart await-fragment\n'),
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 15_000);

  it('serves the generated starter app-shell through the vp dev task', async () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-vp-dev-'));
    const port = await reservePort();
    let devServer: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Dev Task Proof' });
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
      expect(sourceCss).toContain('@layer kovo-starter-base');
      expect(sourceCss).toContain('var(--kovo-theme-sys-color-surface)');
      expect(sourceCss).not.toContain(legacyCssTool);

      const sourceEntry = await fetchTextWhenReady(`${origin}/index.html`, output);
      expect(sourceEntry).toContain('Build-only Vite asset entry');
      expect(sourceEntry).not.toContain('Hello from Kovo');
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
      const root = mkdtempSync(join(tempParent, 'create-kovo-serve-'));
      const port = await reservePort();
      let serveServer: ChildProcessWithoutNullStreams | undefined;

      try {
        writeKovoProject(root, { name: 'Serve Task Proof' });
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
        expect(documentBody).toContain('--kovo-theme-sys-color-primary');
        expect(documentBody).toContain(
          'on:click="/c/starter.client.js?v=starter-r7#Starter$announce"',
        );

        const moduleBody = await fetchTextWhenReady(
          `${origin}/c/starter.client.js?v=starter-r7`,
          output,
        );
        expect(moduleBody).toContain('export function Starter$announce');

        const sourceCss = await fetchTextWhenReady(`${origin}/src/styles.css`, output);
        expect(sourceCss).toContain('@layer kovo-starter-base');
        expect(sourceCss).toContain('var(--kovo-theme-sys-color-surface)');
        expect(sourceCss).not.toContain(legacyCssTool);
      } finally {
        await stopProcess(serveServer);
        rmSync(root, { force: true, recursive: true });
      }
    }, 30000);
  }

  for (const exportCommand of generatedStarterExportCommands()) {
    it(`runs ${exportCommand.label} with the built stylesheet href`, async () => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-kovo-export-task-'));
      const port = await reservePort();
      let staticPreviewServer: ChildProcessWithoutNullStreams | undefined;

      try {
        writeKovoProject(root, { name: 'Export Task Proof' });
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
        expect(output).toContain('starter-export/v1\nHTML /index.html status=200 bytes=');
        expect(output).toContain(
          'CLIENT-MODULE /c/starter.client.js href="/c/starter.client.js?v=starter-r7" status=200 bytes=',
        );
        expect(output).toContain(`ASSET /assets/${cssFile} status=200 bytes=`);
        expect(output).toContain('SUMMARY html=1 clientModules=1 assets=1 diagnostics=0');
        expect(distIndex).toContain(`href="/assets/${cssFile}"`);
        expect(distIndex).toContain('<style data-kovo-critical-href="/assets/');
        expect(distIndex).toContain('--kovo-theme-sys-color-primary');
        expect(distIndex).toContain('kv-starter-app-');
        expect(distIndex).toContain(
          'on:click="/c/starter.client.js?v=starter-r7#Starter$announce"',
        );
        expect(distIndex).not.toContain('/src/styles.css');
        expect(distIndex).not.toContain('/src/client.ts');
        expect(distIndex).not.toContain('Build-only Vite asset entry');
        const exportedCss = readFileSync(join(root, 'dist/assets', cssFile ?? ''), 'utf8');
        expect(exportedCss).toContain('@layer kovo-starter-base');
        expect(exportedCss).toContain('var(--kovo-theme-sys-color-surface)');
        expect(exportedCss).not.toContain(legacyCssTool);
        expect(readFileSync(join(root, 'dist/c/starter.client.js'), 'utf8')).toContain(
          'Starter$announce',
        );

        staticPreviewServer = spawn(
          vpCommand(),
          [
            'run',
            '--no-cache',
            'preview-static',
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--strictPort',
          ],
          {
            cwd: root,
            detached: process.platform !== 'win32',
            env: withGeneratedBinOnPath(root),
          },
        );
        const previewOutput = collectOutput(staticPreviewServer);
        const origin = `http://127.0.0.1:${port}`;
        const previewDocument = await fetchTextWhenReady(`${origin}/`, previewOutput);

        expect(previewOutput()).toContain('starter-static-preview/v1');
        expect(previewDocument).toContain(`href="/assets/${cssFile}"`);
        expect(previewDocument).toContain('--kovo-theme-sys-color-primary');
        expect(previewDocument).toContain('kv-starter-app-');
        expect(previewDocument).toContain(
          'on:click="/c/starter.client.js?v=starter-r7#Starter$announce"',
        );
        expect(previewDocument).not.toContain('/src/styles.css');

        const previewCss = await fetchTextWhenReady(`${origin}/assets/${cssFile}`, previewOutput);
        expect(previewCss).toContain('@layer kovo-starter-base');
        expect(previewCss).toContain('var(--kovo-theme-sys-color-surface)');
        expect(previewCss).not.toContain(legacyCssTool);

        const previewClientModule = await fetchTextWhenReady(
          `${origin}/c/starter.client.js?v=starter-r7`,
          previewOutput,
        );
        expect(previewClientModule).toContain('Starter$announce');

        const headDocument = await fetch(`${origin}/`, { method: 'HEAD' });
        expect(headDocument.status).toBe(200);
        expect(headDocument.headers.get('content-type')).toContain('text/html');
        expect(headDocument.headers.get('content-length')).toBe(String(distIndex.length));
        await expect(headDocument.text()).resolves.toBe('');

        const headClientModule = await fetch(`${origin}/c/starter.client.js?v=starter-r7`, {
          method: 'HEAD',
        });
        expect(headClientModule.status).toBe(200);
        expect(headClientModule.headers.get('content-type')).toContain('text/javascript');
        expect(headClientModule.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        await expect(headClientModule.text()).resolves.toBe('');

        const mutationFallback = await fetch(`${origin}/_m/cart/add`, { method: 'POST' });
        expect(mutationFallback.status).toBe(405);
        expect(mutationFallback.headers.get('allow')).toBe('GET, HEAD');

        const sourceFallback = await fetch(`${origin}/src/styles.css`);
        expect(sourceFallback.status).toBe(404);
      } finally {
        await stopProcess(staticPreviewServer);
        rmSync(root, { force: true, recursive: true });
      }
    }, 30000);
  }

  it('formats generated export task diagnostics when a starter route is not exportable', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-export-diagnostic-'));

    try {
      writeKovoProject(root, { name: 'Export Diagnostic Proof' });
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
        "starter-export/v1\nERROR KV229 route=/ KV229 static export cannot export guarded route '/'",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('creates a new target directory from the CLI and derives the package name', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-'));
    const root = join(parent, 'Hello CLI');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(main([root])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(`create-kovo: wrote 24 files to ${root}\n`);
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
        name: 'hello-cli',
      });
      expect(existsSync(join(root, 'src/app.fixpoint.test.ts'))).toBe(false);
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('writes CLI failure output to stderr while returning a non-zero exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-cli-error-'));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(join(root, 'README.md'), 'existing', 'utf8');

      expect(main([root])).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(`create-kovo: Target directory is not empty: ${root}\n`);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('runs as a CLI entrypoint when the script path contains spaces', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-entry-'));
    const spacedDir = join(parent, 'entry path with spaces');
    const entryPath = join(spacedDir, 'create-kovo.ts');

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

      expect(output).toBe('usage: create-kovo <target-directory> [--name <package-name>]\n');
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('refuses to write into a non-empty target directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-collision-'));
    const existingPath = join(root, 'README.md');
    writeFileSync(existingPath, 'existing', 'utf8');

    try {
      expect(() => writeKovoProject(root, { name: 'Collision' })).toThrow(
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
  mkdirSync(join(nodeModules, '@kovojs'), { recursive: true });
  mkdirSync(join(nodeModules, '@types'), { recursive: true });
  mkdirSync(nodeModulesBin, { recursive: true });

  symlinkSync(join(resolveDependencyRoot('vite-plus'), 'bin/vp'), join(nodeModulesBin, 'vp'));
  symlinkSync(resolveDependencyRoot('@types/node'), join(nodeModules, '@types/node'));
  symlinkSync(
    resolveDependencyRoot('@kovojs/better-auth'),
    join(nodeModules, '@kovojs/better-auth'),
  );
  symlinkSync(resolveDependencyRoot('@kovojs/core'), join(nodeModules, '@kovojs/core'));
  symlinkSync(resolveDependencyRoot('@kovojs/runtime'), join(nodeModules, '@kovojs/runtime'));
  symlinkSync(resolveDependencyRoot('@kovojs/server'), join(nodeModules, '@kovojs/server'));
  symlinkSync(resolveDependencyRoot('@kovojs/style'), join(nodeModules, '@kovojs/style'));
  symlinkSync(resolveDependencyRoot('@kovojs/cli'), join(nodeModules, '@kovojs/cli'));
  symlinkSync(resolveDependencyRoot('kovo'), join(nodeModules, 'kovo'));
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

  if (packageName.startsWith('@kovojs/')) {
    const workspacePackageJson = join(
      process.cwd(),
      'packages',
      packageName.slice('@kovojs/'.length),
      'package.json',
    );
    if (existsSync(workspacePackageJson)) {
      return realpathSync(dirname(workspacePackageJson));
    }
  }

  if (packageName === 'kovo') {
    const workspacePackageJson = join(process.cwd(), 'packages/cli/package.json');
    if (existsSync(workspacePackageJson)) {
      return realpathSync(dirname(workspacePackageJson));
    }
  }

  const pnpmStore = findPnpmStore(dependencyRoot);
  if (pnpmStore) {
    for (const entry of readdirSync(pnpmStore)) {
      const packageJson = join(pnpmStore, entry, 'node_modules', packageName, 'package.json');
      if (existsSync(packageJson)) {
        return realpathSync(dirname(packageJson));
      }
    }
  }

  throw new Error(`Unable to resolve generated starter dependency: ${packageName}`);
}

function findPnpmStore(start: string): string | undefined {
  let current = start;
  while (true) {
    for (const candidate of [join(current, '.pnpm'), join(current, 'node_modules/.pnpm')]) {
      if (existsSync(candidate)) return candidate;
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function resolveBin(name: string): string {
  let current = process.cwd();
  while (true) {
    for (const candidate of [
      join(current, 'node_modules/.bin', name),
      join(current, 'node_modules/.pnpm/node_modules/.bin', name),
    ]) {
      if (existsSync(candidate)) {
        return realpathSync(candidate);
      }
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Unable to resolve binary: ${name}`);
}
