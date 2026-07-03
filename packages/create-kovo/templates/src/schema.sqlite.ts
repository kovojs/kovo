import { kovo } from '@kovojs/drizzle';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { contact } from './model.js';

// The app's data model. This is the part you change first.
//
// The `kovo({ domain, key })` annotation registers the `contact` domain and the
// row key. The compiler reads it to prove which queries a write invalidates, so
// renaming a column or forgetting to refresh a list becomes a build error
// instead of stale UI (SPEC.md §10.1).
export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    company: text('company').notNull().default(''),
  },
  kovo({
    authzPolicy: 'signed-in users share the starter contact book through query/mutation guards',
    domain: contact,
    key: (table) => table.id,
  }),
);

// --- Auth infrastructure -------------------------------------------------------
// The four tables Better Auth manages. The credential-bearing tables are owner-scoped
// and classify raw credential columns as `secret` so KV435 keeps password hashes and
// bearer/OAuth tokens off the client wire (SPEC.md §6.6, §10.1). The column names match
// the fields Better Auth expects (introspectable via `getAuthTables(auth.options)`);
// `src/db.ts` creates them.
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  kovo({
    domain: 'auth',
    key: 'userId',
    owner: 'userId',
    secret: ['token'],
  }),
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  kovo({
    domain: 'auth',
    key: 'userId',
    owner: 'userId',
    secret: ['password', 'accessToken', 'refreshToken', 'idToken'],
  }),
);

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */
export const authSchema = { user, session, account, verification };
