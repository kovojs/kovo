import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));

describe('server security bootstrap census', () => {
  it('eagerly imports every server intrinsic membrane', () => {
    const source = readFileSync(new URL('./security-bootstrap.ts', import.meta.url), 'utf8');
    const intrinsicModules = readdirSync(sourceDirectory)
      .filter((fileName) => fileName.endsWith('-intrinsics.ts'))
      // Build-only controls are captured by the build/static-export entries; command controls are
      // captured by preloading the root server barrel before the app graph. Keeping both out of the
      // neutral bootstrap lets tree shaking omit unsupported node:child_process from Workers.
      .filter(
        (fileName) =>
          fileName !== 'build-security-intrinsics.ts' && fileName !== 'command-intrinsics.ts',
      )
      .sort();

    expect(intrinsicModules.length).toBeGreaterThan(0);
    for (const fileName of intrinsicModules) {
      expect(source, fileName).toContain(`'./${fileName.replace(/\.ts$/u, '.js')}'`);
    }
  });

  it('is the first dependency of every supported server entry', () => {
    const entries = [
      ['build.ts', "import './security-bootstrap.js';"],
      ['index.ts', "import './security-bootstrap.js';"],
      ['jsx-runtime.ts', "import './security-bootstrap.js';"],
      ['testing.ts', "import './security-bootstrap.js';"],
      ['internal/app-shell-vite.ts', "import '../security-bootstrap.js';"],
      ['internal/build.ts', "import '../security-bootstrap.js';"],
      ['internal/static-export.ts', "import '../security-bootstrap.js';"],
    ] as const;

    for (const [fileName, bootstrapImport] of entries) {
      const source = readFileSync(new URL(fileName, import.meta.url), 'utf8');
      expect(source.indexOf(bootstrapImport), fileName).toBe(0);
    }
  });

  it('captures config-time compiler and data-plane controls through native-TS-safe entries', () => {
    const source = readFileSync(new URL('./vite.ts', import.meta.url), 'utf8');
    const compilerBootstrap = source.indexOf(
      "import '@kovojs/compiler/internal/security-bootstrap';",
    );
    const dataPlaneBootstrap = source.indexOf(
      "from './internal/data-plane-static-analysis-intrinsics.ts';",
    );
    const firstAuthoredIntegrationImport = source.indexOf(
      "from '@kovojs/server/internal/data-plane-static-analysis';",
    );

    expect(compilerBootstrap).toBeGreaterThanOrEqual(0);
    expect(dataPlaneBootstrap).toBeGreaterThan(compilerBootstrap);
    expect(firstAuthoredIntegrationImport).toBeGreaterThan(dataPlaneBootstrap);
  });

  it('preloads the complete server profile before the authored Vite app graph', () => {
    const source = readFileSync(new URL('./vite-dev.ts', import.meta.url), 'utf8');
    const rootLoad = source.indexOf('await server.ssrLoadModule(kovoServerRootModuleId);');
    const appLoad = source.indexOf('const module = await server.ssrLoadModule(moduleId);');

    expect(rootLoad).toBeGreaterThan(0);
    expect(appLoad).toBeGreaterThan(rootLoad);
  });
});
