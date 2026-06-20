import { kovo } from '@kovojs/drizzle';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

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
  kovo({ domain: 'product', key: (t) => t.id }),
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: serial('id').primaryKey(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  kovo({ domain: 'cart', key: (t) => t.id }),
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
  kovo({ domain: 'order', key: (t) => t.id }),
);
