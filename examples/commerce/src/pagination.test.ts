import { describe, expect, it } from 'vitest';

import { createCommerceDb } from './domain.js';
import { loadProductGrid, productGridInput } from './app-test-helpers.js';

// SPEC §9.3: the app owns a stable cursor contract while Kovo owns query transport and client-side
// delta application. This example tests only the authored contract through public app helpers; the
// framework's keyed wire merge is covered at its owning server/browser conformance boundaries.
describe('commerce product pagination', () => {
  it('returns disjoint pages from the authored cursor', async () => {
    const db = createCommerceDb();
    const firstPage = await loadProductGrid(db, { limit: 2 });
    const secondPage = await loadProductGrid(db, productGridInput(firstPage.nextCursor, 2));

    expect(firstPage.items.map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(firstPage.nextCursor).toBe('p2');
    expect(secondPage.items.map((item) => item.id)).toEqual(['p3']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('replays the same cursor deterministically', async () => {
    const db = createCommerceDb();
    const firstPage = await loadProductGrid(db, { limit: 2 });
    const input = productGridInput(firstPage.nextCursor, 2);

    await expect(loadProductGrid(db, input)).resolves.toEqual(await loadProductGrid(db, input));
  });

  it('walks the catalog without duplicate product identities', async () => {
    const db = createCommerceDb();
    const identities: string[] = [];
    let after: string | null = null;

    do {
      const page = await loadProductGrid(db, productGridInput(after, 1));
      identities.push(...page.items.map((item) => item.id));
      after = page.nextCursor;
    } while (after !== null);

    expect(identities).toEqual(['p1', 'p2', 'p3']);
    expect(new Set(identities).size).toBe(identities.length);
  });
});
