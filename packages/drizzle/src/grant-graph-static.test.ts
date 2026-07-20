import { describe, expect, it } from 'vitest';

import { extractGrantGraphFactsFromProject } from './static.js';
import { pgDatabaseTypes } from './test-helpers.js';

// @kovo-security-classifier-corpus postgres-identity-posture
describe('compiler-derived grant graph (Plan 3 §3.2 C13 anchor)', () => {
  it('derives principals, resources, right kinds, and delegation edges from schema annotations', () => {
    const facts = extractGrantGraphFactsFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'schema.ts',
          source: `
            import { sql } from 'drizzle-orm';
            import { pgTable, text } from 'drizzle-orm/pg-core';
            import { kovo } from '@kovojs/drizzle';

            export const organizations = pgTable('organizations', {
              id: text('id').primaryKey(),
              ownerId: text('owner_id').notNull(),
            }, kovo({ domain: 'organization', key: 'id', owner: 'ownerId' }));

            export const memberships = pgTable('memberships', {
              id: text('id').primaryKey(),
              organizationId: text('organization_id').notNull(),
            }, kovo({
              domain: 'membership',
              key: 'id',
              ownerVia: { fk: 'organizationId', parent: organizations, parentKey: 'id' },
            }));

            export const policyBindings = pgTable('policy_bindings', {
              id: text('id').primaryKey(),
            }, kovo({
              authzPolicy: sql\`principal_id = current_setting('kovo.principal', true)\`,
              domain: 'policy-binding',
              key: 'id',
            }));
          `,
        },
      ],
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'principal', principal: 'request-principal' }),
        expect.objectContaining({
          domain: 'organization',
          kind: 'resource',
          rightKinds: ['delegate', 'owner', 'read', 'write'],
          table: 'organizations',
        }),
        expect.objectContaining({
          domain: 'membership',
          kind: 'resource',
          rightKinds: ['delegated-owner', 'read', 'write'],
          table: 'memberships',
        }),
        expect.objectContaining({
          child: 'memberships',
          kind: 'delegation',
          parent: 'organizations',
        }),
        expect.objectContaining({
          domain: 'policy-binding',
          kind: 'resource',
          rightKinds: ['policy', 'read', 'write'],
          table: 'policy_bindings',
        }),
      ]),
    );
  });

  it('decides exact deletion as attenuation and names widening transitions as budgeted escapes', () => {
    const facts = extractGrantGraphFactsFromProject({
      files: [
        pgDatabaseTypes([
          'delete(table: unknown): { where(value: unknown): Promise<void> };',
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'grants.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';
            import { eq } from 'drizzle-orm';
            import { kovo } from '@kovojs/drizzle';
            import { mutation } from '@kovojs/server';
            import type { PgAsyncDatabase } from 'drizzle-orm/pg-core';

            interface AppRequest { db: PgAsyncDatabase<any, any> }

            export const memberships = pgTable('memberships', {
              id: text('id').primaryKey(),
              principalId: text('principal_id').notNull(),
            }, kovo({ domain: 'membership', key: 'id', owner: 'principalId' }));

            export const revokeMembership = mutation('membership.revoke', {
              async handler(input: { id: string }, request: AppRequest) {
                await request.db.delete(memberships).where(eq(memberships.id, input.id));
              },
            });
            export const grantMembership = mutation('membership.grant', {
              async handler(input: { id: string; principalId: string }, request: AppRequest) {
                await request.db.insert(memberships).values(input);
              },
            });
            export const reassignMembership = mutation('membership.reassign', {
              async handler(input: { principalId: string }, request: AppRequest) {
                await request.db.update(memberships).set({ principalId: input.principalId });
              },
            });

            export async function unusedMaintenance(request: AppRequest) {
              await request.db.insert(memberships).values({ id: 'unused', principalId: 'unused' });
            }
          `,
        },
      ],
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkedStates: 16,
          kind: 'transition',
          mutation: 'membership.revoke',
          operation: 'delete',
          resource: 'memberships',
          verdict: 'attenuating',
        }),
        expect.objectContaining({
          budget: 1,
          kind: 'escape',
          mutation: 'membership.grant',
          operation: 'insert',
          resource: 'memberships',
        }),
        expect.objectContaining({
          budget: 1,
          kind: 'escape',
          mutation: 'membership.reassign',
          operation: 'update',
          resource: 'memberships',
        }),
      ]),
    );
    expect(
      facts.some(
        (fact) =>
          (fact.kind === 'transition' || fact.kind === 'escape') &&
          fact.mutation === 'unusedMaintenance',
      ),
    ).toBe(false);
  });

  it('does not claim that deleting a row under an arbitrary authzPolicy attenuates rights', () => {
    const facts = extractGrantGraphFactsFromProject({
      files: [
        pgDatabaseTypes(['delete(table: unknown): { where(value: unknown): Promise<void> };']),
        {
          fileName: 'policy-grants.ts',
          source: `
            import { eq, sql } from 'drizzle-orm';
            import { pgTable, text } from 'drizzle-orm/pg-core';
            import { kovo } from '@kovojs/drizzle';
            import { mutation } from '@kovojs/server';
            import type { PgAsyncDatabase } from 'drizzle-orm/pg-core';

            interface AppRequest { db: PgAsyncDatabase<any, any> }
            export const policyBindings = pgTable('policy_bindings', {
              id: text('id').primaryKey(),
            }, kovo({
              authzPolicy: sql\`NOT EXISTS (SELECT 1 FROM revoked WHERE id = principal_id)\`,
              domain: 'policy-binding',
              key: 'id',
            }));

            export const deletePolicyBinding = mutation('policy-binding.delete', {
              async handler(input: { id: string }, request: AppRequest) {
                await request.db.delete(policyBindings).where(eq(policyBindings.id, input.id));
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'transition',
          operation: 'delete',
          resource: 'policy_bindings',
          verdict: 'top',
        }),
      ]),
    );
  });

  it('fails closed to top when an authz-bearing write cannot be classified', () => {
    const facts = extractGrantGraphFactsFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'opaque-grants.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';
            import { kovo } from '@kovojs/drizzle';
            import { domain, mutation } from '@kovojs/server';
            import type { PgAsyncDatabase } from 'drizzle-orm/pg-core';

            interface AppRequest { db: PgAsyncDatabase<any, any> }

            export const memberships = pgTable('memberships', {
              id: text('id').primaryKey(),
              principalId: text('principal_id').notNull(),
            }, kovo({ domain: 'membership', key: 'id', owner: 'principalId' }));

            declare function opaque(db: PgAsyncDatabase<any, any>): Promise<void>;
            export const opaqueMembership = mutation('membership.opaque', {
              registry: { touches: [domain('membership')] },
              async handler(_input: unknown, request: AppRequest) {
                await opaque(request.db);
              },
            });
          `,
        },
      ],
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'transition',
          resource: 'memberships',
          verdict: 'top',
        }),
      ]),
    );
  });
});
