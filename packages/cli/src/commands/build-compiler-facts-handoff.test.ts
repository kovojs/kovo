import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { compileComponentModule } from '@kovojs/compiler';
import { describe, expect, it } from 'vitest';

import {
  adoptKovoBuildCompilerFactsForTests,
  projectMutationRegistryFactsForBuild,
  projectMutationRegistryFactsFromCompilerFactsForTests,
  snapshotKovoBuildCompilerFactsForTests,
  type KovoBuildCompilerFacts,
} from './build-export.js';

const repoRoot = process.cwd();

describe('build compiler-facts handoff', () => {
  it('binds the versioned capsule to exact source paths, digests, and spans', () => {
    withCompilerFactProject(({ sourceRoot, sources }) => {
      const facts = snapshotKovoBuildCompilerFactsForTests(sources, sourceRoot);

      expect(facts.schema).toBe('kovo-build-compiler-facts/v2');
      expect(adoptKovoBuildCompilerFactsForTests(facts, sources)).toEqual(facts);
      expect(facts.appContractStaticFacts.length).toBeGreaterThan(0);
      expect(facts.appContractStaticFacts.every((fact) => !Object.hasOwn(fact, 'source'))).toBe(
        true,
      );
      expect(facts.projectMutationFacts.mutationBindings.length).toBeGreaterThan(0);
      expect(facts.projectMutationFacts.requiresOptimisticModuleDerivation).toBe(true);
      expect(Object.keys(facts.projectMutationFacts).sort()).toEqual([
        'mutationBindings',
        'mutationInputs',
        'requiresOptimisticModuleDerivation',
      ]);
      expect(JSON.stringify(facts)).not.toContain('kovoOptimisticMutationPlans');
      expect(JSON.stringify(facts)).not.toContain('@kovojs/compiler-ir');

      const staleDigest = cloneFacts(facts);
      staleDigest.frameworkIdentityFacts[0]!.sourceDigest = `sha256:${'0'.repeat(64)}`;
      expect(() => adoptKovoBuildCompilerFactsForTests(staleDigest, sources)).toThrow(
        /stale source digest/u,
      );

      const missing = cloneFacts(facts);
      missing.frameworkIdentityFacts.pop();
      expect(() => adoptKovoBuildCompilerFactsForTests(missing, sources)).toThrow(/omitted/u);

      const duplicate = cloneFacts(facts);
      duplicate.frameworkIdentityFacts[1] = { ...duplicate.frameworkIdentityFacts[0]! };
      expect(() => adoptKovoBuildCompilerFactsForTests(duplicate, sources)).toThrow(/duplicate/u);

      const wrongPath = cloneFacts(facts);
      wrongPath.frameworkIdentityFacts[0]!.fileName = 'wrong.ts';
      expect(() => adoptKovoBuildCompilerFactsForTests(wrongPath, sources)).toThrow(
        /stale source digest or path/u,
      );

      const wrongSpan = cloneFacts(facts);
      const spanFact = wrongSpan.appContractStaticFacts[0]!;
      spanFact.end =
        sources.reduce((largest, source) => Math.max(largest, source.source.length), 0) + 1;
      expect(() => adoptKovoBuildCompilerFactsForTests(wrongSpan, sources)).toThrow(
        /invalid app-contract fact/u,
      );

      const duplicatedSource = cloneFacts(facts);
      Object.assign(duplicatedSource.appContractStaticFacts[0]!, {
        source: sources[0]!.source,
      });
      expect(() => adoptKovoBuildCompilerFactsForTests(duplicatedSource, sources)).toThrow(
        /unsupported field/u,
      );

      const mutationPath = cloneFacts(facts);
      mutationPath.projectMutationFacts.mutationBindings[0]!.fileName = 'outside.tsx';
      expect(() => adoptKovoBuildCompilerFactsForTests(mutationPath, sources)).toThrow(
        /invalid mutation binding/u,
      );

      const executableOptimism = cloneFacts(facts);
      Object.assign(executableOptimism.projectMutationFacts, {
        optimisticModules: [
          {
            fileName: 'mutations.ts',
            href: '/c/__v/forged/mutations.client.js',
            mutationKeys: ['forged'],
            path: 'mutations.client.js',
            source: 'export const kovoOptimisticMutationPlans = {};',
          },
        ],
      });
      expect(() => adoptKovoBuildCompilerFactsForTests(executableOptimism, sources)).toThrow(
        /unsupported field/u,
      );

      const loweredIr = cloneFacts(facts);
      Object.assign(loweredIr.projectMutationFacts, {
        loweredSource: '/* @kovojs/compiler-ir */ export default null;',
      });
      expect(() => adoptKovoBuildCompilerFactsForTests(loweredIr, sources)).toThrow(
        /unsupported field/u,
      );
    });
  });

  it('projects authenticated pure facts to byte-identical compiler output', () => {
    withCompilerFactProject(({ sourceRoot, sources }) => {
      const appModulePath = join(sourceRoot, 'form.tsx');
      const compilerFacts = snapshotKovoBuildCompilerFactsForTests(sources, sourceRoot);
      const legacy = projectMutationRegistryFactsForBuild(
        appModulePath,
        sourceRoot,
        sources,
        sourceRoot,
      );
      const projected = projectMutationRegistryFactsFromCompilerFactsForTests(
        appModulePath,
        sourceRoot,
        sources,
        compilerFacts,
        sourceRoot,
      );
      expect(projected).toEqual(legacy);
      expect(projected.optimisticModules).toEqual([
        expect.objectContaining({
          source: expect.stringContaining('export const kovoOptimisticMutationPlans'),
        }),
      ]);

      const form = sources.find((source) => source.fileName === 'form.tsx')!;
      const extras = sources.filter((source) => source !== form);
      const compile = (registryFacts: typeof projected) =>
        compileComponentModule({
          extraFiles: extras,
          fileName: form.fileName,
          registryFacts,
          source: form.source,
          sourceProvenance: 'app',
        } as Parameters<typeof compileComponentModule>[0]);
      const legacyOutput = compile(legacy);
      const projectedOutput = compile(projected);
      expect(projectedOutput.files).toEqual(legacyOutput.files);
      expect(projectedOutput.loweredSource).toBe(legacyOutput.loweredSource);
      expect(projectedOutput.diagnostics).toEqual(legacyOutput.diagnostics);
    });
  });

  it('keeps the common no-optimism projection exact without requesting fresh module derivation', () => {
    withCompilerFactProject(({ sourceRoot, sources }) => {
      const appModulePath = join(sourceRoot, 'form.tsx');
      const compilerFacts = snapshotKovoBuildCompilerFactsForTests(sources, sourceRoot);
      expect(compilerFacts.projectMutationFacts.requiresOptimisticModuleDerivation).toBe(false);

      const legacy = projectMutationRegistryFactsForBuild(
        appModulePath,
        sourceRoot,
        sources,
        sourceRoot,
      );
      const projected = projectMutationRegistryFactsFromCompilerFactsForTests(
        appModulePath,
        sourceRoot,
        sources,
        compilerFacts,
        sourceRoot,
      );
      expect(projected).toEqual(legacy);
      expect(projected.mutationOptimism).toEqual({});
      expect(projected.optimisticModules).toEqual([]);
    }, nonOptimisticCompilerFactSources());
  });
});

function cloneFacts(facts: KovoBuildCompilerFacts): MutableCompilerFacts {
  return structuredClone(facts) as MutableCompilerFacts;
}

type DeepMutable<Value> = Value extends readonly (infer Entry)[]
  ? DeepMutable<Entry>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

type MutableCompilerFacts = DeepMutable<KovoBuildCompilerFacts>;

function withCompilerFactProject(
  operation: (input: {
    readonly sourceRoot: string;
    readonly sources: Array<{ fileName: string; source: string }>;
  }) => void,
  sources: Array<{ fileName: string; source: string }> = compilerFactSources(),
): void {
  const root = mkdtempSync(join(tmpdir(), 'kovo-build-compiler-facts-'));
  const sourceRoot = join(root, 'appsrc');
  try {
    linkPackage(root, '@kovojs/server', join(repoRoot, 'packages/server'));
    for (const source of sources) writeSource(join(sourceRoot, source.fileName), source.source);
    operation({ sourceRoot, sources });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function nonOptimisticCompilerFactSources(): Array<{ fileName: string; source: string }> {
  return [
    compilerFactSources()[0]!,
    {
      fileName: 'mutations.ts',
      source: [
        "import { s } from '@kovojs/server';",
        "import { app } from './kovo.js';",
        'export const add = app.mutation({',
        '  input: s.object({ quantity: s.number() }),',
        '  handler() {},',
        '});',
        '',
      ].join('\n'),
    },
    compilerFactSources().at(-1)!,
  ];
}

function compilerFactSources(): Array<{ fileName: string; source: string }> {
  return [
    {
      fileName: 'kovo.ts',
      source: [
        "import { defineKovo } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000002',",
        '});',
        '',
      ].join('\n'),
    },
    {
      fileName: 'queries.ts',
      source: [
        "import { app } from './kovo.js';",
        'export const cartQuery = app.query({ load() { return { count: 0 }; } });',
        '',
      ].join('\n'),
    },
    {
      fileName: 'mutations.ts',
      source: [
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
      ].join('\n'),
    },
    {
      fileName: 'form.tsx',
      source: [
        '/** @jsxImportSource @kovojs/server */',
        "import { component } from '@kovojs/server';",
        "import { add } from './mutations.js';",
        'export const AddForm = component({',
        '  render: () => <form mutation={add}><button>Add</button></form>,',
        '});',
        '',
      ].join('\n'),
    },
  ];
}

function linkPackage(root: string, name: string, target: string): void {
  const link = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, 'dir');
}

function writeSource(fileName: string, source: string): void {
  mkdirSync(dirname(fileName), { recursive: true });
  writeFileSync(fileName, source, 'utf8');
}
