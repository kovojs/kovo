import { describe, expect, it, vi } from 'vitest';

import { inlineSourceInstallCases } from './inline-loader-test-utils.js';

describe('inline loader enhanced navigation fallback', () => {
  it.each(inlineSourceInstallCases)(
    'leaves ineligible anchor clicks native through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        history: globalRecord.history,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
        setTimeout: globalRecord.setTimeout,
      };
      const listeners = new Map<string, (event: unknown) => Promise<void>>();
      const fetch = vi.fn();

      try {
        globalRecord.addEventListener = (
          type: string,
          listener: (event: unknown) => Promise<void>,
        ) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelectorAll: () => [],
        };
        globalRecord.fetch = fetch;
        globalRecord.history = {};
        globalRecord.location = {
          href: 'http://app.test/products',
          origin: 'http://app.test',
          pathname: '/products',
          search: '',
        };
        globalRecord.setTimeout = vi.fn();

        installSource(async () => ({}), globalRecord);

        const dispatch = async (
          anchor: { hasAttribute?: (name: string) => boolean; href: string; target?: string },
          eventOptions: Record<string, unknown> = {},
          closestOnClick: unknown = null,
        ) => {
          const preventDefault = vi.fn();
          const target = {
            closest(selector: string) {
              if (selector === 'a[href]') return anchor;
              if (selector === '[on\\:click]') return closestOnClick;
              return null;
            },
          };
          await listeners.get('click')?.({
            button: 0,
            defaultPrevented: false,
            preventDefault,
            target,
            type: 'click',
            ...eventOptions,
          });
          return preventDefault;
        };

        await expect(
          dispatch({ href: 'https://example.com/out', target: '' }),
        ).resolves.not.toHaveBeenCalled();
        await expect(
          dispatch({ href: 'http://app.test/cart', target: '' }, { metaKey: true }),
        ).resolves.not.toHaveBeenCalled();
        await expect(
          dispatch({ href: 'http://app.test/cart', target: '_blank' }),
        ).resolves.not.toHaveBeenCalled();
        await expect(
          dispatch({ hasAttribute: (name) => name === 'download', href: 'http://app.test/file' }),
        ).resolves.not.toHaveBeenCalled();
        await expect(
          dispatch({ href: 'http://app.test/products#details', target: '' }),
        ).resolves.not.toHaveBeenCalled();
        await expect(
          dispatch({ href: 'http://app.test/cart', target: '' }, {}, { getAttribute: () => null }),
        ).resolves.not.toHaveBeenCalled();

        expect(fetch).not.toHaveBeenCalled();
      } finally {
        Object.assign(globalRecord, {
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
          history: originals.history,
          location: originals.location,
          setTimeout: originals.setTimeout,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'falls back to native navigation on build-token mismatch through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        addEventListener: globalRecord.addEventListener,
        CustomEvent: globalRecord.CustomEvent,
        dispatchEvent: globalRecord.dispatchEvent,
        document: globalRecord.document,
        DOMParser: globalRecord.DOMParser,
        fetch: globalRecord.fetch,
        history: globalRecord.history,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
        setTimeout: globalRecord.setTimeout,
      };
      const listeners = new Map<string, (event: unknown) => Promise<void>>();
      const assign = vi.fn();
      const preventDefault = vi.fn();
      const anchor = {
        hasAttribute: () => false,
        href: 'http://app.test/cart',
        target: '',
      };
      const target = {
        closest(selector: string) {
          if (selector === 'a[href]') return anchor;
          return null;
        },
      };

      try {
        globalRecord.addEventListener = (
          type: string,
          listener: (event: unknown) => Promise<void>,
        ) => {
          listeners.set(type, listener);
        };
        globalRecord.CustomEvent = class TestCustomEvent {
          constructor(
            readonly type: string,
            readonly init?: unknown,
          ) {}
        };
        globalRecord.dispatchEvent = vi.fn();
        globalRecord.document = {
          body: {},
          querySelector(selector: string) {
            if (selector === 'meta[name="kovo-build"]') {
              return { getAttribute: () => 'build-a' };
            }
            return null;
          },
          querySelectorAll: () => [],
        };
        globalRecord.DOMParser = class TestDOMParser {
          parseFromString() {
            return {
              body: {},
              querySelector(selector: string) {
                if (selector === 'meta[name="kovo-build"]') {
                  return { getAttribute: () => 'build-b' };
                }
                return null;
              },
            };
          }
        };
        globalRecord.fetch = vi.fn(async () => ({
          headers: { get: () => 'text/html' },
          text: async () => '<!doctype html><html></html>',
          url: 'http://app.test/cart',
        }));
        globalRecord.history = { pushState: vi.fn() };
        globalRecord.location = {
          assign,
          href: 'http://app.test/products',
          origin: 'http://app.test',
          pathname: '/products',
          search: '',
        };
        globalRecord.setTimeout = vi.fn();

        installSource(async () => ({}), globalRecord);
        await listeners.get('click')?.({
          button: 0,
          defaultPrevented: false,
          preventDefault,
          target,
          type: 'click',
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
          expect(assign).toHaveBeenCalledWith('http://app.test/cart');
        });
      } finally {
        Object.assign(globalRecord, {
          addEventListener: originals.addEventListener,
          CustomEvent: originals.CustomEvent,
          dispatchEvent: originals.dispatchEvent,
          document: originals.document,
          DOMParser: originals.DOMParser,
          fetch: originals.fetch,
          history: originals.history,
          location: originals.location,
          setTimeout: originals.setTimeout,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }
    },
  );
});
