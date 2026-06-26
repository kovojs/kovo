import { describe, expect, it } from 'vitest';

import {
  AgentToolCapabilityError,
  agentToolAuditFacts,
  runAgentTool,
  tool,
  type AgentToolAuthority,
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
      handler: (_input: undefined, context) => ({
        hasSession: context.request === undefined ? false : 'session' in context.request,
        session: (context.request as unknown as { session?: unknown } | undefined)?.session,
      }),
      name: 'profile.sessionSummary',
      purpose: 'Read the current user profile summary for an agent response.',
    });
    const request = new Request('https://example.test/tool') as Request & {
      session?: { userId: string };
    };
    request.session = { userId: 'user_123' };

    await expect(
      runAgentTool(sessionTool, undefined, {
        authority: principalAuthority,
        request,
        value: {},
      }),
    ).resolves.toEqual({ hasSession: false, session: undefined });
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
});
