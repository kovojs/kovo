import { describe, expect, it } from 'vitest';

import {
  applyHtmlResponseFragments,
  applyResponseFragment,
  applyResponseFragments,
  type HtmlResponseFragmentApplyTarget,
} from './response-fragment-apply.js';

interface TestFragmentTarget {
  html: string;
}

describe('response fragment apply primitive', () => {
  function withTrustedTypesPolicy<T>(run: (created: string[]) => T): T {
    const state = globalThis as unknown as {
      __kovo_tt?: unknown;
      trustedTypes?: {
        createPolicy(
          name: 'kovo',
          rules: { createHTML(html: string): string },
        ): {
          createHTML(html: string): { html: string; toString(): string };
        };
      };
    };
    const previousPolicy = state.__kovo_tt;
    const previousTrustedTypes = state.trustedTypes;
    const created: string[] = [];
    delete state.__kovo_tt;
    state.trustedTypes = {
      createPolicy(name, rules) {
        created.push(name);
        return {
          createHTML(html: string) {
            const value = rules.createHTML(html);
            return {
              html: value,
              toString() {
                return value;
              },
            };
          },
        };
      },
    };
    try {
      return run(created);
    } finally {
      if (previousPolicy === undefined) delete state.__kovo_tt;
      else state.__kovo_tt = previousPolicy;
      if (previousTrustedTypes === undefined) delete state.trustedTypes;
      else state.trustedTypes = previousTrustedTypes;
    }
  }

  it('applies replace and append fragment modes through supplied target operations', () => {
    // SPEC.md §9.1: kovo-fragment patches share one decoded apply primitive
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

  it('shares the HTML append adapter used by the generated inline loader', () => {
    const targets = new Map([
      [
        'append-target',
        {
          html: '<li>old</li>',
          insertAdjacentHTML(_position: 'beforeend', html: string) {
            this.html += html;
          },
        },
      ],
    ]);

    const applied = applyHtmlResponseFragments(
      [
        { html: '<li>new</li>', mode: 'append', target: 'append-target' },
        { html: '<aside>ignored</aside>', target: 'missing-target' },
      ],
      (target) => (targets.get(target) as unknown as HtmlResponseFragmentApplyTarget) ?? null,
    );

    expect(applied).toEqual(['append-target']);
    expect(targets.get('append-target')?.html).toBe('<li>old</li><li>new</li>');
  });

  it('routes framework-owned HTML parse sinks through the cached Trusted Types policy', () => {
    withTrustedTypesPolicy((created) => {
      const appended: unknown[] = [];
      const targets = new Map([
        [
          'append-target',
          {
            insertAdjacentHTML(_position: 'beforeend', html: unknown) {
              if (typeof html === 'string') throw new TypeError('TrustedHTML required');
              appended.push(html);
            },
          },
        ],
      ]);
      expect(() =>
        targets.get('append-target')?.insertAdjacentHTML('beforeend', '<li>raw</li>'),
      ).toThrow('TrustedHTML required');

      const applied = applyHtmlResponseFragments(
        [
          { html: '<li>one</li>', mode: 'append', target: 'append-target' },
          { html: '<li>two</li>', mode: 'append', target: 'append-target' },
        ],
        (target) => (targets.get(target) as unknown as HtmlResponseFragmentApplyTarget) ?? null,
      );

      expect(applied).toEqual(['append-target', 'append-target']);
      expect(created).toEqual(['kovo']);
      expect(appended).toEqual([
        expect.objectContaining({ html: '<li>one</li>' }),
        expect.objectContaining({ html: '<li>two</li>' }),
      ]);
    });
  });

  it('exports one shared decoded fragment primitive and HTML adapter', async () => {
    const fragmentApplyModule = await import('./response-fragment-apply.js');

    // SPEC.md §4.4/§9.1: the generated inline loader embeds this canonical
    // helper closure, so there is no second private HTML fragment adapter.
    expect(fragmentApplyModule.applyHtmlResponseFragments).toBe(applyHtmlResponseFragments);
    expect(fragmentApplyModule.applyResponseFragments).toBe(applyResponseFragments);
  });
});
