import { describe, expect, it } from 'vitest';

import {
  collectRuntimeRevealAuditFromProject,
  collectRuntimeRevealFactsFromProject,
  collectStaticBuildTrustFactsFromProject,
} from './trust-escapes-static.js';

describe('runtime declassification fact collector (SPEC §6.6, audit-only)', () => {
  it('records one exact typed credential policy', () => {
    expect(
      collectRuntimeRevealFactsFromProject({
        files: [
          {
            fileName: 'payment.ts',
            source: [
              `import { DeclassifyPolicy, revealSecret, type SecretValue } from '@kovojs/core/security';`,
              `export function createPaymentClient(key: SecretValue<string>) {`,
              `  const raw = revealSecret(key, DeclassifyPolicy.forRevealSecret({`,
              `    ownerScope: 'application',`,
              `    purpose: 'credential-use',`,
              `  }));`,
              `  return new PaymentClient(raw);`,
              `}`,
            ].join('\n'),
          },
        ],
      }),
    ).toMatchObject([
      {
        grade: 'audit',
        justification: 'credential-use:revealSecret:application',
        method: 'arbitrary-fn',
        path: 'key',
        query: 'runtime',
        selectedSecret: true,
        site: 'payment.ts:3',
        source: 'key',
      },
    ]);
  });

  it('records direct import aliases with an exact door-specific policy', () => {
    expect(
      collectRuntimeRevealFactsFromProject({
        files: [
          {
            fileName: 'alias.ts',
            source: [
              `import { DeclassifyPolicy as Policy, trustedReveal as reveal } from '@kovojs/core/security';`,
              `reveal(secretValue, Policy.forTrustedReveal({`,
              `  ownerScope: 'current-tenant',`,
              `}));`,
            ].join('\n'),
          },
        ],
      }),
    ).toMatchObject([
      {
        justification: 'public-projection:trustedReveal:current-tenant',
        path: 'secretValue',
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
          `import { trustedReveal as reveal } from '@kovojs/core/security';`,
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
      /KV426 dynamic\.ts:2[\s\S]*dynamic policy cannot be recorded/u,
    );

    const namespaceAudit = collectRuntimeRevealAuditFromProject({
      files: [
        {
          fileName: 'dynamic-namespace.ts',
          source: [
            `import * as core from '@kovojs/core/security';`,
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

    const wrongDoorAudit = collectRuntimeRevealAuditFromProject({
      files: [
        {
          fileName: 'wrong-door.ts',
          source: [
            `import { DeclassifyPolicy, revealSecret } from '@kovojs/core/security';`,
            `revealSecret(secretValue, DeclassifyPolicy.forTrustedReveal({`,
            `  ownerScope: 'application',`,
            `}));`,
          ].join('\n'),
        },
      ],
    });
    expect(wrongDoorAudit.revealed).toEqual([]);
    expect(wrongDoorAudit.diagnostics).toMatchObject([
      {
        code: 'KV426',
        site: 'wrong-door.ts:2',
      },
    ]);
  });

  it('retains the same fact in the one-project production-build aggregate', () => {
    const files = [
      {
        fileName: 'payment.ts',
        source: [
          `import { DeclassifyPolicy, revealSecret } from '@kovojs/core/security';`,
          `revealSecret(app.env.PAYMENT_API_KEY, DeclassifyPolicy.forRevealSecret({`,
          `  ownerScope: 'application',`,
          `  purpose: 'credential-use',`,
          `}));`,
        ].join('\n'),
      },
    ];

    const aggregate = collectStaticBuildTrustFactsFromProject({ files });
    expect(aggregate.diagnostics).toEqual([]);
    expect(aggregate.revealed).toEqual(collectRuntimeRevealFactsFromProject({ files }));
  });
});
