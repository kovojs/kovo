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
  alertDialogActionClasses,
  alertDialogClasses,
  alertDialogContentClasses,
  autocompleteClasses,
  autocompleteInputClasses,
  checkboxGroupClasses,
  collapsibleClasses,
  collapsibleContentClasses,
  collapsibleStyles,
  collapsibleTriggerClasses,
  comboboxClasses,
  comboboxInputClasses,
  comboboxListboxClasses,
  commandClasses,
  contextMenuClasses,
  dialogClasses,
  dialogContentClasses,
  disclosureStyles,
  dropdownMenuClasses,
  fieldClasses,
  menubarClasses,
  navigationMenuClasses,
  numberFieldClasses,
  otpFieldClasses,
  selectClasses,
  selectTriggerClasses,
  sliderClasses,
  sliderInputClasses,
  toastClasses,
  toastViewportClasses,
} from './index.js';
import { readSource } from './test-source.js';

describe('@kovojs/ui styled package foundation', () => {
  it('exports pure-markup button, badge, and card TSX components', () => {
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
    expect({
      alertDialogActionClasses,
      alertDialogClasses,
      alertDialogContentClasses,
      autocompleteClasses,
      autocompleteInputClasses,
      checkboxGroupClasses,
      commandClasses,
      contextMenuClasses,
      dialogClasses,
      dialogContentClasses,
      dropdownMenuClasses,
      fieldClasses,
      menubarClasses,
      navigationMenuClasses,
      numberFieldClasses,
      otpFieldClasses,
      selectClasses,
      selectTriggerClasses,
      sliderClasses,
      sliderInputClasses,
      toastClasses,
      toastViewportClasses,
      comboboxClasses,
      comboboxInputClasses,
      comboboxListboxClasses,
    }).toMatchSnapshot();
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
    expect(Table.definition.render({ caption: 'Invoices', children: '<tbody></tbody>' })).toContain(
      'Invoices</caption><tbody></tbody>',
    );
    expect(TableHeaderCell.definition.render({ children: 'Status', scope: 'row' })).toContain(
      'scope="row">Status</th>',
    );
    expect(TableCell.definition.render({ children: '$250.00', colSpan: 2 })).toContain(
      'colspan="2"',
    );
  });

  it('exports breadcrumb primitives with headless separator attributes', () => {
    expect(Breadcrumb.definition.render({ children: '<li>Settings</li>' })).toContain(
      'aria-label="Breadcrumb"',
    );
    expect(BreadcrumbItem.definition.render({ children: 'Settings' })).toContain('>Settings</li>');
    expect(BreadcrumbLink.definition.render({ children: 'Account', current: true })).toContain(
      'aria-current="page"',
    );
    expect(BreadcrumbSeparator.definition.render({ children: '>' })).toContain(
      'data-orientation="horizontal" role="none">>',
    );
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
