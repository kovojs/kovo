import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { parseVersionedClientModuleTarget } from '@kovojs/core/internal/client-module-url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  compilerOwnedAppContractStaticFactsFromFiles,
  compilerOwnedProjectMutationRegistryFactsFromFiles,
  createCompilerOwnedAppContractProject,
} from './app-contract-project.js';
import { compileComponentModule } from './compile.js';
import { componentTaskBSourceOperationFacts } from './security-operation-facts.js';
import { mutationSessionAuthorityFacts, parseComponentModule } from './scan/parse.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('D1 compiler-owned exact project resolver', () => {
  it('accepts the normative appId/provider-descriptor contract without spike-only provider keys', async () => {
    const fixture = await createFixture();
    const contract = join(fixture.root, 'app/src/kovo.ts');
    const entry = join(fixture.root, 'app/src/product-entry.ts');
    await writeSource(
      contract,
      [
        "import { defineKovo } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000002',",
        '});',
        '',
      ].join('\n'),
    );
    await writeSource(
      entry,
      "import { app } from './kovo.js';\nexport const item = app.query({ load() { return 1; } });\n",
    );
    const project = createCompilerOwnedAppContractProject({
      rootNames: [contract, entry],
    });

    const result = project.compileEntry(entry);

    expect(result.diagnostics).toEqual([]);
    expect(result.ownerKey).toMatch(/^d1v7:[a-f0-9]{64}$/u);
    expect(result.parsedFactories).toContain('query');
    expect(result.resolver.exactNodeCount).toBe(1);
    expect(result.serverPackageRoots).toEqual([fixture.serverA]);
  });

  it('resolves an authenticated project-relative census against its explicit root', async () => {
    const fixture = await createFixture();
    const contract = join(fixture.root, 'app/src/kovo.ts');
    const entry = join(fixture.root, 'app/src/product-entry.ts');
    await writeSource(
      contract,
      [
        "import { defineKovo } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000002',",
        '});',
        '',
      ].join('\n'),
    );
    await writeSource(
      entry,
      "import { app } from './kovo.js';\nexport const item = app.query({ load() { return 1; } });\n",
    );
    const contractName = relative(fixture.root, contract);
    const entryName = relative(fixture.root, entry);
    const project = createCompilerOwnedAppContractProject({
      rootDirectory: fixture.root,
      rootNames: [contractName, entryName],
    });

    expect(project.compileEntry(entryName)).toEqual(
      expect.objectContaining({
        diagnostics: [],
        ownerKey: expect.stringMatching(/^d1v7:[a-f0-9]{64}$/u),
      }),
    );
    expect(project.staticFacts().every((fact) => !fact.fileName.startsWith('/'))).toBe(true);
    expect(project.withEntryResolutions(entryName, (source) => source)).toContain(
      'app.query({ load()',
    );
  });

  it('carries app-scoped handler roots into the finite TASK B semantic carrier', async () => {
    const fixture = await createFixture();
    const contract = join(fixture.root, 'app/src/kovo.ts');
    const entry = join(fixture.root, 'app/src/product-entry.tsx');
    await writeSource(
      contract,
      [
        "import { defineKovo } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000002',",
        '});',
        '',
      ].join('\n'),
    );
    await writeSource(
      entry,
      [
        '/** @jsxImportSource @kovojs/server */',
        "import { app } from './kovo.js';",
        "import * as style from '@kovojs/style';",
        "const styles = style.create({ shell: { color: 'red' } });",
        'export function Shell() { return <main style={styles.shell} />; }',
        'export const item = app.query({',
        '  load(_input, request) { return request.db.select(); },',
        '});',
        "export const health = app.endpoint('/api/health', {",
        "  access: app.publicAccess('public uptime probe'),",
        "  auth: { justification: 'public uptime probe', kind: 'none' },",
        '  csrf: false,',
        "  csrfJustification: 'read-only machine health probe',",
        '  handler: () => Response.json({ ok: true }),',
        "  method: 'GET',",
        "  reason: 'read-only machine health probe',",
        "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
        '});',
        '',
      ].join('\n'),
    );
    const project = createCompilerOwnedAppContractProject({ rootNames: [contract, entry] });

    const finite = project.withEntryResolutions(entry, (source) => ({
      compiled: compileComponentModule({ fileName: entry, source }),
      operations: componentTaskBSourceOperationFacts(parseComponentModule(entry, source)),
    }));

    expect(finite.operations).toContainEqual(
      expect.objectContaining({
        door: 'handler-root',
        kind: 'server.handler.root',
        root: expect.stringMatching(/^query:.*item$/u),
      }),
    );
    expect(finite.operations).toContainEqual(
      expect.objectContaining({
        door: 'handler-root',
        kind: 'server.handler.root',
        root: 'endpoint:/api/health',
      }),
    );
    expect(
      finite.compiled.componentGraphFacts.flatMap(
        (fact) => fact.securitySemanticGraph?.roots.map((root) => root.root) ?? [],
      ),
    ).toEqual(
      expect.arrayContaining(['endpoint:/api/health', expect.stringMatching(/^query:.*item$/u)]),
    );
    expect(
      finite.compiled.componentGraphFacts.flatMap((fact) => fact.securityOperations ?? []),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          door: 'handler-root',
          kind: 'server.handler.root',
          target: 'endpoint:/api/health',
        }),
      ]),
    );
  });

  it('recognizes exact app access members and only exempts managed request.db writes', async () => {
    const fixture = await createFixture();
    const contract = join(fixture.root, 'app/src/kovo.ts');
    const entry = join(fixture.root, 'app/src/app-surfaces.tsx');
    await writeSource(
      contract,
      [
        "import { defineKovo } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000002',",
        '});',
        '',
      ].join('\n'),
    );
    await writeSource(
      entry,
      [
        "import { app } from './kovo.js';",
        'declare const capturedDb: { insert(value?: unknown): unknown };',
        "export const publicPage = app.route('/public', {",
        "  access: app.publicAccess('public fixture page'),",
        '  page: () => <main>Public</main>,',
        '});',
        "export const privatePage = app.route /* parsed facts, not raw text */ ('/private', {",
        '  access: [app.authenticated],',
        '  page: () => <main>Private</main>,',
        '});',
        'export const managed = app.mutation({',
        '  handler(_input, request) {',
        '    const transaction = request.db;',
        '    transaction.insert();',
        '  },',
        '});',
        'export const destructured = app.mutation({',
        '  handler(_input, { db }) { db.insert(); },',
        '});',
        'export const captured = app.mutation({',
        '  handler() { capturedDb.insert(); },',
        '});',
        'export const shadowed = app.mutation({',
        '  handler(_input, request) {',
        '    const run = (request) => request.db.insert();',
        '    return run(request);',
        '  },',
        '});',
        '',
      ].join('\n'),
    );
    const project = createCompilerOwnedAppContractProject({ rootNames: [contract, entry] });

    const result = project.compileEntry(entry);
    const staticFacts = project.staticFacts().filter((fact) => fact.fileName === entry);
    const sessionAuthority = project.withEntryResolutions(entry, (source) =>
      mutationSessionAuthorityFacts(parseComponentModule(entry, source)),
    );

    expect(result.diagnostics).toEqual([]);
    expect(
      result.component?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV330'),
    ).toHaveLength(2);
    expect(result.component?.handlerWriteSinkFacts).toHaveLength(2);
    expect(result.component?.handlerWriteSinkFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalTarget: expect.objectContaining({ identity: 'capturedDb' }),
        }),
        expect.objectContaining({
          canonicalTarget: expect.objectContaining({ identity: 'request.db' }),
        }),
      ]),
    );
    expect(
      result.route?.routePageFacts.map((fact) => ({
        access: fact.access,
        route: fact.route,
      })),
    ).toEqual([
      { access: { kind: 'public', reason: 'public fixture page' }, route: '/public' },
      { access: { guards: ['authed'], kind: 'guard-chain' }, route: '/private' },
    ]);
    expect(staticFacts.map((fact) => fact.memberName)).toEqual(
      expect.arrayContaining(['authenticated', 'mutation', 'publicAccess', 'route']),
    );
    expect(
      staticFacts.filter((fact) => fact.memberName === 'route').map((fact) => fact.declaration),
    ).toEqual([
      expect.objectContaining({ name: '/public' }),
      expect.objectContaining({ name: '/private' }),
    ]);
    expect(staticFacts.every((fact) => fact.source === result.source)).toBe(true);
    expect(sessionAuthority.map((fact) => [fact.name, fact.referencesSession])).toEqual([
      ['app-surfaces/captured', true],
      ['app-surfaces/destructured', false],
      ['app-surfaces/managed', false],
      ['app-surfaces/shadowed', true],
    ]);
  });

  it('binds integrated adapter mutations to their exact literal key and call span', async () => {
    const fixture = await createFixture();
    const contract = join(fixture.root, 'app/src/kovo.ts');
    const entry = join(fixture.root, 'app/src/auth-integration.ts');
    await writeSource(
      contract,
      [
        "import { defineKovo } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000002',",
        '});',
        '',
      ].join('\n'),
    );
    const source = [
      "import { app } from './kovo.js';",
      'interface GeneratedMutation<Key extends string> { readonly key: Key }',
      "declare const signIn: GeneratedMutation<'auth/sign-in'>;",
      'export const integratedSignIn = app.integrateMutation(signIn);',
      '',
    ].join('\n');
    await writeSource(entry, source);
    const project = createCompilerOwnedAppContractProject({ rootNames: [contract, entry] });

    const declaration = project
      .staticFacts()
      .find(
        (fact) => fact.fileName === entry && fact.memberName === 'integrateMutation',
      )?.declaration;

    expect(declaration).toEqual(
      expect.objectContaining({ kind: 'mutation', name: 'auth/sign-in' }),
    );
    expect(source.slice(declaration?.start, declaration?.end)).toBe(
      'app.integrateMutation(signIn)',
    );
  });

  it('derives imported mutation-form facts from exact app.mutation and a pristine shared schema', async () => {
    const fixture = await createFixture();
    const contract = join(fixture.root, 'app/src/kovo.ts');
    const mutations = join(fixture.root, 'app/src/mutations.ts');
    const form = join(fixture.root, 'app/src/form.tsx');
    const contractSource = [
      "import { defineKovo } from '@kovojs/server';",
      'export const app = defineKovo({',
      "  appId: '00000000-0000-4000-8000-000000000002',",
      '});',
      '',
    ].join('\n');
    const mutationSource = [
      "import { s } from '@kovojs/server';",
      "import { app } from './kovo.js';",
      'const addContactInput = s.object({',
      '  name: s.string(),',
      '  email: s.string().optional(),',
      '});',
      'export const addContact = app.mutation({',
      '  input: addContactInput,',
      '  handler() { return { ok: true }; },',
      '});',
      '',
    ].join('\n');
    const formSource = [
      "import { addContact } from './mutations.js';",
      'export const binding = addContact;',
      '',
    ].join('\n');
    await writeSource(contract, contractSource);
    await writeSource(mutations, mutationSource);
    await writeSource(form, formSource);
    const project = createCompilerOwnedAppContractProject({
      rootNames: [contract, mutations, form],
    });

    const facts = project.projectMutationRegistryFacts([
      { fileName: contract, source: contractSource },
      { fileName: mutations, source: mutationSource },
      { fileName: form, source: formSource },
    ]);

    expect(facts.mutationBindings).toContainEqual(
      expect.objectContaining({
        fileName: form,
        key: expect.stringMatching(/mutations\/add-contact$/u),
        localName: 'addContact',
      }),
    );
    expect(
      Object.values(facts.mutationInputs)
        .flat()
        .map((field) => ({
          name: field.name,
          optional: field.optional,
        })),
    ).toEqual([
      { name: 'name', optional: false },
      { name: 'email', optional: true },
    ]);

    expect(() =>
      project.projectMutationRegistryFacts([
        { fileName: contract, source: contractSource },
        { fileName: mutations, source: `${mutationSource}// stale` },
        { fileName: form, source: formSource },
      ]),
    ).toThrow(/stale source snapshot/u);

    const bridged = compilerOwnedProjectMutationRegistryFactsFromFiles(
      [
        { fileName: 'kovo.ts', source: contractSource },
        { fileName: 'mutations.ts', source: mutationSource },
        { fileName: 'form.tsx', source: formSource },
        { fileName: 'styles.css', source: ':root { color-scheme: light; }' },
      ],
      dirname(contract),
    );
    expect(bridged.mutationBindings).toContainEqual(
      expect.objectContaining({ fileName: 'form.tsx', localName: 'addContact' }),
    );
    expect(
      compilerOwnedAppContractStaticFactsFromFiles(
        [
          { fileName: 'kovo.ts', source: contractSource },
          { fileName: 'mutations.ts', source: mutationSource },
          { fileName: 'form.tsx', source: formSource },
        ],
        dirname(contract),
      ),
    ).toContainEqual(
      expect.objectContaining({
        fileName: 'mutations.ts',
        memberName: 'mutation',
        source: mutationSource,
      }),
    );
  });

  it('emits exact query-handle optimism as one immutable browser module', async () => {
    const fixture = await createFixture();
    const sourceRoot = join(fixture.root, 'app/src');
    const contract = join(sourceRoot, 'kovo.ts');
    const queries = join(sourceRoot, 'queries.ts');
    const mutations = join(sourceRoot, 'mutations.ts');
    const form = join(sourceRoot, 'form.tsx');
    const contractSource = [
      "import { defineKovo } from '@kovojs/server';",
      'export const app = defineKovo({',
      "  appId: '00000000-0000-4000-8000-000000000002',",
      '});',
      '',
    ].join('\n');
    const querySource = [
      "import type { MutationMarker } from './mutations.js';",
      "import { app } from './kovo.js';",
      'export const cartQuery = app.query({ load() { return { count: 0 }; } });',
      'export const productQuery = app.query({ load() { return { stock: 3 }; } });',
      'export type QueryMarker = MutationMarker;',
      '',
    ].join('\n');
    const mutationSource = [
      "import { s } from '@kovojs/server';",
      "import { app } from './kovo.js';",
      "import { cartQuery, productQuery } from './queries.js';",
      'export type MutationMarker = { readonly mutation: true };',
      'const addToCartInput = s.object({',
      '  productId: s.string(),',
      '  quantity: s.number().int().min(1).default(1),',
      '});',
      'function predictCart(data, input) {',
      '  return { ...data, count: data.count + input.quantity };',
      '}',
      'export const addToCart = app.mutation({',
      '  input: addToCartInput,',
      "  queue: 'cart',",
      '  optimistic: [',
      '    cartQuery.optimistic(addToCartInput, predictCart),',
      '    productQuery.optimistic(addToCartInput, {',
      '      keys: (input) => [{ id: input.productId }, { id: `${input.productId}-related` }],',
      '      apply: (product, input) => ({ ...product, stock: product.stock - input.quantity }),',
      '    }),',
      '  ],',
      '  handler() { return { ok: true }; },',
      '});',
      '',
    ].join('\n');
    const formSource = [
      "import { addToCart } from './mutations.js';",
      'export const mutationBinding = addToCart;',
      '',
    ].join('\n');
    await writeSource(contract, contractSource);
    await writeSource(queries, querySource);
    await writeSource(mutations, mutationSource);
    await writeSource(form, formSource);

    const facts = compilerOwnedProjectMutationRegistryFactsFromFiles(
      [
        { fileName: 'kovo.ts', source: contractSource },
        { fileName: 'queries.ts', source: querySource },
        { fileName: 'mutations.ts', source: mutationSource },
        { fileName: 'form.tsx', source: formSource },
      ],
      sourceRoot,
    );

    const mutationKey = Object.keys(facts.mutationOptimism ?? {})[0];
    expect(mutationKey).toMatch(/mutations\/add-to-cart$/u);
    const optimism = mutationKey ? facts.mutationOptimism?.[mutationKey] : undefined;
    const queryKeys = Object.keys(optimism?.statuses ?? {});
    expect(queryKeys).toEqual([
      expect.stringMatching(/queries\/cart-query$/u),
      expect.stringMatching(/queries\/product-query$/u),
    ]);
    expect(optimism).toMatchObject({
      inputFields: [
        expect.objectContaining({
          coercion: 'string',
          defaulted: false,
          name: 'productId',
          required: true,
        }),
        expect.objectContaining({
          coercion: 'number',
          defaulted: true,
          name: 'quantity',
          required: false,
        }),
      ],
      invalidations: queryKeys,
      mutation: mutationKey,
      queue: 'cart',
      statuses: Object.fromEntries(queryKeys.map((key) => [key, 'hand-written'])),
    });
    expect(facts.optimisticModules).toEqual([
      expect.objectContaining({
        fileName: 'mutations.ts',
        href: optimism?.moduleHref,
        mutationKeys: [mutationKey],
        path: parseVersionedClientModuleTarget(optimism!.moduleHref)?.path,
        source: expect.stringContaining('export const kovoOptimisticMutationPlans'),
      }),
    ]);
    expect(facts.optimisticModules?.[0]?.source).toContain('schema: "kovo.optimistic-plan/v1"');
    expect(facts.optimisticModules?.[0]?.source).toContain('const predictCart = function');
    expect(facts.optimisticModules?.[0]?.source).toContain('keys: Object.freeze');
  });

  it('fails closed on copied, duplicate, schema-drifted, and cyclic optimistic handles', async () => {
    const fixture = await createFixture();
    const sourceRoot = join(fixture.root, 'app/src/optimism-negative');
    const contractSource = [
      "import { defineKovo } from '@kovojs/server';",
      'export const app = defineKovo({',
      "  appId: '00000000-0000-4000-8000-000000000002',",
      '});',
      '',
    ].join('\n');
    const ordinaryQuerySource = [
      "import { app } from './kovo.js';",
      'export const cartQuery = app.query({ load() { return { count: 0 }; } });',
      '',
    ].join('\n');
    const formSource = [
      "import { addToCart } from './mutations.js';",
      'export const mutationBinding = addToCart;',
      '',
    ].join('\n');
    const cases = [
      {
        name: 'copied',
        optimistic: [
          'const copiedQuery = cartQuery;',
          'export const addToCart = app.mutation({',
          '  input: addToCartInput,',
          '  optimistic: [copiedQuery.optimistic(addToCartInput, (data) => data)],',
          '  handler() {},',
          '});',
        ],
        pattern: /KOVO_OPTIMISTIC_QUERY_IDENTITY/u,
        querySource: ordinaryQuerySource,
      },
      {
        name: 'duplicate',
        optimistic: [
          'export const addToCart = app.mutation({',
          '  input: addToCartInput,',
          '  optimistic: [',
          '    cartQuery.optimistic(addToCartInput, (data) => data),',
          '    cartQuery.optimistic(addToCartInput, (data) => data),',
          '  ],',
          '  handler() {},',
          '});',
        ],
        pattern: /KOVO_OPTIMISTIC_DUPLICATE/u,
        querySource: ordinaryQuerySource,
      },
      {
        name: 'schema drift',
        optimistic: [
          'const otherInput = s.object({ quantity: s.number() });',
          'export const addToCart = app.mutation({',
          '  input: addToCartInput,',
          '  optimistic: [cartQuery.optimistic(otherInput, (data) => data)],',
          '  handler() {},',
          '});',
        ],
        pattern: /KOVO_OPTIMISTIC_INPUT_IDENTITY/u,
        querySource: ordinaryQuerySource,
      },
      {
        name: 'runtime import cycle',
        optimistic: [
          'export const runtimeMarker = 1;',
          'export const addToCart = app.mutation({',
          '  input: addToCartInput,',
          '  optimistic: [cartQuery.optimistic(addToCartInput, (data) => data)],',
          '  handler() {},',
          '});',
        ],
        pattern: /KOVO_OPTIMISTIC_IMPORT_CYCLE/u,
        querySource: [
          "import { runtimeMarker } from './mutations.js';",
          "import { app } from './kovo.js';",
          'export const cartQuery = app.query({',
          '  load() { return { count: runtimeMarker }; },',
          '});',
          '',
        ].join('\n'),
      },
    ] as const;

    await writeSource(join(sourceRoot, 'kovo.ts'), contractSource);
    await writeSource(join(sourceRoot, 'form.tsx'), formSource);
    for (const testCase of cases) {
      const mutationSource = [
        "import { s } from '@kovojs/server';",
        "import { app } from './kovo.js';",
        "import { cartQuery } from './queries.js';",
        'const addToCartInput = s.object({ quantity: s.number() });',
        ...testCase.optimistic,
        '',
      ].join('\n');
      await writeSource(join(sourceRoot, 'queries.ts'), testCase.querySource);
      await writeSource(join(sourceRoot, 'mutations.ts'), mutationSource);

      expect(
        () =>
          compilerOwnedProjectMutationRegistryFactsFromFiles(
            [
              { fileName: 'kovo.ts', source: contractSource },
              { fileName: 'queries.ts', source: testCase.querySource },
              { fileName: 'mutations.ts', source: mutationSource },
              { fileName: 'form.tsx', source: formSource },
            ],
            sourceRoot,
          ),
        testCase.name,
      ).toThrow(testCase.pattern);
    }
  });

  it('keeps finite app-contract facts when build roots are workspace-relative', async () => {
    const fixture = await createFixture();
    const contract = join(fixture.root, 'app/src/kovo.ts');
    const entry = join(fixture.root, 'app/src/product-entry.ts');
    await writeSource(
      contract,
      [
        "import { defineKovo } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000002',",
        '});',
        '',
      ].join('\n'),
    );
    await writeSource(
      entry,
      [
        "import { app } from './kovo.js';",
        'export const item = app.query({',
        '  load(_input, request) { return request.db.select(); },',
        '});',
        '',
      ].join('\n'),
    );
    const relativeContract = relative(process.cwd(), contract);
    const relativeEntry = relative(process.cwd(), entry);
    const project = createCompilerOwnedAppContractProject({
      rootNames: [relativeContract, relativeEntry],
    });

    const result = project.compileEntry(relativeEntry);
    const finite = project.withEntryResolutions(relativeEntry, (source) => {
      const unprovedFileName = join(dirname(relativeEntry), 'unproved-copy.ts');
      return {
        compiled: compileComponentModule({ fileName: relativeEntry, source }),
        operations: componentTaskBSourceOperationFacts(parseComponentModule(relativeEntry, source)),
        unproved: compileComponentModule({ fileName: unprovedFileName, source }),
        unprovedOperations: componentTaskBSourceOperationFacts(
          parseComponentModule(unprovedFileName, source),
        ),
      };
    });

    expect(result.parsedFactories).toContain('query');
    expect(result.resolver.exactNodeCount).toBe(1);
    expect(finite.operations).toContainEqual(
      expect.objectContaining({
        door: 'handler-root',
        kind: 'server.handler.root',
        root: expect.stringMatching(/^query:.*item$/u),
      }),
    );
    expect(
      finite.compiled.componentGraphFacts.flatMap(
        (fact) => fact.securitySemanticGraph?.roots.map((root) => root.root) ?? [],
      ),
    ).toContainEqual(expect.stringMatching(/^query:.*item$/u));
    expect(finite.unprovedOperations).not.toContainEqual(
      expect.objectContaining({ kind: 'server.handler.root' }),
    );
    expect(
      finite.unproved.componentGraphFacts.flatMap(
        (fact) => fact.securitySemanticGraph?.roots.map((root) => root.root) ?? [],
      ),
    ).toEqual([]);
  });

  it('accepts ordinary, named/star re-exported, aliased, and shared-package receivers', async () => {
    const fixture = await createFixture();
    const entries = [fixture.local, fixture.named, fixture.star, fixture.alias, fixture.shared];
    const project = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, fixture.namedBridge, fixture.starBridge, ...entries],
    });

    for (const fileName of entries) {
      const result = project.compileEntry(fileName);
      expect(result.diagnostics).toEqual([]);
      expect(result.ownerKey).toBe(ownerKey);
      expect(result.parsedFactories).toContain('query');
      expect(result.resolver).toMatchObject({
        exactNodeCount: 1,
        schema: 'kovo.app-contract-d1-compiler-resolver/v2',
      });
      expect(result.serverPackageRoots).toEqual([fixture.serverA]);
      expect(result.loweredSource).not.toBeNull();
    }
  });

  it('fails closed for every unsupported app-derived receiver flow', async () => {
    const fixture = await createFixture();
    const cases = {
      array: 'D1A007',
      'array-binding': 'D1A007',
      'apply-transfer': 'D1A007',
      'assignment-destructured-factory': 'D1A003',
      'assignment-destructured-receiver': 'D1A007',
      'awaited-dynamic-import': 'D1A009',
      'bound-call': 'D1A007',
      'call-transfer': 'D1A007',
      'callback-parameter': 'D1A007',
      'callback-return': 'D1A007',
      'class-method-capture': 'D1A007',
      computed: 'D1A008',
      'default-parameter': 'D1A007',
      destructured: 'D1A003',
      dynamic: 'D1A002',
      'dynamic-import': 'D1A009',
      'dynamic-import-local-reexport': 'D1A009',
      'factory-parameter': 'D1A007',
      'function-body-alias': 'D1A007',
      'function-parameter': 'D1A007',
      'function-return': 'D1A007',
      'iife-capture': 'D1A007',
      'iife-parameter': 'D1A007',
      joined: 'D1A006',
      'later-assigned-factory': 'D1A007',
      'later-assigned-receiver': 'D1A007',
      mutable: 'D1A004',
      'named-callback-parameter': 'D1A007',
      'named-callback-return': 'D1A007',
      nested: 'D1A007',
      object: 'D1A007',
      'object-binding': 'D1A007',
      'object-method-parameter': 'D1A007',
      reassigned: 'D1A005',
      'reflect-apply-transfer': 'D1A007',
      'uninvoked-body-alias': 'D1A007',
      'uninvoked-destructured-factory': 'D1A003',
      'uninvoked-exported-body': 'D1A007',
      'wrapper-chain': 'D1A007',
      'wrapper-returned': 'D1A007',
      wrapper: 'D1A001',
    } as const;
    const files = await Promise.all(
      Object.keys(cases).map(async (name) => {
        const fileName = join(fixture.root, `app/src/rejected-${name}.ts`);
        await writeSource(fileName, rejectedSource(name));
        return [name, fileName] as const;
      }),
    );
    const project = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, ...files.map(([, fileName]) => fileName)],
    });

    for (const [name, fileName] of files) {
      const result = project.compileEntry(fileName);
      expect(
        result.diagnostics.map((entry) => entry.code),
        name,
      ).toEqual([cases[name as keyof typeof cases]]);
      expect(result.diagnostics[0]?.length, name).toBeLessThanOrEqual(64);
      expect(result.diagnostics[0]?.message.length, name).toBeLessThanOrEqual(700);
      expect(result.resolver.exactNodeCount, name).toBe(0);
    }
  });

  it('does not recognize an unrelated object with same-named members', async () => {
    const fixture = await createFixture();
    const fileName = join(fixture.root, 'app/src/unrelated.ts');
    await writeSource(
      fileName,
      [
        'const service = { query(definition: unknown) { return definition; } };',
        'export const item = service.query({ load() { return 1; } });',
        '',
      ].join('\n'),
    );
    const project = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, fileName],
    });
    const result = project.compileEntry(fileName);

    expect(result.diagnostics).toEqual([]);
    expect(result.resolver.exactNodeCount).toBe(0);
    expect(result.ownerKey).toBeNull();
    expect(result.parsedFactories).not.toContain('query');
  });

  it('does not treat an app-inferred test harness query as an app declaration factory', async () => {
    const fixture = await createFixture();
    const fileName = join(fixture.root, 'app/src/app-inferred-harness.ts');
    await writeSource(
      fileName,
      [
        "import { app } from './provider.js';",
        'declare function createHarness(value: typeof app): {',
        '  query(definition: unknown): Promise<unknown>;',
        '};',
        'const harness = createHarness(app);',
        'export const result = harness.query({ load() { return 1; } });',
        '',
      ].join('\n'),
    );
    const project = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, fileName],
    });
    const result = project.compileEntry(fileName);

    expect(result.diagnostics).toEqual([]);
    expect(result.resolver.exactNodeCount).toBe(0);
    expect(result.ownerKey).toBeNull();
    expect(result.parsedFactories).not.toContain('query');
  });

  it('retains unrelated local/imported members and a same-named defineKovo negative control', async () => {
    const fixture = await createFixture();
    const unrelatedModule = join(fixture.root, 'app/src/unrelated-module.ts');
    await writeSource(
      unrelatedModule,
      ['export const app = { query(definition: unknown) { return definition; } };', ''].join('\n'),
    );
    const imported = join(fixture.root, 'app/src/unrelated-imported.ts');
    await writeSource(
      imported,
      [
        "import { app } from './unrelated-module.js';",
        'export const item = app.query({ load() { return 1; } });',
        '',
      ].join('\n'),
    );
    const sameNamed = join(fixture.root, 'app/src/unrelated-define-kovo.ts');
    await writeSource(
      sameNamed,
      [
        'function defineKovo() {',
        '  return { query(definition: unknown) { return definition; } };',
        '}',
        'const app = defineKovo();',
        'export const item = app.query({ load() { return 1; } });',
        '',
      ].join('\n'),
    );
    const project = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, unrelatedModule, imported, sameNamed],
    });

    for (const fileName of [imported, sameNamed]) {
      const result = project.compileEntry(fileName);
      expect(result.diagnostics, fileName).toEqual([]);
      expect(result.resolver.exactNodeCount, fileName).toBe(0);
      expect(result.ownerKey, fileName).toBeNull();
      expect(result.parsedFactories, fileName).not.toContain('query');
    }
  });

  it('retains unrelated callbacks, methods, assignments, transfers, and dynamic bridges', async () => {
    const fixture = await createFixture();
    const unrelatedModule = join(fixture.root, 'app/src/adjacent-unrelated-module.ts');
    await writeSource(
      unrelatedModule,
      [
        'const service = { query(definition: unknown) { return definition; } };',
        'export { service as app };',
        '',
      ].join('\n'),
    );
    const sources = [
      [
        'callback',
        'const service = { query(definition: unknown) { return definition; } };\nconst invoke = (active: typeof service) => active.query({});\nexport const item = [service].map(invoke)[0];\n',
      ],
      [
        'method',
        'const service = { query(definition: unknown) { return definition; } };\nconst helper = { invoke(active: typeof service) { return active.query({}); } };\nexport const item = helper.invoke(service);\n',
      ],
      [
        'assignment',
        'const service = { query(definition: unknown) { return definition; } };\nlet active: typeof service;\nactive = service;\nexport const item = active.query({});\n',
      ],
      [
        'transfer',
        'const service = { query(definition: unknown) { return definition; } };\nexport const first = service.query.call(service, {});\nexport const second = service.query.apply(service, [{}]);\n',
      ],
      [
        'dynamic-bridge',
        "const module = await import('./adjacent-unrelated-module.js');\nexport const item = module.app.query({});\n",
      ],
    ] as const;
    const files = await Promise.all(
      sources.map(async ([name, source]) => {
        const fileName = join(fixture.root, `app/src/adjacent-unrelated-${name}.ts`);
        await writeSource(fileName, source);
        return fileName;
      }),
    );
    const project = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, unrelatedModule, ...files],
    });

    for (const fileName of files) {
      const result = project.compileEntry(fileName);
      expect(result.diagnostics, fileName).toEqual([]);
      expect(result.resolver.exactNodeCount, fileName).toBe(0);
      expect(result.ownerKey, fileName).toBeNull();
      expect(result.parsedFactories, fileName).not.toContain('query');
    }
  });

  it('recognizes only an authenticated generated #kovo free function', async () => {
    const fixture = await createFixture();
    const generated = join(fixture.root, 'app/.kovo/app.ts');
    const configFile = join(fixture.root, 'app/src/kovo.config.ts');
    const configSource = generatedConfigSource();
    await writeSource(configFile, configSource);
    const compilerSourceSha256 = '1'.repeat(64);
    const serverPackedContentsSha256 = '2'.repeat(64);
    const generatedSource = generatedSourceFor({
      compilerSourceSha256,
      ownerKey,
      serverPackedContentsSha256,
    });
    await writeSource(generated, generatedSource);
    const manifestFile = join(fixture.root, 'app/.kovo/app.manifest.json');
    const manifest = {
      appId: '00000000-0000-4000-8000-000000000001',
      compilerSourceSha256,
      completed: 'complete',
      configSha256: createHash('sha256').update(configSource).digest('hex'),
      generatedModuleSha256: createHash('sha256').update(generatedSource).digest('hex'),
      ownerKey,
      providerExportBinding: 'contactsProvider',
      providerImportSpecifier: './provider-impl.js',
      providerKey: 'contacts',
      providerSourceSha256: createHash('sha256')
        .update("export const contactsProvider = { key: 'contacts' } as const;\n")
        .digest('hex'),
      schema: 'kovo.generated-app-contract/v6',
      serverPackedContentsSha256,
    } as const;
    await writeJson(manifestFile, manifest);
    const entry = join(fixture.root, 'app/src/generated-entry.ts');
    await writeSource(
      entry,
      "import { query } from '#kovo';\nexport const item = query({ load() { return 1; } });\n",
    );
    const project = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, configFile, generated, entry],
    });

    const result = project.compileEntry(entry);
    expect(result.diagnostics).toEqual([]);
    expect(result.ownerKey).toBe(ownerKey);
    expect(result.parsedFactories).toContain('query');
    expect(result.resolver.exactNodeCount).toBe(1);
    expect(result.serverPackageRoots).toEqual([fixture.serverA]);

    const definition = '{ load() { return 1; } }';
    const generatedImport = "import { query } from '#kovo';\n";
    const generatedNamespaceImport = "import * as generated from '#kovo';\n";
    const rejected = {
      array: `${generatedImport}const active = [query][0]!;\nexport const item = active(${definition});\n`,
      computed: `${generatedNamespaceImport}export const item = generated['query'](${definition});\n`,
      'default-parameter': `${generatedImport}const invoke = (factory: typeof query = query) => factory(${definition});\nexport const item = invoke();\n`,
      destructured: `${generatedNamespaceImport}const { query } = generated;\nexport const item = query(${definition});\n`,
      dynamic: `${generatedImport}declare const choose: boolean;\nconst factory = ({ left: query, right: query })[choose ? 'left' : 'right'];\nexport const item = factory(${definition});\n`,
      'iife-capture': `${generatedImport}export const item = (() => query(${definition}))();\n`,
      'iife-parameter': `${generatedImport}export const item = ((factory: typeof query) => factory(${definition}))(query);\n`,
      joined: `${generatedImport}declare const choose: boolean;\nconst active = choose ? query : query;\nexport const item = active(${definition});\n`,
      'later-assigned-factory': `${generatedImport}let invoke: typeof query;\ninvoke = query;\nexport const item = invoke(${definition});\n`,
      mutable: `${generatedImport}let active = query;\nexport const item = active(${definition});\n`,
      'named-callback-parameter': `${generatedImport}const invoke = (factory: typeof query) => factory(${definition});\nexport const item = [query].map(invoke)[0];\n`,
      'namespace-static': `${generatedNamespaceImport}export const item = generated.query(${definition});\n`,
      object: `${generatedImport}const active = ({ value: query }).value;\nexport const item = active(${definition});\n`,
      'object-method-capture': `${generatedImport}const helper = { invoke() { return query(${definition}); } };\nexport const item = helper.invoke();\n`,
      reassigned: `${generatedImport}const active = query;\n// @ts-expect-error probe\nactive = query;\nexport const item = active(${definition});\n`,
      'reflect-apply-transfer': `${generatedImport}export const item = Reflect.apply(query, undefined, [${definition}]);\n`,
      'uninvoked-exported-body': `${generatedImport}export function buildDeclaration() { return query(${definition}); }\n`,
      'wrapper-returned': `${generatedImport}const select = () => query;\nexport const item = select()(${definition});\n`,
      wrapper: `${generatedImport}const wrapped = (value: Parameters<typeof query>[0]) => query(value);\nexport const item = wrapped(${definition});\n`,
    } as const;
    const expected = {
      array: 'D1B007',
      computed: 'D1B008',
      'default-parameter': 'D1B007',
      destructured: 'D1B003',
      dynamic: 'D1B002',
      'iife-capture': 'D1B007',
      'iife-parameter': 'D1B007',
      joined: 'D1B006',
      'later-assigned-factory': 'D1B007',
      mutable: 'D1B004',
      'named-callback-parameter': 'D1B007',
      'namespace-static': 'D1B008',
      object: 'D1B007',
      'object-method-capture': 'D1B007',
      reassigned: 'D1B005',
      'reflect-apply-transfer': 'D1B007',
      'uninvoked-exported-body': 'D1B007',
      'wrapper-returned': 'D1B007',
      wrapper: 'D1B001',
    } as const;
    const rejectedFiles = await Promise.all(
      Object.entries(rejected).map(async ([name, source]) => {
        const fileName = join(fixture.root, `app/src/generated-rejected-${name}.ts`);
        await writeSource(fileName, source);
        return [name as keyof typeof expected, fileName] as const;
      }),
    );
    const rejectionProject = createCompilerOwnedAppContractProject({
      rootNames: [
        fixture.provider,
        configFile,
        generated,
        ...rejectedFiles.map(([, fileName]) => fileName),
      ],
    });
    for (const [name, fileName] of rejectedFiles) {
      expect(
        rejectionProject.compileEntry(fileName).diagnostics.map((diagnostic) => diagnostic.code),
        name,
      ).toEqual([expected[name]]);
    }

    await writeSource(generated, `${generatedSource}// forged after manifest\n`);
    const forgedProject = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, configFile, generated, entry],
    });
    expect(
      forgedProject.compileEntry(entry).diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual(['D1B009']);

    const forgedOwner = `d1v6:${'0'.repeat(64)}`;
    const correlatedSource = generatedSource.replace(ownerKey, forgedOwner);
    await writeSource(generated, correlatedSource);
    await writeJson(manifestFile, {
      ...manifest,
      generatedModuleSha256: createHash('sha256').update(correlatedSource).digest('hex'),
      ownerKey: forgedOwner,
    });
    const correlatedForgeryProject = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, configFile, generated, entry],
    });
    expect(
      correlatedForgeryProject.compileEntry(entry).diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual(['D1B009']);

    await writeSource(generated, generatedSource);
    await writeJson(manifestFile, manifest);
    const providerSnapshotProject = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, configFile, generated, entry],
    });
    const changedProviderSource =
      "export const contactsProvider = { key: 'contacts', changed: true } as const;\n";
    await writeSource(join(fixture.root, 'app/src/provider-impl.ts'), changedProviderSource);
    await writeJson(manifestFile, {
      ...manifest,
      providerSourceSha256: createHash('sha256').update(changedProviderSource).digest('hex'),
    });
    expect(
      providerSnapshotProject.compileEntry(entry).diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual(['D1B009']);
  });

  it.each(['direct', 'named', 'star', 'same-owner'] as const)(
    'rejects duplicate physical server copies through the %s path',
    async (kind) => {
      const fixture = await createFixture();
      const duplicate = await createDuplicateEntry(fixture, kind);
      const project = createCompilerOwnedAppContractProject({
        rootNames: duplicate.rootNames,
      });
      const result = project.compileEntry(duplicate.entry);

      expect(result.diagnostics.map((entry) => entry.code)).toEqual(['D1X001']);
      expect(result.serverPackageRoots).toEqual([fixture.serverA, fixture.serverB].sort());
      expect(result.resolver.exactNodeCount).toBe(0);
    },
  );

  it('rejects every resolver-integrity mutation including owner and package blanks', async () => {
    const fixture = await createFixture();
    const project = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, fixture.local],
    });
    const mutations = project.resolverIntegrityMutations(fixture.local);

    expect(
      Object.fromEntries(
        Object.entries(mutations).map(([name, diagnostics]) => [
          name,
          diagnostics.map((diagnostic) => diagnostic.code),
        ]),
      ),
    ).toEqual({
      'blank-consumer-file-name': ['D1A107'],
      'blank-owner-key': ['D1A105'],
      'blank-server-package-root': ['D1A106'],
      'duplicate-span': ['D1A101'],
      'overlapping-span': ['D1A102'],
      'stale-source-reparse': ['D1A104'],
      'wrong-node-span': ['D1A103'],
    });
  });
});

const ownerKey = ownerKeyFor('contacts');

interface Fixture {
  readonly alias: string;
  readonly local: string;
  readonly named: string;
  readonly namedBridge: string;
  readonly provider: string;
  readonly root: string;
  readonly serverA: string;
  readonly serverB: string;
  readonly shared: string;
  readonly star: string;
  readonly starBridge: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'kovo-compiler-d1-v5-'));
  temporaryDirectories.push(root);
  const serverA = await createServerPackage(join(root, 'store/server-a'));
  const serverB = await createServerPackage(join(root, 'store/server-b'));
  const app = join(root, 'app');
  const sharedPackage = join(root, 'packages/shared');
  await writeJson(join(app, 'package.json'), {
    exports: { './provider': './src/provider.ts' },
    imports: { '#kovo': './.kovo/app.ts' },
    name: '@fixture/app',
    type: 'module',
  });
  await writeJson(join(sharedPackage, 'package.json'), {
    name: '@fixture/shared',
    type: 'module',
  });
  await linkDependency(app, '@kovojs/server', serverA);
  await linkDependency(sharedPackage, '@kovojs/server', serverA);
  await linkDependency(sharedPackage, '@fixture/app', app);

  const provider = join(app, 'src/provider.ts');
  await writeSource(
    join(app, 'src/provider-impl.ts'),
    "export const contactsProvider = { key: 'contacts' } as const;\n",
  );
  await writeSource(provider, providerSource('contacts'));
  await writeSource(
    join(app, 'src/local-bridge.ts'),
    "import { app } from './provider.js';\nexport { app };\n",
  );
  const namedBridge = join(app, 'src/named-bridge.ts');
  await writeSource(namedBridge, "export { app } from './provider.js';\n");
  const starBridge = join(app, 'src/star-bridge.ts');
  await writeSource(starBridge, "export * from './provider.js';\n");
  const local = join(app, 'src/local.ts');
  const named = join(app, 'src/named.ts');
  const star = join(app, 'src/star.ts');
  const alias = join(app, 'src/alias.ts');
  const shared = join(sharedPackage, 'src/shared.ts');
  await writeSource(local, acceptedSource('./provider.js', 'app'));
  await writeSource(named, acceptedSource('./named-bridge.js', 'app'));
  await writeSource(star, acceptedSource('./star-bridge.js', 'app'));
  await writeSource(
    alias,
    "import { app as contacts } from './provider.js';\nexport const item = contacts.query({ load() { return 1; } });\n",
  );
  await writeSource(shared, acceptedSource('@fixture/app/provider', 'app'));
  return {
    alias,
    local,
    named,
    namedBridge,
    provider,
    root,
    serverA,
    serverB,
    shared,
    star,
    starBridge,
  };
}

async function createDuplicateEntry(
  fixture: Fixture,
  kind: 'direct' | 'named' | 'same-owner' | 'star',
): Promise<{ readonly entry: string; readonly rootNames: readonly string[] }> {
  const packageA = join(fixture.root, 'duplicates/app-a');
  const packageB = join(fixture.root, 'duplicates/app-b');
  const consumer = join(fixture.root, 'duplicates/consumer');
  await createAppPackage(packageA, '@fixture/app-a', fixture.serverA, 'contacts');
  await createAppPackage(
    packageB,
    '@fixture/app-b',
    fixture.serverB,
    kind === 'same-owner' ? 'contacts' : 'billing',
  );
  await writeJson(join(consumer, 'package.json'), {
    name: '@fixture/consumer',
    type: 'module',
  });
  await linkDependency(consumer, '@fixture/app-a', packageA);
  await linkDependency(consumer, '@fixture/app-b', packageB);
  const entry = join(consumer, 'src/entry.ts');
  const subpath = kind === 'named' ? '/named' : kind === 'star' ? '/star' : '/provider';
  await writeSource(
    entry,
    [
      `import { app as appA } from '@fixture/app-a${subpath}';`,
      `import { app as appB } from '@fixture/app-b${subpath}';`,
      'export const first = appA.query({ load() { return 1; } });',
      'export const second = appB.query({ load() { return 2; } });',
      '',
    ].join('\n'),
  );
  return {
    entry,
    rootNames: [
      join(packageA, 'src/provider.ts'),
      join(packageA, 'src/named.ts'),
      join(packageA, 'src/star.ts'),
      join(packageB, 'src/provider.ts'),
      join(packageB, 'src/named.ts'),
      join(packageB, 'src/star.ts'),
      entry,
    ],
  };
}

async function createAppPackage(
  root: string,
  name: string,
  server: string,
  providerKey: string,
): Promise<void> {
  await writeJson(join(root, 'package.json'), {
    exports: {
      './named': './src/named.ts',
      './provider': './src/provider.ts',
      './star': './src/star.ts',
    },
    name,
    type: 'module',
  });
  await linkDependency(root, '@kovojs/server', server);
  await writeSource(
    join(root, 'src/provider-impl.ts'),
    `export const contactsProvider = { key: '${providerKey}' } as const;\n`,
  );
  await writeSource(join(root, 'src/provider.ts'), providerSource(providerKey));
  await writeSource(join(root, 'src/named.ts'), "export { app } from './provider.js';\n");
  await writeSource(join(root, 'src/star.ts'), "export * from './provider.js';\n");
}

async function createServerPackage(root: string): Promise<string> {
  await writeJson(join(root, 'package.json'), {
    exports: { '.': './index.d.ts' },
    name: '@kovojs/server',
    type: 'module',
    version: '0.0.0-test',
  });
  await writeSource(
    join(root, 'index.d.ts'),
    [
      'export declare function endpoint(path: string, definition: unknown): unknown;',
      'export declare function layout(definition: unknown): unknown;',
      'export declare function integrateMutation<const Mutation>(definition: Mutation): Mutation;',
      'export declare function mutation(definition: unknown): unknown;',
      'export declare function query(definition: { load(): unknown }): unknown;',
      'export declare function route(path: string, definition: unknown): unknown;',
      'export declare function task(definition: unknown): unknown;',
      'export declare function publicAccess(reason: string): unknown;',
      'export declare function defineKovo<const AppId extends string>(options: {',
      '  readonly appId: AppId;',
      '  readonly db?: unknown;',
      '  readonly provider?: unknown;',
      '  readonly providerKey?: string;',
      '}): {',
      '  readonly endpoint: typeof endpoint;',
      '  readonly integrateMutation: typeof integrateMutation;',
      '  readonly layout: typeof layout;',
      '  readonly mutation: typeof mutation;',
      '  readonly query: typeof query;',
      '  readonly route: typeof route;',
      '  readonly task: typeof task;',
      '  readonly assemble: (options: unknown) => unknown;',
      '};',
      '',
    ].join('\n'),
  );
  return realpath(root);
}

function providerSource(providerKey: string): string {
  return [
    "import { defineKovo } from '@kovojs/server';",
    "import { contactsProvider } from './provider-impl.js';",
    'export const app = defineKovo({',
    "  appId: '00000000-0000-4000-8000-000000000001',",
    '  provider: contactsProvider,',
    `  providerKey: '${providerKey}',`,
    '});',
    '',
  ].join('\n');
}

function ownerKeyFor(providerKey: string): string {
  return `d1v6:${createHash('sha256')
    .update(
      JSON.stringify({
        appId: '00000000-0000-4000-8000-000000000001',
        providerExportBinding: 'contactsProvider',
        providerImportSpecifier: './provider-impl.js',
        providerKey,
      }),
    )
    .digest('hex')}`;
}

function generatedConfigSource(): string {
  return [
    "import { contactsProvider } from './provider-impl.js';",
    'export default Object.freeze({',
    "  appId: '00000000-0000-4000-8000-000000000001',",
    '  provider: contactsProvider,',
    "  providerExportBinding: 'contactsProvider',",
    "  providerImportSpecifier: './provider-impl.js',",
    "  providerKey: 'contacts',",
    '});',
    '',
  ].join('\n');
}

function generatedSourceFor(options: {
  readonly compilerSourceSha256: string;
  readonly ownerKey: string;
  readonly serverPackedContentsSha256: string;
}): string {
  return [
    '/* kovo-app-contract-prototype/v6: compiler generated; do not edit */',
    "import { app as app } from '../src/provider.js';",
    "export { publicAccess } from '@kovojs/server';",
    'export const __kovoGeneratedContract = Object.freeze({',
    "  appId: '00000000-0000-4000-8000-000000000001',",
    `  compilerSourceSha256: '${options.compilerSourceSha256}',`,
    `  ownerKey: '${options.ownerKey}',`,
    "  providerExportBinding: 'contactsProvider',",
    "  providerImportSpecifier: './provider-impl.js',",
    "  providerKey: 'contacts',",
    `  serverPackedContentsSha256: '${options.serverPackedContentsSha256}',`,
    '});',
    'export const endpoint: typeof app.endpoint = app.endpoint;',
    'export const layout: typeof app.layout = app.layout;',
    'export const mutation: typeof app.mutation = app.mutation;',
    'export const query: typeof app.query = app.query;',
    'export const route: typeof app.route = app.route;',
    'export const task: typeof app.task = app.task;',
    '',
  ].join('\n');
}

function acceptedSource(specifier: string, name: string): string {
  return `import { ${name} } from '${specifier}';\nexport const item = ${name}.query({ load() { return 1; } });\n`;
}

function rejectedSource(name: string): string {
  const prefix = "import { app } from './provider.js';\n";
  const definition = '{ load() { return 1; } }';
  switch (name) {
    case 'array':
      return `${prefix}const active = [app][0]!;\nexport const item = active.query(${definition});\n`;
    case 'array-binding':
      return `${prefix}const [active] = [app];\nexport const item = active!.query(${definition});\n`;
    case 'apply-transfer':
      return `${prefix}export const item = app.query.apply(app, [${definition}]);\n`;
    case 'assignment-destructured-factory':
      return `${prefix}let query: typeof app.query;\n({ query } = app);\nexport const item = query(${definition});\n`;
    case 'assignment-destructured-receiver':
      return `${prefix}let active: typeof app;\n({ value: active } = { value: app });\nexport const item = active.query(${definition});\n`;
    case 'awaited-dynamic-import':
      return `const module = await import('./provider.js');\nexport const item = module.app.query(${definition});\n`;
    case 'bound-call':
      return `${prefix}const invoke = app.query.bind(app);\nexport const item = invoke(${definition});\n`;
    case 'call-transfer':
      return `${prefix}export const item = app.query.call(app, ${definition});\n`;
    case 'callback-parameter':
      return `${prefix}export const item = [app].map((active) => active.query(${definition}))[0];\n`;
    case 'callback-return':
      return `${prefix}export const item = [1].map(() => app.query(${definition}))[0];\n`;
    case 'class-method-capture':
      return `${prefix}class Invoker { invoke() { return app.query(${definition}); } }\nexport const item = new Invoker().invoke();\n`;
    case 'computed':
      return `${prefix}export const item = app['query'](${definition});\n`;
    case 'default-parameter':
      return `${prefix}const invoke = (active: typeof app = app) => active.query(${definition});\nexport const item = invoke();\n`;
    case 'destructured':
      return `${prefix}const { query } = app;\nexport const item = query(${definition});\n`;
    case 'dynamic':
      return `${prefix}declare const choose: boolean;\nconst factory = choose ? app.query : app.query;\nexport const item = factory(${definition});\n`;
    case 'dynamic-import':
      return `import('./provider.js').then((module) => module.app.query(${definition}));\n`;
    case 'dynamic-import-local-reexport':
      return `const module = await import('./local-bridge.js');\nexport const item = module.app.query(${definition});\n`;
    case 'factory-parameter':
      return `${prefix}const invoke = (factory: typeof app.query) => factory(${definition});\nexport const item = invoke(app.query);\n`;
    case 'function-body-alias':
      return `${prefix}function invoke() { const active = app; return active.query(${definition}); }\nexport const item = invoke();\n`;
    case 'function-parameter':
      return `${prefix}const invoke = (active: typeof app) => active.query(${definition});\nexport const item = invoke(app);\n`;
    case 'function-return':
      return `${prefix}function select() { return app; }\nexport const item = select().query(${definition});\n`;
    case 'iife-capture':
      return `${prefix}export const item = (() => app.query(${definition}))();\n`;
    case 'iife-parameter':
      return `${prefix}export const item = ((active: typeof app) => active.query(${definition}))(app);\n`;
    case 'joined':
      return `${prefix}declare const choose: boolean;\nconst active = choose ? app : app;\nexport const item = active.query(${definition});\n`;
    case 'later-assigned-factory':
      return `${prefix}let invoke: typeof app.query;\ninvoke = app.query;\nexport const item = invoke(${definition});\n`;
    case 'later-assigned-receiver':
      return `${prefix}let active: typeof app;\nactive = app;\nexport const item = active.query(${definition});\n`;
    case 'mutable':
      return `${prefix}let active = app;\nexport const item = active.query(${definition});\n`;
    case 'named-callback-parameter':
      return `${prefix}const invoke = (active: typeof app) => active.query(${definition});\nexport const item = [app].map(invoke)[0];\n`;
    case 'named-callback-return':
      return `${prefix}const invoke = () => app.query(${definition});\nexport const item = [1].map(invoke)[0];\n`;
    case 'nested':
      return `${prefix}const holder = { deep: { value: app } };\nconst active = holder.deep.value;\nexport const item = active.query(${definition});\n`;
    case 'object':
      return `${prefix}const active = ({ value: app }).value;\nexport const item = active.query(${definition});\n`;
    case 'object-binding':
      return `${prefix}const { value: active } = { value: app };\nexport const item = active.query(${definition});\n`;
    case 'object-method-parameter':
      return `${prefix}const helper = { invoke(active: typeof app) { return active.query(${definition}); } };\nexport const item = helper.invoke(app);\n`;
    case 'reassigned':
      return `${prefix}const active = app;\n// @ts-expect-error probe\nactive = app;\nexport const item = active.query(${definition});\n`;
    case 'reflect-apply-transfer':
      return `${prefix}export const item = Reflect.apply(app.query, app, [${definition}]);\n`;
    case 'uninvoked-body-alias':
      return `${prefix}export function buildDeclaration() { const first = app; const second = first; return second.query(${definition}); }\n`;
    case 'uninvoked-destructured-factory':
      return `${prefix}export function buildDeclaration() { const { query } = app; return query(${definition}); }\n`;
    case 'uninvoked-exported-body':
      return `${prefix}export function buildDeclaration() { const active = app; return active.query(${definition}); }\n`;
    case 'wrapper-returned':
      return `${prefix}const select = () => app;\nexport const item = select().query(${definition});\n`;
    case 'wrapper-chain':
      return `${prefix}const first = () => app;\nconst second = () => first();\nexport const item = second().query(${definition});\n`;
    case 'wrapper':
      return `${prefix}const wrapped = (definition: Parameters<typeof app.query>[0]) => app.query(definition);\nexport const item = wrapped(${definition});\n`;
    default:
      throw new TypeError(`Unknown D1 rejected fixture ${name}.`);
  }
}

async function linkDependency(packageRoot: string, name: string, target: string): Promise<void> {
  const segments = name.split('/');
  const link = join(packageRoot, 'node_modules', ...segments);
  await mkdir(dirname(link), { recursive: true });
  await symlink(target, link, 'dir');
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeSource(fileName, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSource(fileName: string, source: string): Promise<void> {
  await mkdir(dirname(fileName), { recursive: true });
  await writeFile(fileName, source);
}
