import { describe, expect, it } from 'vitest';

import {
  navigationMenuContentAttributes as exportedNavigationMenuContentAttributes,
  navigationMenuFocusElement as exportedNavigationMenuFocusElement,
  navigationMenuIndicatorAttributes as exportedNavigationMenuIndicatorAttributes,
  navigationMenuItemAttributes as exportedNavigationMenuItemAttributes,
  navigationMenuItemHighlighted as exportedNavigationMenuItemHighlighted,
  navigationMenuItemOpen as exportedNavigationMenuItemOpen,
  navigationMenuKeyDown as exportedNavigationMenuKeyDown,
  navigationMenuLinkAttributes as exportedNavigationMenuLinkAttributes,
  navigationMenuLinkClick as exportedNavigationMenuLinkClick,
  navigationMenuListAttributes as exportedNavigationMenuListAttributes,
  navigationMenuMove as exportedNavigationMenuMove,
  navigationMenuRootAttributes as exportedNavigationMenuRootAttributes,
  navigationMenuTriggerAttributes as exportedNavigationMenuTriggerAttributes,
  navigationMenuTriggerClick as exportedNavigationMenuTriggerClick,
  navigationMenuTriggerFocus as exportedNavigationMenuTriggerFocus,
  navigationMenuTriggerPointerEnter as exportedNavigationMenuTriggerPointerEnter,
  navigationMenuTypeahead as exportedNavigationMenuTypeahead,
  navigationMenuViewportAttributes as exportedNavigationMenuViewportAttributes,
  selectNavigationMenuLink as exportedSelectNavigationMenuLink,
  setNavigationMenuOpenValue as exportedSetNavigationMenuOpenValue,
  toggleNavigationMenuOpenValue as exportedToggleNavigationMenuOpenValue,
} from '../index.js';
import {
  navigationMenuContentAttributes,
  navigationMenuFocusElement,
  navigationMenuIndicatorAttributes,
  navigationMenuItemAttributes,
  navigationMenuItemHighlighted,
  navigationMenuItemOpen,
  navigationMenuKeyDown,
  navigationMenuLinkAttributes,
  navigationMenuLinkClick,
  navigationMenuListAttributes,
  navigationMenuMove,
  navigationMenuRootAttributes,
  navigationMenuTriggerAttributes,
  navigationMenuTriggerClick,
  navigationMenuTriggerFocus,
  navigationMenuTriggerPointerEnter,
  navigationMenuTypeahead,
  navigationMenuViewportAttributes,
  selectNavigationMenuLink,
  setNavigationMenuOpenValue,
  toggleNavigationMenuOpenValue,
  type NavigationMenuItem,
} from './navigation-menu.js';
import { navigationMenuRootAttributes as primitiveNavigationMenuRootAttributes } from './index.js';

const navigationItems: readonly NavigationMenuItem[] = Object.freeze([
  { hasContent: true, label: 'Products', value: 'products' },
  { label: 'Pricing', value: 'pricing' },
  { disabled: true, hasContent: true, label: 'Solutions', value: 'solutions' },
  { textValue: 'Resources library', value: 'resources' },
  { label: 'Company', value: 'company' },
]);

describe('headless-ui navigation-menu primitive', () => {
  it('builds root, list, item, trigger, content, link, viewport, and indicator attributes', () => {
    expect(
      navigationMenuRootAttributes({
        activeValue: 'products',
        id: 'site-nav',
        label: 'Site',
        openValue: 'products',
      }),
    ).toEqual({
      'aria-label': 'Site',
      'data-orientation': 'horizontal',
      'data-state': 'open',
      id: 'site-nav',
      role: 'navigation',
    });
    expect(navigationMenuRootAttributes({ disabled: true, orientation: 'vertical' })).toEqual({
      'aria-disabled': 'true',
      'aria-orientation': 'vertical',
      'data-disabled': '',
      'data-orientation': 'vertical',
      'data-state': 'closed',
      role: 'navigation',
    });
    expect(navigationMenuListAttributes({ id: 'nav-list', openValue: 'products' })).toEqual({
      'data-orientation': 'horizontal',
      'data-state': 'open',
      id: 'nav-list',
      role: 'list',
    });

    expect(
      navigationMenuItemAttributes({
        activeValue: 'products',
        itemValue: 'products',
        items: navigationItems,
      }),
    ).toEqual({
      'data-highlighted': '',
      'data-state': 'active',
      role: 'listitem',
    });
    expect(
      navigationMenuTriggerAttributes({
        activeValue: 'products',
        contentId: 'products-panel',
        itemValue: 'products',
        items: navigationItems,
        openValue: 'products',
      }),
    ).toEqual({
      'aria-controls': 'products-panel',
      'aria-expanded': 'true',
      'aria-haspopup': 'true',
      'data-highlighted': '',
      'data-state': 'open',
      disabled: false,
      tabIndex: 0,
      type: 'button',
      value: 'products',
    });
    expect(
      navigationMenuTriggerAttributes({
        activeValue: 'products',
        contentId: 'solutions-panel',
        itemValue: 'solutions',
        items: navigationItems,
      }),
    ).toEqual({
      'aria-expanded': 'false',
      'aria-haspopup': 'true',
      'data-disabled': '',
      'data-state': 'closed',
      disabled: true,
      tabIndex: -1,
      type: 'button',
      value: 'solutions',
    });
    expect(
      navigationMenuContentAttributes({
        id: 'products-panel',
        labelledBy: 'products-trigger',
        openValue: 'products',
        value: 'products',
      }),
    ).toEqual({
      'aria-labelledby': 'products-trigger',
      'data-state': 'open',
      id: 'products-panel',
      role: 'group',
      tabIndex: -1,
    });
    expect(navigationMenuContentAttributes({ openValue: 'company', value: 'products' })).toEqual({
      'data-state': 'closed',
      hidden: true,
      role: 'group',
      tabIndex: -1,
    });
    expect(
      navigationMenuLinkAttributes({
        activeValue: 'company',
        href: '/company',
        itemValue: 'company',
        items: navigationItems,
      }),
    ).toEqual({
      'data-highlighted': '',
      'data-state': 'active',
      href: '/company',
      tabIndex: 0,
      value: 'company',
    });
    expect(
      navigationMenuLinkAttributes({
        href: '/solutions',
        itemValue: 'solutions',
        items: navigationItems,
      }),
    ).toEqual({
      'aria-disabled': 'true',
      'data-disabled': '',
      'data-state': 'inactive',
      tabIndex: -1,
      value: 'solutions',
    });
    expect(navigationMenuViewportAttributes({ id: 'nav-viewport', openValue: 'products' })).toEqual(
      {
        'data-state': 'open',
        id: 'nav-viewport',
      },
    );
    expect(navigationMenuIndicatorAttributes()).toEqual({
      'data-state': 'closed',
      hidden: true,
    });
    expect(navigationMenuItemHighlighted({ activeValue: 'company', itemValue: 'company' })).toBe(
      true,
    );
    expect(navigationMenuItemOpen({ itemValue: 'products', openValue: 'products' })).toBe(true);
  });

  it('neutralizes a dangerous link href scheme via safeUrl (SECURITY_FINDINGS.md H3)', () => {
    expect(
      navigationMenuLinkAttributes({
        href: 'javascript:alert(document.cookie)',
        itemValue: 'evil',
      }).href,
    ).toBe('#');
    // allowlisted/relative hrefs are preserved unchanged.
    expect(
      navigationMenuLinkAttributes({ href: 'https://example.com/a', itemValue: 'ok' }).href,
    ).toBe('https://example.com/a');
    expect(navigationMenuLinkAttributes({ href: '/cart', itemValue: 'cart' }).href).toBe('/cart');
    // no href supplied → attribute omitted entirely (undefined semantics).
    expect('href' in navigationMenuLinkAttributes({ itemValue: 'none' })).toBe(false);
  });

  it('dispatches cancelable open and select details before committing state', () => {
    const seen: string[] = [];
    const openResult = setNavigationMenuOpenValue(
      { items: navigationItems },
      'products',
      'programmatic',
      {
        onOpenChange(detail) {
          seen.push(`open:${detail.reason}:${detail.value}`);
        },
      },
    );
    const selectResult = selectNavigationMenuLink(
      { items: navigationItems, openValue: 'products' },
      'company',
      'programmatic',
      {
        onOpenChange(detail) {
          seen.push(`open:${detail.reason}:${detail.value}`);
        },
        onSelect(detail) {
          seen.push(`select:${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(openResult).toMatchObject({ changed: true, openValue: 'products' });
    expect(selectResult).toMatchObject({ selected: true, value: 'company' });
    expect(selectResult.open).toMatchObject({ changed: true, openValue: undefined });
    expect(seen).toEqual([
      'open:programmatic:products',
      'select:programmatic:company',
      'open:link-select:undefined',
    ]);
  });

  it('keeps previous state when open or select changes are prevented', () => {
    const openResult = toggleNavigationMenuOpenValue({}, 'products', 'trigger-click', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });
    const selectResult = selectNavigationMenuLink(
      { openValue: 'products' },
      'company',
      'link-click',
      {
        onSelect(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(openResult.changed).toBe(false);
    expect(openResult.openValue).toBeUndefined();
    expect(openResult.detail?.defaultPrevented).toBe(true);
    expect(selectResult.selected).toBe(false);
    expect(selectResult.open.openValue).toBe('products');
    expect(selectResult.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled, item-disabled, or unchanged states', () => {
    let callCount = 0;
    const options = {
      onOpenChange() {
        callCount += 1;
      },
      onSelect() {
        callCount += 1;
      },
    };

    expect(
      setNavigationMenuOpenValue({ disabled: true }, 'products', 'programmatic', options),
    ).toEqual({
      changed: false,
      openValue: undefined,
    });
    expect(
      setNavigationMenuOpenValue({ openValue: 'products' }, 'products', 'programmatic', options),
    ).toEqual({
      changed: false,
      openValue: 'products',
    });
    expect(
      selectNavigationMenuLink(
        { items: navigationItems, openValue: 'products' },
        'solutions',
        'programmatic',
        options,
      ),
    ).toEqual({
      open: { changed: false, openValue: 'products' },
      selected: false,
      value: 'solutions',
    });
    expect(callCount).toBe(0);
  });

  it('moves through enabled items with shared keyboard navigation', () => {
    expect(
      navigationMenuMove({ activeValue: 'products', items: navigationItems }, 'ArrowRight'),
    ).toEqual({
      activeIndex: 1,
      activeValue: 'pricing',
    });
    expect(navigationMenuMove({ activeValue: 'company', items: navigationItems }, 'Home')).toEqual({
      activeIndex: 0,
      activeValue: 'products',
    });
    expect(
      navigationMenuMove(
        { activeValue: 'products', dir: 'rtl', items: navigationItems },
        'ArrowLeft',
      ),
    ).toEqual({
      activeIndex: 1,
      activeValue: 'pricing',
    });
    expect(
      navigationMenuMove({ disabled: true, items: navigationItems }, 'ArrowRight'),
    ).toBeUndefined();
    expect(navigationMenuMove({ items: navigationItems }, 'Enter')).toBeUndefined();
  });

  it('uses shared typeahead helpers to find enabled navigation items', () => {
    const first = navigationMenuTypeahead(
      { activeValue: 'products', items: navigationItems },
      'r',
      {
        now: 100,
      },
    );
    const second = navigationMenuTypeahead(
      { activeValue: 'products', items: navigationItems },
      'c',
      {
        now: 900,
        state: first.state,
      },
    );

    expect(first).toMatchObject({ activeIndex: 3, activeValue: 'resources' });
    expect(second).toMatchObject({ activeIndex: 4, activeValue: 'company' });
    expect(second.state.buffer).toBe('c');
  });

  it('cycles enabled navigation items when typeahead repeats the same key', () => {
    const first = navigationMenuTypeahead(
      { activeValue: 'products', items: navigationItems },
      'p',
      {
        now: 100,
      },
    );
    const second = navigationMenuTypeahead(
      { activeValue: 'pricing', items: navigationItems },
      'p',
      {
        now: 300,
        state: first.state,
      },
    );

    expect(first).toMatchObject({ activeIndex: 1, activeValue: 'pricing' });
    expect(first.state.buffer).toBe('p');
    expect(second).toMatchObject({ activeIndex: 0, activeValue: 'products' });
    expect(second.state.buffer).toBe('p');
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const clickEvent = new Event('click', { cancelable: true });
    clickEvent.preventDefault();
    const pointerEvent = new Event('pointerenter', { cancelable: true });
    pointerEvent.preventDefault();
    const focusEvent = new Event('focus', { cancelable: true });
    focusEvent.preventDefault();
    const linkEvent = new Event('click', { cancelable: true });
    linkEvent.preventDefault();
    const keyEvent = keydownEvent('Escape');
    keyEvent.preventDefault();

    const options = {
      onOpenChange() {
        throw new Error('open should not dispatch after defaultPrevented');
      },
      onSelect() {
        throw new Error('select should not dispatch after defaultPrevented');
      },
    };

    expect(
      navigationMenuTriggerClick(clickEvent, { itemValue: 'products' }, options),
    ).toBeUndefined();
    expect(
      navigationMenuTriggerPointerEnter(
        pointerEvent,
        { contentId: 'products-panel', itemValue: 'products' },
        options,
      ),
    ).toBeUndefined();
    expect(
      navigationMenuTriggerFocus(
        focusEvent,
        { contentId: 'products-panel', itemValue: 'products' },
        options,
      ),
    ).toBeUndefined();
    expect(
      navigationMenuLinkClick(linkEvent, { itemValue: 'company', openValue: 'products' }, options),
    ).toBeUndefined();
    expect(navigationMenuKeyDown(keyEvent, { openValue: 'products' }, options)).toBeUndefined();
  });

  it('uses handler reasons and prevents native actions when disabled or canceled', () => {
    const reasons: string[] = [];
    const triggerResult = navigationMenuTriggerClick(
      new Event('click', { cancelable: true }),
      { contentId: 'products-panel', itemValue: 'products' },
      {
        onOpenChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(triggerResult).toMatchObject({ changed: true, openValue: 'products' });
    expect(reasons).toEqual(['trigger-click']);

    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = navigationMenuTriggerClick(disabledEvent, {
      disabled: true,
      itemValue: 'products',
    });
    expect(disabledResult).toEqual({ changed: false, openValue: undefined });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const pointerResult = navigationMenuTriggerPointerEnter(
      new Event('pointerenter', { cancelable: true }),
      {
        contentId: 'company-panel',
        itemValue: 'company',
        openValue: 'products',
      },
    );
    expect(pointerResult).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'trigger-pointer-enter', value: 'company' }),
      openValue: 'company',
    });

    const focusResult = navigationMenuTriggerFocus(new Event('focus', { cancelable: true }), {
      contentId: 'products-panel',
      itemValue: 'products',
    });
    expect(focusResult).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'trigger-focus', value: 'products' }),
      openValue: 'products',
    });

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = navigationMenuLinkClick(
      canceledEvent,
      { itemValue: 'company', openValue: 'products' },
      {
        onSelect(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledResult?.selected).toBe(false);
    expect(canceledResult?.open.openValue).toBe('products');
    expect(canceledEvent.defaultPrevented).toBe(true);

    const escapeEvent = keydownEvent('Escape');
    expect(navigationMenuKeyDown(escapeEvent, { openValue: 'products' })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'escape-key', value: undefined }),
      openValue: undefined,
    });
    expect(escapeEvent.defaultPrevented).toBe(true);

    const arrowEvent = keydownEvent('ArrowDown');
    expect(
      navigationMenuKeyDown(arrowEvent, {
        activeValue: 'products',
        items: navigationItems,
      }),
    ).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'trigger-keyboard', value: 'products' }),
      openValue: 'products',
    });
    expect(arrowEvent.defaultPrevented).toBe(true);
    expect(navigationMenuKeyDown(keydownEvent('Enter'), { openValue: 'products' })).toBeUndefined();
  });

  it('opens trigger content from Enter or Space keyboard activation only for content items', () => {
    const enterEvent = keydownEvent('Enter');
    expect(
      navigationMenuKeyDown(enterEvent, {
        activeValue: 'products',
        items: navigationItems,
      }),
    ).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'trigger-keyboard', value: 'products' }),
      openValue: 'products',
    });
    expect(enterEvent.defaultPrevented).toBe(true);

    const spaceEvent = keydownEvent(' ');
    expect(
      navigationMenuKeyDown(spaceEvent, {
        activeValue: 'products',
        items: navigationItems,
      }),
    ).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'trigger-keyboard', value: 'products' }),
      openValue: 'products',
    });
    expect(spaceEvent.defaultPrevented).toBe(true);

    const legacySpaceEvent = keydownEvent('Spacebar');
    expect(
      navigationMenuKeyDown(legacySpaceEvent, {
        activeValue: 'products',
        items: navigationItems,
      }),
    ).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'trigger-keyboard', value: 'products' }),
      openValue: 'products',
    });
    expect(legacySpaceEvent.defaultPrevented).toBe(true);

    const linkEvent = keydownEvent('Enter');
    expect(
      navigationMenuKeyDown(linkEvent, {
        activeValue: 'pricing',
        items: navigationItems,
      }),
    ).toBeUndefined();
    expect(linkEvent.defaultPrevented).toBe(false);

    const disabledEvent = keydownEvent('Enter');
    expect(
      navigationMenuKeyDown(disabledEvent, {
        activeValue: 'solutions',
        items: navigationItems,
      }),
    ).toEqual({ changed: false, openValue: undefined });
    expect(disabledEvent.defaultPrevented).toBe(false);
  });

  it('prevents native trigger activation when keyboard open is unchanged or canceled', () => {
    const unchangedEvent = keydownEvent('Enter');
    expect(
      navigationMenuKeyDown(unchangedEvent, {
        activeValue: 'products',
        items: navigationItems,
        openValue: 'products',
      }),
    ).toEqual({ changed: false, openValue: 'products' });
    expect(unchangedEvent.defaultPrevented).toBe(true);

    const canceledEvent = keydownEvent(' ');
    expect(
      navigationMenuKeyDown(
        canceledEvent,
        {
          activeValue: 'products',
          items: navigationItems,
        },
        {
          onOpenChange(detail) {
            detail.preventDefault();
          },
        },
      ),
    ).toMatchObject({
      changed: false,
      detail: expect.objectContaining({
        defaultPrevented: true,
        reason: 'trigger-keyboard',
        value: 'products',
      }),
      openValue: undefined,
    });
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('focuses navigation menu elements through delegated event ownerDocument access', () => {
    let focusCount = 0;
    const ownerDocument = {
      getElementById(id: string) {
        return id === 'products-trigger'
          ? {
              focus() {
                focusCount += 1;
              },
            }
          : undefined;
      },
    };
    const directEvent = {
      currentTarget: {
        ownerDocument,
      },
    } as Event & {
      currentTarget: {
        ownerDocument: typeof ownerDocument;
      };
    };
    const delegatedEvent = {
      currentTarget: null,
      target: {
        ownerDocument,
      },
    } as Event & {
      currentTarget: null;
      target: {
        ownerDocument: typeof ownerDocument;
      };
    };

    expect(navigationMenuFocusElement(directEvent, 'products-trigger')).toBe(true);
    expect(navigationMenuFocusElement(delegatedEvent, 'products-trigger')).toBe(true);
    expect(navigationMenuFocusElement(directEvent, 'missing')).toBe(false);
    expect(focusCount).toBe(2);
  });

  it('can defer navigation menu focus until after reactive state bindings commit', () => {
    let deferredFocusCount = 0;
    const scheduled: Array<() => void> = [];
    const event = {
      target: {
        ownerDocument: {
          getElementById(id: string) {
            return id === 'docs-link'
              ? {
                  focus() {
                    deferredFocusCount += 1;
                  },
                }
              : undefined;
          },
        },
      },
    } as Event & {
      target: {
        ownerDocument: {
          getElementById(id: string): unknown;
        };
      };
    };

    expect(
      navigationMenuFocusElement(event, 'docs-link', {
        defer: true,
        schedule(callback) {
          scheduled.push(callback);
        },
      }),
    ).toBe(true);
    expect(deferredFocusCount).toBe(0);

    scheduled.forEach((callback) => callback());
    expect(deferredFocusCount).toBe(1);
  });

  it('exports navigation-menu helpers from package and primitives barrels', () => {
    expect(exportedNavigationMenuContentAttributes).toBe(navigationMenuContentAttributes);
    expect(exportedNavigationMenuFocusElement).toBe(navigationMenuFocusElement);
    expect(exportedNavigationMenuIndicatorAttributes).toBe(navigationMenuIndicatorAttributes);
    expect(exportedNavigationMenuItemAttributes).toBe(navigationMenuItemAttributes);
    expect(exportedNavigationMenuItemHighlighted).toBe(navigationMenuItemHighlighted);
    expect(exportedNavigationMenuItemOpen).toBe(navigationMenuItemOpen);
    expect(exportedNavigationMenuKeyDown).toBe(navigationMenuKeyDown);
    expect(exportedNavigationMenuLinkAttributes).toBe(navigationMenuLinkAttributes);
    expect(exportedNavigationMenuLinkClick).toBe(navigationMenuLinkClick);
    expect(exportedNavigationMenuListAttributes).toBe(navigationMenuListAttributes);
    expect(exportedNavigationMenuMove).toBe(navigationMenuMove);
    expect(exportedNavigationMenuRootAttributes).toBe(navigationMenuRootAttributes);
    expect(exportedNavigationMenuTriggerAttributes).toBe(navigationMenuTriggerAttributes);
    expect(exportedNavigationMenuTriggerClick).toBe(navigationMenuTriggerClick);
    expect(exportedNavigationMenuTriggerFocus).toBe(navigationMenuTriggerFocus);
    expect(exportedNavigationMenuTriggerPointerEnter).toBe(navigationMenuTriggerPointerEnter);
    expect(exportedNavigationMenuTypeahead).toBe(navigationMenuTypeahead);
    expect(exportedNavigationMenuViewportAttributes).toBe(navigationMenuViewportAttributes);
    expect(exportedSelectNavigationMenuLink).toBe(selectNavigationMenuLink);
    expect(exportedSetNavigationMenuOpenValue).toBe(setNavigationMenuOpenValue);
    expect(exportedToggleNavigationMenuOpenValue).toBe(toggleNavigationMenuOpenValue);
    expect(primitiveNavigationMenuRootAttributes).toBe(navigationMenuRootAttributes);
  });
});

function keydownEvent(key: string): Event & { readonly key: string } {
  return Object.assign(new Event('keydown', { cancelable: true }), { key });
}
