import * as runtime from '@kovojs/runtime';
import { describe, expect, it } from 'vitest';

import { emitQueryPlanBootstrapModule } from './bootstrap.js';

/**
 * Contract guard (api-cleanup Phase 1; SPEC §9.1/§4.4). The client bootstrap the
 * compiler emits imports named *values* from `@kovojs/runtime`. This test resolves
 * those emitted imports against the REAL published runtime barrel, so a name drift
 * — e.g. the historical `applyDeferredStreamResponseToDom` vs the actual
 * `applyDeferredStreamResponseToRuntime` — fails CI here instead of slipping
 * through on a self-stubbed fixture (the failure mode that masked it before).
 */
describe('emitted bootstrap ↔ @kovojs/runtime import contract', () => {
  it('imports only value names the published @kovojs/runtime barrel exports', () => {
    const bootstrap = emitQueryPlanBootstrapModule([
      { exportName: 'Demo$queryUpdatePlans', importPath: '../components/demo.client.js' },
    ]);

    const match = /import\s*\{([^}]*)\}\s*from\s*['"]@kovojs\/runtime['"]/.exec(bootstrap.source);
    if (match === null) {
      throw new Error('emitted bootstrap must import from @kovojs/runtime');
    }

    const imported = (match[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    expect(imported.length).toBeGreaterThan(0);

    const missing = imported.filter((name) => !Object.hasOwn(runtime, name));
    expect(
      missing,
      `emitted bootstrap imports names absent from @kovojs/runtime: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
