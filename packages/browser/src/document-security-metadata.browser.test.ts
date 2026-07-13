import { afterEach, expect, it, vi } from 'vitest';

import { readPageBuildToken } from './build-token.js';
import { guardKovoDynamicImportModule } from './dynamic-import-url.js';

const originalHead = document.head.innerHTML;

afterEach(() => {
  document.head.innerHTML = originalHead;
});

it('reads the build token through the boot-pinned Document and Element controls', () => {
  document.head.innerHTML = '<meta name="kovo-build" content="build-safe">';
  const originalQuerySelector = Document.prototype.querySelector;
  Document.prototype.querySelector = function poisonedQuerySelector(selector) {
    if (selector === 'meta[name="kovo-build"]') {
      return { getAttribute: () => 'build-forged' } as unknown as Element;
    }
    return Reflect.apply(originalQuerySelector, this, [selector]);
  };
  try {
    expect(readPageBuildToken()).toBe('build-safe');
  } finally {
    Document.prototype.querySelector = originalQuerySelector;
  }
});

it('does not admit a forged document module allowlist poisoned during option inspection', () => {
  document.head.innerHTML = '';
  const originalQuerySelectorAll = Document.prototype.querySelectorAll;
  const originalArrayIterator = Array.prototype[Symbol.iterator];
  let poisonCalls = 0;
  let iteratorPoisonCalls = 0;
  const options = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        Array.prototype[Symbol.iterator] = function poisonedArrayIterator() {
          iteratorPoisonCalls += 1;
          return Reflect.apply(originalArrayIterator, this, []);
        };
        Document.prototype.querySelectorAll = function poisonedQuerySelectorAll(selector) {
          poisonCalls += 1;
          if (selector === '[data-kovo-module-allowlist]') {
            return [
              {
                getAttribute(name: string) {
                  return name === 'data-kovo-module-allowlist' ? '/c/attacker.client.js' : null;
                },
              },
            ] as unknown as NodeListOf<Element>;
          }
          return Reflect.apply(originalQuerySelectorAll, this, [selector]);
        };
        return undefined;
      },
    },
  );
  const importer = vi.fn(async () => ({}));
  let guarded: ReturnType<typeof guardKovoDynamicImportModule> | undefined;
  try {
    guarded = guardKovoDynamicImportModule(importer, options);
  } finally {
    Document.prototype.querySelectorAll = originalQuerySelectorAll;
    Array.prototype[Symbol.iterator] = originalArrayIterator;
  }
  expect(() => guarded?.('/c/attacker.client.js')).toThrow(/Disallowed Kovo dynamic import URL/u);
  expect(poisonCalls).toBe(0);
  expect(iteratorPoisonCalls).toBe(0);
  expect(importer).not.toHaveBeenCalled();
});
