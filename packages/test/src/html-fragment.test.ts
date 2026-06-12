import { describe, expect, it } from 'vitest';

import { fragmentHtml } from './html-fragment.js';

describe('@jiso/test html fragment seam', () => {
  it('extracts explicit fragments without constructing a harness page assertion', () => {
    expect(
      fragmentHtml(
        '<main><fw-fragment target="cart-badge"><span>1</span></fw-fragment></main>',
        'cart-badge',
      ),
    ).toBe('<span>1</span>');
  });

  it('extracts SPEC §9.1 runtime targets by id and fw-fragment-target only', () => {
    const html = [
      '<section fw-c="cart-badge"><span>ignored</span></section>',
      '<section id="cart-badge"><span>1</span></section>',
      '<aside fw-fragment-target="cart-summary"><span>2</span></aside>',
    ].join('');

    expect(fragmentHtml(html, 'cart-badge')).toBe(
      '<section id="cart-badge"><span>1</span></section>',
    );
    expect(fragmentHtml(html, 'cart-summary')).toBe(
      '<aside fw-fragment-target="cart-summary"><span>2</span></aside>',
    );
    expect(fragmentHtml(html, 'missing-target')).toBe('');
  });
});
