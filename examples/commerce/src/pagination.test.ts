import '../../../tests/example-generated-graphs.setup.js';

import type { JsonValue } from '@kovojs/core';
import { applyQueryDelta, type QueryDelta } from '@kovojs/core/internal/query-delta';
import { renderQueryPageWireHtml } from '@kovojs/server/internal/html';
import { describe, expect, it } from 'vitest';

import { createCommerceDb } from './domain.js';
import { loadProductGrid, productGridInput } from './app-test-helpers.js';

// SPEC §9.1.1/§9.3 (capability-gaps §2): the commerce productGrid is a real
// cursor-paged query (queries.ts `after`/`nextCursor`). This proves the read-side
// pagination loop end to end: the server emits ONLY the new page as a keyed-delta
// `<kovo-query … delta>` (renderQueryPageWireHtml), and the client merges it into the
// SAME held instance (applyQueryDelta) so "load more"/"load older" pages accumulate
// without re-shipping or duplicating prior rows. Product cards are keyed by `id`
// (components/product-grid.tsx `kovo-key={item.id}`), so the §13.2 reconciliation is keyed.

/** Decode the JSON delta body the server's `<kovo-query … delta>` chunk carries. */
function decodeDeltaChunk(wire: string): QueryDelta {
  const match = /<kovo-query\b[^>]*\bdelta\b[^>]*>([\s\S]*?)<\/kovo-query>/.exec(wire);
  if (!match?.[1]) throw new Error(`not a delta query chunk: ${wire}`);
  return JSON.parse(match[1]) as QueryDelta;
}

describe('commerce read-side pagination accumulation', () => {
  it('accumulates a "load more" page into the held grid without re-shipping prior rows', async () => {
    const db = createCommerceDb();
    const firstPage = await loadProductGrid(db, { limit: 2 });
    const secondPage = await loadProductGrid(db, productGridInput(firstPage.nextCursor, 2));

    expect(firstPage.items.map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(secondPage.items.map((item) => item.id)).toEqual(['p3']);

    // The server ships ONLY the new page (page 2) as a keyed append-delta.
    const wire = renderQueryPageWireHtml({
      name: 'productGrid',
      path: 'items',
      keyField: 'id',
      rows: secondPage.items,
    });
    expect(wire).toContain('delta');
    // Prior rows (p1/p2) are NOT in the wire chunk — only the new page is sent.
    expect(wire).not.toContain('p1');
    expect(wire).not.toContain('p2');
    expect(wire).toContain('p3');

    // The client merges the page into the held page-1 value (deep-merge keyed, §9.1.1).
    const held: JsonValue = { items: firstPage.items as unknown as JsonValue[] };
    const accumulated = applyQueryDelta(held, decodeDeltaChunk(wire)) as {
      items: { id: string }[];
    };

    expect(accumulated.items.map((item) => item.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('prepends a "load older" page at the FRONT of the held grid (load-older feed)', async () => {
    const db = createCommerceDb();
    const firstPage = await loadProductGrid(db, { limit: 2 });
    const secondPage = await loadProductGrid(db, productGridInput(firstPage.nextCursor, 2));

    // Treat page 2 as "older" content arriving above the held page-1 rows.
    const wire = renderQueryPageWireHtml({
      name: 'productGrid',
      path: 'items',
      keyField: 'id',
      mode: 'prepend',
      rows: secondPage.items,
    });
    expect(wire).toContain('"prepend":true');

    const held: JsonValue = { items: firstPage.items as unknown as JsonValue[] };
    const accumulated = applyQueryDelta(held, decodeDeltaChunk(wire)) as {
      items: { id: string }[];
    };

    // Older page (p3) lands at the FRONT, ahead of the held p1/p2.
    expect(accumulated.items.map((item) => item.id)).toEqual(['p3', 'p1', 'p2']);
  });

  it('dedupes by kovo-key: re-applying the same page never duplicates a product (§13.2)', async () => {
    const db = createCommerceDb();
    const firstPage = await loadProductGrid(db, { limit: 2 });

    // A page that overlaps the held rows (p2) plus genuinely new content would be rare,
    // but a retried/overlapping fetch must reconcile in place rather than duplicate.
    const wire = renderQueryPageWireHtml({
      name: 'productGrid',
      path: 'items',
      keyField: 'id',
      rows: firstPage.items,
    });

    const held: JsonValue = { items: firstPage.items as unknown as JsonValue[] };
    const once = applyQueryDelta(held, decodeDeltaChunk(wire)) as { items: { id: string }[] };
    const twice = applyQueryDelta(once as unknown as JsonValue, decodeDeltaChunk(wire)) as {
      items: { id: string }[];
    };

    expect(twice.items.map((item) => item.id)).toEqual(['p1', 'p2']);
  });
});
