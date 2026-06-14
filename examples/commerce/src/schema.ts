import { jiso } from '@jiso/drizzle';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

// SPEC.md §10.1 (schema as domain registry) + §11.1: the Drizzle-blessed data
// layer. Each table carries its jiso({ domain, key }) annotation, so the static
// extractor derives the touch graph, query shapes, and write effects directly
// from this source — the derived-optimism transforms in generated/optimistic/ are
// produced from these tables + the loaders/handlers, never hand-authored.

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    stock: integer('stock').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  jiso({ domain: 'product', key: 'id' }),
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: serial('id').primaryKey(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  jiso({ domain: 'cart', key: 'id' }),
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
  jiso({ domain: 'order', key: 'id' }),
);

export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull(),
    userId: text('user_id').notNull(),
    contentType: text('content_type').notNull(),
    filename: text('filename').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
  },
  jiso({ domain: 'attachment', key: 'id' }),
);
