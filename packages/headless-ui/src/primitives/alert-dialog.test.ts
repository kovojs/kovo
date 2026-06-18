import { describe, expect, it } from 'vitest';

import {
  alertDialogActionAttributes as exportedAlertDialogActionAttributes,
  alertDialogActionClick as exportedAlertDialogActionClick,
  alertDialogBeforeToggle as exportedAlertDialogBeforeToggle,
  alertDialogCancel as exportedAlertDialogCancel,
  alertDialogCancelAttributes as exportedAlertDialogCancelAttributes,
  alertDialogCancelClick as exportedAlertDialogCancelClick,
  alertDialogContentAttributes as exportedAlertDialogContentAttributes,
  alertDialogRootAttributes as exportedAlertDialogRootAttributes,
  alertDialogTriggerAttributes as exportedAlertDialogTriggerAttributes,
  alertDialogTriggerClick as exportedAlertDialogTriggerClick,
  setAlertDialogOpen as exportedSetAlertDialogOpen,
  toggleAlertDialog as exportedToggleAlertDialog,
} from './alert-dialog.js';
import {
  alertDialogActionAttributes,
  alertDialogActionClick,
  alertDialogBeforeToggle,
  alertDialogCancel,
  alertDialogCancelAttributes,
  alertDialogCancelClick,
  alertDialogContentAttributes,
  alertDialogRootAttributes,
  alertDialogTriggerAttributes,
  alertDialogTriggerClick,
  setAlertDialogOpen,
  toggleAlertDialog,
} from './alert-dialog.js';

describe('headless-ui alert-dialog primitive', () => {
  it('builds root, trigger, content, cancel, and action attributes for native dialog wiring', () => {
    expect(alertDialogRootAttributes({ open: true })).toEqual({
      'data-state': 'open',
    });
    expect(alertDialogRootAttributes({ disabled: true, open: false })).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(alertDialogTriggerAttributes({ contentId: 'delete-account', open: true })).toEqual({
      'aria-controls': 'delete-account',
      'aria-expanded': 'true',
      'aria-haspopup': 'dialog',
      command: 'show-modal',
      commandfor: 'delete-account',
      'data-state': 'open',
      disabled: false,
      type: 'button',
    });
    expect(
      alertDialogTriggerAttributes({ contentId: 'delete-account', disabled: true, open: false }),
    ).toEqual({
      'aria-expanded': 'false',
      'aria-haspopup': 'dialog',
      'data-disabled': '',
      'data-state': 'closed',
      disabled: true,
      type: 'button',
    });

    expect(
      alertDialogContentAttributes({
        contentId: 'delete-account',
        descriptionId: 'delete-description',
        open: true,
        titleId: 'delete-title',
      }),
    ).toEqual({
      'aria-describedby': 'delete-description',
      'aria-labelledby': 'delete-title',
      'aria-modal': 'true',
      'data-state': 'open',
      id: 'delete-account',
      open: true,
      role: 'alertdialog',
    });
    expect(alertDialogContentAttributes({ contentId: 'delete-account', open: false })).toEqual({
      'aria-modal': 'true',
      'data-state': 'closed',
      id: 'delete-account',
      open: false,
      role: 'alertdialog',
    });
    expect(
      alertDialogContentAttributes({ contentId: 'delete-account', open: true }),
    ).not.toHaveProperty('closedby');

    expect(
      alertDialogCancelAttributes({
        autoFocus: true,
        contentId: 'delete-account',
        open: true,
      }),
    ).toEqual({
      autofocus: true,
      command: 'request-close',
      commandfor: 'delete-account',
      'data-intent': 'cancel',
      'data-state': 'open',
      disabled: false,
      type: 'button',
    });
    expect(
      alertDialogActionAttributes({
        contentId: 'delete-account',
        intent: 'destructive',
        open: true,
      }),
    ).toEqual({
      command: 'request-close',
      commandfor: 'delete-account',
      'data-intent': 'destructive',
      'data-state': 'open',
      disabled: false,
      type: 'button',
    });
  });

  it('dispatches a cancelable open change detail before committing state', () => {
    const seen: string[] = [];
    const result = setAlertDialogOpen({ open: false }, true, 'programmatic', {
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
    const result = toggleAlertDialog({ open: false }, 'trigger-click', {
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
      setAlertDialogOpen({ disabled: true, open: false }, true, 'programmatic', {
        onOpenChange,
      }),
    ).toEqual({ changed: false, open: false });
    expect(setAlertDialogOpen({ open: true }, true, 'programmatic', { onOpenChange })).toEqual({
      changed: false,
      open: true,
    });
    expect(callCount).toBe(0);
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = alertDialogTriggerClick(
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

  it('uses trigger, cancel, and action click change reasons', () => {
    const reasons: string[] = [];
    const options = {
      onOpenChange(detail: { reason: string; value: boolean }) {
        reasons.push(`${detail.reason}:${detail.value}`);
      },
    };

    const openResult = alertDialogTriggerClick(
      new Event('click', { cancelable: true }),
      { open: false },
      options,
    );
    const cancelResult = alertDialogCancelClick(
      new Event('click', { cancelable: true }),
      { open: true },
      options,
    );
    const actionResult = alertDialogActionClick(
      new Event('click', { cancelable: true }),
      { open: true },
      options,
    );

    expect(openResult).toMatchObject({ changed: true, open: true });
    expect(cancelResult).toMatchObject({ changed: true, open: false });
    expect(actionResult).toMatchObject({ changed: true, open: false });
    expect(reasons).toEqual(['trigger-click:true', 'cancel-click:false', 'action-click:false']);
  });

  it('falls back to dialog invoker methods without enabling alert light-dismiss', () => {
    const calls: string[] = [];
    const dialog = {
      open: false,
      requestClose() {
        calls.push('requestClose');
        this.open = false;
      },
      showModal() {
        calls.push('showModal');
        this.open = true;
      },
    };
    const ownerDocument = {
      getElementById(id: string) {
        return id === 'delete-account' ? dialog : undefined;
      },
    };
    const triggerEvent = invokerEvent('show-modal', ownerDocument);
    const cancelEvent = invokerEvent('request-close', ownerDocument);
    const actionEvent = invokerEvent('request-close', ownerDocument);

    expect(alertDialogTriggerClick(triggerEvent, { open: false })).toMatchObject({
      changed: true,
      open: true,
    });
    expect(alertDialogCancelClick(cancelEvent, { open: true })).toMatchObject({
      changed: true,
      open: false,
    });
    expect(alertDialogActionClick(actionEvent, { open: true })).toMatchObject({
      changed: true,
      open: false,
    });

    expect(calls).toEqual(['showModal', 'requestClose', 'requestClose']);
    expect(triggerEvent.defaultPrevented).toBe(true);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(actionEvent.defaultPrevented).toBe(true);
  });

  it('prevents native invoker behavior when disabled or canceled', () => {
    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = alertDialogTriggerClick(disabledEvent, {
      disabled: true,
      open: false,
    });

    expect(disabledResult).toEqual({ changed: false, open: false });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = alertDialogActionClick(
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
    const cancelResult = alertDialogCancel(
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
    const openResult = alertDialogBeforeToggle(
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
    expect(alertDialogBeforeToggle(beforeToggleEvent(undefined), { open: true })).toBeUndefined();
  });

  it('prevents native cancel and beforetoggle when disabled or canceled', () => {
    const disabledCancel = new Event('cancel', { cancelable: true });
    const disabledCancelResult = alertDialogCancel(disabledCancel, {
      disabled: true,
      open: true,
    });

    expect(disabledCancelResult).toEqual({ changed: false, open: true });
    expect(disabledCancel.defaultPrevented).toBe(true);

    const canceledToggle = beforeToggleEvent('closed', true);
    const canceledToggleResult = alertDialogBeforeToggle(
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
    expect(Object.isFrozen(alertDialogRootAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(alertDialogTriggerAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(alertDialogContentAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(alertDialogCancelAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(alertDialogActionAttributes({ open: true }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedAlertDialogActionAttributes).toBe(alertDialogActionAttributes);
    expect(exportedAlertDialogActionClick).toBe(alertDialogActionClick);
    expect(exportedAlertDialogBeforeToggle).toBe(alertDialogBeforeToggle);
    expect(exportedAlertDialogCancel).toBe(alertDialogCancel);
    expect(exportedAlertDialogCancelAttributes).toBe(alertDialogCancelAttributes);
    expect(exportedAlertDialogCancelClick).toBe(alertDialogCancelClick);
    expect(exportedAlertDialogContentAttributes).toBe(alertDialogContentAttributes);
    expect(exportedAlertDialogRootAttributes).toBe(alertDialogRootAttributes);
    expect(exportedAlertDialogTriggerAttributes).toBe(alertDialogTriggerAttributes);
    expect(exportedAlertDialogTriggerClick).toBe(alertDialogTriggerClick);
    expect(exportedSetAlertDialogOpen).toBe(setAlertDialogOpen);
    expect(exportedToggleAlertDialog).toBe(toggleAlertDialog);
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

function invokerEvent(command: string, ownerDocument: { getElementById(id: string): unknown }) {
  const button = {
    getAttribute(name: string) {
      if (name === 'command') return command;
      if (name === 'commandfor') return 'delete-account';
      return null;
    },
    ownerDocument,
  };
  return {
    currentTarget: button,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    target: button,
  } as Event & {
    currentTarget: typeof button;
    defaultPrevented: boolean;
    preventDefault(): void;
    target: typeof button;
  };
}
