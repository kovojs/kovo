import { describe, expect, it } from 'vitest';

import { validateLoweringPipelinePassContracts } from './lowering-pipeline.js';

describe('lowering pipeline pass contracts', () => {
  it('accepts the built-in pass order', () => {
    expect(() => validateLoweringPipelinePassContracts()).not.toThrow();
  });

  it('fails before running a pass whose declared input has not been produced', () => {
    const passes: Parameters<typeof validateLoweringPipelinePassContracts>[0] = [
      {
        kind: 'lower',
        name: 'structural-jsx',
        requires: ['style-span-probe'],
        run() {},
      },
    ];

    expect(() => validateLoweringPipelinePassContracts(passes)).toThrow(
      'Lowering pipeline pass "structural-jsx" requires "style-span-probe"',
    );
  });
});
