/* oxlint-disable typescript/unbound-method -- Adversarial tests deliberately replace late driver/collection methods. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  type KovoDeclaredWriteDbCapable,
  type KovoReadonlyDbCapable,
} from '@kovojs/server/internal/managed-db';

import { createPgliteTestDb, type PgliteTestDb } from './pglite.js';
import { createSqliteTestDb, type SqliteTestDb } from './sqlite.js';

const nativeReflectApply = Reflect.apply;

describe('@kovojs/test adapter shared-realm security', () => {
  it('C128 snapshots SQLite write policy and ignores late Set.has allowlist substitution', () => {
    const db = createSqliteTestDb();
    try {
      db.exec('create table cart_items (id text primary key)');
      db.exec('create table audit_log (id text primary key)');
      const policy = {
        dialect: 'sqlite' as const,
        tables: ['cart_items'],
        touches: ['cart'],
      };
      const writer = (db as SqliteTestDb & KovoDeclaredWriteDbCapable<Pick<SqliteTestDb, 'write'>>)[
        kovoDeclaredWriteDbHandle
      ](policy);
      policy.tables.push('audit_log');

      const nativeSetHas = Set.prototype.has;
      try {
        Set.prototype.has = function (value: unknown) {
          if (value === 'main.audit_log') return true;
          return nativeReflectApply(nativeSetHas, this, [value]);
        };
        expect(() => writer.write('audit_log', { id: 'stolen' })).toThrow(
          /KV406.*SQLite adapter declared-write fallback/s,
        );
      } finally {
        Set.prototype.has = nativeSetHas;
      }
      expect(db.read('audit_log')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('pins SQLite handle and prepared-statement dispatch before late prototype replacement', () => {
    const db = createSqliteTestDb();
    try {
      db.exec('create table products (id text primary key)');
      db.exec('create table audit_log (id text primary key)');
      db.write('products', { id: 'p1' });
      const handlePrototype = Object.getPrototypeOf(db.sqlite) as object;
      const probe = db.sqlite.prepare('select 1');
      const statementPrototype = Object.getPrototypeOf(probe) as object;
      const prepareDescriptor = Object.getOwnPropertyDescriptor(handlePrototype, 'prepare');
      const allDescriptor = Object.getOwnPropertyDescriptor(statementPrototype, 'all');
      const nativeExec = db.sqlite.exec;
      const nativePrepare = db.sqlite.prepare;
      const nativeAll = probe.all;
      try {
        Object.defineProperty(handlePrototype, 'prepare', {
          configurable: true,
          value: function (statement: string) {
            nativeReflectApply(nativeExec, this, [
              "insert into audit_log (id) values ('prepare-stolen')",
            ]);
            return nativeReflectApply(nativePrepare, this, [statement]);
          },
          writable: true,
        });
        Object.defineProperty(statementPrototype, 'all', {
          configurable: true,
          value: function (...params: unknown[]) {
            nativeReflectApply(nativeExec, db.sqlite, [
              "insert into audit_log (id) values ('all-stolen')",
            ]);
            return nativeReflectApply(nativeAll, this, params);
          },
          writable: true,
        });

        expect(db.read('products')).toEqual([{ id: 'p1' }]);
      } finally {
        if (prepareDescriptor !== undefined) {
          Object.defineProperty(handlePrototype, 'prepare', prepareDescriptor);
        }
        if (allDescriptor !== undefined) {
          Object.defineProperty(statementPrototype, 'all', allDescriptor);
        }
      }
      expect(db.read('audit_log')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('C128 keeps PGlite helper policy checks independent of late Set.has', async () => {
    const db = await createPgliteTestDb();
    try {
      await db.exec('create table cart_items (id text primary key)');
      await db.exec('create table audit_log (id text primary key)');
      const policy = {
        dialect: 'postgres' as const,
        tables: ['cart_items'],
        touches: ['cart'],
      };
      const writer = (db as PgliteTestDb & KovoDeclaredWriteDbCapable<Pick<PgliteTestDb, 'write'>>)[
        kovoDeclaredWriteDbHandle
      ](policy);
      policy.tables.push('audit_log');

      const nativeSetHas = Set.prototype.has;
      try {
        Set.prototype.has = function (value: unknown) {
          if (value === 'public.audit_log') return true;
          return nativeReflectApply(nativeSetHas, this, [value]);
        };
        await expect(writer.write('audit_log', { id: 'stolen' })).rejects.toThrow(
          /KV406.*PGlite adapter declared-write fallback/s,
        );
      } finally {
        Set.prototype.has = nativeSetHas;
      }
      await expect(db.read('audit_log')).resolves.toEqual([]);
    } finally {
      await db.close();
    }
  });

  it('C129 pins dedicated PGlite reader query dispatch against extra SQL injection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-pglite-reader-intrinsic-'));
    const db = await createPgliteTestDb({ dataDir: root });
    try {
      await db.exec('create table products (id text primary key)');
      await db.exec('create table audit_log (id text primary key)');
      await db.write('products', { id: 'p1' });
      const reader = (
        db as PgliteTestDb & KovoReadonlyDbCapable<Pick<PgliteTestDb, 'pglite' | 'query'>>
      )[kovoReadonlyDbHandle]();
      await reader.query('show default_transaction_read_only');

      const ownQueryDescriptor = Object.getOwnPropertyDescriptor(PGlite.prototype, 'query');
      const nativeQuery = PGlite.prototype.query;
      const nativeExec = PGlite.prototype.exec;
      try {
        Object.defineProperty(PGlite.prototype, 'query', {
          configurable: true,
          value: async function (statement: string, values?: readonly unknown[]) {
            if (statement === 'select id from products') {
              await nativeReflectApply(nativeExec, this, [
                "set default_transaction_read_only=off; insert into audit_log (id) values ('stolen')",
              ]);
            }
            return nativeReflectApply(nativeQuery, this, [statement, values]);
          },
          writable: true,
        });

        await expect(reader.query<{ id: string }>('select id from products')).resolves.toEqual([
          { id: 'p1' },
        ]);
      } finally {
        if (ownQueryDescriptor === undefined)
          delete (PGlite.prototype as { query?: unknown }).query;
        else Object.defineProperty(PGlite.prototype, 'query', ownQueryDescriptor);
      }

      await expect(db.read('audit_log')).resolves.toEqual([]);
      await expect(
        reader.query<{ default_transaction_read_only: string }>(
          'show default_transaction_read_only',
        ),
      ).resolves.toEqual([{ default_transaction_read_only: 'on' }]);
    } finally {
      await db.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
