import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Select,
  SelectContent,
  SelectHiddenInput,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectStyles,
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

    const rendered = {
      classes: [style.attrs(selectStyles.root).class ?? ''] as const,
      content: SelectContent.definition.render({
        ...state,
        children: 'options',
        id: 'team-listbox',
        labelledBy: 'team-trigger',
      }),
      contentClasses: [style.attrs(selectStyles.content).class ?? ''] as const,
      hiddenInput: SelectHiddenInput.definition.render({
        ...state,
        form: 'team-form',
        id: 'team-hidden',
        name: 'team',
      }),
      hiddenInputClasses: [style.attrs(selectStyles.hiddenInput).class ?? ''] as const,
      item: SelectItem.definition.render({
        ...state,
        itemValue: 'design',
      }),
      itemClasses: [style.attrs(selectStyles.item).class ?? ''] as const,
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
      triggerClasses: [style.attrs(selectStyles.trigger).class ?? ''] as const,
      value: SelectValue.definition.render({
        ...state,
        id: 'team-value',
      }),
      valueClasses: [style.attrs(selectStyles.value).class ?? ''] as const,
    };

    expect(rendered.classes[0]).toContain('kv-select');
    expect(rendered.content).toContain('aria-labelledby="team-trigger"');
    expect(rendered.content).toContain('role="listbox"');
    expect(rendered.hiddenInput).toContain('form="team-form" id="team-hidden"');
    expect(rendered.item).toContain('aria-selected="true"');
    expect(rendered.item).toContain('data-highlighted=""');
    expect(rendered.item).toContain('id="team-listbox-option-0"');
    expect(rendered.root).toContain('data-invalid="" data-required="" data-state="open"');
    expect(rendered.trigger).toContain('aria-activedescendant="team-listbox-option-0"');
    expect(rendered.trigger).toContain('aria-controls="team-listbox"');
    expect(rendered.trigger).toContain('id="team-trigger" role="combobox" type="button"');
    expect(rendered.triggerClasses[0]).toContain('kv-select');
    expect(rendered.value).toContain('id="team-value">Design</span>');
    expect(rendered.valueClasses[0]).toContain('kv-select');
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

    const rendered = {
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
    };

    expect(rendered.content).toContain('data-style-src="select.tsx#content; app-select.tsx#content"');
    expect(rendered.hiddenInput).toContain(
      'data-style-src="select.tsx#hiddenInput; app-select.tsx#hiddenInput"',
    );
    expect(rendered.item).toContain('data-style-src="select.tsx#item; app-select.tsx#item"');
    expect(rendered.root).toContain('data-style-src="select.tsx#root; app-select.tsx#root"');
    expect(rendered.trigger).toContain(
      'data-style-src="select.tsx#trigger; app-select.tsx#trigger"',
    );
    expect(rendered.trigger).toContain('role="combobox" type="button"');
    expect(rendered.value).toContain('data-style-src="select.tsx#value; app-select.tsx#value"');
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
    }).toEqual({
      contentMarker: true,
      hiddenInputMarker: true,
      itemMarker: true,
      keys: ['content', 'hiddenInput', 'item', 'root', 'trigger', 'value'],
      rootMarker: true,
      triggerMarker: true,
      valueMarker: true,
    });
  });
});
