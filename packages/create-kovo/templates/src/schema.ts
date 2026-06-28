import { kovo } from '@kovojs/drizzle';
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { contact } from './model.js';

// The app's data model. This is the part you change first.
//
// The `kovo({ domain, key })` annotation registers the `contact` domain and the
// row key. The compiler reads it to prove which queries a write invalidates, so
// renaming a column or forgetting to refresh a list becomes a build error
// instead of stale UI (SPEC.md §10.1).
export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    company: text('company').notNull().default(''),
  },
  kovo({ domain: contact, key: (table) => table.id }),
);

// --- Auth infrastructure -------------------------------------------------------
// The four tables Better Auth manages. They are not app domains, so they carry no
// `kovo()` annotation. The column names match the fields Better Auth expects
// (introspectable via `getAuthTables(auth.options)`); `src/db.ts` creates them.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */
export const authSchema = { user, session, account, verification };
