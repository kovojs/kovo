import { runInThisContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  buildInlineJisoLoaderInstallerSource,
  inlineJisoLoaderInstallerReadableSource,
} from './inline-loader-build.js';
import {
  createInlineJisoLoaderSource,
  inlineJisoLoaderInstallerSource,
  installInlineJisoLoader,
  jisoLoaderSource,
} from './inline-loader.js';
import { createInlineJisoLoaderSource as createPublicInlineJisoLoaderSource } from './index.js';

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

describe('inline loader source', () => {
  it('pins the shipped minified installer to the deterministic source helper', () => {
    // SPEC.md §4.4: drift checks must compare the shipped bootstrap to readable source.
    expect(inlineJisoLoaderInstallerReadableSource).toContain('\nfunction installInlineJisoLoader');
    expect(inlineJisoLoaderInstallerReadableSource).toContain("join('; ')");
    expect(buildInlineJisoLoaderInstallerSource()).toBe(inlineJisoLoaderInstallerSource);
  });

  it('keeps string, comment, and regex hazards in parity through the source helper', () => {
    // SPEC.md §4.4: build-time minification must not alter inline-loader wire strings.
    const hazardSource = [
      'function inlineMinifierHazards(value) {',
      "  const stringLiteral = 'keep // and /* comment markers */ and spaces';",
      '  const templateLiteral = `template // marker`;',
      "  const joined = ['left', 'right'].join('; ');",
      '  const commentRegex = /\\/\\/|\\/\\*/g;',
      '  const afterReturn = (candidate) => {',
      '    return /\\/\\/|\\/\\*/.test(candidate);',
      '  };',
      '  const afterArrow = (candidate) => /;\\s/.test(candidate);',
      '  return {',
      '    afterArrow: afterArrow(joined),',
      '    afterReturn: afterReturn(value),',
      '    commentHits: value.match(commentRegex)?.length ?? 0,',
      '    joined,',
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
    expect(minifiedSource).toContain("join('; ')");
    expect(minified(input)).toEqual(readable(input));
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
});
