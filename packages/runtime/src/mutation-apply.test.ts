import { describe, expect, it, vi } from 'vitest';

import {
  applyFetchedEnhancedMutationResponseToRuntime,
  type EnhancedMutationRuntimeApplyOptions,
} from './mutation-apply.js';
import type { FetchedEnhancedMutation } from './mutation-fetch.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot, FakeMorphTarget, FakeQueryBindingElement } from './runtime-test-fakes.js';

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
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><span>2</span></fw-fragment>',
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
    expect(applied).toEqual({
      appliedFragments: ['cart-badge'],
      changes: [{ domain: 'cart', keys: ['cart:1'] }],
      fragments: [{ html: '<span>2</span>', target: 'cart-badge' }],
      idem: 'idem_success',
      queries: ['cart'],
      targets: ['cart-badge=cart'],
    });
    expect(broadcast.publish).toHaveBeenCalledWith(
      [
        '<fw-query name="cart">{"count":2}</fw-query>',
        '<fw-fragment target="cart-badge"><span>2</span></fw-fragment>',
      ].join(''),
      [{ domain: 'cart', keys: ['cart:1'] }],
    );
  });

  it('applies validation failure fragments without rebroadcasting failed responses', () => {
    const root = new FakeMorphRoot();
    const broadcast = { close: vi.fn(), publish: vi.fn() };
    root.targets.set('cart-form', new FakeMorphTarget());

    const applied = applyFetchedEnhancedMutationResponseToRuntime(
      applyOptions({ broadcast, root }),
      fetchedMutation('<fw-fragment target="cart-form"><form>Invalid</form></fw-fragment>', {
        response: { ok: false, status: 422, text: async () => '' },
      }),
    );

    // SPEC.md §9.2: enhanced validation failures still render the failed form
    // fragment locally, but they are not successful mutation responses to fan out.
    expect(root.targets.get('cart-form')?.html).toBe('<form>Invalid</form>');
    expect(applied.appliedFragments).toEqual(['cart-form']);
    expect(broadcast.publish).not.toHaveBeenCalled();
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
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><span>server</span></fw-fragment>',
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
