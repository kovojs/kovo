import { describe, expect, it } from 'vitest';

import { FakeQueryBindingElement, FakeRoot } from './runtime-test-fakes.js';
import { createRefetchQueryLedger, readVisibleReturnQueryScripts } from './query-visible-return.js';

// SPEC.md §4.4/§9.4: the visible-return refetch ledger tracks which hydrated and
// later-applied query names are eligible for the next typed-read refetch,
// deduping by first-seen order and reading eligibility only from kovo-query
// hydration scripts. The installed visible-return refetch lifecycle lives in the
// sibling query-visible-return-refetch.test.ts file.
describe('query visible-return refetch ledger', () => {
  it('dedupes hydrated and later-applied query names while preserving first-seen order', () => {
    const ledger = createRefetchQueryLedger(['cart', 'inventory', 'cart']);

    ledger.remember(['reviews', 'cart', 'recommendations', 'inventory']);

    // SPEC.md section 4.4: visible-return refetch follows successfully hydrated/applied query data.
    expect(ledger.eligible()).toEqual(['cart', 'inventory', 'reviews', 'recommendations']);
    expect(ledger.eligible(['inventory', 'recommendations'])).toEqual(['cart', 'reviews']);
  });

  it('excludes every instance key when a keyed query name is opted out (SPEC §9.3/§9.4)', () => {
    // SPEC §9.4: typed reads dispatch `/_q/` by NAME, so a declared `refetchOnFocus: false`
    // opt-out is keyed by query name and must exclude every instance key of that query.
    const ledger = createRefetchQueryLedger(['cart', 'product:p1', 'product:p2', 'reviews']);

    expect(ledger.eligible(['product'])).toEqual(['cart', 'reviews']);
    // An exact instance-key opt-out still matches only that one instance.
    expect(ledger.eligible(['product:p1'])).toEqual(['cart', 'product:p2', 'reviews']);
  });

  it('reads only kovo-query hydration scripts from the visible-return root', () => {
    const root = new FakeRoot();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'kovo-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];
    root.bindings = [new FakeQueryBindingElement('cart.count')];

    // SPEC.md §4.4/§9.4: visible-return eligibility starts from hydrated query
    // scripts and must not drift into a second DOM binding scan.
    expect([...readVisibleReturnQueryScripts(root)]).toEqual(root.scripts);
  });
});
