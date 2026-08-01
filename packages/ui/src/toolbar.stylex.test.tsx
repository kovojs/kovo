import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { Toolbar, ToolbarButton, ToolbarItem } from './toolbar.js';

const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'link' }] as const;

describe('@kovojs/ui Toolbar StyleX slots', () => {
  it('renders headless toolbar attrs with StyleX slot classes', () => {
    const state = {
      activeValue: 'bold',
      items,
      orientation: 'vertical' as const,
    };

    expect({
      button: renderUiComponent(ToolbarButton, {
        ...state,
        children: 'Bold',
        id: 'bold-button',
        itemValue: 'bold',
        pressed: true,
      }),
      disabledButton: renderUiComponent(ToolbarButton, {
        ...state,
        children: 'Link',
        itemValue: 'link',
        pressed: false,
      }),
      item: renderUiComponent(ToolbarItem, {
        ...state,
        children: 'bold button',
        id: 'bold-item',
        itemValue: 'bold',
      }),
      root: renderUiComponent(Toolbar, {
        ...state,
        children: 'format controls',
        descriptionId: 'format-help',
        id: 'formatting-toolbar',
        labelledBy: 'format-label',
      }),
    }).toMatchSnapshot();
  });

  it('accepts author-last StyleX slot overrides', () => {
    const state = {
      activeValue: 'bold',
      items,
    };
    const overrides = createWithSource('toolbar.stylex.test.tsx')({
      button: {
        backgroundColor: '#dbeafe',
        color: '#1d4ed8',
      },
      item: {
        minWidth: 120,
      },
      root: {
        backgroundColor: '#111827',
        color: '#f9fafb',
      },
    });

    expect({
      button: renderUiComponent(ToolbarButton, {
        ...state,
        children: 'Bold',
        itemValue: 'bold',
        pressed: true,
        styles: { button: overrides.button },
      }),
      item: renderUiComponent(ToolbarItem, {
        ...state,
        children: 'Bold',
        itemValue: 'bold',
        styles: { item: overrides.item },
      }),
      root: renderUiComponent(Toolbar, {
        ...state,
        children: 'format controls',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });
});
