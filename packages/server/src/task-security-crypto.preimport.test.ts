import { randomBytes } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const mutableCrypto = require('node:crypto') as { randomBytes: typeof randomBytes };

describe('durable-task crypto import-order membrane', () => {
  it('fails closed for constant synchronized entropy installed before import', async () => {
    const originalRandomBytes = mutableCrypto.randomBytes;
    let intrinsics!: typeof import('./task-security-intrinsics.js');
    try {
      mutableCrypto.randomBytes = ((size: number) =>
        Buffer.alloc(size, 0x43)) as typeof randomBytes;
      syncBuiltinESMExports();
      intrinsics = await import('./task-security-intrinsics.js');
    } finally {
      mutableCrypto.randomBytes = originalRandomBytes;
      syncBuiltinESMExports();
    }

    expect(() => intrinsics.assertTaskSecurityIntrinsics()).toThrow(
      /intrinsics were modified before framework initialization/u,
    );
  });
});
