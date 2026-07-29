import { kovo } from '@kovojs/drizzle';
import { sql } from 'drizzle-orm';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

import { cart, order, product } from './model.js';

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().default('Sample Product'),
    category: text('category').notNull().default('General'),
    emoji: text('emoji').notNull().default('📦'),
    stock: integer('stock').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  kovo((columns) => ({
    // SPEC §10.3: this demo catalog is deliberately shared and publicly readable. The literal
    // SQL predicate is an engine policy Kovo can install; prose is not Postgres authorization.
    authzPolicy: sql`true`,
    domain: product,
    key: columns.id,
  })),
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: serial('id').primaryKey(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  kovo((columns) => ({
    // SPEC §10.3: the demo cart is deliberately global, including for anonymous storefront
    // reads. Mutation guards remain the finer app decision; this engine policy states the truth.
    authzPolicy: sql`true`,
    domain: cart,
    key: columns.id,
  })),
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
  // SPEC §10.1: orders are principal-owned (the order's user); the §10.3 IDOR
  // audit checks that order reads are scoped to that owner.
  kovo((columns) => ({ domain: order, key: columns.id, owner: columns.userId })),
);
