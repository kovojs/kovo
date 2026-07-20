import { describe, expect, it } from 'vitest';

import { registerFrameworkSessionPrincipalSnapshot } from './auth-principal.js';
import {
  derived,
  type DerivedVectorQueryInput,
  type DerivedVectorUpsertInput,
} from './derived-dataset.js';

function requestFor(principal: string): object {
  const request = {};
  registerFrameworkSessionPrincipalSnapshot(request, {
    id: `session:${principal}`,
    user: { id: principal },
  });
  return request;
}

describe('derived vector dataset authority (SPEC §6.6/§10.3 C9)', () => {
  it('derives the same namespace for one principal and separates equal keys across principals', async () => {
    const writes: DerivedVectorUpsertInput<{ id: string }>[] = [];
    const reads: DerivedVectorQueryInput<{ vector: readonly number[] }>[] = [];
    const adapter = {
      query(input: DerivedVectorQueryInput<{ vector: readonly number[] }>) {
        reads.push(input);
        return [{ id: 'match-1' }];
      },
      upsert(input: DerivedVectorUpsertInput<{ id: string }>) {
        writes.push(input);
      },
    };
    const dataset = derived(adapter, { key: 'support-documents', kind: 'vector' });
    const first = requestFor('principal-a');
    const second = requestFor('principal-b');

    await dataset.upsert(first, [{ id: 'a' }]);
    await expect(dataset.query(first, { vector: [1, 2] })).resolves.toEqual([{ id: 'match-1' }]);
    await dataset.upsert(second, [{ id: 'b' }]);
    const otherDataset = derived(adapter, { key: 'other-documents', kind: 'vector' });
    await otherDataset.upsert(first, [{ id: 'other' }]);

    expect(writes[0]?.namespace).toBe(reads[0]?.namespace);
    expect(writes[0]?.namespace).toMatch(/^kovo-derived-vector-v1\/[0-9a-f]{64}$/u);
    expect(writes[1]?.namespace).not.toBe(writes[0]?.namespace);
    expect(writes[2]?.namespace).not.toBe(writes[0]?.namespace);
    expect(writes[0]?.namespace).not.toContain('principal-a');
    expect(Object.isFrozen(writes[0])).toBe(true);
    expect(Object.isFrozen(writes[0]?.records)).toBe(true);
    expect(Object.isFrozen(reads[0])).toBe(true);
  });

  it('reconstructs scope on every read and rejects anonymous, unresolved, and forged carriers', async () => {
    let adapterCalls = 0;
    const dataset = derived(
      {
        query() {
          adapterCalls += 1;
          return [];
        },
        upsert() {
          adapterCalls += 1;
        },
      },
      { key: 'knowledge', kind: 'vector' },
    );
    const anonymous = {};
    registerFrameworkSessionPrincipalSnapshot(anonymous, null);
    const unresolved = {};
    registerFrameworkSessionPrincipalSnapshot(unresolved, { user: { id: 'anonymous' } });

    await expect(dataset.query(anonymous, {})).rejects.toThrow(/framework-resolved principal/u);
    await expect(dataset.query(unresolved, {})).rejects.toThrow(/framework-resolved principal/u);
    await expect(dataset.upsert({ session: { user: { id: 'forged' } } }, [])).rejects.toThrow(
      /framework-owned session request carrier/u,
    );
    expect(adapterCalls).toBe(0);
  });

  it('pins adapter callables and snapshots dense record/result arrays before returning', async () => {
    const records = [{ id: 'one' }];
    const matches = [{ id: 'match' }];
    let originalUpserts = 0;
    let replacementUpserts = 0;
    const adapter = {
      query() {
        return matches;
      },
      upsert() {
        originalUpserts += 1;
      },
    };
    const dataset = derived(adapter, { key: 'knowledge', kind: 'vector' });
    adapter.upsert = () => {
      replacementUpserts += 1;
    };

    await dataset.upsert(requestFor('principal'), records);
    const result = await dataset.query(requestFor('principal'), {});
    records.push({ id: 'late' });
    matches.push({ id: 'late' });

    expect(originalUpserts).toBe(1);
    expect(replacementUpserts).toBe(0);
    expect(result).toEqual([{ id: 'match' }]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects accessor options, inherited adapter methods, sparse batches, and surplus options', async () => {
    let optionReads = 0;
    const options = {};
    Object.defineProperty(options, 'key', {
      enumerable: true,
      get() {
        optionReads += 1;
        return 'knowledge';
      },
    });
    Object.defineProperty(options, 'kind', { enumerable: true, value: 'vector' });

    expect(() =>
      derived(
        { query: () => [], upsert: () => undefined },
        options as { key: string; kind: 'vector' },
      ),
    ).toThrow(/key must be an own data property/u);
    expect(optionReads).toBe(0);

    class InheritedAdapter {
      query() {
        return [];
      }
      upsert() {}
    }
    expect(() => derived(new InheritedAdapter(), { key: 'knowledge', kind: 'vector' })).toThrow(
      /own data property/u,
    );
    expect(() =>
      derived({ query: () => [], upsert: () => undefined }, {
        key: 'knowledge',
        kind: 'vector',
        extra: true,
      } as never),
    ).toThrow(/exactly key and kind/u);

    const dataset = derived(
      { query: () => [], upsert: () => undefined },
      { key: 'knowledge', kind: 'vector' },
    );
    const sparse = new Array<{ id: string }>(1);
    await expect(dataset.upsert(requestFor('principal'), sparse)).rejects.toThrow(
      /dense own data/u,
    );
  });
});
