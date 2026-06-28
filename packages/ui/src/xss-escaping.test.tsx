import { describe, expect, it } from 'vitest';

import { AutocompleteOption, AutocompleteValue } from './autocomplete.js';
import { Badge } from './badge.js';
import { ComboboxOption, ComboboxValue } from './combobox.js';
import { CommandItem, CommandValue } from './command.js';
import { ContextMenuItem } from './context-menu.js';
import { Drawer as DrawerPanel } from './drawer.js';
import { DropdownMenuItem } from './dropdown-menu.js';
import { MenubarItem } from './menubar.js';
import { SelectItem, SelectValue } from './select.js';
import { Sheet } from './sheet.js';
import { Table, TableBody, TableCell, TableHeaderCell, TableRow } from './table.js';

// SECURITY_FINDINGS.md C1: maintained UI components still accept scalar text props
// in attribute position (e.g. itemLabel={user.name}), so each component must
// HTML-escape any scalar text prop it renders as element children. Unbranded
// string children are escaped by the framework runtime; framework-rendered HTML
// composes through the internal brand.
const PAYLOAD = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';
const ESCAPED_CHILD = '&lt;strong&gt;composed&lt;/strong&gt;';
// A plain string child slot is text, not intentional pre-composed markup.
const RAW_CHILD = '<strong>composed</strong>';
const html = (value: unknown): string => String(value);

describe('@kovojs/ui scalar text props are HTML-escaped (C1 stored-XSS)', () => {
  it('escapes Badge children as text', () => {
    const rendered = html(Badge.definition.render({ children: PAYLOAD }));
    expect(rendered).toContain(ESCAPED);
    expect(rendered).not.toContain(PAYLOAD);
  });

  it('escapes AutocompleteOption itemLabel/itemValue but passes children through raw', () => {
    const escaped = html(
      AutocompleteOption.definition.render({
        itemLabel: PAYLOAD,
        itemValue: 'value',
      }),
    );
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const escapedValue = html(AutocompleteOption.definition.render({ itemValue: PAYLOAD }));
    expect(escapedValue).toContain(ESCAPED);
    expect(escapedValue).not.toContain(PAYLOAD);

    const rawChildren = html(
      AutocompleteOption.definition.render({
        children: RAW_CHILD,
        itemValue: 'value',
      }),
    );
    expect(rawChildren).toContain(ESCAPED_CHILD);
    expect(rawChildren).not.toContain(RAW_CHILD);
  });

  it('escapes AutocompleteValue resolved text', () => {
    const items = [{ label: PAYLOAD, value: 'v1' }];
    const rendered = html(AutocompleteValue.definition.render({ items, value: 'v1' }));
    expect(rendered).toContain(ESCAPED);
    expect(rendered).not.toContain(PAYLOAD);
  });

  it('escapes ComboboxOption itemLabel but passes children through raw', () => {
    const escaped = html(
      ComboboxOption.definition.render({
        itemLabel: PAYLOAD,
        itemValue: 'value',
      }),
    );
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const rawChildren = html(
      ComboboxOption.definition.render({
        children: RAW_CHILD,
        itemValue: 'value',
      }),
    );
    expect(rawChildren).toContain(ESCAPED_CHILD);
    expect(rawChildren).not.toContain(RAW_CHILD);
  });

  it('escapes ComboboxValue resolved text', () => {
    const items = [{ label: PAYLOAD, value: 'v1' }];
    const rendered = html(ComboboxValue.definition.render({ items, value: 'v1' }));
    expect(rendered).toContain(ESCAPED);
    expect(rendered).not.toContain(PAYLOAD);
  });

  it('escapes CommandItem itemLabel but passes children through raw', () => {
    const escaped = html(
      CommandItem.definition.render({
        items: [{ label: PAYLOAD, value: 'value' }],
        itemLabel: PAYLOAD,
        itemValue: 'value',
        listboxId: 'command-listbox',
      }),
    );
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const rawChildren = html(
      CommandItem.definition.render({
        children: RAW_CHILD,
        items: [{ value: 'value' }],
        itemValue: 'value',
        listboxId: 'command-listbox',
      }),
    );
    expect(rawChildren).toContain(ESCAPED_CHILD);
    expect(rawChildren).not.toContain(RAW_CHILD);
  });

  it('escapes CommandValue resolved text', () => {
    const items = [{ label: PAYLOAD, value: 'v1' }];
    const rendered = html(CommandValue.definition.render({ items, value: 'v1' }));
    expect(rendered).toContain(ESCAPED);
    expect(rendered).not.toContain(PAYLOAD);
  });

  it('escapes SelectItem itemLabel but passes children through raw', () => {
    const escaped = html(
      SelectItem.definition.render({
        itemLabel: PAYLOAD,
        itemValue: 'value',
      }),
    );
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const rawChildren = html(
      SelectItem.definition.render({
        children: RAW_CHILD,
        itemValue: 'value',
      }),
    );
    expect(rawChildren).toContain(ESCAPED_CHILD);
    expect(rawChildren).not.toContain(RAW_CHILD);
  });

  it('escapes SelectValue resolved text', () => {
    const items = [{ label: PAYLOAD, value: 'v1' }];
    const rendered = html(SelectValue.definition.render({ items, value: 'v1' }));
    expect(rendered).toContain(ESCAPED);
    expect(rendered).not.toContain(PAYLOAD);
  });

  it('escapes MenubarItem itemLabel but passes children through raw', () => {
    const escaped = html(
      MenubarItem.definition.render({
        itemLabel: PAYLOAD,
        itemValue: 'value',
      }),
    );
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const rawChildren = html(
      MenubarItem.definition.render({
        children: RAW_CHILD,
        itemValue: 'value',
      }),
    );
    expect(rawChildren).toContain(ESCAPED_CHILD);
    expect(rawChildren).not.toContain(RAW_CHILD);
  });

  it('escapes DropdownMenuItem itemLabel/itemValue but passes children through raw', () => {
    const escaped = html(
      DropdownMenuItem.definition.render({
        itemLabel: PAYLOAD,
        itemValue: 'value',
      }),
    );
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const escapedValue = html(DropdownMenuItem.definition.render({ itemValue: PAYLOAD }));
    expect(escapedValue).toContain(ESCAPED);
    expect(escapedValue).not.toContain(PAYLOAD);

    const rawChildren = html(
      DropdownMenuItem.definition.render({
        children: RAW_CHILD,
        itemValue: 'value',
      }),
    );
    expect(rawChildren).toContain(ESCAPED_CHILD);
    expect(rawChildren).not.toContain(RAW_CHILD);
  });

  it('escapes ContextMenuItem itemLabel/itemValue but passes children through raw', () => {
    const escaped = html(
      ContextMenuItem.definition.render({
        itemLabel: PAYLOAD,
        itemValue: 'value',
      }),
    );
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const escapedValue = html(ContextMenuItem.definition.render({ itemValue: PAYLOAD }));
    expect(escapedValue).toContain(ESCAPED);
    expect(escapedValue).not.toContain(PAYLOAD);

    const rawChildren = html(
      ContextMenuItem.definition.render({
        children: RAW_CHILD,
        itemValue: 'value',
      }),
    );
    expect(rawChildren).toContain(ESCAPED_CHILD);
    expect(rawChildren).not.toContain(RAW_CHILD);
  });

  it('escapes Sheet title/description/trigger/closeLabel but passes the body slot through raw', () => {
    const rendered = html(
      Sheet.definition.render({
        children: RAW_CHILD,
        closeLabel: PAYLOAD,
        contentId: 'sheet-1',
        description: PAYLOAD,
        title: PAYLOAD,
        trigger: PAYLOAD,
      }),
    );
    // Three scalar sinks + close label all escaped; payload must never appear unescaped.
    expect(rendered).not.toContain(PAYLOAD);
    expect(rendered).toContain(ESCAPED);
    expect(rendered).toContain(ESCAPED_CHILD);
    expect(rendered).not.toContain(RAW_CHILD);
  });

  it('escapes the standalone Drawer title/description/trigger/closeLabel but passes the body slot through raw', () => {
    const rendered = html(
      DrawerPanel.definition.render({
        children: RAW_CHILD,
        closeLabel: PAYLOAD,
        contentId: 'drawer-2',
        description: PAYLOAD,
        title: PAYLOAD,
        trigger: PAYLOAD,
      }),
    );
    expect(rendered).not.toContain(PAYLOAD);
    expect(rendered).toContain(ESCAPED);
    expect(rendered).toContain(ESCAPED_CHILD);
    expect(rendered).not.toContain(RAW_CHILD);
  });

  it('escapes the Table caption and unbranded structural children as text', () => {
    const rendered = html(
      Table.definition.render({
        caption: PAYLOAD,
        children: RAW_CHILD,
      }),
    );
    expect(rendered).toContain(ESCAPED);
    // The payload must not appear unescaped anywhere, including inside <caption>.
    expect(rendered).not.toContain(PAYLOAD);
    // Unbranded structural children are text, not pre-composed framework markup.
    expect(rendered).toContain(ESCAPED_CHILD);
    expect(rendered).not.toContain(RAW_CHILD);
  });

  it('keeps branded Table structural child composition raw', () => {
    const row = TableRow.definition.render({
      children: TableCell.definition.render({ children: 'Paid' }),
    });
    const body = TableBody.definition.render({ children: row });
    const rendered = html(Table.definition.render({ children: body }));

    expect(rendered).toContain('<tbody');
    expect(rendered).toContain('<tr');
    expect(rendered).toContain('<td');
    expect(rendered).toContain('Paid');
  });

  it('escapes TableCell and TableHeaderCell children as scalar text', () => {
    const cell = html(TableCell.definition.render({ children: PAYLOAD }));
    expect(cell).toContain(ESCAPED);
    expect(cell).not.toContain(PAYLOAD);

    const header = html(TableHeaderCell.definition.render({ children: PAYLOAD }));
    expect(header).toContain(ESCAPED);
    expect(header).not.toContain(PAYLOAD);
  });
});
