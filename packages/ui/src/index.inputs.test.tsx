import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  AutocompleteInput,
  AutocompleteList,
  AutocompleteOption,
  AutocompleteValue,
  autocompleteStyles,
} from './autocomplete.js';
import {
  ComboboxInput,
  ComboboxListbox,
  ComboboxOption,
  ComboboxValue,
  comboboxStyles,
} from './combobox.js';
import {
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from './scroll-area.js';
import {
  Select,
  SelectContent,
  SelectHiddenInput,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectStyles,
} from './select.js';
import {
  Slider,
  SliderInput,
  SliderRange,
  SliderThumb,
  SliderTrack,
  sliderStyles,
} from './slider.js';
import { Tabs, TabsList, TabsPanel, TabsTrigger } from './tabs.js';

describe('@kovojs/ui styled package foundation', () => {
  it('wraps the headless scroll-area primitive as styled native scrolling parts', () => {
    const state = {
      dir: 'ltr' as const,
      scrollbars: 'both' as const,
    };

    const root = ScrollArea.definition.render({
      ...state,
      children: 'viewport and scrollbars',
      id: 'activity',
    });
    const viewport = ScrollAreaViewport.definition.render({
      ...state,
      children: 'feed',
      descriptionId: 'activity-description',
      id: 'activity-viewport',
      labelledBy: 'activity-title',
      scrollX: 'none',
      scrollY: 'middle',
    });
    const verticalScrollbar = ScrollAreaScrollbar.definition.render({
      ...state,
      children: 'thumb',
      id: 'activity-scrollbar-y',
      orientation: 'vertical',
      scrollPosition: 'middle',
      visible: true,
    });
    const hiddenThumb = ScrollAreaThumb.definition.render({
      ...state,
      forceMount: true,
      id: 'activity-thumb-x',
      orientation: 'horizontal',
      scrollPosition: 'none',
      visible: false,
    });
    const corner = ScrollAreaCorner.definition.render({ ...state, id: 'activity-corner' });
    const disabledViewport = ScrollAreaViewport.definition.render({
      disabled: true,
      label: 'Archived feed',
      scrollbars: 'vertical',
    });

    expect(root).toContain('data-scrollbars="both" dir="ltr" id="activity"');
    expect(viewport).toContain('aria-describedby="activity-description"');
    expect(viewport).toContain('aria-labelledby="activity-title"');
    expect(viewport).toContain('data-scroll-x="none"');
    expect(viewport).toContain('data-scroll-y="middle"');
    expect(viewport).toContain('role="region" tabIndex="0"');
    expect(verticalScrollbar).toContain('aria-hidden="true"');
    expect(verticalScrollbar).toContain('data-orientation="vertical"');
    expect(verticalScrollbar).toContain('data-scroll-position="middle"');
    expect(verticalScrollbar).toContain('data-state="visible"');
    expect(hiddenThumb).toContain('data-orientation="horizontal"');
    expect(hiddenThumb).toContain('data-scroll-position="none"');
    expect(hiddenThumb).toContain('data-state="hidden"');
    expect(corner).toContain('id="activity-corner"');
    expect(disabledViewport).toContain('aria-disabled="true"');
    expect(disabledViewport).toContain('tabIndex="-1"');
  });

  it('wraps the headless select primitive as styled trigger, listbox, and hidden input markup', () => {
    const items = [
      { label: 'Starter', value: 'starter' },
      { label: 'Growth', value: 'growth' },
      { disabled: true, label: 'Enterprise', value: 'enterprise' },
    ];
    const state = {
      descriptionId: 'plan-help',
      errorId: 'plan-error',
      form: 'checkout-form',
      invalid: true,
      items,
      name: 'plan',
      required: true,
      value: 'growth',
    };

    const root = Select.definition.render({ ...state, children: 'select body', id: 'plan-root' });
    const trigger = SelectTrigger.definition.render({
      ...state,
      children: SelectContent.definition.render({
        ...state,
        children: items
          .map((item) =>
            SelectItem.definition.render({
              ...state,
              itemLabel: item.label,
              itemValue: item.value,
            }),
          )
          .join(''),
        label: 'Plans',
      }),
      id: 'plan',
      labelledBy: 'plan-label',
    });
    const hiddenInput = SelectHiddenInput.definition.render({ ...state, id: 'plan-hidden' });
    const value = SelectValue.definition.render({ ...state, id: 'plan-value' });
    expect(root).toContain('data-invalid="" data-required="" data-state="closed" id="plan-root"');
    expect(trigger).toContain('aria-describedby="plan-help plan-error"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain('aria-haspopup="listbox"');
    expect(trigger).toContain('aria-invalid="true"');
    expect(trigger).toContain('id="plan" type="button"');
    expect(trigger).toContain('role="listbox"');
    expect(trigger).toContain('aria-selected="true"');
    expect(trigger).toContain(
      'data-state="checked" id="select-option-1" label="Growth" role="option" value="growth"',
    );
    expect(trigger).toContain('aria-disabled="true"');
    expect(trigger).toContain('data-disabled="" data-state="unchecked"');
    expect(trigger).toContain('value="enterprise"');
    expect(trigger).not.toContain('<select');
    expect(trigger).not.toContain('<optgroup');
    expect(hiddenInput).toContain('form="checkout-form" id="plan-hidden"');
    expect(hiddenInput).toContain('name="plan" type="hidden" value="growth"');
    expect(hiddenInput).not.toContain('required');
    expect(value).toContain('id="plan-value">Growth</span>');
    expect({
      selectContentClasses: [style.attrs(selectStyles.content).class ?? ''] as const,
      selectItemClasses: [style.attrs(selectStyles.item).class ?? ''] as const,
      selectValueClasses: [style.attrs(selectStyles.value).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('wraps the headless combobox primitive as styled input and listbox markup', () => {
    const items = [
      { label: 'Ada Lovelace', value: 'ada' },
      { label: 'Grace Hopper', value: 'grace' },
      { disabled: true, label: 'Katherine Johnson', value: 'katherine' },
    ];
    const state = {
      descriptionId: 'assignee-help',
      form: 'assignee-form',
      highlightedValue: 'grace',
      items,
      listboxId: 'assignee-listbox',
      name: 'assignee',
      open: true,
      placeholder: 'Search people',
      required: true,
      value: 'ada',
    };

    const input = ComboboxInput.definition.render({
      ...state,
      id: 'assignee',
      labelledBy: 'assignee-label',
    });
    const listbox = ComboboxListbox.definition.render({
      ...state,
      children: items
        .map((item, index) =>
          ComboboxOption.definition.render({
            ...state,
            id: `assignee-listbox-option-${index}`,
            itemLabel: item.label,
            itemValue: item.value,
          }),
        )
        .join(''),
      id: 'assignee-listbox',
      labelledBy: 'assignee-label',
    });
    const value = ComboboxValue.definition.render({ ...state, id: 'assignee-value' });
    expect(input).toContain('aria-activedescendant="assignee-listbox-option-1"');
    expect(input).toContain('aria-autocomplete="list"');
    expect(input).toContain('aria-controls="assignee-listbox"');
    expect(input).toContain('aria-expanded="true"');
    expect(input).toContain('form="assignee-form"');
    expect(input).not.toContain('list="assignee-listbox"');
    expect(input).toContain('role="combobox" type="text" value="ada"');
    expect(listbox).toContain('role="listbox"');
    expect(listbox).toContain('data-state="open" id="assignee-listbox"');
    expect(listbox).toContain('aria-selected="true"');
    expect(listbox).toContain('data-highlighted="" data-state="unchecked"');
    expect(listbox).toContain('aria-disabled="true"');
    expect(value).toContain('id="assignee-value">Ada Lovelace</span>');
    expect({
      comboboxListboxClasses: [style.attrs(comboboxStyles.listbox).class ?? ''] as const,
      comboboxOptionClasses: [style.attrs(comboboxStyles.option).class ?? ''] as const,
      comboboxValueClasses: [style.attrs(comboboxStyles.value).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('wraps the headless autocomplete primitive as styled input and listbox markup', () => {
    const items = [
      { label: 'Starter plan', value: 'starter' },
      { label: 'Growth plan', value: 'growth' },
      { disabled: true, label: 'Enterprise plan', value: 'enterprise' },
    ];
    const state = {
      descriptionId: 'plan-search-help',
      form: 'plan-form',
      highlightedValue: 'growth',
      inputValue: 'gr',
      items,
      listId: 'plan-suggestions',
      name: 'plan-search',
      open: true,
      required: true,
      value: 'growth',
    };

    const input = AutocompleteInput.definition.render({
      ...state,
      id: 'plan-search',
      labelledBy: 'plan-search-label',
    });
    const list = AutocompleteList.definition.render({
      ...state,
      children: items
        .map((item) =>
          AutocompleteOption.definition.render({
            ...state,
            itemLabel: item.label,
            itemValue: item.value,
          }),
        )
        .join(''),
      id: 'plan-suggestions',
      labelledBy: 'plan-search-label',
    });
    const value = AutocompleteValue.definition.render({ ...state, id: 'plan-search-value' });
    expect(input).toContain('aria-activedescendant="plan-suggestions-option-0"');
    expect(input).toContain('autocomplete="off"');
    expect(input).toContain('form="plan-form"');
    expect(input).toContain('role="combobox" type="text" value="gr"');
    expect(input).not.toContain('list="plan-suggestions"');
    expect(list).toContain('role="listbox"');
    expect(list).toContain('aria-labelledby="plan-search-label"');
    expect(list).toContain('data-state="open" id="plan-suggestions"');
    expect(list).toContain('role="option"');
    expect(list).toContain('aria-selected="true"');
    expect(list).toContain('data-highlighted="" data-state="checked"');
    expect(list).toContain('aria-disabled="true"');
    expect(value).toContain('id="plan-search-value">Growth plan</span>');
    expect({
      autocompleteListClasses: [style.attrs(autocompleteStyles.list).class ?? ''] as const,
      autocompleteOptionClasses: [style.attrs(autocompleteStyles.option).class ?? ''] as const,
      autocompleteValueClasses: [style.attrs(autocompleteStyles.value).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('wraps the headless slider primitive as styled range input and decorative parts', () => {
    const state = {
      max: 100,
      min: 0,
      name: 'coverage',
      required: true,
      step: 5,
      value: 65,
    };

    const root = Slider.definition.render({
      ...state,
      children: `${SliderInput.definition.render({
        ...state,
        descriptionId: 'coverage-help',
        form: 'coverage-form',
        id: 'coverage',
        label: 'Coverage',
        valueText: '65 percent',
      })}${SliderTrack.definition.render({
        ...state,
        children: SliderRange.definition.render(state),
      })}${SliderThumb.definition.render(state)}`,
      id: 'coverage-root',
    });
    expect(root).toContain('data-max="100" data-min="0" data-orientation="horizontal"');
    expect(root).toContain('data-required="" data-value="65" id="coverage-root"');
    expect(root).toContain('aria-describedby="coverage-help"');
    expect(root).toContain('aria-label="Coverage"');
    expect(root).toContain('aria-valuetext="65 percent"');
    expect(root).toContain(
      'form="coverage-form" id="coverage" max="100" min="0" name="coverage" required',
    );
    expect(root).toContain('step="5" type="range" value="65"');
    expect(root).toContain('data-part="track"');
    expect(root).toContain('data-part="range"');
    expect(root).toContain('data-part="thumb"');
    expect(root).toContain('data-value-ratio="0.65"');
    expect({
      sliderRangeClasses: [style.attrs(sliderStyles.range).class ?? ''] as const,
      sliderThumbClasses: [style.attrs(sliderStyles.thumb).class ?? ''] as const,
      sliderTrackClasses: [style.attrs(sliderStyles.track).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('wraps the headless tabs primitive as styled tablist parts', () => {
    const items = [
      { value: 'overview' },
      { value: 'activity' },
      { disabled: true, value: 'audit' },
    ];
    const state = {
      activeValue: 'overview',
      items,
      orientation: 'horizontal' as const,
      value: 'overview',
    };

    expect(
      Tabs.definition.render({
        ...state,
        children: 'tabs body',
        id: 'account-tabs',
      }),
    ).toContain('data-orientation="horizontal" id="account-tabs">tabs body</div>');
    expect(
      TabsList.definition.render({
        ...state,
        children: 'triggers',
        label: 'Account sections',
      }),
    ).toContain('aria-label="Account sections"');
    expect(
      TabsTrigger.definition.render({
        ...state,
        children: 'Overview',
        id: 'overview-tab',
        itemValue: 'overview',
        panelId: 'overview-panel',
      }),
    ).toContain('aria-controls="overview-panel" aria-selected="true"');
    expect(
      TabsTrigger.definition.render({
        ...state,
        children: 'Audit',
        itemValue: 'audit',
      }),
    ).toContain('data-disabled="" data-state="inactive" disabled role="tab" tabIndex="-1"');
    const activeUnselectedTab = TabsTrigger.definition.render({
      ...state,
      activeValue: 'activity',
      children: 'Activity',
      itemValue: 'activity',
    });
    expect(activeUnselectedTab).toContain('aria-selected="false"');
    expect(activeUnselectedTab).toContain('data-state="inactive" role="tab" tabIndex="0"');
    expect(
      TabsPanel.definition.render({
        ...state,
        children: 'Overview content',
        id: 'overview-panel',
        itemValue: 'overview',
        triggerId: 'overview-tab',
      }),
    ).toContain('aria-labelledby="overview-tab"');
    expect(
      TabsPanel.definition.render({
        ...state,
        children: 'Activity content',
        itemValue: 'activity',
      }),
    ).toContain('data-state="inactive" hidden role="tabpanel"');
  });
});
