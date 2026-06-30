import { describe, expect, it, vi } from 'vitest';

import {
  applyOpenableInteraction,
  openStateFromBeforeToggle,
  setOpenState,
  toggleOpenState,
} from './open-state.js';

describe('headless-ui open state core', () => {
  it('sets and toggles open state through cancelable change details', () => {
    const onOpenChange = vi.fn();

    expect(setOpenState({ open: false }, true, 'trigger-click', { onOpenChange })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'trigger-click', value: true }),
      open: true,
    });
    expect(toggleOpenState({ open: true }, 'escape-key', { onOpenChange })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'escape-key', value: false }),
      open: false,
    });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('returns unchanged state for disabled, redundant, and canceled transitions', () => {
    expect(setOpenState({ disabled: true, open: false }, true, 'trigger-click')).toEqual({
      changed: false,
      open: false,
    });
    expect(setOpenState({ open: true }, true, 'trigger-click')).toEqual({
      changed: false,
      open: true,
    });

    const canceled = setOpenState({ open: false }, true, 'trigger-click', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });
    expect(canceled.changed).toBe(false);
    expect(canceled.detail?.defaultPrevented).toBe(true);
    expect(canceled.open).toBe(false);
  });

  it('normalizes beforetoggle and applies interaction hooks', () => {
    const event = new Event('click', { cancelable: true });
    const onChanged = vi.fn();

    expect(openStateFromBeforeToggle({ ...event, newState: 'open' })).toBe(true);
    expect(openStateFromBeforeToggle({ ...event, newState: 'closed' })).toBe(false);
    expect(openStateFromBeforeToggle({ ...event, newState: undefined })).toBeUndefined();

    applyOpenableInteraction(event, { changed: false }, { preventWhenUnchanged: true });
    expect(event.defaultPrevented).toBe(true);

    applyOpenableInteraction(new Event('click'), { changed: true }, { onChanged });
    expect(onChanged).toHaveBeenCalledWith({ changed: true });
  });
});
