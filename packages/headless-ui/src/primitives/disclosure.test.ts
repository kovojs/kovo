import { describe, expect, it } from 'vitest';

import {
  disclosureContentAttributes,
  disclosureRootAttributes,
  disclosureTriggerAttributes,
  disclosureTriggerClick,
  setDisclosureOpen,
  toggleDisclosure,
} from './disclosure.js';

describe('headless-ui disclosure primitive', () => {
  it('builds root, trigger, and content attributes from shared state helpers', () => {
    expect(disclosureRootAttributes({ open: true })).toEqual({ 'data-state': 'open' });
    expect(disclosureRootAttributes({ disabled: true, open: false })).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(disclosureTriggerAttributes({ contentId: 'faq-panel', open: true })).toEqual({
      'aria-controls': 'faq-panel',
      'aria-expanded': 'true',
      'data-state': 'open',
      disabled: false,
      type: 'button',
    });

    expect(disclosureContentAttributes({ contentId: 'faq-panel', open: false })).toEqual({
      'data-state': 'closed',
      hidden: true,
      id: 'faq-panel',
    });
  });

  it('dispatches a cancelable open change detail before committing state', () => {
    const seen: string[] = [];
    const result = setDisclosureOpen({ open: false }, true, 'programmatic', {
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
    const result = toggleDisclosure({ open: false }, 'trigger-click', {
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
      setDisclosureOpen({ disabled: true, open: false }, true, 'programmatic', {
        onOpenChange,
      }),
    ).toEqual({ changed: false, open: false });
    expect(setDisclosureOpen({ open: true }, true, 'programmatic', { onOpenChange })).toEqual({
      changed: false,
      open: true,
    });
    expect(callCount).toBe(0);
  });

  it('guards the primitive trigger handler when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = disclosureTriggerClick(
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

  it('uses trigger-click as the handler change reason', () => {
    const reasons: string[] = [];
    const result = disclosureTriggerClick(
      new Event('click'),
      { open: false },
      {
        onOpenChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(result).toMatchObject({ changed: true, open: true });
    expect(reasons).toEqual(['trigger-click']);
  });
});
