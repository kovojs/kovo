import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  assertTestPackageBudgets,
  testPackageBudgets,
  validateTestPackageManifest,
} from './check-test-package-budget.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../packages/test/package.json', import.meta.url), 'utf8'),
);

describe('@kovojs/test package budgets', () => {
  it('keeps optional engines out of the ordinary dependency closure', () => {
    expect(() => validateTestPackageManifest(manifest)).not.toThrow();
    expect(() =>
      validateTestPackageManifest({
        ...manifest,
        dependencies: {
          ...manifest.dependencies,
          '@playwright/test': manifest.peerDependencies['@playwright/test'],
        },
      }),
    ).toThrow(/must be exactly|must not require/u);
  });

  it('fails closed above any ratified byte or package-count limit', () => {
    expect(() => assertTestPackageBudgets(testPackageBudgets)).not.toThrow();
    expect(() =>
      assertTestPackageBudgets({
        ...testPackageBudgets,
        packageStoreEntries: testPackageBudgets.packageStoreEntries + 1,
      }),
    ).toThrow(/exceeds ratified budget/u);
  });
});
