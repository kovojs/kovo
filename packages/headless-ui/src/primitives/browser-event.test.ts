import { describe, expect, it, vi } from 'vitest';

import {
  browserDataString,
  browserEventFocusElement,
  browserEventKey,
  browserEventPreventDefault,
  browserEventTargetChecked,
  browserEventTargetValid,
  browserEventTargetValue,
} from './browser-event.js';

describe('finite browser event helpers', () => {
  it('projects only scalar event and target data', () => {
    const event = Object.assign(new Event('input', { cancelable: true }), {
      key: 'ArrowDown',
    });
    Object.defineProperty(event, 'target', {
      value: { checked: true, checkValidity: () => false, value: 'kovo' },
    });

    expect(browserEventKey(event)).toBe('ArrowDown');
    expect(browserEventTargetValue(event)).toBe('kovo');
    expect(browserEventTargetChecked(event, false)).toBe(true);
    expect(browserEventTargetValid(event)).toBe(false);
    expect(browserEventPreventDefault(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(browserDataString(['billing'])).toBe('billing');
    expect(browserDataString([() => undefined])).toBe('');
  });

  it('focuses a static id without returning DOM authority', () => {
    const focus = vi.fn();
    const event = new Event('keydown');
    Object.defineProperty(event, 'target', {
      value: {
        closest: () => ({
          querySelector: (selector: string) =>
            selector === '#gallery-target' ? { focus } : undefined,
        }),
      },
    });

    expect(browserEventFocusElement(event, 'gallery-target')).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    expect(browserEventFocusElement(event, undefined)).toBe(false);
  });
});
