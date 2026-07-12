import type { KovoApp } from '@kovojs/server';
import {
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  type KovoDeclaredWriteDbCapable,
} from '@kovojs/server/internal/execution';
import { afterEach, describe, expect, it } from 'vitest';

import type { PgliteTestDb } from '../pglite.js';
import { deferred } from '../test-fixtures.js';
import type { KovoFixtureDescriptor } from './define-fixture.js';
import { createFixtureInstance, type FixtureInstance } from './fixture-instance.js';

let instance: FixtureInstance | undefined;

afterEach(async () => {
  await instance?.close();
  instance = undefined;
});

describe('integration fixture verifier security', () => {
  it('C150 snapshots query policy before late definition mutation and find/map hooks', async () => {
    const reads = [{ key: 'cart' }];
    let db!: PgliteTestDb;
    const query = {
      key: 'products',
      reads,
      async load() {
        await db.read('products');
        reads.push({ key: 'product' });
        Object.defineProperty(app.queries, 'find', {
          value: () => query,
        });
        Object.defineProperty(reads, 'map', {
          value: () => ['cart', 'product'],
        });
        return [];
      },
    };
    const app = { queries: [query] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {},
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      await query.load();
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/_q/products'));
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV407');
  });

  it('C152 uses a witnessed Response after an authored loader replaces the global', async () => {
    const NativeResponse = globalThis.Response;
    let db!: PgliteTestDb;
    const query = {
      key: 'products',
      reads: [{ key: 'cart' }],
      async load() {
        await db.read('products');
        globalThis.Response = function PoisonedResponse() {
          return new NativeResponse('bypassed', { status: 200 });
        } as typeof Response;
      },
    };
    const app = { queries: [query] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {},
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };
    const success = new NativeResponse('ok');

    try {
      instance = await createFixtureInstance(descriptor, () => async () => {
        await query.load();
        return success;
      });

      const response = await instance.handle(new Request('http://fixture.local/_q/products'));
      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toContain('KV407');
    } finally {
      globalThis.Response = NativeResponse;
    }
  });

  it('C153 keeps a database retained by seed inside runtime verification', async () => {
    let seedDb!: PgliteTestDb;
    const query = {
      key: 'products',
      reads: [{ key: 'cart' }],
      async load() {
        await seedDb.read('products');
      },
    };
    const app = { queries: [query] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app,
        schema: 'create table products (id text primary key)',
        seed(db) {
          seedDb = db;
        },
        touchGraph: {},
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      await query.load();
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/_q/products'));
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV407');
  });

  it('C153 does not let setup writes satisfy runtime coverage diagnostics', async () => {
    const app = { queries: [] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app,
        schema: 'create table products (id text primary key)',
        seed(db) {
          return db.write('products', { id: 'p1' });
        },
        touchGraph: {
          'product/update': {
            touches: [
              {
                domain: 'product',
                keys: null,
                site: 'product.ts:1',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => new Response('ok'));

    expect(instance.verificationDiagnostics()).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KV403' })]),
    );
  });

  it('C191 captures the engine reader hook before retained seed code can replace it', async () => {
    const app = { queries: [] } as unknown as KovoApp;
    let readerTarget!: PgliteTestDb;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app,
        schema: 'create table products (id text primary key)',
        seed(db) {
          Object.defineProperty(db, kovoReadonlyDbHandle, {
            configurable: true,
            value: () => db,
          });
        },
      },
    };

    instance = await createFixtureInstance(
      descriptor,
      () => async () => new Response('ok'),
      (authoredApp, _db, capabilities) => {
        readerTarget = capabilities.readonly() as PgliteTestDb;
        return { app: authoredApp, managesDb: false };
      },
    );

    await expect(
      readerTarget.query({
        text: 'insert into products (id) values ($1)',
        values: ['escaped'],
      }),
    ).rejects.toThrow(/read.only/u);
    await expect(instance.db.query('select id from products')).resolves.toEqual([]);
  });

  it('C191 blocks a retained seed handle from vending an unobserved writer', async () => {
    let retainedDb!: PgliteTestDb;
    let capabilityBlocked = false;
    const query = { key: 'products', reads: [] };
    const app = { queries: [query] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app,
        schema: 'create table products (id text primary key)',
        seed(db) {
          retainedDb = db;
        },
        touchGraph: {},
        verification: { domainByTable: { products: 'product' } },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      try {
        const writer = (retainedDb as PgliteTestDb & KovoDeclaredWriteDbCapable<PgliteTestDb>)[
          kovoDeclaredWriteDbHandle
        ]({
          dialect: 'postgres',
          tables: ['products'],
          touches: [],
        });
        await writer.query({
          text: 'insert into products (id) values ($1)',
          values: ['escaped'],
        });
      } catch {
        capabilityBlocked = true;
      }
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/_q/products'));
    expect(response.status).toBe(200);
    expect(capabilityBlocked).toBe(true);
    await expect(instance.db.query('select id from products')).resolves.toEqual([]);
  });

  it('C160 snapshots a query verification path before an authored handler replaces it', async () => {
    let db!: PgliteTestDb;
    const app = {
      queries: [
        { key: 'cart', reads: [{ key: 'cart' }] },
        { key: 'products', reads: [{ key: 'product' }] },
      ],
    } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {},
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async (request) => {
      await db.read('products');
      Object.defineProperty(request, 'url', {
        configurable: true,
        value: 'http://fixture.local/_q/products',
      });
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/_q/cart'));
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV407');
  });

  it('C160 snapshots a mutation verification path before an authored handler replaces it', async () => {
    let db!: PgliteTestDb;
    const app = { queries: [] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {
          'cart/add': {
            touches: [
              {
                domain: 'cart',
                keys: null,
                site: 'cart.ts:1',
                via: 'cart_items',
              },
            ],
            unresolved: [],
          },
          'product/update': {
            touches: [
              {
                domain: 'product',
                keys: null,
                site: 'product.ts:1',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async (request) => {
      await db.write('products', { id: 'p1' });
      Object.defineProperty(request, 'url', {
        configurable: true,
        value: 'http://fixture.local/_m/product%2Fupdate',
      });
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/_m/cart%2Fadd'));
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV402');
  });

  it('C187 pins Request.url before a poisoned getter can switch mutation scope', async () => {
    let db!: PgliteTestDb;
    const app = { queries: [] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {
          'cart/add': {
            touches: [
              {
                domain: 'cart',
                keys: null,
                site: 'cart.ts:1',
                via: 'cart_items',
              },
            ],
            unresolved: [],
          },
          'product/update': {
            touches: [
              {
                domain: 'product',
                keys: null,
                site: 'product.ts:1',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        verification: { domainByTable: { products: 'product' } },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      await db.write('products', { id: 'p1' });
      return new Response('ok');
    });
    const request = new Request('http://fixture.local/_m/cart%2Fadd');
    const urlDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'url');
    if (urlDescriptor === undefined) throw new TypeError('Request.url getter is unavailable.');
    let response!: Response;
    try {
      Object.defineProperty(Request.prototype, 'url', {
        configurable: true,
        get: () => 'http://fixture.local/_m/product%2Fupdate',
      });
      response = await instance.handle(request);
    } finally {
      Object.defineProperty(Request.prototype, 'url', urlDescriptor);
    }

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV402');
  });

  it('C187 pins URL.pathname before a poisoned getter can switch query scope', async () => {
    let db!: PgliteTestDb;
    const app = {
      queries: [
        { key: 'cart', reads: [{ key: 'cart' }] },
        { key: 'products', reads: [{ key: 'product' }] },
      ],
    } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {},
        verification: { domainByTable: { products: 'product' } },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      await db.read('products');
      return new Response('ok');
    });
    const pathnameDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'pathname');
    if (pathnameDescriptor === undefined)
      throw new TypeError('URL.pathname getter is unavailable.');
    let response!: Response;
    try {
      Object.defineProperty(URL.prototype, 'pathname', {
        configurable: true,
        get: () => '/_q/products',
      });
      response = await instance.handle(new Request('http://fixture.local/_q/cart'));
    } finally {
      Object.defineProperty(URL.prototype, 'pathname', pathnameDescriptor);
    }

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV407');
  });

  it('C187 pins verification-error classification against late Error and RegExp poisoning', async () => {
    const NativeError = globalThis.Error;
    const nativeRegExpTest = RegExp.prototype.test;
    let db!: PgliteTestDb;
    const app = { queries: [{ key: 'products', reads: [{ key: 'cart' }] }] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {},
        verification: { domainByTable: { products: 'product' } },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      await db.read('products');
      globalThis.Error = function PoisonedError(message?: string) {
        return new NativeError(message);
      } as ErrorConstructor;
      RegExp.prototype.test = function poisonedTest(value: string): boolean {
        if (value.startsWith('KV407')) return false;
        return Reflect.apply(nativeRegExpTest, this, [value]);
      };
      return new Response('ok');
    });
    let response!: Response;
    try {
      response = await instance.handle(new Request('http://fixture.local/_q/products'));
    } finally {
      globalThis.Error = NativeError;
      RegExp.prototype.test = nativeRegExpTest;
    }

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV407');
  });

  it('C163 rejects undeclared database reads during a route-page request', async () => {
    let db!: PgliteTestDb;
    const app = { queries: [] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {},
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      await db.read('products');
      descriptor.definition.routeReads = { '/products': ['product'] };
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/products'));
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV407');
  });

  it('C163 accepts route-page reads declared before fixture dispatch', async () => {
    let db!: PgliteTestDb;
    const app = { queries: [] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        routeReads: { '/products': ['product'] },
        schema: 'create table products (id text primary key)',
        touchGraph: {},
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      await db.read('products');
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/products'));
    expect(response.status).toBe(200);
  });

  it('C165 rejects database writes during a route-page request', async () => {
    let db!: PgliteTestDb;
    const app = { queries: [] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {},
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      await db.write('products', { id: 'p1' });
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/products'));
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV402');
  });

  it('C235 revokes route handler descendants after request verification settles', async () => {
    const gate = deferred();
    let db!: PgliteTestDb;
    let detached!: Promise<unknown>;
    const app = { queries: [] } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table audit_log (id text primary key)',
        touchGraph: {},
        verification: {
          domainByTable: { audit_log: 'audit' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      detached = gate.promise.then(() => db.write('audit_log', { id: 'event-1' }));
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/audit'));
    expect(response.status).toBe(200);
    gate.resolve();

    await expect(detached).rejects.toThrow(/KV407.*capture.*settled/u);
    await expect(instance.db.read('audit_log')).resolves.toEqual([]);
  });

  it('C166 rejects database writes during a query request', async () => {
    let db!: PgliteTestDb;
    const app = {
      queries: [{ key: 'products', reads: [{ key: 'product' }] }],
    } as unknown as KovoApp;
    const descriptor: KovoFixtureDescriptor = {
      __kovoIntegrationFixture: true,
      definition: {
        app: ({ db: fixtureDb }) => {
          db = fixtureDb;
          return app;
        },
        schema: 'create table products (id text primary key)',
        touchGraph: {},
        verification: {
          domainByTable: { products: 'product' },
        },
      },
    };

    instance = await createFixtureInstance(descriptor, () => async () => {
      await db.write('products', { id: 'p1' });
      return new Response('ok');
    });

    const response = await instance.handle(new Request('http://fixture.local/_q/products'));
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV402');
  });
});
