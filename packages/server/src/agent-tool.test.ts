import { describe, expect, it } from 'vitest';

import {
  AgentToolCapabilityError,
  agentToolAuditFacts,
  runAgentTool,
  tool,
  type AgentToolAmbientCredentialKind,
  type AgentToolAuditFact,
  type AgentToolAuthority,
  type AgentToolDeclaration,
} from './agent-tool.js';

const principalAuthority = {
  kind: 'principal',
  principal: 'user:123',
  requirement: 'agent runtime bound the user principal for this call',
} as const satisfies AgentToolAuthority;

function declaredTool() {
  return tool({
    audit: { owner: 'security' },
    authority: [principalAuthority],
    capabilities: [{ name: 'orders.write', reason: 'update one order status' }],
    handler: (input: { id: string }) => ({ ok: true, id: input.id }),
    name: 'orders.updateStatus',
    purpose: 'Update a single order status after a human-approved agent action.',
  });
}

describe('agent tool capability primitive', () => {
  it('requires purpose, audit owner, authority, and allowed capabilities', () => {
    const base = {
      audit: { owner: 'security' },
      authority: [principalAuthority],
      capabilities: [{ name: 'orders.write', reason: 'update one order status' }],
      handler: () => undefined,
      name: 'orders.updateStatus',
      purpose: 'Update a single order status.',
    };

    expect(() => tool({ ...base, purpose: '' })).toThrow(AgentToolCapabilityError);
    expect(() => tool({ ...base, audit: { owner: '' } })).toThrow(
      'tool.audit.owner must be a non-empty string',
    );
    expect(() => tool({ ...base, authority: [] })).toThrow(
      'tool.authority must declare at least one authority',
    );
    expect(() => tool({ ...base, capabilities: [] })).toThrow(
      'tool.capabilities must declare at least one capability',
    );
    expect(() =>
      tool({
        ...base,
        ambientCredentials: {
          allow: true,
          credentialKinds: ['cookie'],
          justification: {
            authorityBoundary: '',
            reason: 'legacy browser-authenticated assistant action under review',
          },
        },
      }),
    ).toThrow('tool.ambientCredentials.justification.authorityBoundary must be a non-empty string');
    expect(() =>
      tool({
        ...base,
        ambientCredentials: {
          allow: true,
          credentialKinds: [],
          justification: {
            authorityBoundary: 'handler re-checks the bound principal before every read',
            reason: 'legacy browser-authenticated assistant action under review',
          },
        },
      }),
    ).toThrow('tool.ambientCredentials.credentialKinds must declare at least one credential kind');
    expect(() =>
      tool({
        ...base,
        ambientCredentials: {
          allow: true,
          credentialKinds: ['cookie', 'cookie'],
          justification: {
            authorityBoundary: 'handler re-checks the bound principal before every read',
            reason: 'legacy browser-authenticated assistant action under review',
          },
        },
      }),
    ).toThrow(
      'tool.ambientCredentials.credentialKinds must not contain duplicate credential kinds',
    );
    expect(() =>
      tool({
        ...base,
        ambientCredentials: {
          allow: true,
          credentialKinds: ['cookie', 'bearer-token'],
          justification: {
            authorityBoundary: 'handler re-checks the bound principal before every read',
            reason: 'legacy browser-authenticated assistant action under review',
          },
        } as never,
      }),
    ).toThrow('tool.ambientCredentials.credentialKinds[] must be a known credential kind');
    expect(() =>
      tool({
        ...base,
        ambientCredentials: {
          allow: true,
          credentialKinds: ['cookie', 'authorization', 'auth-proxy'],
          justification: {
            authorityBoundary: 'handler re-checks the bound principal before every read',
            reason: 'legacy browser-authenticated assistant action under review',
          },
        },
      }),
    ).not.toThrow();
    expect(() =>
      tool({
        ...base,
        ambientCredentials: {
          allow: false,
          credentialKinds: ['cookie'],
          justification: {
            authorityBoundary: 'handler re-checks the bound principal before every read',
            reason: 'legacy browser-authenticated assistant action under review',
          },
        } as never,
      }),
    ).toThrow(
      'tool.ambientCredentials must not declare credentialKinds or justification unless allow is true',
    );
    expect(() =>
      tool({
        ...base,
        reachableSinks: [
          {
            capability: 'email.send',
            evidence: '',
            kind: 'egress',
            target: 'smtp',
          },
        ],
      }),
    ).toThrow('tool.reachableSinks[].evidence must be a non-empty string');
  });

  it('requires ambient opt-in review fields to be own data properties', () => {
    const base = {
      audit: { owner: 'security' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: () => undefined,
      name: 'profile.summary',
      purpose: 'Read the current user profile summary for an agent response.',
    };
    let allowGetterRan = false;

    const accessorAmbient = {
      get allow() {
        allowGetterRan = true;
        return true;
      },
      credentialKinds: ['cookie'],
      justification: {
        authorityBoundary: 'handler re-checks the bound principal before every read',
        reason: 'legacy browser-authenticated assistant action under review',
      },
    };

    expect(() =>
      tool({
        ...base,
        ambientCredentials: accessorAmbient as never,
      }),
    ).toThrow('tool.ambientCredentials.allow must be declared as an own data property');
    expect(allowGetterRan).toBe(false);

    const inheritedKinds = Object.create({
      credentialKinds: ['cookie'],
      justification: {
        authorityBoundary: 'handler re-checks the bound principal before every read',
        reason: 'legacy browser-authenticated assistant action under review',
      },
    }) as {
      allow: true;
      credentialKinds: ['cookie'];
      justification: {
        authorityBoundary: string;
        reason: string;
      };
    };
    inheritedKinds.allow = true;

    expect(() =>
      tool({
        ...base,
        ambientCredentials: inheritedKinds,
      }),
    ).toThrow('tool.ambientCredentials.credentialKinds must be declared as an own data property');

    const accessorJustification = {
      allow: true,
      credentialKinds: ['cookie'],
      justification: {
        authorityBoundary: 'handler re-checks the bound principal before every read',
        get reason() {
          throw new Error('reason getter must not run');
        },
      },
    };

    expect(() =>
      tool({
        ...base,
        ambientCredentials: accessorJustification as never,
      }),
    ).toThrow(
      'tool.ambientCredentials.justification.reason must be declared as an own data property',
    );
  });

  it('requires declaration metadata, authority, capabilities, and sinks to be own data properties', () => {
    const base = {
      audit: { owner: 'security' },
      authority: [principalAuthority],
      capabilities: [{ name: 'orders.write', reason: 'update one order status' }],
      handler: () => undefined,
      name: 'orders.updateStatus',
      purpose: 'Update a single order status.',
    };
    let auditOwnerGetterRan = false;

    expect(() =>
      tool({
        ...base,
        audit: {
          get owner() {
            auditOwnerGetterRan = true;
            return 'security';
          },
        } as never,
      }),
    ).toThrow('tool.audit.owner must be declared as an own data property');
    expect(auditOwnerGetterRan).toBe(false);

    const inheritedCapability = Object.create({
      name: 'orders.write',
      reason: 'update one order status',
    }) as { name: string; reason: string };

    expect(() =>
      tool({
        ...base,
        capabilities: [inheritedCapability],
      }),
    ).toThrow('tool.capabilities[].name must be declared as an own data property');

    const accessorSink = {
      capability: 'email.send',
      evidence: 'handler calls the configured SMTP provider',
      get kind() {
        throw new Error('sink kind getter must not run');
      },
      target: 'smtp',
    };

    expect(() =>
      tool({
        ...base,
        reachableSinks: [accessorSink as never],
      }),
    ).toThrow('tool.reachableSinks[].kind must be declared as an own data property');

    const inheritedAuthority = Object.create({
      kind: 'principal',
      principal: 'user:123',
      requirement: 'agent runtime bound the user principal for this call',
    }) as AgentToolAuthority;

    expect(() =>
      tool({
        ...base,
        authority: [inheritedAuthority],
      }),
    ).toThrow('tool.authority[].kind must be declared as an own data property');
  });

  it('requires declaration arrays to be dense own data elements without invoking element getters', () => {
    const base = {
      audit: { owner: 'security' },
      authority: [principalAuthority],
      capabilities: [{ name: 'orders.write', reason: 'update one order status' }],
      handler: () => undefined,
      name: 'orders.updateStatus',
      purpose: 'Update a single order status.',
    };
    let capabilityGetterRan = false;
    let credentialKindGetterRan = false;

    const accessorCapabilities = [] as unknown[];
    Object.defineProperty(accessorCapabilities, '0', {
      configurable: true,
      get() {
        capabilityGetterRan = true;
        return { name: 'orders.write', reason: 'update one order status' };
      },
    });

    expect(() =>
      tool({
        ...base,
        capabilities: accessorCapabilities as never,
      }),
    ).toThrow('tool.capabilities[] must be a dense array of own data properties');
    expect(capabilityGetterRan).toBe(false);

    const sparseAuthority = new Array<AgentToolAuthority>(1);

    expect(() =>
      tool({
        ...base,
        authority: sparseAuthority,
      }),
    ).toThrow('tool.authority[] must be a dense array of own data properties');

    const accessorCredentialKinds = [] as unknown[];
    Object.defineProperty(accessorCredentialKinds, '0', {
      configurable: true,
      get() {
        credentialKindGetterRan = true;
        return 'cookie';
      },
    });

    expect(() =>
      tool({
        ...base,
        ambientCredentials: {
          allow: true,
          credentialKinds: accessorCredentialKinds,
          justification: {
            authorityBoundary: 'handler re-checks the bound principal before every read',
            reason: 'legacy browser-authenticated assistant action under review',
          },
        } as never,
      }),
    ).toThrow(
      'tool.ambientCredentials.credentialKinds[] must be a dense array of own data properties',
    );
    expect(credentialKindGetterRan).toBe(false);
  });

  it('rejects ambient browser/session credentials by default at the invocation boundary', async () => {
    const updateOrder = declaredTool();

    await expect(
      runAgentTool(updateOrder, { id: 'ord_1' }, { authority: principalAuthority, value: {} }),
    ).resolves.toEqual({ ok: true, id: 'ord_1' });

    await expect(
      runAgentTool(
        updateOrder,
        { id: 'ord_1' },
        {
          authority: principalAuthority,
          request: new Request('https://example.test/tool', {
            headers: { cookie: 'session=ambient' },
          }),
          value: {},
        },
      ),
    ).rejects.toThrow('rejects ambient browser/session credentials by default');

    await expect(
      runAgentTool(
        updateOrder,
        { id: 'ord_1' },
        {
          authority: principalAuthority,
          request: new Request('https://example.test/tool', {
            headers: { 'x-auth-request-user': 'user_123' },
          }),
          value: {},
        },
      ),
    ).rejects.toThrow('auth-proxy(header:x-auth-request-user)');

    await expect(
      runAgentTool(
        updateOrder,
        { id: 'ord_1' },
        {
          authority: principalAuthority,
          request: new Request('https://example.test/tool', {
            headers: {
              'remote-user': 'user_123',
              'x-forwarded-email': 'user@example.test',
              'x-forwarded-user': 'user_123',
              'x-remote-user': 'user_123',
            },
          }),
          value: {},
        },
      ),
    ).rejects.toThrow(
      'auth-proxy(header:remote-user), auth-proxy(header:x-forwarded-email), auth-proxy(header:x-forwarded-user), auth-proxy(header:x-remote-user)',
    );

    const request = new Request('https://example.test/tool') as Request & {
      session?: { userId: string };
    };
    request.session = { userId: 'user_123' };

    await expect(
      runAgentTool(
        updateOrder,
        { id: 'ord_1' },
        {
          authority: principalAuthority,
          request,
          value: {},
        },
      ),
    ).rejects.toThrow('rejects ambient browser/session credentials by default');
  });

  it('requires the invocation authority to match a declared principal or capability binding', async () => {
    const updateOrder = declaredTool();

    await expect(
      runAgentTool(
        updateOrder,
        { id: 'ord_1' },
        {
          authority: {
            kind: 'capability',
            capability: 'orders:wide',
            requirement: 'different capability',
          },
          value: {},
        },
      ),
    ).rejects.toThrow('cannot run with undeclared authority "capability:orders:wide"');
  });

  it('requires runtime invocation metadata to be own data properties before handler dispatch', async () => {
    let handlerRuns = 0;
    let authorityGetterRan = false;
    let requestGetterRan = false;
    let valueGetterRan = false;
    const updateOrder = tool({
      audit: { owner: 'security' },
      authority: [principalAuthority],
      capabilities: [{ name: 'orders.write', reason: 'update one order status' }],
      handler: (_input: { id: string }, context) => {
        handlerRuns += 1;
        return {
          frozenContext: Object.isFrozen(context),
          principal:
            context.authority.kind === 'principal' ? context.authority.principal : undefined,
          value: context.value,
        };
      },
      name: 'orders.ownPropsUpdate',
      purpose: 'Update a single order status after a human-approved agent action.',
    });

    await expect(
      runAgentTool(updateOrder, { id: 'ord_1' }, { authority: principalAuthority, value: 123 }),
    ).resolves.toEqual({
      frozenContext: true,
      principal: 'user:123',
      value: 123,
    });
    expect(handlerRuns).toBe(1);

    const inheritedContext = Object.create({
      authority: principalAuthority,
      value: {},
    }) as {
      authority: AgentToolAuthority;
      value: Record<string, never>;
    };

    await expect(runAgentTool(updateOrder, { id: 'ord_1' }, inheritedContext)).rejects.toThrow(
      'agentTool.context.authority must be declared as an own data property',
    );
    expect(handlerRuns).toBe(1);

    const accessorContext = {
      get authority() {
        authorityGetterRan = true;
        return principalAuthority;
      },
      value: {},
    };

    await expect(
      runAgentTool(updateOrder, { id: 'ord_1' }, accessorContext as never),
    ).rejects.toThrow('agentTool.context.authority must be declared as an own data property');
    expect(authorityGetterRan).toBe(false);
    expect(handlerRuns).toBe(1);

    await expect(
      runAgentTool(updateOrder, { id: 'ord_1' }, {
        authority: principalAuthority,
        get request() {
          requestGetterRan = true;
          return new Request('https://example.test/tool');
        },
        value: {},
      } as never),
    ).rejects.toThrow('agentTool.context.request must be declared as an own data property');
    expect(requestGetterRan).toBe(false);
    expect(handlerRuns).toBe(1);

    await expect(
      runAgentTool(updateOrder, { id: 'ord_1' }, {
        authority: principalAuthority,
        get value() {
          valueGetterRan = true;
          return {};
        },
      } as never),
    ).rejects.toThrow('agentTool.context.value must be declared as an own data property');
    expect(valueGetterRan).toBe(false);
    expect(handlerRuns).toBe(1);
  });

  it('requires runtime invocation authority fields to be own data properties', async () => {
    const updateOrder = declaredTool();
    let kindGetterRan = false;
    let principalGetterRan = false;

    await expect(
      runAgentTool(
        updateOrder,
        { id: 'ord_1' },
        {
          authority: Object.create({
            kind: 'principal',
            principal: 'user:123',
            requirement: 'agent runtime bound the user principal for this call',
          }) as AgentToolAuthority,
          value: {},
        },
      ),
    ).rejects.toThrow('agentTool.context.authority.kind must be declared as an own data property');

    await expect(
      runAgentTool(
        updateOrder,
        { id: 'ord_1' },
        {
          authority: {
            get kind() {
              kindGetterRan = true;
              return 'principal';
            },
            principal: 'user:123',
            requirement: 'agent runtime bound the user principal for this call',
          } as never,
          value: {},
        },
      ),
    ).rejects.toThrow('agentTool.context.authority.kind must be declared as an own data property');
    expect(kindGetterRan).toBe(false);

    await expect(
      runAgentTool(
        updateOrder,
        { id: 'ord_1' },
        {
          authority: {
            kind: 'principal',
            get principal() {
              principalGetterRan = true;
              return 'user:123';
            },
            requirement: 'agent runtime bound the user principal for this call',
          } as never,
          value: {},
        },
      ),
    ).rejects.toThrow(
      'agentTool.context.authority.principal must be declared as an own data property',
    );
    expect(principalGetterRan).toBe(false);
  });

  it('allows only declared ambient credential kinds and normalizes the request', async () => {
    const ambientTool = tool({
      ambientCredentials: {
        allow: true,
        credentialKinds: ['cookie'],
        justification: {
          authorityBoundary: 'handler re-checks the bound principal before reading profile data',
          reason: 'legacy browser-authenticated assistant action under review',
        },
      },
      audit: { owner: 'security', review: 'SEC-123' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: (_input: undefined, context) => ({
        authorization: context.request?.headers.get('authorization') ?? null,
        cookie: context.request?.headers.get('cookie') ?? null,
        credentials: context.request?.credentials,
        hasSession: context.request === undefined ? false : 'session' in context.request,
        proxyUser: context.request?.headers.get('x-auth-request-user') ?? null,
      }),
      name: 'profile.summary',
      purpose: 'Read the current user profile summary for an agent response.',
    });
    const request = new Request('https://example.test/tool', {
      headers: { cookie: 'session=ambient' },
    }) as Request & { session?: { userId: string } };
    request.session = { userId: 'user_123' };

    await expect(
      runAgentTool(ambientTool, undefined, {
        authority: principalAuthority,
        request,
        value: {},
      }),
    ).rejects.toThrow('session(property:session)');

    delete request.session;

    await expect(
      runAgentTool(ambientTool, undefined, {
        authority: principalAuthority,
        request,
        value: {},
      }),
    ).resolves.toEqual({
      authorization: null,
      cookie: 'session=ambient',
      credentials: 'omit',
      hasSession: false,
      proxyUser: null,
    });
  });

  it('snapshots ambient credential review fields before invocation', async () => {
    const credentialKinds: AgentToolAmbientCredentialKind[] = ['session'];
    const justification = {
      authorityBoundary: 'handler uses only the explicit principal authority from context',
      reason: 'legacy adapter still invokes tools with a session-bearing request object',
    };
    const ambientTool = tool({
      ambientCredentials: {
        allow: true,
        credentialKinds,
        justification,
      },
      audit: { owner: 'security', review: 'SEC-125' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: (_input: undefined, context) => ({
        cookie: context.request?.headers.get('cookie') ?? null,
        hasSession: context.request === undefined ? false : 'session' in context.request,
      }),
      name: 'profile.snapshotSummary',
      purpose: 'Read the current user profile summary for an agent response.',
    });

    credentialKinds.push('cookie');
    justification.reason = 'mutated after declaration';

    expect(Object.isFrozen(ambientTool.ambientCredentials)).toBe(true);
    expect(agentToolAuditFacts([ambientTool])[0]).toMatchObject({
      ambientCredentialKinds: ['session'],
      ambientJustification: {
        authorityBoundary: 'handler uses only the explicit principal authority from context',
        reason: 'legacy adapter still invokes tools with a session-bearing request object',
      },
    });

    await expect(
      runAgentTool(ambientTool, undefined, {
        authority: principalAuthority,
        request: new Request('https://example.test/tool', {
          headers: { cookie: 'session=ambient' },
        }),
        value: {},
      }),
    ).rejects.toThrow('cookie(header:cookie)');
  });

  it('snapshots authority, capability, audit, and reachable-sink rows before audit', () => {
    const authority = [
      {
        kind: 'principal',
        principal: 'user:123',
        requirement: 'agent runtime bound the user principal for this call',
      },
    ] satisfies AgentToolAuthority[];
    const capabilities = [
      { name: 'email.send', reason: 'notify the buyer' },
      { name: 'orders.write', reason: 'update one order status' },
    ];
    const audit = { owner: 'security', site: 'app/tools/orders.ts:12' };
    const reachableSinks = [
      {
        capability: 'email.send',
        evidence: 'handler calls the configured SMTP provider',
        kind: 'egress',
        site: 'app/tools/orders.ts:34',
        target: 'smtp',
      },
    ] as const;

    const notifyOrder = tool({
      audit,
      authority,
      capabilities,
      handler: () => undefined,
      name: 'orders.notify',
      purpose: 'Update an order and notify the buyer.',
      reachableSinks,
    });

    authority[0] = {
      kind: 'capability',
      capability: 'orders:mutated',
      requirement: 'mutated after declaration',
    };
    capabilities[0] = { name: 'mutated.slot', reason: 'mutated after declaration' };
    audit.owner = 'mutated-owner';
    (
      reachableSinks as unknown as [
        {
          capability: string;
          evidence: string;
          kind: 'egress';
          site: string;
          target: string;
        },
      ]
    )[0] = {
      capability: 'mutated.slot',
      evidence: 'mutated after declaration',
      kind: 'egress',
      site: 'app/tools/orders.ts:35',
      target: 'mutated-smtp',
    };

    expect(Object.isFrozen(notifyOrder.audit)).toBe(true);
    expect(Object.isFrozen(notifyOrder.authority)).toBe(true);
    expect(Object.isFrozen(notifyOrder.authority[0])).toBe(true);
    expect(Object.isFrozen(notifyOrder.capabilities)).toBe(true);
    expect(Object.isFrozen(notifyOrder.capabilities[0])).toBe(true);
    expect(Object.isFrozen(notifyOrder.reachableSinks)).toBe(true);
    expect(Object.isFrozen(notifyOrder.reachableSinks?.[0])).toBe(true);

    expect(agentToolAuditFacts([notifyOrder])).toMatchObject([
      {
        authority: ['principal:user:123'],
        declaredCapabilities: ['email.send', 'orders.write'],
        owner: 'security',
        reachableSinks: [
          {
            capability: 'email.send',
            site: 'app/tools/orders.ts:34',
            target: 'smtp',
          },
        ],
      },
    ]);
  });

  it('freezes declarations so ambient credential posture cannot be widened after review', async () => {
    const updateOrder = declaredTool();

    expect(Object.isFrozen(updateOrder)).toBe(true);
    expect(() => {
      (
        updateOrder as ReturnType<typeof declaredTool> & {
          ambientCredentials: unknown;
        }
      ).ambientCredentials = {
        allow: true,
        credentialKinds: ['cookie'],
        justification: {
          authorityBoundary: 'mutated after declaration',
          reason: 'mutated after declaration',
        },
      };
    }).toThrow(TypeError);

    await expect(
      runAgentTool(
        updateOrder,
        { id: 'ord_1' },
        {
          authority: principalAuthority,
          request: new Request('https://example.test/tool', {
            headers: { cookie: 'session=ambient' },
          }),
          value: {},
        },
      ),
    ).rejects.toThrow('rejects ambient browser/session credentials by default');
  });

  it('rejects structurally forged declarations before ambient credential review is trusted', async () => {
    const forgedDeclaration = {
      ambientCredentials: {
        allow: true,
        credentialKinds: ['cookie'],
        justification: {
          authorityBoundary: 'forged runtime declaration',
          reason: 'forged runtime declaration',
        },
      },
      audit: { owner: 'security' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: () => ({ ok: true }),
      name: 'profile.forgedSummary',
      purpose: 'Read the current user profile summary for an agent response.',
    } as const satisfies AgentToolDeclaration<undefined, { ok: true }, Record<string, never>>;

    await expect(
      runAgentTool(forgedDeclaration, undefined, {
        authority: principalAuthority,
        request: new Request('https://example.test/tool', {
          headers: { cookie: 'session=ambient' },
        }),
        value: {},
      }),
    ).rejects.toThrow('must be created with tool() before runtime invocation or audit');

    expect(() => agentToolAuditFacts([forgedDeclaration])).toThrow(
      'must be created with tool() before runtime invocation or audit',
    );
  });

  it('rejects undeclared ambient credential classes even when another class is justified', async () => {
    const ambientTool = tool({
      ambientCredentials: {
        allow: true,
        credentialKinds: ['cookie'],
        justification: {
          authorityBoundary: 'handler re-checks the bound principal before reading profile data',
          reason: 'legacy browser-authenticated assistant action under review',
        },
      },
      audit: { owner: 'security', review: 'SEC-123' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: () => undefined,
      name: 'profile.summary',
      purpose: 'Read the current user profile summary for an agent response.',
    });

    await expect(
      runAgentTool(ambientTool, undefined, {
        authority: principalAuthority,
        request: new Request('https://example.test/tool', {
          headers: {
            authorization: 'Bearer ambient',
            cookie: 'session=ambient',
            'x-auth-request-user': 'user_123',
            'x-forwarded-user': 'user_123',
          },
        }),
        value: {},
      }),
    ).rejects.toThrow(
      'authorization(header:authorization), auth-proxy(header:x-auth-request-user), auth-proxy(header:x-forwarded-user)',
    );
  });

  it('strips session from a request even when session-bearing invocation is justified', async () => {
    const NativeRequest = Request;
    const sessionTool = tool({
      ambientCredentials: {
        allow: true,
        credentialKinds: ['session'],
        justification: {
          authorityBoundary: 'handler uses only the explicit principal authority from context',
          reason: 'legacy adapter still invokes tools with a session-bearing request object',
        },
      },
      audit: { owner: 'security', review: 'SEC-124' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: async (_input: undefined, context) => ({
        descriptor:
          context.request === undefined
            ? undefined
            : Object.getOwnPropertyDescriptor(context.request, 'session'),
        enumerableKeysIncludeSession:
          context.request === undefined ? false : Object.keys(context.request).includes('session'),
        hasSession: context.request === undefined ? false : 'session' in context.request,
        ownKeysIncludeSession:
          context.request === undefined
            ? false
            : Reflect.ownKeys(context.request).includes('session'),
        ownPropertyNamesIncludeSession:
          context.request === undefined
            ? false
            : Object.getOwnPropertyNames(context.request).includes('session'),
        session: (context.request as unknown as { session?: unknown } | undefined)?.session,
        text: await context.request?.text(),
        url: context.request?.url,
      }),
      name: 'profile.sessionSummary',
      purpose: 'Read the current user profile summary for an agent response.',
    });
    class SessionCopyingRequest extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init);
        if (typeof input === 'object' && input !== null && 'session' in input) {
          Object.defineProperty(this, 'session', {
            configurable: true,
            enumerable: true,
            value: (input as Request & { session?: unknown }).session,
          });
        }
      }
    }
    const request = new NativeRequest('https://example.test/tool', {
      body: 'payload',
      method: 'POST',
    }) as Request & {
      session?: { userId: string };
    };
    Object.defineProperty(request, 'session', {
      configurable: true,
      enumerable: true,
      value: { userId: 'user_123' },
    });

    Object.defineProperty(globalThis, 'Request', {
      configurable: true,
      value: SessionCopyingRequest,
      writable: true,
    });
    try {
      await expect(
        runAgentTool(sessionTool, undefined, {
          authority: principalAuthority,
          request,
          value: {},
        }),
      ).resolves.toEqual({
        descriptor: undefined,
        enumerableKeysIncludeSession: false,
        hasSession: false,
        ownKeysIncludeSession: false,
        ownPropertyNamesIncludeSession: false,
        session: undefined,
        text: 'payload',
        url: 'https://example.test/tool',
      });
    } finally {
      Object.defineProperty(globalThis, 'Request', {
        configurable: true,
        value: NativeRequest,
        writable: true,
      });
    }
  });

  it('strips session from inherited request prototypes after a reviewed session opt-in', async () => {
    const NativeRequest = Request;
    const sessionTool = tool({
      ambientCredentials: {
        allow: true,
        credentialKinds: ['session'],
        justification: {
          authorityBoundary: 'handler uses only the explicit principal authority from context',
          reason: 'legacy adapter still invokes tools with a session-bearing request object',
        },
      },
      audit: { owner: 'security', review: 'SEC-127' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: async (_input: undefined, context) => {
        const prototype =
          context.request === undefined ? undefined : Object.getPrototypeOf(context.request);
        return {
          hasPrototypeSession: prototype === undefined ? false : 'session' in prototype,
          hasSession: context.request === undefined ? false : 'session' in context.request,
          prototypeDescriptor:
            prototype === undefined
              ? undefined
              : Object.getOwnPropertyDescriptor(prototype, 'session'),
          prototypeOwnKeysIncludeSession:
            prototype === undefined ? false : Reflect.ownKeys(prototype).includes('session'),
          prototypeSession: (prototype as { session?: unknown } | undefined)?.session,
          text: await context.request?.text(),
          url: context.request?.url,
        };
      },
      name: 'profile.inheritedSessionSummary',
      purpose: 'Read the current user profile summary for an agent response.',
    });
    class IncomingSessionRequest extends NativeRequest {}
    Object.defineProperty(IncomingSessionRequest.prototype, 'session', {
      configurable: true,
      enumerable: true,
      value: { userId: 'incoming_user' },
    });
    class PrototypeSessionRequest extends NativeRequest {}
    Object.defineProperty(PrototypeSessionRequest.prototype, 'session', {
      configurable: true,
      enumerable: true,
      value: { userId: 'normalized_user' },
    });
    const request = new IncomingSessionRequest('https://example.test/tool', {
      body: 'payload',
      method: 'POST',
    });

    Object.defineProperty(globalThis, 'Request', {
      configurable: true,
      value: PrototypeSessionRequest,
      writable: true,
    });
    try {
      await expect(
        runAgentTool(sessionTool, undefined, {
          authority: principalAuthority,
          request,
          value: {},
        }),
      ).resolves.toEqual({
        hasPrototypeSession: false,
        hasSession: false,
        prototypeDescriptor: undefined,
        prototypeOwnKeysIncludeSession: false,
        prototypeSession: undefined,
        text: 'payload',
        url: 'https://example.test/tool',
      });
    } finally {
      Object.defineProperty(globalThis, 'Request', {
        configurable: true,
        value: NativeRequest,
        writable: true,
      });
    }
  });

  it('enumerates purpose, authority, allowed capabilities, and ambient posture for audit output', () => {
    const updateOrder = declaredTool();

    expect(agentToolAuditFacts([updateOrder])).toEqual([
      {
        ambientBrowserCredentials: 'rejected',
        authority: ['principal:user:123'],
        declaredCapabilities: ['orders.write'],
        kind: 'agentTool',
        name: 'orders.updateStatus',
        owner: 'security',
        purpose: 'Update a single order status after a human-approved agent action.',
        site: 'agent-tool:orders.updateStatus',
        target: 'orders.updateStatus',
      },
    ]);
  });

  it('emits declared reachable body sinks as audit-grade explain facts', () => {
    const notifyOrder = tool({
      audit: { owner: 'security', site: 'app/tools/orders.ts:12' },
      authority: [principalAuthority],
      capabilities: [
        { name: 'orders.write', reason: 'update one order status' },
        { name: 'email.send', reason: 'notify the buyer' },
        { name: 'secrets.read', reason: 'load provider token from the app secret store' },
      ],
      handler: () => undefined,
      name: 'orders.notify',
      purpose: 'Update an order and notify the buyer.',
      reachableSinks: [
        {
          capability: 'email.send',
          evidence: 'handler calls the configured SMTP provider',
          kind: 'egress',
          site: 'app/tools/orders.ts:34',
          target: 'smtp',
        },
        {
          capability: 'secrets.read',
          evidence: 'handler loads the transactional-email provider token',
          kind: 'secret-read',
          target: 'env.SENDGRID_TOKEN',
        },
      ],
    });

    expect(agentToolAuditFacts([notifyOrder])[0]?.reachableSinks).toEqual([
      {
        capability: 'email.send',
        evidence: 'handler calls the configured SMTP provider',
        grade: 'audit',
        kind: 'egress',
        site: 'app/tools/orders.ts:34',
        target: 'smtp',
        tool: 'orders.notify',
      },
      {
        capability: 'secrets.read',
        evidence: 'handler loads the transactional-email provider token',
        grade: 'audit',
        kind: 'secret-read',
        site: 'app/tools/orders.ts:12',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notify',
      },
    ]);
  });

  it('uses explicit audit sites and ambient justifications in explain-ready facts', () => {
    const profile = tool({
      ambientCredentials: {
        allow: true,
        credentialKinds: ['cookie', 'auth-proxy'],
        justification: {
          authorityBoundary: 'handler re-checks the bound principal before reading profile data',
          reason: 'legacy browser-authenticated assistant action under review',
        },
      },
      audit: { owner: 'security', review: 'SEC-123', site: 'app/tools/profile.ts:12' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: () => undefined,
      name: 'profile.summary',
      purpose: 'Read the current user profile summary for an agent response.',
    });

    expect(agentToolAuditFacts([profile])).toEqual([
      {
        ambientBrowserCredentials: 'allowed',
        ambientCredentialKinds: ['cookie', 'auth-proxy'],
        ambientJustification: {
          authorityBoundary: 'handler re-checks the bound principal before reading profile data',
          reason: 'legacy browser-authenticated assistant action under review',
        },
        authority: ['principal:user:123'],
        declaredCapabilities: ['profile.read'],
        kind: 'agentTool',
        name: 'profile.summary',
        owner: 'security',
        purpose: 'Read the current user profile summary for an agent response.',
        site: 'app/tools/profile.ts:12',
        target: 'profile.summary',
      },
    ]);
  });

  it('returns immutable audit fact snapshots for ambient credential review data', () => {
    const profile = tool({
      ambientCredentials: {
        allow: true,
        credentialKinds: ['cookie'],
        justification: {
          authorityBoundary: 'handler re-checks the bound principal before reading profile data',
          reason: 'legacy browser-authenticated assistant action under review',
        },
      },
      audit: { owner: 'security', review: 'SEC-126', site: 'app/tools/profile.ts:18' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: () => undefined,
      name: 'profile.immutableSummary',
      purpose: 'Read the current user profile summary for an agent response.',
      reachableSinks: [
        {
          capability: 'profile.read',
          evidence: 'handler reads the profile table through a constrained query',
          kind: 'secret-read',
          target: 'db.profile',
        },
      ],
    });

    const facts = agentToolAuditFacts([profile]);
    const fact = facts[0]!;
    const sinkFact = fact.reachableSinks?.[0];

    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(fact)).toBe(true);
    expect(Object.isFrozen(fact.ambientCredentialKinds)).toBe(true);
    expect(Object.isFrozen(fact.ambientJustification)).toBe(true);
    expect(Object.isFrozen(fact.authority)).toBe(true);
    expect(Object.isFrozen(fact.declaredCapabilities)).toBe(true);
    expect(Object.isFrozen(fact.reachableSinks)).toBe(true);
    expect(Object.isFrozen(sinkFact)).toBe(true);

    expect(() => {
      (facts as AgentToolAuditFact[]).push(fact);
    }).toThrow(TypeError);
    expect(() => {
      (fact.ambientCredentialKinds as AgentToolAmbientCredentialKind[]).push('session');
    }).toThrow(TypeError);
    expect(() => {
      (fact.ambientJustification as { reason: string }).reason = 'mutated after render';
    }).toThrow(TypeError);
    expect(() => {
      (fact.reachableSinks as NonNullable<AgentToolAuditFact['reachableSinks']>).push(sinkFact!);
    }).toThrow(TypeError);

    expect(agentToolAuditFacts([profile])[0]).toMatchObject({
      ambientCredentialKinds: ['cookie'],
      ambientJustification: {
        authorityBoundary: 'handler re-checks the bound principal before reading profile data',
        reason: 'legacy browser-authenticated assistant action under review',
      },
      reachableSinks: [
        {
          capability: 'profile.read',
          target: 'db.profile',
        },
      ],
    });
  });
});
