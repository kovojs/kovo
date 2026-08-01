import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteList,
  AutocompleteOption,
  AutocompleteValue,
} from './autocomplete.js';

const items = [
  { label: 'Design', value: 'design' },
  { disabled: true, label: 'Archive', value: 'archive' },
] as const;

describe('@kovojs/ui Autocomplete StyleX slots', () => {
  it('renders headless autocomplete attrs with StyleX slot classes', () => {
    const state = {
      highlightedValue: 'design',
      inputValue: 'des',
      items,
      listId: 'team-list',
      open: true,
      placeholder: 'Choose team',
      value: 'design',
    };

    expect({
      input: renderUiComponent(AutocompleteInput, {
        ...state,
        autocomplete: 'off',
        descriptionId: 'team-help',
        errorId: 'team-error',
        id: 'team-input',
        labelledBy: 'team-label',
        name: 'team',
      }),
      list: renderUiComponent(AutocompleteList, {
        ...state,
        children: 'options',
        id: 'team-list',
        labelledBy: 'team-input',
      }),
      option: renderUiComponent(AutocompleteOption, {
        ...state,
        itemValue: 'design',
      }),
      root: renderUiComponent(Autocomplete, {
        ...state,
        children: 'autocomplete body',
        id: 'team-autocomplete',
        invalid: true,
        required: true,
      }),
      value: renderUiComponent(AutocompleteValue, {
        ...state,
        id: 'team-value',
      }),
    }).toMatchSnapshot();
  });

  it('accepts author-last StyleX slot overrides', () => {
    const overrides = createWithSource('autocomplete.stylex.test.tsx')({
      input: {
        backgroundColor: '#dbeafe',
        color: '#1d4ed8',
      },
      list: {
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
      input: renderUiComponent(AutocompleteInput, {
        styles: { input: overrides.input },
      }),
      list: renderUiComponent(AutocompleteList, {
        children: 'options',
        styles: { list: overrides.list },
      }),
      option: renderUiComponent(AutocompleteOption, {
        itemValue: 'design',
        styles: { option: overrides.option },
      }),
      root: renderUiComponent(Autocomplete, {
        children: 'autocomplete body',
        styles: { root: overrides.root },
      }),
      value: renderUiComponent(AutocompleteValue, {
        styles: { value: overrides.value },
        value: 'design',
      }),
    }).toMatchSnapshot();
  });
});
