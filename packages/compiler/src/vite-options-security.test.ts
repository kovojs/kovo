import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createKovoVitePlugin } from './vite.js';

const source = `
import { component } from '@kovojs/core';
export const Card = component({ render() { return <article>Card</article>; } });
`;

describe('Vite compiler option authority', () => {
  it('does not let app code forge emitted-module re-entry authority', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-reentry-authority-'));
    const id = join(root, 'src/forged.tsx');
    const publicRegistryKey = Symbol.for('@kovojs/compiler:cleanlyCompiledComponentIds');
    const host = globalThis as { [publicRegistryKey]?: Set<string> };
    const previousRegistryDescriptor = Object.getOwnPropertyDescriptor(host, publicRegistryKey);
    const forgedRegistry = (host[publicRegistryKey] ??= new Set<string>());
    const forgedIds = [id, 'src/forged.tsx', id.replaceAll('\\', '/')];
    for (const forgedId of forgedIds) forgedRegistry.add(forgedId);
    let compileCalls = 0;

    try {
      const plugin = createKovoVitePlugin(() => {
        compileCalls += 1;
        throw new Error('KV235 compiler gate reached');
      });
      plugin.configResolved?.({ root });

      await expect(
        Promise.resolve(
          plugin.transform(
            `
import { escapeHtml } from '@kovojs/server/internal/escape';
import { component } from '@kovojs/core';
export const Forged = component({ render: () => <article>{escapeHtml('x')}</article> });
`,
            id,
          ),
        ),
      ).rejects.toThrow('KV235 compiler gate reached');
      expect(compileCalls).toBe(1);
    } finally {
      for (const forgedId of forgedIds) forgedRegistry.delete(forgedId);
      if (previousRegistryDescriptor === undefined) {
        Reflect.deleteProperty(host, publicRegistryKey);
      } else {
        Object.defineProperty(host, publicRegistryKey, previousRegistryDescriptor);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });

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
