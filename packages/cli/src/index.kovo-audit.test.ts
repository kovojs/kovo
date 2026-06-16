import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { kovoAudit, main } from './index.js';

describe('kovo audit', () => {
  it('prints stable unguarded and manual invalidate audit output', () => {
    expect(
      kovoAudit({
        mutations: [
          {
            guards: ['rateLimit:session'],
            invalidates: ['cart'],
            key: 'cart/add',
            writes: ['cart'],
          },
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
          { key: 'inventory/sync', manualInvalidates: ['product'], writes: ['product'] },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=cart manual-invalidates=-',
        'MUTATION inventory/sync guards=- writes=product invalidates=- manual-invalidates=product',
        'MANUAL-INVALIDATES',
        'MUTATION inventory/sync domains=product',
        'SUMMARY unguarded=2 manual-invalidates=1',
        '',
      ].join('\n'),
    });
  });

  it('prints stable endpoint audit output', () => {
    expect(
      kovoAudit({
        endpoints: [
          {
            auth: 'none',
            csrf: 'exempt',
            csrfJustification: 'oauth callback',
            method: 'GET',
            name: 'auth/callback',
            path: '/auth/callback',
          },
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-audit/v1',
        'UNGUARDED',
        'ENDPOINT auth/callback method=GET path=/auth/callback mount=exact auth=none csrf=exempt:oauth callback',
        'SUMMARY unguarded=1 manual-invalidates=0',
        '',
      ].join('\n'),
    });
  });

  it('prints OK when there are no audit findings', () => {
    expect(
      kovoAudit({
        mutations: [
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'kovo-audit/v1\nOK\n',
    });
  });

  it('fails on audit findings when requested', () => {
    expect(
      kovoAudit(
        {
          mutations: [
            { guards: ['authed'], key: 'cart/remove' },
            { guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] },
          ],
        },
        { failOnFindings: true },
      ),
    ).toEqual({
      exitCode: 1,
      output: [
        'kovo-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-',
        'SUMMARY unguarded=1 manual-invalidates=0',
        '',
      ].join('\n'),
    });
  });

  it('accepts kovo audit as a CLI command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-audit-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [
            { guards: ['authed'], key: 'cart/remove' },
            { guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] },
          ],
        }),
      );

      expect(main(['audit', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'kovo-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-',
        'SUMMARY unguarded=1 manual-invalidates=0',
        '',
      ].join('\n'),
    );
  });

  it('fails kovo audit when requested and findings exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-audit-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [
            { guards: ['authed'], key: 'cart/remove' },
            { guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] },
          ],
        }),
      );

      expect(main(['audit', '--fail-on-findings', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'kovo-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-',
        'SUMMARY unguarded=1 manual-invalidates=0',
        '',
      ].join('\n'),
    );
  });
});
