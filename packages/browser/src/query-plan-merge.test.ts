import { describe, expect, it, vi } from 'vitest';

import { installCompiledQueryUpdatePlanSubscriptions } from './query-apply.js';
import { mergeCompiledQueryUpdatePlans } from './query-plan-merge.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot } from './runtime-test-fakes.js';

describe('generated query-plan registry', () => {
  it('maps component-local aliases to the source-derived runtime query identity', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const badgePlan = vi.fn();
    const panelPlan = vi.fn();
    const plans = mergeCompiledQueryUpdatePlans([
      {
        plans: { deal: badgePlan },
        queryNames: { deal: 'queries/deal-by-id-query' },
      },
      {
        plans: { selectedDeal: panelPlan },
        queryNames: { selectedDeal: 'queries/deal-by-id-query' },
      },
    ]);

    const dispose = installCompiledQueryUpdatePlanSubscriptions(store, root, plans);
    expect(dispose).toBeTypeOf('function');
    store.set('queries/deal-by-id-query', { stage: 'won' }, 'queries/deal-by-id-query:d1');

    const expectedContext = {
      queryIdentity: {
        key: 'queries/deal-by-id-query:d1',
        name: 'queries/deal-by-id-query',
      },
      queryStore: store,
    };
    expect(badgePlan).toHaveBeenCalledWith(root, { stage: 'won' }, expectedContext);
    expect(panelPlan).toHaveBeenCalledWith(root, { stage: 'won' }, expectedContext);

    dispose?.();
    store.set('queries/deal-by-id-query', { stage: 'lost' }, 'queries/deal-by-id-query:d1');
    expect(badgePlan).toHaveBeenCalledTimes(1);
    expect(panelPlan).toHaveBeenCalledTimes(1);
  });

  it('replays already-hydrated keyed truth when plans enroll after the store write', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    store.set('queries/deal-by-id-query', { stage: 'open' }, 'queries/deal-by-id-query:d1');

    installCompiledQueryUpdatePlanSubscriptions(
      store,
      root,
      mergeCompiledQueryUpdatePlans([
        {
          plans: { deal: plan },
          queryNames: { deal: 'queries/deal-by-id-query' },
        },
      ]),
    );

    expect(plan).toHaveBeenCalledWith(
      root,
      { stage: 'open' },
      {
        queryIdentity: {
          key: 'queries/deal-by-id-query:d1',
          name: 'queries/deal-by-id-query',
        },
        queryStore: store,
      },
    );
  });

  it('uses captured key enumeration after authored prototype poisoning', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object, 'keys');
    if (!descriptor) throw new Error('Object.keys descriptor unavailable');
    const plan = vi.fn();
    let plans;
    Object.defineProperty(Object, 'keys', {
      ...descriptor,
      value() {
        throw new Error('late Object.keys poison');
      },
    });
    try {
      plans = mergeCompiledQueryUpdatePlans([
        {
          plans: { deal: plan },
          queryNames: { deal: 'queries/deal-by-id-query' },
        },
      ]);
    } finally {
      Object.defineProperty(Object, 'keys', descriptor);
    }

    expect(Object.keys(plans!)).toEqual(['queries/deal-by-id-query']);
  });

  it('disposes earlier subscriptions when a later initial replay fails', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const first = vi.fn();
    const broken = vi.fn(() => {
      throw new Error('broken plan replay');
    });
    store.set('first', { value: 1 });
    store.set('second', { value: 2 });

    expect(() =>
      installCompiledQueryUpdatePlanSubscriptions(store, root, {
        first,
        second: broken,
      }),
    ).toThrow('broken plan replay');
    first.mockClear();
    broken.mockImplementation(() => undefined);

    store.set('first', { value: 3 });
    store.set('second', { value: 4 });
    expect(first).not.toHaveBeenCalled();
    expect(broken).toHaveBeenCalledTimes(1);
  });
});
