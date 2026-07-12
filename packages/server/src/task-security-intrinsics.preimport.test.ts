import { describe, expect, it } from 'vitest';

describe('durable-task import-order intrinsic membrane', () => {
  it('fails closed when exact registry lookup and the clock were poisoned before import', async () => {
    const originalDateNow = Date.now;
    const originalMapGet = Map.prototype.get;
    let intrinsics!: typeof import('./task-security-intrinsics.js');
    try {
      Date.now = () => 1;
      Map.prototype.get = function (key: unknown) {
        if (key === 'ordinary') return 'privileged-definition';
        return originalMapGet.call(this, key);
      };
      intrinsics = await import('./task-security-intrinsics.js');
    } finally {
      Date.now = originalDateNow;
      Map.prototype.get = originalMapGet;
    }

    expect(() => intrinsics.assertTaskSecurityIntrinsics()).toThrow(
      /intrinsics were modified before framework initialization/u,
    );
  });
});
