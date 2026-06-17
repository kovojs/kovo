import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
  Autocomplete,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Combobox,
  Command,
  ContextMenu,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  Field,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Kbd,
  Menubar,
  Meter,
  NavigationMenu,
  NumberField,
  OtpField,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  RadioGroup,
  ScrollArea,
  Select,
  Separator,
  Skeleton,
  Slider,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Toggle,
  ToggleGroup,
  Toast,
  Toolbar,
  accordionClasses,
  accordionContentClasses,
  accordionTriggerClasses,
  alertDialogActionClasses,
  alertDialogClasses,
  alertDialogContentClasses,
  autocompleteClasses,
  autocompleteInputClasses,
  avatarClasses,
  avatarFallbackClasses,
  breadcrumbClasses,
  buttonClasses,
  checkboxGroupClasses,
  collapsibleClasses,
  collapsibleTriggerClasses,
  comboboxClasses,
  comboboxInputClasses,
  comboboxListboxClasses,
  commandClasses,
  contextMenuClasses,
  dialogClasses,
  dialogContentClasses,
  disclosureClasses,
  disclosureTriggerClasses,
  dropdownMenuClasses,
  fieldClasses,
  hoverCardClasses,
  hoverCardContentClasses,
  menubarClasses,
  navigationMenuClasses,
  numberFieldClasses,
  otpFieldClasses,
  popoverClasses,
  popoverContentClasses,
  radioGroupClasses,
  scrollAreaClasses,
  selectClasses,
  selectTriggerClasses,
  tabsClasses,
  tooltipClasses,
  tooltipContentClasses,
  tableClasses,
  sliderClasses,
  sliderInputClasses,
  toggleGroupClasses,
  toastClasses,
  toastViewportClasses,
  toolbarClasses,
} from './index.js';
import { readSource } from './test-source.js';

describe('@kovojs/ui styled package foundation', () => {
  it('exports pure-markup button, badge, and card TSX components', () => {
    expect(Button.name).toBe('button');
    expect(Accordion.name).toBe('accordion');
    expect(AlertDialog.name).toBe('alert-dialog');
    expect(Avatar.name).toBe('avatar');
    expect(Badge.name).toBe('badge');
    expect(Card.name).toBe('card');
    expect(Checkbox.name).toBe('checkbox');
    expect(CheckboxGroup.name).toBe('checkbox-group');
    expect(Collapsible.name).toBe('collapsible');
    expect(Dialog.name).toBe('dialog');
    expect(Disclosure.name).toBe('disclosure');
    expect(HoverCard.name).toBe('hover-card');
    expect(Kbd.name).toBe('kbd');
    expect(Alert.name).toBe('alert');
    expect(Meter.name).toBe('meter');
    expect(Popover.name).toBe('popover');
    expect(Progress.name).toBe('progress');
    expect(Separator.name).toBe('separator');
    expect(Skeleton.name).toBe('skeleton');
    expect(Switch.name).toBe('switch');
    expect(RadioGroup.name).toBe('radio-group');
    expect(Tabs.name).toBe('tabs');
    expect(Toggle.name).toBe('toggle');
    expect(ToggleGroup.name).toBe('toggle-group');
    expect(Toolbar.name).toBe('toolbar');
    expect(NumberField.name).toBe('number-field');
    expect(OtpField.name).toBe('otp-field');
    expect(ScrollArea.name).toBe('scroll-area');
    expect(Field.name).toBe('field');
    expect(Select.name).toBe('select');
    expect(Combobox.name).toBe('combobox');
    expect(Autocomplete.name).toBe('autocomplete');
    expect(Slider.name).toBe('slider');
    expect(Toast.name).toBe('toast');
    expect(DropdownMenu.name).toBe('dropdown-menu');
    expect(ContextMenu.name).toBe('context-menu');
    expect(Menubar.name).toBe('menubar');
    expect(NavigationMenu.name).toBe('navigation-menu');
    expect(Command.name).toBe('command');
    expect(Tooltip.name).toBe('tooltip');

    const buttonOverride = style.create(
      { root: { letterSpacing: 1 } },
      { namespace: 'markupButton', source: 'index.markup.test.tsx' },
    );

    expect(
      Button.definition.render({
        children: 'Save',
        disabled: true,
        form: 'settings-form',
        name: 'settings-action',
        size: 'sm',
        style: buttonOverride.root,
        type: 'submit',
        value: 'save',
        variant: 'secondary',
      }),
    ).toContain(
      'data-style-src="button.tsx#root; button.tsx#sm; button.tsx#secondary; index.markup.test.tsx#root"',
    );
    expect(
      Button.definition.render({
        children: 'Save',
        form: 'settings-form',
        name: 'settings-action',
        type: 'submit',
        value: 'save',
      }),
    ).toContain('form="settings-form" name="settings-action" type="submit" value="save"');
    expect(Button.definition.render({ children: 'Save', disabled: true })).toContain(
      ' disabled type="button"',
    );
    expect(Button.definition.render({ children: 'Save', size: 'sm' })).toContain(
      'button.tsx#root; button.tsx#sm; button.tsx#primary',
    );
    expect(Badge.definition.render({ children: 'Live', variant: 'success' })).toContain(
      'data-style-src="badge.tsx#root; badge.tsx#success"',
    );
    expect(Card.definition.render({ children: '<p>Total</p>' })).toContain(
      'data-style-src="card.tsx#root"',
    );
    expect(Kbd.definition.render({ children: 'Ctrl K' })).toContain(
      'data-style-src="kbd.tsx#root"',
    );
    expect(
      Alert.definition.render({
        children: 'Payment method required.',
        role: 'alert',
        title: 'Billing issue',
        variant: 'danger',
      }),
    ).toContain('role="alert"');
    expect(Alert.definition.render({ children: 'Saved.', variant: 'success' })).toContain(
      'role="status"',
    );
    const skeletonOverride = style.create(
      { root: { height: 16, width: 128 } },
      { namespace: 'markupSkeleton', source: 'index.markup.test.tsx' },
    );
    expect(Skeleton.definition.render({ style: skeletonOverride.root })).toContain(
      'data-style-src="skeleton.tsx#root; index.markup.test.tsx#root"',
    );
    expect(buttonClasses).toContain('h-9 gap-2 px-3');
    expect(accordionClasses.join(' ')).toContain('grid w-full gap-2');
    expect(accordionTriggerClasses.join(' ')).toContain('data-[state=open]:bg-neutral-50');
    expect(accordionContentClasses.join(' ')).toContain('data-[state=closed]:hidden');
    expect(alertDialogClasses.join(' ')).toContain('contents');
    expect(alertDialogContentClasses.join(' ')).toContain('max-w-md');
    expect(alertDialogActionClasses.join(' ')).toContain('data-[intent=destructive]');
    expect(avatarClasses.join(' ')).toContain('rounded-full');
    expect(avatarFallbackClasses.join(' ')).toContain('data-[state=loaded]:hidden');
    expect(checkboxGroupClasses.join(' ')).toContain('data-[orientation=horizontal]:flex');
    expect(collapsibleClasses.join(' ')).toContain('border-neutral-200');
    expect(collapsibleTriggerClasses.join(' ')).toContain('cursor-pointer');
    expect(dialogClasses.join(' ')).toContain('contents');
    expect(dialogContentClasses.join(' ')).toContain('backdrop:bg-black/30');
    expect(disclosureClasses.join(' ')).toContain('grid gap-2');
    expect(disclosureTriggerClasses.join(' ')).toContain('data-[state=open]');
    expect(hoverCardClasses.join(' ')).toContain('relative inline-block');
    expect(hoverCardContentClasses.join(' ')).toContain('w-72');
    expect(radioGroupClasses.join(' ')).toContain('data-[orientation=horizontal]:flex');
    expect(tabsClasses.join(' ')).toContain('w-full text-neutral-950');
    expect(toggleGroupClasses.join(' ')).toContain('data-[orientation=vertical]:flex-col');
    expect(toolbarClasses.join(' ')).toContain('data-[orientation=vertical]:flex-col');
    expect(numberFieldClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(otpFieldClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(scrollAreaClasses.join(' ')).toContain('relative overflow-hidden');
    expect(fieldClasses.join(' ')).toContain('data-[required]');
    expect(selectClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(selectTriggerClasses.join(' ')).toContain('data-[placeholder]:text-neutral-500');
    expect(comboboxClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(comboboxListboxClasses.join(' ')).toContain('data-[state=closed]');
    expect(comboboxInputClasses.join(' ')).toContain('aria-[invalid=true]:border-red-400');
    expect(autocompleteClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(autocompleteInputClasses.join(' ')).toContain('focus-visible:ring-2');
    expect(sliderClasses.join(' ')).toContain('data-[orientation=vertical]:inline-grid');
    expect(sliderInputClasses.join(' ')).toContain('accent-neutral-950');
    expect(toastClasses.join(' ')).toContain('data-[variant=success]:bg-emerald-50');
    expect(toastViewportClasses.join(' ')).toContain('data-[placement=bottom-end]');
    expect(dropdownMenuClasses.join(' ')).toContain('relative inline-block');
    expect(contextMenuClasses.join(' ')).toContain('data-[disabled]:opacity-50');
    expect(menubarClasses.join(' ')).toContain('data-[orientation=vertical]:flex-col');
    expect(navigationMenuClasses.join(' ')).toContain('data-[orientation=vertical]');
    expect(commandClasses.join(' ')).toContain('grid gap-2');
    expect(popoverClasses.join(' ')).toContain('relative inline-block');
    expect(popoverContentClasses.join(' ')).toContain('w-64');
    expect(tooltipClasses.join(' ')).toContain('relative inline-block');
    expect(tooltipContentClasses.join(' ')).toContain('max-w-64');
  });

  it('wraps H1 primitives as styled vendorable TSX parts', () => {
    const accordionState = {
      orientation: 'vertical' as const,
      type: 'multiple' as const,
      value: ['shipping'],
    };
    const dialogState = {
      contentId: 'confirm-dialog',
      descriptionId: 'confirm-description',
      open: true,
      titleId: 'confirm-title',
    };

    expect(
      AccordionTrigger.definition.render({
        ...accordionState,
        children: 'Shipping',
        contentId: 'shipping-panel',
        itemValue: 'shipping',
        triggerId: 'shipping-trigger',
      }),
    ).toContain('aria-controls="shipping-panel"');
    expect(
      AccordionContent.definition.render({
        ...accordionState,
        children: 'Ships from the nearest warehouse.',
        contentId: 'shipping-panel',
        itemValue: 'shipping',
        triggerId: 'shipping-trigger',
      }),
    ).toContain('role="region"');
    expect(
      AccordionHeader.definition.render({
        ...accordionState,
        children: 'Shipping',
        itemValue: 'shipping',
        level: 3,
      }),
    ).toContain('aria-level="3"');
    expect(
      AccordionItem.definition.render({
        ...accordionState,
        children: 'item',
        itemValue: 'shipping',
      }),
    ).toContain('data-state="open"');

    expect(
      AlertDialogTrigger.definition.render({ ...dialogState, children: 'Delete', open: false }),
    ).toContain('command="show-modal" commandfor="confirm-dialog"');
    expect(
      AlertDialogContent.definition.render({
        ...dialogState,
        children: '<h2 id="confirm-title">Confirm</h2>',
      }),
    ).toContain('role="alertdialog"');
    expect(
      AlertDialogCancel.definition.render({ ...dialogState, autoFocus: true, children: 'Cancel' }),
    ).toContain('autofocus');
    expect(
      AlertDialogAction.definition.render({
        ...dialogState,
        children: 'Delete',
        intent: 'destructive',
      }),
    ).toContain('data-intent="destructive"');

    expect(
      Avatar.definition.render({
        children: AvatarImage.definition.render({
          alt: 'Ada',
          src: '/ada.png',
          status: 'loading',
        }),
        label: 'Ada avatar',
        src: '/ada.png',
        status: 'loading',
      }),
    ).toContain('role="img"');
    expect(AvatarFallback.definition.render({ children: 'AL', status: 'error' })).toContain(
      'data-state="error"',
    );

    expect(
      CollapsibleTrigger.definition.render({
        children: 'Release notes',
        contentId: 'release-notes',
        open: true,
      }),
    ).toContain('aria-expanded="true"');
    expect(
      CollapsibleContent.definition.render({
        children: 'Details',
        contentId: 'release-notes',
        open: true,
      }),
    ).toContain('id="release-notes"');
    expect(
      DisclosureTrigger.definition.render({
        children: 'Show details',
        contentId: 'disclosure-content',
        open: true,
      }),
    ).toContain('aria-controls="disclosure-content"');
    expect(
      DisclosureContent.definition.render({
        children: 'Details',
        contentId: 'disclosure-content',
        open: false,
      }),
    ).toContain('hidden');
    expect(
      DialogTrigger.definition.render({ children: 'Open', contentId: 'dialog-content' }),
    ).toContain('command="show-modal"');
    const dialogContent = DialogContent.definition.render({
      children: '<h2 id="dialog-title">Title</h2>',
      contentId: 'dialog-content',
      open: true,
      titleId: 'dialog-title',
    });
    expect(dialogContent).toContain('aria-labelledby="dialog-title"');
    expect(dialogContent).toContain('closedby="any"');
    expect(DialogClose.definition.render({ contentId: 'dialog-content' })).toContain(
      'command="request-close"',
    );

    expect(
      HoverCardTrigger.definition.render({
        children: 'Ada',
        contentId: 'profile-card',
        href: '/team/ada',
        open: true,
      }),
    ).toContain('kovo-hover-card="profile-card"');
    const disabledHoverCardTrigger = HoverCardTrigger.definition.render({
      children: 'Ada',
      contentId: 'profile-card',
      disabled: true,
      href: '/team/ada',
      open: false,
    });
    expect(disabledHoverCardTrigger).toContain('aria-disabled="true"');
    expect(disabledHoverCardTrigger).toContain('data-disabled="" data-state="closed"');
    expect(disabledHoverCardTrigger).not.toContain('href=');
    expect(disabledHoverCardTrigger).not.toContain('kovo-hover-card=');
    expect(HoverCardContent.definition.render({ contentId: 'profile-card', open: true })).toContain(
      'popover="manual"',
    );
    expect(
      PopoverTrigger.definition.render({ children: 'Filters', contentId: 'filters', open: true }),
    ).toContain('popovertarget="filters"');
    expect(PopoverContent.definition.render({ contentId: 'filters', open: true })).toContain(
      'popover="auto"',
    );
    expect(TooltipContent.definition.render({ contentId: 'tip', open: true })).not.toContain(
      'popover=',
    );
    expect(
      TooltipTrigger.definition.render({ children: 'Help', contentId: 'tip', open: true }),
    ).toContain('kovo-tooltip="tip"');
    const disabledTooltipTrigger = TooltipTrigger.definition.render({
      children: 'Help',
      contentId: 'tip',
      disabled: true,
      open: false,
    });
    expect(disabledTooltipTrigger).toContain('data-disabled="" data-state="closed" disabled');
    expect(disabledTooltipTrigger).not.toContain('kovo-tooltip=');
    expect(TooltipContent.definition.render({ contentId: 'tip', open: true })).toContain(
      'role="tooltip"',
    );

    expect(Meter.definition.render({ max: 100, value: 84 })).toContain('data-state="optimum"');
    expect(Progress.definition.render({ max: 100, value: null })).toContain(
      'data-state="indeterminate"',
    );
    expect(Separator.definition.render({ decorative: false, orientation: 'vertical' })).toContain(
      'aria-orientation="vertical"',
    );
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

  it('keeps vendorable component sources TSX-authored with no lowered IR stamps', () => {
    const sources = [
      'alert.tsx',
      'autocomplete.tsx',
      'badge.tsx',
      'breadcrumb.tsx',
      'button.tsx',
      'card.tsx',
      'checkbox.tsx',
      'checkbox-group.tsx',
      'combobox.tsx',
      'command.tsx',
      'context-menu.tsx',
      'drawer.tsx',
      'dropdown-menu.tsx',
      'field.tsx',
      'kbd.tsx',
      'menubar.tsx',
      'navigation-menu.tsx',
      'number-field.tsx',
      'otp-field.tsx',
      'sheet.tsx',
      'skeleton.tsx',
      'scroll-area.tsx',
      'select.tsx',
      'switch.tsx',
      'slider.tsx',
      'table.tsx',
      'tabs.tsx',
      'toggle.tsx',
      'toggle-group.tsx',
      'toast.tsx',
      'toolbar.tsx',
    ]
      .map(readSource)
      .join('\n');

    expect(sources).toContain('/** @jsxImportSource @kovojs/server */');
    expect(sources).toContain("import { component } from '@kovojs/core';");
    expect(sources).toContain("from '@kovojs/headless-ui'");
    expect(sources).not.toContain('kovo-c=');
    expect(sources).not.toContain('data-bind');
    expect(sources).not.toContain('@kovojs-ir');
  });
});
