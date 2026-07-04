import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

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
      input: AutocompleteInput.definition.render({
        ...state,
        autocomplete: 'off',
        descriptionId: 'team-help',
        errorId: 'team-error',
        id: 'team-input',
        labelledBy: 'team-label',
        name: 'team',
      }),
      list: AutocompleteList.definition.render({
        ...state,
        children: 'options',
        id: 'team-list',
        labelledBy: 'team-input',
      }),
      option: AutocompleteOption.definition.render({
        ...state,
        itemValue: 'design',
      }),
      root: Autocomplete.definition.render({
        ...state,
        children: 'autocomplete body',
        id: 'team-autocomplete',
        invalid: true,
        required: true,
      }),
      value: AutocompleteValue.definition.render({
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
      input: AutocompleteInput.definition.render({
        styles: { input: overrides.input },
      }),
      list: AutocompleteList.definition.render({
        children: 'options',
        styles: { list: overrides.list },
      }),
      option: AutocompleteOption.definition.render({
        itemValue: 'design',
        styles: { option: overrides.option },
      }),
      root: Autocomplete.definition.render({
        children: 'autocomplete body',
        styles: { root: overrides.root },
      }),
      value: AutocompleteValue.definition.render({
        styles: { value: overrides.value },
        value: 'design',
      }),
    }).toMatchSnapshot();
  });
});
