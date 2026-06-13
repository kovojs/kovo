import { describe, expect, it } from 'vitest';

import {
  toolbarButtonAttributes as exportedToolbarButtonAttributes,
  toolbarItemAttributes as exportedToolbarItemAttributes,
  toolbarKeyDown as exportedToolbarKeyDown,
  toolbarMoveFocus as exportedToolbarMoveFocus,
  toolbarRootAttributes as exportedToolbarRootAttributes,
  toolbarRovingIndex as exportedToolbarRovingIndex,
} from '../index.js';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarKeyDown,
  toolbarMoveFocus,
  toolbarRootAttributes,
  toolbarRovingIndex,
  type ToolbarItem,
} from './toolbar.js';

const editorItems: readonly ToolbarItem[] = Object.freeze([
  { value: 'bold' },
  { disabled: true, value: 'italic' },
  { value: 'link' },
]);

describe('headless-ui toolbar primitive', () => {
  it('builds root attributes for native toolbar semantics', () => {
    expect(
      toolbarRootAttributes({
        descriptionId: 'formatting-help',
        id: 'formatting',
        label: 'Formatting',
      }),
    ).toEqual({
      'aria-describedby': 'formatting-help',
      'aria-label': 'Formatting',
      'data-orientation': 'horizontal',
      id: 'formatting',
      role: 'toolbar',
    });

    expect(
      toolbarRootAttributes({
        disabled: true,
        labelledBy: 'insert-label',
        orientation: 'vertical',
      }),
    ).toEqual({
      'aria-disabled': 'true',
      'aria-labelledby': 'insert-label',
      'aria-orientation': 'vertical',
      'data-disabled': '',
      'data-orientation': 'vertical',
      role: 'toolbar',
    });
  });

  it('builds item and native button attributes with roving tabindex', () => {
    expect(
      toolbarItemAttributes({
        activeValue: 'bold',
        id: 'bold-item',
        itemValue: 'bold',
        items: editorItems,
      }),
    ).toEqual({
      id: 'bold-item',
    });

    expect(
      toolbarButtonAttributes({
        activeValue: 'bold',
        id: 'bold-button',
        itemValue: 'bold',
        items: editorItems,
        pressed: true,
      }),
    ).toEqual({
      'aria-pressed': 'true',
      'data-pressed': 'true',
      disabled: false,
      id: 'bold-button',
      tabIndex: 0,
      type: 'button',
      value: 'bold',
    });

    expect(
      toolbarButtonAttributes({
        activeValue: 'bold',
        itemValue: 'italic',
        items: editorItems,
        pressed: false,
      }),
    ).toEqual({
      'data-disabled': '',
      'data-pressed': 'false',
      disabled: true,
      'aria-pressed': 'false',
      tabIndex: -1,
      type: 'button',
      value: 'italic',
    });
  });

  it('chooses the first enabled item when active value is missing or disabled', () => {
    expect(toolbarRovingIndex({ activeValue: 'missing', items: editorItems })).toBe(0);
    expect(toolbarRovingIndex({ activeValue: 'italic', items: editorItems })).toBe(0);
    expect(toolbarRovingIndex({ items: [{ disabled: true, value: 'only' }] })).toBe(-1);
  });

  it('moves focus with horizontal, vertical, and RTL keyboard maps', () => {
    expect(toolbarMoveFocus({ activeValue: 'bold', items: editorItems }, 'next')).toEqual({
      index: 2,
      value: 'link',
    });
    expect(
      toolbarMoveFocus({ activeValue: 'link', items: editorItems, loop: false }, 'next'),
    ).toEqual({
      index: 2,
      value: 'link',
    });

    const verticalEvent = toolbarKeyboardEvent('ArrowDown');
    expect(
      toolbarKeyDown(verticalEvent, {
        activeValue: 'bold',
        items: editorItems,
        orientation: 'vertical',
      }),
    ).toEqual({
      index: 2,
      value: 'link',
    });
    expect(verticalEvent.defaultPrevented).toBe(true);

    expect(
      toolbarKeyDown(toolbarKeyboardEvent('ArrowLeft'), {
        activeValue: 'bold',
        dir: 'rtl',
        items: editorItems,
      }),
    ).toEqual({
      index: 2,
      value: 'link',
    });
  });

  it('ignores keys outside the toolbar orientation', () => {
    const horizontalEvent = toolbarKeyboardEvent('ArrowDown');
    expect(toolbarKeyDown(horizontalEvent, { activeValue: 'bold', items: editorItems })).toBe(
      undefined,
    );
    expect(horizontalEvent.defaultPrevented).toBe(false);

    const verticalEvent = toolbarKeyboardEvent('ArrowRight');
    expect(
      toolbarKeyDown(verticalEvent, {
        activeValue: 'bold',
        items: editorItems,
        orientation: 'vertical',
      }),
    ).toBe(undefined);
    expect(verticalEvent.defaultPrevented).toBe(false);
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const event = toolbarKeyboardEvent('ArrowRight');
    event.preventDefault();

    expect(toolbarKeyDown(event, { activeValue: 'bold', items: editorItems })).toBeUndefined();
  });

  it('exports toolbar helpers from the package root', () => {
    expect(exportedToolbarRootAttributes).toBe(toolbarRootAttributes);
    expect(exportedToolbarItemAttributes).toBe(toolbarItemAttributes);
    expect(exportedToolbarButtonAttributes).toBe(toolbarButtonAttributes);
    expect(exportedToolbarRovingIndex).toBe(toolbarRovingIndex);
    expect(exportedToolbarMoveFocus).toBe(toolbarMoveFocus);
    expect(exportedToolbarKeyDown).toBe(toolbarKeyDown);
  });
});

function toolbarKeyboardEvent(key: string): Event & { readonly key: string } {
  return Object.assign(new Event('keydown', { cancelable: true }), { key });
}
