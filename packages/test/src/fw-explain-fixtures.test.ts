import { describe, expect, it } from 'vitest';

import {
  fwExplainField,
  fwExplainRecords,
  fwExplainSummary,
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
    expect(fwExplainRecords(fixture, 'OPTIMISTIC')).toEqual(['cart await-fragment']);
    expect(fwExplainSummary(fixture, 'OPTIMISTIC-SUMMARY')).toMatchObject({
      UNHANDLED: '0',
      'await-fragment': '1',
      total: '1',
    });
    expect(fwExplainUpdateTargets(fixture)).toEqual([
      'cart->component:CartBadge,page:/cart',
      'product->page:/products',
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
  });
});
