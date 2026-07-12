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
});
