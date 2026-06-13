import { describe, expect, it } from 'vitest';

import { applyResponseFragment } from './response-fragment-apply.js';

interface TestFragmentTarget {
  html: string;
}

describe('response fragment apply primitive', () => {
  it('applies replace and append fragment modes through supplied target operations', () => {
    // SPEC.md §9.1: fw-fragment patches share one decoded apply primitive
    // across modular morph and the generated inline loader closure.
    const targets = new Map([
      ['cart-badge', { html: '' }],
      ['cart-list', { html: '<li>existing</li>' }],
    ] satisfies [string, TestFragmentTarget][]);
    const options = {
      appendFragment(target: TestFragmentTarget, html: string) {
        target.html += html;
      },
      findFragmentTarget(target: string) {
        return targets.get(target) ?? null;
      },
      replaceFragment(target: TestFragmentTarget, html: string) {
        target.html = html;
      },
    };

    expect(
      applyResponseFragment({ html: '<cart-badge>1</cart-badge>', target: 'cart-badge' }, options),
    ).toBe(true);
    expect(
      applyResponseFragment({ html: '<li>new</li>', mode: 'append', target: 'cart-list' }, options),
    ).toBe(true);
    expect(
      applyResponseFragment({ html: '<aside>ignored</aside>', target: 'missing' }, options),
    ).toBe(false);

    expect(targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(targets.get('cart-list')?.html).toBe('<li>existing</li><li>new</li>');
  });
});
