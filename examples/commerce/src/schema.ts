import { kovo } from '@kovojs/drizzle';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

// SPEC.md §10.1 (schema as domain registry) + §11.1: the Drizzle-blessed data
// layer. Each table carries its kovo({ domain, key }) annotation, so the static
// extractor derives the touch graph, query shapes, and write effects directly
// from this source — the derived-optimism transforms in generated/optimistic/ are
// produced from these tables + the loaders/handlers, never hand-authored.

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    // Presentational catalog columns (name/category/emoji) the UI renders. They
    // are never written by a mutation, so the derived cart/add optimism
    // (generated/optimistic/cart-add.ts, which only touches stock) is unaffected.
    // Defaults keep presentation-agnostic inserts (test fixtures) valid.
    name: text('name').notNull().default('Sample Product'),
    category: text('category').notNull().default('General'),
    emoji: text('emoji').notNull().default('📦'),
    stock: integer('stock').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  kovo({ domain: 'product', key: 'id' }),
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: serial('id').primaryKey(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  kovo({ domain: 'cart', key: 'id' }),
);

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    total: integer('total').notNull(),
    userId: text('user_id').notNull(),
  },
  kovo({ domain: 'order', key: 'id' }),
);
