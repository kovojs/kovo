import { describe, expect, it } from 'vitest';

import {
  kovoServerHandlerEntrySource,
  serializeBuildRuntimeRegistryWireModule,
} from './build-export.js';
import { buildPromiseAll, buildStringSplit } from './build-security-intrinsics.js';

describe('build/export security bootstrap ordering', () => {
  it('imports the server bootstrap owner before generated registry and app modules', () => {
    const source = kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', {
      app: [],
      fragments: {},
      routes: {},
    });
    const serverImport = source.indexOf("import { createRequestHandler } from '@kovojs/server';");
    const registryImport = source.indexOf("import './runtime-registry.mjs';");
    const appImport = source.indexOf('import * as appModule from');

    expect(serverImport).toBeGreaterThanOrEqual(0);
    expect(serverImport).toBeLessThan(registryImport);
    expect(registryImport).toBeLessThan(appImport);
  });

  it('does not let a late JSON.stringify replacement inject generated modules', () => {
    const nativeStringify = JSON.stringify;
    const marker = 'globalThis.__kovoBuildJsonInjection = true';
    try {
      JSON.stringify = (() => `null);${marker};//`) as typeof JSON.stringify;

      const handler = kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', {
        app: [{ href: '/assets/app.css' }],
        fragments: {},
        routes: {},
      });
      const registry = serializeBuildRuntimeRegistryWireModule({
        mutationTouches: {
          save: [{ domain: 'accounts', keys: 'id' }],
        },
        queryReads: [{ domains: ['accounts'], query: 'account' }],
      });

      expect(handler).not.toContain(marker);
      expect(handler).toContain('"/assets/app.css"');
      expect(registry).not.toContain(marker);
      expect(registry).toContain('"query":"account"');
      expect(registry).toContain('"domain":"accounts"');
    } finally {
      JSON.stringify = nativeStringify;
    }
  });

  it('does not dispatch build parsing through a late String symbol split hook', () => {
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.split);
    Object.defineProperty(String.prototype, Symbol.split, {
      configurable: true,
      value: () => [],
    });
    try {
      expect(buildStringSplit('ERROR KV418\nCHECK forbidden', '\n')).toEqual([
        'ERROR KV418',
        'CHECK forbidden',
      ]);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(String.prototype, Symbol.split);
      else Object.defineProperty(String.prototype, Symbol.split, descriptor);
    }
  });

  it('does not let late Promise/iterator controls replace build-join inputs', async () => {
    const first = Promise.resolve('first');
    const second = Promise.resolve('second');
    const values = [first, second] as const;
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeResolve = Promise.resolve;
    let pending: Promise<readonly [string, string]>;
    try {
      Array.prototype[Symbol.iterator] = function poisonedBuildPromiseIterator<T>() {
        if (this === values) return Reflect.apply(nativeIterator, [], []);
        return Reflect.apply(nativeIterator, this, []);
      };
      Promise.resolve = function poisonedBuildPromiseResolve<T>(value: T | PromiseLike<T>) {
        if (value === first || value === second) {
          return Reflect.apply(nativeResolve, Promise, ['forged']) as Promise<Awaited<T>>;
        }
        return Reflect.apply(nativeResolve, Promise, [value]);
      };
      pending = buildPromiseAll(values);
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
      Promise.resolve = nativeResolve;
    }
    await expect(pending!).resolves.toEqual(['first', 'second']);
  });
});
