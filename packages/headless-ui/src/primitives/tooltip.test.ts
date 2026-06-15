import { describe, expect, it } from 'vitest';

import {
  setTooltipOpen as exportedSetTooltipOpen,
  tooltipContentAttributes as exportedTooltipContentAttributes,
  tooltipEscapeKeyDown as exportedTooltipEscapeKeyDown,
  tooltipRootAttributes as exportedTooltipRootAttributes,
  tooltipTriggerAttributes as exportedTooltipTriggerAttributes,
  tooltipTriggerBlur as exportedTooltipTriggerBlur,
  tooltipTriggerFocus as exportedTooltipTriggerFocus,
  tooltipTriggerPointerEnter as exportedTooltipTriggerPointerEnter,
  tooltipTriggerPointerLeave as exportedTooltipTriggerPointerLeave,
} from '../index.js';
import {
  setTooltipOpen,
  tooltipContentAttributes,
  tooltipEscapeKeyDown,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
  tooltipTriggerBlur,
  tooltipTriggerFocus,
  tooltipTriggerPointerEnter,
  tooltipTriggerPointerLeave,
} from './tooltip.js';

describe('headless-ui tooltip primitive', () => {
  it('builds root, trigger, and tooltip content attributes', () => {
    expect(tooltipRootAttributes({ open: true })).toEqual({
      'data-state': 'open',
    });
    expect(tooltipRootAttributes({ disabled: true, open: false })).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(tooltipTriggerAttributes({ contentId: 'pricing-tip', open: true })).toEqual({
      'aria-describedby': 'pricing-tip',
      'data-state': 'open',
      'jiso-tooltip': 'pricing-tip',
    });
    expect(tooltipTriggerAttributes({ contentId: 'pricing-tip', open: false })).toEqual({
      'data-state': 'closed',
      'jiso-tooltip': 'pricing-tip',
    });
    expect(
      tooltipTriggerAttributes({ contentId: 'pricing-tip', disabled: true, open: false }),
    ).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(tooltipContentAttributes({ contentId: 'pricing-tip', open: true })).toEqual({
      'data-state': 'open',
      hidden: false,
      id: 'pricing-tip',
      role: 'tooltip',
    });
    expect(tooltipContentAttributes({ contentId: 'pricing-tip', open: false })).toEqual({
      'data-state': 'closed',
      hidden: true,
      id: 'pricing-tip',
      role: 'tooltip',
    });
  });

  it('dispatches a cancelable open change detail before committing state', () => {
    const seen: string[] = [];
    const result = setTooltipOpen({ open: false }, true, 'programmatic', {
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
    const result = setTooltipOpen({ open: false }, true, 'trigger-focus', {
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
      setTooltipOpen({ disabled: true, open: false }, true, 'programmatic', {
        onOpenChange,
      }),
    ).toEqual({ changed: false, open: false });
    expect(setTooltipOpen({ open: true }, true, 'programmatic', { onOpenChange })).toEqual({
      changed: false,
      open: true,
    });
    expect(callCount).toBe(0);
  });

  it('guards primitive trigger handlers when author behavior prevented default', () => {
    const event = new Event('pointerenter', { cancelable: true });
    event.preventDefault();

    const result = tooltipTriggerPointerEnter(
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

  it('opens and closes from trigger focus, blur, and pointer handlers', () => {
    const reasons: string[] = [];
    const options = {
      onOpenChange(detail: { reason: string }) {
        reasons.push(detail.reason);
      },
    };

    expect(tooltipTriggerPointerEnter(new Event('pointerenter'), { open: false }, options)).toEqual(
      expect.objectContaining({ changed: true, open: true }),
    );
    expect(tooltipTriggerPointerLeave(new Event('pointerleave'), { open: true }, options)).toEqual(
      expect.objectContaining({ changed: true, open: false }),
    );
    expect(tooltipTriggerFocus(new Event('focus'), { open: false }, options)).toEqual(
      expect.objectContaining({ changed: true, open: true }),
    );
    expect(tooltipTriggerBlur(new Event('blur'), { open: true }, options)).toEqual(
      expect.objectContaining({ changed: true, open: false }),
    );
    expect(reasons).toEqual([
      'trigger-pointer-enter',
      'trigger-pointer-leave',
      'trigger-focus',
      'trigger-blur',
    ]);
  });

  it('closes on Escape and ignores other keys', () => {
    const escapeEvent = keydownEvent('Escape');
    const result = tooltipEscapeKeyDown(escapeEvent, { open: true });

    expect(result).toEqual(
      expect.objectContaining({
        changed: true,
        open: false,
      }),
    );
    expect(result?.detail?.reason).toBe('escape-key');
    expect(tooltipEscapeKeyDown(keydownEvent('Enter'), { open: true })).toBeUndefined();
  });

  it('prevents default on Escape when closing is disabled or canceled', () => {
    const disabledEvent = keydownEvent('Escape', true);
    const disabledResult = tooltipEscapeKeyDown(disabledEvent, {
      disabled: true,
      open: true,
    });

    expect(disabledResult).toEqual({ changed: false, open: true });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = keydownEvent('Escape', true);
    const canceledResult = tooltipEscapeKeyDown(
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
    expect(Object.isFrozen(tooltipRootAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(tooltipTriggerAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(tooltipContentAttributes({ open: true }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedSetTooltipOpen).toBe(setTooltipOpen);
    expect(exportedTooltipContentAttributes).toBe(tooltipContentAttributes);
    expect(exportedTooltipEscapeKeyDown).toBe(tooltipEscapeKeyDown);
    expect(exportedTooltipRootAttributes).toBe(tooltipRootAttributes);
    expect(exportedTooltipTriggerAttributes).toBe(tooltipTriggerAttributes);
    expect(exportedTooltipTriggerBlur).toBe(tooltipTriggerBlur);
    expect(exportedTooltipTriggerFocus).toBe(tooltipTriggerFocus);
    expect(exportedTooltipTriggerPointerEnter).toBe(tooltipTriggerPointerEnter);
    expect(exportedTooltipTriggerPointerLeave).toBe(tooltipTriggerPointerLeave);
  });
});

function keydownEvent(key: string, cancelable = false): Event & Readonly<{ key: string }> {
  return Object.assign(new Event('keydown', { cancelable }), { key });
}
