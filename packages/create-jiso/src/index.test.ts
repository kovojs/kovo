import { describe, expect, it } from 'vitest';

import { createJisoProject } from './index.js';

describe('create-jiso starter', () => {
  it('generates a Vite+ scaffold with CI and fw-check recipe', () => {
    const project = createJisoProject({ name: 'My App' });

    expect(project.name).toBe('my-app');
    expect(project.files.map((file) => file.path)).toEqual([
      'package.json',
      'vite.config.ts',
      '.github/workflows/ci.yml',
      'README.md',
      'graph.json',
      'docs/graph-assertions.md',
      'docs/deployment.md',
      'docs/framework-rules.md',
      'src/styles.css',
      'index.html',
      'src/main.ts',
      'src/app.tsx',
      'src/app.fixpoint.test.ts',
    ]);
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"@jiso/compiler": "workspace:*"',
    );
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"fw": "workspace:*"',
    );
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"@tailwindcss/vite": "^4.0.0"',
    );
    expect(project.files.find((file) => file.path === 'vite.config.ts')?.source).toContain(
      "command: 'fw check graph.json'",
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
    const readme = project.files.find((file) => file.path === 'README.md')?.source;
    expect(readme).toContain('vp check');
    expect(readme).toContain('vp test');
    expect(readme).toContain('vp run build');
    expect(readme).toContain('vp run fw-check');
    const graph = JSON.parse(
      project.files.find((file) => file.path === 'graph.json')?.source ?? '{}',
    ) as {
      components?: Array<{ name: string; queries?: string[] }>;
      mutations?: Array<{ key: string; invalidates?: string[] }>;
      optimistic?: Array<{ mutation: string; query: string; status: string }>;
      queries?: Array<{ domains: string[]; query: string }>;
      touchGraph?: Record<string, { touches: Array<{ domain: string }> }>;
    };
    expect(graph.components?.map((component) => component.name)).toEqual([
      'CartBadge',
      'CartPanel',
    ]);
    expect(graph.mutations).toEqual([
      expect.objectContaining({ invalidates: ['cart'], key: 'cart/add' }),
    ]);
    expect(graph.optimistic).toEqual([
      { mutation: 'cart/add', query: 'cart', status: 'await-fragment' },
    ]);
    expect(graph.queries).toEqual([{ domains: ['cart'], query: 'cart' }]);
    expect(graph.touchGraph?.['cart.addItem']?.touches).toEqual([
      expect.objectContaining({ domain: 'cart' }),
    ]);
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
    expect(graphAssertions).toContain('fw explain query cart graph.json > .jiso/cart.query.txt');
    expect(graphAssertions).toContain('diff -u .jiso/cart.expected-consumers.txt');
    expect(graphAssertions).toContain("grep '^invalidated-by: .*cart.addItem'");
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
    expect(project.files.find((file) => file.path === 'src/app.tsx')?.source).toContain(
      'class="mx-auto grid min-h-dvh',
    );
    expect(project.files.find((file) => file.path === 'index.html')?.source).toContain(
      'src="/src/main.ts"',
    );
    expect(project.files.find((file) => file.path === 'src/main.ts')?.source).toContain(
      'target.innerHTML = App.definition.render()',
    );
    expect(
      project.files.find((file) => file.path === '.github/workflows/ci.yml')?.source,
    ).toContain('voidzero-dev/setup-vp@v1');
    expect(
      project.files.find((file) => file.path === '.github/workflows/ci.yml')?.source,
    ).toContain('vp run build');
    expect(
      project.files.find((file) => file.path === '.github/workflows/ci.yml')?.source,
    ).toContain('vp run fw-check');
    const fixpointTest = project.files.find(
      (file) => file.path === 'src/app.fixpoint.test.ts',
    )?.source;
    expect(fixpointTest).toContain(
      "import { assertFixpoint, compileComponentModule } from '@jiso/compiler';",
    );
    expect(fixpointTest).toContain('compileComponentModule');
    expect(fixpointTest).toContain('assertFixpoint(result)');
    expect(fixpointTest).toContain('SPEC.md section 5.2');
  });
});
