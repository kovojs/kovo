import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';
import { BreadcrumbLink } from './breadcrumb.js';
describe('BreadcrumbLink href sanitization (SECURITY_FINDINGS.md H3)', () => {
  it('neutralizes a javascript: href to the safe fallback', () => {
    const html = String(
      renderUiComponent(BreadcrumbLink, {
        children: 'Account',
        href: 'javascript:alert(document.cookie)',
      }),
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });
  it('preserves a safe relative href', () => {
    const html = String(
      renderUiComponent(BreadcrumbLink, { children: 'Account', href: '/account' }),
    );
    expect(html).toContain('href="/account"');
  });
  it('omits the href entirely when none is supplied or the link is current', () => {
    expect(String(renderUiComponent(BreadcrumbLink, { children: 'Home' }))).not.toContain('href=');
    expect(
      String(renderUiComponent(BreadcrumbLink, { children: 'Now', current: true, href: '/now' })),
    ).not.toContain('href=');
  });
});
