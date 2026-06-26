# @kovojs/drizzle

Drizzle integration for Kovo's data layer. It annotates tables with domains,
owners, secret fields, governed columns, and concurrency facts so Kovo can derive
read/write graphs from ordinary Drizzle queries.

```sh
pnpm add @kovojs/drizzle drizzle-orm
```

```ts
import { kovo } from '@kovojs/drizzle';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const carts = pgTable('carts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  version: integer('version').notNull(),
}, (table) => [
  kovo(table).domain('cart').key(table.id).owner(table.userId).version(table.version),
]);
```

## Reference

- API: `/api/drizzle/`
- Guide: `/guides/data-layer/`
