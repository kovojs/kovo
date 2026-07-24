import { scheduleDeferred } from '../lib/deferred-scheduler.js';

/** Finite string projection for primitive reducer values that may be scalar or string arrays. */
export function browserDataString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.every((entry) => typeof entry === 'string') ? value.join(',') : '';
}

/**
 * Finite scalar projection of a keyboard event for compiler-reviewed handlers.
 *
 * SPEC.md §4.3/§5.2 keeps the native event capability inside framework-owned code rather than
 * allowing app-authored member dispatch through a synthetic event.
 */
export function browserEventKey(event: Event): string {
  const key = (event as KeyboardEvent).key;
  return typeof key === 'string' ? key : '';
}

/** Finite string projection of an event target's form-control value. */
export function browserEventTargetValue(event: Event): string {
  const value = (event.target as { value?: unknown } | null)?.value;
  return typeof value === 'string' ? value : '';
}

/** Finite boolean projection of an event target's checked state. */
export function browserEventTargetChecked(event: Event, fallback = false): boolean {
  const checked = (event.target as { checked?: unknown } | null)?.checked;
  return typeof checked === 'boolean' ? checked : !fallback;
}

/** Finite validity projection for native form controls. */
export function browserEventTargetValid(event: Event): boolean {
  const target = event.target as { checkValidity?: unknown } | null;
  return typeof target?.checkValidity === 'function' ? target.checkValidity() : true;
}

/** Framework-owned event cancellation operation. */
export function browserEventPreventDefault(event: Event): boolean {
  if (!event.cancelable) return false;
  event.preventDefault();
  return true;
}

/**
 * Focus one statically identified element through the event's owner document.
 *
 * Returning only a boolean keeps the DOM authority inside this reviewed operation.
 */
export function browserEventFocusElement(
  event: Event,
  id: string | undefined,
  options: { defer?: boolean } = {},
): boolean {
  if (!id) return false;
  const eventTarget = event.target as {
    closest?: (selector: string) => { querySelector?: (selector: string) => Element | null } | null;
    ownerDocument?: Document;
  } | null;
  const ownerDocumentTarget = (
    (event.currentTarget as { ownerDocument?: Document } | null)?.ownerDocument ??
    eventTarget?.ownerDocument
  )?.getElementById(id);
  const target = (ownerDocumentTarget ?? eventTarget?.closest?.('*')?.querySelector?.(`#${id}`)) as
    | {
        focus?: () => void;
      }
    | null
    | undefined;
  if (typeof target?.focus !== 'function') return false;
  const focus = target.focus.bind(target);
  if (options.defer === true) {
    scheduleDeferred(focus);
  } else {
    focus();
  }
  return true;
}

/** Focus a bounded indexed element without exposing target lookup to authored code. */
export function browserEventFocusIndexedElement(
  event: Event,
  prefix: string,
  index: number | undefined,
): boolean {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 255) {
    return false;
  }
  return browserEventFocusElement(event, `${prefix}${index}`);
}
