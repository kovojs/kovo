import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  buildInlineJisoLoaderModuleSource,
  buildInlineJisoLoaderInstallerSource,
  inlineJisoLoaderInstallerReadableSource,
} from './inline-loader-build.js';
import {
  createInlineJisoLoaderSource,
  inlineJisoLoaderInstallerSource,
  installInlineJisoLoader,
  jisoLoaderSource,
} from './inline-loader.js';
import {
  createInlineJisoLoaderSource as createPublicInlineJisoLoaderSource,
  createQueryStore,
  submitEnhancedMutation,
  type EnhancedMutationFetchOptions,
} from './index.js';

type InlineSourceInstall = (
  importModule: (url: string) => Promise<Record<string, unknown>>,
  globalRecord: Record<string, unknown>,
) => void;

const inlineSourceInstallCases: readonly [string, InlineSourceInstall][] = [
  [
    'generated bootstrap source',
    (importModule, globalRecord) => {
      globalRecord.__jisoInlineImport = importModule;
      runInThisContext(createInlineJisoLoaderSource('globalThis.__jisoInlineImport'));
    },
  ],
  ['extracted installer source', (importModule) => installInlineJisoLoader(importModule)],
] as const;

class InlineTriggerElement {
  readonly attributes: Array<{ name: string; value: string }> = [];

  constructor(private readonly attrs: Record<string, string>) {}

  closest(selector: string): InlineTriggerElement | null {
    if (selector === '[fw-state]') {
      return Object.hasOwn(this.attrs, 'fw-state') ? this : null;
    }

    const trigger = /^\[on\\:(.+)\]$/.exec(selector)?.[1];
    return trigger && Object.hasOwn(this.attrs, `on:${trigger}`) ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
}

class InlineParityRoot {
  deps: { deps?: string; id?: string; target?: string }[] = [];

  findFragmentTarget(): null {
    return null;
  }

  querySelectorAll(
    selector: string,
  ): Iterable<{ getAttribute(name: string): string | null; id?: string }> {
    if (selector !== '[fw-deps]') return [];

    return this.deps.map((dep) => ({
      getAttribute(name: string) {
        if (name === 'fw-fragment-target') return dep.target ?? null;
        if (name === 'fw-deps') return dep.deps ?? null;
        return null;
      },
      ...(dep.id ? { id: dep.id } : {}),
    }));
  }
}

describe('inline loader source', () => {
  it('pins the shipped minified installer to the deterministic source helper', () => {
    // SPEC.md §4.4: drift checks must compare the shipped bootstrap to readable source.
    expect(inlineJisoLoaderInstallerReadableSource).toContain('\nfunction installInlineJisoLoader');
    expect(inlineJisoLoaderInstallerReadableSource).toContain("join('; ')");
    expect(buildInlineJisoLoaderInstallerSource()).toBe(inlineJisoLoaderInstallerSource);
  });

  it('emits the checked-in runtime module from the readable inline loader source', () => {
    // SPEC.md §4.4: build-time emission must keep the shipped bootstrap tied to readable source.
    expect(buildInlineJisoLoaderModuleSource()).toBe(
      readFileSync(new URL('./inline-loader.ts', import.meta.url), 'utf8'),
    );
  });

  it('keeps string, comment, and regex hazards in parity through the source helper', () => {
    // SPEC.md §4.4: build-time minification must not alter inline-loader wire strings.
    const hazardSource = [
      'function inlineMinifierHazards(value) {',
      "  const stringLiteral = 'keep // and /* comment markers */ and spaces';",
      '  const templateLiteral = `template // marker`;',
      "  const joined = ['left', 'right'].join('; ');",
      '  const numeric = 2;',
      '  const plusWhitespace = numeric + +1;',
      '  const minusWhitespace = numeric - -1;',
      '  const plusComment = numeric+/* plus gap */+1;',
      '  const minusComment = numeric-/* minus gap */-1;',
      '  const commentReturn = () => { return/* return gap */value; };',
      '  const commentRegex = /\\/\\/|\\/\\*/g;',
      '  const afterReturn = (candidate) => {',
      '    return /\\/\\/|\\/\\*/.test(candidate);',
      '  };',
      '  const afterArrow = (candidate) => /;\\s/.test(candidate);',
      '  return {',
      '    afterArrow: afterArrow(joined),',
      '    afterReturn: afterReturn(value),',
      '    commentHits: value.match(commentRegex)?.length ?? 0,',
      '    commentReturn: commentReturn(),',
      '    joined,',
      '    minusComment,',
      '    minusWhitespace,',
      '    plusComment,',
      '    plusWhitespace,',
      '    stringLiteral,',
      '    templateLiteral,',
      '  };',
      '}',
    ].join('\n');
    const minifiedSource = buildInlineJisoLoaderInstallerSource(hazardSource);
    const readable = runInThisContext(`(${hazardSource})`) as (value: string) => unknown;
    const minified = runInThisContext(`(${minifiedSource})`) as (value: string) => unknown;
    const input = 'path // query /* block marker */';

    expect(minifiedSource).toBe(minifiedSource.trim());
    expect(minifiedSource).not.toMatch(/\n|\s{2,}/);
    expect(minifiedSource).toContain("'keep // and /* comment markers */ and spaces'");
    expect(minifiedSource).toContain('numeric+ +1');
    expect(minifiedSource).toContain('numeric- -1');
    expect(minifiedSource).toContain('return value');
    expect(minifiedSource).toContain("join('; ')");
    expect(minified(input)).toEqual(readable(input));
  });

  it('rejects template interpolation instead of silently rewriting it', () => {
    // SPEC.md §4.4: inline-loader generation must fail closed on unsupported source syntax.
    expect(() =>
      buildInlineJisoLoaderInstallerSource(
        ['function unsupportedTemplate(value) {', '  return `loader ${value}`;', '}'].join('\n'),
      ),
    ).toThrow('template interpolation');
  });

  it('wraps the extracted installer source as the public bootstrap source', () => {
    // SPEC.md §4.4: the generated bootstrap is the always-loaded runtime path.
    expect(jisoLoaderSource).toBe(`(${inlineJisoLoaderInstallerSource})((url)=>import(url));`);
    expect(createPublicInlineJisoLoaderSource()).toBe(jisoLoaderSource);
    expect(gzipSync(jisoLoaderSource).byteLength).toBeLessThanOrEqual(4096);
    expect(jisoLoaderSource).toBe(jisoLoaderSource.trim());
    expect(jisoLoaderSource).not.toMatch(/\n|\s{2,}/);
    expect(jisoLoaderSource).toMatch(
      /^\(function installInlineJisoLoader\(importModule\)\{.*\}\)\(\(url\)=>import\(url\)\);$/,
    );
  });

  it('keeps minified wire-contract tokens pinned in the extracted installer', () => {
    // SPEC.md §4.4: inline and modular loaders must not drift on query/fragment wire effects.
    expect(inlineJisoLoaderInstallerSource).toBe(inlineJisoLoaderInstallerSource.trim());
    expect(inlineJisoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(inlineJisoLoaderInstallerSource).toContain("join('; ')");
    expect(inlineJisoLoaderInstallerSource).toContain('[...new Set(');
    expect(inlineJisoLoaderInstallerSource).toContain("key:query.getAttribute('key')??undefined");
    expect(inlineJisoLoaderInstallerSource).toContain(
      "element.getAttribute('fw-fragment-target')??element.id",
    );
    expect(inlineJisoLoaderInstallerSource).toContain("getAttribute('fw-param-types')");
    expect(inlineJisoLoaderInstallerSource).not.toContain('Math.random');
  });

  it('installs from a generated custom import expression without importing handlers eagerly', () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originals = {
      addEventListener: globalRecord.addEventListener,
      document: globalRecord.document,
      importModule: globalRecord.__jisoInlineImport,
    };
    const listeners = new Map<string, unknown>();
    const importModule = vi.fn(async () => ({}));

    try {
      globalRecord.__jisoInlineImport = importModule;
      globalRecord.addEventListener = (type: string, listener: unknown) => {
        listeners.set(type, listener);
      };
      globalRecord.document = {
        querySelectorAll() {
          return [];
        },
      };

      runInThisContext(createInlineJisoLoaderSource(' globalThis.__jisoInlineImport '));

      expect([...listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
      expect(importModule).not.toHaveBeenCalled();
    } finally {
      Object.assign(globalRecord, {
        addEventListener: originals.addEventListener,
        document: originals.document,
      });
      if (originals.importModule === undefined) {
        delete globalRecord.__jisoInlineImport;
      } else {
        globalRecord.__jisoInlineImport = originals.importModule;
      }
    }
  });

  it.each(inlineSourceInstallCases)(
    'keeps execution trigger initialization in parity through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: execution triggers live in the always-loaded inline path.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        IntersectionObserver: globalRecord.IntersectionObserver,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        importModule: globalRecord.__jisoInlineImport,
        requestIdleCallback: globalRecord.requestIdleCallback,
      };
      const listeners = new Map<string, unknown>();
      const idleCallbacks: Array<() => void> = [];
      const loadElement = new InlineTriggerElement({ 'on:load': '/c/load.js#start' });
      const idleElement = new InlineTriggerElement({ 'on:idle': '/c/idle.js#warm' });
      const visibleElement = new InlineTriggerElement({ 'on:visible': '/c/chart.js#mount' });
      const observer = {
        observe: vi.fn(),
        unobserve: vi.fn(),
      };
      let visibleCallback:
        | ((entries: Array<{ isIntersecting: boolean; target: InlineTriggerElement }>) => void)
        | undefined;
      const handlers = {
        mount: vi.fn(),
        start: vi.fn(),
        warm: vi.fn(),
      };
      const importModule = vi.fn(async (url: string) => {
        if (url === '/c/load.js') return { start: handlers.start };
        if (url === '/c/idle.js') return { warm: handlers.warm };
        return { mount: handlers.mount };
      });

      try {
        globalRecord.addEventListener = (type: string, listener: unknown) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelectorAll(selector: string) {
            if (selector === '[on\\:load]') return [loadElement];
            if (selector === '[on\\:idle]') return [idleElement];
            if (selector === '[on\\:visible]') return [visibleElement];
            return [];
          },
        };
        globalRecord.requestIdleCallback = (callback: () => void) => {
          idleCallbacks.push(callback);
          return 1;
        };
        globalRecord.IntersectionObserver = function IntersectionObserver(
          callback: typeof visibleCallback,
        ) {
          visibleCallback = callback;
          return observer;
        };

        installSource(importModule, globalRecord);

        expect([...listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
        await vi.waitFor(() => expect(handlers.start).toHaveBeenCalledTimes(1));
        expect(handlers.warm).not.toHaveBeenCalled();
        expect(handlers.mount).not.toHaveBeenCalled();
        expect(observer.observe).toHaveBeenCalledWith(visibleElement);

        idleCallbacks[0]?.();
        await vi.waitFor(() => expect(handlers.warm).toHaveBeenCalledTimes(1));

        visibleCallback?.([{ isIntersecting: false, target: visibleElement }]);
        expect(handlers.mount).not.toHaveBeenCalled();
        visibleCallback?.([{ isIntersecting: true, target: visibleElement }]);
        await vi.waitFor(() => expect(handlers.mount).toHaveBeenCalledTimes(1));
        expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
        expect(importModule).toHaveBeenCalledWith('/c/load.js');
        expect(importModule).toHaveBeenCalledWith('/c/idle.js');
        expect(importModule).toHaveBeenCalledWith('/c/chart.js');
      } finally {
        Object.assign(globalRecord, {
          IntersectionObserver: originals.IntersectionObserver,
          addEventListener: originals.addEventListener,
          document: originals.document,
          requestIdleCallback: originals.requestIdleCallback,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__jisoInlineImport;
        } else {
          globalRecord.__jisoInlineImport = originals.importModule;
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps enhanced form request targets in parity with modular submit through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: enhanced form headers are part of the always-loaded loader contract.
      const formData = { kind: 'form-data' };
      const form = { action: '/_m/cart/add', method: 'post' };
      const targetDeps = [
        { deps: 'cart', id: 'cart-badge' },
        { deps: 'cart', id: 'cart-badge' },
        { deps: 'inventory, stock', id: 'inventory-panel', target: 'inventory' },
        { deps: 'debug', id: 'empty-fragment-target-fallback', target: '' },
        { deps: '', id: 'standalone-target' },
      ];
      const modularRoot = new InlineParityRoot();
      const modularFetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
        headers: {
          get() {
            return null;
          },
        },
        async text() {
          return '';
        },
      }));
      modularRoot.deps = targetDeps;

      await submitEnhancedMutation({
        fetch: modularFetch,
        form,
        formData,
        idem: 'idem_form_parity',
        root: modularRoot,
        store: createQueryStore(),
      });

      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
      const originals = {
        DOMParser: globalRecord.DOMParser,
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__jisoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const preventDefault = vi.fn();
      const inlineFetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
        async text() {
          return '';
        },
      }));

      try {
        Object.defineProperty(globalThis, 'crypto', {
          configurable: true,
          value: { randomUUID: () => 'idem_form_parity' },
        });
        globalRecord.DOMParser = class DOMParser {
          parseFromString() {
            return {
              querySelectorAll() {
                return [];
              },
            };
          }
        };
        globalRecord.FormData = function FormData() {
          return formData;
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          getElementById() {
            return null;
          },
          querySelector() {
            return null;
          },
          querySelectorAll(selector: string) {
            if (selector !== '[fw-deps]') return [];
            return targetDeps.map((dep) => ({
              getAttribute(name: string) {
                if (name === 'fw-deps') return dep.deps;
                if (name === 'fw-fragment-target') return dep.target ?? null;
                return null;
              },
              id: dep.id,
            }));
          },
        };
        globalRecord.fetch = inlineFetch;

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault,
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? form
                : null;
            },
          },
          type: 'submit',
        });
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(preventDefault).toHaveBeenCalledTimes(1);
        const inlineRequest = inlineFetch.mock.calls[0];
        expect(inlineRequest).toEqual(modularFetch.mock.calls[0]);
        expect(inlineRequest?.[1].headers['FW-Targets']).toBe(
          'cart-badge=cart; inventory=inventory stock; standalone-target',
        );
      } finally {
        Object.assign(globalRecord, {
          DOMParser: originals.DOMParser,
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__jisoInlineImport;
        } else {
          globalRecord.__jisoInlineImport = originals.importModule;
        }
        if (cryptoDescriptor) {
          Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
        } else {
          delete (globalThis as unknown as { crypto?: unknown }).crypto;
        }
      }
    },
  );
});
