import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { kovoHmrClientSource } from './vite-dev.js';

class FakeElement {
  readonly attributes: Record<string, string> = Object.create(null) as Record<string, string>;

  constructor(attributes: Readonly<Record<string, string>> = {}) {
    const keys = Object.keys(attributes);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      this.attributes[key] = attributes[key]!;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

class FakeNodeList {
  constructor(private readonly values: readonly FakeElement[]) {}

  get length(): number {
    return this.values.length;
  }

  item(index: number): FakeElement | null {
    return this.values[index] ?? null;
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement();

  constructor(
    private readonly buildMeta: FakeElement,
    private readonly targets: readonly FakeElement[],
  ) {}

  createElement(): FakeElement {
    return new FakeElement();
  }

  querySelectorAll(selector: string): FakeNodeList {
    if (selector === ':not(*)') return new FakeNodeList([]);
    if (selector === 'html') return new FakeNodeList([this.documentElement]);
    if (selector === 'meta[name="kovo-build"]') return new FakeNodeList([this.buildMeta]);
    if (selector === '[kovo-deps]') return new FakeNodeList(this.targets);
    return new FakeNodeList([]);
  }
}

describe('Vite HMR browser target producer security', () => {
  it('uses boot-captured dense controls after DOM, iterator, Array, and Set poisoning', async () => {
    const buildMeta = new FakeElement({ content: 'build-before', name: 'kovo-build' });
    const targets: FakeElement[] = [
      new FakeElement({
        'kovo-deps': 'public, inventory',
        'kovo-fragment-target': 'catalog-panel',
        'kovo-live-component': 'components/public/catalog',
        'kovo-live-token': 'tok_catalog',
        'kovo-props':
          '{"3":683,"013":{"x":1},"a":2,"del":"\u007f","label":"😀 漢字","line":"\u2028\u2029"}',
      }),
      new FakeElement({
        'kovo-deps': 'public',
        'kovo-fragment-target': 'unattested-panel',
      }),
    ];
    for (let index = 0; index < 70; index += 1) {
      targets.push(
        new FakeElement({
          'kovo-deps': `query-${index}`,
          'kovo-fragment-target': `extra-panel-${index}`,
          'kovo-live-token': `tok_extra_${index}`,
        }),
      );
    }
    const document = new FakeDocument(buildMeta, targets);
    const hotHandlers = Object.create(null) as Record<string, (event: unknown) => void>;
    let applied = '';
    let poisonHits = 0;
    let reloads = 0;
    let request: { options: { headers: Record<string, string> }; url: string } | undefined;
    const context = {
      Document: FakeDocument,
      Element: FakeElement,
      NodeList: FakeNodeList,
      URL,
      __createHotContext: () => ({
        on(name: string, handler: (event: unknown) => void) {
          hotHandlers[name] = handler;
        },
      }),
      __kovo_a(value: string) {
        applied = value;
      },
      __poisonHit() {
        poisonHits += 1;
      },
      document,
      async fetch(url: URL, options: { headers: Record<string, string> }) {
        new Headers(options.headers);
        request = { options, url: String(url) };
        return {
          headers: {
            get(name: string) {
              if (name === 'Kovo-Previous-Build') return 'build-before';
              if (name === 'Kovo-Build') return 'build-after';
              return null;
            },
          },
          ok: true,
          async text() {
            return '<kovo-fragment target="catalog-panel">updated</kovo-fragment>';
          },
        };
      },
      location: {
        origin: 'https://kovo.test',
        pathname: '/catalog',
        reload() {
          reloads += 1;
        },
        search: '?page=1',
      },
    };
    const inheritedToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const functionToString = Object.getOwnPropertyDescriptor(Function.prototype, 'toString');
    if (!functionToString) throw new Error('Function.prototype.toString descriptor unavailable');
    let sourcePoisonHits = 0;
    let rawSource = '';
    try {
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value() {
          sourcePoisonHits += 1;
          return { maxEntries: 1, maxHeaderCharacters: 1 };
        },
      });
      Object.defineProperty(Function.prototype, 'toString', {
        ...functionToString,
        value() {
          sourcePoisonHits += 1;
          return 'function () { globalThis.__poisonHit(); }';
        },
      });
      rawSource = kovoHmrClientSource();
    } finally {
      Object.defineProperty(Function.prototype, 'toString', functionToString);
      if (inheritedToJson) {
        Object.defineProperty(Object.prototype, 'toJSON', inheritedToJson);
      } else {
        delete (Object.prototype as { toJSON?: unknown }).toJSON;
      }
    }
    expect(sourcePoisonHits).toBe(0);
    const source = rawSource.replace(
      'import { createHotContext } from "/@vite/client";',
      'const createHotContext = globalThis.__createHotContext;',
    );
    runInNewContext(source, context);
    runInNewContext(
      `
const dqs = Object.getOwnPropertyDescriptor(Document.prototype, "querySelectorAll");
const ega = Object.getOwnPropertyDescriptor(Element.prototype, "getAttribute");
const esa = Object.getOwnPropertyDescriptor(Element.prototype, "setAttribute");
const A = Array;
const arrayGlobal = Object.getOwnPropertyDescriptor(globalThis, "Array");
const aiter = Object.getOwnPropertyDescriptor(A.prototype, Symbol.iterator);
const ae = Object.getOwnPropertyDescriptor(A.prototype, "every");
const af = Object.getOwnPropertyDescriptor(A.prototype, "filter");
const am = Object.getOwnPropertyDescriptor(A.prototype, "map");
const ap = Object.getOwnPropertyDescriptor(A.prototype, "push");
const asl = Object.getOwnPropertyDescriptor(A.prototype, "slice");
const sa = Object.getOwnPropertyDescriptor(Set.prototype, "add");
const sh = Object.getOwnPropertyDescriptor(Set.prototype, "has");
const sv = Object.getOwnPropertyDescriptor(Set.prototype, "values");
const poison = () => { globalThis.__poisonHit(); throw new Error("late HMR poison reached"); };
Object.defineProperty(Document.prototype, "querySelectorAll", { ...dqs, value: poison });
Object.defineProperty(Element.prototype, "getAttribute", { ...ega, value: poison });
Object.defineProperty(Element.prototype, "setAttribute", { ...esa, value: poison });
Object.defineProperty(A.prototype, Symbol.iterator, { ...aiter, value: poison });
Object.defineProperty(A.prototype, "every", { ...ae, value: poison });
Object.defineProperty(A.prototype, "filter", { ...af, value: poison });
Object.defineProperty(A.prototype, "map", { ...am, value: poison });
Object.defineProperty(A.prototype, "push", { ...ap, value: poison });
Object.defineProperty(A.prototype, "slice", { ...asl, value: poison });
Object.defineProperty(Set.prototype, "add", { ...sa, value: poison });
Object.defineProperty(Set.prototype, "has", { ...sh, value: poison });
Object.defineProperty(Set.prototype, "values", { ...sv, value: poison });
Object.defineProperty(globalThis, "Array", { configurable: true, get: poison });
globalThis.__restoreHmrControls = () => {
  Object.defineProperty(globalThis, "Array", arrayGlobal);
  Object.defineProperty(Document.prototype, "querySelectorAll", dqs);
  Object.defineProperty(Element.prototype, "getAttribute", ega);
  Object.defineProperty(Element.prototype, "setAttribute", esa);
  Object.defineProperty(A.prototype, Symbol.iterator, aiter);
  Object.defineProperty(A.prototype, "every", ae);
  Object.defineProperty(A.prototype, "filter", af);
  Object.defineProperty(A.prototype, "map", am);
  Object.defineProperty(A.prototype, "push", ap);
  Object.defineProperty(A.prototype, "slice", asl);
  Object.defineProperty(Set.prototype, "add", sa);
  Object.defineProperty(Set.prototype, "has", sh);
  Object.defineProperty(Set.prototype, "values", sv);
};
`,
      context,
    );

    try {
      hotHandlers['kovo:component-render']?.({ oldFactHash: 'old-fact' });
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      runInNewContext('globalThis.__restoreHmrControls();', context);
    }

    expect(poisonHits).toBe(0);
    expect(reloads).toBe(0);
    expect(applied).toContain('catalog-panel');
    expect(buildMeta.getAttribute('content')).toBe('build-after');
    expect(request?.url).toContain('/@kovo/hmr/refresh/live-targets');
    const live = request?.options.headers['Kovo-Live-Targets'] ?? '';
    const dependencies = request?.options.headers['Kovo-Targets'] ?? '';
    expect(live.split('; ')).toHaveLength(64);
    expect(live.split('; ')[0]).toBe(
      'catalog-panel#components/public/catalog@tok_catalog:{"3":683,"013":{"x":1},"a":2,"del":"\\u007f","label":"\\ud83d\\ude00 \\u6f22\\u5b57","line":"\\u2028\\u2029"}',
    );
    expect(live).not.toContain('unattested-panel');
    expect(dependencies.split('; ')).toHaveLength(64);
    expect(dependencies.split('; ').slice(0, 2)).toEqual([
      'catalog-panel=public inventory',
      'unattested-panel=public',
    ]);
  });
});
