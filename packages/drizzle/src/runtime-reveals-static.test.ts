import { describe, expect, it } from 'vitest';

import {
  collectRuntimeRevealAuditFromProject,
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
    ).toMatchObject([
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

  it('records a direct import alias regardless of literal option-property order', () => {
    expect(
      collectRuntimeRevealFactsFromProject({
        files: [
          {
            fileName: 'alias.ts',
            source: [
              `import { trustedReveal as reveal } from '@kovojs/core';`,
              `reveal(secretValue, {`,
              `  source: 'app.env.PAYMENT_API_KEY',`,
              `  method: 'arbitrary-fn',`,
              `  justification: 'initialize payment SDK once at boot',`,
              `});`,
            ].join('\n'),
          },
        ],
      }),
    ).toMatchObject([
      {
        justification: 'initialize payment SDK once at boot',
        path: 'app.env.PAYMENT_API_KEY',
        site: 'alias.ts:2',
      },
    ]);
  });

  it('ignores local lookalikes but emits KV426 for an imported dynamic reveal', () => {
    expect(
      collectRuntimeRevealFactsFromProject({
        files: [
          {
            fileName: 'lookalike.ts',
            source: [
              `function trustedReveal(value: unknown) { return value; }`,
              `trustedReveal(secretValue, { justification: 'local lookalike' });`,
            ].join('\n'),
          },
        ],
      }),
    ).toEqual([]);

    const files = [
      {
        fileName: 'dynamic.ts',
        source: [
          `import { trustedReveal as reveal } from '@kovojs/core';`,
          `reveal(secretValue, options);`,
        ].join('\n'),
      },
    ];
    const audit = collectRuntimeRevealAuditFromProject({ files });
    expect(audit.revealed).toEqual([]);
    expect(audit.diagnostics).toMatchObject([
      {
        code: 'KV426',
        severity: 'error',
        site: 'dynamic.ts:2',
      },
    ]);
    expect(() => collectRuntimeRevealFactsFromProject({ files })).toThrow(
      /KV426 dynamic\.ts:2[\s\S]*dynamic options cannot be recorded/u,
    );

    const namespaceAudit = collectRuntimeRevealAuditFromProject({
      files: [
        {
          fileName: 'dynamic-namespace.ts',
          source: [
            `import * as core from '@kovojs/core';`,
            `core.trustedReveal(secretValue, options);`,
          ].join('\n'),
        },
      ],
    });
    expect(namespaceAudit.revealed).toEqual([]);
    expect(namespaceAudit.diagnostics).toMatchObject([
      {
        code: 'KV426',
        site: 'dynamic-namespace.ts:2',
      },
    ]);
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

    const aggregate = collectStaticBuildTrustFactsFromProject({ files });
    expect(aggregate.diagnostics).toEqual([]);
    expect(aggregate.revealed).toEqual(collectRuntimeRevealFactsFromProject({ files }));
  });
});
