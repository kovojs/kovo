import { describe, expect, it, vi } from 'vitest';

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

  it('C233 keeps dense task commits authoritative when inherited setters predate import', async () => {
    vi.resetModules();
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const originalTwo = Object.getOwnPropertyDescriptor(Array.prototype, '2');
    const nativeDefineProperty = Object.defineProperty;
    let setterCalls = 0;

    try {
      const installSetter = (property: '0' | '2', blockedValue: string): void => {
        nativeDefineProperty(Array.prototype, property, {
          configurable: true,
          set(value: unknown) {
            if (value === blockedValue) {
              setterCalls += 1;
              return;
            }
            nativeDefineProperty(this, property, {
              configurable: true,
              enumerable: true,
              value,
              writable: true,
            });
          },
        });
      };
      installSetter('0', 'approved-preimport');
      installSetter('2', 'c');

      const intrinsics = await import('./task-security-intrinsics.ts?c233-preimport');
      const committed: string[] = [];
      intrinsics.taskArrayPush(committed, 'approved-preimport');
      const snapshot = intrinsics.taskSnapshotCollection(
        ['approved-preimport'],
        'preimport task registry',
      );

      expect(committed).toEqual(['approved-preimport']);
      expect(snapshot).toEqual(['approved-preimport']);
      expect(setterCalls).toBe(0);
    } finally {
      if (originalZero === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalZero);
      if (originalTwo === undefined) delete Array.prototype[2];
      else nativeDefineProperty(Array.prototype, '2', originalTwo);
    }
  });
});
