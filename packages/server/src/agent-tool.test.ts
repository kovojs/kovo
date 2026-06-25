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

  it('allows ambient credentials only with an explicit justification and strips session from context', async () => {
    const ambientTool = tool({
      ambientCredentials: {
        allow: true,
        justification: 'legacy browser-authenticated assistant action under review',
      },
      audit: { owner: 'security', review: 'SEC-123' },
      authority: [principalAuthority],
      capabilities: [{ name: 'profile.read', reason: 'read caller profile summary' }],
      handler: (_input: undefined, context) => ({
        hasSession: context.request === undefined ? false : 'session' in context.request,
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
    ).resolves.toEqual({ hasSession: false });
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

  it('uses explicit audit sites and ambient justifications in explain-ready facts', () => {
    const profile = tool({
      ambientCredentials: {
        allow: true,
        justification: 'legacy browser-authenticated assistant action under review',
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
        ambientJustification: 'legacy browser-authenticated assistant action under review',
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
