import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { kovoVitePlugin } from '../packages/compiler/src/vite-config.ts';
import type { KovoVitePlugin } from '../packages/compiler/src/vite.ts';
import type { KovoVitePluginOptions } from '../packages/compiler/src/vite.ts';
import type { RegistryFacts } from '../packages/compiler/src/types.ts';

type KovoVitePrePlugin = KovoVitePlugin & { enforce: 'pre' };
type ExampleDrizzleRegistryVitePlugin = {
  configResolved(config: { root: string }): void;
  enforce: 'pre';
  load(id: string): string | undefined;
  name: 'kovo-example-drizzle-registry';
  resolveId(id: string): string | undefined;
  transform(code: string, id: string): { code: string; map: null } | undefined;
};

export function exampleKovoCompilerPlugin(options: KovoVitePluginOptions): KovoVitePrePlugin {
  return Object.assign(kovoVitePlugin(options), { enforce: 'pre' as const });
}

interface ExampleDrizzleRegistryPluginOptions {
  appEntries: readonly string[];
  mutationTouchGraphKeys?: Readonly<Record<string, string>>;
  sourceRoot: string;
}

export function exampleDrizzleRegistryPlugin(
  options: ExampleDrizzleRegistryPluginOptions,
): ExampleDrizzleRegistryVitePlugin {
  const publicVirtualId = `virtual:kovo-example-drizzle-registry:${options.sourceRoot}`;
  const resolvedVirtualId = `\0${publicVirtualId}`;
  const runtimeModule = normalizePath(
    resolve(dirname(fileURLToPath(import.meta.url)), 'drizzle-registry-runtime.ts'),
  );
  let appEntries = new Set<string>();
  let sourceRoot = '';

  return {
    name: 'kovo-example-drizzle-registry',
    enforce: 'pre',
    configResolved(config) {
      sourceRoot = resolve(config.root, options.sourceRoot);
      appEntries = new Set(
        options.appEntries.map((entry) => normalizePath(resolve(config.root, entry))),
      );
    },
    resolveId(id) {
      if (id === publicVirtualId) return resolvedVirtualId;
      return undefined;
    },
    load(id) {
      if (id !== resolvedVirtualId) return undefined;
      return [
        `import { registerExampleDrizzleRegistries } from ${JSON.stringify(
          `/@fs/${runtimeModule}`,
        )};`,
        `registerExampleDrizzleRegistries(${JSON.stringify({
          mutationTouchGraphKeys: options.mutationTouchGraphKeys ?? {},
          sourceRoot,
        })});`,
        '',
      ].join('\n');
    },
    transform(code, id) {
      if (!appEntries.has(normalizePath(id))) return undefined;
      const virtualImport = `import ${JSON.stringify(publicVirtualId)};\n`;
      return {
        code: insertAfterJsxImportSourcePragma(code, virtualImport),
        map: null,
      };
    },
  };
}

export function commerceKovoCompilerPlugin(): KovoVitePrePlugin {
  return exampleKovoCompilerPlugin({
    include: ['src/components'],
    registryFacts: commerceRegistryFacts,
  });
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/[?#].*$/, '');
}

function insertAfterJsxImportSourcePragma(source: string, insertion: string): string {
  const pragma = /^\/\*\* @jsxImportSource [\s\S]*?\*\/\s*/.exec(source);
  if (!pragma) return `${insertion}${source}`;
  return `${source.slice(0, pragma[0].length)}${insertion}${source.slice(pragma[0].length)}`;
}

function requiredString(name: string) {
  return {
    coercion: 'string' as const,
    defaulted: false,
    name,
    optional: false,
    provenance: 'registry' as const,
    required: true,
  };
}

export const commerceRegistryFacts = {
  mutationInputs: {
    'cart/add': [
      requiredString('productId'),
      {
        coercion: 'number' as const,
        defaulted: true,
        name: 'quantity',
        optional: false,
        provenance: 'registry' as const,
        required: false,
      },
    ],
  },
  mutations: { 'cart/add': 'typeof addToCart' },
} satisfies RegistryFacts;
