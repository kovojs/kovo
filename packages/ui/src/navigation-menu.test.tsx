import { describe, expect, it } from 'vitest';

import { NavigationMenuLink, NavigationMenuTrigger } from './navigation-menu.js';

describe('NavigationMenuLink href sanitization (SECURITY_FINDINGS.md H3)', () => {
  it('neutralizes a javascript: href to the safe fallback', () => {
    const html = NavigationMenuLink.definition.render({
      children: 'Company',
      href: 'javascript:alert(document.cookie)',
      itemValue: 'company',
    });

    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('preserves a safe relative href', () => {
    const html = NavigationMenuLink.definition.render({
      children: 'Company',
      href: '/company',
      itemValue: 'company',
    });

    expect(html).toContain('href="/company"');
  });
});

describe('navigation-menu scalar text props are escaped (SECURITY_FINDINGS.md C1)', () => {
  it('escapes an itemLabel fallback containing HTML in NavigationMenuTrigger', () => {
    const html = NavigationMenuTrigger.definition.render({
      itemLabel: '<img src=x onerror=alert(1)>',
      itemValue: 'products',
    });

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes an itemValue fallback containing HTML in NavigationMenuLink', () => {
    const html = NavigationMenuLink.definition.render({
      itemValue: '<img src=x onerror=alert(1)>',
    });

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('leaves the children composition slot raw (not double-escaped)', () => {
    const html = NavigationMenuTrigger.definition.render({
      children: '<span>Products</span>',
      itemLabel: 'Products',
      itemValue: 'products',
    });

    expect(html).toContain('<span>Products</span>');
  });
});
