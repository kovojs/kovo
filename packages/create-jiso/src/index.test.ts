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
      'graph.json',
      'docs/graph-assertions.md',
      'docs/deployment.md',
      'docs/framework-rules.md',
      'src/styles.css',
      'src/app.tsx',
      'src/app.fixpoint.test.ts',
    ]);
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"@jiso/compiler": "workspace:*"',
    );
    expect(project.files.find((file) => file.path === 'package.json')?.source).toContain(
      '"@tailwindcss/vite": "^4.0.0"',
    );
    expect(project.files.find((file) => file.path === 'vite.config.ts')?.source).toContain(
      "command: 'fw check graph.json'",
    );
    expect(project.files.find((file) => file.path === 'vite.config.ts')?.source).toContain(
      'plugins: [tailwindcss()]',
    );
    expect(project.files.find((file) => file.path === 'src/styles.css')?.source).toContain(
      '@source "./**/*.{ts,tsx,html}";',
    );
    expect(
      project.files.find((file) => file.path === 'docs/graph-assertions.md')?.source,
    ).toContain('fw explain mutation cart/add --optimistic graph.json');
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
    expect(project.files.find((file) => file.path === 'src/app.tsx')?.source).toContain(
      'class="mx-auto grid min-h-dvh',
    );
    expect(
      project.files.find((file) => file.path === '.github/workflows/ci.yml')?.source,
    ).toContain('voidzero-dev/setup-vp@v1');
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
