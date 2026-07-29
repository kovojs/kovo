import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import {
  Combobox,
  ComboboxInput,
  ComboboxListbox,
  ComboboxOption,
  ComboboxValue,
} from './combobox.js';

const items = [
  { label: 'Design', value: 'design' },
  { disabled: true, label: 'Archive', value: 'archive' },
] as const;

describe('@kovojs/ui Combobox StyleX slots', () => {
  it('renders headless combobox attrs with StyleX slot classes', () => {
    const state = {
      highlightedValue: 'design',
      items,
      listboxId: 'team-listbox',
      open: true,
      placeholder: 'Choose team',
      value: 'design',
    };

    expect({
      input: renderUiComponent(ComboboxInput, {
        ...state,
        descriptionId: 'team-help',
        errorId: 'team-error',
        id: 'team-input',
        labelledBy: 'team-label',
        name: 'team',
      }),
      listbox: renderUiComponent(ComboboxListbox, {
        ...state,
        children: 'options',
        id: 'team-listbox',
        labelledBy: 'team-input',
      }),
      option: renderUiComponent(ComboboxOption, {
        ...state,
        itemValue: 'design',
      }),
      root: renderUiComponent(Combobox, {
        ...state,
        children: 'combobox body',
        id: 'team-combobox',
        invalid: true,
        required: true,
      }),
      value: renderUiComponent(ComboboxValue, {
        ...state,
        id: 'team-value',
      }),
    }).toMatchSnapshot();
  });

  it('accepts author-last StyleX slot overrides', () => {
    const overrides = style.create({
      input: {
        backgroundColor: '#dbeafe',
        color: '#1d4ed8',
      },
      listbox: {
        backgroundColor: '#111827',
      },
      option: {
        color: '#1d4ed8',
      },
      root: {
        color: '#1d4ed8',
      },
      value: {
        color: '#1d4ed8',
      },
    });

    expect({
      input: renderUiComponent(ComboboxInput, {
        styles: { input: overrides.input },
      }),
      listbox: renderUiComponent(ComboboxListbox, {
        children: 'options',
        styles: { listbox: overrides.listbox },
      }),
      option: renderUiComponent(ComboboxOption, {
        itemValue: 'design',
        styles: { option: overrides.option },
      }),
      root: renderUiComponent(Combobox, {
        children: 'combobox body',
        styles: { root: overrides.root },
      }),
      value: renderUiComponent(ComboboxValue, {
        styles: { value: overrides.value },
        value: 'design',
      }),
    }).toMatchSnapshot();
  });
});
