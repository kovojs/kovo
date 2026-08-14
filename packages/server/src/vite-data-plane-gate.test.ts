import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kovo } from './vite.js';
import { withKovoBuildContext } from './internal/build-context.js';
import { trustedKovoVitePlugin } from './internal/vite-security-profile.js';

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
  source: string;
}

const APP_ENTRY = '/src/app.tsx';
const FRAMEWORK_SERVER_PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../server',
);
const APP_SOURCE = `import { defineKovo } from '@kovojs/server';\nconst app = defineKovo({});\nexport default app.assemble({});\n`;
const APP_CONTRACT_SOURCE = `
import { defineKovo } from '@kovojs/server';

export const app = defineKovo({
  appId: 'b17ead9a-6b5d-4b4c-80bf-05e1594ad22f',
});
export const status = app.query({
  access: app.publicAccess('Vite source-authentication regression fixture'),
  load: () => ({ ok: true }),
});
export default app.assemble({ queries: [status] });
`;

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

const KV447_SQLITE_OWNER_TABLES = `
import { kovo } from '@kovojs/drizzle';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
}, kovo((columns) => ({
  domain: 'session',
  key: columns.id,
  owner: columns.ownerId,
})));

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
}, kovo((columns) => ({
  domain: 'event',
  key: columns.id,
  ownerVia: { parent: sessions, fk: columns.sessionId, parentKey: sessions.id },
})));
`;

const KV414_AUTHZ_CENSUS_UNCLASSIFIED = `
import { query } from "@kovojs/server";
import { kovo } from "@kovojs/drizzle";
import { pgTable, text } from "drizzle-orm/pg-core";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";

export const drafts = pgTable("drafts", {
  id: text("id").primaryKey(),
}, kovo((columns) => ({ domain: "draft", key: columns.id })));

export const draftQuery = query("draft", {
  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {
    return db.select({ id: drafts.id }).from(drafts);
  },
});
`;

// KV410: opaque sql<number> projection in a query loader without a declared output schema.
const KV410_OPAQUE = `
export const cartItems = pgTable("cart_items", { cartId: text("cart_id").notNull() }, kovo((columns) => ({ domain: "cart", key: columns.cartId })));
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
  '}, kovo((columns) => ({ domain: "product", key: columns.id, atomic: columns.stock, version: columns.ver })));',
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
  'import { sql } from "drizzle-orm";',
  'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
  '',
  'interface AppRequest { db: PgAsyncDatabase<any, any> }',
  'export const contacts = pgTable("contacts", { id: text("id").primaryKey() }, kovo((columns) => ({ domain: "contact", key: columns.id, authzPolicy: sql`TRUE` })));',
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
  '}, kovo((columns) => ({ domain: "product", key: columns.id })));',
  'export const reviews = pgTable("reviews", {',
  '  productId: text("product_id"),',
  '  rating: integer("rating"),',
  '}, kovo((columns) => ({ domain: "review", key: columns.productId })));',
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
  'import { component } from "@kovojs/core";',
  '',
  'export const ProductCard = component({',
  '  queries: { product: {} },',
  '  render: ({ product }) => (',
  '    <article>',
  '      <span>{product.review.rating}</span>',
  '      <span>{product.missing}</span>',
  '      <span>{product.review?.rating}</span>',
  '    </article>',
  '  ),',
  '});',
].join('\n');

const VALID_SHAPE_COMPONENT = [
  'import { component } from "@kovojs/core";',
  '',
  'export const ProductCard = component({',
  '  queries: { product: {} },',
  '  render: ({ product }) => (',
  '    <article>',
  '      <span>{product.name}</span>',
  '      <span>{product.review?.rating}</span>',
  '    </article>',
  '  ),',
  '});',
].join('\n');

const DRIZZLE_OUTPUT_MERGE_QUERY_SOURCE = [
  'import { query, s } from "@kovojs/server";',
  'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
  '',
  'export const contacts = pgTable("contacts", {',
  '  id: text("id").primaryKey(),',
  '}, kovo((columns) => ({ domain: "contact", key: columns.id })));',
  '',
  'export const contactsQuery = query("contacts", {',
  '  output: s.object({ id: s.string(), total: s.number() }),',
  '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
  '    return db.select({ id: contacts.id }).from(contacts);',
  '  },',
  '});',
].join('\n');

const DRIZZLE_OUTPUT_MERGE_COMPONENT = [
  'import { component } from "@kovojs/core";',
  'import { contactsQuery } from "../contacts";',
  '',
  'export const ContactsSummary = component({',
  '  queries: { contacts: contactsQuery },',
  '  render: ({ contacts }) => (',
  '    <section>',
  '      <span>{contacts.id}</span>',
  '      <span>{contacts.total}</span>',
  '    </section>',
  '  ),',
  '});',
].join('\n');

const DRIZZLE_DERIVED_OUTPUT_QUERY_SOURCE = [
  'import { query, s } from "@kovojs/server";',
  'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
  '',
  'export const contacts = pgTable("contacts", {',
  '  id: text("id").primaryKey(),',
  '  status: text("status").notNull(),',
  '}, kovo((columns) => ({ domain: "contact", key: columns.id })));',
  '',
  'export const contactStatsQuery = query({',
  '  output: s.object({',
  '    active: s.number(),',
  '    archived: s.number(),',
  '    lead: s.number(),',
  '    statusById: s.array(s.object({ id: s.string(), status: s.string() })),',
  '    total: s.number(),',
  '  }),',
  '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
  '    const rows = await db.select({ id: contacts.id, status: contacts.status }).from(contacts);',
  '    return {',
  '      active: rows.filter((row) => row.status === "active").length,',
  '      archived: rows.filter((row) => row.status === "archived").length,',
  '      lead: rows.filter((row) => row.status === "lead").length,',
  '      statusById: rows,',
  '      total: rows.length,',
  '    };',
  '  },',
  '});',
].join('\n');

const DRIZZLE_DERIVED_OUTPUT_COMPONENT = [
  'import { component } from "@kovojs/core";',
  'import { contactStatsQuery } from "../contact-stats";',
  '',
  'export const ContactStats = component({',
  '  queries: { stats: contactStatsQuery },',
  '  render: ({ stats }) => (',
  '    <section>',
  '      <span>{stats.total}</span>',
  '      <span>{stats.lead}</span>',
  '      <span>{stats.active}</span>',
  '      <span>{stats.archived}</span>',
  '    </section>',
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
  'import { component } from "@kovojs/core";',
  'import { status } from "../status";',
  '',
  'export const StatusCard = component({',
  '  queries: { status },',
  '  render: ({ status }) => (',
  '    <article>',
  '      <span>{status.summary}</span>',
  '      <time>{status.generatedAt}</time>',
  '      <span>{status.metrics.count}</span>',
  '    </article>',
  '  ),',
  '});',
].join('\n');

const NON_DRIZZLE_OUTPUT_INVALID_COMPONENT = [
  'import { component } from "@kovojs/core";',
  'import { status } from "../status";',
  '',
  'export const StatusCard = component({',
  '  queries: { status },',
  '  render: ({ status }) => (',
  '    <article>',
  '      <span>{status.summary}</span>',
  '      <span>{status.missing}</span>',
  '    </article>',
  '  ),',
  '});',
].join('\n');

const DEV_PROJECT_FACTS_INITIAL_SOURCE = [
  'import { mutation, query, s } from "@kovojs/server";',
  '',
  'export const status = query({',
  '  reads: [],',
  '  output: s.object({ summary: s.string() }),',
  '  load: () => ({ summary: "ready" }),',
  '});',
  'export const save = mutation({',
  '  input: s.object({ name: s.string() }),',
  '  handler: (input) => input,',
  '});',
].join('\n');

const DEV_PROJECT_FACTS_CHANGED_SOURCE = [
  'import { mutation, query, s } from "@kovojs/server";',
  '',
  'export const status = query({',
  '  reads: [],',
  '  output: s.object({ generatedAt: s.string() }),',
  '  load: () => ({ generatedAt: "now" }),',
  '});',
  'export const save = mutation({',
  '  input: s.object({ name: s.string(), phone: s.string() }),',
  '  handler: (input) => input,',
  '});',
  'export async function unsafe(input: { id: string }, db: any) {',
  '  await db.execute("select * from products where id = " + input.id);',
  '}',
].join('\n');

const DEV_PROJECT_FACTS_COMPONENT = [
  'import { component } from "@kovojs/core";',
  'import { save, status } from "../contracts";',
  '',
  'export const StatusForm = component({',
  '  mutations: { save },',
  '  queries: { status },',
  '  render: ({ status }) => (',
  '    <section>',
  '      <span>{status.summary}</span>',
  '      <form mutation={save}><input name="name" /></form>',
  '    </section>',
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

const NON_DRIZZLE_OUTPUT_IMPORTED_QUERY_ALIAS_SOURCE = [
  'import { query as defineQuery, s } from "@kovojs/server";',
  '',
  'export const statusQuery = defineQuery({',
  '  reads: [],',
  '  output: s.object({',
  '    summary: s.string(),',
  '    generatedAt: s.string(),',
  '    totals: s.object({ streams: s.number() }),',
  '  }),',
  '  load: () => ({ summary: "ready", generatedAt: "now", totals: { streams: 1 } }),',
  '});',
].join('\n');

const NON_DRIZZLE_OUTPUT_BARREL_QUERY_SOURCE = [
  'import { s } from "@kovojs/server";',
  'import { query } from "./query-barrel";',
  '',
  'export const status = query({',
  '  reads: [],',
  '  output: s.object({',
  '    summary: s.string(),',
  '    generatedAt: s.string(),',
  '  }),',
  '  load: () => ({ summary: "ready", generatedAt: "now" }),',
  '});',
].join('\n');

const NON_DRIZZLE_OUTPUT_NAMESPACE_QUERY_SOURCE = [
  'import * as data from "@kovojs/server";',
  '',
  'export const status = data.query({',
  '  reads: [],',
  '  output: data.s.object({',
  '    summary: data.s.string(),',
  '    generatedAt: data.s.string(),',
  '    metrics: data.s.object({ count: data.s.number().optional() }),',
  '  }),',
  '  load: () => ({ summary: "ready", generatedAt: "now", metrics: {} }),',
  '});',
].join('\n');

const NON_DRIZZLE_OUTPUT_ALIAS_COMPONENT = [
  'import { component } from "@kovojs/core";',
  'import { statusQuery } from "../status";',
  '',
  'export const StatusCard = component({',
  '  queries: { status: statusQuery },',
  '  render: ({ status }) => (',
  '    <article>',
  '      <span>{status.summary}</span>',
  '      <time>{status.generatedAt}</time>',
  '      <span>{status.totals.streams}</span>',
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

function nonDrizzleOutputFillerQuerySource(index: number): string {
  return [
    "import { publicAccess, query, s } from '@kovojs/server';",
    '',
    `export const filler${index} = query({`,
    `  access: publicAccess('worker filler ${index}'),`,
    "  load: () => ({ value: 'ok' }),",
    '  output: s.object({ value: s.string() }),',
    '});',
    '',
  ].join('\n');
}

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

  it('does not let post-bootstrap environment mutation enable paranoid production builds', async () => {
    const previous = process.env.KOVO_PARANOID;
    process.env.KOVO_PARANOID = '1';
    const root = await fixture({ 'src/queries/search.ts': KV422_INJECTION });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    try {
      await expect(plugin.buildStart()).rejects.toThrow(
        /data-plane safety gate failed[\s\S]*ERROR KV422[\s\S]*search\.ts/,
      );
    } finally {
      if (previous === undefined) delete process.env.KOVO_PARANOID;
      else process.env.KOVO_PARANOID = previous;
    }
  });

  it('keeps the trusted runner paranoid disposition after environment mutation disables it', async () => {
    const previous = process.env.KOVO_PARANOID;
    delete process.env.KOVO_PARANOID;
    const root = await fixture({ 'src/queries/search.ts': KV422_INJECTION });
    const plugin = trustedKovoVitePlugin({
      app: APP_ENTRY,
      paranoidStaticAdvisory: true,
    }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    try {
      await expect(plugin.buildStart()).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.KOVO_PARANOID;
      else process.env.KOVO_PARANOID = previous;
    }
  });

  it('does not let Array.every poison hide a hard finding in a paranoid mixed diagnostic set', async () => {
    const root = await fixture({
      'src/drizzle-types.d.ts': DRIZZLE_TYPES,
      'src/inventory.domain.ts': KV429_DOMAIN,
      'src/queries/search.ts': KV422_INJECTION,
      'src/schema.ts': KV429_SCHEMA,
    });
    const plugin = trustedKovoVitePlugin({
      app: APP_ENTRY,
      paranoidStaticAdvisory: true,
    }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    const originalEvery = Array.prototype.every;
    let observed: unknown;
    try {
      Array.prototype.every = function hideMixedHardFinding(callback, thisArg) {
        for (let index = 0; index < this.length; index += 1) {
          if ((this[index] as { code?: unknown } | undefined)?.code === 'KV429') return true;
        }
        return Reflect.apply(originalEvery, this, [callback, thisArg]);
      } as typeof Array.prototype.every;
      try {
        await plugin.buildStart();
      } catch (error) {
        observed = error;
      }
    } finally {
      Array.prototype.every = originalEvery;
    }

    expect(observed).toBeInstanceOf(Error);
    expect(String((observed as Error).message)).toMatch(/ERROR KV429/u);
  });

  it('passes the build on a clean (branded sql`...`) fixture', async () => {
    const root = await fixture({ 'src/queries/search.ts': KV422_CLEAN });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    await expect(plugin.buildStart()).resolves.toBeUndefined();
  });

  it('keeps every SQLite owner warning visible and non-blocking during build', async () => {
    const root = await fixture({ 'src/schema.sqlite.ts': KV447_SQLITE_OWNER_TABLES });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    const warnings: string[] = [];
    await plugin.configResolved({ command: 'build', root });

    await expect(
      Reflect.apply(plugin.buildStart, { warn: (message: string) => warnings.push(message) }, []),
    ).resolves.toBeUndefined();
    expect(warnings).toHaveLength(2);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /WARN KV447 .*schema\.sqlite\.ts:\d+ .*Table sessions declares owner/u,
        ),
        expect.stringMatching(
          /WARN KV447 .*schema\.sqlite\.ts:\d+ .*Table events declares ownerVia/u,
        ),
      ]),
    );
  });

  it('fails the build on a KV414 authorization-census canary', async () => {
    const root = await fixture({
      'src/drizzle-types.d.ts': DRIZZLE_QUERY_SHAPE_TYPES,
      'src/queries/drafts.ts': KV414_AUTHZ_CENSUS_UNCLASSIFIED,
    });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    await expect(plugin.buildStart()).rejects.toThrow(
      /ERROR KV414[\s\S]*drafts\.ts[\s\S]*Authorization census table drafts/,
    );
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

    const originalIncludes = String.prototype.includes;
    let transformed: Awaited<ReturnType<DataPlaneGatePlugin['transform']>>;
    try {
      String.prototype.includes = () => true;
      transformed = await plugin.transform(APP_SOURCE, join(root, 'src/app.tsx'));
    } finally {
      String.prototype.includes = originalIncludes;
    }
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
    expect(registrySource).toContain(
      `registerGeneratedTableSecurityManifest({"tables":[{"authzPolicy":{"kind":"sql","sql":"TRUE"},"authorizationClassifications":["authzPolicy"],"columns":[{"key":"id","name":"id"}],"dialect":"postgres","domain":"contact","governedColumnKeys":["id"],"key":{"columnKey":"id","columnName":"id","uniqueness":"primary"},"name":"contacts","secretColumnKeys":[],"secretDeclared":false}]});`,
    );
  });

  it('injects the runtime registry after exact app-contract source authentication', async () => {
    const root = await fixture({ 'src/app.tsx': APP_CONTRACT_SOURCE });
    await mkdir(join(root, 'node_modules/@kovojs'), { recursive: true });
    await symlink(FRAMEWORK_SERVER_PACKAGE_ROOT, join(root, 'node_modules/@kovojs/server'));
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'build', root });

    const transformed = await plugin.transform(APP_CONTRACT_SOURCE, join(root, 'src/app.tsx'));

    expect(transformed?.code).toContain('virtual:kovo-runtime-registry:/src/app.tsx');
    expect(transformed?.code).toContain('assignDerivedQueryKey as __kovoAssignDerivedQueryKey');
  });

  it('skips runtime registry injection while the CLI derives the build graph', async () => {
    const root = await fixture({
      'src/contacts.ts': DRIZZLE_RUNTIME_REGISTRY_SOURCE,
      'src/drizzle-types.d.ts': DRIZZLE_RUNTIME_REGISTRY_TYPES,
    });
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await withKovoBuildContext({ graphDerivation: true }, async () => {
      await plugin.configResolved({ command: 'build', root });

      const transformed = await plugin.transform(APP_SOURCE, join(root, 'src/app.tsx'));
      const code = transformed === null ? APP_SOURCE : transformed.code;

      expect(code).not.toContain('virtual:kovo-runtime-registry:/src/app.tsx');
    });
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

  it('merges declared output fields into Drizzle query-shape facts for binding validation', async () => {
    const root = await fixture({
      'src/components/contacts-summary.tsx': DRIZZLE_OUTPUT_MERGE_COMPONENT,
      'src/contacts.ts': DRIZZLE_OUTPUT_MERGE_QUERY_SOURCE,
      'src/drizzle-types.d.ts': DRIZZLE_RUNTIME_REGISTRY_TYPES,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured);

    await expect(
      plugin.transform(
        DRIZZLE_OUTPUT_MERGE_COMPONENT,
        join(root, 'src/components/contacts-summary.tsx'),
      ),
    ).resolves.toEqual(expect.objectContaining({ map: null }));

    const componentReport = captured.find((report) =>
      report.fileName.endsWith('contacts-summary.tsx'),
    );
    expect(componentReport?.diagnostics.some((diagnostic) => diagnostic.code === 'KV302')).toBe(
      false,
    );
  });

  it('keeps compiler-derived Drizzle output fields bindable in direct JSX expressions', async () => {
    const root = await fixture({
      'src/components/contact-stats.tsx': DRIZZLE_DERIVED_OUTPUT_COMPONENT,
      'src/contact-stats.ts': DRIZZLE_DERIVED_OUTPUT_QUERY_SOURCE,
      'src/drizzle-types.d.ts': DRIZZLE_RUNTIME_REGISTRY_TYPES,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured);

    await expect(
      plugin.transform(
        DRIZZLE_DERIVED_OUTPUT_COMPONENT,
        join(root, 'src/components/contact-stats.tsx'),
      ),
    ).resolves.toEqual(expect.objectContaining({ map: null }));

    const componentReport = captured.find((report) =>
      report.fileName.endsWith('contact-stats.tsx'),
    );
    expect(componentReport?.diagnostics.some((diagnostic) => diagnostic.code === 'KV302')).toBe(
      false,
    );
  });

  it('keeps declared Drizzle output fields bindable during build graph derivation', async () => {
    const root = await fixture({
      'src/components/contact-stats.tsx': DRIZZLE_DERIVED_OUTPUT_COMPONENT,
      'src/contact-stats.ts': DRIZZLE_DERIVED_OUTPUT_QUERY_SOURCE,
      'src/drizzle-types.d.ts': DRIZZLE_RUNTIME_REGISTRY_TYPES,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await withKovoBuildContext({ graphDerivation: true }, () =>
      plugin.configResolved({ command: 'build', root }),
    );
    await configureDevServer(plugin, root, captured);

    await expect(
      plugin.transform(
        DRIZZLE_DERIVED_OUTPUT_COMPONENT,
        join(root, 'src/components/contact-stats.tsx'),
      ),
    ).resolves.toEqual(expect.objectContaining({ map: null }));

    const componentReport = captured.find((report) =>
      report.fileName.endsWith('contact-stats.tsx'),
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

  it('validates a large non-Drizzle output-schema corpus in the preloaded analyzer graph', async () => {
    const root = await fixture({
      'src/components/status-card.tsx': NON_DRIZZLE_OUTPUT_VALID_COMPONENT,
      'src/status.ts': NON_DRIZZLE_OUTPUT_QUERY_SOURCE,
      ...Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
          `src/filler-${index}.ts`,
          nonDrizzleOutputFillerQuerySource(index),
        ]),
      ),
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

  it('validates object-form output schemas declared through imported query aliases', async () => {
    const root = await fixture({
      'src/components/status-card.tsx': NON_DRIZZLE_OUTPUT_ALIAS_COMPONENT,
      'src/status.ts': NON_DRIZZLE_OUTPUT_IMPORTED_QUERY_ALIAS_SOURCE,
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

  it('reports KV302 from a non-Drizzle query imported through a root re-export barrel', async () => {
    const root = await fixture({
      'src/components/status-card.tsx': NON_DRIZZLE_OUTPUT_INVALID_COMPONENT,
      'src/query-barrel.ts': 'export { query } from "@kovojs/server";',
      'src/status.ts': NON_DRIZZLE_OUTPUT_BARREL_QUERY_SOURCE,
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
    expect(componentReport?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'KV227',
    );
    expect(componentReport?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV302',
          message: expect.stringContaining('status.missing'),
        }),
      ]),
    );
  });

  it('feeds namespace-imported JS non-Drizzle query output schemas to compiler validation', async () => {
    const root = await fixture({
      'src/components/status-card.tsx': NON_DRIZZLE_OUTPUT_VALID_COMPONENT,
      'src/status.jsx': NON_DRIZZLE_OUTPUT_NAMESPACE_QUERY_SOURCE,
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

  it('keeps every SQLite owner warning visible in the non-blocking dev ledger', async () => {
    const root = await fixture({ 'src/schema.sqlite.ts': KV447_SQLITE_OWNER_TABLES });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured);
    await expect(plugin.buildStart()).resolves.toBeUndefined();

    const sqlite = captured.find((report) => report.fileName.endsWith('schema.sqlite.ts'));
    expect(sqlite?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'KV447', message: expect.stringContaining('sessions') }),
        expect.objectContaining({ code: 'KV447', message: expect.stringContaining('events') }),
      ]),
    );
    expect(sqlite?.diagnostics).toHaveLength(2);
  });

  it('clears prior findings with source bytes from the analyzed snapshot, not a later disk read', async () => {
    const root = await fixture({
      'src/queries/a.ts': KV422_INJECTION,
      'src/queries/b.ts': KV422_INJECTION,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    const aPath = join(root, 'src/queries/a.ts');
    const bPath = join(root, 'src/queries/b.ts');
    let mutateDuringClear = false;
    let mutatedPath: string | undefined;

    await plugin.configResolved({ command: 'serve', root });
    await configureDevServer(plugin, root, captured, undefined, (report) => {
      captured.push(report);
      if (!mutateDuringClear || mutatedPath !== undefined || report.diagnostics.length !== 0)
        return;
      mutatedPath = report.fileName === aPath ? bPath : aPath;
      writeFileSync(mutatedPath, '// edit after the clean analysis snapshot\n', 'utf8');
    });
    await plugin.buildStart();
    expect(
      captured.filter((report) => report.diagnostics.some((d) => d.code === 'KV422')),
    ).toHaveLength(2);

    await Promise.all([
      writeFile(aPath, KV422_CLEAN, 'utf8'),
      writeFile(bPath, KV422_CLEAN, 'utf8'),
    ]);
    captured.length = 0;
    mutateDuringClear = true;
    await plugin.buildStart();

    expect(mutatedPath).toBeDefined();
    const laterClear = captured.find((report) => report.fileName === mutatedPath);
    expect(laterClear?.diagnostics).toEqual([]);
    expect(laterClear?.source).toBe(KV422_CLEAN);
  });

  it('keeps one project snapshot pending until convergence and diagnostics both settle', async () => {
    const root = await fixture({
      'src/components/status-form.tsx': DEV_PROJECT_FACTS_COMPONENT,
      'src/contracts.ts': DEV_PROJECT_FACTS_INITIAL_SOURCE,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    let failNextProjectDiagnostic = false;
    let firstDiagnosticAttempt: (() => void) | undefined;
    let secondDiagnosticAttempt: (() => void) | undefined;
    const firstDiagnostic = new Promise<void>((resolveDiagnostic) => {
      firstDiagnosticAttempt = resolveDiagnostic;
    });
    const secondDiagnostic = new Promise<void>((resolveDiagnostic) => {
      secondDiagnosticAttempt = resolveDiagnostic;
    });
    let diagnosticAttempts = 0;
    const server = await configureDevServer(plugin, root, captured, undefined, (report) => {
      if (
        failNextProjectDiagnostic &&
        report.fileName.endsWith('contracts.ts') &&
        report.diagnostics.some((diagnostic) => diagnostic.code === 'KV422')
      ) {
        diagnosticAttempts += 1;
        if (diagnosticAttempts === 1) {
          firstDiagnosticAttempt?.();
          throw new Error('synthetic first diagnostic settlement failure');
        }
        secondDiagnosticAttempt?.();
      }
      captured.push(report);
    });
    const componentPath = join(root, 'src/components/status-form.tsx');
    const contractsPath = join(root, 'src/contracts.ts');
    await expect(plugin.transform(DEV_PROJECT_FACTS_COMPONENT, componentPath)).resolves.toEqual(
      expect.objectContaining({ map: null }),
    );

    let firstReloadAttempt: (() => void) | undefined;
    let secondReloadAttempt: (() => void) | undefined;
    const firstReload = new Promise<void>((resolveReload) => {
      firstReloadAttempt = resolveReload;
    });
    const secondReload = new Promise<void>((resolveReload) => {
      secondReloadAttempt = resolveReload;
    });
    let reloadAttempts = 0;
    server.ws!.send = (payload: unknown) => {
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('type' in payload) ||
        payload.type !== 'full-reload'
      ) {
        return;
      }
      reloadAttempts += 1;
      if (reloadAttempts === 1) {
        firstReloadAttempt?.();
        throw new Error('synthetic first convergence failure');
      }
      secondReloadAttempt?.();
    };

    await writeFile(contractsPath, DEV_PROJECT_FACTS_CHANGED_SOURCE, 'utf8');
    failNextProjectDiagnostic = true;
    await plugin.handleHotUpdate({
      file: contractsPath,
      modules: [],
      read: async () => DEV_PROJECT_FACTS_CHANGED_SOURCE,
      server,
    });

    await firstReload;
    expect(reloadAttempts).toBe(1);
    expect(diagnosticAttempts).toBe(0);
    // The first reload publication failed. Neither half of the pending source snapshot may become
    // active: the old query field and old mutation input contract must still compile together.
    await expect(plugin.transform(DEV_PROJECT_FACTS_COMPONENT, componentPath)).resolves.toEqual(
      expect.objectContaining({ map: null }),
    );

    await secondReload;
    expect(reloadAttempts).toBe(2);
    await firstDiagnostic;
    expect(diagnosticAttempts).toBe(1);
    await secondDiagnostic;
    expect(diagnosticAttempts).toBe(2);
    await expect(plugin.transform(DEV_PROJECT_FACTS_COMPONENT, componentPath)).rejects.toThrow(
      /KV242[\s\S]*KV302|KV302[\s\S]*KV242/u,
    );

    // A successful automatic retry closes the wave; it does not arm an unbounded polling loop.
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_700));
    expect(reloadAttempts).toBe(2);
    expect(diagnosticAttempts).toBe(2);
  });

  it('does not reload until every ordered invalidation prerequisite succeeds', async () => {
    const root = await fixture({
      'src/components/status-form.tsx': DEV_PROJECT_FACTS_COMPONENT,
      'src/contracts.ts': DEV_PROJECT_FACTS_INITIAL_SOURCE,
    });
    const captured: CapturedReport[] = [];
    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;

    await plugin.configResolved({ command: 'serve', root });
    const server = await configureDevServer(plugin, root, captured);
    const componentPath = join(root, 'src/components/status-form.tsx');
    const contractsPath = join(root, 'src/contracts.ts');
    const calls: string[] = [];
    let failLegacyInvalidation = true;
    let reportFirstFailure: (() => void) | undefined;
    let reportReload: (() => void) | undefined;
    const firstFailure = new Promise<void>((resolveFailure) => {
      reportFirstFailure = resolveFailure;
    });
    const reload = new Promise<void>((resolveReload) => {
      reportReload = resolveReload;
    });
    const convergenceServer = server as DataPlaneGateMockServer & {
      environments: {
        ssr: {
          moduleGraph: { invalidateAll(): void };
          runner: { clearCache(): void };
        };
      };
      moduleGraph: { invalidateAll(): void };
    };
    convergenceServer.environments = {
      ssr: {
        moduleGraph: { invalidateAll: () => void calls.push('environment-invalidate') },
        runner: { clearCache: () => void calls.push('runner-clear') },
      },
    };
    convergenceServer.moduleGraph = {
      invalidateAll() {
        calls.push('legacy-invalidate');
        if (failLegacyInvalidation) {
          failLegacyInvalidation = false;
          reportFirstFailure?.();
          throw new Error('synthetic invalidation failure');
        }
      },
    };
    server.ws!.send = () => {
      calls.push('reload');
      reportReload?.();
    };

    await writeFile(contractsPath, DEV_PROJECT_FACTS_CHANGED_SOURCE, 'utf8');
    await plugin.handleHotUpdate({
      file: contractsPath,
      modules: [],
      read: async () => DEV_PROJECT_FACTS_CHANGED_SOURCE,
      server,
    });

    await firstFailure;
    expect(calls).toEqual(['environment-invalidate', 'legacy-invalidate']);
    await expect(plugin.transform(DEV_PROJECT_FACTS_COMPONENT, componentPath)).resolves.toEqual(
      expect.objectContaining({ map: null }),
    );

    await reload;
    expect(calls).toEqual([
      'environment-invalidate',
      'legacy-invalidate',
      'environment-invalidate',
      'legacy-invalidate',
      'runner-clear',
      'reload',
    ]);
  });

  it('runs trusted CLI HMR before deferred analysis, then settles required runner controls', async () => {
    let deferNextProjectSnapshot = false;
    let analysisStarted = false;
    let releaseProjectSnapshot: (() => void) | undefined;
    let reportAnalysisStarted: (() => void) | undefined;
    const projectSnapshotRelease = new Promise<void>((resolveRelease) => {
      releaseProjectSnapshot = resolveRelease;
    });
    const reportedAnalysisStart = new Promise<void>((resolveStart) => {
      reportAnalysisStarted = resolveStart;
    });
    vi.doMock('./internal/data-plane-static-analysis.ts', async () => {
      const actual = await vi.importActual<
        typeof import('./internal/data-plane-static-analysis.ts')
      >('./internal/data-plane-static-analysis.ts');
      return {
        ...actual,
        async collectViteDataPlaneAnalysisSnapshot(
          options: Parameters<typeof actual.collectViteDataPlaneAnalysisSnapshot>[0],
        ) {
          if (!deferNextProjectSnapshot) {
            return actual.collectViteDataPlaneAnalysisSnapshot(options);
          }
          deferNextProjectSnapshot = false;
          analysisStarted = true;
          reportAnalysisStarted?.();
          await projectSnapshotRelease;
          return actual.collectViteDataPlaneAnalysisSnapshot(options);
        },
      };
    });
    vi.resetModules();
    const root = await fixture({
      'src/components/status-form.tsx': DEV_PROJECT_FACTS_COMPONENT,
      'src/contracts.ts': DEV_PROJECT_FACTS_INITIAL_SOURCE,
    });
    const captured: CapturedReport[] = [];

    try {
      const { trustedKovoVitePlugin: freshTrustedKovoVitePlugin } =
        await import('./internal/vite-security-profile.js');
      const runnerGenerations = {
        async activateInitial() {},
        bindOrigin() {},
        async close() {},
        configure() {},
        async prepareInitial() {},
        async stage() {},
        async withLease<T>(operation: (server: object) => Promise<T>): Promise<T> {
          return operation({});
        },
      } as unknown as NonNullable<
        Parameters<typeof freshTrustedKovoVitePlugin>[0]['runnerGenerations']
      >;
      const plugin = freshTrustedKovoVitePlugin({
        app: APP_ENTRY,
        appShellModuleId: '/trusted/app-shell.ts',
        nodeDataPlaneBootstrapModuleId: '/trusted/data-plane.ts',
        paranoidStaticAdvisory: false,
        runnerGenerations,
        securityProfileModuleId: '/trusted/security-profile.ts',
        serverRootModuleId: '/trusted/server-root.ts',
      }) as unknown as DataPlaneGatePlugin;
      await plugin.configResolved({ command: 'serve', root });
      const calls: string[] = [];
      let reportReload: (() => void) | undefined;
      const reload = new Promise<void>((resolveReload) => {
        reportReload = resolveReload;
      });
      const server = await configureDevServer(
        plugin,
        root,
        captured,
        undefined,
        undefined,
        (candidate) => {
          const runnerServer = candidate as DataPlaneGateMockServer & {
            environments: {
              ssr: {
                moduleGraph: { invalidateAll(): void };
                runner: { clearCache(): void };
              };
            };
          };
          runnerServer.environments = {
            ssr: {
              moduleGraph: {
                invalidateAll: () => void calls.push('environment-invalidate'),
              },
              runner: { clearCache: () => void calls.push('runner-clear') },
            },
          };
          candidate.ws!.send = (payload: unknown) => {
            if (
              typeof payload === 'object' &&
              payload !== null &&
              'type' in payload &&
              payload.type === 'full-reload'
            ) {
              calls.push('reload');
              reportReload?.();
            }
          };
        },
      );
      const contractsPath = join(root, 'src/contracts.ts');
      await writeFile(contractsPath, DEV_PROJECT_FACTS_CHANGED_SOURCE, 'utf8');
      deferNextProjectSnapshot = true;

      await plugin.handleHotUpdate({
        file: contractsPath,
        modules: [],
        read: async () => DEV_PROJECT_FACTS_CHANGED_SOURCE,
        server,
      });
      expect(analysisStarted).toBe(false);
      expect(calls).toEqual([]);

      await reportedAnalysisStart;
      expect(calls).toEqual([]);
      releaseProjectSnapshot?.();
      await reload;
      expect(calls).toEqual(['environment-invalidate', 'runner-clear', 'reload']);
    } finally {
      vi.doUnmock('./internal/data-plane-static-analysis.ts');
      vi.resetModules();
    }
  });

  it('starts one analysis settle window only after every overlapping HMR outcome finishes', async () => {
    const root = await fixture({
      'src/components/card.css': '.card { display: block; }',
      'src/queries/search.ts': KV422_INJECTION,
    });
    const captured: CapturedReport[] = [];
    const appShellOutcomes: Array<Promise<readonly unknown[]>> = [];
    const appShellHandleHotUpdate = vi.fn(
      async (): Promise<readonly unknown[]> => (await appShellOutcomes.shift()) ?? [],
    );

    const wait = (milliseconds: number) =>
      new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

    const plugin = kovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
    await plugin.configResolved({ command: 'serve', root });
    const server = await configureDevServer(plugin, root, captured, appShellHandleHotUpdate);
    const queryPath = join(root, 'src/queries/search.ts');
    const cssPath = join(root, 'src/components/card.css');
    const findingCount = () =>
      captured.filter((report) =>
        report.diagnostics.some((diagnostic) => diagnostic.code === 'KV422'),
      ).length;
    const waitForFinding = async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && findingCount() !== 1) await wait(50);
      expect(findingCount()).toBe(1);
    };
    const deferredOutcome = () => {
      let resolveOutcome: ((value: readonly unknown[]) => void) | undefined;
      const outcome = new Promise<readonly unknown[]>((resolve) => {
        resolveOutcome = resolve;
      });
      return { outcome, resolve: () => resolveOutcome?.([]) };
    };

    // No timer exists until the app-shell/compile outcome has actually published and unwound.
    const first = deferredOutcome();
    appShellOutcomes.push(first.outcome);
    const firstHmr = plugin.handleHotUpdate({
      file: queryPath,
      modules: [],
      read: async () => KV422_INJECTION,
      server,
    });
    await wait(1_650);
    expect(findingCount()).toBe(0);
    first.resolve();
    await firstHmr;
    await wait(1_300);
    expect(findingCount()).toBe(0);
    await waitForFinding();

    // A later non-data edit cancels the old deadline without losing the data edit's intent.
    captured.length = 0;
    await plugin.handleHotUpdate({
      file: queryPath,
      modules: [],
      read: async () => KV422_INJECTION,
      server,
    });
    await wait(750);
    const nonData = deferredOutcome();
    appShellOutcomes.push(nonData.outcome);
    const nonDataHmr = plugin.handleHotUpdate({
      file: cssPath,
      modules: [],
      read: async () => '.card { display: grid; }',
      server,
    });
    await wait(900);
    expect(findingCount()).toBe(0);
    nonData.resolve();
    await nonDataHmr;
    await wait(1_300);
    expect(findingCount()).toBe(0);
    await waitForFinding();

    // Overlapping outcomes share one quiet-window boundary; the first completion cannot arm a
    // timer underneath the second update, even when that update exceeds the settle duration.
    captured.length = 0;
    const overlappingFirst = deferredOutcome();
    const overlappingSecond = deferredOutcome();
    appShellOutcomes.push(overlappingFirst.outcome, overlappingSecond.outcome);
    const overlappingFirstHmr = plugin.handleHotUpdate({
      file: queryPath,
      modules: [],
      read: async () => KV422_INJECTION,
      server,
    });
    const overlappingSecondHmr = plugin.handleHotUpdate({
      file: queryPath,
      modules: [],
      read: async () => KV422_INJECTION,
      server,
    });
    overlappingFirst.resolve();
    await overlappingFirstHmr;
    await wait(1_650);
    expect(findingCount()).toBe(0);
    overlappingSecond.resolve();
    await overlappingSecondHmr;
    await wait(1_300);
    expect(findingCount()).toBe(0);
    await waitForFinding();
    expect(findingCount()).toBe(1);
  });

  it('discards an in-flight analysis when a newer HMR source epoch begins', async () => {
    let pauseNextProjectSnapshot = false;
    let releaseProjectSnapshot: (() => void) | undefined;
    let reportPausedCollection: (() => void) | undefined;
    const pausedCollection = new Promise<void>((resolvePaused) => {
      reportPausedCollection = resolvePaused;
    });
    const collectionRelease = new Promise<void>((resolveCollection) => {
      releaseProjectSnapshot = resolveCollection;
    });
    vi.doMock('./internal/data-plane-static-analysis.ts', async () => {
      const actual = await vi.importActual<
        typeof import('./internal/data-plane-static-analysis.ts')
      >('./internal/data-plane-static-analysis.ts');
      return {
        ...actual,
        async collectViteDataPlaneAnalysisSnapshot(
          options: Parameters<typeof actual.collectViteDataPlaneAnalysisSnapshot>[0],
        ) {
          const snapshot = await actual.collectViteDataPlaneAnalysisSnapshot(options);
          if (!pauseNextProjectSnapshot) return snapshot;
          pauseNextProjectSnapshot = false;
          reportPausedCollection?.();
          await collectionRelease;
          return snapshot;
        },
      };
    });
    vi.resetModules();
    const root = await fixture({ 'src/queries/search.ts': KV422_INJECTION });
    const captured: CapturedReport[] = [];
    const appShellOutcomes: Array<Promise<readonly unknown[]>> = [];

    try {
      const { kovo: freshKovo } = await import('./vite.js');
      const plugin = freshKovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
      await plugin.configResolved({ command: 'serve', root });
      const server = await configureDevServer(
        plugin,
        root,
        captured,
        async () => (await appShellOutcomes.shift()) ?? [],
      );
      const wsSend = vi.spyOn(server.ws!, 'send');
      const queryPath = join(root, 'src/queries/search.ts');

      pauseNextProjectSnapshot = true;
      await plugin.handleHotUpdate({
        file: queryPath,
        modules: [],
        read: async () => KV422_INJECTION,
        server,
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_650));
      await pausedCollection;

      let releaseNewerHmr: ((value: readonly unknown[]) => void) | undefined;
      appShellOutcomes.push(
        new Promise<readonly unknown[]>((resolveOutcome) => {
          releaseNewerHmr = resolveOutcome;
        }),
      );
      const newerHmr = plugin.handleHotUpdate({
        file: queryPath,
        modules: [],
        read: async () => KV422_INJECTION,
        server,
      });
      releaseProjectSnapshot?.();
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));

      expect(captured).toEqual([]);
      expect(wsSend).not.toHaveBeenCalled();
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_650));
      expect(captured).toEqual([]);
      expect(wsSend).not.toHaveBeenCalled();

      releaseNewerHmr?.([]);
      await newerHmr;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_300));
      expect(captured).toEqual([]);
      const deadline = Date.now() + 30_000;
      while (
        Date.now() < deadline &&
        !captured.some((report) =>
          report.diagnostics.some((diagnostic) => diagnostic.code === 'KV422'),
        )
      ) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      expect(
        captured.filter((report) =>
          report.diagnostics.some((diagnostic) => diagnostic.code === 'KV422'),
        ),
      ).toHaveLength(1);
      expect(wsSend).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('./internal/data-plane-static-analysis.ts');
      vi.resetModules();
    }
  });

  it('does not commit a snapshot whose source identity drifts before publication', async () => {
    let pauseNextProjectSnapshot = false;
    let releaseProjectSnapshot: (() => void) | undefined;
    let reportPausedCollection: (() => void) | undefined;
    const pausedCollection = new Promise<void>((resolvePaused) => {
      reportPausedCollection = resolvePaused;
    });
    const collectionRelease = new Promise<void>((resolveCollection) => {
      releaseProjectSnapshot = resolveCollection;
    });
    vi.doMock('./internal/data-plane-static-analysis.ts', async () => {
      const actual = await vi.importActual<
        typeof import('./internal/data-plane-static-analysis.ts')
      >('./internal/data-plane-static-analysis.ts');
      return {
        ...actual,
        async collectViteDataPlaneAnalysisSnapshot(
          options: Parameters<typeof actual.collectViteDataPlaneAnalysisSnapshot>[0],
        ) {
          const snapshot = await actual.collectViteDataPlaneAnalysisSnapshot(options);
          if (!pauseNextProjectSnapshot) return snapshot;
          pauseNextProjectSnapshot = false;
          reportPausedCollection?.();
          await collectionRelease;
          return snapshot;
        },
      };
    });
    vi.resetModules();
    const root = await fixture({
      'src/components/status-form.tsx': DEV_PROJECT_FACTS_COMPONENT,
      'src/contracts.ts': DEV_PROJECT_FACTS_INITIAL_SOURCE,
    });
    const captured: CapturedReport[] = [];

    try {
      const { kovo: freshKovo } = await import('./vite.js');
      const plugin = freshKovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
      await plugin.configResolved({ command: 'serve', root });
      const server = await configureDevServer(plugin, root, captured);
      const componentPath = join(root, 'src/components/status-form.tsx');
      const contractsPath = join(root, 'src/contracts.ts');
      let reportReload: (() => void) | undefined;
      const reload = new Promise<void>((resolveReload) => {
        reportReload = resolveReload;
      });
      let reloads = 0;
      server.ws!.send = () => {
        reloads += 1;
        reportReload?.();
      };

      await writeFile(contractsPath, DEV_PROJECT_FACTS_CHANGED_SOURCE, 'utf8');
      pauseNextProjectSnapshot = true;
      await plugin.handleHotUpdate({
        file: contractsPath,
        modules: [],
        read: async () => DEV_PROJECT_FACTS_CHANGED_SOURCE,
        server,
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_650));
      await pausedCollection;
      await writeFile(
        contractsPath,
        `${DEV_PROJECT_FACTS_CHANGED_SOURCE}\n// second source generation\n`,
        'utf8',
      );
      releaseProjectSnapshot?.();
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));

      expect(reloads).toBe(0);
      await expect(plugin.transform(DEV_PROJECT_FACTS_COMPONENT, componentPath)).resolves.toEqual(
        expect.objectContaining({ map: null }),
      );

      await reload;
      expect(reloads).toBe(1);
      await expect(plugin.transform(DEV_PROJECT_FACTS_COMPONENT, componentPath)).rejects.toThrow(
        /KV242[\s\S]*KV302|KV302[\s\S]*KV242/u,
      );
    } finally {
      vi.doUnmock('./internal/data-plane-static-analysis.ts');
      vi.resetModules();
    }
  });

  it('surfaces KV245, retains last-good facts, and retries a failed async analysis', async () => {
    let failNextProjectSnapshot = false;
    vi.doMock('./internal/data-plane-static-analysis.ts', async () => {
      const actual = await vi.importActual<
        typeof import('./internal/data-plane-static-analysis.ts')
      >('./internal/data-plane-static-analysis.ts');
      return {
        ...actual,
        async collectViteDataPlaneAnalysisSnapshot(
          options: Parameters<typeof actual.collectViteDataPlaneAnalysisSnapshot>[0],
        ) {
          if (failNextProjectSnapshot) {
            failNextProjectSnapshot = false;
            throw new Error('synthetic whole-project analyzer failure');
          }
          return actual.collectViteDataPlaneAnalysisSnapshot(options);
        },
      };
    });
    vi.resetModules();
    const root = await fixture({
      'src/components/status-form.tsx': DEV_PROJECT_FACTS_COMPONENT,
      'src/contracts.ts': DEV_PROJECT_FACTS_INITIAL_SOURCE,
    });
    const captured: CapturedReport[] = [];

    try {
      const { kovo: freshKovo } = await import('./vite.js');
      const plugin = freshKovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
      await plugin.configResolved({ command: 'serve', root });
      const server = await configureDevServer(plugin, root, captured);
      const componentPath = join(root, 'src/components/status-form.tsx');
      const contractsPath = join(root, 'src/contracts.ts');
      let reportReload: (() => void) | undefined;
      const reload = new Promise<void>((resolveReload) => {
        reportReload = resolveReload;
      });
      server.ws!.send = () => reportReload?.();

      await writeFile(contractsPath, DEV_PROJECT_FACTS_CHANGED_SOURCE, 'utf8');
      failNextProjectSnapshot = true;
      await plugin.handleHotUpdate({
        file: contractsPath,
        modules: [],
        read: async () => DEV_PROJECT_FACTS_CHANGED_SOURCE,
        server,
      });
      const failureDeadline = Date.now() + 30_000;
      while (
        Date.now() < failureDeadline &&
        !captured.some((report) => report.diagnostics.some((d) => d.code === 'KV245'))
      ) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      const failure = captured.find((report) =>
        report.diagnostics.some((diagnostic) => diagnostic.code === 'KV245'),
      );
      expect(failure?.diagnostics).toEqual([
        expect.objectContaining({
          code: 'KV245',
          message: expect.stringContaining('retained the last-good snapshot'),
        }),
      ]);
      await expect(plugin.transform(DEV_PROJECT_FACTS_COMPONENT, componentPath)).resolves.toEqual(
        expect.objectContaining({ map: null }),
      );

      await reload;
      await expect(plugin.transform(DEV_PROJECT_FACTS_COMPONENT, componentPath)).rejects.toThrow(
        /KV242[\s\S]*KV302|KV302[\s\S]*KV242/u,
      );
      expect(
        captured.some(
          (report) => report.fileName.endsWith('app.tsx') && report.diagnostics.length === 0,
        ),
      ).toBe(true);
    } finally {
      vi.doUnmock('./internal/data-plane-static-analysis.ts');
      vi.resetModules();
    }
  });

  it('rejects a new diagnostic whose file is absent from its source census', async () => {
    let mismatchNextProjectSnapshot = false;
    let mismatchedSnapshotReturned = false;
    let reportMismatch: (() => void) | undefined;
    let reportRetry: (() => void) | undefined;
    const mismatch = new Promise<void>((resolveMismatch) => {
      reportMismatch = resolveMismatch;
    });
    const retry = new Promise<void>((resolveRetry) => {
      reportRetry = resolveRetry;
    });
    vi.doMock('./internal/data-plane-static-analysis.ts', async () => {
      const actual = await vi.importActual<
        typeof import('./internal/data-plane-static-analysis.ts')
      >('./internal/data-plane-static-analysis.ts');
      return {
        ...actual,
        async collectViteDataPlaneAnalysisSnapshot(
          options: Parameters<typeof actual.collectViteDataPlaneAnalysisSnapshot>[0],
        ) {
          const snapshot = await actual.collectViteDataPlaneAnalysisSnapshot(options);
          if (!mismatchNextProjectSnapshot) {
            if (mismatchedSnapshotReturned) reportRetry?.();
            return snapshot;
          }
          mismatchNextProjectSnapshot = false;
          mismatchedSnapshotReturned = true;
          reportMismatch?.();
          return {
            ...snapshot,
            files: [],
          };
        },
      };
    });
    vi.resetModules();
    const root = await fixture({ 'src/queries/search.ts': KV422_INJECTION });
    const captured: CapturedReport[] = [];

    try {
      const { kovo: freshKovo } = await import('./vite.js');
      const plugin = freshKovo({ app: APP_ENTRY }) as unknown as DataPlaneGatePlugin;
      await plugin.configResolved({ command: 'serve', root });
      const server = await configureDevServer(plugin, root, captured);
      const queryPath = join(root, 'src/queries/search.ts');
      mismatchNextProjectSnapshot = true;
      await plugin.handleHotUpdate({
        file: queryPath,
        modules: [],
        read: async () => KV422_INJECTION,
        server,
      });

      await mismatch;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      expect(
        captured.some((report) =>
          report.diagnostics.some((diagnostic) => diagnostic.code === 'KV422'),
        ),
      ).toBe(false);
      expect(
        captured.some((report) =>
          report.diagnostics.some((diagnostic) => diagnostic.code === 'KV245'),
        ),
      ).toBe(true);

      await retry;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      const sourceBackedFindings = captured.filter((report) =>
        report.diagnostics.some((diagnostic) => diagnostic.code === 'KV422'),
      );
      expect(sourceBackedFindings).toHaveLength(1);
      expect(sourceBackedFindings[0]?.source).toBe(KV422_INJECTION);
    } finally {
      vi.doUnmock('./internal/data-plane-static-analysis.ts');
      vi.resetModules();
    }
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
    // The whole-project pass is debounced by DEV_ANALYSIS_SETTLE_MS (1.5s) so the post-edit
    // reload wins the event loop before analysis starts (plans/good-perf.md D5-d). Poll until
    // the pass lands rather than assuming a fixed window.
    const deadline = Date.now() + 30_000;
    while (
      Date.now() < deadline &&
      !captured.some((report) => report.fileName.endsWith('search.ts'))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const cleared = captured.find((report) => report.fileName.endsWith('search.ts'));
    expect(cleared, JSON.stringify(captured)).toBeDefined();
    expect(cleared?.diagnostics).toEqual([]);
  });
});

async function configureDevServer(
  plugin: DataPlaneGatePlugin,
  root: string,
  captured: CapturedReport[],
  handleHotUpdate?: DataPlaneGatePlugin['handleHotUpdate'],
  onDiagnosticReport?: (report: CapturedReport) => void,
  prepareServer?: (server: DataPlaneGateMockServer) => void,
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
                if (onDiagnosticReport === undefined) captured.push(report);
                else onDiagnosticReport(report);
              },
              plugin: {
                configureServer() {},
                ...(handleHotUpdate === undefined ? {} : { handleHotUpdate }),
              },
            };
          },
        };
      }
      throw new Error(`unexpected ssrLoadModule(${id})`);
    },
    ws: { send() {} },
  };
  prepareServer?.(server);
  await plugin.configureServer(server);
  return server;
}
