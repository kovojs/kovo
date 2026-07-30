import { encodeFrameworkQueryDependencyToken } from '@kovojs/core/internal/wire-input-grammar';
import { describe, expect, it, vi } from 'vitest';

import { installCompiledQueryUpdatePlanSubscriptions } from './query-apply.js';
import { mergeCompiledQueryUpdatePlans } from './query-plan-merge.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot } from './runtime-test-fakes.js';

class PlanOwnerRoot {
  constructor(
    readonly componentName: string,
    readonly deps: string,
  ) {}

  getAttribute(name: string): string | null {
    if (name === 'kovo-plan-owner') return this.componentName;
    if (name === 'kovo-deps') return this.deps;
    return null;
  }

  querySelectorAll(_selector: string): Iterable<PlanOwnerRoot> {
    return [];
  }
}

class PlanDocumentRoot {
  constructor(readonly owners: readonly PlanOwnerRoot[]) {}

  querySelectorAll(selector: string): Iterable<PlanOwnerRoot> {
    return this.owners.filter((owner) =>
      selector.includes(`kovo-plan-owner="${owner.componentName}"`),
    );
  }
}

function dependencyToken(name: string, key?: string): string {
  const token = encodeFrameworkQueryDependencyToken(name, key);
  if (token === undefined) throw new TypeError('invalid test query identity');
  return token;
}

describe('generated query-plan registry', () => {
  it('maps component-local aliases to the source-derived runtime query identity', () => {
    const identity = 'queries/deal-by-id-query';
    const key = 'queries/deal-by-id-query:d1';
    const badgeRoot = new PlanOwnerRoot(
      'components/deal-badge/deal-badge',
      dependencyToken(identity, key),
    );
    const panelRoot = new PlanOwnerRoot(
      'components/deal-panel/deal-panel',
      dependencyToken(identity, key),
    );
    const root = new PlanDocumentRoot([badgeRoot, panelRoot]);
    const store = createQueryStore();
    const badgePlan = vi.fn();
    const panelPlan = vi.fn();
    const plans = mergeCompiledQueryUpdatePlans([
      {
        ownerSelector: '[kovo-plan-owner="components/deal-badge/deal-badge"]',
        plans: { deal: badgePlan },
        queryNames: { deal: identity },
      },
      {
        ownerSelector: '[kovo-plan-owner="components/deal-panel/deal-panel"]',
        plans: { selectedDeal: panelPlan },
        queryNames: { selectedDeal: identity },
      },
    ]);

    const dispose = installCompiledQueryUpdatePlanSubscriptions(store, root, plans);
    expect(dispose).toBeTypeOf('function');
    store.set(identity, { stage: 'won' }, key);

    const expectedContext = {
      queryIdentity: {
        key,
        name: identity,
      },
      queryStore: store,
    };
    expect(badgePlan).toHaveBeenCalledWith(badgeRoot, { stage: 'won' }, expectedContext);
    expect(panelPlan).toHaveBeenCalledWith(panelRoot, { stage: 'won' }, expectedContext);

    dispose?.();
    store.set(identity, { stage: 'lost' }, key);
    expect(badgePlan).toHaveBeenCalledTimes(1);
    expect(panelPlan).toHaveBeenCalledTimes(1);
  });

  it('replays already-hydrated keyed truth when plans enroll after the store write', () => {
    const identity = 'queries/deal-by-id-query';
    const key = 'queries/deal-by-id-query:d1';
    const owner = new PlanOwnerRoot(
      'components/deal-card/deal-card',
      dependencyToken(identity, key),
    );
    const root = new PlanDocumentRoot([owner]);
    const store = createQueryStore();
    const plan = vi.fn();
    store.set(identity, { stage: 'open' }, key);

    installCompiledQueryUpdatePlanSubscriptions(
      store,
      root,
      mergeCompiledQueryUpdatePlans([
        {
          ownerSelector: '[kovo-plan-owner="components/deal-card/deal-card"]',
          plans: { deal: plan },
          queryNames: { deal: identity },
        },
      ]),
    );

    expect(plan).toHaveBeenCalledWith(
      owner,
      { stage: 'open' },
      {
        queryIdentity: {
          key,
          name: identity,
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
          ownerSelector: '[kovo-plan-owner="components/deal-card/deal-card"]',
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

  it('keeps same-query same-alias component plans inside matching owners and exact instances', () => {
    const identity = 'queries/deal-by-id-query';
    const firstKey = 'queries/deal-by-id-query:d1';
    const secondKey = 'queries/deal-by-id-query:d2';
    const firstRoot = new PlanOwnerRoot(
      'components/first/deal-card',
      dependencyToken(identity, firstKey),
    );
    const secondRoot = new PlanOwnerRoot(
      'components/second/deal-card',
      dependencyToken(identity, secondKey),
    );
    const root = new PlanDocumentRoot([firstRoot, secondRoot]);
    const store = createQueryStore();
    const firstPlan = vi.fn();
    const secondPlan = vi.fn();
    const plans = mergeCompiledQueryUpdatePlans([
      {
        ownerSelector: '[kovo-plan-owner="components/first/deal-card"]',
        plans: { deal: firstPlan },
        queryNames: { deal: identity },
      },
      {
        ownerSelector: '[kovo-plan-owner="components/second/deal-card"]',
        plans: { deal: secondPlan },
        queryNames: { deal: identity },
      },
    ]);
    installCompiledQueryUpdatePlanSubscriptions(store, root, plans);

    store.set(identity, { stage: 'won' }, firstKey);
    expect(firstPlan).toHaveBeenCalledOnce();
    expect(firstPlan.mock.calls[0]?.[0]).toBe(firstRoot);
    expect(secondPlan).not.toHaveBeenCalled();

    store.set(identity, { stage: 'lost' }, secondKey);
    expect(firstPlan).toHaveBeenCalledOnce();
    expect(secondPlan).toHaveBeenCalledOnce();
    expect(secondPlan.mock.calls[0]?.[0]).toBe(secondRoot);
  });

  it('omits clock-only local plans through channel metadata without reserving runtime name now', () => {
    const clockPlan = vi.fn();
    expect(
      Object.keys(
        mergeCompiledQueryUpdatePlans([
          {
            ownerSelector: '[kovo-plan-owner="components/clock/clock-label"]',
            plans: { now: clockPlan },
            queryNames: {},
          },
        ]),
      ),
    ).toEqual([]);

    const queryPlan = vi.fn();
    const plans = mergeCompiledQueryUpdatePlans([
      {
        ownerSelector: '[kovo-plan-owner="components/query/now-card"]',
        plans: { clockNow: clockPlan, serverNow: queryPlan },
        queryNames: { serverNow: 'now' },
      },
    ]);
    expect(Object.keys(plans)).toEqual(['now']);
  });

  it('fails closed when forged generated metadata binds one runtime query twice', () => {
    expect(() =>
      mergeCompiledQueryUpdatePlans([
        {
          ownerSelector: '[kovo-plan-owner="components/deal/deal-card"]',
          plans: { deal: vi.fn(), selectedDeal: vi.fn() },
          queryNames: {
            deal: 'queries/deal-by-id-query',
            selectedDeal: 'queries/deal-by-id-query',
          },
        },
      ]),
    ).toThrow('Invalid Kovo query plan.');
  });
});
