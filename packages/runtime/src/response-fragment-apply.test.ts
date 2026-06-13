import { describe, expect, it } from 'vitest';

import {
  applyHtmlResponseFragments,
  applyResponseFragment,
  applyResponseFragments,
} from './response-fragment-apply.js';

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

  it('reports applied targets from one fragment batch helper', () => {
    // SPEC.md §9.1: modular DOM apply and inline apply share fragment target
    // filtering and applied-target reporting after response bodies are decoded.
    const targets = new Map([
      ['replace-target', { html: '<p>old</p>' }],
      ['append-target', { html: '<li>old</li>' }],
    ] satisfies [string, TestFragmentTarget][]);

    const applied = applyResponseFragments<TestFragmentTarget>(
      [
        { html: '<p>new</p>', target: 'replace-target' },
        { html: '<li>new</li>', mode: 'append', target: 'append-target' },
        { html: '<aside>ignored</aside>', target: 'missing-target' },
      ],
      {
        appendFragment(target, html) {
          target.html += html;
        },
        findFragmentTarget(target) {
          return targets.get(target) ?? null;
        },
        replaceFragment(target, html) {
          target.html = html;
        },
      },
    );

    expect(applied).toEqual(['replace-target', 'append-target']);
    expect(targets.get('replace-target')?.html).toBe('<p>new</p>');
    expect(targets.get('append-target')?.html).toBe('<li>old</li><li>new</li>');
  });

  it('applies HTML response fragments through the shared inline adapter', () => {
    // SPEC.md §4.4/§9.1: the inline loader patch adapter is a shared fragment
    // apply helper, not duplicate append/replace code in the inline response seam.
    const targets = new Map([
      [
        'replace-target',
        {
          html: '',
          innerHTML: '<p>old</p>',
          insertAdjacentHTML(_position: 'beforeend', html: string) {
            this.html += html;
          },
        },
      ],
      [
        'append-target',
        {
          html: '<li>old</li>',
          innerHTML: '',
          insertAdjacentHTML(_position: 'beforeend', html: string) {
            this.html += html;
          },
        },
      ],
    ]);

    const applied = applyHtmlResponseFragments(
      [
        { html: '<p>new</p>', target: 'replace-target' },
        { html: '<li>new</li>', mode: 'append', target: 'append-target' },
        { html: '<aside>ignored</aside>', target: 'missing-target' },
      ],
      (target) => targets.get(target) ?? null,
    );

    expect(applied).toEqual(['replace-target', 'append-target']);
    expect(targets.get('replace-target')?.innerHTML).toBe('<p>new</p>');
    expect(targets.get('append-target')?.html).toBe('<li>old</li><li>new</li>');
  });
});
