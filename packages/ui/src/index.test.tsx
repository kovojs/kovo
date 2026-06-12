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
  Kbd,
  Sheet,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  breadcrumbClasses,
  buttonClasses,
  sheetContentClasses,
  tableClasses,
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
    expect(Kbd.name).toBe('kbd');
    expect(Alert.name).toBe('alert');
    expect(Skeleton.name).toBe('skeleton');

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

  it('wraps the headless dialog primitive for a bounded sheet component', () => {
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
    expect(rendered).toContain('left-0 border-r');
    expect(rendered).toContain('command="request-close" commandfor="account-sheet"');
    expect(sheetContentClasses).toContain('right-0 border-l');
  });

  it('keeps vendorable component sources TSX-authored with no lowered IR stamps', () => {
    const sources = [
      'alert.tsx',
      'badge.tsx',
      'breadcrumb.tsx',
      'button.tsx',
      'card.tsx',
      'kbd.tsx',
      'sheet.tsx',
      'skeleton.tsx',
      'table.tsx',
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
