import { describe, expect, it, vi } from 'vitest';

import { expectInlineResponseApplyParity } from './inline-loader-response-apply-fixture.js';
import { inlineSourceInstallCases } from './inline-loader-test-utils.js';

describe('inline loader response apply source', () => {
  it.each(inlineSourceInstallCases)(
    'keeps inline response application in parity with the modular DOM apply path through %s',
    async (_name, installSource) => {
      await expectInlineResponseApplyParity(installSource, { expect, vi });
    },
  );
});
