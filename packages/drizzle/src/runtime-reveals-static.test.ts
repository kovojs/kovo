import { describe, expect, it } from 'vitest';

import {
  collectRuntimeRevealFactsFromProject,
  collectStaticBuildTrustFactsFromProject,
} from './trust-escapes-static.js';

describe('runtime trustedReveal fact collector (SPEC §6.6, audit-only)', () => {
  it('records the exact reveal-once config credential pattern', () => {
    expect(
      collectRuntimeRevealFactsFromProject({
        files: [
          {
            fileName: 'payment.ts',
            source: [
              `import { trustedReveal, type SecretValue } from '@kovojs/core';`,
              `export function createPaymentClient(key: SecretValue<string>) {`,
              `  const raw = trustedReveal(key, {`,
              `    justification: 'initialize payment SDK once at boot',`,
              `    method: 'arbitrary-fn',`,
              `    source: 'app.env.PAYMENT_API_KEY',`,
              `  });`,
              `  return new PaymentClient(raw);`,
              `}`,
            ].join('\n'),
          },
        ],
      }),
    ).toEqual([
      {
        grade: 'audit',
        justification: 'initialize payment SDK once at boot',
        method: 'arbitrary-fn',
        path: 'app.env.PAYMENT_API_KEY',
        query: 'runtime',
        selectedSecret: true,
        site: 'payment.ts:3',
        source: 'app.env.PAYMENT_API_KEY',
      },
    ]);
  });

  it('does not treat local lookalikes or dynamic options as reveal evidence', () => {
    expect(
      collectRuntimeRevealFactsFromProject({
        files: [
          {
            fileName: 'lookalikes.ts',
            source: [
              `function trustedReveal(value: unknown) { return value; }`,
              `trustedReveal(secretValue, { justification: 'local lookalike' });`,
              `import { trustedReveal as reveal } from '@kovojs/core';`,
              `reveal(secretValue, options);`,
            ].join('\n'),
          },
        ],
      }),
    ).toEqual([]);
  });

  it('retains the same fact in the one-project production-build aggregate', () => {
    const files = [
      {
        fileName: 'payment.ts',
        source: [
          `import { trustedReveal } from '@kovojs/core';`,
          `trustedReveal(app.env.PAYMENT_API_KEY, {`,
          `  justification: 'initialize payment SDK once at boot',`,
          `  method: 'arbitrary-fn',`,
          `  source: 'app.env.PAYMENT_API_KEY',`,
          `});`,
        ].join('\n'),
      },
    ];

    expect(collectStaticBuildTrustFactsFromProject({ files }).revealed).toEqual(
      collectRuntimeRevealFactsFromProject({ files }),
    );
  });
});
