import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { emitQueryPlanBootstrapModule } from './bootstrap.js';

/**
 * B2 (SPEC.md §5.2 / §4.8). The client bootstrap emits one query-update-plan import per
 * compiled component. Two components that infer the SAME name (`scan/parse.ts`
 * inferComponentName has no path/hash uniqueness) produce the SAME `exportName`
 * (`${componentName}$queryUpdatePlans`). Before this fix the bootstrap emitted two
 * `import { Demo$queryUpdatePlans } from 'a' | 'b'` lines = a duplicate lexical binding =
 * a hard ES module SyntaxError that kills the ENTIRE client bootstrap (every island,
 * handler, and query dies). Even with distinct names, two components binding the same query
 * key shallow-spread-clobbered each other's plan, silently dropping update coverage.
 *
 * These tests assert the emitted module (1) parses with no duplicate binding and (2) keeps
 * every contributing component's plan for a shared query name.
 */

interface InstalledLoader {
  enhancedMutations: { queryPlans: Record<string, KovoApplier> };
}

type KovoApplier = (root: unknown, value: unknown, context?: unknown) => unknown;

/**
 * Execute the emitted bootstrap module in a fresh VM context. The ESM imports are rewritten
 * to local `const` declarations (mirroring the runtime's own module wiring) so that a DUPLICATE
 * LEXICAL BINDING — the exact B2 defect — surfaces as a real SyntaxError at parse time here,
 * and the constructed `queryPlans` map is captured for behavioral assertions.
 */
function runBootstrap(
  source: string,
  planModules: Record<string, Record<string, unknown>>,
): InstalledLoader {
  const calls: InstalledLoader[] = [];
  // Rewrite both single- and multi-specifier, aliased imports into destructuring consts.
  const rewritten = source
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]@kovojs\/browser\/generated['"];?/g,
      (_match, names: string) => `const { ${names.trim()} } = runtime;`,
    )
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g,
      (_match, names: string, importPath: string) => {
        // Convert `A as B, C as D` import specifiers into a `{ A: B, C: D }` destructure.
        const destructure = names
          .split(',')
          .map((spec) => spec.trim())
          .filter(Boolean)
          .map((spec) => {
            const aliasMatch = /^(.+?)\s+as\s+(.+)$/.exec(spec);
            return aliasMatch ? `${aliasMatch[1]}: ${aliasMatch[2]}` : spec;
          })
          .join(', ');
        return `const { ${destructure} } = planModules[${JSON.stringify(importPath)}];`;
      },
    )
    .replace(/export\s+function\s+([A-Za-z_$][\w$]*)/g, 'exports.$1 = function $1');

  const runtime = {
    applyDeferredStreamResponseToRuntime: () => ({}),
    createQueryStore: () => ({ kind: 'store' }),
    installKovoLoader: (options: InstalledLoader) => {
      calls.push(options);
      return { islandSignalScope: {} };
    },
  };

  runInNewContext(rewritten, {
    document: {},
    exports: {},
    fetch: () => {},
    planModules,
    runtime,
  });

  const installed = calls[0];
  if (!installed) throw new Error('bootstrap did not install the loader');
  return installed;
}

describe('emitQueryPlanBootstrapModule — same-name export collision (B2, SPEC §5.2/§4.8)', () => {
  it('aliases collided exports so the emitted module has no duplicate import binding', () => {
    const bootstrap = emitQueryPlanBootstrapModule([
      { exportName: 'Demo$queryUpdatePlans', importPath: '../components/a/demo.client.js' },
      { exportName: 'Demo$queryUpdatePlans', importPath: '../components/b/demo.client.js' },
    ]);

    // Two same-named imports must resolve to DISTINCT local aliases (otherwise a duplicate
    // lexical binding). Collect every aliased local from the emitted import lines.
    const aliasLines = [
      ...bootstrap.source.matchAll(
        /import\s*\{\s*Demo\$queryUpdatePlans\s+as\s+([A-Za-z_$][\w$]*)\s*\}/g,
      ),
    ].map((match) => match[1]);
    expect(aliasLines).toHaveLength(2);
    expect(new Set(aliasLines).size).toBe(2); // distinct locals -> no collision
    expect(aliasLines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^kovoQueryPlans_0_[0-9a-f]{16}$/),
        expect.stringMatching(/^kovoQueryPlans_1_[0-9a-f]{16}$/),
      ]),
    );

    // Parses + runs with no duplicate-binding SyntaxError, and BOTH components' plans reach the
    // merged queryPlans map. Each component owns a different query name here.
    const demoA = { todos: (() => 'A-todos') as KovoApplier };
    const demoB = { cart: (() => 'B-cart') as KovoApplier };
    const installed = runBootstrap(bootstrap.source, {
      '../components/a/demo.client.js': { Demo$queryUpdatePlans: demoA },
      '../components/b/demo.client.js': { Demo$queryUpdatePlans: demoB },
    });

    const plans = installed.enhancedMutations.queryPlans;
    expect(typeof plans.todos).toBe('function');
    expect(typeof plans.cart).toBe('function');
    expect(plans.todos!({}, {})).toBe('A-todos');
    expect(plans.cart!({}, {})).toBe('B-cart');
  });

  it('merges same-query-key plans so both components’ appliers run (no clobber, §4.8)', () => {
    const bootstrap = emitQueryPlanBootstrapModule([
      {
        exportName: 'CartBadge$queryUpdatePlans',
        importPath: '../components/cart-badge.client.js',
      },
      {
        exportName: 'CartPanel$queryUpdatePlans',
        importPath: '../components/cart-panel.client.js',
      },
    ]);

    const ran: string[] = [];
    const badge = {
      cart: ((root: unknown, value: unknown) => {
        ran.push(`badge:${String((value as { count: number }).count)}`);
      }) as KovoApplier,
    };
    const panel = {
      cart: ((root: unknown, value: unknown) => {
        ran.push(`panel:${String((value as { count: number }).count)}`);
      }) as KovoApplier,
    };

    const installed = runBootstrap(bootstrap.source, {
      '../components/cart-badge.client.js': { CartBadge$queryUpdatePlans: badge },
      '../components/cart-panel.client.js': { CartPanel$queryUpdatePlans: panel },
    });

    const plans = installed.enhancedMutations.queryPlans;
    expect(typeof plans.cart).toBe('function');

    plans.cart!({}, { count: 7 });
    // Both contributing appliers ran for the shared 'cart' query key (no shallow-spread clobber).
    expect(ran).toEqual(['badge:7', 'panel:7']);
  });

  it('emits no imports and an empty merged map for zero inputs', () => {
    const bootstrap = emitQueryPlanBootstrapModule([]);
    const installed = runBootstrap(bootstrap.source, {});
    expect(installed.enhancedMutations.queryPlans).toEqual({});
  });
});
