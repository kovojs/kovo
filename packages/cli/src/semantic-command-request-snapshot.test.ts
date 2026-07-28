import { describe, expect, it } from 'vitest';

import { snapshotKovoSemanticCommandRequest } from './semantic-command-request-snapshot.js';

describe('semantic command request bootstrap snapshot', () => {
  it('rejects accessors without invoking caller code', () => {
    let accessed = false;
    const request = {
      arguments: {},
      form: 'graph',
      options: {},
    } as Record<string, unknown>;
    Object.defineProperty(request, 'command', {
      enumerable: true,
      get() {
        accessed = true;
        return 'check';
      },
    });

    expect(() => snapshotKovoSemanticCommandRequest(request)).toThrow(
      'must contain only own data fields',
    );
    expect(accessed).toBe(false);
  });

  it('rejects proxies without invoking their traps', () => {
    let trapped = false;
    const request = new Proxy(
      {
        arguments: {},
        command: 'check',
        form: 'graph',
        options: {},
      },
      {
        get() {
          trapped = true;
          throw new Error('proxy trap must not run');
        },
        getOwnPropertyDescriptor() {
          trapped = true;
          throw new Error('proxy trap must not run');
        },
        ownKeys() {
          trapped = true;
          throw new Error('proxy trap must not run');
        },
      },
    );

    expect(() => snapshotKovoSemanticCommandRequest(request)).toThrow('must not contain a Proxy');
    expect(trapped).toBe(false);
  });

  it('freezes an exact null-prototype copy and rejects nested accessor or surplus top-level data', () => {
    const request = {
      arguments: { appModule: 'src/app.tsx' },
      command: 'build',
      form: 'build',
      options: { cache: false, check: true, out: 'dist', preset: 'node' },
    } as const;
    const snapshot = snapshotKovoSemanticCommandRequest(request);

    expect(snapshot).toEqual(request);
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Object.getPrototypeOf(snapshot.arguments)).toBeNull();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.arguments)).toBe(true);

    expect(() => snapshotKovoSemanticCommandRequest({ ...request, transport: 'argv' })).toThrow(
      'unsupported top-level field',
    );

    const nestedAccessor = { ...request, options: {} as Record<string, unknown> };
    Object.defineProperty(nestedAccessor.options, 'out', {
      enumerable: true,
      get: () => 'dist',
    });
    expect(() => snapshotKovoSemanticCommandRequest(nestedAccessor)).toThrow(
      'must contain only own data fields',
    );
  });
});
