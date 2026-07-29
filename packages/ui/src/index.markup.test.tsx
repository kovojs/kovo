import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';
import * as style from '@kovojs/style';
import { AccordionContent, AccordionHeader, AccordionItem, AccordionTrigger } from './accordion.js';
import { Alert } from './alert.js';
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
} from './alert-dialog.js';
import { Avatar, AvatarFallback, AvatarImage } from './avatar.js';
import { Badge } from './badge.js';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator } from './breadcrumb.js';
import { Button } from './button.js';
import { Card } from './card.js';
import { CollapsibleContent, CollapsibleTrigger } from './collapsible.js';
import { DialogClose, DialogContent, DialogTrigger } from './dialog.js';
import { DisclosureContent, DisclosureTrigger } from './disclosure.js';
import { HoverCardContent, HoverCardTrigger } from './hover-card.js';
import { Kbd } from './kbd.js';
import { Meter } from './meter.js';
import { PopoverContent, PopoverTrigger } from './popover.js';
import { Progress } from './progress.js';
import { Separator } from './separator.js';
import { Skeleton } from './skeleton.js';
import { Table, TableBody, TableCell, TableHeaderCell } from './table.js';
import { TooltipContent, TooltipTrigger } from './tooltip.js';
import { readSource } from './test-source.js';
describe('@kovojs/ui styled package foundation', () => {
  it('exports pure-markup button, badge, and card TSX components', () => {
    const buttonOverride = style.create({ root: { letterSpacing: 1 } });
    expect(
      String(
        renderUiComponent(Button, {
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
        renderUiComponent(Button, {
          children: 'Save',
          form: 'settings-form',
          name: 'settings-action',
          type: 'submit',
          value: 'save',
        }),
      ),
    ).toContain('form="settings-form" name="settings-action" type="submit" value="save"');
    expect(String(renderUiComponent(Button, { children: 'Save', disabled: true }))).toContain(
      ' disabled type="button"',
    );
    expect(String(renderUiComponent(Button, { children: 'Save', size: 'sm' }))).toContain(
      'button.tsx#root; button.tsx#sm; button.tsx#primary',
    );
    expect(String(renderUiComponent(Badge, { children: 'Live', variant: 'success' }))).toContain(
      'data-style-src="badge.tsx#root; badge.tsx#success"',
    );
    expect(String(renderUiComponent(Card, { children: '<p>Total</p>' }))).toContain(
      'data-style-src="card.tsx#root"',
    );
    expect(String(renderUiComponent(Kbd, { children: 'Ctrl K' }))).toContain(
      'data-style-src="kbd.tsx#root"',
    );
    expect(
      String(
        renderUiComponent(Alert, {
          children: 'Payment method required.',
          role: 'alert',
          title: 'Billing issue',
          variant: 'danger',
        }),
      ),
    ).toContain('role="alert"');
    expect(String(renderUiComponent(Alert, { children: 'Saved.', variant: 'success' }))).toContain(
      'role="status"',
    );
    const skeletonOverride = style.create({ root: { height: 16, width: 128 } });
    expect(String(renderUiComponent(Skeleton, { style: skeletonOverride.root }))).toContain(
      'data-style-src="skeleton.tsx#root; index.markup.test.tsx#root"',
    );
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
        renderUiComponent(AccordionTrigger, {
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
        renderUiComponent(AccordionContent, {
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
        renderUiComponent(AccordionHeader, {
          ...accordionState,
          children: 'Shipping',
          itemValue: 'shipping',
          level: 3,
        }),
      ),
    ).toContain('aria-level="3"');
    expect(
      String(
        renderUiComponent(AccordionItem, {
          ...accordionState,
          children: 'item',
          itemValue: 'shipping',
        }),
      ),
    ).toContain('data-state="open"');
    expect(
      String(
        renderUiComponent(AlertDialogTrigger, { ...dialogState, children: 'Delete', open: false }),
      ),
    ).toContain('command="show-modal" commandfor="confirm-dialog"');
    expect(
      String(
        renderUiComponent(AlertDialogContent, {
          ...dialogState,
          children: '<h2 id="confirm-title">Confirm</h2>',
        }),
      ),
    ).toContain('role="alertdialog"');
    expect(
      String(
        renderUiComponent(AlertDialogCancel, {
          ...dialogState,
          autoFocus: true,
          children: 'Cancel',
        }),
      ),
    ).toContain('autofocus');
    expect(
      String(
        renderUiComponent(AlertDialogAction, {
          ...dialogState,
          children: 'Delete',
          intent: 'destructive',
        }),
      ),
    ).toContain('data-intent="destructive"');
    expect(
      String(
        renderUiComponent(Avatar, {
          children: renderUiComponent(AvatarImage, {
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
    expect(
      String(renderUiComponent(AvatarFallback, { children: 'AL', status: 'error' })),
    ).toContain('data-state="error"');
    expect(
      String(
        renderUiComponent(CollapsibleTrigger, {
          children: 'Release notes',
          contentId: 'release-notes',
          open: true,
        }),
      ),
    ).toContain('aria-expanded="true"');
    expect(
      String(
        renderUiComponent(CollapsibleContent, {
          children: 'Details',
          contentId: 'release-notes',
          open: true,
        }),
      ),
    ).toContain('id="release-notes"');
    expect(
      String(
        renderUiComponent(DisclosureTrigger, {
          children: 'Show details',
          contentId: 'disclosure-content',
          open: true,
        }),
      ),
    ).toContain('aria-controls="disclosure-content"');
    expect(
      String(
        renderUiComponent(DisclosureContent, {
          children: 'Details',
          contentId: 'disclosure-content',
          open: false,
        }),
      ),
    ).toContain('hidden');
    expect(
      String(renderUiComponent(DialogTrigger, { children: 'Open', contentId: 'dialog-content' })),
    ).toContain('command="show-modal"');
    const dialogContent = String(
      renderUiComponent(DialogContent, {
        children: '<h2 id="dialog-title">Title</h2>',
        contentId: 'dialog-content',
        open: true,
        titleId: 'dialog-title',
      }),
    );
    expect(dialogContent).toContain('aria-labelledby="dialog-title"');
    expect(dialogContent).toContain('closedby="any"');
    expect(String(renderUiComponent(DialogClose, { contentId: 'dialog-content' }))).toContain(
      'command="request-close"',
    );
    expect(
      String(
        renderUiComponent(HoverCardTrigger, {
          children: 'Ada',
          contentId: 'profile-card',
          href: '/team/ada',
          open: true,
        }),
      ),
    ).toContain('kovo-hover-card="profile-card"');
    const disabledHoverCardTrigger = String(
      renderUiComponent(HoverCardTrigger, {
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
      renderUiComponent(HoverCardContent, {
        contentId: 'profile-card',
        open: true,
      }),
    );
    expect(openHoverCardContent).not.toContain('popover=');
    expect(openHoverCardContent).toContain('data-state="open"');
    expect(
      String(
        renderUiComponent(PopoverTrigger, {
          children: 'Filters',
          contentId: 'filters',
          open: true,
        }),
      ),
    ).toContain('popovertarget="filters"');
    expect(
      String(renderUiComponent(PopoverContent, { contentId: 'filters', open: true })),
    ).toContain('popover="auto"');
    expect(
      String(renderUiComponent(TooltipContent, { contentId: 'tip', open: true })),
    ).not.toContain('popover=');
    expect(
      String(renderUiComponent(TooltipTrigger, { children: 'Help', contentId: 'tip', open: true })),
    ).toContain('kovo-tooltip="tip"');
    const disabledTooltipTrigger = String(
      renderUiComponent(TooltipTrigger, {
        children: 'Help',
        contentId: 'tip',
        disabled: true,
        open: false,
      }),
    );
    expect(disabledTooltipTrigger).toContain('data-disabled="" data-state="closed" disabled');
    expect(disabledTooltipTrigger).not.toContain('kovo-tooltip=');
    expect(String(renderUiComponent(TooltipContent, { contentId: 'tip', open: true }))).toContain(
      'role="tooltip"',
    );
    expect(String(renderUiComponent(Meter, { max: 100, value: 84 }))).toContain(
      'data-state="optimum"',
    );
    expect(String(renderUiComponent(Progress, { max: 100, value: null }))).toContain(
      'data-state="indeterminate"',
    );
    expect(
      String(renderUiComponent(Separator, { decorative: false, orientation: 'vertical' })),
    ).toContain('aria-orientation="vertical"');
  });
  it('exports table primitives as styled semantic markup', () => {
    const tableMarkup = String(
      renderUiComponent(Table, {
        caption: 'Invoices',
        children: renderUiComponent(TableBody, { children: undefined }),
      }),
    );
    expect(tableMarkup).toContain('Invoices</caption><tbody');
    expect(tableMarkup).toContain('data-style-src="table.tsx#body"');
    expect(
      String(renderUiComponent(TableHeaderCell, { children: 'Status', scope: 'row' })),
    ).toContain('scope="row">Status</th>');
    expect(String(renderUiComponent(TableCell, { children: '$250.00', colSpan: 2 }))).toContain(
      'colspan="2"',
    );
  });
  it('exports breadcrumb primitives with headless separator attributes', () => {
    expect(String(renderUiComponent(Breadcrumb, { children: '<li>Settings</li>' }))).toContain(
      'aria-label="Breadcrumb"',
    );
    expect(String(renderUiComponent(BreadcrumbItem, { children: 'Settings' }))).toContain(
      '>Settings</li>',
    );
    expect(
      String(renderUiComponent(BreadcrumbLink, { children: 'Account', current: true })),
    ).toContain('aria-current="page"');
    expect(String(renderUiComponent(BreadcrumbSeparator, { children: '>' }))).toContain(
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
    expect(sources).toContain("import { component, type ComponentChild } from '@kovojs/core';");
    expect(sources).toContain("from '@kovojs/headless-ui/");
    expect(sources).not.toContain('kovo-c=');
    expect(sources).not.toContain('data-bind');
    expect(sources).not.toContain('@kovojs-ir');
  });
});
