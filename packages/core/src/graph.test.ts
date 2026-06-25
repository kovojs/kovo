import { describe, expect, it } from 'vitest';

import { deriveAgentToolReachableSinkFacts, validateKovoExplainInput } from './graph.js';

describe('kovo graph input validation', () => {
  it('reports unknown diagnostic codes at the element path', () => {
    expect(
      validateKovoExplainInput({
        lints: [{ code: 'KV999', site: 'cart.tsx:1' }],
      }),
    ).toEqual([
      {
        message: 'unknown diagnostic code "KV999"',
        path: 'lints[0].code',
      },
    ]);
  });

  it('validates unresolved touch graph diagnostic codes before rendering', () => {
    expect(
      validateKovoExplainInput({
        touchGraph: {
          'cart.add': {
            touches: [],
            unresolved: [{ code: 'KV999', message: 'unknown', site: 'cart.ts:1' }],
          },
        },
      }),
    ).toEqual([
      {
        message: 'unknown diagnostic code "KV999"',
        path: 'touchGraph."cart.add".unresolved[0].code',
      },
    ]);
  });

  it('requires package component prefix facts to be an array', () => {
    expect(
      validateKovoExplainInput({
        packageComponentPrefixes: { packageName: '@kovojs/headless-ui', prefix: 'kovo-' },
      }),
    ).toEqual([
      {
        message: 'packageComponentPrefixes must be an array',
        path: 'packageComponentPrefixes',
      },
    ]);
  });

  it('requires access facts to be an array', () => {
    expect(
      validateKovoExplainInput({
        access: { decision: 'missing', kind: 'query', name: 'cart' },
      }),
    ).toEqual([
      {
        message: 'access must be an array',
        path: 'access',
      },
    ]);
  });

  it('accepts access facts as graph arrays', () => {
    expect(
      validateKovoExplainInput({
        access: [
          {
            decision: 'missing',
            detail: 'guards=-',
            kind: 'query',
            name: 'cart',
            site: 'cart.query.ts:7',
            source: 'access',
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe('agent tool reachable sink facts', () => {
  it('derives sound write capability requirements for framework-owned tool graph rows', () => {
    expect(
      deriveAgentToolReachableSinkFacts({
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['orders.write'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Update orders.',
            site: 'app/tools/orders.ts:4',
            target: 'orders.updateStatus',
          },
        ],
        mutations: [{ key: 'orders.updateStatus', writes: ['orders'] }],
        touchGraph: {
          'orders.updateStatus': {
            touches: [
              {
                domain: 'auditLog',
                keys: null,
                site: 'app/tools/orders.ts:18',
                via: 'auditLog.insert',
              },
            ],
            unresolved: [],
          },
        },
      }),
    ).toEqual([
      {
        capability: 'auditLog.write',
        evidence: 'graph-write-domain',
        grade: 'sound',
        kind: 'write',
        site: 'app/tools/orders.ts:18',
        target: 'auditLog',
        tool: 'orders.updateStatus',
      },
      {
        capability: 'orders.write',
        evidence: 'graph-write-domain',
        grade: 'sound',
        kind: 'write',
        site: 'mutation:orders.updateStatus',
        target: 'orders',
        tool: 'orders.updateStatus',
      },
    ]);
  });

  it('preserves declared egress and secret-read body sinks as audit-grade rows', () => {
    expect(
      deriveAgentToolReachableSinkFacts({
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['email.send', 'secrets.read'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            reachableSinks: [
              {
                capability: 'email.send',
                evidence: 'declared-tool-body',
                grade: 'audit',
                kind: 'egress',
                site: 'app/tools/orders.ts:31',
                target: 'smtp',
                tool: 'stale.name.is.ignored',
              },
              {
                capability: 'secrets.read',
                evidence: 'declared-tool-body',
                grade: 'audit',
                kind: 'secret-read',
                site: 'app/tools/orders.ts:32',
                target: 'env.SENDGRID_TOKEN',
                tool: 'stale.name.is.ignored',
              },
            ],
            site: 'app/tools/orders.ts:4',
            target: 'orders.notify',
          },
        ],
      }),
    ).toEqual([
      {
        capability: 'email.send',
        evidence: 'declared-tool-body',
        grade: 'audit',
        kind: 'egress',
        site: 'app/tools/orders.ts:31',
        target: 'smtp',
        tool: 'orders.notify',
      },
      {
        capability: 'secrets.read',
        evidence: 'declared-tool-body',
        grade: 'audit',
        kind: 'secret-read',
        site: 'app/tools/orders.ts:32',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notify',
      },
    ]);
  });
});
