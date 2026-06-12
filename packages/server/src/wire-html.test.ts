import { describe, expect, it } from 'vitest';

import { renderFragmentWireHtml } from './wire-html.js';

describe('server wire html emitters', () => {
  it('renders fw-fragment wrappers with escaped wire attributes and raw html content', () => {
    expect(
      renderFragmentWireHtml({
        errorBoundary: 'error&panel',
        html: '<section data-ready="true">Ready</section>',
        mode: 'append',
        priority: '5&up',
        target: 'cart&badge',
      }),
    ).toBe(
      '<fw-fragment target="cart&amp;badge" mode="append" priority="5&amp;up" error-boundary="error&amp;panel"><section data-ready="true">Ready</section></fw-fragment>',
    );
  });

  it('omits replace mode because it is the default fragment wire behavior', () => {
    expect(
      renderFragmentWireHtml({
        html: '<main>Updated</main>',
        mode: 'replace',
        target: 'content',
      }),
    ).toBe('<fw-fragment target="content"><main>Updated</main></fw-fragment>');
  });
});
