import { readFileSync } from 'node:fs';

import { extractKovoRuntimeDbMetadata, kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  explainGuard,
  explainPostgresGuardCorrespondence,
  guardAuditName,
  guards,
} from './guards.js';
import {
  POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH,
  POSTGRES_RLS_SQL_EMISSION_SITES,
  createFrameworkPostgresOwnerColumnBinding,
  decidePostgresOwnerPolicyCorrespondence,
  deriveFrameworkPostgresOwnsRow,
  emitPostgresRlsPolicySql,
  enumeratePostgresOwnerPolicyModels,
  evaluatePostgresOwnerPolicyModel,
  postgresOwnerColumnPolicyTerm,
  postgresOwnerPolicyModelAllows,
  postgresOwnerPolicyShape,
  postgresOwnerViaPolicyTerm,
  renderPostgresOwnerPolicyPredicate,
  type PostgresOwnerPolicyModel,
  type PostgresOwnerPolicyParentLookup,
  type PostgresOwnerPolicyTerm,
} from './postgres-authorization-correspondence.js';
import { __testPostgresRuntimeInternals } from './postgres-runtime.js';

describe('finite Postgres authorization correspondence', () => {
  it('freezes the five and only five production RLS SQL emission sites', () => {
    expect(POSTGRES_RLS_SQL_EMISSION_SITES).toEqual([
      'owner',
      'ownerVia',
      'authzPolicy',
      'system',
      'admin',
    ]);
    expect(Object.isFrozen(POSTGRES_RLS_SQL_EMISSION_SITES)).toBe(true);

    const runtimeSource = readFileSync(new URL('./postgres-runtime.ts', import.meta.url), 'utf8');
    expect(runtimeSource).not.toContain('CREATE POLICY');
    for (const site of POSTGRES_RLS_SQL_EMISSION_SITES) {
      const matches = runtimeSource.match(new RegExp(`site: '${site}'`, 'gu')) ?? [];
      expect(matches, `${site} production emission call count`).toHaveLength(1);
    }
  });

  it('preserves the C13 byte corpus while rendering SQL from the two-constructor term', () => {
    const owner = postgresOwnerColumnPolicyTerm({
      columnName: 'user_id',
      tableName: 'orders',
    });
    const items = postgresOwnerViaPolicyTerm({
      fkColumnName: 'order_id',
      parent: owner,
      parentKeyColumnName: 'id',
      tableName: 'order_items',
    });
    const adjustments = postgresOwnerViaPolicyTerm({
      fkColumnName: 'item_id',
      parent: items,
      parentKeyColumnName: 'id',
      tableName: 'adjustments',
    });

    expect(renderPostgresOwnerPolicyPredicate(owner)).toBe(
      `"user_id" = current_setting('kovo.principal', true)`,
    );
    expect(renderPostgresOwnerPolicyPredicate(items)).toBe(
      `EXISTS (SELECT 1 FROM "orders" "kovo_parent_orders_2" WHERE "kovo_parent_orders_2"."id" = "order_items"."order_id" AND "kovo_parent_orders_2"."user_id" = current_setting('kovo.principal', true))`,
    );
    expect(renderPostgresOwnerPolicyPredicate(adjustments)).toBe(
      `EXISTS (SELECT 1 FROM "order_items" "kovo_parent_order_items_2" WHERE "kovo_parent_order_items_2"."id" = "adjustments"."item_id" AND EXISTS (SELECT 1 FROM "orders" "kovo_parent_orders_3" WHERE "kovo_parent_orders_3"."id" = "kovo_parent_order_items_2"."order_id" AND "kovo_parent_orders_3"."user_id" = current_setting('kovo.principal', true)))`,
    );

    expect(
      emitPostgresRlsPolicySql({
        readerRole: 'reader',
        schemaName: 'public',
        site: 'owner',
        tableName: 'orders',
        term: owner,
        writerRole: 'writer',
      }),
    ).toBe(
      `CREATE POLICY kovo_owner_scope ON "public"."orders" FOR ALL TO "reader", "writer" USING ("user_id" = current_setting('kovo.principal', true)) WITH CHECK ("user_id" = current_setting('kovo.principal', true))`,
    );
    expect(
      emitPostgresRlsPolicySql({
        predicate: `visibility = 'public'`,
        readerRole: 'reader',
        schemaName: 'public',
        site: 'authzPolicy',
        tableName: 'documents',
        writerRole: 'writer',
      }),
    ).toBe(
      `CREATE POLICY kovo_authz_policy ON "public"."documents" FOR ALL TO "reader", "writer" USING (visibility = 'public') WITH CHECK (visibility = 'public')`,
    );
    expect(
      emitPostgresRlsPolicySql({
        schemaName: 'public',
        site: 'system',
        systemRole: 'system',
        tableName: 'orders',
      }),
    ).toBe(
      `CREATE POLICY kovo_system_scope ON "public"."orders" FOR ALL TO "system" USING (true) WITH CHECK (true)`,
    );
    expect(
      emitPostgresRlsPolicySql({
        adminRole: 'admin',
        schemaName: 'public',
        site: 'admin',
        tableName: 'orders',
      }),
    ).toBe(
      `CREATE POLICY kovo_admin_scope ON "public"."orders" FOR SELECT TO "admin" USING (true)`,
    );
  });

  it('makes the live runtime resolve owner predicates through the same explainable terms', () => {
    const accounts = pgTable(
      'correspondence_accounts',
      { id: text('id').primaryKey(), ownerId: text('owner_id') },
      kovo({ domain: 'correspondence-accounts', key: 'id', owner: 'ownerId' }),
    );
    const entries = pgTable(
      'correspondence_entries',
      { accountId: text('account_id'), id: text('id').primaryKey() },
      kovo({
        domain: 'correspondence-entries',
        key: 'id',
        ownerVia: { fk: 'accountId', parent: accounts, parentKey: 'id' },
      }),
    );
    const metadata = extractKovoRuntimeDbMetadata([accounts, entries]);

    expect(
      __testPostgresRuntimeInternals.resolveAuthorizationPolicyExplainInputs(
        [accounts, entries],
        metadata,
      ),
    ).toEqual([
      {
        emissionSite: 'owner',
        predicate: `"owner_id" = current_setting('kovo.principal', true)`,
        tableName: 'correspondence_accounts',
        term: {
          columnName: 'owner_id',
          kind: 'ownerColumn',
          tableName: 'correspondence_accounts',
        },
      },
      {
        emissionSite: 'ownerVia',
        predicate:
          `EXISTS (SELECT 1 FROM "correspondence_accounts" "kovo_parent_correspondence_accounts_2" ` +
          `WHERE "kovo_parent_correspondence_accounts_2"."id" = "correspondence_entries"."account_id" ` +
          `AND "kovo_parent_correspondence_accounts_2"."owner_id" = current_setting('kovo.principal', true))`,
        tableName: 'correspondence_entries',
        term: {
          fkColumnName: 'account_id',
          kind: 'ownerVia',
          parent: {
            columnName: 'owner_id',
            kind: 'ownerColumn',
            tableName: 'correspondence_accounts',
          },
          parentKeyColumnName: 'id',
          tableName: 'correspondence_entries',
        },
      },
    ]);
  });

  it('enumerates exactly 3^k * 3^e models through the shipped depth bound', () => {
    let term: PostgresOwnerPolicyTerm = postgresOwnerColumnPolicyTerm({
      columnName: 'owner_id',
      tableName: 'level_0',
    });
    for (let depth = 0; depth <= POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH; depth += 1) {
      const shape = postgresOwnerPolicyShape(term);
      const models = enumeratePostgresOwnerPolicyModels(term);
      expect(shape).toEqual({
        edgeCount: depth,
        equalityCount: 1,
        modelCount: 3 ** 1 * 3 ** depth,
      });
      expect(models).toHaveLength(3 ** 1 * 3 ** depth);
      expect(new Set(models.map((model) => JSON.stringify(model))).size).toBe(models.length);
      if (depth < POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH) {
        term = postgresOwnerViaPolicyTerm({
          fkColumnName: 'parent_id',
          parent: term,
          parentKeyColumnName: 'id',
          tableName: `level_${depth + 1}`,
        });
      }
    }

    expect(() =>
      postgresOwnerViaPolicyTerm({
        fkColumnName: 'parent_id',
        parent: term,
        parentKeyColumnName: 'id',
        tableName: 'too_deep',
      }),
    ).toThrow(/KV414.*depth 5.*finite Kovo bound 4/u);
  });

  it('uses Kleene truth and kills the NULL/unset over-permission mirror', () => {
    const term = postgresOwnerColumnPolicyTerm({
      columnName: 'owner_id',
      tableName: 'documents',
    });
    expect(evaluatePostgresOwnerPolicyModel(term, { edges: [], equality: 'null' })).toBe('null');
    expect(postgresOwnerPolicyModelAllows(term, { edges: [], equality: 'null' })).toBe(false);

    const exact = decidePostgresOwnerPolicyCorrespondence(term, (model) =>
      postgresOwnerPolicyModelAllows(term, model),
    );
    expect(exact).toEqual({ checkedModels: 3, expectedModels: 3, status: 'proved' });

    // Old app mirror: row.ownerId === req.session.userId. If both are absent, JS says true while
    // SQL's NULL = unset current_setting is UNKNOWN and FORCE RLS denies the row.
    const oldHandWrittenMirror = (model: PostgresOwnerPolicyModel): boolean => {
      const ownerId =
        model.equality === 'true'
          ? 'principal'
          : model.equality === 'false'
            ? 'someone-else'
            : undefined;
      const sessionUserId = model.equality === 'null' ? undefined : 'principal';
      return ownerId === sessionUserId;
    };
    const divergent = decidePostgresOwnerPolicyCorrespondence(term, oldHandWrittenMirror);
    expect(divergent).toEqual({
      checkedModels: 2,
      counterexample: {
        expected: false,
        model: { edges: [], equality: 'null' },
        observed: true,
      },
      expectedModels: 3,
      status: 'divergent',
    });
  });

  it('derives concrete ownsRow behavior from the same term for every finite model', async () => {
    const term = deepestTerm();
    for (const model of enumeratePostgresOwnerPolicyModels(term)) {
      const materialized = materializeModel(term, model);
      const ownsRow = deriveFrameworkPostgresOwnsRow(term, materialized.lookupParent);
      await expect(ownsRow(materialized.row, 'principal')).resolves.toBe(
        postgresOwnerPolicyModelAllows(term, model),
      );
    }

    const direct = postgresOwnerColumnPolicyTerm({
      columnName: 'owner_id',
      tableName: 'documents',
    });
    const ownsDirect = deriveFrameworkPostgresOwnsRow(direct, () => undefined);
    await expect(ownsDirect({}, undefined)).resolves.toBe(false);
  });

  it('pairs RLS and guard facts while leaving every non-finite or arbitrary path honest', () => {
    const term = postgresOwnerColumnPolicyTerm({
      columnName: 'owner_id',
      tableName: 'documents',
    });
    const predicate = renderPostgresOwnerPolicyPredicate(term);
    const arbitraryGuard = guards.unprovenOwns(
      (request: { args: { id: string }; session?: { user?: { id?: string } } }) => request.args.id,
      async () => true,
      {
        justification: 'Legacy application predicate under explicit review.',
        resourceKey: 'args.id',
      },
    );
    const ownerPolicy = {
      emissionSite: 'owner' as const,
      predicate,
      tableName: 'documents',
      term,
    };

    const unproven = explainPostgresGuardCorrespondence({
      guard: arbitraryGuard,
      policy: ownerPolicy,
    });
    expect(unproven).toMatchObject({
      guard: {
        facts: [{ kind: 'owns', staticProof: 'not-claimed' }],
        semantics: 'arbitrary-app-callback',
      },
      rls: { emissionSite: 'owner', predicate, tableName: 'documents' },
      roleGuc: { readers: 0, status: 'dead', writers: 1 },
      schema: 'kovo.postgres.authorization-correspondence/v1',
      status: 'unproven',
    });
    expect(unproven.roleGuc.warning).toContain('no generated RLS predicate reads it');

    const abstractMatch = explainPostgresGuardCorrespondence({
      guard: arbitraryGuard,
      guardModelVerdict: (model) => postgresOwnerPolicyModelAllows(term, model),
      policy: ownerPolicy,
    });
    expect(abstractMatch.decision).toEqual({
      checkedModels: 3,
      expectedModels: 3,
      status: 'proved',
    });
    expect(abstractMatch.status).toBe('unproven');
    expect(abstractMatch.guard.semantics).toBe('arbitrary-app-callback');

    const roleGuard = guards.role('billing');
    const roleRecord = explainPostgresGuardCorrespondence({
      guard: roleGuard,
      policy: {
        emissionSite: 'authzPolicy',
        predicate: `organization_id = current_setting('kovo.principal', true)`,
        tableName: 'invoices',
      },
    });
    expect(roleRecord.status).toBe('unproven');
    expect(roleRecord.reason).toContain('outside the two-constructor owner');
    expect(roleRecord.guard.facts).toContainEqual(expect.objectContaining({ kind: 'role' }));

    const oldMirrorRecord = explainPostgresGuardCorrespondence({
      guard: arbitraryGuard,
      guardModelVerdict: (model) => model.equality !== 'false',
      policy: ownerPolicy,
    });
    expect(oldMirrorRecord.status).toBe('divergent');
    expect(oldMirrorRecord.decision?.counterexample).toEqual({
      expected: false,
      model: { edges: [], equality: 'null' },
      observed: true,
    });

    for (const emissionSite of ['system', 'admin'] as const) {
      expect(
        explainPostgresGuardCorrespondence({
          guard: undefined,
          policy: { emissionSite, predicate: 'true', tableName: 'documents' },
        }).status,
      ).toBe('unproven');
    }
  });

  it('accepts only a framework-witnessed owner binding on the proven guards.owns path', async () => {
    type Request = {
      args: { id: string };
      session?: { user?: { id?: string } };
    };
    const term = postgresOwnerColumnPolicyTerm({
      columnName: 'owner_id',
      tableName: 'documents',
    });
    let accessorReads = 0;
    const accessorRow = {} as Readonly<Record<string, unknown>>;
    Object.defineProperty(accessorRow, 'owner_id', {
      get() {
        accessorReads += 1;
        return 'principal';
      },
    });
    const rows = new Map<string, Readonly<Record<string, unknown>>>([
      ['owned', { owner_id: 'principal' }],
      ['snapshot', { owner_id: 'principal' }],
      ['foreign', { owner_id: 'someone-else' }],
      ['null-owner', { owner_id: null }],
      ['unset-owner', {}],
      ['inherited-owner', Object.create({ owner_id: 'principal' })],
      ['accessor-owner', accessorRow],
    ]);
    const binding = createFrameworkPostgresOwnerColumnBinding<Request, string>({
      lookupRow: (request, key) => {
        if (key === 'snapshot' && request.session?.user !== undefined) {
          request.session.user.id = 'mutated-after-principal-snapshot';
        }
        return rows.get(key);
      },
      term,
    });
    const guard = guards.owns<Request, Request, string>((request) => request.args.id, binding, {
      name: 'document-owner',
      resourceKey: 'args.id',
    });
    expect(guardAuditName(guard)).toBe('owns');

    await expect(
      guard({ args: { id: 'owned' }, session: { user: { id: 'principal' } } }),
    ).resolves.toBe(true);
    for (const id of [
      'foreign',
      'null-owner',
      'unset-owner',
      'inherited-owner',
      'accessor-owner',
      'missing',
    ]) {
      await expect(
        guard({ args: { id }, session: { user: { id: 'principal' } } }),
      ).resolves.toEqual({ kind: 'forbidden', payload: {} });
    }
    expect(accessorReads).toBe(0);
    const snapshotRequest: Request = {
      args: { id: 'snapshot' },
      session: { user: { id: 'principal' } },
    };
    await expect(guard(snapshotRequest)).resolves.toBe(true);
    expect(snapshotRequest.session?.user?.id).toBe('mutated-after-principal-snapshot');

    expect(() =>
      guards.owns<Request, Request, string>(
        (request) => request.args.id,
        (async () => true) as never,
      ),
    ).toThrow(/framework-minted Postgres ownership binding/u);
    expect(() =>
      guards.owns<Request, Request, string>(
        (request) => request.args.id,
        Object.freeze({}) as never,
      ),
    ).toThrow(/framework-minted Postgres ownership binding/u);

    const correspondence = explainPostgresGuardCorrespondence({
      guard,
      policy: {
        emissionSite: 'owner',
        predicate: renderPostgresOwnerPolicyPredicate(term),
        tableName: 'documents',
        term,
      },
    });
    expect(correspondence).toMatchObject({
      decision: { checkedModels: 3, expectedModels: 3, status: 'proved' },
      guard: {
        facts: [
          {
            kind: 'owns',
            ownerPolicy: {
              emissionSite: 'owner',
              predicate: renderPostgresOwnerPolicyPredicate(term),
              tableName: 'documents',
            },
            staticProof: 'framework-derived-owner-column',
          },
        ],
        semantics: 'framework-derived-owner-column',
      },
      status: 'proved',
    });

    const otherTerm = postgresOwnerColumnPolicyTerm({
      columnName: 'owner_id',
      tableName: 'invoices',
    });
    expect(
      explainPostgresGuardCorrespondence({
        guard,
        policy: {
          emissionSite: 'owner',
          predicate: renderPostgresOwnerPolicyPredicate(otherTerm),
          tableName: 'invoices',
          term: otherTerm,
        },
      }),
    ).toMatchObject({
      guard: { semantics: 'framework-derived-owner-column' },
      reason: expect.stringContaining('different generated Postgres owner policy'),
      status: 'divergent',
    });

    const unprovenGuard = guards.unprovenOwns<Request, Request, string>(
      (request) => request.args.id,
      async () => true,
      { justification: 'Legacy application predicate under explicit review.' },
    );
    expect(
      explainPostgresGuardCorrespondence({
        guard: unprovenGuard,
        policy: {
          emissionSite: 'owner',
          predicate: renderPostgresOwnerPolicyPredicate(term),
          tableName: 'documents',
          term,
        },
      }),
    ).toMatchObject({
      guard: { semantics: 'arbitrary-app-callback' },
      status: 'unproven',
    });
  });

  it('keeps ownerVia behind the justified unproven escape until parent lookup is framework-owned', async () => {
    type Request = {
      args: { id: string };
      session?: { user?: { id?: string } };
    };
    const accounts = postgresOwnerColumnPolicyTerm({
      columnName: 'owner_id',
      tableName: 'accounts',
    });
    const entries = postgresOwnerViaPolicyTerm({
      fkColumnName: 'account_id',
      parent: accounts,
      parentKeyColumnName: 'id',
      tableName: 'entries',
    });
    expect(() =>
      createFrameworkPostgresOwnerColumnBinding<Request, string>({
        lookupRow: () => ({ account_id: 'account-1' }),
        term: entries as never,
      }),
    ).toThrow(/ownerVia requires guards\.unprovenOwns/u);

    const guard = guards.unprovenOwns<Request, Request, string>(
      (request) => request.args.id,
      async (_request, key) => key === 'entry-1',
      { justification: 'ownerVia traversal is pending a framework-owned parent lookup.' },
    );
    expect(explainGuard(guard)).toMatchObject([
      {
        justification: 'ownerVia traversal is pending a framework-owned parent lookup.',
        staticProof: 'not-claimed',
      },
    ]);
    expect(
      explainPostgresGuardCorrespondence({
        guard,
        policy: {
          emissionSite: 'ownerVia',
          predicate: renderPostgresOwnerPolicyPredicate(entries),
          tableName: 'entries',
          term: entries,
        },
      }),
    ).toMatchObject({
      guard: { semantics: 'arbitrary-app-callback' },
      status: 'unproven',
    });
  });
});

function deepestTerm(): PostgresOwnerPolicyTerm {
  let term: PostgresOwnerPolicyTerm = postgresOwnerColumnPolicyTerm({
    columnName: 'owner_id',
    tableName: 'level_0',
  });
  for (let depth = 1; depth <= POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH; depth += 1) {
    term = postgresOwnerViaPolicyTerm({
      fkColumnName: 'parent_id',
      parent: term,
      parentKeyColumnName: 'id',
      tableName: `level_${depth}`,
    });
  }
  return term;
}

function materializeModel(
  term: PostgresOwnerPolicyTerm,
  model: PostgresOwnerPolicyModel,
): {
  lookupParent: PostgresOwnerPolicyParentLookup;
  row: Readonly<Record<string, unknown>>;
} {
  const parents = new Map<string, Readonly<Record<string, unknown>>>();
  const build = (current: PostgresOwnerPolicyTerm, edgeIndex: number): Record<string, unknown> => {
    if (current.kind === 'ownerColumn') {
      return {
        [current.columnName]:
          model.equality === 'true'
            ? 'principal'
            : model.equality === 'false'
              ? 'someone-else'
              : null,
      };
    }
    const edge = model.edges[edgeIndex]!;
    if (edge === 'null') return { [current.fkColumnName]: null };
    const keyValue = `model-parent-${edgeIndex}`;
    if (edge === 'present') {
      const parent = build(current.parent, edgeIndex + 1);
      parent[current.parentKeyColumnName] = keyValue;
      parents.set(
        parentLookupKey(current.parent.tableName, current.parentKeyColumnName, keyValue),
        parent,
      );
    }
    return { [current.fkColumnName]: keyValue };
  };
  return {
    lookupParent: ({ keyColumnName, keyValue, tableName }) =>
      parents.get(parentLookupKey(tableName, keyColumnName, keyValue)),
    row: build(term, 0),
  };
}

function parentLookupKey(tableName: string, keyColumnName: string, keyValue: unknown): string {
  return `${tableName}\u0000${keyColumnName}\u0000${String(keyValue)}`;
}
