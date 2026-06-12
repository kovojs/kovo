import { describe, expect, it } from 'vitest';

import {
  dialogBeforeToggle as exportedDialogBeforeToggle,
  dialogCancel as exportedDialogCancel,
  dialogCloseAttributes as exportedDialogCloseAttributes,
  dialogCloseClick as exportedDialogCloseClick,
  dialogContentAttributes as exportedDialogContentAttributes,
  dialogRootAttributes as exportedDialogRootAttributes,
  dialogTriggerAttributes as exportedDialogTriggerAttributes,
  dialogTriggerClick as exportedDialogTriggerClick,
  setDialogOpen as exportedSetDialogOpen,
  toggleDialog as exportedToggleDialog,
} from '../index.js';
import {
  dialogBeforeToggle,
  dialogCancel,
  dialogCloseAttributes,
  dialogCloseClick,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
  dialogTriggerClick,
  setDialogOpen,
  toggleDialog,
} from './dialog.js';

describe('headless-ui dialog primitive', () => {
  it('builds root, trigger, content, and close attributes for native dialog wiring', () => {
    expect(dialogRootAttributes({ open: true })).toEqual({
      'data-state': 'open',
    });
    expect(dialogRootAttributes({ disabled: true, open: false })).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(dialogTriggerAttributes({ contentId: 'cart-drawer', open: true })).toEqual({
      'aria-controls': 'cart-drawer',
      'aria-expanded': 'true',
      'aria-haspopup': 'dialog',
      command: 'show-modal',
      commandfor: 'cart-drawer',
      'data-state': 'open',
      disabled: false,
      type: 'button',
    });
    expect(dialogTriggerAttributes({ contentId: 'cart-drawer', open: false })).toEqual({
      'aria-controls': 'cart-drawer',
      'aria-expanded': 'false',
      'aria-haspopup': 'dialog',
      command: 'show-modal',
      commandfor: 'cart-drawer',
      'data-state': 'closed',
      disabled: false,
      type: 'button',
    });
    expect(
      dialogTriggerAttributes({ contentId: 'cart-drawer', disabled: true, open: false }),
    ).toEqual({
      'aria-expanded': 'false',
      'aria-haspopup': 'dialog',
      'data-disabled': '',
      'data-state': 'closed',
      disabled: true,
      type: 'button',
    });

    expect(
      dialogContentAttributes({
        contentId: 'cart-drawer',
        descriptionId: 'cart-description',
        open: true,
        titleId: 'cart-title',
      }),
    ).toEqual({
      'aria-describedby': 'cart-description',
      'aria-labelledby': 'cart-title',
      'data-state': 'open',
      id: 'cart-drawer',
      open: true,
    });
    expect(dialogContentAttributes({ contentId: 'cart-drawer', open: false })).toEqual({
      'data-state': 'closed',
      id: 'cart-drawer',
      open: false,
    });

    expect(dialogCloseAttributes({ contentId: 'cart-drawer', open: true })).toEqual({
      command: 'request-close',
      commandfor: 'cart-drawer',
      'data-state': 'open',
      disabled: false,
      type: 'button',
    });
  });

  it('dispatches a cancelable open change detail before committing state', () => {
    const seen: string[] = [];
    const result = setDialogOpen({ open: false }, true, 'programmatic', {
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
    const result = toggleDialog({ open: false }, 'trigger-click', {
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
      setDialogOpen({ disabled: true, open: false }, true, 'programmatic', {
        onOpenChange,
      }),
    ).toEqual({ changed: false, open: false });
    expect(setDialogOpen({ open: true }, true, 'programmatic', { onOpenChange })).toEqual({
      changed: false,
      open: true,
    });
    expect(callCount).toBe(0);
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = dialogTriggerClick(
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

  it('uses trigger-click and close-click as invoker handler change reasons', () => {
    const reasons: string[] = [];
    const openResult = dialogTriggerClick(
      new Event('click', { cancelable: true }),
      { open: false },
      {
        onOpenChange(detail) {
          reasons.push(`${detail.reason}:${detail.value}`);
        },
      },
    );
    const closeResult = dialogCloseClick(
      new Event('click', { cancelable: true }),
      { open: true },
      {
        onOpenChange(detail) {
          reasons.push(`${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(openResult).toMatchObject({ changed: true, open: true });
    expect(closeResult).toMatchObject({ changed: true, open: false });
    expect(reasons).toEqual(['trigger-click:true', 'close-click:false']);
  });

  it('prevents native invoker behavior when disabled or canceled', () => {
    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = dialogTriggerClick(disabledEvent, {
      disabled: true,
      open: false,
    });

    expect(disabledResult).toEqual({ changed: false, open: false });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = dialogCloseClick(
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

  it('syncs native cancel and beforetoggle transitions', () => {
    const reasons: string[] = [];
    const cancelEvent = new Event('cancel', { cancelable: true });
    const cancelResult = dialogCancel(
      cancelEvent,
      { open: true },
      {
        onOpenChange(detail) {
          reasons.push(`${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(cancelResult).toMatchObject({ changed: true, open: false });
    expect(cancelEvent.defaultPrevented).toBe(false);
    expect(reasons).toEqual(['cancel-event:false']);

    const openEvent = beforeToggleEvent('open', true);
    const openResult = dialogBeforeToggle(
      openEvent,
      { open: false },
      {
        onOpenChange(detail) {
          reasons.push(`${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(openResult).toMatchObject({ changed: true, open: true });
    expect(openEvent.defaultPrevented).toBe(false);
    expect(reasons).toEqual(['cancel-event:false', 'native-beforetoggle:true']);
    expect(dialogBeforeToggle(beforeToggleEvent(undefined), { open: true })).toBeUndefined();
  });

  it('prevents native cancel and beforetoggle when disabled or canceled', () => {
    const disabledCancel = new Event('cancel', { cancelable: true });
    const disabledCancelResult = dialogCancel(disabledCancel, {
      disabled: true,
      open: true,
    });

    expect(disabledCancelResult).toEqual({ changed: false, open: true });
    expect(disabledCancel.defaultPrevented).toBe(true);

    const canceledToggle = beforeToggleEvent('closed', true);
    const canceledToggleResult = dialogBeforeToggle(
      canceledToggle,
      { open: true },
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledToggleResult).toMatchObject({ changed: false, open: true });
    expect(canceledToggleResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledToggle.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(dialogRootAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(dialogTriggerAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(dialogContentAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(dialogCloseAttributes({ open: true }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedDialogBeforeToggle).toBe(dialogBeforeToggle);
    expect(exportedDialogCancel).toBe(dialogCancel);
    expect(exportedDialogCloseAttributes).toBe(dialogCloseAttributes);
    expect(exportedDialogCloseClick).toBe(dialogCloseClick);
    expect(exportedDialogContentAttributes).toBe(dialogContentAttributes);
    expect(exportedDialogRootAttributes).toBe(dialogRootAttributes);
    expect(exportedDialogTriggerAttributes).toBe(dialogTriggerAttributes);
    expect(exportedDialogTriggerClick).toBe(dialogTriggerClick);
    expect(exportedSetDialogOpen).toBe(setDialogOpen);
    expect(exportedToggleDialog).toBe(toggleDialog);
  });
});

function beforeToggleEvent(
  newState: 'closed' | 'open' | undefined,
  cancelable = false,
): Event & Readonly<{ newState?: 'closed' | 'open' }> {
  return Object.assign(
    new Event('beforetoggle', { cancelable }),
    newState === undefined ? {} : { newState },
  );
}
