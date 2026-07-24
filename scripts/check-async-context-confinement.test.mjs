import { describe, expect, it } from 'vitest';

import {
  loadAsyncContextConfinementInput,
  validateAsyncContextConfinement,
} from './check-async-context-confinement.mjs';

describe('async-context confinement census gate', () => {
  it('accepts the exact runtime census and shared contract', () => {
    const input = loadAsyncContextConfinementInput();
    const result = validateAsyncContextConfinement(input);
    expect(result).toMatchObject({
      ok: true,
      summary: { cells: 11, reviewedNonRuntimeCarriers: 1, runtimeAuthorityCells: 10 },
    });
  });

  it('rejects raw or uncensused AsyncLocalStorage doors', () => {
    const raw = loadAsyncContextConfinementInput();
    raw.files.set(
      'packages/server/src/rogue-async-context.ts',
      "import { AsyncLocalStorage as Hidden } from 'node:async_hooks';\nexport const rogue = new Hidden();\n",
    );
    expect(validateAsyncContextConfinement(raw).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('raw node:async_hooks access'),
        expect.stringContaining('raw AsyncLocalStorage construction'),
      ]),
    );

    const bareAlias = loadAsyncContextConfinementInput();
    bareAlias.files.set(
      'packages/server/src/rogue-bare-async-context.ts',
      "import { AsyncLocalStorage as Hidden } from 'async_hooks';\nexport const rogue = new Hidden();\n",
    );
    expect(validateAsyncContextConfinement(bareAlias).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('raw node:async_hooks access'),
        expect.stringContaining('raw AsyncLocalStorage construction'),
      ]),
    );

    const uncensused = loadAsyncContextConfinementInput();
    uncensused.files.set(
      'packages/server/src/rogue-cell.ts',
      [
        "import { createFrameworkAsyncContextCell, currentFrameworkAsyncContextValue, runWithFrameworkAsyncContext } from './async-context.js';",
        "const rogueCell = createFrameworkAsyncContextCell('server.rogue');",
        'export function readRogue() { return currentFrameworkAsyncContextValue(rogueCell); }',
        "export function runRogue(fn) { return runWithFrameworkAsyncContext(rogueCell, 'x', fn); }",
      ].join('\n'),
    );
    expect(validateAsyncContextConfinement(uncensused).findings).toContain(
      'packages/server/src/rogue-cell.ts#rogueCell: uncensused async-context cell server.rogue',
    );
  });

  it('rejects census deletion, contract aliases, and cell escape', () => {
    const deleted = loadAsyncContextConfinementInput();
    deleted.document = structuredClone(deleted.document);
    deleted.document.cells = deleted.document.cells.filter(
      (row) => row.id !== 'server.jsx-request',
    );
    expect(validateAsyncContextConfinement(deleted).findings).toContain(
      'packages/server/src/jsx-context.ts#jsxRequestContext: uncensused async-context cell server.jsx-request',
    );

    const aliased = loadAsyncContextConfinementInput();
    aliased.files.set(
      'packages/server/src/aliased-cell.ts',
      "import { createFrameworkAsyncContextCell as createHidden } from './async-context.js';\nvoid createHidden;\n",
    );
    expect(validateAsyncContextConfinement(aliased).findings).toContain(
      'packages/server/src/aliased-cell.ts: async-context contract alias createHidden -> createFrameworkAsyncContextCell is forbidden',
    );

    const escaped = loadAsyncContextConfinementInput();
    const jsx = escaped.files.get('packages/server/src/jsx-context.ts');
    escaped.files.set(
      'packages/server/src/jsx-context.ts',
      `${jsx}\nexport const leakedAsyncCell = jsxRequestContext;\n`,
    );
    expect(validateAsyncContextConfinement(escaped).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('jsxRequestContext escapes')]),
    );
  });

  it('rejects lifecycle weakening and a request root that inherits ambient authority', () => {
    const weakened = loadAsyncContextConfinementInput();
    const contract = weakened.files.get('packages/server/src/async-context.ts');
    weakened.files.set(
      'packages/server/src/async-context.ts',
      contract.replace('lifecycle !== store.lifecycle ||', 'false ||'),
    );
    expect(validateAsyncContextConfinement(weakened).findings).toContain(
      'packages/server/src/async-context.ts: missing exact lifecycle comparison',
    );

    const inherited = loadAsyncContextConfinementInput();
    const response = inherited.files.get('packages/server/src/response-lifecycle-context.ts');
    inherited.files.set(
      'packages/server/src/response-lifecycle-context.ts',
      response.replace('return runInFreshFrameworkAsyncContext(callback);', 'return callback();'),
    );
    expect(validateAsyncContextConfinement(inherited).findings).toContain(
      'packages/server/src/response-lifecycle-context.ts#runWithoutResponseLifecycleContext: request root does not establish a fresh lifecycle',
    );

    const sharedReentry = loadAsyncContextConfinementInput();
    const jsx = sharedReentry.files.get('packages/server/src/jsx-context.ts');
    sharedReentry.files.set(
      'packages/server/src/jsx-context.ts',
      jsx.replace(
        'runWithRevocableIsolatedFrameworkAsyncContext(jsxRequestContext, context, callback)',
        'runWithFrameworkAsyncContext(jsxRequestContext, context, callback)',
      ),
    );
    expect(validateAsyncContextConfinement(sharedReentry).findings).toContain(
      'packages/server/src/jsx-context.ts: owned JSX re-entry lost isolated exact-cell binding',
    );

    const hoistedReentry = loadAsyncContextConfinementInput();
    const deferred = hoistedReentry.files.get('packages/server/src/deferred-region.ts');
    hoistedReentry.files.set(
      'packages/server/src/deferred-region.ts',
      deferred
        .replace(
          '  const renderNow = () => rendered(renderRegion());',
          '  const startDeferredRegion = bindCurrentJsxRequestContext(renderRegion);\n  const renderNow = () => rendered(renderRegion());',
        )
        .replace(
          '  const startDeferredRegion = bindCurrentJsxRequestContext(renderRegion);\n  const startErrorChunk =',
          '  const startErrorChunk =',
        ),
    );
    expect(validateAsyncContextConfinement(hoistedReentry).findings).toContain(
      'packages/server/src/deferred-region.ts: owned JSX re-entry must remain below critical and no-collector exits',
    );

    const duplicateReentry = loadAsyncContextConfinementInput();
    const duplicateJsx = duplicateReentry.files.get('packages/server/src/jsx-context.ts');
    duplicateReentry.files.set(
      'packages/server/src/jsx-context.ts',
      `${duplicateJsx}\nfunction rogueJsxReentry(callback: () => void): void {\n  void runWithRevocableIsolatedFrameworkAsyncContext(jsxRequestContext, createJsxFrameworkContext({}, {}), callback);\n}\nvoid rogueJsxReentry;\n`,
    );
    expect(validateAsyncContextConfinement(duplicateReentry).findings).toContain(
      'server.jsx-request:packages/server/src/jsx-context.ts#rogueJsxReentry: uncensused isolated re-entry for shared async-context cell',
    );

    const extraConsumer = loadAsyncContextConfinementInput();
    extraConsumer.files.set(
      'packages/server/src/rogue-deferred-reentry.ts',
      "import { bindCurrentJsxRequestContext } from './jsx-context.js';\nvoid bindCurrentJsxRequestContext;\n",
    );
    expect(validateAsyncContextConfinement(extraConsumer).findings).toContain(
      'packages/server/src/rogue-deferred-reentry.ts: unauthorized owned JSX re-entry consumer',
    );

    const secondLocalConsumer = loadAsyncContextConfinementInput();
    const secondDeferred = secondLocalConsumer.files.get('packages/server/src/deferred-region.ts');
    secondLocalConsumer.files.set(
      'packages/server/src/deferred-region.ts',
      `${secondDeferred}\nfunction secondDeferredBridge(callback: () => void) {\n  return bindCurrentJsxRequestContext(callback);\n}\nvoid secondDeferredBridge;\n`,
    );
    expect(validateAsyncContextConfinement(secondLocalConsumer).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'expected one definition, one consumer import, and two exact registrations',
        ),
        expect.stringContaining('must be the two direct lowerDeferredRegion const bindings'),
      ]),
    );

    const freshSharedBridge = loadAsyncContextConfinementInput();
    const freshJsx = freshSharedBridge.files.get('packages/server/src/jsx-context.ts');
    freshSharedBridge.files.set(
      'packages/server/src/jsx-context.ts',
      `${freshJsx}\nfunction freshSharedJsxBridge(context: JsxFrameworkContext, callback: () => void) {\n  return runInFreshFrameworkAsyncContext(() => runWithFrameworkAsyncContext(jsxRequestContext, context, callback));\n}\nvoid freshSharedJsxBridge;\n`,
    );
    expect(validateAsyncContextConfinement(freshSharedBridge).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expected one definition, one root import, and one exact call'),
      ]),
    );

    const loopedReentry = loadAsyncContextConfinementInput();
    const loopedJsx = loopedReentry.files.get('packages/server/src/jsx-context.ts');
    loopedReentry.files.set(
      'packages/server/src/jsx-context.ts',
      loopedJsx.replace(
        'return runWithRevocableIsolatedFrameworkAsyncContext(jsxRequestContext, context, callback);',
        'let task;\n    for (let index = 0; index < 2; index += 1) {\n      task = runWithRevocableIsolatedFrameworkAsyncContext(jsxRequestContext, context, callback);\n    }\n    return task;',
      ),
    );
    expect(validateAsyncContextConfinement(loopedReentry).findings).toContain(
      'server.jsx-request:packages/server/src/jsx-context.ts#bindCurrentJsxRequestContext: isolated re-entry cannot execute from an iteration statement',
    );

    const reusableReentry = loadAsyncContextConfinementInput();
    const reusableJsx = reusableReentry.files.get('packages/server/src/jsx-context.ts');
    reusableReentry.files.set(
      'packages/server/src/jsx-context.ts',
      reusableJsx.replace('    started = true;\n', ''),
    );
    expect(validateAsyncContextConfinement(reusableReentry).findings).toContain(
      'packages/server/src/jsx-context.ts: owned JSX re-entry lost isolated exact-cell binding',
    );

    const noWinnerGate = loadAsyncContextConfinementInput();
    const noWinnerDeferred = noWinnerGate.files.get('packages/server/src/deferred-region.ts');
    noWinnerGate.files.set(
      'packages/server/src/deferred-region.ts',
      noWinnerDeferred.replace('      winnerSelected = true;\n', ''),
    );
    expect(validateAsyncContextConfinement(noWinnerGate).findings).toContain(
      'packages/server/src/deferred-region.ts: deferred success, error, and timeout must select one owned JSX re-entry',
    );
  }, 120_000);

  it('rejects verifier revocation and interleaving-oracle drift', () => {
    const verifier = loadAsyncContextConfinementInput();
    const source = verifier.files.get('packages/test/src/verifier-observation.ts');
    verifier.files.set(
      'packages/test/src/verifier-observation.ts',
      source.replace('scope.active = false;', 'void scope;'),
    );
    expect(validateAsyncContextConfinement(verifier).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('scope.active = false;')]),
    );

    const oracle = loadAsyncContextConfinementInput();
    const oracleSource = oracle.files.get('packages/server/src/async-context.test.ts');
    oracle.files.set(
      'packages/server/src/async-context.test.ts',
      oracleSource.replaceAll('ReadableStream', 'RemovedStream'),
    );
    expect(validateAsyncContextConfinement(oracle).findings).toContain(
      'packages/server/src/async-context.test.ts: seeded concurrency oracle lost a required interleaving family',
    );
  });
});
