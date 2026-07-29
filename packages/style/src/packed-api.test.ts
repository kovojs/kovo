import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const styleRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = join(styleRoot, 'dist');

interface PackedStyleModule {
  readonly attrs: (...styles: readonly unknown[]) => Readonly<Record<string, string>>;
  readonly create: (
    styles: Readonly<Record<string, Readonly<Record<string, string | number>>>>,
  ) => Readonly<Record<string, object>>;
}

interface PackedStyleInternalModule {
  readonly createAtomicStyles: (
    styles: Readonly<Record<string, Readonly<Record<string, string | number>>>>,
    identity?: { readonly namespace?: string; readonly source?: string },
  ) => {
    readonly css: string;
    readonly rules: readonly unknown[];
    readonly styles: Readonly<Record<string, object>>;
  };
}

describe('packed @kovojs/style API', () => {
  it('ships 14 app-facing names, opaque declarations, and instance-bound handles', async () => {
    for (const packageName of ['compiler', 'icons', 'server', 'ui']) {
      const manifest = JSON.parse(
        readFileSync(join(repoRoot, 'packages', packageName, 'package.json'), 'utf8'),
      ) as {
        readonly dependencies?: Readonly<Record<string, string>>;
        readonly peerDependencies?: Readonly<Record<string, string>>;
      };
      expect(manifest.peerDependencies?.['@kovojs/style']).toBe('workspace:*');
      expect(manifest.dependencies?.['@kovojs/style']).toBeUndefined();
    }

    execFileSync('pnpm', ['--filter', '@kovojs/style', 'run', 'build:dist'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });

    const rootDeclaration = readFileSync(join(distRoot, 'index.d.mts'), 'utf8');
    expect(packedRootNames(rootDeclaration)).toEqual([
      'attrs',
      'create',
      'CssValue',
      'defineTheme',
      'DefineThemeOptions',
      'defineVars',
      'keyframes',
      'KovoTheme',
      'StyleHandle',
      'StyleInput',
      'StyleObject',
      'ThemeTokens',
      'tokens',
      'Vars',
    ]);

    const declarations = declarationFiles(distRoot)
      .map((fileName) => readFileSync(fileName, 'utf8'))
      .join('\n');
    for (const forbidden of [
      '$$css',
      'data-style-src',
      '__rules',
      '__styleKey',
      '__theme',
      '__vars',
    ]) {
      expect(declarations).not.toContain(forbidden);
    }
    const styleInput = /type StyleInput = ([^;]+);/u.exec(declarations)?.[1];
    expect(styleInput).toBe('StyleHandle | null | false | undefined | ReadonlyArray<StyleInput>');
    expect(styleInput).not.toContain('[');
    const publicCreateDeclarations =
      declarations.match(/declare function create<const Styles[^;]+;/gu) ?? [];
    expect(publicCreateDeclarations).toHaveLength(1);
    expect(publicCreateDeclarations[0]).not.toMatch(/\b(identity|namespace|source)\b/u);

    const sourceMaps = readdirSync(distRoot)
      .filter((fileName) => fileName.endsWith('.mjs.map'))
      .map(
        (fileName) =>
          JSON.parse(readFileSync(join(distRoot, fileName), 'utf8')) as {
            readonly mappings?: string;
            readonly sources?: readonly string[];
            readonly sourcesContent?: readonly string[];
            readonly version?: number;
          },
      );
    expect(sourceMaps).not.toHaveLength(0);
    expect(sourceMaps.flatMap((map) => map.sources ?? [])).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/src\/engine\.ts$/u),
        expect.stringMatching(/src\/theme\.ts$/u),
      ]),
    );
    for (const sourceMap of sourceMaps) {
      expect(sourceMap.version).toBe(3);
      expect(sourceMap.mappings).not.toBe('');
      expect(sourceMap.sourcesContent).toHaveLength(sourceMap.sources?.length ?? 0);
    }

    const fixtureRoot = mkdtempSync(join(styleRoot, '.tmp-kovo-packed-style-instances-'));
    try {
      const firstRoot = join(fixtureRoot, 'first');
      const secondRoot = join(fixtureRoot, 'second');
      cpSync(distRoot, firstRoot, { recursive: true });
      cpSync(distRoot, secondRoot, { recursive: true });

      const first = (await import(pathToFileURL(join(firstRoot, 'index.mjs')).href)) as
        | PackedStyleModule
        | undefined;
      const second = (await import(pathToFileURL(join(secondRoot, 'index.mjs')).href)) as
        | PackedStyleModule
        | undefined;
      const firstInternal = (await import(
        pathToFileURL(join(firstRoot, 'internal.mjs')).href
      )) as PackedStyleInternalModule;
      const secondInternal = (await import(
        pathToFileURL(join(secondRoot, 'internal.mjs')).href
      )) as PackedStyleInternalModule;
      if (!first || !second) throw new Error('packed style entry failed to load');

      const input = { root: { backgroundColor: 'black', marginTop: 4 } } as const;
      const identity = { namespace: 'card', source: 'card.tsx' } as const;
      const firstStyles = first.create(input);
      const secondStyles = second.create(input);
      const firstHandle = firstStyles.root;
      const secondHandle = secondStyles.root;
      if (!firstHandle || !secondHandle) throw new Error('packed style handle was not created');

      expect(Reflect.ownKeys(firstHandle)).toEqual([]);
      expect(Object.getPrototypeOf(firstHandle)).toBeNull();
      expect(Object.isFrozen(firstHandle)).toBe(true);
      expect(first.attrs(firstHandle)).toEqual(second.attrs(secondHandle));
      expect(() => second.attrs(firstHandle)).toThrow(/different installed copy/u);

      const firstCompiled = firstInternal.createAtomicStyles(input, identity);
      const secondCompiled = secondInternal.createAtomicStyles(input, identity);
      expect(firstCompiled.css).toBe(secondCompiled.css);
      expect(firstCompiled.rules).toEqual(secondCompiled.rules);
      expect(first.attrs(firstCompiled.styles.root)).toEqual(
        second.attrs(secondCompiled.styles.root),
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  }, 120_000);
});

function packedRootNames(declaration: string): readonly string[] {
  const exportList = /export \{([^}]+)\};/u.exec(declaration)?.[1];
  if (!exportList) throw new Error('packed style root has no explicit export list');
  return exportList
    .split(',')
    .map((entry) => entry.trim().replace(/^type /u, ''))
    .sort((left, right) => left.localeCompare(right));
}

function declarationFiles(root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }) as Dirent[];
    for (const entry of entries) {
      const fileName = join(directory, entry.name);
      if (entry.isDirectory()) visit(fileName);
      else if (entry.isFile() && entry.name.endsWith('.d.mts')) files.push(fileName);
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}
