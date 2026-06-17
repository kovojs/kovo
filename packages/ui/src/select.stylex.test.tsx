import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Select,
  SelectContent,
  SelectHiddenInput,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectClasses,
  selectContentClasses,
  selectHiddenInputClasses,
  selectItemClasses,
  selectStyles,
  selectTriggerClasses,
  selectValueClasses,
} from './select.js';

const items = [
  { label: 'Design', value: 'design' },
  { disabled: true, label: 'Archive', value: 'archive' },
] as const;

describe('@kovojs/ui Select StyleX slots', () => {
  it('renders headless select attrs with StyleX slot classes', () => {
    const state = {
      highlightedValue: 'design',
      items,
      listboxId: 'team-listbox',
      open: true,
      placeholder: 'Choose team',
      value: 'design',
    };

    expect({
      classes: selectClasses,
      content: SelectContent.definition.render({
        ...state,
        children: 'options',
        id: 'team-listbox',
        labelledBy: 'team-trigger',
      }),
      contentClasses: selectContentClasses,
      hiddenInput: SelectHiddenInput.definition.render({
        ...state,
        form: 'team-form',
        id: 'team-hidden',
        name: 'team',
      }),
      hiddenInputClasses: selectHiddenInputClasses,
      item: SelectItem.definition.render({
        ...state,
        itemValue: 'design',
      }),
      itemClasses: selectItemClasses,
      root: Select.definition.render({
        ...state,
        children: 'select body',
        id: 'team-select',
        invalid: true,
        required: true,
      }),
      trigger: SelectTrigger.definition.render({
        ...state,
        children: 'Design',
        descriptionId: 'team-help',
        errorId: 'team-error',
        id: 'team-trigger',
        labelledBy: 'team-label',
      }),
      triggerClasses: selectTriggerClasses,
      value: SelectValue.definition.render({
        ...state,
        id: 'team-value',
      }),
      valueClasses: selectValueClasses,
    }).toMatchSnapshot();
  });

  it('accepts author-last StyleX slot overrides', () => {
    const overrides = style.create(
      {
        content: {
          backgroundColor: '#111827',
        },
        hiddenInput: {
          opacity: 0,
        },
        item: {
          color: '#1d4ed8',
        },
        root: {
          color: '#1d4ed8',
        },
        trigger: {
          backgroundColor: '#dbeafe',
          color: '#1d4ed8',
        },
        value: {
          color: '#1d4ed8',
        },
      },
      { namespace: 'appSelect', source: 'app-select.tsx' },
    );

    expect({
      content: SelectContent.definition.render({
        children: 'options',
        styles: { content: overrides.content },
      }),
      hiddenInput: SelectHiddenInput.definition.render({
        name: 'team',
        styles: { hiddenInput: overrides.hiddenInput },
        value: 'design',
      }),
      item: SelectItem.definition.render({
        itemValue: 'design',
        styles: { item: overrides.item },
      }),
      root: Select.definition.render({
        children: 'select body',
        styles: { root: overrides.root },
      }),
      trigger: SelectTrigger.definition.render({
        children: 'Design',
        styles: { trigger: overrides.trigger },
      }),
      value: SelectValue.definition.render({
        styles: { value: overrides.value },
        value: 'design',
      }),
    }).toMatchSnapshot();
  });

  it('exports StyleX slot objects instead of variant helpers', () => {
    expect({
      contentMarker: selectStyles.content.$$css,
      hiddenInputMarker: selectStyles.hiddenInput.$$css,
      itemMarker: selectStyles.item.$$css,
      keys: Object.keys(selectStyles),
      rootMarker: selectStyles.root.$$css,
      triggerMarker: selectStyles.trigger.$$css,
      valueMarker: selectStyles.value.$$css,
    }).toMatchSnapshot();
  });
});
