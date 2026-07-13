import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type ExampleDrizzleRegistryVitePlugin = {
  configResolved(config: { root: string }): void;
  enforce: 'pre';
  load(id: string): string | undefined;
  name: 'kovo-example-drizzle-registry';
  resolveId(id: string): string | undefined;
  transform(code: string, id: string): { code: string; map: null } | undefined;
};

interface ExampleDrizzleRegistryPluginOptions {
  appEntries: readonly string[];
  mutationTouchGraphKeys?: Readonly<Record<string, string>>;
  sourceRoot: string;
}

/** Root-workspace registry fixture plugin; deliberately has no compiler-authority dependency. */
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

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/[?#].*$/, '');
}

function insertAfterJsxImportSourcePragma(source: string, insertion: string): string {
  const pragma = /^\/\*\* @jsxImportSource [\s\S]*?\*\/\s*/.exec(source);
  if (!pragma) return `${insertion}${source}`;
  return `${source.slice(0, pragma[0].length)}${insertion}${source.slice(pragma[0].length)}`;
}
