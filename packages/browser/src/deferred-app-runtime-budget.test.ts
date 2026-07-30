import { describe, expect, it } from 'vitest';

import {
  assertBrowserDeferredAppRuntimePolicy,
  browserDeferredAppRuntimeForbiddenFragments,
  browserDeferredAppRuntimeGzipByteBudget,
  browserDeferredAppRuntimeRawByteBudget,
} from '../../../scripts/browser-deferred-app-runtime-policy.mjs';
import { kovoDeferredAppRuntimeModuleSource } from './deferred-app-runtime-module.js';

describe('generated browser deferred app runtime policy', () => {
  it('keeps the executable runtime below numeric raw/gzip budgets and build-only symbols out', () => {
    const measured = assertBrowserDeferredAppRuntimePolicy(kovoDeferredAppRuntimeModuleSource);

    expect(measured.rawBytes).toBeLessThanOrEqual(browserDeferredAppRuntimeRawByteBudget);
    expect(measured.gzipBytes).toBeLessThanOrEqual(browserDeferredAppRuntimeGzipByteBudget);
    for (const fragment of browserDeferredAppRuntimeForbiddenFragments) {
      expect(kovoDeferredAppRuntimeModuleSource).not.toContain(fragment);
    }
  });

  it('rejects a raw-size regression and each build/source-only symbol', () => {
    expect(() =>
      assertBrowserDeferredAppRuntimePolicy(
        `export default ${JSON.stringify('x'.repeat(browserDeferredAppRuntimeRawByteBudget))};`,
      ),
    ).toThrow('exceeds its raw budget');

    for (const fragment of browserDeferredAppRuntimeForbiddenFragments) {
      expect(() =>
        assertBrowserDeferredAppRuntimePolicy(`export const leaked = ${JSON.stringify(fragment)};`),
      ).toThrow(`retained build/source-only fragment ${JSON.stringify(fragment)}`);
    }
  });
});
