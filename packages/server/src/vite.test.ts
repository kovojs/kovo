import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { kovoVitePlugin as compilerKovoVitePlugin } from '@kovojs/compiler/vite';
import { isRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';

import { createKovoVitePlugin } from '../../compiler/src/vite.js';

import { createApp, createRequestHandler } from './app.js';
import { assignDerivedMutationKey, assignDerivedQueryKey } from './internal/wire.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';
import { kovo } from './vite.js';
import type { KovoAppShellViteMiddleware } from './vite-dev.js';

interface KovoViteConfigureServer {
  buildStart?(): void | Promise<void>;
  configResolved?(config: {
    command?: 'build' | 'serve';
    plugins?: readonly unknown[];
    root: string;
  }): void | Promise<void>;
  configureServer(server: {
    config?: { root?: string };
    middlewares: { use(handler: KovoAppShellViteMiddleware): void };
    ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  }): void | Promise<void>;
  transform?(
    source: string,
    id: string,
  ): null | Promise<null | { code: string; map: null }> | { code: string; map: null };
  enforce?: 'pre';
  handleHotUpdate?(context: {
    file: string;
    modules?: readonly unknown[];
    read(): Promise<string>;
    server: { middlewares: { use(handler: KovoAppShellViteMiddleware): void } };
  }): readonly unknown[] | Promise<readonly unknown[]>;
}

const authoredCardSource = `
import { component } from '@kovojs/core';
export const Card = component({ render: () => <article>Card</article> });
`;

const importedMutationSource = `
import { mutation, s } from '@kovojs/server';

export const saveContact = mutation({
  input: s.object({ name: s.string() }),
  handler(input) { return input; },
});
`;

const importedMutationFormSource = `
import { component } from '@kovojs/core';
import { saveContact } from '../mutations.js';

export const ContactForm = component({
  mutations: { saveContact },
  render: () => <form mutation={saveContact}><input name="name" /></form>,
});
`;

function withViteRunner<
  Server extends { ssrLoadModule(id: string): Promise<Record<string, unknown>> },
>(server: Server): Server {
  return {
    ...server,
    environments: {
      ssr: {
        runner: {
          clearCache() {},
          import(id: string) {
            return server.ssrLoadModule(id);
          },
        },
      },
    },
  };
}

async function writeImportedMutationProject(root: string): Promise<void> {
  await mkdir(join(root, 'src/components'), { recursive: true });
  await Promise.all([
    writeFile(join(root, 'src/app-shell.ts'), 'export default {};\n', 'utf8'),
    writeFile(join(root, 'src/mutations.ts'), importedMutationSource, 'utf8'),
    writeFile(join(root, 'src/components/contact-form.tsx'), importedMutationFormSource, 'utf8'),
  ]);
}

describe('public Kovo Vite plugin', () => {
  it('runs before JSX lowering and serves lowered handler island markers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-dev-lowering-'));
    const source = `
import { component } from '@kovojs/core';

export const CartButton = component({
  render: () => <button onClick={() => null}>Save</button>,
});
`;

    try {
      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;

      expect(plugin.enforce).toBe('pre');
      await plugin.configResolved?.({ root });
      const transformed = await plugin.transform?.(source, join(root, 'src/cart-button.tsx'));

      expect(transformed).toMatchObject({ map: null });
      expect(transformed?.code).toContain('kovo-c="cart-button"');
      expect(transformed?.code).toMatch(
        /on:click="\/c\/__v\/[0-9a-f]{64}\/src\/cart-button\.client\.js#CartButton\$button_click"/,
      );
      expect(transformed?.code).not.toContain('onClick');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('passes the compiler exact final client-module snapshot to Vite dev dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-client-snapshot-'));
    const appSource = `
import { defineKovo } from '@kovojs/server';
const app = defineKovo({});
export default app.assemble({});
`;
    const componentSource = `
import { component } from '@kovojs/core';
export const SnapshotButton = component({
  render: () => <button onClick={() => null}>Snapshot</button>,
});
`;
    let prepareCompilerClientModules:
      | ((serverModule: object) => () => readonly {
          path: string;
          renderPlanFingerprint?: string;
          source: string;
        }[])
      | undefined;

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src/app-shell.tsx'), appSource, 'utf8');
      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
      await plugin.configResolved?.({ command: 'serve', root });
      await plugin.configureServer(
        withViteRunner({
          config: { root },
          middlewares: { use() {} },
          async ssrLoadModule(id) {
            expect(id).toBe('@kovojs/server/internal/app-shell-vite');
            return {
              createKovoAppShellViteDevIntegration(options: {
                prepareCompilerClientModules?: typeof prepareCompilerClientModules;
              }) {
                prepareCompilerClientModules = options.prepareCompilerClientModules;
                return {
                  onModuleDiagnostics() {},
                  plugin: { configureServer() {} },
                };
              },
            };
          },
        }),
      );

      expect(prepareCompilerClientModules).toBeTypeOf('function');
      await plugin.transform?.(componentSource, join(root, 'src/snapshot-button.tsx'));
      const epoch = {};
      const getter = prepareCompilerClientModules?.({
        claimCompilerClientModuleViteInstaller(protocol: string) {
          expect(protocol).toBe('kovo.compiler-client-module-role/v1');
          return {
            begin() {
              const records: Array<{
                path: string;
                renderPlanFingerprint: string;
                source: string;
              }> = [];
              const adopt = (module: {
                path: string;
                renderPlanFingerprint: string;
                source: string;
              }) => {
                const record = { ...module };
                records.push(record);
                return record;
              };
              return {
                adoptAppBootstrap: adopt,
                adoptComponentClient: adopt,
                adoptDeferredAppRuntime: adopt,
                adoptOptimisticPlan: adopt,
                seal: () => records,
              };
            },
          };
        },
        compilerClientModuleViteEpoch: epoch,
      });

      expect(getter?.()).toEqual([
        expect.objectContaining({
          path: '/c/src/snapshot-button.client.js',
          renderPlanFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          source: expect.stringContaining('SnapshotButton$button_click'),
        }),
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('re-enrolls exact standalone compiler diagnostics in the server dev graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-diagnostic-handoff-'));
    let received: { diagnostics: readonly object[] } | undefined;
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src/app-shell.ts'), 'export default {};\n', 'utf8');
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as KovoViteConfigureServer;
      await plugin.configResolved?.({ command: 'serve', root });
      await plugin.configureServer({
        config: { root },
        middlewares: { use() {} },
        async ssrLoadModule() {
          return {
            createKovoAppShellViteDevIntegration() {
              return {
                onModuleDiagnostics(report: { diagnostics: readonly object[] }) {
                  received = report;
                },
                plugin: { configureServer() {} },
              };
            },
          };
        },
      });

      let thrown: unknown;
      try {
        await plugin.transform?.(
          '// @kovojs-ir\nexport const authoredLoweredIr = true;\n',
          join(root, 'src/authored-ir.ts'),
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/KV235/u);
      expect(received?.diagnostics).toHaveLength(1);
      expect(isRegisteredDiagnostic(received?.diagnostics[0])).toBe(true);
      expect(isRegisteredDiagnostic({ ...received?.diagnostics[0] })).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('threads project-proven stock Better Auth mutation forms through dev transforms', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-dev-auth-forms-'));
    const runtimeSource = `
import { createBetterAuthPostgresAppBindings } from '@kovojs/better-auth/postgres';
const appDatabase = {};
export function createAppAuthBindings(options) {
  return createBetterAuthPostgresAppBindings(appDatabase, { ...options });
}
`;
    const authSource = `
import { createAppAuthBindings } from './_kovo/app-runtime-db.js';
const authBindings = createAppAuthBindings({ csrf: {}, signInAccess: {}, signOutAccess: {} });
export const appSignIn = authBindings.signIn;
export const appSignOut = authBindings.signOut;
`;
    const formsSource = `
import { component, FormError } from '@kovojs/core';
import { appSignIn, appSignOut } from '../auth.js';
export const AuthForms = component({
  mutations: { appSignIn, appSignOut },
  render: () => <>
    <form mutation={appSignIn}>
      <input name="email" />
      <input name="password" />
      <FormError code="INVALID_CREDENTIALS" message="Invalid credentials" />
    </form>
    <form mutation={appSignOut}><button type="submit">Sign out</button></form>
  </>,
});
`;

    try {
      await mkdir(join(root, 'src/_kovo'), { recursive: true });
      await mkdir(join(root, 'src/components'), { recursive: true });
      await writeFile(join(root, 'src/_kovo/app-runtime-db.ts'), runtimeSource, 'utf8');
      await writeFile(join(root, 'src/auth.ts'), authSource, 'utf8');
      await writeFile(join(root, 'src/components/auth-forms.tsx'), formsSource, 'utf8');

      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
      await plugin.configResolved?.({ root });
      const transformed = await plugin.transform?.(
        formsSource,
        join(root, 'src/components/auth-forms.tsx'),
      );

      expect(transformed?.code).toContain('action="/_m/auth/sign-in"');
      expect(transformed?.code).toContain('action="/_m/auth/sign-out"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('adopts one configured compiler owner instead of recompiling its lowered output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-compiler-owner-'));
    const compiler = compilerKovoVitePlugin({ include: ['src'] });

    try {
      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
      await compiler.configResolved?.({ root });
      await plugin.configResolved?.({ plugins: [compiler, plugin], root });

      const transformed = await plugin.transform?.(authoredCardSource, join(root, 'src/card.tsx'));

      expect(transformed).toBeNull();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('refuses to compile imported mutation forms through a factless external owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-factless-mutation-owner-'));
    const compiler = compilerKovoVitePlugin({ include: ['src'] });

    try {
      await writeImportedMutationProject(root);
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as KovoViteConfigureServer;
      await compiler.configResolved?.({ root });

      await expect(plugin.configResolved?.({ plugins: [compiler, plugin], root })).rejects.toThrow(
        /cannot adopt a separately configured compiler owner[\s\S]*1 imported mutation binding[\s\S]*let kovo\(\{ app \}\) be the sole compiler owner/u,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('refuses to compile derived query shapes through a factless external owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-factless-query-owner-'));
    const compiler = compilerKovoVitePlugin({ include: ['src'] });

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await Promise.all([
        writeFile(join(root, 'src/app-shell.ts'), 'export default {};\n', 'utf8'),
        writeFile(
          join(root, 'src/queries.ts'),
          `
import { query, s } from '@kovojs/server';
export const account = query({
  output: s.object({ name: s.string() }),
  load: () => ({ name: 'Ada' }),
});
`,
          'utf8',
        ),
      ]);
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as KovoViteConfigureServer;
      await compiler.configResolved?.({ root });

      await expect(plugin.configResolved?.({ plugins: [compiler, plugin], root })).rejects.toThrow(
        /cannot adopt a separately configured compiler owner[\s\S]*1 query shape[\s\S]*let kovo\(\{ app \}\) be the sole compiler owner/u,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('revokes empty-fact adoption when build inputs later derive imported mutation facts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-late-build-facts-'));
    const compiler = compilerKovoVitePlugin({ include: ['src'] });

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src/app-shell.ts'), 'export default {};\n', 'utf8');
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as KovoViteConfigureServer;
      await compiler.configResolved?.({ command: 'build', root });
      await plugin.configResolved?.({ command: 'build', plugins: [compiler, plugin], root });

      await writeImportedMutationProject(root);
      await expect(plugin.buildStart?.()).rejects.toThrow(/1 imported mutation binding/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('revokes empty-fact adoption when an HMR edit derives imported mutation facts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-late-hmr-facts-'));
    const compiler = compilerKovoVitePlugin({ include: ['src'] });

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src/app-shell.ts'), 'export default {};\n', 'utf8');
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as KovoViteConfigureServer;
      await compiler.configResolved?.({ command: 'serve', root });
      await plugin.configResolved?.({ command: 'serve', plugins: [compiler, plugin], root });

      await writeImportedMutationProject(root);
      await expect(
        plugin.handleHotUpdate?.({
          file: join(root, 'src/components/contact-form.tsx'),
          read: async () => importedMutationFormSource,
          server: { middlewares: { use() {} } },
        }),
      ).rejects.toThrow(/1 imported mutation binding/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      action: '/_m/mutations/add-contact',
      app: '/src/app-shell.ts',
      file: 'src/components/contacts.tsx',
      root: fileURLToPath(new URL('../../../examples/crm/', import.meta.url)),
    },
    {
      action: '/_m/mutations/post-question-mutation',
      app: '/src/app-shell.ts',
      file: 'src/components/question-list.tsx',
      root: fileURLToPath(new URL('../../../examples/stackoverflow/', import.meta.url)),
    },
  ])(
    'compiles $file with server-derived facts under sole ownership',
    async (fixture) => {
      const plugin = kovo({ app: fixture.app }) as unknown as KovoViteConfigureServer;
      await plugin.configResolved?.({ command: 'build', plugins: [plugin], root: fixture.root });
      const source = await readFile(join(fixture.root, fixture.file), 'utf8');

      const transformed = await plugin.transform?.(source, join(fixture.root, fixture.file));

      expect(transformed?.code).toContain(`action="${fixture.action}"`);
    },
    90_000,
  );

  it('does not let a forged structural compiler suppress the built-in compiler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-forged-compiler-owner-'));
    const forged = {
      enforce: 'pre',
      getCssAssetManifest() {
        return { chunks: { base: [], fragments: {}, routes: {} } };
      },
      name: 'kovo',
      transform() {
        return null;
      },
    };

    try {
      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
      await plugin.configResolved?.({ plugins: [forged, plugin], root });

      const transformed = await plugin.transform?.(authoredCardSource, join(root, 'src/card.tsx'));

      expect(transformed?.code).toContain('kovo-c="card"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not let a genuine but narrow compiler suppress the built-in compiler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-narrow-compiler-owner-'));
    const compiler = compilerKovoVitePlugin({ include: ['src/components'] });

    try {
      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
      await compiler.configResolved?.({ root });
      await plugin.configResolved?.({ plugins: [compiler, plugin], root });

      const transformed = await plugin.transform?.(authoredCardSource, join(root, 'src/card.tsx'));

      expect(transformed?.code).toContain('kovo-c="card"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not grant compiler-owner provenance to app-supplied registry or query facts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-authored-compiler-facts-'));
    const candidates = [
      compilerKovoVitePlugin({ include: ['src'], registryFacts: { routes: ['/forged'] } }),
      compilerKovoVitePlugin({ include: ['src'], queryShapeFacts: [] }),
    ];

    try {
      for (const candidate of candidates) {
        const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
        await candidate.configResolved?.({ root });
        await plugin.configResolved?.({ plugins: [candidate, plugin], root });
        const transformed = await plugin.transform?.(
          authoredCardSource,
          join(root, 'src/card.tsx'),
        );
        expect(transformed?.code).toContain('kovo-c="card"');
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not let a replaced genuine transform or custom compiler suppress the built-in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-replaced-compiler-owner-'));
    const genuine = compilerKovoVitePlugin({ include: ['src'] });
    const replaced = { ...genuine, transform: () => null };
    const custom = createKovoVitePlugin(() => ({ diagnostics: [], files: [] }), {
      include: ['src'],
    });

    try {
      expect(Object.isFrozen(genuine)).toBe(true);
      expect(Reflect.set(genuine as object, 'transform', () => null)).toBe(false);
      for (const candidate of [replaced, custom]) {
        const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
        await plugin.configResolved?.({ plugins: [candidate, plugin], root });
        const transformed = await plugin.transform?.(
          authoredCardSource,
          join(root, 'src/card.tsx'),
        );
        expect(transformed?.code).toContain('kovo-c="card"');
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not adopt a full compiler that resolves after the app-shell plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-late-compiler-owner-'));
    const compiler = compilerKovoVitePlugin({ include: ['src'] });

    try {
      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
      await compiler.configResolved?.({ root });
      await plugin.configResolved?.({ plugins: [plugin, compiler], root });

      const transformed = await plugin.transform?.(authoredCardSource, join(root, 'src/card.tsx'));

      expect(transformed?.code).toContain('kovo-c="card"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('assigns source-derived registry identities before app.assemble consumes app modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-derived-registry-'));
    const source = `
import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000032' });

export const addToCart = app.mutation({
  csrf: false,
  csrfJustification: 'fixture-only non-browser mutation identity test',
  input: s.object({ productId: s.string() }),
  handler() {
    return 'ok';
  },
});

export const cartQuery = app.query({
  access: app.publicAccess('fixture-only public query'),
  load: () => ({ count: 1 }),
  reads: [],
});

export default app.assemble({
  mutations: [addToCart],
  queries: [cartQuery],
});
`;

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await mkdir(join(root, 'node_modules/@kovojs'), { recursive: true });
      // Source-derived app registry identities are accepted only through the exact physical server
      // package resolved by TypeScript. Model a real installed app and keep the authored source on
      // disk before Vite takes its project census (SPEC §5.2 / §6.2.1).
      await symlink(
        fileURLToPath(new URL('..', import.meta.url)),
        join(root, 'node_modules/@kovojs/server'),
        'dir',
      );
      await writeFile(join(root, 'src/app-shell.ts'), source, 'utf8');
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as KovoViteConfigureServer;

      await plugin.configResolved?.({ root });
      const transformed = await plugin.transform?.(source, join(root, 'src/app-shell.ts'));

      expect(transformed).toMatchObject({ map: null });
      expect(transformed?.code).toContain(
        "import { assignDerivedMutationKey as __kovoAssignDerivedMutationKey, assignDerivedQueryKey as __kovoAssignDerivedQueryKey } from '@kovojs/server/internal/wire';",
      );
      expect(transformed?.code).toContain(
        'export const addToCart = __kovoAssignDerivedMutationKey(app.mutation({',
      );
      expect(transformed?.code).toContain('"app-shell/add-to-cart"');
      expect(transformed?.code).toContain(
        'export const cartQuery = __kovoAssignDerivedQueryKey(app.query({',
      );
      expect(transformed?.code).toContain('"app-shell/cart-query"');
      expect(transformed?.code).toContain('export default app.assemble({');
      const lowered = evaluateLoweredAppShell(transformed?.code ?? '');
      expect(lowered.addToCart.key).toBe('app-shell/add-to-cart');
      expect(lowered.cartQuery.key).toBe('app-shell/cart-query');
      expect(lowered.app.mutations.map((candidate) => candidate.key)).toEqual([
        'app-shell/add-to-cart',
      ]);
      expect(lowered.app.queries.map((candidate) => candidate.key)).toEqual([
        'app-shell/cart-query',
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('loads the authored app entry default export', async () => {
    const plugin = kovo({ app: '/src/app.tsx' }) as unknown as KovoViteConfigureServer;
    const middlewares: KovoAppShellViteMiddleware[] = [];

    await plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      async ssrLoadModule(id) {
        if (id === '@kovojs/server/internal/app-shell-vite') {
          return {
            createKovoAppShellViteDevIntegration(options: { moduleId: string }) {
              return {
                plugin: {
                  configureServer(server: {
                    middlewares: { use(handler: KovoAppShellViteMiddleware): void };
                    ssrLoadModule(id: string): Promise<Record<string, unknown>>;
                  }) {
                    server.middlewares.use((request, response, next) => {
                      Promise.resolve(server.ssrLoadModule(options.moduleId))
                        .then((module) => {
                          const handler = createRequestHandler(module.default as never);
                          return handler(
                            new Request(`http://example.test${request.url ?? '/'}`, {
                              method: request.method ?? 'GET',
                            }),
                          );
                        })
                        .then(async (webResponse) => {
                          response.writeHead(webResponse.status, {
                            'Content-Type':
                              webResponse.headers.get('content-type') ?? 'text/html; charset=utf-8',
                          });
                          response.end(await webResponse.text());
                        })
                        .catch(next);
                    });
                  },
                },
              };
            },
          };
        }
        expect(id).toBe('/src/app.tsx');
        return {
          default: createApp({
            routes: [
              route('/cart', {
                page: () =>
                  trustedHtml('<main>Cart</main>', {
                    reason: 'framework server rendering test fixture',
                  }),
              }),
            ],
          }),
        };
      },
    });

    const server = createHttpServer((request, response) => {
      runMiddlewareChain(middlewares, request, response, (error) => {
        response.writeHead(error ? 500 : 418, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : 'next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/cart`,
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('<main>Cart</main>');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('rejects generated app entries under late String.includes poisoning', () => {
    const originalIncludes = String.prototype.includes;
    let observed: unknown;
    try {
      String.prototype.includes = () => false;
      try {
        kovo({ app: '/src/generated/app.kovo-route.tsx' });
      } catch (error) {
        observed = error;
      }
    } finally {
      String.prototype.includes = originalIncludes;
    }

    expect(observed).toBeInstanceOf(TypeError);
    expect(String((observed as Error).message)).toContain(
      'kovo({ app }) must point at an authored app entry',
    );
  });

  it('threads compiler route CSS chunks into the app-shell dev handler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-public-vite-css-'));
    const appSource = `
import { defineKovo } from '@kovojs/server';
import * as style from '@kovojs/style';
import { HomeCard } from './components/home-card.js';
import { LoginCard } from './components/login-card.js';

const shellStyles = style.create({ root: { backgroundColor: 'linen' } });
const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000031' });
const home = app.route('/', { page: () => <div style={shellStyles.root}><HomeCard /></div> });
const login = app.route('/login', { page: () => <div style={shellStyles.root}><LoginCard /></div> });

export default app.assemble({ routes: [home, login] });
`;
    const homeSource = `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({ root: { color: 'teal' } });
export const HomeCard = component({
  render: () => <main {...style.attrs(styles.root)}>Home</main>,
});
`;
    const loginSource = `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({ root: { color: 'purple' } });
export const LoginCard = component({
  render: () => <main {...style.attrs(styles.root)}>Login</main>,
});
`;

    try {
      await mkdir(join(root, 'src/components'), { recursive: true });
      await mkdir(join(root, 'node_modules/@kovojs'), { recursive: true });
      // The receiver-bound app contract is authenticated through TypeScript's physical package
      // resolution. Keep this throwaway Vite root equivalent to a real installed app so
      // `app.route(...)` can produce route-level CSS facts instead of silently collapsing to base
      // CSS (SPEC §5.2 rule 6 / §6.2.1).
      await symlink(
        fileURLToPath(new URL('..', import.meta.url)),
        join(root, 'node_modules/@kovojs/server'),
        'dir',
      );
      await writeFile(join(root, 'src/app-shell.tsx'), appSource, 'utf8');
      await writeFile(join(root, 'src/components/home-card.tsx'), homeSource, 'utf8');
      await writeFile(join(root, 'src/components/login-card.tsx'), loginSource, 'utf8');

      const plugin = kovo({ app: '/src/app-shell.tsx' }) as unknown as KovoViteConfigureServer;
      const middlewares: KovoAppShellViteMiddleware[] = [];
      await plugin.configResolved?.({ root });
      await plugin.configureServer(
        withViteRunner({
          config: { root },
          middlewares: {
            use(handler) {
              middlewares.push(handler);
            },
          },
          async ssrLoadModule(id) {
            if (id === '@kovojs/server') {
              return await import('@kovojs/server');
            }
            if (id === '@kovojs/server/internal/app-shell-vite') {
              const module = await import('@kovojs/server/internal/app-shell-vite');
              return {
                claimCompilerClientModuleViteInstaller:
                  module.claimCompilerClientModuleViteInstaller,
                compilerClientModuleViteEpoch: module.compilerClientModuleViteEpoch,
                createKovoAppShellViteDevIntegration: module.createKovoAppShellViteDevIntegration,
                dispatchKovoAppShellViteDevRequest: module.dispatchKovoAppShellViteDevRequest,
              };
            }
            expect(id).toBe('/src/app-shell.tsx');
            return {
              default: createApp({
                routes: [
                  route('/', {
                    page: () =>
                      trustedHtml('<main>Home</main>', {
                        reason: 'framework server rendering test fixture',
                      }),
                  }),
                  route('/login', {
                    page: () =>
                      trustedHtml('<main>Login</main>', {
                        reason: 'framework server rendering test fixture',
                      }),
                  }),
                ],
              }),
            };
          },
        }),
      );
      // Vite's configureServer hook establishes the dev-state epoch before on-demand transforms
      // populate it. Exercise that lifecycle order so this fixture cannot rely on retired
      // cross-configuration compiler caches (SPEC §5.2, §9.5.1).
      await plugin.transform?.(homeSource, join(root, 'src/components/home-card.tsx'));
      await plugin.transform?.(loginSource, join(root, 'src/components/login-card.tsx'));
      await plugin.transform?.(appSource, join(root, 'src/app-shell.tsx'));

      const server = createHttpServer((request, response) => {
        runMiddlewareChain(middlewares, request, response, (error) => {
          response.writeHead(error ? 500 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(error instanceof Error ? error.message : 'vite fallback');
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

      try {
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const homeResponse = await fetch(`${origin}/`);
        const homeBody = await homeResponse.text();
        const homeRouteHref = stylesheetHref(homeBody, /\/assets\/routes\/index-[^"]+\.css/);

        expect(homeResponse.status, homeBody).toBe(200);
        expect(homeBody).toContain(`data-kovo-critical-href="${homeRouteHref}"`);
        expect(homeBody).toContain(homeRouteHref);
        expect(homeBody).toContain('color:teal');
        expect(homeBody).toContain('background-color:linen');
        expect(homeBody).not.toContain('color:purple');
        expect(homeBody).not.toContain('/assets/routes/login');

        const cssResponse = await fetch(`${origin}${homeRouteHref}`);
        const cssBody = await cssResponse.text();

        expect(cssResponse.status, cssBody).toBe(200);
        expect(cssResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
        expect(cssBody).toContain('color:teal');
        expect(cssBody).not.toContain('color:purple');
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function runMiddlewareChain(
  middlewares: readonly KovoAppShellViteMiddleware[],
  request: Parameters<KovoAppShellViteMiddleware>[0],
  response: Parameters<KovoAppShellViteMiddleware>[1],
  done: (error?: unknown) => void,
): void {
  let index = 0;
  const next = (error?: unknown) => {
    if (error || index >= middlewares.length) {
      done(error);
      return;
    }
    const middleware = middlewares[index++];
    if (!middleware) {
      done();
      return;
    }
    middleware(request, response, next);
  };
  next();
}

function evaluateLoweredAppShell(source: string): {
  addToCart: { key: string };
  app: {
    mutations: Array<{ key: string }>;
    queries: Array<{ key: string }>;
  };
  cartQuery: { key: string };
} {
  const executable = source
    .replace(/^import .*;\n/gm, '')
    .replace('export const addToCart =', 'const addToCart =')
    .replace('export const cartQuery =', 'const cartQuery =')
    .replace('export default app.assemble(', 'const assembled = app.assemble(');
  return runInNewContext(
    `${executable}\n;({ app: assembled, addToCart, cartQuery });`,
    {
      __kovoAssignDerivedMutationKey: assignDerivedMutationKey,
      __kovoAssignDerivedQueryKey: assignDerivedQueryKey,
      defineKovo() {
        return {
          assemble: createApp,
          mutation,
          publicAccess: () => ({ kind: 'public' }),
          query,
        };
      },
      s,
    },
    { timeout: 1000 },
  );
}

function stylesheetHref(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  if (!match?.[0])
    throw new Error(
      `Expected stylesheet href matching ${pattern}. Asset snippets:\n${assetSnippets(html)}`,
    );
  return match[0];
}

function assetSnippets(html: string): string {
  const snippets: string[] = [];
  const pattern = /\/assets\/[^"'<> )]+/g;
  for (const match of html.matchAll(pattern)) {
    const start = Math.max(0, match.index - 120);
    const end = Math.min(html.length, match.index + match[0].length + 120);
    snippets.push(html.slice(start, end));
  }
  return snippets.join('\n---\n') || html.slice(-2000);
}
