import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  collectCssAssetManifest,
  cssRouteByteAccounting,
  cssRouteDeliveryGate,
  dedupeCss,
} from '../packages/compiler/src/internal.js';
import {
  bundleCurrentCssSplitter,
  loadRouteCssFixture,
  measureRouteCssCounterfactual,
  ROUTE_CSS_REPORT_SCHEMA,
  runRouteCssCounterfactual,
  validateRouteCssReport,
} from './perf-route-css.mjs';

const compiler = {
  collectCssAssetManifest,
  cssRouteByteAccounting,
  cssRouteDeliveryGate,
  dedupeCss,
};
const compilerIdentity = {
  bundleDigest: `sha256:${'1'.repeat(64)}`,
  entryPoint: 'packages/compiler/src/css.ts',
  inputs: { 'packages/compiler/src/css.ts': `sha256:${'3'.repeat(64)}` },
};
compilerIdentity.inputDigest = `sha256:${createHash('sha256')
  .update(JSON.stringify(compilerIdentity.inputs))
  .digest('hex')}`;
const cleanSource = {
  commit: 'a'.repeat(40),
  dirty: false,
  dirtyPaths: [],
  locks: { 'pnpm-lock.yaml': `sha256:${'4'.repeat(64)}` },
};

describe('route CSS counterfactual', () => {
  it('derives the counterfactual from the exact matched fixture and rejects its wire regression', async () => {
    const fixture = await loadRouteCssFixture();
    const result = measureRouteCssCounterfactual(fixture, compiler);

    expect(fixture.identity).toMatchObject({
      schema: 'kovo-route-css-workload/v2',
      stylesheetPath: 'benchmarks/kovo/src/styles.css',
    });
    expect(Object.keys(fixture.identity.sourceDigests)).toEqual([
      'benchmarks/kovo/src/styles.css',
      'benchmarks/kovo/src/app.tsx',
      'benchmarks/run-all.mjs',
      'benchmarks/shared/matched-fixture.json',
    ]);
    expect(fixture.identity.sourceDigests).toEqual(fixture.identity.expectedSourceDigests);
    expect(fixture.derivation.sourceDigest).toBe(
      fixture.identity.sourceDigests['benchmarks/kovo/src/styles.css'],
    );
    expect(fixture.derivation.sourceReconstructionDigest).toBe(fixture.derivation.sourceDigest);
    expect(fixture.assets.map((asset) => asset.id)).toEqual(['shared', 'listing', 'detail']);
    expect(result.correctness).toEqual({ complete: true, errors: [] });
    expect(result.routes.map((route) => route.id)).toEqual(['listing', 'detail']);
    expect(result.routes.every((route) => route.savings.identityPercent > 10)).toBe(true);
    expect(result.routes.every((route) => route.accounting.linkedHrefs.length === 2)).toBe(true);
    expect(result.routes.every((route) => route.savings.brotliPercent < 0)).toBe(true);
    expect(
      result.sessions.every((session) => session.totalSessionRegression.identityBytes <= 0),
    ).toBe(true);
    expect(result.sessions.every((session) => session.totalSessionRegression.brotliBytes > 0)).toBe(
      true,
    );
    expect(result.decision).toMatchObject({
      implementationClaim: null,
      routeThresholdMet: false,
      status: 'threshold-not-met',
      totalSessionBrotliRegression: true,
    });
  });

  it('binds a measured report to source, fixture, compiler closure, and workload identity', async () => {
    const report = await runRouteCssCounterfactual(
      {},
      {
        collectProvenance: () => structuredClone(cleanSource),
        compiler,
        compilerIdentity,
      },
    );

    expect(report.schema).toBe(ROUTE_CSS_REPORT_SCHEMA);
    expect(report.verdict.status).toBe('measured');
    expect(report.integrity).toMatchObject({
      complete: true,
      publishable: true,
      sourceStable: true,
    });
    expect(report.decision).toMatchObject({
      implementationClaim: null,
      status: 'threshold-not-met',
    });
    expect(validateRouteCssReport(report)).toEqual([]);

    const forged = structuredClone(report);
    forged.decision.implementationClaim = 'implemented and faster';
    expect(validateRouteCssReport(forged)).toContain(
      'implementation claim is not backed by a measured threshold pass',
    );
    forged.decision.implementationClaim = null;
    forged.workload.digest = `sha256:${'f'.repeat(64)}`;
    expect(validateRouteCssReport(forged)).toContain('workload digest is invalid');

    const forgedFixture = structuredClone(report);
    forgedFixture.fixture.sourceDigests['benchmarks/kovo/src/styles.css'] =
      `sha256:${'e'.repeat(64)}`;
    expect(validateRouteCssReport(forgedFixture)).toContain(
      'fixture source digests differ from their authenticated expectations',
    );

    const forgedDerivation = structuredClone(report);
    forgedDerivation.derivation.rules[0].owner = 'listing';
    expect(validateRouteCssReport(forgedDerivation)).toContain(
      'CSS partition derivation digest is invalid',
    );

    const forgedThreshold = structuredClone(report);
    forgedThreshold.decision.routeThresholdMet = true;
    expect(validateRouteCssReport(forgedThreshold)).toContain(
      'route threshold decision does not match measurements',
    );
  });

  it('keeps exploratory dirty measurements unproven and strips implementation claims', async () => {
    const dirtySource = {
      ...cleanSource,
      dirty: true,
      dirtyPaths: [' M packages/compiler/src/css.ts'],
    };
    const report = await runRouteCssCounterfactual(
      { allowDirty: true },
      {
        collectProvenance: () => structuredClone(dirtySource),
        compiler,
        compilerIdentity,
      },
    );

    expect(report.integrity.publishable).toBe(false);
    expect(report.verdict.status).toBe('unproven');
    expect(report.decision.implementationClaim).toBeNull();
  });

  it('authenticates the source closure used to execute the current splitter', async () => {
    const bundled = await bundleCurrentCssSplitter();
    expect(bundled.identity.entryPoint).toBe('packages/compiler/src/css.ts');
    expect(bundled.identity.bundleDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(bundled.identity.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(bundled.identity.inputs).toHaveProperty('packages/compiler/src/css.ts');
    expect(typeof bundled.compiler.collectCssAssetManifest).toBe('function');
  });

  it('fails closed when the pinned real stylesheet drifts', async () => {
    const sourceFile = 'benchmarks/kovo/src/styles.css';
    await expect(
      loadRouteCssFixture(undefined, {
        async readFile(file, encoding) {
          const text = await readFile(file, encoding);
          return String(file).endsWith(sourceFile) ? `${text}\n.drift { color: red; }\n` : text;
        },
      }),
    ).rejects.toThrow(`source digest mismatch for ${sourceFile}`);
  });

  it('fails closed on semantic route drift even when a forged digest matches it', async () => {
    const appFile = 'benchmarks/kovo/src/app.tsx';
    const manifestFile = 'scripts/fixtures/perf-route-css/workload.json';
    const realApp = await readFile(
      new URL('../benchmarks/kovo/src/app.tsx', import.meta.url),
      'utf8',
    );
    const forgedApp = realApp.replace(
      "const matchedL0HomeRoute = app.route('/matched/l0', {",
      "const renamedL0HomeRoute = app.route('/matched/renamed', {",
    );

    await expect(
      loadRouteCssFixture(undefined, {
        async readFile(file, encoding) {
          const text = await readFile(file, encoding);
          if (String(file).endsWith(appFile)) return forgedApp;
          if (!String(file).endsWith(manifestFile)) return text;
          const manifest = JSON.parse(text);
          manifest.sources.find((source) => source.id === 'routes').expectedDigest =
            sha256(forgedApp);
          return JSON.stringify(manifest);
        },
      }),
    ).rejects.toThrow('expected 1 occurrence(s)');
  });

  it('fails closed when new stylesheet selectors lack an authenticated partition owner', async () => {
    const stylesheetFile = 'benchmarks/kovo/src/styles.css';
    const manifestFile = 'scripts/fixtures/perf-route-css/workload.json';
    const realCss = await readFile(
      new URL('../benchmarks/kovo/src/styles.css', import.meta.url),
      'utf8',
    );
    const forgedCss = `${realCss}\n.unowned-route-rule { color: red; }\n`;

    await expect(
      loadRouteCssFixture(undefined, {
        async readFile(file, encoding) {
          const text = await readFile(file, encoding);
          if (String(file).endsWith(stylesheetFile)) return forgedCss;
          if (!String(file).endsWith(manifestFile)) return text;
          const manifest = JSON.parse(text);
          manifest.sources.find((source) => source.id === 'stylesheet').expectedDigest =
            sha256(forgedCss);
          return JSON.stringify(manifest);
        },
      }),
    ).rejects.toThrow('stylesheet class unowned-route-rule has no declared partition owner');
  });

  it('fails closed when a bound route component drifts from the stylesheet', async () => {
    const appFile = 'benchmarks/kovo/src/app.tsx';
    const manifestFile = 'scripts/fixtures/perf-route-css/workload.json';
    const realApp = await readFile(
      new URL('../benchmarks/kovo/src/app.tsx', import.meta.url),
      'utf8',
    );
    const forgedApp = realApp.replace(
      'function MatchedL0ListingPage(): string {\n  return (\n    <main data-benchmark-destination="listing">\n      <section class="hero">',
      'function MatchedL0ListingPage(): string {\n  return (\n    <main data-benchmark-destination="listing">\n      <section class="hero-drift">',
    );
    expect(forgedApp).not.toBe(realApp);

    await expect(
      loadRouteCssFixture(undefined, {
        async readFile(file, encoding) {
          const text = await readFile(file, encoding);
          if (String(file).endsWith(appFile)) return forgedApp;
          if (!String(file).endsWith(manifestFile)) return text;
          const manifest = JSON.parse(text);
          manifest.sources.find((source) => source.id === 'routes').expectedDigest =
            sha256(forgedApp);
          return JSON.stringify(manifest);
        },
      }),
    ).rejects.toThrow(
      'stylesheet class hero is declared listing but the bound route source derives shared',
    );
  });
});

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
