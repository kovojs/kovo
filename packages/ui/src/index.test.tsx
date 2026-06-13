import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  Alert,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  Button,
  Card,
  Checkbox,
  Drawer,
  Kbd,
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  RadioGroupRadio,
  Sheet,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTrigger,
  Toggle,
  ToggleGroup,
  ToggleGroupButton,
  ToggleGroupItem,
  breadcrumbClasses,
  buttonClasses,
  checkboxClasses,
  radioGroupClasses,
  radioGroupItemClasses,
  radioGroupLabelClasses,
  radioGroupRadioClasses,
  tabsClasses,
  tabsListClasses,
  tabsPanelClasses,
  tabsTriggerClasses,
  sheetContentClasses,
  switchClasses,
  tableClasses,
  toggleClasses,
  toggleGroupButtonClasses,
  toggleGroupClasses,
  toggleGroupItemClasses,
} from './index.js';

const sourceDir = dirname(fileURLToPath(import.meta.url));

function readSource(name: string): string {
  return readFileSync(join(sourceDir, name), 'utf8');
}

describe('@jiso/ui styled package foundation', () => {
  it('exports pure-markup button, badge, and card TSX components', () => {
    expect(Button.name).toBe('button');
    expect(Badge.name).toBe('badge');
    expect(Card.name).toBe('card');
    expect(Checkbox.name).toBe('checkbox');
    expect(Kbd.name).toBe('kbd');
    expect(Alert.name).toBe('alert');
    expect(Skeleton.name).toBe('skeleton');
    expect(Switch.name).toBe('switch');
    expect(RadioGroup.name).toBe('radio-group');
    expect(Tabs.name).toBe('tabs');
    expect(Toggle.name).toBe('toggle');
    expect(ToggleGroup.name).toBe('toggle-group');

    expect(
      Button.definition.render({
        children: 'Save',
        class: ['tracking-wide', { uppercase: true }],
        disabled: true,
        size: 'sm',
        type: 'submit',
        variant: 'secondary',
      }),
    ).toContain(
      '<button class="inline-flex items-center justify-center rounded-md border text-sm font-medium transition-colors',
    );
    expect(Button.definition.render({ children: 'Save', disabled: true })).toContain(
      ' disabled type="button"',
    );
    expect(Button.definition.render({ children: 'Save', size: 'sm' })).toContain('h-8 gap-1.5');
    expect(Badge.definition.render({ children: 'Live', variant: 'success' })).toContain(
      'bg-emerald-50',
    );
    expect(Card.definition.render({ children: '<p>Total</p>' })).toBe(
      '<section class="rounded-lg border border-neutral-200 bg-white p-4 text-neutral-950 shadow-sm"><p>Total</p></section>',
    );
    expect(Kbd.definition.render({ children: 'Ctrl K', class: 'uppercase' })).toContain(
      '<kbd class="inline-flex h-5 min-w-5',
    );
    expect(Kbd.definition.render({ children: 'Ctrl K', class: 'uppercase' })).toContain(
      'uppercase',
    );
    expect(
      Alert.definition.render({
        children: 'Payment method required.',
        role: 'alert',
        title: 'Billing issue',
        variant: 'danger',
      }),
    ).toContain('role="alert"><strong class="font-medium">Billing issue</strong>');
    expect(Alert.definition.render({ children: 'Saved.', variant: 'success' })).toContain(
      'border-emerald-200 bg-emerald-50',
    );
    expect(Skeleton.definition.render({ class: 'h-4 w-32' })).toBe(
      '<div aria-hidden="true" class="animate-pulse rounded-md bg-neutral-200 h-4 w-32"></div>',
    );
    expect(buttonClasses).toContain('h-9 gap-2 px-3');
    expect(checkboxClasses.join(' ')).toContain('inline-flex items-center gap-2');
    expect(radioGroupClasses.join(' ')).toContain('data-[orientation=horizontal]:flex');
    expect(switchClasses.join(' ')).toContain('inline-flex items-center gap-2');
    expect(tabsClasses.join(' ')).toContain('w-full text-neutral-950');
    expect(toggleClasses.join(' ')).toContain('data-[state=pressed]:bg-neutral-950');
    expect(toggleGroupClasses.join(' ')).toContain('data-[orientation=vertical]:flex-col');
  });

  it('wraps the headless radio-group primitive as styled native radios', () => {
    const items = [
      { value: 'standard' },
      { value: 'express' },
      { disabled: true, value: 'freight' },
    ];
    const state = {
      descriptionId: 'shipping-help',
      items,
      name: 'shipping-speed',
      required: true,
      value: 'express',
    };

    const root = RadioGroup.definition.render({
      ...state,
      children: 'radio options',
      id: 'shipping-speed',
      invalid: true,
    });
    const item = RadioGroupItem.definition.render({
      ...state,
      children: 'express input',
      itemValue: 'express',
    });
    const radio = RadioGroupRadio.definition.render({
      ...state,
      controlId: 'shipping-express',
      itemValue: 'express',
    });
    const disabledRadio = RadioGroupRadio.definition.render({
      ...state,
      controlId: 'shipping-freight',
      itemValue: 'freight',
    });
    const label = RadioGroupLabel.definition.render({
      ...state,
      children: 'Express',
      controlId: 'shipping-express',
      itemValue: 'express',
    });

    expect(RadioGroupItem.name).toBe('radio-group-item');
    expect(RadioGroupRadio.name).toBe('radio-group-radio');
    expect(RadioGroupLabel.name).toBe('radio-group-label');
    expect(root).toContain('aria-describedby="shipping-help"');
    expect(root).toContain('aria-invalid="true"');
    expect(root).toContain('aria-required="true"');
    expect(root).toContain('role="radiogroup"');
    expect(item).toContain('data-state="checked"');
    expect(radio).toContain('aria-checked="true" checked');
    expect(radio).toContain('id="shipping-express" name="shipping-speed" required');
    expect(radio).toContain('tabIndex="0" type="radio" value="express"');
    expect(disabledRadio).toContain('data-disabled=""');
    expect(disabledRadio).toContain('disabled id="shipping-freight"');
    expect(disabledRadio).toContain('tabIndex="-1" type="radio" value="freight"');
    expect(label).toContain('for="shipping-express"');
    expect(radioGroupItemClasses.join(' ')).toContain('data-[disabled]:opacity-50');
    expect(radioGroupRadioClasses.join(' ')).toContain('accent-neutral-950');
    expect(radioGroupLabelClasses.join(' ')).toContain('select-none');
  });

  it('wraps headless form-control primitives as styled native controls', () => {
    const checkbox = Checkbox.definition.render({
      checked: 'indeterminate',
      children: 'Some permissions',
      name: 'permissions',
      required: true,
      value: 'partial',
    });
    const switchControl = Switch.definition.render({
      checked: true,
      children: 'Notifications',
      name: 'notifications',
      value: 'enabled',
    });
    const toggle = Toggle.definition.render({
      children: 'Bold',
      pressed: true,
      variant: 'subtle',
    });

    expect(checkbox).toContain('data-state="indeterminate"');
    expect(checkbox).toContain('aria-checked="mixed"');
    expect(checkbox).toContain('required type="checkbox" value="partial"');
    expect(checkbox).toContain('Some permissions</label>');
    expect(switchControl).toContain('data-state="checked"');
    expect(switchControl).toContain('aria-checked="true" checked');
    expect(switchControl).toContain('role="switch" type="checkbox" value="enabled"');
    expect(toggle).toContain('data-state="pressed"');
    expect(toggle).toContain('aria-pressed="true"');
    expect(toggle).toContain('border-transparent bg-neutral-100');
  });

  it('wraps the headless toggle-group primitive as styled roving buttons', () => {
    const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'strike' }];
    const state = {
      activeValue: 'bold',
      items,
      type: 'multiple' as const,
      value: ['bold'] as const,
    };

    const root = ToggleGroup.definition.render({
      ...state,
      children: 'format controls',
      descriptionId: 'format-help',
      id: 'formatting',
      labelledBy: 'format-label',
      orientation: 'vertical',
    });
    const item = ToggleGroupItem.definition.render({
      ...state,
      children: 'bold button',
      id: 'bold-item',
      itemValue: 'bold',
    });
    const button = ToggleGroupButton.definition.render({
      ...state,
      children: 'Bold',
      id: 'bold-button',
      itemValue: 'bold',
    });
    const disabledButton = ToggleGroupButton.definition.render({
      ...state,
      children: 'Strike',
      itemValue: 'strike',
    });

    expect(ToggleGroupItem.name).toBe('toggle-group-item');
    expect(ToggleGroupButton.name).toBe('toggle-group-button');
    expect(root).toContain('aria-describedby="format-help"');
    expect(root).toContain('aria-labelledby="format-label"');
    expect(root).toContain('data-orientation="vertical" id="formatting" role="group"');
    expect(item).toContain('data-state="pressed" id="bold-item"');
    expect(button).toContain('aria-pressed="true"');
    expect(button).toContain('data-state="pressed"');
    expect(button).toContain('id="bold-button" tabIndex="0" type="button" value="bold"');
    expect(disabledButton).toContain('aria-pressed="false"');
    expect(disabledButton).toContain('data-disabled="" data-state="off" disabled');
    expect(disabledButton).toContain('tabIndex="-1" type="button" value="strike"');
    expect(toggleGroupItemClasses.join(' ')).toContain('data-[disabled]:opacity-50');
    expect(toggleGroupButtonClasses.join(' ')).toContain('data-[state=pressed]:bg-white');
  });

  it('exports table primitives as styled semantic markup', () => {
    expect(Table.name).toBe('table');
    expect(TableHead.name).toBe('table-head');
    expect(TableBody.name).toBe('table-body');
    expect(TableRow.name).toBe('table-row');
    expect(TableHeaderCell.name).toBe('table-header-cell');
    expect(TableCell.name).toBe('table-cell');

    expect(Table.definition.render({ caption: 'Invoices', children: '<tbody></tbody>' })).toContain(
      '<caption class="mt-3 text-sm text-neutral-500">Invoices</caption><tbody></tbody>',
    );
    expect(TableHeaderCell.definition.render({ children: 'Status', scope: 'row' })).toContain(
      '<th class="h-10 px-3 text-left align-middle font-medium text-neutral-700" scope="row">',
    );
    expect(TableCell.definition.render({ children: '$250.00', colSpan: 2 })).toContain(
      'colspan="2"',
    );
    expect(tableClasses).toContain('w-full overflow-x-auto');
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

    expect(TabsList.name).toBe('tabs-list');
    expect(TabsTrigger.name).toBe('tabs-trigger');
    expect(TabsPanel.name).toBe('tabs-panel');

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
    expect(tabsListClasses.join(' ')).toContain('data-[orientation=vertical]:flex-col');
    expect(tabsTriggerClasses.join(' ')).toContain('data-[state=active]:bg-white');
    expect(tabsPanelClasses.join(' ')).toContain('rounded-md border border-neutral-200');
  });

  it('exports breadcrumb primitives with headless separator attributes', () => {
    expect(Breadcrumb.name).toBe('breadcrumb');
    expect(BreadcrumbItem.name).toBe('breadcrumb-item');
    expect(BreadcrumbLink.name).toBe('breadcrumb-link');
    expect(BreadcrumbSeparator.name).toBe('breadcrumb-separator');

    expect(Breadcrumb.definition.render({ children: '<li>Settings</li>' })).toContain(
      '<nav aria-label="Breadcrumb" class="flex flex-wrap items-center gap-1.5',
    );
    expect(BreadcrumbItem.definition.render({ children: 'Settings' })).toBe(
      '<li class="inline-flex items-center gap-1.5">Settings</li>',
    );
    expect(BreadcrumbLink.definition.render({ children: 'Account', current: true })).toContain(
      'aria-current="page" class="font-medium text-neutral-950"',
    );
    expect(BreadcrumbSeparator.definition.render({ children: '>' })).toBe(
      '<li aria-hidden="true" class="text-neutral-400" data-orientation="horizontal" role="none">></li>',
    );
    expect(breadcrumbClasses).toContain('text-neutral-400');
  });

  it('wraps the headless dialog primitive for a bounded sheet component', () => {
    expect(Sheet.name).toBe('sheet');
    expect(Drawer.name).toBe('drawer');

    const rendered = Sheet.definition.render({
      children: 'Sheet body',
      contentId: 'account-sheet',
      description: 'Manage account settings',
      open: true,
      side: 'left',
      title: 'Account',
      trigger: 'Settings',
    });

    expect(rendered).toContain('aria-controls="account-sheet"');
    expect(rendered).toContain('command="show-modal" commandfor="account-sheet"');
    expect(rendered).toContain('<dialog aria-describedby="account-sheet-description"');
    expect(rendered).toContain('id="account-sheet" open>');
    expect(rendered).toContain('inset-y-0 left-0 w-full max-w-sm border-r');
    expect(rendered).toContain('command="request-close" commandfor="account-sheet"');

    const topSheet = Sheet.definition.render({
      contentId: 'top-sheet',
      side: 'top',
      title: 'Top sheet',
    });
    const drawer = Drawer.definition.render({
      children: 'Drawer body',
      contentId: 'account-drawer',
      description: 'Mobile actions',
      open: true,
      title: 'Actions',
      trigger: 'Open drawer',
    });

    expect(sheetContentClasses).toContain('inset-y-0 right-0 w-full max-w-sm border-l');
    expect(sheetContentClasses).toContain('inset-x-0 bottom-0 max-h-[85vh] border-t');
    expect(topSheet).toContain('top-0 max-h-[85vh] border-b');
    expect(drawer).toContain('command="show-modal" commandfor="account-drawer"');
    expect(drawer).toContain('<dialog aria-describedby="account-drawer-description"');
    expect(drawer).toContain('id="account-drawer" open>');
    expect(drawer).toContain('bottom-0 max-h-[85vh] border-t');
    expect(drawer).toContain('command="request-close" commandfor="account-drawer"');
  });

  it('keeps vendorable component sources TSX-authored with no lowered IR stamps', () => {
    const sources = [
      'alert.tsx',
      'badge.tsx',
      'breadcrumb.tsx',
      'button.tsx',
      'card.tsx',
      'checkbox.tsx',
      'kbd.tsx',
      'sheet.tsx',
      'skeleton.tsx',
      'switch.tsx',
      'table.tsx',
      'tabs.tsx',
      'toggle.tsx',
      'toggle-group.tsx',
    ]
      .map(readSource)
      .join('\n');

    expect(sources).toContain('/** @jsxImportSource @jiso/server */');
    expect(sources).toContain("import { component } from '@jiso/core';");
    expect(sources).toContain("from '@jiso/headless-ui'");
    expect(sources).not.toContain('fw-c=');
    expect(sources).not.toContain('data-bind');
    expect(sources).not.toContain('@jiso-ir');
  });
});
