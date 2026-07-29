import { describe, expect, it } from 'vitest';

import { publicAccess } from './access.js';
import { defineKovo } from './app-contract.js';
import { resolveKovoAppToken } from './app-token.js';
import { createRequestHandler } from './app.js';
import { assignDerivedMutationKey } from './mutation/definition.js';
import { assignDerivedQueryKey } from './query.js';
import { s } from './schema.js';

const APP_ID = '5f31d8d7-45e7-4e91-a34b-2b1263de9b5e';

describe('defineKovo app contract', () => {
  it('keeps providers inert until request dispatch and closes them behind an opaque token', async () => {
    let authCalls = 0;
    let dbCalls = 0;
    const db = {
      select() {
        return {
          from() {
            return Promise.resolve([{ id: 'c1', name: 'Ada' }]);
          },
        };
      },
    };
    const contract = defineKovo({
      appId: APP_ID,
      auth: async () => {
        authCalls += 1;
        return { user: { id: 'u1' } };
      },
      db: async () => {
        dbCalls += 1;
        return db;
      },
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
      env: s.object({ APP_NAME: s.string() }),
      envSource: { APP_NAME: 'Kovo CRM' },
    });

    const contacts = assignDerivedQueryKey(
      contract.query({
        access: [contract.authenticated],
        async load(_input, context) {
          expect(context.env.APP_NAME).toBe('Kovo CRM');
          expect(context.session.user.id).toBe('u1');
          expect(context.signal).toBeInstanceOf(AbortSignal);
          return { items: await context.db.select().from() };
        },
      }),
      'test/contacts',
    );

    expect(authCalls).toBe(0);
    expect(dbCalls).toBe(0);

    const token = contract.assemble({ queries: [contacts] });
    const runtime = resolveKovoAppToken(token, 'app-contract test');
    expect(runtime.env).toEqual({ APP_NAME: 'Kovo CRM' });
    expect(runtime.queries).toHaveLength(1);
    expect(Object.keys(token)).toEqual([]);
    expect(authCalls).toBe(0);
    expect(dbCalls).toBe(0);

    const response = await createRequestHandler(runtime)(
      new Request('https://kovo.test/_q/test%2Fcontacts'),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      '{"items":[{"id":"c1","name":"Ada"}]}',
    );
    expect(authCalls).toBe(1);
    expect(dbCalls).toBe(1);
  });

  it('rejects orphan, duplicate, foreign, and repeated assembly handles', () => {
    const first = defineKovo({
      appId: APP_ID,
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const second = defineKovo({
      appId: '47b52d7a-bde4-49ce-881c-e6e8755f55a8',
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const firstQuery = assignDerivedQueryKey(
      first.query({ access: publicAccess('unit-test public query'), load: () => null }),
      'test/first',
    );
    const secondQuery = assignDerivedQueryKey(
      second.query({ access: publicAccess('unit-test public query'), load: () => null }),
      'test/second',
    );

    expect(() => first.assemble({})).toThrow(/KOVO_APP_ORPHAN_DECLARATION/u);
    expect(() => first.assemble({ queries: [firstQuery] })).toThrow(/after assembly has failed/u);
    expect(() =>
      second.assemble({
        // @ts-expect-error app-owned handles cannot cross contract boundaries.
        queries: [firstQuery],
      }),
    ).toThrow(/KOVO_APP_OWNER_MISMATCH/u);

    const duplicate = defineKovo({
      appId: '4f5e67ce-a633-4332-bc7f-a9b51b29ace0',
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const duplicateQuery = assignDerivedQueryKey(
      duplicate.query({ access: publicAccess('unit-test public query'), load: () => null }),
      'test/duplicate',
    );
    expect(() =>
      duplicate.assemble({ queries: [duplicateQuery, duplicateQuery] }),
    ).toThrow(/KOVO_APP_DUPLICATE_DECLARATION/u);

    expect(secondQuery.key).toBe('test/second');
  });

  it('binds optimistic policies to exact query handles and survives derived mutation identity', () => {
    const contract = defineKovo({
      appId: APP_ID,
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const contacts = assignDerivedQueryKey(
      contract.query({
        access: publicAccess('unit-test public query'),
        load: () => ({ items: [] as { id: string }[] }),
      }),
      'test/contacts',
    );
    const createContact = assignDerivedMutationKey(
      contract.mutation({
        access: publicAccess('unit-test public mutation'),
        input: s.object({ id: s.string() }),
        optimistic: [
          contacts.optimistic<{ readonly id: string }>((value, input) => ({
            items: [...value.items, { id: input.id }],
          })),
        ],
        handler: (input) => ({ id: input.id }),
      }),
      'test/create-contact',
    );

    const token = contract.assemble({
      mutations: [createContact],
      queries: [contacts],
    });
    const runtime = resolveKovoAppToken(token, 'app-contract optimistic test');
    const optimistic = runtime.mutations[0]?.optimistic;
    expect(optimistic).toBeDefined();
    expect(Object.keys(optimistic ?? {})).toEqual(['test/contacts']);
    const transform = (optimistic as Record<string, unknown>)['test/contacts'];
    expect(typeof transform).toBe('function');
    expect(
      (transform as (value: { items: { id: string }[] }, input: { id: string }) => unknown)(
        { items: [] },
        { id: 'pending' },
      ),
    ).toEqual({ items: [{ id: 'pending' }] });
  });
});
