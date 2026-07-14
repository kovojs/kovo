import {
  renderedFragmentHtmlContent,
  type RenderedFragmentHtml,
} from '@kovojs/core/internal/sink-policy';
import { describe, expect, it, vi } from 'vitest';

import {
  applyFetchedEnhancedMutationResponseToRuntime,
  type EnhancedMutationRuntimeApplyOptions,
} from './mutation-apply.js';
import { installMutationBroadcast } from './broadcast.js';
import type { FetchedEnhancedMutation } from './mutation-fetch.js';
import { createQueryStore } from './query-store.js';
import {
  FakeBroadcastChannel,
  FakeMorphRoot,
  FakeMorphTarget,
  FakeQueryBindingElement,
} from './runtime-test-fakes.js';

type FragmentSnapshot = {
  html: string;
  mode?: 'append' | 'prepend' | 'replace';
  target: string;
};

function fragmentSnapshots(
  fragments: readonly {
    html: RenderedFragmentHtml;
    mode?: 'append' | 'prepend' | 'replace';
    target: string;
  }[],
): FragmentSnapshot[] {
  return fragments.map((fragment) => ({
    ...fragment,
    html: renderedFragmentHtmlContent(fragment.html),
  }));
}

function mutationApplySnapshot<
  Result extends { fragments: readonly { html: RenderedFragmentHtml; target: string }[] },
>(result: Result): Omit<Result, 'fragments'> & { fragments: FragmentSnapshot[] } {
  return {
    ...result,
    fragments: fragmentSnapshots(result.fragments),
  };
}

function fetchedMutation(
  body: string,
  options: Partial<FetchedEnhancedMutation> = {},
): FetchedEnhancedMutation {
  return {
    body,
    changes: [],
    idem: 'idem_apply',
    response: { ok: true, status: 200, text: async () => body },
    targets: [],
    ...options,
  };
}

function applyOptions(
  options: Partial<EnhancedMutationRuntimeApplyOptions> = {},
): EnhancedMutationRuntimeApplyOptions {
  const root = new FakeMorphRoot();

  return {
    root,
    store: createQueryStore(),
    ...options,
  };
}

describe('enhanced mutation response apply orchestration', () => {
  it('applies fetched query and fragment bodies before publishing successful broadcasts', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const broadcast = { close: vi.fn(), publish: vi.fn() };
    root.targets.set('cart-badge', new FakeMorphTarget());

    const applied = applyFetchedEnhancedMutationResponseToRuntime(
      applyOptions({ broadcast, root, store }),
      fetchedMutation(
        [
          '<kovo-query name="cart">{"count":2}</kovo-query>',
          '<kovo-fragment target="cart-badge"><span>2</span></kovo-fragment>',
        ].join(''),
        {
          changes: [{ domain: 'cart', keys: ['cart:1'] }],
          idem: 'idem_success',
          targets: ['cart-badge=cart'],
        },
      ),
    );

    // SPEC.md §9.1: enhanced mutation responses apply server query truth and
    // returned fragments through the same runtime body path before sync fanout.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(root.targets.get('cart-badge')?.html).toBe('<span>2</span>');
    expect(mutationApplySnapshot(applied)).toEqual({
      appliedFragments: ['cart-badge'],
      changes: [{ domain: 'cart', keys: ['cart:1'] }],
      fragments: [{ html: '<span>2</span>', target: 'cart-badge' }],
      idem: 'idem_success',
      queries: ['cart'],
      targets: ['cart-badge=cart'],
    });
    expect(broadcast.publish).toHaveBeenCalledWith(
      [
        '<kovo-query name="cart">{"count":2}</kovo-query>',
        '<kovo-fragment target="cart-badge"><span>2</span></kovo-fragment>',
      ].join(''),
      [{ domain: 'cart', keys: ['cart:1'] }],
      undefined,
    );
    expect(broadcast.close).not.toHaveBeenCalled();
  });

  it.each([
    ['anonymous to authenticated', undefined, 'principal-a'],
    ['authenticated to anonymous', 'principal-a', undefined],
    ['principal A to principal B', 'principal-a', 'principal-b'],
    ['same-principal rolling credential refresh', 'principal-a', 'principal-a'],
  ])('closes before apply/publish for %s', (_label, _pagePrincipal, _nextPrincipal) => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const broadcast = { close: vi.fn(), publish: vi.fn() };
    const reload = vi.fn();
    const originalLocation = globalThis.location;
    Reflect.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { reload },
    });

    try {
      const applied = applyFetchedEnhancedMutationResponseToRuntime(
        applyOptions({ broadcast, root, store }),
        fetchedMutation('<kovo-query name="account">{"owner":"victim"}</kovo-query>', {
          changes: [{ domain: 'auth' }, { domain: 'account' }],
          sessionTransition: true,
        }),
      );

      expect(broadcast.close).toHaveBeenCalledOnce();
      expect(broadcast.publish).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledOnce();
      expect(store.get('account')).toBeUndefined();
      expect(applied).toEqual({
        appliedFragments: [],
        changes: [],
        fragments: [],
        idem: 'idem_apply',
        queries: [],
        targets: [],
      });
    } finally {
      Reflect.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('applies validation failure fragments without rebroadcasting failed responses', () => {
    const root = new FakeMorphRoot();
    const broadcast = { close: vi.fn(), publish: vi.fn() };
    root.targets.set('cart-form', new FakeMorphTarget());

    const applied = applyFetchedEnhancedMutationResponseToRuntime(
      applyOptions({ broadcast, root }),
      fetchedMutation('<kovo-fragment target="cart-form"><form>Invalid</form></kovo-fragment>', {
        response: { ok: false, status: 422, text: async () => '' },
      }),
    );

    // SPEC.md §9.2: enhanced validation failures still render the failed form
    // fragment locally, but they are not successful mutation responses to fan out.
    expect(root.targets.get('cart-form')?.html).toBe('<form>Invalid</form>');
    expect(applied.appliedFragments).toEqual(['cart-form']);
    expect(broadcast.publish).not.toHaveBeenCalled();
  });

  // SPEC §9.1.1: the production submit path must thread build tokens + the
  // refetch handler so deltas validate their base and recover on a miss/skew,
  // rather than silently dropping the update.
  const DELTA_BODY =
    '<kovo-query name="cart" delta>{"set":{"count":3},"lists":{"items":{"key":"id","upsert":[{"id":"p1","qty":2}]}}}</kovo-query>';

  it('applies a delta chunk against the held base when build tokens match', () => {
    const store = createQueryStore();
    store.set('cart', {
      count: 2,
      items: [
        { id: 'p1', qty: 1 },
        { id: 'p2', qty: 5 },
      ],
    });
    const onDeltaMiss = vi.fn();

    applyFetchedEnhancedMutationResponseToRuntime(
      applyOptions({ expectedBuildToken: 'build_A', onDeltaMiss, store }),
      fetchedMutation(DELTA_BODY, { buildToken: 'build_A' }),
    );

    expect(store.get('cart')).toEqual({
      count: 3,
      items: [
        { id: 'p1', qty: 2 },
        { id: 'p2', qty: 5 },
      ],
    });
    expect(onDeltaMiss).not.toHaveBeenCalled();
  });

  it('routes a delta to onDeltaMiss and leaves the base untouched on build-token skew', () => {
    const store = createQueryStore();
    store.set('cart', { count: 2, items: [{ id: 'p1', qty: 1 }] });
    const onDeltaMiss = vi.fn();

    applyFetchedEnhancedMutationResponseToRuntime(
      applyOptions({ expectedBuildToken: 'build_A', onDeltaMiss, store }),
      fetchedMutation(DELTA_BODY, { buildToken: 'build_B' }),
    );

    // Stale base across a deploy: never patched silently — refetch is delegated.
    expect(onDeltaMiss).toHaveBeenCalledWith('cart', undefined);
    expect(store.get('cart')).toEqual({ count: 2, items: [{ id: 'p1', qty: 1 }] });
  });

  it.each([
    ['missing', undefined],
    ['mismatched', 'build_B'],
  ])('does not rebroadcast a successful response with %s build proof', (_label, buildToken) => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ buildToken: 'build_A', channel, store });

    applyFetchedEnhancedMutationResponseToRuntime(
      applyOptions({ broadcast, expectedBuildToken: 'build_A', store }),
      fetchedMutation('<kovo-query name="account">{"secret":"new-build"}</kovo-query>', {
        buildToken,
      }),
    );

    expect(store.get('account')).toBeUndefined();
    expect(channel.messages).toEqual([]);
  });

  it('routes a delta to onDeltaMiss when the client holds no base for the query', () => {
    const store = createQueryStore();
    const onDeltaMiss = vi.fn();

    applyFetchedEnhancedMutationResponseToRuntime(
      applyOptions({ onDeltaMiss, onError: vi.fn(), store }),
      fetchedMutation(DELTA_BODY, { buildToken: 'build_A' }),
    );

    expect(onDeltaMiss).toHaveBeenCalledWith('cart', undefined);
    expect(store.get('cart')).toBeUndefined();
  });

  it('lets optimistic reconciliation interpose store truth before query plans and morphs run', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, { textContent: '0' });
    const observedDuringMorph: string[] = [];
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());

    applyFetchedEnhancedMutationResponseToRuntime(
      applyOptions({
        morph(target, html) {
          observedDuringMorph.push(count.textContent ?? '');
          target.replaceWithHtml(html);
        },
        root,
        store,
      }),
      fetchedMutation(
        [
          '<kovo-query name="cart">{"count":1}</kovo-query>',
          '<kovo-fragment target="cart-badge"><span>server</span></kovo-fragment>',
        ].join(''),
      ),
      {
        applyQuery(query) {
          store.set(query.name, { count: 11 }, query.key);
          return { value: store.get(query.name, query.key) };
        },
      },
    );

    expect(count.textContent).toBe('11');
    expect(root.targets.get('cart-badge')?.html).toBe('<span>server</span>');
    expect(observedDuringMorph).toEqual(['11']);
  });
});
