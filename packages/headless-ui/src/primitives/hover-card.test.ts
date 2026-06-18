import { describe, expect, it } from 'vitest';

import {
  hoverCardContentAttributes as exportedHoverCardContentAttributes,
  hoverCardContentBlur as exportedHoverCardContentBlur,
  hoverCardContentFocus as exportedHoverCardContentFocus,
  hoverCardContentPointerEnter as exportedHoverCardContentPointerEnter,
  hoverCardContentPointerLeave as exportedHoverCardContentPointerLeave,
  hoverCardEscapeKeyDown as exportedHoverCardEscapeKeyDown,
  hoverCardRootAttributes as exportedHoverCardRootAttributes,
  hoverCardTriggerAttributes as exportedHoverCardTriggerAttributes,
  hoverCardTriggerBlur as exportedHoverCardTriggerBlur,
  hoverCardTriggerFocus as exportedHoverCardTriggerFocus,
  hoverCardTriggerPointerEnter as exportedHoverCardTriggerPointerEnter,
  hoverCardTriggerPointerLeave as exportedHoverCardTriggerPointerLeave,
  setHoverCardOpen as exportedSetHoverCardOpen,
} from './hover-card.js';
import {
  hoverCardContentAttributes,
  hoverCardContentBlur,
  hoverCardContentFocus,
  hoverCardContentPointerEnter,
  hoverCardContentPointerLeave,
  hoverCardEscapeKeyDown,
  hoverCardRootAttributes,
  hoverCardTriggerAttributes,
  hoverCardTriggerBlur,
  hoverCardTriggerFocus,
  hoverCardTriggerPointerEnter,
  hoverCardTriggerPointerLeave,
  setHoverCardOpen,
} from './hover-card.js';

describe('headless-ui hover-card primitive', () => {
  it('builds root, trigger, and native manual popover content attributes', () => {
    expect(hoverCardRootAttributes({ open: true })).toEqual({
      'data-state': 'open',
    });
    expect(hoverCardRootAttributes({ disabled: true, open: false })).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(hoverCardTriggerAttributes({ contentId: 'profile-card', open: true })).toEqual({
      'data-state': 'open',
      'kovo-hover-card': 'profile-card',
    });
    expect(hoverCardTriggerAttributes({ contentId: 'profile-card', open: false })).toEqual({
      'data-state': 'closed',
      'kovo-hover-card': 'profile-card',
    });
    expect(
      hoverCardTriggerAttributes({ contentId: 'profile-card', disabled: true, open: false }),
    ).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(hoverCardContentAttributes({ contentId: 'profile-card', open: true })).toEqual({
      'data-state': 'open',
      hidden: false,
      id: 'profile-card',
      popover: 'manual',
    });
    expect(hoverCardContentAttributes({ contentId: 'profile-card', open: false })).toEqual({
      'data-state': 'closed',
      hidden: true,
      id: 'profile-card',
      popover: 'manual',
    });
  });

  it('dispatches a cancelable open change detail before committing state', () => {
    const seen: string[] = [];
    const result = setHoverCardOpen({ open: false }, true, 'programmatic', {
      onOpenChange(detail) {
        seen.push(`${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual(['programmatic:true']);
    expect(result.changed).toBe(true);
    expect(result.open).toBe(true);
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous state when a change detail is prevented', () => {
    const result = setHoverCardOpen({ open: false }, true, 'trigger-focus', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.open).toBe(false);
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled or unchanged states', () => {
    let callCount = 0;
    const onOpenChange = () => {
      callCount += 1;
    };

    expect(
      setHoverCardOpen({ disabled: true, open: false }, true, 'programmatic', {
        onOpenChange,
      }),
    ).toEqual({ changed: false, open: false });
    expect(setHoverCardOpen({ open: true }, true, 'programmatic', { onOpenChange })).toEqual({
      changed: false,
      open: true,
    });
    expect(callCount).toBe(0);
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const event = new Event('pointerenter', { cancelable: true });
    event.preventDefault();

    const result = hoverCardTriggerPointerEnter(
      event,
      { open: false },
      {
        onOpenChange() {
          throw new Error('change should not dispatch after defaultPrevented');
        },
      },
    );

    expect(result).toBeUndefined();
  });

  it('opens and closes from trigger pointer and focus handlers', () => {
    const reasons: string[] = [];
    const options = {
      onOpenChange(detail: { reason: string }) {
        reasons.push(detail.reason);
      },
    };

    expect(
      hoverCardTriggerPointerEnter(new Event('pointerenter'), { open: false }, options),
    ).toEqual(expect.objectContaining({ changed: true, open: true }));
    expect(
      hoverCardTriggerPointerLeave(new Event('pointerleave'), { open: true }, options),
    ).toEqual(expect.objectContaining({ changed: true, open: false }));
    expect(hoverCardTriggerFocus(new Event('focus'), { open: false }, options)).toEqual(
      expect.objectContaining({ changed: true, open: true }),
    );
    expect(hoverCardTriggerBlur(new Event('blur'), { open: true }, options)).toEqual(
      expect.objectContaining({ changed: true, open: false }),
    );
    expect(reasons).toEqual([
      'trigger-pointer-enter',
      'trigger-pointer-leave',
      'trigger-focus',
      'trigger-blur',
    ]);
  });

  it('opens and closes from content pointer and focus handlers', () => {
    const reasons: string[] = [];
    const options = {
      onOpenChange(detail: { reason: string }) {
        reasons.push(detail.reason);
      },
    };

    expect(
      hoverCardContentPointerEnter(new Event('pointerenter'), { open: false }, options),
    ).toEqual(expect.objectContaining({ changed: true, open: true }));
    expect(
      hoverCardContentPointerLeave(new Event('pointerleave'), { open: true }, options),
    ).toEqual(expect.objectContaining({ changed: true, open: false }));
    expect(hoverCardContentFocus(new Event('focus'), { open: false }, options)).toEqual(
      expect.objectContaining({ changed: true, open: true }),
    );
    expect(hoverCardContentBlur(new Event('blur'), { open: true }, options)).toEqual(
      expect.objectContaining({ changed: true, open: false }),
    );
    expect(reasons).toEqual([
      'content-pointer-enter',
      'content-pointer-leave',
      'content-focus',
      'content-blur',
    ]);
  });

  it('closes on Escape and ignores other keys', () => {
    const escapeEvent = keydownEvent('Escape');
    const result = hoverCardEscapeKeyDown(escapeEvent, { open: true });

    expect(result).toEqual(
      expect.objectContaining({
        changed: true,
        open: false,
      }),
    );
    expect(result?.detail?.reason).toBe('escape-key');
    expect(hoverCardEscapeKeyDown(keydownEvent('Enter'), { open: true })).toBeUndefined();
  });

  it('prevents default on Escape when closing is disabled or canceled', () => {
    const disabledEvent = keydownEvent('Escape', true);
    const disabledResult = hoverCardEscapeKeyDown(disabledEvent, {
      disabled: true,
      open: true,
    });

    expect(disabledResult).toEqual({ changed: false, open: true });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = keydownEvent('Escape', true);
    const canceledResult = hoverCardEscapeKeyDown(
      canceledEvent,
      { open: true },
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, open: true });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(hoverCardRootAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(hoverCardTriggerAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(hoverCardContentAttributes({ open: true }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedHoverCardContentAttributes).toBe(hoverCardContentAttributes);
    expect(exportedHoverCardContentBlur).toBe(hoverCardContentBlur);
    expect(exportedHoverCardContentFocus).toBe(hoverCardContentFocus);
    expect(exportedHoverCardContentPointerEnter).toBe(hoverCardContentPointerEnter);
    expect(exportedHoverCardContentPointerLeave).toBe(hoverCardContentPointerLeave);
    expect(exportedHoverCardEscapeKeyDown).toBe(hoverCardEscapeKeyDown);
    expect(exportedHoverCardRootAttributes).toBe(hoverCardRootAttributes);
    expect(exportedHoverCardTriggerAttributes).toBe(hoverCardTriggerAttributes);
    expect(exportedHoverCardTriggerBlur).toBe(hoverCardTriggerBlur);
    expect(exportedHoverCardTriggerFocus).toBe(hoverCardTriggerFocus);
    expect(exportedHoverCardTriggerPointerEnter).toBe(hoverCardTriggerPointerEnter);
    expect(exportedHoverCardTriggerPointerLeave).toBe(hoverCardTriggerPointerLeave);
    expect(exportedSetHoverCardOpen).toBe(setHoverCardOpen);
  });
});

function keydownEvent(key: string, cancelable = false): Event & Readonly<{ key: string }> {
  return Object.assign(new Event('keydown', { cancelable }), { key });
}
