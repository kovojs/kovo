import * as runtime from '@kovojs/runtime/generated';
import { describe, expect, it } from 'vitest';

import { emitQueryPlanBootstrapModule } from './bootstrap.js';

/**
 * Contract guard (api-cleanup Phase 1; SPEC §9.1/§4.4). The client bootstrap the
 * compiler emits imports named *values* from `@kovojs/runtime/generated`. This test resolves
 * those emitted imports against the REAL published runtime barrel, so a name drift
 * — e.g. the historical `applyDeferredStreamResponseToDom` vs the actual
 * `applyDeferredStreamResponseToRuntime` — fails CI here instead of slipping
 * through on a self-stubbed fixture (the failure mode that masked it before).
 */
describe('emitted bootstrap ↔ @kovojs/runtime/generated import contract', () => {
  it('imports only value names the published @kovojs/runtime/generated barrel exports', () => {
    const bootstrap = emitQueryPlanBootstrapModule([
      { exportName: 'Demo$queryUpdatePlans', importPath: '../components/demo.client.js' },
    ]);

    const match = /import\s*\{([^}]*)\}\s*from\s*['"]@kovojs\/runtime\/generated['"]/.exec(
      bootstrap.source,
    );
    if (match === null) {
      throw new Error('emitted bootstrap must import from @kovojs/runtime/generated');
    }

    const imported = (match[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    expect(imported.length).toBeGreaterThan(0);

    const missing = imported.filter((name) => !Object.hasOwn(runtime, name));
    expect(
      missing,
      `emitted bootstrap imports names absent from @kovojs/runtime/generated: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
