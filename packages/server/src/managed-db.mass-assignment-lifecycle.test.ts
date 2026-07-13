import { constants as nodeSqliteConstants } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { extractKovoRuntimeDbMetadata, kovo } from '@kovojs/drizzle';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { csrfToken } from './csrf.js';
import { domain } from './domain.js';
import { managedDb } from './managed-db.js';
import { mutation, runMutation } from './mutation.js';
import { s } from './schema.js';
import { createSqliteAppRuntimeDb } from './sqlite-runtime.js';

const accounts = sqliteTable(
  'accounts',
  {
    apiKey: text('api_key').notNull(),
    displayName: text('display_name').notNull(),
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    role: text('role').notNull(),
  },
  kovo({
    confidentialAtRest: ['apiKey'],
    domain: 'account',
    governed: ['role'],
    key: 'id',
    owner: 'ownerId',
    secret: ['apiKey'],
  }),
);
const publicNotes = sqliteTable('public_notes', {
  message: text('message').notNull(),
});

type GovernedColumn = 'apiKey' | 'id' | 'ownerId' | 'role';
type WriteBoundary =
  | 'dynamicInsertSelect'
  | 'insert'
  | 'insertSelect'
  | 'onConflictDoUpdate'
  | 'update';

interface DriverObservation {
  boundary: 'insert.select' | 'insert.values' | 'onConflictDoUpdate.set' | 'update.set';
  payload: unknown;
}

function generatedSqliteRuntime(
  observations: DriverObservation[],
  options: {
    metadataTables?: readonly unknown[];
    tableNames?: readonly string[];
  } = {},
) {
  const raw = {
    insert(_table: unknown) {
      const builder = {
        $dynamic() {
          // Return the narrowed method surface that caught the recursive-wrap gap: `select` must
          // itself count as a builder method even when `values` is no longer reflectively visible.
          return { select: builder.select };
        },
        select(payload: unknown) {
          observations.push({ boundary: 'insert.select' as const, payload });
          return Promise.resolve('selected');
        },
        values(payload: unknown) {
          observations.push({ boundary: 'insert.values' as const, payload });
          return {
            onConflictDoUpdate(config: { set: unknown }) {
              observations.push({
                boundary: 'onConflictDoUpdate.set' as const,
                payload: config.set,
              });
              return Promise.resolve('conflict');
            },
          };
        },
      };
      return builder;
    },
    select() {
      return { from: () => [] };
    },
    update(_table: unknown) {
      return {
        set(payload: unknown) {
          observations.push({ boundary: 'update.set' as const, payload });
          return Promise.resolve('update');
        },
      };
    },
  };
  return createSqliteAppRuntimeDb({
    db: raw,
    metadata: extractKovoRuntimeDbMetadata(options.metadataTables ?? [accounts]),
    normalizeTableName: (table) => (table.includes('.') ? table : `main.${table}`),
    sqliteAuthorizer: {
      constants: nodeSqliteConstants,
      openDatabase() {
        throw new Error('The governed Drizzle builder reproduction must not execute raw SQL.');
      },
    },
    tableNames: () => [...(options.tableNames ?? ['main.accounts'])],
  });
}

const cases = (
  ['insert', 'update', 'onConflictDoUpdate', 'insertSelect', 'dynamicInsertSelect'] as const
).flatMap((boundary) =>
  (['id', 'ownerId', 'apiKey', 'role'] as const).map((column) => ({ boundary, column })),
);

describe('KV438 protected mutation lifecycle over generated SQLite runtime', () => {
  it.each(cases)(
    'blocks parsed request $column at the managed $boundary builder after an early DB wrap',
    async ({ boundary, column }: { boundary: WriteBoundary; column: GovernedColumn }) => {
      const observations: DriverObservation[] = [];
      const runtime = generatedSqliteRuntime(observations);
      // App mutation dispatch resolves the provider before runMutation derives registry.tables.
      // This first policy-free wrap is the production nesting that previously lost the sealed
      // SQLite declared-write hook when the mutation lifecycle added its write policy.
      const earlyManagedDb = managedDb(runtime.db, 'write');
      const request = {
        db: earlyManagedDb,
        session: { id: 'session-1', user: { id: 'server-owner' } },
      };
      const csrf = {
        secret: 'kv438-runtime-lifecycle-secret-0123456789abcdef',
        sessionId(value: typeof request) {
          return value.session.id;
        },
      };
      const definition = mutation(`kv438/${boundary}/${column}`, {
        csrf,
        guard: (candidate: typeof request) => candidate.session.user.id === 'server-owner',
        input: s.object({
          apiKey: s.string(),
          displayName: s.string(),
          id: s.string(),
          ownerId: s.string(),
          role: s.string(),
        }),
        registry: { tables: ['accounts'], touches: [domain('account')] },
        handler(input, guardedRequest: typeof request) {
          const payload = { [column]: input[column] };
          if (boundary === 'insert') {
            return guardedRequest.db.insert(accounts).values(payload);
          }
          if (boundary === 'update') {
            return guardedRequest.db.update(accounts).set(payload);
          }
          if (boundary === 'insertSelect') {
            return guardedRequest.db.insert(accounts).select(payload);
          }
          if (boundary === 'dynamicInsertSelect') {
            return guardedRequest.db.insert(accounts).$dynamic().select(payload);
          }
          return guardedRequest.db
            .insert(accounts)
            .values({
              apiKey: 'server-api-key',
              displayName: input.displayName,
              id: 'server-id',
              ownerId: 'server-owner',
              role: 'member',
            })
            .onConflictDoUpdate({ set: payload });
        },
      });
      const rawInput = {
        'kovo-csrf': csrfToken(request, csrf, { mutation: definition }),
        apiKey: 'attacker-api-key',
        displayName: 'Attacker controlled but non-governed',
        id: 'attacker-id',
        ownerId: 'attacker-owner',
        role: 'admin',
      };

      await expect(runMutation(definition, rawInput, request)).rejects.toThrow(
        new RegExp(
          `KV438[\\s\\S]*${
            boundary === 'onConflictDoUpdate'
              ? 'onConflictDoUpdate\\.set'
              : boundary === 'insertSelect' || boundary === 'dynamicInsertSelect'
                ? 'insert\\.select'
                : boundary === 'insert'
                  ? 'values'
                  : 'set'
          }`,
        ),
      );
      expect(observations.filter((item) => item.boundary !== 'insert.values')).toEqual([]);
      expect(observations).toEqual(
        boundary === 'onConflictDoUpdate'
          ? [
              {
                boundary: 'insert.values',
                payload: {
                  apiKey: 'server-api-key',
                  displayName: 'Attacker controlled but non-governed',
                  id: 'server-id',
                  ownerId: 'server-owner',
                  role: 'member',
                },
              },
            ]
          : [],
      );
    },
  );

  it('allows insert-select through the same nested lifecycle when the target has no governed columns', async () => {
    const observations: DriverObservation[] = [];
    const runtime = generatedSqliteRuntime(observations, {
      metadataTables: [publicNotes],
      tableNames: ['main.public_notes'],
    });
    const earlyManagedDb = managedDb(runtime.db, 'write');
    const request = {
      db: earlyManagedDb,
      session: { id: 'session-1', user: { id: 'server-owner' } },
    };
    const csrf = {
      secret: 'kv438-runtime-control-secret-0123456789abcdef',
      sessionId(value: typeof request) {
        return value.session.id;
      },
    };
    const definition = mutation('kv438/non-governed-insert-select', {
      csrf,
      guard: (candidate: typeof request) => candidate.session.user.id === 'server-owner',
      input: s.object({ message: s.string() }),
      registry: { tables: ['public_notes'], touches: [domain('public-note')] },
      handler(input, guardedRequest: typeof request) {
        return guardedRequest.db.insert(publicNotes).select({ message: input.message });
      },
    });
    const rawInput = {
      'kovo-csrf': csrfToken(request, csrf, { mutation: definition }),
      message: 'request-derived but not governed',
    };

    await expect(runMutation(definition, rawInput, request)).resolves.toMatchObject({
      ok: true,
      value: 'selected',
    });
    expect(observations).toEqual([
      {
        boundary: 'insert.select',
        payload: { message: 'request-derived but not governed' },
      },
    ]);
  });
});
