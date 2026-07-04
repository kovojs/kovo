import { describe, expect, it } from 'vitest';
import * as style from '@kovojs/style';
import {
  Select,
  SelectContent,
  SelectHiddenInput,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
      content: String(
        SelectContent.definition.render({
          ...state,
          children: 'options',
          id: 'team-listbox',
          labelledBy: 'team-trigger',
        }),
      ),
      hiddenInput: String(
        SelectHiddenInput.definition.render({
          ...state,
          form: 'team-form',
          id: 'team-hidden',
          name: 'team',
        }),
      ),
      item: String(
        SelectItem.definition.render({
          ...state,
          itemValue: 'design',
        }),
      ),
      root: String(
        Select.definition.render({
          ...state,
          children: 'select body',
          id: 'team-select',
          invalid: true,
          required: true,
        }),
      ),
      trigger: String(
        SelectTrigger.definition.render({
          ...state,
          children: 'Design',
          descriptionId: 'team-help',
          errorId: 'team-error',
          id: 'team-trigger',
          labelledBy: 'team-label',
        }),
      ),
      value: String(
        SelectValue.definition.render({
          ...state,
          id: 'team-value',
        }),
      ),
    };
    expect(rendered.root).toContain('class="kv-select');
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
    expect(rendered.value).toContain('id="team-value">Design</span>');
  });
  it('accepts author-last StyleX slot overrides', () => {
    const overrides = style.create({
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
    });
    const rendered = {
      content: String(
        SelectContent.definition.render({
          children: 'options',
          styles: { content: overrides.content },
        }),
      ),
      hiddenInput: String(
        SelectHiddenInput.definition.render({
          name: 'team',
          styles: { hiddenInput: overrides.hiddenInput },
          value: 'design',
        }),
      ),
      item: String(
        SelectItem.definition.render({
          itemValue: 'design',
          styles: { item: overrides.item },
        }),
      ),
      root: String(
        Select.definition.render({
          children: 'select body',
          styles: { root: overrides.root },
        }),
      ),
      trigger: String(
        SelectTrigger.definition.render({
          children: 'Design',
          styles: { trigger: overrides.trigger },
        }),
      ),
      value: String(
        SelectValue.definition.render({
          styles: { value: overrides.value },
          value: 'design',
        }),
      ),
    };
    expect(rendered.content).toContain(
      'data-style-src="select.tsx#content; select.stylex.test.tsx#content"',
    );
    expect(rendered.hiddenInput).toContain(
      'data-style-src="select.tsx#hiddenInput; select.stylex.test.tsx#hiddenInput"',
    );
    expect(rendered.item).toContain(
      'data-style-src="select.tsx#item; select.stylex.test.tsx#item"',
    );
    expect(rendered.root).toContain(
      'data-style-src="select.tsx#root; select.stylex.test.tsx#root"',
    );
    expect(rendered.trigger).toContain(
      'data-style-src="select.tsx#trigger; select.stylex.test.tsx#trigger"',
    );
    expect(rendered.trigger).toContain('role="combobox" type="button"');
    expect(rendered.value).toContain(
      'data-style-src="select.tsx#value; select.stylex.test.tsx#value"',
    );
  });
});
