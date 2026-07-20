import { describe, expect, it } from 'vitest';

import { extractGrantGraphFactsFromProject } from './static.js';

// @kovo-security-classifier-corpus postgres-identity-posture
describe('compiler-derived grant graph (Plan 3 §3.2 C13 anchor)', () => {
  it('derives principals, resources, right kinds, and delegation edges from schema annotations', () => {
    const facts = extractGrantGraphFactsFromProject({
      files: [
        {
          fileName: '/app/schema.ts',
          source: `
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
        {
          fileName: '/app/grants.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';
            import { eq } from 'drizzle-orm';
            import { kovo } from '@kovojs/drizzle';
            import { domain } from '@kovojs/server';

            export const memberships = pgTable('memberships', {
              id: text('id').primaryKey(),
              principalId: text('principal_id').notNull(),
            }, kovo({ domain: 'membership', key: 'id', owner: 'principalId' }));

            export const membership = domain({
              revoke: async (db, input) => db.delete(memberships).where(eq(memberships.id, input.id)),
              grant: async (db, input) => db.insert(memberships).values(input),
              reassign: async (db, input) => db.update(memberships).set({ principalId: input.principalId }),
            });
          `,
        },
      ],
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkedStates: 16,
          kind: 'transition',
          operation: 'delete',
          resource: 'memberships',
          verdict: 'attenuating',
        }),
        expect.objectContaining({
          budget: 1,
          kind: 'escape',
          operation: 'insert',
          resource: 'memberships',
        }),
        expect.objectContaining({
          budget: 1,
          kind: 'escape',
          operation: 'update',
          resource: 'memberships',
        }),
      ]),
    );
  });

  it('fails closed to top when an authz-bearing write cannot be classified', () => {
    const facts = extractGrantGraphFactsFromProject({
      files: [
        {
          fileName: '/app/opaque-grants.ts',
          source: `
            import { pgTable, text } from 'drizzle-orm/pg-core';
            import { kovo } from '@kovojs/drizzle';
            import { domain, write } from '@kovojs/server';

            export const memberships = pgTable('memberships', {
              id: text('id').primaryKey(),
              principalId: text('principal_id').notNull(),
            }, kovo({ domain: 'membership', key: 'id', owner: 'principalId' }));

            declare function opaque(db: unknown): Promise<void>;
            export const membership = domain({
              opaque: write({ tables: ['memberships'], touches: ['membership'] }, async (db) => {
                await opaque(db);
              }),
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
