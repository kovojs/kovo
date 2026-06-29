import { PGlite } from '@electric-sql/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

import { account, contacts, session, user, verification } from './schema.js';

// The app database: Drizzle over an in-process PGlite (real Postgres, compiled to
// WASM — no external server to run). `createAppDb()` opens a persistent data
// directory and idempotently seeds demo contacts.
//
// The DDL is derived from src/schema.ts so adding a Drizzle column updates the
// boot schema too. Unsupported DDL shapes fail during app startup instead of
// hiding until a later request.

/** The app runtime database. */
export type AppDb = PgliteDatabase;

export interface CreatedAppDb {
  db: AppDb;
  ready: Promise<void>;
}

const SCHEMA_TABLES = sortTablesByForeignKeyDependencies([
  contacts,
  user,
  session,
  account,
  verification,
] as const);
const SCHEMA_DDL = schemaDdl(SCHEMA_TABLES);

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park') " +
  'ON CONFLICT (id) DO NOTHING;';

const DEFAULT_DATA_DIR = '.kovo/pglite';

/** Create the app database (DDL + a few demo contacts). */
export function createAppDb(): CreatedAppDb {
  const client = new PGlite(process.env.KOVO_DATA_DIR ?? DEFAULT_DATA_DIR);
  const ready = initializeAppDb(client);
  return { db: drizzle({ client }), ready };
}

async function initializeAppDb(client: PGlite): Promise<void> {
  await client.exec(SCHEMA_DDL);
  await client.exec(SEED_CONTACTS);
}

type PgTableConfig = ReturnType<typeof getTableConfig>;
type PgTable = Parameters<typeof getTableConfig>[0];
type PgColumn = PgTableConfig['columns'][number];
type PgForeignKey = PgTableConfig['foreignKeys'][number];

function schemaDdl(tables: readonly PgTable[]): string {
  return [
    ...tables.map(createTableDdl),
    ...tables.flatMap((table) =>
      getTableConfig(table).columns.map((column) => addColumnDdl(table, column)),
    ),
  ].join('\n');
}

function createTableDdl(table: PgTable): string {
  const config = getTableConfig(table);
  const definitions = [
    ...config.columns.map((column) => columnDdl(column, { createTable: true })),
    ...config.foreignKeys.map((foreignKey) => foreignKeyDdl(foreignKey)),
  ];
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(config.name)} (${definitions.join(', ')});`;
}

function addColumnDdl(table: PgTable, column: PgColumn): string {
  return `ALTER TABLE ${quoteIdent(getTableConfig(table).name)} ADD COLUMN IF NOT EXISTS ${columnDdl(
    column,
    { createTable: false },
  )};`;
}

function columnDdl(column: PgColumn, options: { createTable: boolean }): string {
  return [
    quoteIdent(column.name),
    columnTypeDdl(column),
    options.createTable && column.primary ? 'PRIMARY KEY' : '',
    column.notNull ? 'NOT NULL' : '',
    options.createTable && column.isUnique ? 'UNIQUE' : '',
    columnDefaultDdl(column),
  ]
    .filter(Boolean)
    .join(' ');
}

function columnTypeDdl(column: PgColumn): string {
  switch (column.columnType) {
    case 'PgBoolean':
      return 'boolean';
    case 'PgInteger':
      return 'integer';
    case 'PgJsonb':
      return 'jsonb';
    case 'PgNumeric':
      return 'numeric';
    case 'PgSerial':
      return 'serial';
    case 'PgText':
      return 'text';
    case 'PgTimestamp':
      return 'timestamp';
    default:
      throw new Error(`Unsupported Postgres starter column type ${column.columnType}`);
  }
}

function columnDefaultDdl(column: PgColumn): string {
  if (!column.hasDefault) return '';
  if (column.columnType === 'PgSerial') return '';
  if (column.columnType === 'PgTimestamp') return 'DEFAULT now()';
  if (typeof column.default === 'boolean') return `DEFAULT ${column.default ? 'true' : 'false'}`;
  if (typeof column.default === 'number') return `DEFAULT ${column.default}`;
  if (typeof column.default === 'string') return `DEFAULT ${quoteLiteral(column.default)}`;
  throw new Error(`Unsupported Postgres starter default for ${column.name}`);
}

function foreignKeyDdl(foreignKey: PgForeignKey): string {
  const reference = foreignKey.reference();
  const columns = reference.columns.map((column) => quoteIdent(column.name)).join(', ');
  const foreignColumns = reference.foreignColumns
    .map((column) => quoteIdent(column.name))
    .join(', ');
  const onDelete = foreignKey.onDelete === 'no action' ? '' : ` ON DELETE ${foreignKey.onDelete}`;
  const onUpdate = foreignKey.onUpdate === 'no action' ? '' : ` ON UPDATE ${foreignKey.onUpdate}`;
  return `FOREIGN KEY (${columns}) REFERENCES ${quoteIdent(
    getTableConfig(reference.foreignTable).name,
  )} (${foreignColumns})${onDelete}${onUpdate}`;
}

function sortTablesByForeignKeyDependencies(tables: readonly PgTable[]): PgTable[] {
  const pending = new Set<PgTable>(tables);
  const sorted: PgTable[] = [];

  while (pending.size > 0) {
    let progressed = false;

    for (const table of pending) {
      const dependencies = getTableConfig(table).foreignKeys.map(
        (foreignKey) => foreignKey.reference().foreignTable,
      );
      if (dependencies.some((dependency) => dependency !== table && pending.has(dependency))) {
        continue;
      }
      sorted.push(table);
      pending.delete(table);
      progressed = true;
    }

    if (!progressed) {
      const names = [...pending].map((table) => getTableConfig(table).name).join(', ');
      throw new Error(`Cannot order Postgres starter tables with cyclic foreign keys: ${names}`);
    }
  }

  return sorted;
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The running app database. The server reads/writes this singleton per request. */
const appDatabase = createAppDb();
export const appDb = appDatabase.db;
export const appDbReady = appDatabase.ready;
