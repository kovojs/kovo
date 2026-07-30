import { describe, expect, expectTypeOf, it } from 'vitest';

import { publicAccess } from './access.js';
import {
  agent,
  agentContent,
  assignDerivedAgentModelOperations,
  assignDerivedAgentToolOperations,
  runAgentTurn,
  tool,
} from './agent.js';
import { defineKovo } from './app-contract.js';
import { resolveKovoAppToken, type InferKovoAppTypes } from './app-token.js';
import { registerAppMutationAdapter } from './app-mutation-adapter.js';
import { createRequestHandler } from './app.js';
import { endpoint } from './endpoint.js';
import { declaredKovoAppId } from './live-target-app-identity.js';
import { mutation } from './mutation/definition.js';
import { assignDerivedMutationKey } from './mutation/definition.js';
import { assignDerivedQueryKey } from './query.js';
import { s } from './schema.js';
import { webhook } from './webhook.js';

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
    type AppTypes = InferKovoAppTypes<typeof token>;
    expectTypeOf<AppTypes['declarations']['query']>().toEqualTypeOf<typeof contacts>();
    expectTypeOf<AppTypes['declarations']['mutation']>().toBeNever();
    expectTypeOf<AppTypes['db']>().toEqualTypeOf<typeof db>();
    const runtime = resolveKovoAppToken(token, 'app-contract test');
    expect(declaredKovoAppId(runtime)).toBe(APP_ID);
    expect(runtime.env).toEqual({ APP_NAME: 'Kovo CRM' });
    expect(runtime.queries).toHaveLength(1);
    expect(Object.keys(token)).toEqual([]);
    expect(authCalls).toBe(0);
    expect(dbCalls).toBe(0);

    const response = await createRequestHandler(runtime)(
      new Request('https://kovo.test/_q/test%2Fcontacts'),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('{"items":[{"id":"c1","name":"Ada"}]}');
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
    expect(() => duplicate.assemble({ queries: [duplicateQuery, duplicateQuery] })).toThrow(
      /KOVO_APP_DUPLICATE_DECLARATION/u,
    );

    expect(secondQuery.key).toBe('test/second');
  });

  it('keeps direct declaration factories closed after assembly', () => {
    const contract = defineKovo({
      appId: APP_ID,
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    contract.assemble({});

    expect(() =>
      contract.query({
        access: publicAccess('closed contract negative control'),
        load: () => null,
      }),
    ).toThrow(/app\.query\(\) cannot run after assembly has closed/u);
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
    const createContactInput = s.object({ id: s.string() });
    const createContact = assignDerivedMutationKey(
      contract.mutation({
        access: publicAccess('unit-test public mutation'),
        input: createContactInput,
        optimistic: [
          contacts.optimistic(createContactInput, (value, input) => ({
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

  it('integrates exact framework mutation adapters without accepting structural copies', () => {
    const contract = defineKovo({
      appId: APP_ID,
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const credentialMutation = registerAppMutationAdapter(
      mutation('auth/sign-in', {
        access: publicAccess('unit-test credential adapter'),
        csrf: false,
        csrfJustification: 'unit-test machine credential adapter',
        input: s.object({ email: s.string() }),
        handler: ({ email }) => ({ email }),
      }),
    );
    const integrated = contract.integrateMutation(credentialMutation);

    const token = contract.assemble({ mutations: [integrated] });
    const runtime = resolveKovoAppToken(token, 'app-contract adapter test');
    expect(runtime.mutations.map((definition) => definition.key)).toEqual(['auth/sign-in']);

    const forgedContract = defineKovo({
      appId: '7ca98c5f-76c3-4825-9647-69701e2ecf78',
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const structuralMutation = mutation('auth/forged', {
      access: publicAccess('unit-test structural negative control'),
      csrf: false,
      csrfJustification: 'unit-test structural negative control',
      input: s.object({ email: s.string() }),
      handler: ({ email }) => ({ email }),
    });
    expect(() =>
      forgedContract.integrateMutation(
        // @ts-expect-error a structural mutation is not an opaque framework adapter.
        structuralMutation,
      ),
    ).toThrow(/KOVO_APP_MUTATION_ADAPTER/u);
  });

  it('adopts standalone advanced endpoints by exact identity without ambient registration', () => {
    const contract = defineKovo({
      appId: APP_ID,
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const standaloneWebhook = webhook('/hooks/contact', {
      handler: () => ({ ok: true }),
      input: s.object({ id: s.string() }),
      verify: 'none',
      verifyJustification: 'isolated app-contract bridge test',
    });
    const adoptedWebhook = contract.endpoint(standaloneWebhook);

    expect(adoptedWebhook).toBe(standaloneWebhook);
    expectTypeOf(adoptedWebhook.path).toEqualTypeOf<'/hooks/contact'>();
    if (false) {
      // @ts-expect-error adopted advanced declarations expose only the opaque endpoint handle.
      adoptedWebhook.webhookDefinition;
    }
    expect(() => contract.endpoint(standaloneWebhook)).toThrow(/KOVO_APP_DUPLICATE_DECLARATION/u);

    const token = contract.assemble({ endpoints: [adoptedWebhook] });
    type AppTypes = InferKovoAppTypes<typeof token>;
    expectTypeOf<AppTypes['declarations']['endpoint']>().toEqualTypeOf<typeof adoptedWebhook>();
    const runtime = resolveKovoAppToken(token, 'app-contract endpoint bridge test');
    expect(runtime.endpoints).toHaveLength(1);
    expect(runtime.endpoints[0]).toEqual(
      expect.objectContaining({
        method: 'POST',
        name: '/hooks/contact',
        path: '/hooks/contact',
        webhook: true,
        webhookDefinition: standaloneWebhook.webhookDefinition,
      }),
    );
  });

  it('rejects unadopted, copied, and mixed-owner standalone endpoints', () => {
    const unadoptedContract = defineKovo({
      appId: APP_ID,
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const unadopted = endpoint('/advanced/unadopted', {
      access: publicAccess('isolated app-contract bridge test'),
      auth: { kind: 'none', justification: 'isolated app-contract bridge test' },
      csrf: false,
      csrfJustification: 'safe read-only test endpoint',
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'isolated app-contract bridge test',
      response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
    });
    expect(() =>
      unadoptedContract.assemble({
        // @ts-expect-error raw standalone declarations must be adopted through app.endpoint().
        endpoints: [unadopted],
      }),
    ).toThrow(/KOVO_APP_OWNER_MISMATCH/u);

    const owner = defineKovo({
      appId: '6b195013-5860-4b21-8250-a4a65a678db2',
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const other = defineKovo({
      appId: '9229361a-ed2d-492a-b48e-14111655e510',
      egress: { enabled: false, justification: 'isolated app-contract unit test' },
    });
    const advanced = endpoint('/advanced/owned', {
      access: publicAccess('isolated app-contract bridge test'),
      auth: { kind: 'none', justification: 'isolated app-contract bridge test' },
      csrf: false,
      csrfJustification: 'safe read-only test endpoint',
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'isolated app-contract bridge test',
      response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
    });
    const adopted = owner.endpoint(advanced);

    expect(() => other.endpoint(advanced)).toThrow(/KOVO_APP_OWNER_MISMATCH/u);
    expect(() =>
      owner.assemble({
        endpoints: [
          {
            ...adopted,
            // A structural copy cannot copy the module-private ownership witness.
          } as typeof adopted,
        ],
      }),
    ).toThrow(/KOVO_APP_OWNER_MISMATCH/u);
  });

  it('binds advanced agents to the assembled app request, session, DB, and env context', async () => {
    let authCalls = 0;
    let dbCalls = 0;
    const contract = defineKovo({
      appId: APP_ID,
      auth: () => {
        authCalls += 1;
        return { user: { id: 'agent-user' } };
      },
      db: (request) => {
        dbCalls += 1;
        expect(request.session?.user.id).toBe('agent-user');
        expect(request.env.APP_NAME).toBe('Kovo Agents');
        return {
          insert(value: string) {
            return value.length;
          },
        };
      },
      egress: { enabled: false, justification: 'isolated app-agent bridge test' },
      env: s.object({ APP_NAME: s.string() }),
      envSource: { APP_NAME: 'Kovo Agents' },
    });
    const save = assignDerivedMutationKey(
      contract.mutation({
        access: [contract.authenticated],
        input: s.object({ value: s.string() }),
        handler(input, request) {
          const userId: string = request.session.user.id;
          const appName: string = request.env.APP_NAME;
          return { appName, count: request.db.insert(input.value), userId };
        },
      }),
      'test/agent-save',
    );
    const saveTool = assignDerivedAgentToolOperations(
      tool('save', {
        description: 'Save one value through the app mutation.',
        mutation: save,
      }),
      [],
    );
    const assistant = assignDerivedAgentModelOperations(
      agent('support', {
        model: () => ({ input: { value: 'Ada' }, kind: 'tool-call', tool: 'save' }),
        tools: [saveTool],
      }),
      [],
    );
    const bound = contract.agent(assistant);

    expect(bound.name).toBe('support');
    expect(authCalls).toBe(0);
    expect(dbCalls).toBe(0);
    expect(() => bound.session(new Request('https://kovo.test/agent'))).toThrow(
      /before app\.assemble/u,
    );

    contract.assemble({ mutations: [save] });
    const session = await bound.session(new Request('https://kovo.test/agent'));
    const result = await runAgentTurn(session, agentContent('save Ada', 'principal'));
    expect(result).toMatchObject({
      integrity: 'untrusted',
      kind: 'tool-result',
      offeredTools: ['save'],
      result: {
        ok: true,
        value: { appName: 'Kovo Agents', count: 3, userId: 'agent-user' },
      },
      tool: 'save',
    });
    expect(authCalls).toBe(1);
    expect(dbCalls).toBe(1);

    if (false) {
      // @ts-expect-error the app bridge accepts the contract's raw Request type.
      await bound.session({ url: 'https://kovo.test/forged' });
    }
  });

  it('rejects copied, duplicate, and cross-contract advanced agent declarations', () => {
    const first = defineKovo({
      appId: APP_ID,
      egress: { enabled: false, justification: 'isolated app-agent bridge test' },
    });
    const second = defineKovo({
      appId: '0f62cb54-12e6-42e7-84c7-03fce22033b6',
      egress: { enabled: false, justification: 'isolated app-agent bridge test' },
    });
    const assistant = assignDerivedAgentModelOperations(
      agent('owned-agent', {
        model: () => ({ kind: 'output', value: 'ok' }),
        tools: [],
      }),
      [],
    );

    expect(() => first.agent({ ...assistant })).toThrow(/KOVO_APP_AGENT_DECLARATION/u);
    expect(first.agent(assistant).name).toBe('owned-agent');
    expect(() => first.agent(assistant)).toThrow(/KOVO_APP_DUPLICATE_DECLARATION/u);
    expect(() => second.agent(assistant)).toThrow(/KOVO_APP_OWNER_MISMATCH/u);
  });
});
