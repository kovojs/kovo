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
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { fwCheck, fwExplain, type FwExplainInput } from '../../../packages/cli/src/index.js';
import { createJisoProject, main, writeJisoProject } from './index.js';

describe('create-jiso starter', () => {
  it('keeps inline generation as the only starter source', () => {
    const templateUrl = new URL('../template', import.meta.url);
    const entries = existsSync(templateUrl) ? readdirSync(templateUrl, { recursive: true }) : [];

    expect(entries).toEqual([]);
  });

  it('generates a Vite+ scaffold with CI and fw-check recipe', () => {
    const project = createJisoProject({ name: 'My App' });

    expect(project.name).toBe('my-app');
    expect(project.files.map((file) => file.path)).toEqual([
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
      'src/app.fixpoint.test.ts',
    ]);
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"@jiso/compiler": "workspace:*"',
    );
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"@jiso/runtime": "workspace:*"',
    );
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"fw": "workspace:*"',
    );
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"emit-graph": "node scripts/emit-graph.mjs"',
    );
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"@tailwindcss/vite": "^4.1.0"',
    );
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"tailwindcss": "^4.1.0"',
    );
    expect(project.files.find((file) => file.path === 'vite.config.ts')?.source).toContain(
      "command: 'node scripts/emit-graph.mjs && fw check graph.json'",
    );
    expect(project.files.find((file) => file.path === 'vite.config.ts')?.source).toContain(
      "command: 'node scripts/emit-graph.mjs && node scripts/graph-assertions.mjs'",
    );
    expect(project.files.find((file) => file.path === 'vite.config.ts')?.source).toContain(
      "command: 'vp build'",
    );
    expect(project.files.find((file) => file.path === 'vite.config.ts')?.source).toContain(
      "output: ['dist/**']",
    );
    expect(project.files.find((file) => file.path === 'vite.config.ts')?.source).toContain(
      'plugins: [tailwindcss()]',
    );
    expect(project.files.find((file) => file.path === 'src/styles.css')?.source).toContain(
      '@source "./**/*.{ts,tsx,html}";',
    );
    expect(project.files.find((file) => file.path === 'src/styles.css')?.source).toContain(
      '@source "../index.html";',
    );
    expect(project.files.find((file) => file.path === 'src/styles.css')?.source).toContain(
      '@source inline("bg-emerald-50 text-emerald-700 border-emerald-200 bg-amber-50 text-amber-700 border-amber-200");',
    );
    const readme = project.files.find((file) => file.path === 'README.md')?.source;
    expect(readme).toContain('vp check');
    expect(readme).toContain('vp test');
    expect(readme).toContain('vp run build');
    expect(readme).toContain('vp run emit-graph');
    expect(readme).toContain('vp run fw-check');
    expect(readme).toContain('vp run graph-assertions');
    expect(readme).toContain('@source inline("...")');
    const graph = JSON.parse(
      project.files.find((file) => file.path === 'graph.json')?.source ?? '{}',
    ) as FwExplainInput;
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
    const emitGraph = project.files.find((file) => file.path === 'scripts/emit-graph.mjs')?.source;
    expect(emitGraph).toContain("import { deriveAppGraph } from '@jiso/compiler';");
    expect(emitGraph).toContain('const { graph } = deriveAppGraph({ graph: graphDeclarations });');
    expect(emitGraph).toContain("writeFileSync(new URL('../graph.json', import.meta.url)");
    expect(
      project.files.find((file) => file.path === 'docs/graph-assertions.md')?.source,
    ).toContain('fw explain mutation cart/add --optimistic graph.json');
    expect(
      project.files.find((file) => file.path === 'docs/graph-assertions.md')?.source,
    ).toContain('fw explain --unguarded graph.json');
    expect(
      project.files.find((file) => file.path === 'docs/graph-assertions.md')?.source,
    ).toContain('`FW-Idem` keys make duplicate POSTs replayable');
    expect(
      project.files.find((file) => file.path === 'docs/graph-assertions.md')?.source,
    ).toContain('SPEC.md section 9.1');
    const graphAssertions = project.files.find(
      (file) => file.path === 'docs/graph-assertions.md',
    )?.source;
    expect(graphAssertions).toContain('SPEC.md section 11.4.3');
    expect(graphAssertions).toContain('vp run emit-graph');
    expect(graphAssertions).toContain('scripts/emit-graph.mjs');
    expect(graphAssertions).toContain('deriveAppGraph');
    expect(graphAssertions).toContain('vp run graph-assertions');
    expect(graphAssertions).toContain('scripts/graph-assertions.mjs');
    expect(graphAssertions).toContain('fw explain query cart graph.json > .jiso/cart.query.txt');
    expect(graphAssertions).toContain('diff -u .jiso/cart.expected-consumers.txt');
    expect(graphAssertions).toContain("grep '^invalidated-by: .*cart/add'");
    expect(graphAssertions).toContain("grep '^domain-writes: .*cart.addItem'");
    expect(graphAssertions).toContain("grep '^OPTIMISTIC cart await-fragment'");
    const deploymentDoc = project.files.find((file) => file.path === 'docs/deployment.md')?.source;
    expect(deploymentDoc).toContain('stateless');
    expect(deploymentDoc).toContain('BroadcastChannel');
    expect(deploymentDoc).toContain('Refetch-on-focus/visibility');
    expect(deploymentDoc).toContain('No SSE or live bus ships in v1');
    const frameworkRules = project.files.find(
      (file) => file.path === 'docs/framework-rules.md',
    )?.source;
    expect(frameworkRules).toContain('SPEC.md');
    expect(frameworkRules).toContain('TypeScript static checking plus `fw check`');
    expect(frameworkRules).toContain('`data-bind` paths must exist');
    expect(frameworkRules).toContain('The v1 server is stateless');
    expect(frameworkRules).toContain('`fw explain --unguarded graph.json`');
    expect(frameworkRules).toContain('`FW-Idem` replay for duplicate submissions');
    expect(frameworkRules).toContain('readable `FW-Fragment`/`FW-Targets` headers');
    expect(frameworkRules).toContain('@source inline("...")');
    expect(project.files.find((file) => file.path === 'src/app.tsx')?.source).toContain(
      'class="mx-auto grid min-h-dvh',
    );
    expect(project.files.find((file) => file.path === 'index.html')?.source).toContain(
      '<link rel="stylesheet" href="/src/styles.css" />',
    );
    expect(project.files.find((file) => file.path === 'index.html')?.source).toContain(
      '<script type="module" src="/src/client.ts"></script>',
    );
    expect(project.files.find((file) => file.path === 'index.html')?.source).toContain(
      '<main class="mx-auto grid min-h-dvh',
    );
    const clientSource = project.files.find((file) => file.path === 'src/client.ts')?.source;
    expect(clientSource).toContain('applyDeferredStreamResponseToDom');
    expect(clientSource).toContain('createQueryStore');
    expect(clientSource).toContain('installJisoLoader');
    expect(clientSource).toContain('const queryPlans = {};');
    expect(clientSource).toContain('installJisoLoader({');
    expect(clientSource).toContain('enhancedMutations: {');
    expect(clientSource).toContain('queryPlans,');
    expect(clientSource).toContain('export function applyJisoDeferredStreamResponse');
    expect(clientSource).toContain('return applyDeferredStreamResponseToDom({');
    expect(project.files.some((file) => file.path === 'src/main.ts')).toBe(false);
    expect(
      project.files.find((file) => file.path === '.github/workflows/ci.yml')?.source,
    ).toContain('voidzero-dev/setup-vp@v1');
    expect(
      project.files.find((file) => file.path === '.github/workflows/ci.yml')?.source,
    ).toContain('vp run build');
    expect(
      project.files.find((file) => file.path === '.github/workflows/ci.yml')?.source,
    ).toContain('vp run fw-check');
    expect(
      project.files.find((file) => file.path === '.github/workflows/ci.yml')?.source,
    ).toContain('vp run graph-assertions');
    const graphAssertionScript = project.files.find(
      (file) => file.path === 'scripts/graph-assertions.mjs',
    )?.source;
    expect(graphAssertionScript).toContain("fwExplain(['query', 'cart'])");
    expect(graphAssertionScript).toContain("['component:CartBadge', 'component:CartPanel']");
    expect(graphAssertionScript).toContain('OPTIMISTIC-SUMMARY .*UNHANDLED=0');
    expect(graphAssertionScript).toContain("fwExplain(['page', '/cart'])");
    expect(graphAssertionScript).toContain("explainLine(cartAdd, 'session: ')");
    expect(graphAssertionScript).toContain("explainLine(cartAdd, 'input-fields: ')");
    expect(graphAssertionScript).toContain("explainLine(cartPage, 'meta: ')");
    expect(graphAssertionScript).toContain("explainLine(cartPage, 'i18n: ')");
    expect(graphAssertionScript).toContain("explainLine(cartPage, 'prefetch: ')");
    expect(graphAssertionScript).toContain("explainLine(cartPage, 'modulepreloads: ')");
    expect(graphAssertionScript).toContain("explainLine(cartPage, 'stylesheets: ')");
    expect(graphAssertionScript).toContain("explainLine(cartPage, 'queries: ')");
    const fixpointTest = project.files.find(
      (file) => file.path === 'src/app.fixpoint.test.ts',
    )?.source;
    expect(fixpointTest).toContain("import { readFileSync } from 'node:fs';");
    expect(fixpointTest).toContain(
      "import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from '@jiso/compiler';",
    );
    expect(fixpointTest).toContain('compileComponentModule');
    expect(fixpointTest).toContain("source: readFileSync(new URL('./app.tsx', import.meta.url)");
    expect(fixpointTest).toContain('assertFixpoint(result)');
    expect(fixpointTest).toContain('assertRenderEquivalence(result)');
    expect(fixpointTest).toContain('SPEC.md section 5.2');
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

      execFileSync(
        join(process.cwd(), 'node_modules/.bin/vite'),
        ['build', '--clearScreen', 'false'],
        {
          cwd: root,
          stdio: 'pipe',
        },
      );

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

  it('creates a new target directory from the CLI and derives the package name', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-jiso-cli-'));
    const root = join(parent, 'Hello CLI');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(main([root])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(`create-jiso: wrote 15 files to ${root}\n`);
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
        name: 'hello-cli',
      });
      expect(existsSync(join(root, 'src/app.fixpoint.test.ts'))).toBe(true);
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
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
  const commerceNodeModules = join(process.cwd(), '../..', 'examples/commerce/node_modules');
  const nodeModules = join(root, 'node_modules');
  mkdirSync(join(nodeModules, '@jiso'), { recursive: true });
  mkdirSync(join(nodeModules, '@tailwindcss'), { recursive: true });

  symlinkSync(
    realpathSync(join(commerceNodeModules, '@tailwindcss/vite')),
    join(nodeModules, '@tailwindcss/vite'),
  );
  symlinkSync(
    realpathSync(join(commerceNodeModules, '@jiso/core')),
    join(nodeModules, '@jiso/core'),
  );
  symlinkSync(
    realpathSync(join(commerceNodeModules, '@jiso/runtime')),
    join(nodeModules, '@jiso/runtime'),
  );
  symlinkSync(
    realpathSync(join(commerceNodeModules, 'tailwindcss')),
    join(nodeModules, 'tailwindcss'),
  );
  symlinkSync(realpathSync(join(commerceNodeModules, 'vite-plus')), join(nodeModules, 'vite-plus'));
}
