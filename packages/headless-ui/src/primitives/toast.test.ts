import { describe, expect, it } from 'vitest';

import {
  dismissToast as exportedDismissToast,
  setToastOpen as exportedSetToastOpen,
  toastActionAttributes as exportedToastActionAttributes,
  toastActionClick as exportedToastActionClick,
  toastCloseAttributes as exportedToastCloseAttributes,
  toastCloseClick as exportedToastCloseClick,
  toastDescriptionAttributes as exportedToastDescriptionAttributes,
  toastDismissEvent as exportedToastDismissEvent,
  toastDismissEventName as exportedToastDismissEventName,
  toastDismissPayload as exportedToastDismissPayload,
  toastEscapeKeyDown as exportedToastEscapeKeyDown,
  toastEvents as exportedToastEvents,
  toastRootAttributes as exportedToastRootAttributes,
  toastShowEvent as exportedToastShowEvent,
  toastShowEventName as exportedToastShowEventName,
  toastShowPayload as exportedToastShowPayload,
  toastTitleAttributes as exportedToastTitleAttributes,
  toastViewportAttributes as exportedToastViewportAttributes,
} from '../index.js';
import {
  dismissToast as primitiveDismissToast,
  setToastOpen as primitiveSetToastOpen,
  toastActionAttributes as primitiveToastActionAttributes,
  toastActionClick as primitiveToastActionClick,
  toastCloseAttributes as primitiveToastCloseAttributes,
  toastCloseClick as primitiveToastCloseClick,
  toastDescriptionAttributes as primitiveToastDescriptionAttributes,
  toastDismissEvent as primitiveToastDismissEvent,
  toastDismissEventName as primitiveToastDismissEventName,
  toastDismissPayload as primitiveToastDismissPayload,
  toastEscapeKeyDown as primitiveToastEscapeKeyDown,
  toastEvents as primitiveToastEvents,
  toastRootAttributes as primitiveToastRootAttributes,
  toastShowEvent as primitiveToastShowEvent,
  toastShowEventName as primitiveToastShowEventName,
  toastShowPayload as primitiveToastShowPayload,
  toastTitleAttributes as primitiveToastTitleAttributes,
  toastViewportAttributes as primitiveToastViewportAttributes,
} from './index.js';
import {
  dismissToast,
  setToastOpen,
  toastActionAttributes,
  toastActionClick,
  toastCloseAttributes,
  toastCloseClick,
  toastDescriptionAttributes,
  toastDismissEvent,
  toastDismissEventName,
  toastDismissPayload,
  toastEscapeKeyDown,
  toastEvents,
  toastRootAttributes,
  toastShowEvent,
  toastShowEventName,
  toastShowPayload,
  toastTitleAttributes,
  toastViewportAttributes,
} from './toast.js';

describe('headless-ui toast primitive', () => {
  it('declares typed fire-and-forget toast events for the event registry', () => {
    expect(toastShowEventName).toBe('toast:show');
    expect(toastDismissEventName).toBe('toast:dismiss');
    expect(toastShowEvent).toEqual({ name: 'toast:show' });
    expect(toastDismissEvent).toEqual({ name: 'toast:dismiss' });
    expect(toastEvents).toEqual([{ name: 'toast:show' }, { name: 'toast:dismiss' }]);
  });

  it('normalizes toast event payloads without server fact declarations', () => {
    expect(
      toastShowPayload({
        actionLabel: 'Undo',
        actionValue: 'undo-upload',
        description: 'The file is in trash.',
        durationMs: 4999.6,
        id: 'upload-complete',
        politeness: 'assertive',
        title: 'Upload complete',
        variant: 'success',
      }),
    ).toEqual({
      actionLabel: 'Undo',
      actionValue: 'undo-upload',
      description: 'The file is in trash.',
      durationMs: 5000,
      id: 'upload-complete',
      politeness: 'assertive',
      title: 'Upload complete',
      variant: 'success',
    });
    expect(toastShowPayload({ durationMs: Number.NaN })).toEqual({ durationMs: 0 });
    expect(toastDismissPayload({ id: 'upload-complete', reason: 'timeout' })).toEqual({
      id: 'upload-complete',
      reason: 'timeout',
    });
  });

  it('builds fixed viewport and toast item attributes', () => {
    expect(
      toastViewportAttributes({
        id: 'toast-viewport',
        label: 'App notifications',
        placement: 'top-start',
      }),
    ).toEqual({
      'aria-label': 'App notifications',
      'data-placement': 'top-start',
      id: 'toast-viewport',
      role: 'region',
      tabIndex: -1,
    });
    expect(toastViewportAttributes({ disabled: true })).toEqual({
      'aria-label': 'Notifications',
      'data-disabled': '',
      'data-placement': 'bottom-end',
      role: 'region',
      tabIndex: -1,
    });

    expect(
      toastRootAttributes({
        descriptionId: 'upload-description',
        id: 'upload-toast',
        politeness: 'assertive',
        titleId: 'upload-title',
        variant: 'success',
      }),
    ).toEqual({
      'aria-atomic': 'true',
      'aria-describedby': 'upload-description',
      'aria-labelledby': 'upload-title',
      'aria-live': 'assertive',
      'data-state': 'open',
      'data-variant': 'success',
      id: 'upload-toast',
      role: 'alert',
    });
    expect(toastRootAttributes({ id: 'upload-toast', open: false })).toEqual({
      'aria-atomic': 'true',
      'aria-live': 'polite',
      'data-state': 'closed',
      'data-variant': 'default',
      hidden: true,
      id: 'upload-toast',
      role: 'status',
    });
  });

  it('builds title, description, action, and close attributes', () => {
    expect(toastTitleAttributes({ id: 'toast-title' })).toEqual({
      'data-part': 'title',
      id: 'toast-title',
    });
    expect(toastDescriptionAttributes({ id: 'toast-description' })).toEqual({
      'data-part': 'description',
      id: 'toast-description',
    });
    expect(toastActionAttributes({ actionValue: 'undo', id: 'upload-toast' })).toEqual({
      'data-action': '',
      'data-state': 'open',
      'data-variant': 'default',
      disabled: false,
      type: 'button',
      value: 'undo',
    });
    expect(
      toastActionAttributes({
        actionValue: 'keep-open',
        dismissOnAction: false,
        id: 'upload-toast',
      }),
    ).toEqual({
      'data-action': '',
      'data-dismiss-on-action': 'false',
      'data-state': 'open',
      'data-variant': 'default',
      disabled: false,
      type: 'button',
      value: 'keep-open',
    });
    expect(toastCloseAttributes({ disabled: true, id: 'upload-toast' })).toEqual({
      'data-disabled': '',
      'data-dismiss': '',
      'data-state': 'open',
      'data-variant': 'default',
      disabled: true,
      type: 'button',
    });
  });

  it('dispatches cancelable open changes before committing state', () => {
    const seen: string[] = [];
    const result = setToastOpen({ id: 'upload-toast', open: false }, true, 'programmatic', {
      onOpenChange(detail) {
        seen.push(`${detail.reason}:${detail.value.id}:${detail.value.open}`);
      },
    });

    expect(seen).toEqual(['programmatic:upload-toast:true']);
    expect(result.changed).toBe(true);
    expect(result.id).toBe('upload-toast');
    expect(result.open).toBe(true);
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous state when a change detail is prevented', () => {
    const result = dismissToast({ id: 'upload-toast' }, 'close-click', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.id).toBe('upload-toast');
    expect(result.open).toBe(true);
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled or unchanged states', () => {
    let callCount = 0;
    const onOpenChange = () => {
      callCount += 1;
    };

    expect(
      setToastOpen({ disabled: true, id: 'upload-toast' }, false, 'programmatic', {
        onOpenChange,
      }),
    ).toEqual({ changed: false, id: 'upload-toast', open: true });
    expect(
      setToastOpen({ id: 'upload-toast', open: false }, false, 'programmatic', {
        onOpenChange,
      }),
    ).toEqual({ changed: false, id: 'upload-toast', open: false });
    expect(callCount).toBe(0);
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = toastCloseClick(
      event,
      { id: 'upload-toast' },
      {
        onOpenChange() {
          throw new Error('change should not dispatch after defaultPrevented');
        },
      },
    );

    expect(result).toBeUndefined();
  });

  it('uses close, action, and escape change reasons', () => {
    const reasons: string[] = [];
    const options = {
      onOpenChange(detail: { reason: string; value: { open: boolean } }) {
        reasons.push(`${detail.reason}:${detail.value.open}`);
      },
    };

    expect(
      toastCloseClick(new Event('click', { cancelable: true }), { id: 'a' }, options),
    ).toMatchObject({ changed: true, open: false });
    expect(
      toastActionClick(new Event('click', { cancelable: true }), { id: 'b' }, options),
    ).toMatchObject({ changed: true, open: false });
    expect(toastEscapeKeyDown(keyEvent('Escape'), { id: 'c' }, options)).toMatchObject({
      changed: true,
      open: false,
    });
    expect(toastEscapeKeyDown(keyEvent('Enter'), { id: 'd' }, options)).toBeUndefined();
    expect(
      toastActionClick(
        new Event('click', { cancelable: true }),
        { id: 'e' },
        {
          ...options,
          dismissOnAction: false,
        },
      ),
    ).toEqual({ changed: false, id: 'e', open: true });
    expect(reasons).toEqual(['close-click:false', 'action-click:false', 'escape-key:false']);
  });

  it('prevents native button behavior when disabled or canceled', () => {
    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = toastCloseClick(disabledEvent, { disabled: true, id: 'toast' });
    expect(disabledResult).toEqual({ changed: false, id: 'toast', open: true });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = toastCloseClick(
      canceledEvent,
      { id: 'toast' },
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledResult).toMatchObject({ changed: false, open: true });
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen records', () => {
    expect(Object.isFrozen(toastShowEvent)).toBe(true);
    expect(Object.isFrozen(toastDismissEvent)).toBe(true);
    expect(Object.isFrozen(toastEvents)).toBe(true);
    expect(Object.isFrozen(toastShowPayload({ title: 'Saved' }))).toBe(true);
    expect(Object.isFrozen(toastDismissPayload({ id: 'saved' }))).toBe(true);
    expect(Object.isFrozen(toastViewportAttributes())).toBe(true);
    expect(Object.isFrozen(toastRootAttributes({ id: 'saved' }))).toBe(true);
    expect(Object.isFrozen(toastTitleAttributes())).toBe(true);
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedToastShowEventName).toBe(toastShowEventName);
    expect(exportedToastDismissEventName).toBe(toastDismissEventName);
    expect(exportedToastShowEvent).toBe(toastShowEvent);
    expect(exportedToastDismissEvent).toBe(toastDismissEvent);
    expect(exportedToastEvents).toBe(toastEvents);
    expect(exportedToastShowPayload).toBe(toastShowPayload);
    expect(exportedToastDismissPayload).toBe(toastDismissPayload);
    expect(exportedToastViewportAttributes).toBe(toastViewportAttributes);
    expect(exportedToastRootAttributes).toBe(toastRootAttributes);
    expect(exportedToastTitleAttributes).toBe(toastTitleAttributes);
    expect(exportedToastDescriptionAttributes).toBe(toastDescriptionAttributes);
    expect(exportedToastActionAttributes).toBe(toastActionAttributes);
    expect(exportedToastCloseAttributes).toBe(toastCloseAttributes);
    expect(exportedSetToastOpen).toBe(setToastOpen);
    expect(exportedDismissToast).toBe(dismissToast);
    expect(exportedToastCloseClick).toBe(toastCloseClick);
    expect(exportedToastActionClick).toBe(toastActionClick);
    expect(exportedToastEscapeKeyDown).toBe(toastEscapeKeyDown);

    expect(primitiveToastShowEventName).toBe(toastShowEventName);
    expect(primitiveToastDismissEventName).toBe(toastDismissEventName);
    expect(primitiveToastShowEvent).toBe(toastShowEvent);
    expect(primitiveToastDismissEvent).toBe(toastDismissEvent);
    expect(primitiveToastEvents).toBe(toastEvents);
    expect(primitiveToastShowPayload).toBe(toastShowPayload);
    expect(primitiveToastDismissPayload).toBe(toastDismissPayload);
    expect(primitiveToastViewportAttributes).toBe(toastViewportAttributes);
    expect(primitiveToastRootAttributes).toBe(toastRootAttributes);
    expect(primitiveToastTitleAttributes).toBe(toastTitleAttributes);
    expect(primitiveToastDescriptionAttributes).toBe(toastDescriptionAttributes);
    expect(primitiveToastActionAttributes).toBe(toastActionAttributes);
    expect(primitiveToastCloseAttributes).toBe(toastCloseAttributes);
    expect(primitiveSetToastOpen).toBe(setToastOpen);
    expect(primitiveDismissToast).toBe(dismissToast);
    expect(primitiveToastCloseClick).toBe(toastCloseClick);
    expect(primitiveToastActionClick).toBe(toastActionClick);
    expect(primitiveToastEscapeKeyDown).toBe(toastEscapeKeyDown);
  });
});

function keyEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}
