import { describe, expect, it } from 'vitest';
import * as style from '@kovojs/style';
import { AccordionContent, AccordionHeader, AccordionItem, AccordionTrigger } from './accordion.js';
import { Alert } from './alert.js';
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
  alertDialogStyles,
} from './alert-dialog.js';
import { autocompleteStyles } from './autocomplete.js';
import { Avatar, AvatarFallback, AvatarImage } from './avatar.js';
import { Badge } from './badge.js';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator } from './breadcrumb.js';
import { Button } from './button.js';
import { Card } from './card.js';
import { checkboxGroupStyles } from './checkbox-group.js';
import { CollapsibleContent, CollapsibleTrigger } from './collapsible.js';
import { comboboxStyles } from './combobox.js';
import { commandStyles } from './command.js';
import { contextMenuStyles } from './context-menu.js';
import { DialogClose, DialogContent, DialogTrigger, dialogStyles } from './dialog.js';
import { DisclosureContent, DisclosureTrigger } from './disclosure.js';
import { dropdownMenuStyles } from './dropdown-menu.js';
import { fieldStyles } from './field.js';
import { HoverCardContent, HoverCardTrigger } from './hover-card.js';
import { Kbd } from './kbd.js';
import { menubarStyles } from './menubar.js';
import { Meter } from './meter.js';
import { navigationMenuStyles } from './navigation-menu.js';
import { numberFieldStyles } from './number-field.js';
import { otpFieldStyles } from './otp-field.js';
import { PopoverContent, PopoverTrigger } from './popover.js';
import { Progress } from './progress.js';
import { selectStyles } from './select.js';
import { Separator } from './separator.js';
import { Skeleton } from './skeleton.js';
import { sliderStyles } from './slider.js';
import { Table, TableCell, TableHeaderCell } from './table.js';
import { toastStyles } from './toast.js';
import { TooltipContent, TooltipTrigger } from './tooltip.js';
import { readSource } from './test-source.js';
describe('@kovojs/ui styled package foundation', () => {
  it('exports pure-markup button, badge, and card TSX components', () => {
    const buttonOverride = style.create(
      { root: { letterSpacing: 1 } },
      { namespace: 'markupButton', source: 'index.markup.test.tsx' },
    );
    expect(
      String(
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
      ),
    ).toContain(
      'data-style-src="button.tsx#root; button.tsx#sm; button.tsx#secondary; index.markup.test.tsx#root"',
    );
    expect(
      String(
        Button.definition.render({
          children: 'Save',
          form: 'settings-form',
          name: 'settings-action',
          type: 'submit',
          value: 'save',
        }),
      ),
    ).toContain('form="settings-form" name="settings-action" type="submit" value="save"');
    expect(String(Button.definition.render({ children: 'Save', disabled: true }))).toContain(
      ' disabled type="button"',
    );
    expect(String(Button.definition.render({ children: 'Save', size: 'sm' }))).toContain(
      'button.tsx#root; button.tsx#sm; button.tsx#primary',
    );
    expect(String(Badge.definition.render({ children: 'Live', variant: 'success' }))).toContain(
      'data-style-src="badge.tsx#root; badge.tsx#success"',
    );
    expect(String(Card.definition.render({ children: '<p>Total</p>' }))).toContain(
      'data-style-src="card.tsx#root"',
    );
    expect(String(Kbd.definition.render({ children: 'Ctrl K' }))).toContain(
      'data-style-src="kbd.tsx#root"',
    );
    expect(
      String(
        Alert.definition.render({
          children: 'Payment method required.',
          role: 'alert',
          title: 'Billing issue',
          variant: 'danger',
        }),
      ),
    ).toContain('role="alert"');
    expect(String(Alert.definition.render({ children: 'Saved.', variant: 'success' }))).toContain(
      'role="status"',
    );
    const skeletonOverride = style.create(
      { root: { height: 16, width: 128 } },
      { namespace: 'markupSkeleton', source: 'index.markup.test.tsx' },
    );
    expect(String(Skeleton.definition.render({ style: skeletonOverride.root }))).toContain(
      'data-style-src="skeleton.tsx#root; index.markup.test.tsx#root"',
    );
    expect({
      alertDialogActionClasses: [style.attrs(alertDialogStyles.action).class ?? ''] as const,
      alertDialogClasses: [style.attrs(alertDialogStyles.root).class ?? ''] as const,
      alertDialogContentClasses: [style.attrs(alertDialogStyles.content).class ?? ''] as const,
      autocompleteClasses: [style.attrs(autocompleteStyles.root).class ?? ''] as const,
      autocompleteInputClasses: [style.attrs(autocompleteStyles.input).class ?? ''] as const,
      checkboxGroupClasses: [style.attrs(checkboxGroupStyles.root).class ?? ''] as const,
      commandClasses: [style.attrs(commandStyles.root).class ?? ''] as const,
      contextMenuClasses: [style.attrs(contextMenuStyles.root).class ?? ''] as const,
      dialogClasses: [style.attrs(dialogStyles.root).class ?? ''] as const,
      dialogContentClasses: [style.attrs(dialogStyles.content).class ?? ''] as const,
      dropdownMenuClasses: [style.attrs(dropdownMenuStyles.root).class ?? ''] as const,
      fieldClasses: [style.attrs(fieldStyles.root).class ?? ''] as const,
      menubarClasses: [style.attrs(menubarStyles.root).class ?? ''] as const,
      navigationMenuClasses: [style.attrs(navigationMenuStyles.root).class ?? ''] as const,
      numberFieldClasses: [style.attrs(numberFieldStyles.root).class ?? ''] as const,
      otpFieldClasses: [style.attrs(otpFieldStyles.root).class ?? ''] as const,
      selectClasses: [style.attrs(selectStyles.root).class ?? ''] as const,
      selectTriggerClasses: [style.attrs(selectStyles.trigger).class ?? ''] as const,
      sliderClasses: [style.attrs(sliderStyles.root).class ?? ''] as const,
      sliderInputClasses: [style.attrs(sliderStyles.input).class ?? ''] as const,
      toastClasses: [style.attrs(toastStyles.root).class ?? ''] as const,
      toastViewportClasses: [style.attrs(toastStyles.viewport).class ?? ''] as const,
      comboboxClasses: [style.attrs(comboboxStyles.root).class ?? ''] as const,
      comboboxInputClasses: [style.attrs(comboboxStyles.input).class ?? ''] as const,
      comboboxListboxClasses: [style.attrs(comboboxStyles.listbox).class ?? ''] as const,
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
      String(
        AccordionTrigger.definition.render({
          ...accordionState,
          children: 'Shipping',
          contentId: 'shipping-panel',
          itemValue: 'shipping',
          triggerId: 'shipping-trigger',
        }),
      ),
    ).toContain('aria-controls="shipping-panel"');
    expect(
      String(
        AccordionContent.definition.render({
          ...accordionState,
          children: 'Ships from the nearest warehouse.',
          contentId: 'shipping-panel',
          itemValue: 'shipping',
          triggerId: 'shipping-trigger',
        }),
      ),
    ).toContain('role="region"');
    expect(
      String(
        AccordionHeader.definition.render({
          ...accordionState,
          children: 'Shipping',
          itemValue: 'shipping',
          level: 3,
        }),
      ),
    ).toContain('aria-level="3"');
    expect(
      String(
        AccordionItem.definition.render({
          ...accordionState,
          children: 'item',
          itemValue: 'shipping',
        }),
      ),
    ).toContain('data-state="open"');
    expect(
      String(
        AlertDialogTrigger.definition.render({ ...dialogState, children: 'Delete', open: false }),
      ),
    ).toContain('command="show-modal" commandfor="confirm-dialog"');
    expect(
      String(
        AlertDialogContent.definition.render({
          ...dialogState,
          children: '<h2 id="confirm-title">Confirm</h2>',
        }),
      ),
    ).toContain('role="alertdialog"');
    expect(
      String(
        AlertDialogCancel.definition.render({
          ...dialogState,
          autoFocus: true,
          children: 'Cancel',
        }),
      ),
    ).toContain('autofocus');
    expect(
      String(
        AlertDialogAction.definition.render({
          ...dialogState,
          children: 'Delete',
          intent: 'destructive',
        }),
      ),
    ).toContain('data-intent="destructive"');
    expect(
      String(
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
      ),
    ).toContain('role="img"');
    expect(String(AvatarFallback.definition.render({ children: 'AL', status: 'error' }))).toContain(
      'data-state="error"',
    );
    expect(
      String(
        CollapsibleTrigger.definition.render({
          children: 'Release notes',
          contentId: 'release-notes',
          open: true,
        }),
      ),
    ).toContain('aria-expanded="true"');
    expect(
      String(
        CollapsibleContent.definition.render({
          children: 'Details',
          contentId: 'release-notes',
          open: true,
        }),
      ),
    ).toContain('id="release-notes"');
    expect(
      String(
        DisclosureTrigger.definition.render({
          children: 'Show details',
          contentId: 'disclosure-content',
          open: true,
        }),
      ),
    ).toContain('aria-controls="disclosure-content"');
    expect(
      String(
        DisclosureContent.definition.render({
          children: 'Details',
          contentId: 'disclosure-content',
          open: false,
        }),
      ),
    ).toContain('hidden');
    expect(
      String(DialogTrigger.definition.render({ children: 'Open', contentId: 'dialog-content' })),
    ).toContain('command="show-modal"');
    const dialogContent = String(
      DialogContent.definition.render({
        children: '<h2 id="dialog-title">Title</h2>',
        contentId: 'dialog-content',
        open: true,
        titleId: 'dialog-title',
      }),
    );
    expect(dialogContent).toContain('aria-labelledby="dialog-title"');
    expect(dialogContent).toContain('closedby="any"');
    expect(String(DialogClose.definition.render({ contentId: 'dialog-content' }))).toContain(
      'command="request-close"',
    );
    expect(
      String(
        HoverCardTrigger.definition.render({
          children: 'Ada',
          contentId: 'profile-card',
          href: '/team/ada',
          open: true,
        }),
      ),
    ).toContain('kovo-hover-card="profile-card"');
    const disabledHoverCardTrigger = String(
      HoverCardTrigger.definition.render({
        children: 'Ada',
        contentId: 'profile-card',
        disabled: true,
        href: '/team/ada',
        open: false,
      }),
    );
    expect(disabledHoverCardTrigger).toContain('aria-disabled="true"');
    expect(disabledHoverCardTrigger).toContain('data-disabled="" data-state="closed"');
    expect(disabledHoverCardTrigger).not.toContain('href=');
    expect(disabledHoverCardTrigger).not.toContain('kovo-hover-card=');
    // The hover-card content no longer uses a manual popover (it never received
    // the imperative showPopover() call, so it stayed display:none and the card
    // never appeared). Visibility is governed by data-state/hidden instead.
    const openHoverCardContent = String(
      HoverCardContent.definition.render({
        contentId: 'profile-card',
        open: true,
      }),
    );
    expect(openHoverCardContent).not.toContain('popover=');
    expect(openHoverCardContent).toContain('data-state="open"');
    expect(
      String(
        PopoverTrigger.definition.render({ children: 'Filters', contentId: 'filters', open: true }),
      ),
    ).toContain('popovertarget="filters"');
    expect(
      String(PopoverContent.definition.render({ contentId: 'filters', open: true })),
    ).toContain('popover="auto"');
    expect(
      String(TooltipContent.definition.render({ contentId: 'tip', open: true })),
    ).not.toContain('popover=');
    expect(
      String(TooltipTrigger.definition.render({ children: 'Help', contentId: 'tip', open: true })),
    ).toContain('kovo-tooltip="tip"');
    const disabledTooltipTrigger = String(
      TooltipTrigger.definition.render({
        children: 'Help',
        contentId: 'tip',
        disabled: true,
        open: false,
      }),
    );
    expect(disabledTooltipTrigger).toContain('data-disabled="" data-state="closed" disabled');
    expect(disabledTooltipTrigger).not.toContain('kovo-tooltip=');
    expect(String(TooltipContent.definition.render({ contentId: 'tip', open: true }))).toContain(
      'role="tooltip"',
    );
    expect(String(Meter.definition.render({ max: 100, value: 84 }))).toContain(
      'data-state="optimum"',
    );
    expect(String(Progress.definition.render({ max: 100, value: null }))).toContain(
      'data-state="indeterminate"',
    );
    expect(
      String(Separator.definition.render({ decorative: false, orientation: 'vertical' })),
    ).toContain('aria-orientation="vertical"');
  });
  it('exports table primitives as styled semantic markup', () => {
    expect(
      String(Table.definition.render({ caption: 'Invoices', children: '<tbody></tbody>' })),
    ).toContain('Invoices</caption><tbody></tbody>');
    expect(
      String(TableHeaderCell.definition.render({ children: 'Status', scope: 'row' })),
    ).toContain('scope="row">Status</th>');
    expect(String(TableCell.definition.render({ children: '$250.00', colSpan: 2 }))).toContain(
      'colspan="2"',
    );
  });
  it('exports breadcrumb primitives with headless separator attributes', () => {
    expect(String(Breadcrumb.definition.render({ children: '<li>Settings</li>' }))).toContain(
      'aria-label="Breadcrumb"',
    );
    expect(String(BreadcrumbItem.definition.render({ children: 'Settings' }))).toContain(
      '>Settings</li>',
    );
    expect(
      String(BreadcrumbLink.definition.render({ children: 'Account', current: true })),
    ).toContain('aria-current="page"');
    expect(String(BreadcrumbSeparator.definition.render({ children: '>' }))).toContain(
      'data-orientation="horizontal" role="none">&gt;',
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
    expect(sources).toContain("from '@kovojs/headless-ui/");
    expect(sources).not.toContain('kovo-c=');
    expect(sources).not.toContain('data-bind');
    expect(sources).not.toContain('@kovojs-ir');
  });
});
