import { describe, expect, it } from 'vitest';

import { applyQueryChunksToRuntime } from './query-apply.js';
import { createQueryStore } from './query-store.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

// SPEC §9.1.1/§9.3: read-side pagination ships each page as a keyed-delta
// `<kovo-query … delta>` whose `lists.<path>` upsert merges into the SAME held
// query instance, so "load more"/"load older" pages ACCUMULATE into one client
// collection (prior rows are never re-shipped or duplicated) instead of replacing
// the instance per cursor page. This exercises the full wire → decode → store path.

/** Build the read-side page wire chunk the server's renderQueryPageWireHtml emits. */
function pageWire(name: string, delta: unknown, key?: string): string {
  const keyAttr = key === undefined ? '' : ` key="${key}"`;
  return `<kovo-query name="${name}"${keyAttr} delta>${JSON.stringify(delta)}</kovo-query>`;
}

describe('read-side pagination accumulation through the query store', () => {
  it('accumulates a "load more" append page into the held instance without re-shipping prior rows', () => {
    const store = createQueryStore();
    // Page 1 is already held (hydrated/first fetch).
    store.set('productGrid', { items: [{ id: 'p1' }, { id: 'p2' }], nextCursor: 'p2' });

    const body = pageWire('productGrid', {
      set: { nextCursor: 'p4' },
      lists: { items: { key: 'id', upsert: [{ id: 'p3' }, { id: 'p4' }] } },
    });
    const chunks = readMutationResponseBodyChunks(body);

    // The wire chunk carries ONLY the new page — prior rows are not re-shipped.
    expect(chunks.queries).toHaveLength(1);
    expect(chunks.queries[0]?.delta).toBe(true);
    expect(JSON.stringify(chunks.queries[0]?.value)).not.toContain('p1');
    expect(JSON.stringify(chunks.queries[0]?.value)).not.toContain('p2');

    applyQueryChunksToRuntime(store, chunks.queries);

    // The held collection grew to page1 ∪ page2 (append at the end), no duplicates.
    expect(store.get('productGrid')).toEqual({
      items: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
      nextCursor: 'p4',
    });
  });

  it('accumulates a "load older" prepend page at the FRONT of the held instance', () => {
    const store = createQueryStore();
    store.set('messages', { items: [{ id: 'm3' }, { id: 'm4' }] }, 'messages:room-1');

    const body = pageWire(
      'messages',
      { lists: { items: { key: 'id', prepend: true, upsert: [{ id: 'm1' }, { id: 'm2' }] } } },
      'messages:room-1',
    );
    const chunks = readMutationResponseBodyChunks(body);
    // The decoded chunk addresses the keyed instance (name:key form).
    expect(chunks.queries[0]).toMatchObject({ name: 'messages', key: 'messages:room-1' });

    applyQueryChunksToRuntime(store, chunks.queries);

    expect(store.get('messages', 'messages:room-1')).toEqual({
      items: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }],
    });
  });

  it('dedupes by kovo-key: re-applying the same page reconciles in place, never duplicates (§13.2)', () => {
    const store = createQueryStore();
    store.set('productGrid', { items: [{ id: 'p1' }, { id: 'p2' }] });

    const body = pageWire('productGrid', {
      lists: { items: { key: 'id', upsert: [{ id: 'p2', stock: 9 }, { id: 'p3' }] } },
    });

    // Apply the same page twice — accumulation must remain idempotent per key.
    applyQueryChunksToRuntime(store, readMutationResponseBodyChunks(body).queries);
    applyQueryChunksToRuntime(store, readMutationResponseBodyChunks(body).queries);

    expect(store.get('productGrid')).toEqual({
      items: [{ id: 'p1' }, { id: 'p2', stock: 9 }, { id: 'p3' }],
    });
  });
});
