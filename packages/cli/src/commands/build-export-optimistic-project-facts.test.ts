import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { parseVersionedClientModuleTarget } from '@kovojs/core/internal/client-module-url';
import { describe, expect, it } from 'vitest';

import { projectMutationRegistryFactsForBuild } from './build-export.js';

const repoRoot = process.cwd();

describe('kovo build optimistic project facts', () => {
  it('preserves compiler-authenticated plans while remapping their immutable build identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-optimistic-facts-'));
    const sourceRoot = join(root, 'appsrc');
    try {
      linkPackage(root, '@kovojs/server', join(repoRoot, 'packages/server'));
      const contractSource = [
        "import { defineKovo } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000002',",
        '});',
        '',
      ].join('\n');
      const querySource = [
        "import { app } from './kovo.js';",
        'export const cartQuery = app.query({ load() { return { count: 0 }; } });',
        '',
      ].join('\n');
      const mutationSource = [
        "import { s } from '@kovojs/server';",
        "import { app } from './kovo.js';",
        "import { cartQuery } from './queries.js';",
        'const addInput = s.object({ quantity: s.number() });',
        'export const add = app.mutation({',
        '  input: addInput,',
        '  optimistic: [',
        '    cartQuery.optimistic(addInput, (cart, input) => ({',
        '      ...cart,',
        '      count: cart.count + input.quantity,',
        '    })),',
        '  ],',
        '  handler() {},',
        '});',
        '',
      ].join('\n');
      const formSource = [
        "import { add } from './mutations.js';",
        'export const binding = add;',
        '',
      ].join('\n');
      const sources = [
        { fileName: 'kovo.ts', source: contractSource },
        { fileName: 'queries.ts', source: querySource },
        { fileName: 'mutations.ts', source: mutationSource },
        { fileName: 'form.tsx', source: formSource },
      ] as const;
      for (const file of sources) writeSource(join(sourceRoot, file.fileName), file.source);

      const facts = projectMutationRegistryFactsForBuild(
        join(sourceRoot, 'form.tsx'),
        root,
        sources,
        sourceRoot,
      );

      const mutationKey = Object.keys(facts.mutationOptimism ?? {})[0];
      expect(mutationKey).toMatch(/mutations\/add$/u);
      const optimism = mutationKey ? facts.mutationOptimism?.[mutationKey] : undefined;
      expect(optimism?.moduleHref).toMatch(
        /^\/c\/__v\/[a-f0-9]{64}\/appsrc\/mutations\.client\.js$/u,
      );
      expect(optimism?.inputFields).toEqual([
        expect.objectContaining({
          coercion: 'number',
          name: 'quantity',
          source: expect.objectContaining({ fileName: 'appsrc/mutations.ts' }),
        }),
      ]);
      expect(facts.optimisticModules).toEqual([
        expect.objectContaining({
          fileName: 'appsrc/mutations.ts',
          href: optimism?.moduleHref,
          path: parseVersionedClientModuleTarget(optimism!.moduleHref)?.path,
          source: expect.stringContaining('export const kovoOptimisticMutationPlans'),
        }),
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function linkPackage(root: string, name: string, target: string): void {
  const link = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, 'dir');
}

function writeSource(fileName: string, source: string): void {
  mkdirSync(dirname(fileName), { recursive: true });
  writeFileSync(fileName, source, 'utf8');
}
