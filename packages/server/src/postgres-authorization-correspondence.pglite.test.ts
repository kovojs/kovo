import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import './sql-parser-authority-bootstrap.js';
import { createPostgresScopedClient } from './managed-db.js';
import {
  POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH,
  emitPostgresRlsPolicySql,
  enumeratePostgresOwnerPolicyModels,
  postgresOwnerColumnPolicyTerm,
  postgresOwnerPolicyModelAllows,
  postgresOwnerViaPolicyTerm,
  type PostgresOwnerPolicyModel,
  type PostgresOwnerViaPolicyTerm,
} from './postgres-authorization-correspondence.js';

const APP_ROLE = 'kovo_correspondence_reader';
const WRITER_ROLE = 'kovo_correspondence_writer';

describe('finite Postgres authorization correspondence in real PGlite', () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    clients.length = 0;
  });

  it('materializes every bounded model under FORCE RLS and matches observed visibility', async () => {
    const client = new PGlite();
    clients.push(client);
    const term = deepestOwnerViaTerm();
    const models = enumeratePostgresOwnerPolicyModels(term);
    expect(models).toHaveLength(3 ** 1 * 3 ** POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH);

    await installModelTables(client);
    const modelIds = await insertEveryModel(client, models);
    const rootTable = `level_${POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH}`;
    const policySql = emitPostgresRlsPolicySql({
      readerRole: APP_ROLE,
      schemaName: 'public',
      site: 'ownerVia',
      tableName: rootTable,
      term,
      writerRole: WRITER_ROLE,
    });
    await client.exec(`
      ALTER TABLE ${rootTable} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${rootTable} FORCE ROW LEVEL SECURITY;
      ${policySql};
      GRANT SELECT ON TABLE level_0, level_1, level_2, level_3, level_4 TO ${APP_ROLE};
    `);

    const rootCount = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${rootTable}`,
    );
    expect(rootCount.rows).toEqual([{ count: models.length }]);
    const forceRls = await client.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.${rootTable}'::regclass`,
    );
    expect(forceRls.rows).toEqual([{ relforcerowsecurity: true }]);

    const scoped = createPostgresScopedClient(client, {
      principal: 'principal',
      readOnly: true,
      role: APP_ROLE,
    });
    const visible = await scoped.query<{ id: string }>(`SELECT id FROM ${rootTable} ORDER BY id`);
    const visibleIds = new Set(visible.rows.map((row) => row.id));
    expect(visibleIds.size).toBe(
      models.filter((model) => postgresOwnerPolicyModelAllows(term, model)).length,
    );
    for (let index = 0; index < models.length; index += 1) {
      expect(visibleIds.has(modelIds[index]!), `model ${JSON.stringify(models[index])}`).toBe(
        postgresOwnerPolicyModelAllows(term, models[index]!),
      );
    }

    const principalUnset = createPostgresScopedClient(client, {
      readOnly: true,
      role: APP_ROLE,
    });
    const unsetResult = await principalUnset.query<{ id: string }>(
      `SELECT id FROM ${rootTable} ORDER BY id`,
    );
    expect(unsetResult.rows).toEqual([]);
  });
});

function deepestOwnerViaTerm(): PostgresOwnerViaPolicyTerm {
  let term = postgresOwnerViaPolicyTerm({
    fkColumnName: 'parent_id',
    parent: postgresOwnerColumnPolicyTerm({
      columnName: 'owner_id',
      tableName: 'level_0',
    }),
    parentKeyColumnName: 'id',
    tableName: 'level_1',
  });
  for (let depth = 2; depth <= POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH; depth += 1) {
    term = postgresOwnerViaPolicyTerm({
      fkColumnName: 'parent_id',
      parent: term,
      parentKeyColumnName: 'id',
      tableName: `level_${depth}`,
    });
  }
  return term;
}

async function installModelTables(client: PGlite): Promise<void> {
  await client.exec(`
    CREATE ROLE ${APP_ROLE};
    CREATE ROLE ${WRITER_ROLE};
    CREATE TABLE level_0 (id text PRIMARY KEY, owner_id text);
    CREATE TABLE level_1 (id text PRIMARY KEY, parent_id text);
    CREATE TABLE level_2 (id text PRIMARY KEY, parent_id text);
    CREATE TABLE level_3 (id text PRIMARY KEY, parent_id text);
    CREATE TABLE level_4 (id text PRIMARY KEY, parent_id text);
  `);
}

async function insertEveryModel(
  client: PGlite,
  models: readonly PostgresOwnerPolicyModel[],
): Promise<readonly string[]> {
  const rowsByLevel = Array.from(
    { length: POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH + 1 },
    () => [] as [id: string, value: string | null][],
  );
  const modelIds: string[] = [];
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]!;
    const modelId = `model_${String(index).padStart(3, '0')}`;
    modelIds.push(modelId);
    let rowId = modelId;
    for (
      let level = POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH, edgeIndex = 0;
      level > 0;
      level -= 1, edgeIndex += 1
    ) {
      const edge = model.edges[edgeIndex]!;
      const parentId =
        edge === 'null'
          ? null
          : edge === 'absent'
            ? `missing_${index}_${edgeIndex}`
            : `parent_${index}_${edgeIndex}`;
      rowsByLevel[level]!.push([rowId, parentId]);
      rowId = edge === 'present' ? parentId! : `detached_${index}_${edgeIndex}`;
      if (level === 1) {
        rowsByLevel[0]!.push([
          rowId,
          model.equality === 'true'
            ? 'principal'
            : model.equality === 'false'
              ? 'someone-else'
              : null,
        ]);
      }
    }
  }

  for (let level = 0; level < rowsByLevel.length; level += 1) {
    const valueColumn = level === 0 ? 'owner_id' : 'parent_id';
    await insertRows(client, `level_${level}`, valueColumn, rowsByLevel[level]!);
  }
  return modelIds;
}

async function insertRows(
  client: PGlite,
  table: string,
  valueColumn: string,
  rows: readonly [id: string, value: string | null][],
): Promise<void> {
  const batchSize = 100;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const placeholders = batch.map((row, index) => {
      values.push(row[0], row[1]);
      return `($${index * 2 + 1}, $${index * 2 + 2})`;
    });
    await client.query(
      `INSERT INTO ${table} (id, ${valueColumn}) VALUES ${placeholders.join(', ')}`,
      values,
    );
  }
}
