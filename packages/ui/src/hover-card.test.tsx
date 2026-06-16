import { describe, expect, it } from 'vitest';

import { HoverCardTrigger } from './hover-card.js';

describe('HoverCardTrigger href sanitization (SECURITY_FINDINGS.md H3)', () => {
  it('neutralizes a javascript: href to the safe fallback', () => {
    const html = HoverCardTrigger.definition.render({
      children: 'Ada',
      href: 'javascript:alert(document.cookie)',
    });

    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('preserves a safe relative href', () => {
    const html = HoverCardTrigger.definition.render({ children: 'Ada', href: '/team/ada' });

    expect(html).toContain('href="/team/ada"');
  });

  it('defaults to the # fallback when no href is supplied', () => {
    const html = HoverCardTrigger.definition.render({ children: 'Ada' });

    expect(html).toContain('href="#"');
  });

  it('omits the href entirely when disabled', () => {
    const html = HoverCardTrigger.definition.render({
      children: 'Ada',
      disabled: true,
      href: 'javascript:alert(1)',
    });

    expect(html).not.toContain('href=');
    expect(html).not.toContain('javascript:');
  });
});
