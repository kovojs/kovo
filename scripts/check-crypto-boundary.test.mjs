import { describe, expect, it } from 'vitest';

import { checkCryptoBoundary } from './check-crypto-boundary.mjs';

function runFixture(files, entries, maximumCryptoAcquisitionFiles = 1) {
  return checkCryptoBoundary({
    entries,
    maximumCryptoAcquisitionFiles,
    readText: (relativePath) => files[relativePath] ?? '',
    sourceFiles: Object.keys(files).sort(),
  });
}

describe('SPEC §6.6 crypto acquisition ratchet', () => {
  // @kovo-security-classifier-corpus C13 crypto-acquisition-ratchet
  it('accepts only the exact reviewed path, class, and operation set', () => {
    const files = {
      'packages/tool/src/digest.ts': `import { createHash } from 'node:crypto';`,
      'packages/server/src/crypto-authority.ts': `
        import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
      `,
    };
    const entries = [
      {
        file: 'packages/server/src/crypto-authority.ts',
        kind: 'crypto-acquisition',
        operations: ['createHmac', 'hkdfSync', 'randomBytes'],
      },
      {
        file: 'packages/tool/src/digest.ts',
        kind: 'digest',
        operations: ['createHash'],
      },
    ];
    expect(runFixture(files, entries).findings).toEqual([]);

    const widened = {
      ...files,
      'packages/tool/src/digest.ts': `import { createHash, createHmac } from 'node:crypto';`,
    };
    expect(runFixture(widened, entries).findings).toContainEqual(
      expect.stringContaining('reviewed digest row widened to crypto-acquisition'),
    );
  });

  it('rejects unreviewed WebCrypto, namespace, and argon2 acquisition', () => {
    for (const source of [
      `export const key = crypto.subtle.importKey;`,
      `import crypto from 'node:crypto'; export { crypto };`,
      `import { hash } from '@node-rs/argon2'; export { hash };`,
    ]) {
      const result = runFixture({ 'packages/app/src/unsafe.ts': source }, [], 0);
      expect(result.findings).toContainEqual(expect.stringContaining('unreviewed crypto-acquisition'));
    }
  });

  it('forces stale high-authority rows to shrink and enforces the numeric ceiling', () => {
    const stale = runFixture(
      { 'packages/server/src/crypto-authority.ts': `export const safe = true;` },
      [
        {
          file: 'packages/server/src/crypto-authority.ts',
          kind: 'crypto-acquisition',
          operations: ['createHmac'],
        },
      ],
    );
    expect(stale.findings).toContainEqual(expect.stringContaining('stale ratchet row'));

    const over = runFixture(
      {
        'packages/a/src/a.ts': `import { createHmac } from 'node:crypto';`,
        'packages/b/src/b.ts': `import { randomBytes } from 'node:crypto';`,
      },
      [
        {
          file: 'packages/a/src/a.ts',
          kind: 'crypto-acquisition',
          operations: ['createHmac'],
        },
        {
          file: 'packages/b/src/b.ts',
          kind: 'crypto-acquisition',
          operations: ['randomBytes'],
        },
      ],
      1,
    );
    expect(over.findings).toContainEqual(expect.stringContaining('exceeds non-increasing ceiling 1'));
  });
});
