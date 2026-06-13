import { describe, expect, it, vi } from 'vitest';

import { buildInlineJisoLoaderInstallerSource } from './inline-loader-build.js';
import { expectInlineResponseApplyParity } from './inline-loader-response-apply-fixture.js';
import { inlineSourceInstallCases } from './inline-loader-test-utils.js';
import { applyInlineMutationResponseBody } from './inline-response-apply.js';

describe('inline loader response apply source', () => {
  it.each(inlineSourceInstallCases)(
    'keeps inline response application in parity with the modular DOM apply path through %s',
    async (_name, installSource) => {
      await expectInlineResponseApplyParity(installSource, { expect, vi });
    },
  );

  it('keeps freshly minified response apply source compact before parity execution', () => {
    // SPEC.md §4.4/§9.1: minification cannot fork the inline mutation response
    // scanner or the raw `jiso:query` event handoff used by runtime query apply.
    const minifiedSource = buildInlineJisoLoaderInstallerSource();

    expect(minifiedSource).toBe(minifiedSource.trim());
    expect(minifiedSource).not.toMatch(/\n|\s{2,}/);
  });

  it('applies inline query events and fragments through the runtime-owned helper', () => {
    // SPEC.md §4.4/§9.1: the helper extracted into the inline loader owns the
    // tiny response apply step that bridges raw query chunks to modular query
    // event hydration and applies fragment patches.
    const dispatched: unknown[] = [];
    const targets = new Map([
      [
        'replace-target',
        {
          html: '',
          innerHTML: '',
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

    applyInlineMutationResponseBody('ignored body', {
      dispatchQuery(query) {
        dispatched.push(query);
      },
      findFragmentTarget(target) {
        return targets.get(target) ?? null;
      },
      readBody(body) {
        return {
          fragments: [
            { html: '<p>replace</p>', target: 'replace-target' },
            { html: '<li>new</li>', mode: 'append', target: 'append-target' },
          ],
          queries: [{ attrs: ' name="cart"', content: body, end: 0, start: 0 }],
        };
      },
    });

    expect(dispatched).toEqual([
      { attrs: ' name="cart"', content: 'ignored body', end: 0, start: 0 },
    ]);
    expect(targets.get('replace-target')?.innerHTML).toBe('<p>replace</p>');
    expect(targets.get('append-target')?.html).toBe('<li>existing</li><li>new</li>');
  });
});
