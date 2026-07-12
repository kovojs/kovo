import { describe, expect, it } from 'vitest';

import {
  kovoServerHandlerEntrySource,
  serializeBuildRuntimeRegistryWireModule,
} from './build-export.js';

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
});
