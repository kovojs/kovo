import { describe, expect, it } from 'vitest';

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
      input: ComboboxInput.definition.render({
        ...state,
        descriptionId: 'team-help',
        errorId: 'team-error',
        id: 'team-input',
        labelledBy: 'team-label',
        name: 'team',
      }),
      listbox: ComboboxListbox.definition.render({
        ...state,
        children: 'options',
        id: 'team-listbox',
        labelledBy: 'team-input',
      }),
      option: ComboboxOption.definition.render({
        ...state,
        itemValue: 'design',
      }),
      root: Combobox.definition.render({
        ...state,
        children: 'combobox body',
        id: 'team-combobox',
        invalid: true,
        required: true,
      }),
      value: ComboboxValue.definition.render({
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
      input: ComboboxInput.definition.render({
        styles: { input: overrides.input },
      }),
      listbox: ComboboxListbox.definition.render({
        children: 'options',
        styles: { listbox: overrides.listbox },
      }),
      option: ComboboxOption.definition.render({
        itemValue: 'design',
        styles: { option: overrides.option },
      }),
      root: Combobox.definition.render({
        children: 'combobox body',
        styles: { root: overrides.root },
      }),
      value: ComboboxValue.definition.render({
        styles: { value: overrides.value },
        value: 'design',
      }),
    }).toMatchSnapshot();
  });
});
