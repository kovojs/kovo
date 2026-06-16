import { describe, expect, it } from 'vitest';

import { semanticSnapshot } from './semantic-snapshot.js';

describe('semanticSnapshot', () => {
  it('keeps Kovo semantic attributes and bound text', () => {
    const html =
      '<cart-badge kovo-c="cart-badge"><span data-bind="cart.count">3</span></cart-badge>';
    expect(semanticSnapshot(html)).toBe(
      ['<cart-badge kovo-c="cart-badge">', '  <span data-bind="cart.count">', '    "3"'].join('\n'),
    );
  });

  it('drops volatile presentation attributes (class, style, id)', () => {
    const html =
      '<div id="x7f3a" class="flex gap-2 text-sm" style="color:red" data-bind="greeting">hi</div>';
    expect(semanticSnapshot(html)).toBe('<div data-bind="greeting">\n  "hi"');
  });

  it('drops wire-only hidden inputs (CSRF, idempotency)', () => {
    const html =
      '<form action="/_m/cart/add"><input type="hidden" name="csrf" value="tok-abc123"><button type="submit">Add</button></form>';
    expect(semanticSnapshot(html)).toBe(
      ['<form action="/_m/cart/add">', '  <button type="submit">', '    "Add"'].join('\n'),
    );
  });

  it('normalizes cache-busting versions and content hashes in URLs', () => {
    const html = '<a href="/c/cart-add.client.js?v=9f3ad21c">x</a>';
    expect(semanticSnapshot(html)).toBe('<a href="/c/cart-add.client.js?v=*">\n  "x"');

    const asset = '<img src="/assets/logo.4f8a9c1b.png">';
    expect(semanticSnapshot(asset)).toBe('<img src="/assets/logo.*.png">');
  });

  it('keeps accessibility attributes and role/name', () => {
    const html =
      '<button role="switch" aria-checked="true" aria-label="Toggle" class="btn">on</button>';
    expect(semanticSnapshot(html)).toBe(
      '<button aria-checked="true" aria-label="Toggle" role="switch">\n  "on"',
    );
  });

  it('produces an identical snapshot under volatile-only churn', () => {
    const before =
      '<ul kovo-deps="todos"><li kovo-key="a" class="row even" id="i1" data-p-id="x">Buy milk</li></ul>';
    const after =
      '<ul kovo-deps="todos"><li kovo-key="a" class="row odd hover" id="i2" data-p-id="y" style="opacity:.5">Buy milk</li></ul>';
    expect(semanticSnapshot(after)).toBe(semanticSnapshot(before));
  });

  it('changes the snapshot when semantics change', () => {
    const a = '<li kovo-key="a">Buy milk</li>';
    const b = '<li kovo-key="b">Buy milk</li>';
    expect(semanticSnapshot(a)).not.toBe(semanticSnapshot(b));

    const c = '<li kovo-key="a">Buy eggs</li>';
    expect(semanticSnapshot(a)).not.toBe(semanticSnapshot(c));
  });

  it('normalizes whitespace in text and across nesting', () => {
    const html = '<p>  Hello\n   world  <strong>!</strong></p>';
    expect(semanticSnapshot(html)).toBe(
      ['<p>', '  "Hello world"', '  <strong>', '    "!"'].join('\n'),
    );
  });

  it('renders an error-channel element with its code and path', () => {
    const html =
      '<span data-error-code="OUT_OF_STOCK" data-error-path="quantity" class="text-red-600">Sold out</span>';
    expect(semanticSnapshot(html)).toBe(
      '<span data-error-code="OUT_OF_STOCK" data-error-path="quantity">\n  "Sold out"',
    );
  });

  it('drops script/style content but keeps the element shell', () => {
    const html =
      '<div><style>.x{color:red}</style><kovo-query name="cart">[{"count":3}]</kovo-query></div>';
    expect(semanticSnapshot(html)).toBe(
      ['<div>', '  <style>', '  <kovo-query name="cart">'].join('\n'),
    );
  });

  it('supports extra keep attributes via options', () => {
    const html = '<div data-testid="home" class="x">hi</div>';
    expect(semanticSnapshot(html, { keepAttrs: ['data-testid'] })).toBe(
      '<div data-testid="home">\n  "hi"',
    );
  });
});
