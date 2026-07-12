import { describe, expect, it, vi } from 'vitest';

describe('neutral build import-order authority membrane', () => {
  it('C218 fails closed when collection controls were poisoned before build initialization', async () => {
    vi.resetModules();
    const originalPush = Array.prototype.push;
    let importError: unknown;
    try {
      Array.prototype.push = function (...items) {
        if (items[0] === 'safe') items[0] = 'preimport-attacker';
        return Reflect.apply(originalPush, this, items);
      } as typeof Array.prototype.push;
      await import('./neutral-build.ts?c218-preimport');
    } catch (error) {
      importError = error;
    } finally {
      Array.prototype.push = originalPush;
    }

    expect(() => {
      throw importError;
    }).toThrow(/controls are unavailable because the server realm intrinsics were modified/u);
  });

  it('C228 snapshots dense metadata when an inherited index setter predates build initialization', async () => {
    vi.resetModules();
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const nativeDefineProperty = Object.defineProperty;
    let setterCalls = 0;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === 'approved-preimport') {
            setterCalls += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      const { snapshotBuildArray } = await import('./build-security-intrinsics.ts?c228-preimport');
      const snapshot = snapshotBuildArray(['approved-preimport'], 'preimport metadata');

      expect(snapshot).toEqual(['approved-preimport']);
      expect(setterCalls).toBe(0);
    } finally {
      if (originalZero === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalZero);
    }
  });
});
