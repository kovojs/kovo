import { describe, expect, it } from 'vitest';

import {
  fwExplainEndpointFacts,
  fwExplainField,
  fwExplainListField,
  fwExplainOptimisticStatuses,
  fwExplainRecords,
  fwExplainScopeAuditFacts,
  fwExplainSummary,
  fwExplainUpdateConsumerMap,
  fwExplainUpdateConsumers,
  fwExplainUpdateTargets,
  parseFwExplainOutput,
} from './fw-explain-fixtures.js';

const fixture = [
  'fw-explain/v1',
  'MUTATION cart/add',
  'guards: authed',
  'session: commerceSession',
  'input-fields: productId,quantity',
  'updates: cart->component:CartBadge,page:/cart; product->page:/products',
  'OPTIMISTIC cart await-fragment',
  'OPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=1 UNHANDLED=0',
  '',
].join('\n');

describe('@jiso/test fw explain fixture seam', () => {
  it('turns fw-explain/v1 output into structured field and record facts', () => {
    expect(parseFwExplainOutput(fixture)).toEqual({
      fields: [
        { key: 'guards', raw: 'guards: authed', value: 'authed' },
        { key: 'session', raw: 'session: commerceSession', value: 'commerceSession' },
        {
          key: 'input-fields',
          raw: 'input-fields: productId,quantity',
          value: 'productId,quantity',
        },
        {
          key: 'updates',
          raw: 'updates: cart->component:CartBadge,page:/cart; product->page:/products',
          value: 'cart->component:CartBadge,page:/cart; product->page:/products',
        },
      ],
      records: [
        { key: 'OPTIMISTIC', raw: 'OPTIMISTIC cart await-fragment', value: 'cart await-fragment' },
        {
          key: 'OPTIMISTIC-SUMMARY',
          raw: 'OPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=1 UNHANDLED=0',
          value: 'total=1 hand-written=0 await-fragment=1 UNHANDLED=0',
        },
      ],
      subject: 'MUTATION cart/add',
      version: 'fw-explain/v1',
    });
  });

  it('exposes focused helpers for harness assertions without local output parsing', () => {
    expect(fwExplainField(fixture, 'session')).toBe('commerceSession');
    expect(fwExplainListField(fixture, 'input-fields')).toEqual(['productId', 'quantity']);
    expect(fwExplainRecords(fixture, 'OPTIMISTIC')).toEqual(['cart await-fragment']);
    expect(fwExplainOptimisticStatuses(fixture)).toEqual({ cart: 'await-fragment' });
    expect(fwExplainSummary(fixture, 'OPTIMISTIC-SUMMARY')).toMatchObject({
      UNHANDLED: '0',
      'await-fragment': '1',
      total: '1',
    });
    expect(fwExplainUpdateTargets(fixture)).toEqual([
      'cart->component:CartBadge,page:/cart',
      'product->page:/products',
    ]);
    expect(fwExplainUpdateConsumers(fixture)).toEqual([
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
      { consumers: ['page:/products'], query: 'product' },
    ]);
    expect(Object.fromEntries(fwExplainUpdateConsumerMap(fixture))).toEqual({
      cart: ['component:CartBadge', 'page:/cart'],
      product: ['page:/products'],
    });
    expect(
      fwExplainListField('fw-explain/v1\nMUTATION order/receipt\nupdates: -\n', 'updates'),
    ).toEqual([]);
    expect(fwExplainUpdateTargets('fw-explain/v1\nMUTATION order/receipt\nupdates: -\n')).toEqual(
      [],
    );
    expect(fwExplainUpdateConsumers('fw-explain/v1\nMUTATION order/receipt\nupdates: -\n')).toEqual(
      [],
    );
    expect(
      fwExplainEndpointFacts(
        [
          'fw-explain/v1',
          'ENDPOINTS',
          'ENDPOINT payment/stripe method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe:v1:hmac-sha256 csrf=exempt:payment/stripe webhook verifier stripe:v1:hmac-sha256 writes=order',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      {
        auth: 'verifier:stripe:v1:hmac-sha256',
        csrf: 'exempt:payment/stripe webhook verifier stripe:v1:hmac-sha256',
        endpoint: 'payment/stripe',
        method: 'POST',
        mount: 'exact',
        path: '/webhooks/stripe',
        writes: ['order'],
      },
    ]);
    expect(
      fwExplainScopeAuditFacts(
        [
          'fw-explain/v1',
          'UNSCOPED',
          'UNSCOPED QUERY attachments/download domain=attachment scope=unscoped site=examples/commerce/src/app.ts:10 attachment download filters id plus session user',
          '',
        ].join('\n'),
        'UNSCOPED',
      ),
    ).toEqual([
      {
        domain: 'attachment',
        reason: 'attachment download filters id plus session user',
        scope: 'unscoped',
        site: 'examples/commerce/src/app.ts:10',
        target: 'attachments/download',
        targetKind: 'QUERY',
      },
    ]);
  });

  it('rejects malformed explain output at the fixture seam', () => {
    expect(() => parseFwExplainOutput('fw-check/v1\nOK\n')).toThrow(
      'fw explain output starts with fw-explain/v1: fw-check/v1',
    );
    expect(() => parseFwExplainOutput('fw-explain/v1\n')).toThrow(
      'fw explain output includes a subject line',
    );
    expect(() => fwExplainField(fixture, 'missing')).toThrow('fw explain output includes missing:');
    expect(() => fwExplainSummary(fixture, 'MISSING')).toThrow(
      'fw explain output includes MISSING',
    );
    expect(() =>
      fwExplainOptimisticStatuses('fw-explain/v1\nMUTATION cart/add\nOPTIMISTIC cart\n'),
    ).toThrow("fw explain OPTIMISTIC record is '<query> <status>': cart");
    expect(() =>
      fwExplainUpdateConsumers('fw-explain/v1\nMUTATION cart/add\nupdates: cart\n'),
    ).toThrow("fw explain update target is '<query>-><consumers>': cart");
    expect(() => fwExplainEndpointFacts('fw-explain/v1\nENDPOINTS\nENDPOINT cart/add\n')).toThrow(
      'fw explain ENDPOINT record is',
    );
    expect(() =>
      fwExplainScopeAuditFacts('fw-explain/v1\nUNSCOPED\nUNSCOPED cart\n', 'UNSCOPED'),
    ).toThrow('fw explain UNSCOPED record is');
  });
});
