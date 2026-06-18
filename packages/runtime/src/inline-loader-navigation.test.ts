import { describe, expect, it, vi } from 'vitest';

import { inlineSourceInstallCases } from './inline-loader-test-utils.js';

class TestNavSegment {
  constructor(
    private readonly attributes: Record<string, string>,
    readonly outerHTML: string,
  ) {}

  cloneNode(): { outerHTML: string; querySelectorAll(): never[] } {
    return {
      outerHTML: this.outerHTML,
      querySelectorAll: () => [],
    };
  }

  focus(): void {}

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  querySelectorAll(): never[] {
    return [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

function createTestShell({
  build = 'build-a',
  bodyAttributes = {},
  documentAttributes = {},
  head = '',
  replaceWith,
  segments,
}: {
  bodyAttributes?: Record<string, string>;
  build?: string;
  documentAttributes?: Record<string, string>;
  head?: string;
  replaceWith?: (body: unknown) => void;
  segments: TestNavSegment[];
}) {
  const attrs = (values: Record<string, string>) => ({
    attributes: Object.entries(values).map(([name, value]) => ({ name, value })),
    hasAttribute(name: string) {
      return Object.hasOwn(values, name);
    },
    removeAttribute(name: string) {
      delete values[name];
      this.attributes = this.attributes.filter((attr) => attr.name !== name);
    },
    setAttribute(name: string, value: string) {
      values[name] = value;
      const attr = this.attributes.find((entry) => entry.name === name);
      if (attr) attr.value = value;
      else this.attributes.push({ name, value });
    },
  });
  const body = {
    ...attrs(bodyAttributes),
    querySelectorAll(selector: string) {
      return selector === '[kovo-nav-segment]' ? segments : [];
    },
    replaceWith(nextBody: unknown) {
      replaceWith?.(nextBody);
    },
  };
  return {
    body,
    documentElement: attrs(documentAttributes),
    head: { innerHTML: head },
    querySelector(selector: string) {
      if (selector === 'meta[name="kovo-build"]') return { getAttribute: () => build };
      if (selector === 'main,[kovo-nav-segment],h1') return segments[0] ?? null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

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

  it.each(inlineSourceInstallCases)(
    'falls back to native navigation on non-html responses through %s',
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
      const assign = vi.fn();
      const preventDefault = vi.fn();
      const anchor = {
        hasAttribute: () => false,
        href: 'http://app.test/download.csv',
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
        globalRecord.document = {
          querySelectorAll: () => [],
        };
        globalRecord.fetch = vi.fn(async () => ({
          headers: { get: () => 'text/csv' },
          text: async () => 'id,total\n1,42\n',
          url: 'http://app.test/download.csv',
        }));
        globalRecord.history = {};
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
          expect(assign).toHaveBeenCalledWith('http://app.test/download.csv');
        });
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
    'replaces the document body from target-document layout divergence through %s',
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
        scrollTo: globalRecord.scrollTo,
        setTimeout: globalRecord.setTimeout,
      };
      const listeners = new Map<string, (event: unknown) => Promise<void>>();
      const preventDefault = vi.fn();
      const pushState = vi.fn();
      const replaceWith = vi.fn();
      let currentDocument: ReturnType<typeof createTestShell>;
      const currentLayout = new TestNavSegment(
        {
          'kovo-nav-components': '',
          'kovo-nav-kind': 'layout',
          'kovo-nav-name': 'Shop',
          'kovo-nav-queries': '',
          'kovo-nav-segment': 'layout:Shop',
        },
        '<main><nav>Old</nav></main>',
      );
      const targetLayout = new TestNavSegment(
        {
          'kovo-nav-components': '',
          'kovo-nav-kind': 'layout',
          'kovo-nav-name': 'Shop',
          'kovo-nav-queries': '',
          'kovo-nav-segment': 'layout:Shop',
        },
        '<main><nav>New</nav></main>',
      );
      const targetDocument = createTestShell({
        head: '<title>Cart</title>',
        segments: [targetLayout],
      });

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
        currentDocument = createTestShell({
          replaceWith: (nextBody) => {
            replaceWith(nextBody);
            currentDocument.body = nextBody as typeof currentDocument.body;
          },
          segments: [currentLayout],
        });
        globalRecord.document = currentDocument;
        globalRecord.DOMParser = class TestDOMParser {
          parseFromString() {
            return targetDocument;
          }
        };
        globalRecord.fetch = vi.fn(async () => ({
          headers: { get: () => 'text/html' },
          text: async () => '<!doctype html><html></html>',
          url: 'http://app.test/cart',
        }));
        globalRecord.history = { pushState };
        globalRecord.location = {
          href: 'http://app.test/products',
          origin: 'http://app.test',
          pathname: '/products',
          search: '',
        };
        globalRecord.scrollTo = vi.fn();
        globalRecord.setTimeout = vi.fn();

        installSource(async () => ({}), globalRecord);
        await listeners.get('click')?.({
          button: 0,
          defaultPrevented: false,
          preventDefault,
          target: {
            closest(selector: string) {
              if (selector === 'a[href]') {
                return { hasAttribute: () => false, href: 'http://app.test/cart', target: '' };
              }
              return null;
            },
          },
          type: 'click',
        });

        await vi.waitFor(() => {
          expect(replaceWith).toHaveBeenCalledWith(targetDocument.body);
        });
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(pushState).toHaveBeenCalledWith({}, '', 'http://app.test/cart');
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
          scrollTo: originals.scrollTo,
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
