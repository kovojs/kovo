import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { kovo } from './vite.js';

// SPEC.md §11.4 (shared verification surface) / §10.2 / §10.3 / §9.5.1: the data-plane safety
// gates (KV422 SQL injection, KV410/KV411 opaque projection/read set, KV429 lost update) must run
// on the DEFAULT Vite build path, not only via the `kovo` CLI. These tests verify the gate
// MECHANISM with SYNTHETIC fixtures (not the real examples): an injection fixture must fail the
// build fail-closed, and a clean fixture must pass.

/** Structural view of the hooks the public Kovo Vite plugin exposes for the data-plane gate. */
interface DataPlaneGatePlugin {
  buildStart(): void | Promise<void>;
  configResolved(config: { command?: 'build' | 'serve'; root: string }): void | Promise<void>;
  configureServer(server: DataPlaneGateMockServer): void | Promise<void>;
  handleHotUpdate(context: {
    file: string;
    modules?: readonly unknown[];
    read(): Promise<string>;
    server: DataPlaneGateMockServer;
  }): Promise<readonly unknown[]>;
  load(id: string): null | Promise<null | string> | string;
  resolveId(source: string, importer?: string): null | Promise<null | string> | string;
  transform(
    source: string,
    id: string,
  ): null | Promise<null | { code: string; map: null }> | { code: string; map: null };
}

interface DataPlaneGateMockServer {
  config?: { root?: string };
  middlewares: { use(handler: unknown): void };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  ws?: { send(payload: unknown): void };
}

interface CapturedReport {
  diagnostics: readonly { code: string; message: string }[];
  fileName: string;
}

const APP_ENTRY = '/src/app.tsx';
const APP_SOURCE = `import { createApp } from '@kovojs/server';\nexport default createApp({ routes: [] });\n`;

// KV422: request-derived data concatenated into executable SQL text at a managed sink.
const KV422_INJECTION = `
export async function loadProducts(input: { id: string }, db: any) {
  await db.execute("select * from products where id = '" + input.id + "'");
}
`;

// Clean: branded sql\`...\` placeholder — the SQL text is static, the value is a bound parameter.
const KV422_CLEAN = `
import { sql } from '@kovojs/drizzle';
export async function loadProducts(input: { id: string }, db: any) {
  await db.execute(sql\`select * from products where id = \${input.id}\`);
}
`;

// KV410: opaque sql<number> projection in a query loader without a declared output schema.
const KV410_OPAQUE = `
export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));
export const cartQuery = query("cart", {
  async load(input, db: PgAsyncDatabase<any, any>) {
    return db.select({ count: sql<number>\`count(*)\` }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
  },
});
`;

// Drizzle type augmentation that exposes the global PgAsyncDatabase alias so the query-loader
// chain (db.select(...).from(...).where(...)) resolves for opaque-projection analysis.
const PG_GLOBAL_TYPES = [
  'import "drizzle-orm/pg-core";',
  'declare module "drizzle-orm/pg-core" {',
  '  export interface PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> {}',
  '}',
  'declare global {',
  '  type PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> = import("drizzle-orm/pg-core").PgAsyncDatabase<any, any>;',
  '}',
].join('\n');

// KV429: single-row self-referential atomic decrement with no compare-and-set/version guard.
const KV429_SCHEMA = [
  'export const products = pgTable("products", {',
  '  id: text("id").primaryKey(),',
  '  stock: integer("stock").notNull(),',
  '  ver: integer("ver").notNull(),',
  '}, kovo({ domain: "product", key: "id", atomic: "stock", version: "ver" }));',
].join('\n');

const KV429_DOMAIN = [
  'import { and, eq, sql } from "drizzle-orm";',
  'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
  'import { products } from "./schema";',
  '',
  'export const buy = async (db: PgAsyncDatabase<any, any>, input: { id: string; qty: number }) => {',
  '  await db.update(products).set({ stock: sql`${products.stock} - ${input.qty}` }).where(eq(products.id, input.id));',
  '};',
  '',
].join('\n');

const DRIZZLE_RUNTIME_REGISTRY_TYPES = [
  'import "drizzle-orm/pg-core";',
  'declare module "drizzle-orm/pg-core" {',
  '  export interface PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> {',
  '    insert(table: unknown): { values(value: unknown): Promise<void> };',
  '    select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
  '  }',
  '}',
  'declare global {',
  '  type PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> = import("drizzle-orm/pg-core").PgAsyncDatabase<any, any>;',
  '}',
].join('\n');

const DRIZZLE_RUNTIME_REGISTRY_SOURCE = [
  'import { mutation, query } from "@kovojs/server";',
  'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
  '',
  'interface AppRequest { db: PgAsyncDatabase<any, any> }',
  'export const contacts = pgTable("contacts", { id: text("id").primaryKey() }, kovo({ domain: "contact", key: "id" }));',
  '',
  'export const contactsQuery = query("contacts", {',
  '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
  '    return db.select({ id: contacts.id }).from(contacts);',
  '  },',
  '});',
  '',
  'export const addContact = mutation("addContact", {',
  '  async handler(input: { id: string }, request: AppRequest) {',
  '    const db = request.db;',
  '    await db.insert(contacts).values({ id: input.id });',
  '    return { id: input.id };',
  '  },',
  '});',
].join('\n');

const DRIZZLE_QUERY_SHAPE_TYPES = [
  'import "drizzle-orm/pg-core";',
  'declare module "drizzle-orm/pg-core" {',
  '  export interface PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> {',
  '    select(value?: unknown): { from(table: unknown): { leftJoin(table: unknown, on: unknown): Promise<unknown[]> } };',
  '  }',
  '}',
  'declare global {',
  '  type PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> = import("drizzle-orm/pg-core").PgAsyncDatabase<any, any>;',
  '}',
].join('\n');

const DRIZZLE_QUERY_SHAPE_SOURCE = [
  'import { query } from "@kovojs/server";',
  'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
  '',
  'export const products = pgTable("products", {',
  '  id: text("id").primaryKey(),',
  '  name: text("name").notNull(),',
  '}, kovo({ domain: "product", key: "id" }));',
  'export const reviews = pgTable("reviews", {',
  '  productId: text("product_id"),',
  '  rating: integer("rating"),',
  '}, kovo({ domain: "review", key: "productId" }));',
  '',
  'export const productQuery = query("product", {',
  '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
  '    return db.select({',
  '      name: products.name,',
  '      review: { rating: reviews.rating },',
  '    }).from(products).leftJoin(reviews, eq(reviews.productId, products.id));',
  '  },',
  '});',
].join('\n');

const SHAPE_DEPENDENT_COMPONENT = [
  'import { component } from "@kovojs/server";',
  '',
  'export const ProductCard = component({',
  '  queries: { product: {} },',
  '  render: () => (',
  '    <article>',
  '      <span data-bind="product.review.rating">Rating</span>',
  '      <span data-bind="product.missing">Missing</span>',
  '      <span data-bind="product.review?.rating">Optional rating</span>',
  '    </article>',
  '  ),',
  '});',
].join('\n');

const VALID_SHAPE_COMPONENT = [
  'import { component } from "@kovojs/server";',
  '',
  'export const ProductCard = component({',
  '  queries: { product: {} },',
  '  render: () => (',
  '    <article>',
  '      <span data-bind="product.name">Name</span>',
  '      <span data-bind="product.review?.rating">Optional rating</span>',
  '    </article>',
  '  ),',
  '});',
].join('\n');

const NON_DRIZZLE_OUTPUT_QUERY_SOURCE = [
  'import { query, s } from "@kovojs/server";',
  '',
  'export const status = query({',
  '  reads: [],',
  '  output: s.object({',
  '    summary: s.string(),',
  '    generatedAt: s.string(),',
  '    metrics: s.object({ count: s.number().optional() }),',
  '  }),',
  '  load: () => ({ summary: "ready", generatedAt: "now", metrics: {} }),',
  '});',
].join('\n');

const NON_DRIZZLE_OUTPUT_VALID_COMPONENT = [
  'import { component } from "@kovojs/server";',
  'import { status } from "../status";',
  '',
  'export const StatusCard = component({',
  '  queries: { status },',
  '  render: ({ status }) => (',
  '    <article>',
  '      <span data-bind="status.summary">{status.summary}</span>',
  '      <time data-bind="status.generatedAt">{status.generatedAt}</time>',
  '      <span data-bind="status.metrics.count">{status.metrics.count}</span>',
  '    </article>',
  '  ),',
  '});',
].join('\n');

const NON_DRIZZLE_OUTPUT_INVALID_COMPONENT = [
  'import { component } from "@kovojs/server";',
  'import { status } from "../status";',
  '',
  'export const StatusCard = component({',
  '  queries: { status },',
  '  render: () => (',
  '    <article>',
  '      <span data-bind="status.summary">Summary</span>',
  '      <span data-bind="status.missing">Missing</span>',
  '    </article>',
  '  ),',
  '});',
].join('\n');

const NON_DRIZZLE_OUTPUT_ALIAS_QUERY_SOURCE = [
  'import { query, s } from "@kovojs/server";',
  '',
  'export const statusQuery = query({',
  '  reads: [],',
  '  output: s.object({',
  '    summary: s.string(),',
  '    generatedAt: s.string(),',
  '    totals: s.object({ streams: s.number() }),',
  '  }),',
  '  load: () => ({ summary: "ready", generatedAt: "now", totals: { streams: 1 } }),',
  '});',
].join('\n');

const NON_DRIZZLE_OUTPUT_ALIAS_COMPONENT = [
  'import { component } from "@kovojs/server";',
  'import { statusQuery } from "../status";',
  '',
  'export const StatusCard = component({',
  '  queries: { status: statusQuery },',
  '  render: ({ status }) => (',
  '    <article>',
  '      <span data-bind="status.summary">{status.summary}</span>',
  '      <time data-bind="status.generatedAt">{status.generatedAt}</time>',
  '      <span data-bind="status.totals.streams">{status.totals.streams}</span>',
  '    </article>',
  '  ),',
  '});',
].join('\n');

// Synthetic drizzle-orm type augmentation so the KV429 symbolic-effect lowering resolves the
// update/set/where chain (mirrors the @kovojs/drizzle KV429 unit fixtures).
const DRIZZLE_TYPES = [
  'import "drizzle-orm/pg-core";',
  'declare module "drizzle-orm/pg-core" {',
  '  export interface PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> {',
  '    update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
  '  }',
  '}',
].join('\n');

let roots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-gate-'));
  roots.push(root);
  const all = { 'src/app.tsx': APP_SOURCE, ...files };
  for (const [relativePath, source] of Object.entries(all)) {
    const target = join(root, relativePath);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, source, 'utf8');
  }
  return root;
}

beforeEach(() => {
  roots = [];
});

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe('public Kovo Vite plugin: data-plane safety gate (SPEC.md §11.4)', () => {
  it('fails the build fail-closed on a KV422 SQL-injection fixture', async () => {
    const root = await fixture({ 'src/queries/search.ts': KV422_INJECTION });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    await expect(plugin.buildStart()).rejects.toThrow(
      /data-plane safety gate failed[\s\S]*ERROR KV422[\s\S]*search\.ts/,
    );
  });

  it('passes the build on a clean (branded sql`...`) fixture', async () => {
    const root = await fixture({ 'src/queries/search.ts': KV422_CLEAN });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    await expect(plugin.buildStart()).resolves.toBeUndefined();
  });

  it('fails the build on a KV410 opaque-projection fixture', async () => {
    const root = await fixture({
      'src/cart.queries.ts': KV410_OPAQUE,
      'src/drizzle-types.d.ts': PG_GLOBAL_TYPES,
    });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    await expect(plugin.buildStart()).rejects.toThrow(/ERROR KV410[\s\S]*cart\.queries\.ts/);
  });

  it('fails the build on a KV429 lost-update fixture', async () => {
    const root = await fixture({
      'src/drizzle-types.d.ts': DRIZZLE_TYPES,
      'src/inventory.domain.ts': KV429_DOMAIN,
      'src/schema.ts': KV429_SCHEMA,
    });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    await expect(plugin.buildStart()).rejects.toThrow(/ERROR KV429[\s\S]*inventory\.domain\.ts/);
  });

  it('injects a runtime registry module derived from Drizzle query reads and mutation handlers', async () => {
    const root = await fixture({
      'src/contacts.ts': DRIZZLE_RUNTIME_REGISTRY_SOURCE,
      'src/drizzle-types.d.ts': DRIZZLE_RUNTIME_REGISTRY_TYPES,
    });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    const transformed = await plugin.transform(APP_SOURCE, join(root, 'src/app.tsx'));
    expect(transformed?.code).toContain('virtual:kovo-runtime-registry:/src/app.tsx');

    const registryId = await plugin.resolveId(
      'virtual:kovo-runtime-registry:/src/app.tsx',
      join(root, 'src/app.tsx'),
    );
    expect(registryId).toBe('\0virtual:kovo-runtime-registry:/src/app.tsx');

    const registrySource = await plugin.load(registryId as string);
    expect(registrySource).toContain(
      `registerGeneratedQueryReadRegistry([{"domains":["contact"],"query":"contacts"}]);`,
    );
    expect(registrySource).toContain(
      `registerGeneratedMutationTouchRegistry({"addContact":[{"domain":"contact","keys":null}]});`,
    );
  });

  it('feeds Drizzle query-shape facts to compiler diagnostics in the public server plugin path', async () => {
    const root = await fixture({
      'src/components/product-card.tsx': SHAPE_DEPENDENT_COMPONENT,
      'src/drizzle-types.d.ts': DRIZZLE_QUERY_SHAPE_TYPES,
      'src/product.queries.ts': DRIZZLE_QUERY_SHAPE_SOURCE,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured);

    await expect(
      plugin.transform(SHAPE_DEPENDENT_COMPONENT, join(root, 'src/components/product-card.tsx')),
    ).rejects.toThrow(/KV227[\s\S]*KV302/);

    const componentReport = captured.find((report) => report.fileName.endsWith('product-card.tsx'));
    expect(componentReport?.diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual([
      'KV227',
      'KV302',
    ]);
  });

  it('passes null-aware and in-shape bindings when query-shape facts are available', async () => {
    const root = await fixture({
      'src/components/product-card.tsx': VALID_SHAPE_COMPONENT,
      'src/drizzle-types.d.ts': DRIZZLE_QUERY_SHAPE_TYPES,
      'src/product.queries.ts': DRIZZLE_QUERY_SHAPE_SOURCE,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured);

    await expect(
      plugin.transform(VALID_SHAPE_COMPONENT, join(root, 'src/components/product-card.tsx')),
    ).resolves.toEqual(expect.objectContaining({ map: null }));

    const componentReport = captured.find((report) => report.fileName.endsWith('product-card.tsx'));
    expect(componentReport?.diagnostics.some((diagnostic) => diagnostic.code === 'KV227')).toBe(
      false,
    );
    expect(componentReport?.diagnostics.some((diagnostic) => diagnostic.code === 'KV302')).toBe(
      false,
    );
  });

  it('feeds non-Drizzle query output schemas to compiler binding validation', async () => {
    const root = await fixture({
      'src/components/status-card.tsx': NON_DRIZZLE_OUTPUT_VALID_COMPONENT,
      'src/status.ts': NON_DRIZZLE_OUTPUT_QUERY_SOURCE,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured);

    await expect(
      plugin.transform(
        NON_DRIZZLE_OUTPUT_VALID_COMPONENT,
        join(root, 'src/components/status-card.tsx'),
      ),
    ).resolves.toEqual(expect.objectContaining({ map: null }));

    const componentReport = captured.find((report) => report.fileName.endsWith('status-card.tsx'));
    expect(componentReport?.diagnostics.some((diagnostic) => diagnostic.code === 'KV302')).toBe(
      false,
    );
  });

  it('validates non-Drizzle query output schemas through component-local query aliases', async () => {
    const root = await fixture({
      'src/components/status-card.tsx': NON_DRIZZLE_OUTPUT_ALIAS_COMPONENT,
      'src/status.ts': NON_DRIZZLE_OUTPUT_ALIAS_QUERY_SOURCE,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured);

    await expect(
      plugin.transform(
        NON_DRIZZLE_OUTPUT_ALIAS_COMPONENT,
        join(root, 'src/components/status-card.tsx'),
      ),
    ).resolves.toEqual(expect.objectContaining({ map: null }));

    const componentReport = captured.find((report) => report.fileName.endsWith('status-card.tsx'));
    expect(componentReport?.diagnostics.some((diagnostic) => diagnostic.code === 'KV302')).toBe(
      false,
    );
  });

  it('still reports KV302 for fields absent from a non-Drizzle query output schema', async () => {
    const root = await fixture({
      'src/components/status-card.tsx': NON_DRIZZLE_OUTPUT_INVALID_COMPONENT,
      'src/status.ts': NON_DRIZZLE_OUTPUT_QUERY_SOURCE,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured);

    await expect(
      plugin.transform(
        NON_DRIZZLE_OUTPUT_INVALID_COMPONENT,
        join(root, 'src/components/status-card.tsx'),
      ),
    ).rejects.toThrow(/KV302[\s\S]*status\.missing/);

    const componentReport = captured.find((report) => report.fileName.endsWith('status-card.tsx'));
    expect(componentReport?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV302',
          message: expect.stringContaining('status.missing'),
        }),
      ]),
    );
  });

  it('does not throw in dev and surfaces findings as teaching diagnostics in the ledger', async () => {
    const root = await fixture({ 'src/queries/search.ts': KV422_INJECTION });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured);

    // Dev disposition: never crash HMR — buildStart resolves even with a live KV422 finding.
    await expect(plugin.buildStart()).resolves.toBeUndefined();

    const kv422 = captured.find((report) =>
      report.diagnostics.some((diagnostic) => diagnostic.code === 'KV422'),
    );
    expect(kv422, JSON.stringify(captured)).toBeDefined();
    expect(kv422?.fileName).toMatch(/search\.ts$/);
  });

  it('re-evaluates (debounced) on a data-plane HMR change and clears the prior teaching record', async () => {
    const root = await fixture({ 'src/queries/search.ts': KV422_INJECTION });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    const server = await configureDevServer(plugin, root, captured);
    await plugin.buildStart();
    expect(captured.some((report) => report.diagnostics.some((d) => d.code === 'KV422'))).toBe(
      true,
    );

    const queryPath = join(root, 'src/queries/search.ts');
    await writeFile(queryPath, KV422_CLEAN, 'utf8');
    captured.length = 0;

    await plugin
      .handleHotUpdate({ file: queryPath, modules: [], read: async () => KV422_CLEAN, server })
      .catch(() => []);
    // Debounced re-evaluation runs after DATA_PLANE_GATE_DEBOUNCE_MS (200ms).
    await new Promise((resolve) => setTimeout(resolve, 400));

    const cleared = captured.find((report) => report.fileName.endsWith('search.ts'));
    expect(cleared, JSON.stringify(captured)).toBeDefined();
    expect(cleared?.diagnostics).toEqual([]);
  });
});

async function configureDevServer(
  plugin: DataPlaneGatePlugin,
  root: string,
  captured: CapturedReport[],
): Promise<DataPlaneGateMockServer> {
  const server: DataPlaneGateMockServer = {
    config: { root },
    middlewares: { use() {} },
    async ssrLoadModule(id) {
      if (id === '@kovojs/server/internal/app-shell-vite') {
        return {
          createKovoAppShellViteDevIntegration() {
            return {
              diagnostics: {},
              onModuleDiagnostics(report: CapturedReport) {
                captured.push(report);
              },
              plugin: { configureServer() {} },
            };
          },
        };
      }
      throw new Error(`unexpected ssrLoadModule(${id})`);
    },
    ws: { send() {} },
  };
  await plugin.configureServer(server);
  return server;
}
