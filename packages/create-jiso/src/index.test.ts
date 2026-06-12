import { execFileSync } from 'node:child_process';
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
      'scripts/emit-graph.mjs',
      'scripts/graph-assertions.mjs',
      'docs/graph-assertions.md',
      'docs/deployment.md',
      'docs/framework-rules.md',
      'src/styles.css',
      'src/client.ts',
      'index.html',
      'src/app.tsx',
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
        fw: 'workspace:*',
        tailwindcss: '^4.1.0',
      });
      expect(packageJson.scripts).toMatchObject({
        'emit-graph': 'node scripts/emit-graph.mjs',
        'fw-check': 'vp run fw-check',
        'graph-assertions': 'vp run graph-assertions',
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
      expect(readFileSync(join(root, 'docs/deployment.md'), 'utf8')).toContain(
        'SPEC.md section 9.3',
      );
      expect(readFileSync(join(root, 'docs/framework-rules.md'), 'utf8')).toContain('SPEC.md');
      expect(readFileSync(join(root, 'src/app.fixpoint.test.ts'), 'utf8')).toContain(
        'SPEC.md section 5.2',
      );
      const appSource = readFileSync(join(root, 'src/app.tsx'), 'utf8');
      expect(appSource).toContain('@jsxImportSource @jiso/server');
      expect(appSource).toContain('<main class=');
      expect(appSource).not.toMatch(/render:\s*\(\)\s*=>\s*['"`]</);
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
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain(
        '<script type="module" src="/src/client.ts"></script>',
      );
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
        ],
        { cwd: root, stdio: 'pipe' },
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
      expect(stdout).toHaveBeenCalledWith(`create-jiso: wrote 16 files to ${root}\n`);
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
  mkdirSync(join(nodeModules, '@jiso'), { recursive: true });
  mkdirSync(join(nodeModules, '@tailwindcss'), { recursive: true });

  symlinkSync(resolveDependencyRoot('@tailwindcss/vite'), join(nodeModules, '@tailwindcss/vite'));
  symlinkSync(resolveDependencyRoot('@jiso/better-auth'), join(nodeModules, '@jiso/better-auth'));
  symlinkSync(resolveDependencyRoot('@jiso/core'), join(nodeModules, '@jiso/core'));
  symlinkSync(resolveDependencyRoot('@jiso/runtime'), join(nodeModules, '@jiso/runtime'));
  symlinkSync(resolveDependencyRoot('@jiso/server'), join(nodeModules, '@jiso/server'));
  symlinkSync(resolveDependencyRoot('tailwindcss'), join(nodeModules, 'tailwindcss'));
  symlinkSync(resolveDependencyRoot('vite-plus'), join(nodeModules, 'vite-plus'));
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
    return linkedBin;
  }

  const pnpmBin = join(process.cwd(), 'node_modules', '.pnpm', 'node_modules', '.bin', name);
  if (existsSync(pnpmBin)) {
    return pnpmBin;
  }

  throw new Error(`Unable to resolve binary: ${name}`);
}
