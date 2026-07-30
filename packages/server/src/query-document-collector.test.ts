import { describe, expect, it } from 'vitest';

import { createQueryDocumentCollector } from './query-document-collector.js';

describe('document query collection transactions', () => {
  it('deduplicates identical truth and rejects conflicting href or value', () => {
    const collector = createQueryDocumentCollector();
    collector.add({
      href: '/_q/product?id=p1',
      key: 'product:f10:k2:ids2:p1',
      name: 'product',
      value: { id: 'p1', stock: 3 },
    });
    collector.add({
      href: '/_q/product?id=p1',
      key: 'product:f10:k2:ids2:p1',
      name: 'product',
      value: { id: 'p1', stock: 3 },
    });
    expect(collector.snapshot()).toHaveLength(1);

    expect(() =>
      collector.add({
        href: '/_q/product?id=p2',
        key: 'product:f10:k2:ids2:p1',
        name: 'product',
        value: { id: 'p1', stock: 3 },
      }),
    ).toThrow(/conflicting document query truth/iu);
    expect(() =>
      collector.add({
        href: '/_q/product?id=p1',
        key: 'product:f10:k2:ids2:p1',
        name: 'product',
        value: { id: 'p1', stock: 4 },
      }),
    ).toThrow(/conflicting document query truth/iu);
  });

  it('commits selected truth and rolls discarded render truth back atomically', () => {
    const collector = createQueryDocumentCollector();
    collector.add({ href: '/_q/chrome', name: 'chrome', value: { tenant: 'safe' } });

    const discarded = collector.begin();
    collector.add({
      href: '/_q/private?id=victim',
      key: 'private:f14:k2:ids6:victim',
      name: 'private',
      value: { secret: 'discard-me' },
    });
    discarded.rollback();
    expect(collector.snapshot()).toEqual([
      { href: '/_q/chrome', name: 'chrome', value: { tenant: 'safe' } },
    ]);

    const selected = collector.begin();
    collector.add({ href: '/_q/error-shell', name: 'error-shell', value: { safe: true } });
    selected.commit();
    expect(collector.snapshot()).toEqual([
      { href: '/_q/chrome', name: 'chrome', value: { tenant: 'safe' } },
      { href: '/_q/error-shell', name: 'error-shell', value: { safe: true } },
    ]);
    expect(() => selected.rollback()).toThrow(/already settled/iu);
  });
});
