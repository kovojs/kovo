import { describe, expect, it, vi } from 'vitest';

import { expectInlineResponseApplyParity } from './inline-loader-response-apply-fixture.js';
import { inlineSourceInstallCases } from './inline-loader-test-utils.js';
import { applyInlineMutationResponseChunks } from './inline-response-apply.js';
import type { HtmlResponseFragmentApplyTarget } from './response-fragment-apply.js';

// SPEC.md §4.4/§9.1: the helper extracted into the inline loader owns the tiny
// response-apply step that applies fragment patches after the inline bootstrap
// has applied decoded query chunks to live bindings. The build/extract/closure-check behavior lives in sibling
// inline-loader-response-apply-extract.test.ts.
describe('inline loader response apply runtime', () => {
  it.each(inlineSourceInstallCases)(
    'keeps inline response application in parity with the modular DOM apply path through %s',
    async (_name, installSource) => {
      await expectInlineResponseApplyParity(installSource, { expect, vi });
    },
  );

  it('applies fragments through the runtime-owned helper', () => {
    const targets = new Map([
      [
        'append-second-target',
        {
          html: '<p>old</p>',
          insertAdjacentHTML(_position: 'beforeend', html: string) {
            this.html += html;
          },
        },
      ],
      [
        'append-target',
        {
          html: '<li>existing</li>',
          innerHTML: '',
          insertAdjacentHTML(_position: 'beforeend', html: string) {
            this.html += html;
          },
        },
      ],
    ]);

    const appliedFragments = applyInlineMutationResponseChunks(
      {
        fragments: [
          { html: '<p>replace</p>', target: 'replace-target' },
          { html: '<p>second</p>', mode: 'append', target: 'append-second-target' },
          { html: '<li>new</li>', mode: 'append', target: 'append-target' },
          { html: '<p>ignored</p>', target: 'missing-target' },
        ],
        queries: [{ attrs: ' name="cart"', content: 'decoded query', end: 12, start: 1 }],
      },
      {
        findFragmentTarget(target) {
          return (targets.get(target) as unknown as HtmlResponseFragmentApplyTarget) ?? null;
        },
      },
    );

    expect(appliedFragments).toEqual(['append-second-target', 'append-target']);
    expect(targets.get('append-second-target')?.html).toBe('<p>old</p><p>second</p>');
    expect(targets.get('append-target')?.html).toBe('<li>existing</li><li>new</li>');
  });
});
