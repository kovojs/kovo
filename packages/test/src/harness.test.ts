import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { KovoCheckInput } from '@kovojs/core/internal/graph';
import { defineKovo } from '../../server/src/app-contract.js';
import {
  assignDerivedMutationKey,
} from '../../server/src/mutation/definition.js';
import { assignDerivedQueryKey } from '../../server/src/query.js';
import { s } from '../../server/src/schema.js';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import {
  createKovoGraphProof,
  createKovoRuntimePostureManifest,
} from '../../cli/src/graph-proof.js';
import {
  createKovoTestHarness,
  type KovoTestDb,
  type KovoTestMutationError,
  type KovoTestMutationInput,
  type KovoTestMutationResult,
  type KovoTestMutationValue,
  type KovoTestQueryInput,
  type KovoTestQueryResult,
  type KovoTestRequest,
  type KovoTestRouteKey,
} from './harness.js';

const APP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_APP_ID = '22222222-2222-4222-8222-222222222222';
const roots: string[] = [];

interface TestDb {
  cart: string[];
}

function testApp(appId: typeof APP_ID | typeof OTHER_APP_ID = APP_ID) {
  const db: TestDb = { cart: [] };
  const contract = defineKovo({
    appId,
    db: () => db,
    egress: { enabled: false, justification: 'isolated app-scoped harness test' },
  });
  const cartQuery = assignDerivedQueryKey(
    contract.query({
      access: contract.publicAccess('test query'),
      args: s.object({ cartId: s.string() }),
      load(input, context) {
        return { cartId: input.cartId, items: context.db.cart };
      },
    }),
    'cart/read',
  );
  const addToCart = assignDerivedMutationKey(
    contract.mutation({
      access: contract.publicAccess('test mutation'),
      csrf: false,
      csrfJustification: 'direct non-browser harness execution',
      errors: { SOLD_OUT: s.object({ productId: s.string() }) },
      input: s.object({ productId: s.string() }),
      handler(input, request, context) {
        if (input.productId === 'sold-out') {
          return context.fail('SOLD_OUT', { productId: input.productId });
        }
        request.db.cart.push(input.productId);
        return { count: request.db.cart.length };
      },
    }),
    'cart/add',
  );
  const cartRoute = contract.route('/cart', {
    access: contract.publicAccess('test route'),
    page: () => '<main><h1>Cart</h1></main>',
  });
  const app = contract.assemble({
    mutations: [addToCart],
    queries: [cartQuery],
    routes: [cartRoute],
  });
  return { addToCart, app, cartQuery, db };
}

afterEach(async () => {
  const pending = roots.splice(0);
  await Promise.all(pending.map((root) => rm(root, { force: true, recursive: true })));
});

describe('@kovojs/test app-scoped harness', () => {
  it('infers app DB, request, route, mutation, query, result, and declared error types', () => {
    const fixture = testApp();
    type App = typeof fixture.app;

    expectTypeOf<KovoTestDb<App>>().toEqualTypeOf<TestDb>();
    expectTypeOf<KovoTestRequest<App>>().toMatchTypeOf<{ db: TestDb }>();
    expectTypeOf<KovoTestRouteKey<App>>().toEqualTypeOf<'/cart'>();
    expectTypeOf<KovoTestMutationInput<typeof fixture.addToCart>>().toEqualTypeOf<{
      productId: string;
    }>();
    expectTypeOf<KovoTestMutationValue<typeof fixture.addToCart>>().toEqualTypeOf<{
      count: number;
    }>();
    expectTypeOf<KovoTestMutationError<typeof fixture.addToCart>>().toMatchTypeOf<{
      error: { code: 'SOLD_OUT'; payload: { productId: string } };
      ok: false;
    }>();
    expectTypeOf<KovoTestMutationResult<typeof fixture.addToCart>>().toMatchTypeOf<
      | { ok: false }
      | {
          input: { productId: string };
          ok: true;
          value: { count: number };
        }
    >();
    expectTypeOf<KovoTestQueryInput<typeof fixture.cartQuery>>().toEqualTypeOf<{
      cartId: string;
    }>();
    expectTypeOf<KovoTestQueryResult<typeof fixture.cartQuery>>().toEqualTypeOf<{
      cartId: string;
      items: string[];
    }>();
  });

  it('executes only imported app handles and obtains graph facts from the verified artifact', async () => {
    const fixture = testApp();
    const artifact = await writeArtifact(APP_ID);
    const harness = await createKovoTestHarness(fixture.app, {
      artifact: artifact.path,
      db: fixture.db,
      projectRoot: artifact.root,
      verification: { domainByTable: { cart_items: 'cart' } },
    });

    await expect(harness.exec(fixture.addToCart, { productId: 'p1' })).resolves.toMatchObject({
      ok: true,
      value: { count: 1 },
    });
    await expect(harness.query(fixture.cartQuery, { cartId: 'c1' })).resolves.toEqual({
      cartId: 'c1',
      items: ['p1'],
    });
    expect(harness.db).toBeDefined();
    expect(harness.verificationDiagnostics()).toEqual([
      expect.objectContaining({ code: 'KV403', domain: 'cart' }),
    ]);

    const rejectWrongInput = () => {
      // @ts-expect-error Mutation input is inferred from the app-owned handle.
      void harness.exec(fixture.addToCart, { product: 'p2' });
      // @ts-expect-error Query input is inferred from the app-owned handle.
      void harness.query(fixture.cartQuery, { id: 'c1' });
      // @ts-expect-error Page accepts only exact route keys assembled into this app.
      void harness.page('/missing');
    };
    expect(rejectWrongInput).toBeTypeOf('function');
  });

  it('rejects a source or config changed after the successful build', async () => {
    const fixture = testApp();
    const artifact = await writeArtifact(APP_ID);
    await writeFile(join(artifact.root, 'src/app.ts'), 'export default \"changed\";\\n');

    await expect(
      createKovoTestHarness(fixture.app, {
        artifact: artifact.path,
        db: fixture.db,
        projectRoot: artifact.root,
      }),
    ).rejects.toThrow(/source src\/app\.ts changed after the build/u);
  });

  it('rejects partial and failed-build graph evidence', async () => {
    const fixture = testApp();
    const partial = await writeArtifact(APP_ID, (graph) => {
      delete graph.proof;
      delete graph.runtimePosture;
    });
    await expect(
      createKovoTestHarness(fixture.app, {
        artifact: partial.path,
        db: fixture.db,
        projectRoot: partial.root,
      }),
    ).rejects.toThrow(/missing kovo\.graph\.proof\/v2 completion/u);

    const failed = await writeArtifact(APP_ID, (graph) => {
      graph.proof = {
        ...graph.proof!,
        completion: 'failed',
      } as unknown as NonNullable<KovoCheckInput['proof']>;
    });
    await expect(
      createKovoTestHarness(fixture.app, {
        artifact: failed.path,
        db: fixture.db,
        projectRoot: failed.root,
      }),
    ).rejects.toThrow(/incomplete or failed build/u);
  });

  it('rejects a digest-consistent artifact produced for another app', async () => {
    const fixture = testApp();
    const artifact = await writeArtifact(OTHER_APP_ID);

    await expect(
      createKovoTestHarness(fixture.app, {
        artifact: artifact.path,
        db: fixture.db,
        projectRoot: artifact.root,
      }),
    ).rejects.toThrow(new RegExp(`belongs to app ${OTHER_APP_ID}.*${APP_ID}`, 'u'));
  });

  it('rejects apps and artifacts with no stable app identity', async () => {
    const db: TestDb = { cart: [] };
    const contract = defineKovo({
      db: () => db,
      egress: { enabled: false, justification: 'isolated omitted-app-id test' },
    });
    const app = contract.assemble({});
    const artifact = await writeArtifact(null);

    await expect(
      createKovoTestHarness(app, {
        artifact: artifact.path,
        db,
        projectRoot: artifact.root,
      }),
    ).rejects.toThrow(/require defineKovo\(\{ appId \}\)/u);
  });

  it('requires explicit absolute artifact and project paths', async () => {
    const fixture = testApp();
    await expect(
      createKovoTestHarness(fixture.app, {
        artifact: 'dist/.kovo/graph.json',
        db: fixture.db,
        projectRoot: '.',
      }),
    ).rejects.toThrow(/artifact must be an explicit absolute path/u);
  });
});

async function writeArtifact(
  appId: string | null,
  mutate?: (graph: KovoCheckInput) => void,
): Promise<{ path: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kovo-app-harness-'));
  roots.push(root);
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: \"9.0\"\\n');
  await writeFile(join(root, 'kovo.config.ts'), 'export default { preset: \"node\" };\\n');
  const sourceRoot = join(root, 'src');
  await mkdir(sourceRoot);
  const appSource = 'export default \"app\";\\n';
  const configSource = 'export default { preset: \"node\" };\\n';
  await writeFile(join(root, 'src/app.ts'), appSource);

  const lockBytes = await readFile(join(root, 'pnpm-lock.yaml'));
  const graph: KovoCheckInput = {
    analysisInputs: {
      runtimeTarget: 'node',
      schema: 'kovo.analysis.inputs/v1',
      sources: [
        analyzedSource('kovo.config.ts', 'config', configSource),
        analyzedSource('src/app.ts', 'app', appSource),
      ],
    },
    mutations: [{ auth: 'public:test mutation', csrf: 'exempt', key: 'cart/add' }],
    provenance: {
      frameworkPackages: [{ name: '@kovojs/compiler', version: '0.2.0' }],
      graphSchemaVersion: 'kovo.graph/v2',
      pnpmLock: {
        contentHash: `sha256:${createHash('sha256').update(lockBytes).digest('hex')}`,
      },
      schema: 'kovo.artifact.provenance/v1',
      securityGuarantees: {
        canonicalHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        schema: 'kovo.security.guarantees/v1',
      },
    },
    queries: [{ domains: ['cart'], query: 'cart/read' }],
    touchGraph: {
      'cart/add': {
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'src/app.ts:1',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    },
  };
  graph.proof = createKovoGraphProof(
    graph,
    'b'.repeat(64),
    appId === null ? undefined : appId,
  );
  graph.runtimePosture = createKovoRuntimePostureManifest(graph);
  mutate?.(graph);
  const path = join(root, 'graph.json');
  await writeFile(path, JSON.stringify(graph));
  return { path, root };
}

function analyzedSource(
  path: string,
  role: 'app' | 'config',
  source: string,
): {
  codeUnitLength: number;
  contentHash: `sha256:${string}`;
  encoding: 'utf16le';
  path: string;
  role: 'app' | 'config';
} {
  return {
    codeUnitLength: source.length,
    contentHash: `sha256:${createHash('sha256')
      .update(Buffer.from(source, 'utf16le'))
      .digest('hex')}`,
    encoding: 'utf16le',
    path,
    role,
  };
}
