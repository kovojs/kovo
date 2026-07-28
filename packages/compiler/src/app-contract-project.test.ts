import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCompilerOwnedAppContractProject } from './app-contract-project.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('D1 compiler-owned exact project resolver', () => {
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
      'awaited-dynamic-import': 'D1A009',
      'bound-call': 'D1A007',
      'callback-parameter': 'D1A007',
      'callback-return': 'D1A007',
      computed: 'D1A008',
      destructured: 'D1A003',
      dynamic: 'D1A002',
      'dynamic-import': 'D1A009',
      'function-body-alias': 'D1A007',
      'function-parameter': 'D1A007',
      'function-return': 'D1A007',
      joined: 'D1A006',
      mutable: 'D1A004',
      nested: 'D1A007',
      object: 'D1A007',
      'object-binding': 'D1A007',
      reassigned: 'D1A005',
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

  it('retains unrelated local/imported members and a same-named defineKovo negative control', async () => {
    const fixture = await createFixture();
    const unrelatedModule = join(fixture.root, 'app/src/unrelated-module.ts');
    await writeSource(
      unrelatedModule,
      [
        'export const app = { query(definition: unknown) { return definition; } };',
        '',
      ].join('\n'),
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

  it('recognizes only an authenticated generated #kovo free function', async () => {
    const fixture = await createFixture();
    const generated = join(fixture.root, 'app/.kovo/app.ts');
    const generatedSource = [
      '/* kovo-app-contract-prototype/v6: compiler generated; do not edit */',
      "import { app } from '../src/provider.js';",
      'export const query = app.query;',
      '',
    ].join('\n');
    await writeSource(generated, generatedSource);
    await writeJson(join(fixture.root, 'app/.kovo/app.manifest.json'), {
      generatedModuleSha256: createHash('sha256').update(generatedSource).digest('hex'),
      schema: 'kovo.generated-app-contract/v6',
    });
    const entry = join(fixture.root, 'app/src/generated-entry.ts');
    await writeSource(
      entry,
      "import { query } from '#kovo';\nexport const item = query({ load() { return 1; } });\n",
    );
    const project = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, generated, entry],
    });

    const result = project.compileEntry(entry);
    expect(result.diagnostics).toEqual([]);
    expect(result.ownerKey).toBe(ownerKey);
    expect(result.parsedFactories).toContain('query');
    expect(result.resolver.exactNodeCount).toBe(1);
    expect(result.serverPackageRoots).toEqual([fixture.serverA]);

    await writeSource(generated, `${generatedSource}// forged after manifest\n`);
    const forgedProject = createCompilerOwnedAppContractProject({
      rootNames: [fixture.provider, generated, entry],
    });
    expect(forgedProject.compileEntry(entry).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      ['D1B009'],
    );
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
      'export declare function mutation(definition: unknown): unknown;',
      'export declare function query(definition: { load(): unknown }): unknown;',
      'export declare function route(path: string, definition: unknown): unknown;',
      'export declare function task(definition: unknown): unknown;',
      'export declare function defineKovo<const AppId extends string>(options: {',
      '  readonly appId: AppId;',
      '  readonly provider: unknown;',
      '  readonly providerKey: string;',
      '}): {',
      '  readonly endpoint: typeof endpoint;',
      '  readonly layout: typeof layout;',
      '  readonly mutation: typeof mutation;',
      '  readonly query: typeof query;',
      '  readonly route: typeof route;',
      '  readonly task: typeof task;',
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
    case 'awaited-dynamic-import':
      return `const module = await import('./provider.js');\nexport const item = module.app.query(${definition});\n`;
    case 'bound-call':
      return `${prefix}const invoke = app.query.bind(app);\nexport const item = invoke(${definition});\n`;
    case 'callback-parameter':
      return `${prefix}export const item = [app].map((active) => active.query(${definition}))[0];\n`;
    case 'callback-return':
      return `${prefix}export const item = [1].map(() => app.query(${definition}))[0];\n`;
    case 'computed':
      return `${prefix}export const item = app['query'](${definition});\n`;
    case 'destructured':
      return `${prefix}const { query } = app;\nexport const item = query(${definition});\n`;
    case 'dynamic':
      return `${prefix}declare const choose: boolean;\nconst factory = choose ? app.query : app.query;\nexport const item = factory(${definition});\n`;
    case 'dynamic-import':
      return `import('./provider.js').then((module) => module.app.query(${definition}));\n`;
    case 'function-body-alias':
      return `${prefix}function invoke() { const active = app; return active.query(${definition}); }\nexport const item = invoke();\n`;
    case 'function-parameter':
      return `${prefix}const invoke = (active: typeof app) => active.query(${definition});\nexport const item = invoke(app);\n`;
    case 'function-return':
      return `${prefix}function select() { return app; }\nexport const item = select().query(${definition});\n`;
    case 'joined':
      return `${prefix}declare const choose: boolean;\nconst active = choose ? app : app;\nexport const item = active.query(${definition});\n`;
    case 'mutable':
      return `${prefix}let active = app;\nexport const item = active.query(${definition});\n`;
    case 'nested':
      return `${prefix}const holder = { deep: { value: app } };\nconst active = holder.deep.value;\nexport const item = active.query(${definition});\n`;
    case 'object':
      return `${prefix}const active = ({ value: app }).value;\nexport const item = active.query(${definition});\n`;
    case 'object-binding':
      return `${prefix}const { value: active } = { value: app };\nexport const item = active.query(${definition});\n`;
    case 'reassigned':
      return `${prefix}const active = app;\n// @ts-expect-error probe\nactive = app;\nexport const item = active.query(${definition});\n`;
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
