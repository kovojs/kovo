import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Command,
  CommandClose,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandListbox,
  CommandTrigger,
  CommandValue,
  commandStyles,
} from './command.js';

const commandItems = [
  { label: 'Open file', value: 'open-file' },
  { disabled: true, label: 'Archive file', value: 'archive-file' },
] as const;

describe('@kovojs/ui Command StyleX slots', () => {
  it('matches command states with StyleX output', () => {
    expect({
      classes: [style.attrs(commandStyles.root).class ?? ''] as const,
      closeClasses: [style.attrs(commandStyles.close).class ?? ''] as const,
      dialogClasses: [style.attrs(commandStyles.dialog).class ?? ''] as const,
      emptyClasses: [style.attrs(commandStyles.empty).class ?? ''] as const,
      inputClasses: [style.attrs(commandStyles.input).class ?? ''] as const,
      itemClasses: [style.attrs(commandStyles.item).class ?? ''] as const,
      listboxClasses: [style.attrs(commandStyles.listbox).class ?? ''] as const,
      rendered: Command.definition.render({
        children:
          CommandTrigger.definition.render({
            children: 'Open command menu',
            contentId: 'command-dialog',
            id: 'command-trigger',
            open: true,
          }) +
          CommandDialog.definition.render({
            children:
              CommandInput.definition.render({
                highlightedValue: 'open-file',
                id: 'command-input',
                items: commandItems,
                listboxId: 'command-listbox',
                open: true,
                placeholder: 'Search commands',
                value: 'open',
              }) +
              CommandListbox.definition.render({
                children:
                  CommandItem.definition.render({
                    highlightedValue: 'open-file',
                    itemLabel: 'Open file',
                    itemValue: 'open-file',
                    value: 'open-file',
                  }) +
                  CommandItem.definition.render({
                    itemDisabled: true,
                    itemLabel: 'Archive file',
                    itemValue: 'archive-file',
                    value: 'open-file',
                  }) +
                  CommandEmpty.definition.render({
                    children: 'No commands matched',
                  }),
                highlightedValue: 'open-file',
                id: 'command-listbox',
                open: true,
                value: 'open-file',
              }) +
              CommandValue.definition.render({
                items: commandItems,
                value: 'open-file',
              }) +
              CommandClose.definition.render({
                contentId: 'command-dialog',
                open: true,
              }),
            contentId: 'command-dialog',
            open: true,
            titleId: 'command-title',
          }),
        id: 'command-root',
        items: commandItems,
        open: true,
        value: 'open-file',
      }),
      triggerClasses: [style.attrs(commandStyles.trigger).class ?? ''] as const,
      valueClasses: [style.attrs(commandStyles.value).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        close: {
          color: '#1d4ed8',
        },
        dialog: {
          borderColor: '#2563eb',
        },
        empty: {
          color: '#1e40af',
        },
        input: {
          backgroundColor: '#eff6ff',
        },
        item: {
          color: '#1e3a8a',
        },
        listbox: {
          backgroundColor: '#dbeafe',
        },
        root: {
          rowGap: 12,
        },
        trigger: {
          backgroundColor: '#bfdbfe',
        },
        value: {
          color: '#1d4ed8',
        },
      },
      { namespace: 'appCommand', source: 'app-command.tsx' },
    );

    expect(
      Command.definition.render({
        children:
          CommandTrigger.definition.render({
            children: 'Custom command',
            open: true,
            styles: { trigger: overrides.trigger },
          }) +
          CommandDialog.definition.render({
            children:
              CommandInput.definition.render({
                open: true,
                styles: { input: overrides.input },
              }) +
              CommandListbox.definition.render({
                children:
                  CommandItem.definition.render({
                    itemValue: 'first',
                    styles: { item: overrides.item },
                  }) +
                  CommandEmpty.definition.render({
                    styles: { empty: overrides.empty },
                  }) +
                  CommandValue.definition.render({
                    styles: { value: overrides.value },
                    value: 'first',
                  }) +
                  CommandClose.definition.render({
                    styles: { close: overrides.close },
                  }),
                open: true,
                styles: { listbox: overrides.listbox },
              }),
            open: true,
            styles: { dialog: overrides.dialog },
          }),
        open: true,
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      keys: Object.keys(commandStyles),
      markers: {
        close: commandStyles.close.$$css,
        dialog: commandStyles.dialog.$$css,
        empty: commandStyles.empty.$$css,
        input: commandStyles.input.$$css,
        item: commandStyles.item.$$css,
        listbox: commandStyles.listbox.$$css,
        root: commandStyles.root.$$css,
        trigger: commandStyles.trigger.$$css,
        value: commandStyles.value.$$css,
      },
    }).toMatchSnapshot();
  });
});
