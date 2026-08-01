import { describe, expect, it } from 'vitest';

import { trustedUrl, type TrustedUrl } from '@kovojs/browser';

import { BreadcrumbLink } from './breadcrumb.js';
import { HoverCardTrigger } from './hover-card.js';
import { NavigationMenuLink } from './navigation-menu.js';
import { safeUrl } from './safe-url.js';
import { renderUiComponent } from './test-component-render.js';

describe('UI safeUrl authority', () => {
  it('keeps dangerous schemes closed after authored intrinsic poisoning', () => {
    const nativeSetHas = Set.prototype.has;
    const nativeRegExpExec = RegExp.prototype.exec;
    let setResult: ReturnType<typeof safeUrl> = '';
    let regexpResult: ReturnType<typeof safeUrl> = '';
    try {
      Set.prototype.has = () => true;
      setResult = safeUrl('javascript:alert(1)');
      RegExp.prototype.exec = () => null;
      regexpResult = safeUrl('javascript:alert(1)');
    } finally {
      Set.prototype.has = nativeSetHas;
      RegExp.prototype.exec = nativeRegExpExec;
    }
    expect(setResult).toBe('#');
    expect(regexpResult).toBe('#');
  });

  it('preserves ordinary allowed and relative URL behavior', () => {
    expect(safeUrl('HTTPS://example.test/path')).toBe('HTTPS://example.test/path');
    expect(safeUrl('/cart?a=1&b=2')).toBe('/cart?a=1&b=2');
    expect(safeUrl('javascript&#x3A;alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
  });

  it('defers non-string provenance to the intrinsic URL sink without coercion', () => {
    let invoked = false;
    const carrier = {
      value: 'javascript:forgedNavigation()',
      toString() {
        invoked = true;
        return 'javascript:forgedNavigation()';
      },
    };
    expect(safeUrl(carrier as unknown as TrustedUrl)).toBe(carrier);
    expect(invoked).toBe(false);
  });

  it('renders genuine TrustedUrl bytes and omits structural lookalikes at each anchor sink', () => {
    const reviewed = trustedUrl('javascript:reviewedNavigation()', {
      reason: 'test fixture proves exact TrustedUrl provenance survives copied UI components',
    });
    let invoked = false;
    const forged = {
      value: 'javascript:forgedNavigation()',
      toString() {
        invoked = true;
        return 'javascript:forgedNavigation()';
      },
    } as unknown as TrustedUrl;

    const genuineHtml = [
      renderUiComponent(BreadcrumbLink, { children: 'Account', href: reviewed }),
      renderUiComponent(HoverCardTrigger, { children: 'Account', href: reviewed }),
      renderUiComponent(NavigationMenuLink, {
        children: 'Account',
        href: reviewed,
        itemValue: 'account',
      }),
    ];
    const forgedHtml = [
      renderUiComponent(BreadcrumbLink, { children: 'Account', href: forged }),
      renderUiComponent(HoverCardTrigger, { children: 'Account', href: forged }),
      renderUiComponent(NavigationMenuLink, {
        children: 'Account',
        href: forged,
        itemValue: 'account',
      }),
    ];

    for (const rendered of genuineHtml) {
      expect(String(rendered)).toContain('href="javascript:reviewedNavigation()"');
    }
    for (const rendered of forgedHtml) {
      expect(String(rendered)).not.toContain('href=');
      expect(String(rendered)).not.toContain('forgedNavigation');
    }
    expect(invoked).toBe(false);
  });

  it('falls back for hostile non-object runtime values without invoking coercion', () => {
    let invoked = false;
    const callable = Object.assign(() => 'javascript:callableNavigation()', {
      toString() {
        invoked = true;
        return 'javascript:callableNavigation()';
      },
    });
    const hostile = [callable, Symbol('javascript:symbolNavigation()'), 1n] as const;

    for (const value of hostile) {
      const href = value as unknown as TrustedUrl;
      const rendered = [
        renderUiComponent(BreadcrumbLink, { children: 'Account', href }),
        renderUiComponent(HoverCardTrigger, { children: 'Account', href }),
        renderUiComponent(NavigationMenuLink, {
          children: 'Account',
          href,
          itemValue: 'account',
        }),
      ];
      for (const html of rendered) {
        expect(String(html)).toContain('href="#"');
        expect(String(html)).not.toContain('Navigation()');
      }
    }
    expect(invoked).toBe(false);
  });
});
