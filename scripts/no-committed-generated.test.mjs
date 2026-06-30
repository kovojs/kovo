import { describe, expect, it } from 'vitest';

import { inScopeGeneratedPatterns, trackedGeneratedViolations } from './no-committed-generated.mjs';

describe('no-committed-generated gate', () => {
  it('uses the manifest-backed must-not-commit generated artifact category', () => {
    expect(inScopeGeneratedPatterns).toEqual([
      'examples/*/src/generated/**',
      'site/src/generated/**',
      'site/tutorial/steps/*/src/generated/**',
      'packages/create-kovo/templates/graph.json',
    ]);

    expect(
      trackedGeneratedViolations([
        'examples/commerce/src/generated/graph.json',
        'site/src/generated/kovo-ui.css',
        'site/tutorial/steps/02-islands/src/generated/product-actions.tsx',
        'packages/create-kovo/templates/graph.json',
        '.deepsec/examples/commerce/src/generated/graph.json',
        'packages/compiler/src/generated/primitive-reactive-attrs.ts',
        'examples/devtool/__screenshots__/generated.png',
      ]),
    ).toEqual([
      'examples/commerce/src/generated/graph.json',
      'site/src/generated/kovo-ui.css',
      'site/tutorial/steps/02-islands/src/generated/product-actions.tsx',
      'packages/create-kovo/templates/graph.json',
    ]);
  });
});
