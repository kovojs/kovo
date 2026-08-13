import { createHash } from 'node:crypto';

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
  it('measures exact current splitter output and rejects the small-fixture wire regression', async () => {
    const fixture = await loadRouteCssFixture();
    const result = measureRouteCssCounterfactual(fixture, compiler);

    expect(result.correctness).toEqual({ complete: true, errors: [] });
    expect(result.routes.map((route) => route.id)).toEqual(['listing', 'detail']);
    expect(result.routes.every((route) => route.savings.identityPercent > 10)).toBe(true);
    expect(result.routes.every((route) => route.accounting.linkedHrefs.length === 2)).toBe(true);
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
    forgedFixture.fixture.assetDigests['scripts/fixtures/perf-route-css/shared.css'] =
      `sha256:${'e'.repeat(64)}`;
    expect(validateRouteCssReport(forgedFixture)).toContain('fixture digest is invalid');

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
});
