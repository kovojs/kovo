import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  claimCompilerClientModuleViteInstaller,
  compilerClientModuleViteEpoch,
} from './compiler-client-module-provenance-vite.js';
import {
  bindKovoAppShellViteDevLiveTargetAttestationSecret as profileBindLiveTargetSecret,
  claimCompilerClientModuleViteInstaller as profileClaimCompilerInstaller,
  compilerClientModuleViteEpoch as profileCompilerEpoch,
  dispatchKovoAppShellViteDevRequest as profileDispatchRequest,
  prepareKovoAppShellViteDevGeneration as profilePrepareGeneration,
  runWithGeneratedLiveTargetRegistry as profileRunWithLiveTargetRegistry,
} from './internal/vite-security-profile.js';
import { runWithGeneratedLiveTargetRegistry } from './live-target-registry.js';
import {
  bindKovoAppShellViteDevLiveTargetAttestationSecret,
  dispatchKovoAppShellViteDevRequest,
  prepareKovoAppShellViteDevGeneration,
} from './vite-dev.js';

const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));

describe('server security bootstrap census', () => {
  it('eagerly imports every server intrinsic membrane', () => {
    const source = readFileSync(new URL('./security-bootstrap.ts', import.meta.url), 'utf8');
    const intrinsicModules = readdirSync(sourceDirectory)
      .filter((fileName) => fileName.endsWith('-intrinsics.ts'))
      // Build-only controls are captured by the build/static-export entries; command controls are
      // captured by the named command profile before its public API. Keeping both out of the
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

  it('captures the data-plane intrinsic membrane without enrolling its AST analyzer', () => {
    const source = readFileSync(new URL('./security-bootstrap.ts', import.meta.url), 'utf8');
    const dataPlaneImport = source.indexOf(
      "from './internal/data-plane-static-analysis-intrinsics.js';",
    );
    const dataPlaneAssertion = source.indexOf('assertDataPlaneStaticAnalysisIntrinsics();');

    expect(dataPlaneImport).toBeGreaterThan(0);
    expect(dataPlaneAssertion).toBeGreaterThan(dataPlaneImport);
    expect(source).not.toContain("from './internal/data-plane-static-analysis.js'");
  });

  it('is the first dependency of every supported server entry', () => {
    const entries = [
      ['build.ts', "import './security-bootstrap.js';"],
      ['index.ts', "import './security-bootstrap.js';"],
      ['jsx-runtime.ts', "import './security-bootstrap.js';"],
      ['public-command.ts', "import './security-bootstrap-command.js';"],
      ['testing.ts', "import './security-bootstrap.js';"],
      ['internal/app-shell-vite.ts', "import '../security-bootstrap.js';"],
      ['internal/build.ts', "import '../security-bootstrap.js';"],
      ['internal/generated-handler-runtime.ts', "import '../security-bootstrap.js';"],
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
    const buildIntrinsics = source.indexOf("from './build-security-intrinsics.ts';");
    const responseIntrinsics = source.indexOf("from './response-security-intrinsics.ts';");
    const firstAuthoredIntegrationImport = source.indexOf(
      "from './internal/data-plane-static-analysis.ts';",
    );

    expect(compilerBootstrap).toBeGreaterThanOrEqual(0);
    expect(dataPlaneBootstrap).toBeGreaterThan(compilerBootstrap);
    expect(buildIntrinsics).toBeGreaterThan(dataPlaneBootstrap);
    expect(responseIntrinsics).toBeGreaterThan(buildIntrinsics);
    expect(firstAuthoredIntegrationImport).toBeGreaterThan(dataPlaneBootstrap);
  });

  it('preloads the complete server profile before the authored Vite app graph', () => {
    const source = readFileSync(new URL('./vite-dev.ts', import.meta.url), 'utf8');
    const rootLoad = source.indexOf('await server.ssrLoadModule(kovoServerRootModuleId);');
    const appLoad = source.indexOf('server.ssrLoadModule(moduleId)', rootLoad);

    expect(rootLoad).toBeGreaterThan(0);
    expect(appLoad).toBeGreaterThan(rootLoad);
  });

  it('keeps fresh dev generations off the production app-shell build barrel', () => {
    const profileSource = readFileSync(
      new URL('./internal/vite-security-profile.ts', import.meta.url),
      'utf8',
    );
    const runner = readFileSync(new URL('../../cli/src/commands/dev.ts', import.meta.url), 'utf8');
    const preloadStart = runner.indexOf('async function preloadDevSecurityProfile(');
    const preloadEnd = runner.indexOf('\nfunction viteSsrModuleId(', preloadStart);
    const preload = runner.slice(preloadStart, preloadEnd);

    expect(profileSource).toContain('bindKovoAppShellViteDevLiveTargetAttestationSecret');
    expect(profileSource).toContain('dispatchKovoAppShellViteDevRequest');
    expect(profileSource).toContain('prepareKovoAppShellViteDevGeneration');
    expect(profileSource).toContain('runWithGeneratedLiveTargetRegistry');
    expect(preload).toContain('const appShellModuleId = securityProfileModuleId;');
    expect(preload).not.toContain(
      "requireFromApp.resolve('@kovojs/server/internal/app-shell-vite')",
    );

    // SPEC §6.2.1/§9.5.1: the narrowed module is loaded before app evaluation and must retain
    // every graph-local control required to prepare, authenticate, and dispatch one closed graph.
    expect(profileBindLiveTargetSecret).toBe(bindKovoAppShellViteDevLiveTargetAttestationSecret);
    expect(profileDispatchRequest).toBe(dispatchKovoAppShellViteDevRequest);
    expect(profilePrepareGeneration).toBe(prepareKovoAppShellViteDevGeneration);
    expect(profileRunWithLiveTargetRegistry).toBe(runWithGeneratedLiveTargetRegistry);
    expect(profileClaimCompilerInstaller).toBe(claimCompilerClientModuleViteInstaller);
    expect(profileCompilerEpoch).toBe(compilerClientModuleViteEpoch);
  });

  it('keeps build/check SSR preload ordered and omits the post-proof AST analyzer', () => {
    const source = readFileSync(
      new URL('../../cli/src/commands/build-export.ts', import.meta.url),
      'utf8',
    );
    const preloadStart = source.indexOf('async function preloadKovoSsrSecurityProfile(');
    const preloadEnd = source.indexOf('\nfunction viteSsrModuleId(', preloadStart);
    const preload = source.slice(preloadStart, preloadEnd);
    const parserBootstrap = preload.indexOf(
      "'@kovojs/server/internal/sql-parser-authority-bootstrap'",
    );
    const compilerBootstrap = preload.indexOf("'@kovojs/compiler/internal/security-bootstrap'");
    const compilerRoot = preload.indexOf("requireFromServer.resolve('@kovojs/compiler')");
    const serverRoot = preload.lastIndexOf('viteSsrModuleId(serverRootPath, root)');

    expect(preloadStart).toBeGreaterThan(0);
    expect(preloadEnd).toBeGreaterThan(preloadStart);
    expect(parserBootstrap).toBeGreaterThan(0);
    expect(compilerBootstrap).toBeGreaterThan(parserBootstrap);
    expect(compilerRoot).toBeGreaterThan(compilerBootstrap);
    expect(serverRoot).toBeGreaterThan(compilerRoot);
    expect(preload).not.toContain("'@kovojs/server/internal/data-plane-static-analysis'");
  });
});
