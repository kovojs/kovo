import { describe, expect, it } from 'vitest';

import { BreadcrumbLink } from './breadcrumb.js';

describe('BreadcrumbLink href sanitization (SECURITY_FINDINGS.md H3)', () => {
  it('neutralizes a javascript: href to the safe fallback', () => {
    const html = BreadcrumbLink.definition.render({
      children: 'Account',
      href: 'javascript:alert(document.cookie)',
    });

    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('preserves a safe relative href', () => {
    const html = BreadcrumbLink.definition.render({ children: 'Account', href: '/account' });

    expect(html).toContain('href="/account"');
  });

  it('omits the href entirely when none is supplied or the link is current', () => {
    expect(BreadcrumbLink.definition.render({ children: 'Home' })).not.toContain('href=');
    expect(
      BreadcrumbLink.definition.render({ children: 'Now', current: true, href: '/now' }),
    ).not.toContain('href=');
  });
});
