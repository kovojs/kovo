import { dispatchCancelableChange, type PrimitiveChangeDetail } from './change-details.js';

/** Shared state read by cancelable openable primitives. */
export interface OpenableState {
  disabled?: boolean | undefined;
  open: boolean;
}

/** Generic result shape returned by openable-state transitions. */
export interface OpenableChangeResult<Reason extends string> {
  changed: boolean;
  detail?: PrimitiveChangeDetail<Reason, boolean>;
  open: boolean;
}

/** Options for a cancelable set-open transition. */
export interface SetOpenStateOptions<Reason extends string> {
  onOpenChange?: ((detail: PrimitiveChangeDetail<Reason, boolean>) => void) | undefined;
}

/** Native beforetoggle-like event shape shared by popover/dialog primitives. */
export type OpenableBeforeToggleEvent = Event &
  Readonly<{
    newState?: 'closed' | 'open';
  }>;

/** Hook points used by openable event handlers after a transition is accepted. */
export interface OpenableInteractionHooks<Result> {
  onChanged?: (result: Result) => void;
  preventWhenUnchanged?: boolean;
}

/**
 * SPEC.md §4.6: primitive handlers are chained after author handlers, so the
 * state core preserves cancelable author hooks before native/default behavior.
 */
export function setOpenState<Reason extends string>(
  state: OpenableState,
  open: boolean,
  reason: Reason,
  options: SetOpenStateOptions<Reason> = {},
): OpenableChangeResult<Reason> {
  if (state.disabled || state.open === open) {
    return { changed: false, open: state.open };
  }

  const detail = dispatchCancelableChange({ reason, value: open }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, open: state.open };
  }

  return { changed: true, detail, open };
}

export function toggleOpenState<Reason extends string>(
  state: OpenableState,
  reason: Reason,
  options: SetOpenStateOptions<Reason> = {},
): OpenableChangeResult<Reason> {
  return setOpenState(state, !state.open, reason, options);
}

export function openStateFromBeforeToggle(event: OpenableBeforeToggleEvent): boolean | undefined {
  if (event.newState === 'open') return true;
  if (event.newState === 'closed') return false;
  return undefined;
}

export function applyOpenableInteraction<Result extends { changed: boolean }>(
  event: Event,
  result: Result,
  hooks: OpenableInteractionHooks<Result> = {},
): Result {
  if (result.changed) {
    hooks.onChanged?.(result);
  } else if (hooks.preventWhenUnchanged === true) {
    event.preventDefault();
  }

  return result;
}
