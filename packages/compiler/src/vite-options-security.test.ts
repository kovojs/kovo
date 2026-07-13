import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createKovoVitePlugin } from './vite.js';

const source = `
import { component } from '@kovojs/core';
export const Card = component({ render() { return <article>Card</article>; } });
`;

describe('Vite compiler option authority', () => {
  it('rejects plugin option accessors without invoking them', () => {
    let reads = 0;
    expect(() =>
      createKovoVitePlugin(() => ({ diagnostics: [], files: [] }), {
        get cache() {
          reads += 1;
          return false;
        },
      }),
    ).toThrow(/cache.*changed while/u);
    expect(reads).toBe(0);
  });

  it('does not dispatch plugin snapshots through inherited option setters', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'cache');
    let poisonHits = 0;
    try {
      Object.defineProperty(Object.prototype, 'cache', {
        configurable: true,
        set() {
          poisonHits += 1;
        },
      });
      expect(() =>
        createKovoVitePlugin(() => ({ diagnostics: [], files: [] }), { cache: false }),
      ).not.toThrow();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, 'cache');
      else Object.defineProperty(Object.prototype, 'cache', descriptor);
    }
    expect(poisonHits).toBe(0);
  });

  it('uses one pinned compile carrier across persistent lookup and compilation', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-option-authority-'));
    const prefixes = [{ packageName: '@example/ui', prefix: 'reviewed-' }];
    let compiledPrefix: string | null | undefined;
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      const plugin = createKovoVitePlugin(
        (options) => {
          compiledPrefix = options.packageComponentPrefixes?.[0]?.prefix;
          return { diagnostics: [], files: [{ kind: 'server', source: 'export {};\n' }] };
        },
        { packageComponentPrefixes: prefixes },
      );
      plugin.configResolved?.({ root });

      const pending = plugin.transform(source, join(root, 'src/card.tsx'));
      prefixes[0]!.prefix = 'substituted-';
      await pending;

      expect(compiledPrefix).toBe('reviewed-');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
