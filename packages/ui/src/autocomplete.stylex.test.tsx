import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteList,
  AutocompleteOption,
  AutocompleteValue,
  autocompleteStyles,
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
      classes: [style.attrs(autocompleteStyles.root).class ?? ''] as const,
      input: AutocompleteInput.definition.render({
        ...state,
        autocomplete: 'off',
        descriptionId: 'team-help',
        errorId: 'team-error',
        id: 'team-input',
        labelledBy: 'team-label',
        name: 'team',
      }),
      inputClasses: [style.attrs(autocompleteStyles.input).class ?? ''] as const,
      list: AutocompleteList.definition.render({
        ...state,
        children: 'options',
        id: 'team-list',
        labelledBy: 'team-input',
      }),
      listClasses: [style.attrs(autocompleteStyles.list).class ?? ''] as const,
      option: AutocompleteOption.definition.render({
        ...state,
        itemValue: 'design',
      }),
      optionClasses: [style.attrs(autocompleteStyles.option).class ?? ''] as const,
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
      valueClasses: [style.attrs(autocompleteStyles.value).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('accepts author-last StyleX slot overrides', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appAutocomplete', source: 'app-autocomplete.tsx' },
    );

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

  it('exports StyleX slot objects instead of variant helpers', () => {
    expect({
      inputMarker: autocompleteStyles.input.$$css,
      keys: Object.keys(autocompleteStyles),
      listMarker: autocompleteStyles.list.$$css,
      optionMarker: autocompleteStyles.option.$$css,
      rootMarker: autocompleteStyles.root.$$css,
      valueMarker: autocompleteStyles.value.$$css,
    }).toMatchSnapshot();
  });
});
