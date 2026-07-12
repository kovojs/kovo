import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  egressArrayPush,
  egressArraySome,
  egressArraySplice,
  egressRegExpTest,
  egressStringStartsWith,
} from './egress-intrinsics.js';

const moduleUrl = new URL('./egress-intrinsics.ts', import.meta.url).href;

describe('egress intrinsic membrane', () => {
  it('keeps scalar and collection decisions pinned after app-realm prototype poisoning', () => {
    const originalSome = Array.prototype.some;
    const originalStartsWith = String.prototype.startsWith;
    const originalExec = RegExp.prototype.exec;
    const originalReplace = RegExp.prototype[Symbol.replace];
    try {
      Array.prototype.some = () => true;
      String.prototype.startsWith = () => true;
      RegExp.prototype.exec = () => null;
      RegExp.prototype[Symbol.replace] = () => '8.8.8.8';

      expect(egressArraySome([], () => true)).toBe(false);
      expect(egressStringStartsWith('127.0.0.1', '[')).toBe(false);
      expect(egressRegExpTest(/^127\./u, '127.0.0.1')).toBe(true);
      expect(egressRegExpTest(/^8\./u, '127.0.0.1')).toBe(false);
    } finally {
      Array.prototype.some = originalSome;
      String.prototype.startsWith = originalStartsWith;
      RegExp.prototype.exec = originalExec;
      RegExp.prototype[Symbol.replace] = originalReplace;
    }
  });

  it('C237 commits appended values and splice arguments as own data', () => {
    const nativeDefineProperty = Object.defineProperty;
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const originalTwo = Object.getOwnPropertyDescriptor(Array.prototype, '2');
    let setterCalls = 0;

    try {
      const installSetter = (property: '0' | '2', blockedValue: unknown): void => {
        nativeDefineProperty(Array.prototype, property, {
          configurable: true,
          set(value: unknown) {
            if (value === blockedValue) {
              setterCalls += 1;
              nativeDefineProperty(this, property, {
                configurable: true,
                enumerable: true,
                value: property === '0' ? 0x2606 : 'attacker-replacement',
                writable: true,
              });
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
      installSetter('0', 0xfd00);
      installSetter('2', 'approved-replacement');

      const words: number[] = [];
      const spliceTarget = ['original'];
      egressArrayPush(words, 0xfd00, 0x0ec2);
      egressArraySplice(spliceTarget, 0, 1, 'approved-replacement');

      expect(words).toEqual([0xfd00, 0x0ec2]);
      expect(spliceTarget).toEqual(['approved-replacement']);
      expect(setterCalls).toBe(0);
    } finally {
      if (originalZero === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalZero);
      if (originalTwo === undefined) delete Array.prototype[2];
      else nativeDefineProperty(Array.prototype, '2', originalTwo);
    }
  });

  it('fails closed when security controls were poisoned before framework import', () => {
    const script = `
      Array.prototype.some = () => true;
      const intrinsics = await import(${JSON.stringify(`${moduleUrl}?poisoned-egress-probe`)});
      try {
        intrinsics.assertEgressIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('C237 keeps own-data egress commits when inherited setters predate import', () => {
    const script = `
      const nativeDefineProperty = Object.defineProperty;
      const nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      let setterCalls = 0;
      const installSetter = (property, blockedValue, replacement) => {
        nativeDefineProperty(Array.prototype, property, {
          configurable: true,
          set(value) {
            if (value === blockedValue) {
              setterCalls += 1;
              nativeDefineProperty(this, property, {
                configurable: true,
                enumerable: true,
                value: replacement,
                writable: true,
              });
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
      installSetter('0', 0xfd00, 0x2606);
      installSetter('2', 'approved-replacement', 'attacker-replacement');
      const controls = await import(${JSON.stringify(`${moduleUrl}?c237-inherited-index`)});
      const words = [];
      const spliceTarget = ['original'];
      controls.egressArrayPush(words, 0xfd00, 0x0ec2);
      controls.egressArraySplice(spliceTarget, 0, 1, 'approved-replacement');
      const wordZero = nativeGetOwnPropertyDescriptor(words, '0');
      const spliceZero = nativeGetOwnPropertyDescriptor(spliceTarget, '0');
      if (
        words.length === 2 &&
        wordZero?.value === 0xfd00 &&
        spliceZero?.value === 'approved-replacement' &&
        setterCalls === 0
      ) {
        process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
