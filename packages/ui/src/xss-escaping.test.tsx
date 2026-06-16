import { describe, expect, it } from 'vitest';

import { AutocompleteOption, AutocompleteValue } from './autocomplete.js';
import { ComboboxOption, ComboboxValue } from './combobox.js';
import { CommandItem, CommandValue } from './command.js';
import { Drawer as DrawerPanel } from './drawer.js';
import { MenubarItem } from './menubar.js';
import { SelectItem, SelectValue } from './select.js';
import { Drawer, Sheet } from './sheet.js';
import { Table } from './table.js';

// SECURITY_FINDINGS.md C1: the @kovojs/server JSX runtime emits text children verbatim
// (only attributes are escaped). Apps pass these scalar text props in attribute position
// (e.g. itemLabel={user.name}), which the framework does not escape, so the component must
// HTML-escape any scalar text prop it renders as element children. Composition slots
// (`props.children`) stay raw — they are escaped at the app call site by the compiler.
const PAYLOAD = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';
// A child slot whose content is intentional pre-composed markup must pass through unchanged.
const RAW_CHILD = '<strong>composed</strong>';

describe('@kovojs/ui scalar text props are HTML-escaped (C1 stored-XSS)', () => {
  it('escapes AutocompleteOption itemLabel/itemValue but passes children through raw', () => {
    const escaped = AutocompleteOption.definition.render({
      itemLabel: PAYLOAD,
      itemValue: 'value',
    });
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const escapedValue = AutocompleteOption.definition.render({ itemValue: PAYLOAD });
    expect(escapedValue).toContain(ESCAPED);
    expect(escapedValue).not.toContain(PAYLOAD);

    const rawChildren = AutocompleteOption.definition.render({
      children: RAW_CHILD,
      itemValue: 'value',
    });
    expect(rawChildren).toContain(RAW_CHILD);
  });

  it('escapes AutocompleteValue resolved text', () => {
    const items = [{ label: PAYLOAD, value: 'v1' }];
    const rendered = AutocompleteValue.definition.render({ items, value: 'v1' });
    expect(rendered).toContain(ESCAPED);
    expect(rendered).not.toContain(PAYLOAD);
  });

  it('escapes ComboboxOption itemLabel but passes children through raw', () => {
    const escaped = ComboboxOption.definition.render({
      itemLabel: PAYLOAD,
      itemValue: 'value',
    });
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const rawChildren = ComboboxOption.definition.render({
      children: RAW_CHILD,
      itemValue: 'value',
    });
    expect(rawChildren).toContain(RAW_CHILD);
  });

  it('escapes ComboboxValue resolved text', () => {
    const items = [{ label: PAYLOAD, value: 'v1' }];
    const rendered = ComboboxValue.definition.render({ items, value: 'v1' });
    expect(rendered).toContain(ESCAPED);
    expect(rendered).not.toContain(PAYLOAD);
  });

  it('escapes CommandItem itemLabel but passes children through raw', () => {
    const escaped = CommandItem.definition.render({
      itemLabel: PAYLOAD,
      itemValue: 'value',
    });
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const rawChildren = CommandItem.definition.render({
      children: RAW_CHILD,
      itemValue: 'value',
    });
    expect(rawChildren).toContain(RAW_CHILD);
  });

  it('escapes CommandValue resolved text', () => {
    const items = [{ label: PAYLOAD, value: 'v1' }];
    const rendered = CommandValue.definition.render({ items, value: 'v1' });
    expect(rendered).toContain(ESCAPED);
    expect(rendered).not.toContain(PAYLOAD);
  });

  it('escapes SelectItem itemLabel but passes children through raw', () => {
    const escaped = SelectItem.definition.render({
      itemLabel: PAYLOAD,
      itemValue: 'value',
    });
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const rawChildren = SelectItem.definition.render({
      children: RAW_CHILD,
      itemValue: 'value',
    });
    expect(rawChildren).toContain(RAW_CHILD);
  });

  it('escapes SelectValue resolved text', () => {
    const items = [{ label: PAYLOAD, value: 'v1' }];
    const rendered = SelectValue.definition.render({ items, value: 'v1' });
    expect(rendered).toContain(ESCAPED);
    expect(rendered).not.toContain(PAYLOAD);
  });

  it('escapes MenubarItem itemLabel but passes children through raw', () => {
    const escaped = MenubarItem.definition.render({
      itemLabel: PAYLOAD,
      itemValue: 'value',
    });
    expect(escaped).toContain(ESCAPED);
    expect(escaped).not.toContain(PAYLOAD);

    const rawChildren = MenubarItem.definition.render({
      children: RAW_CHILD,
      itemValue: 'value',
    });
    expect(rawChildren).toContain(RAW_CHILD);
  });

  it('escapes Sheet title/description/trigger/closeLabel but passes the body slot through raw', () => {
    const rendered = Sheet.definition.render({
      children: RAW_CHILD,
      closeLabel: PAYLOAD,
      contentId: 'sheet-1',
      description: PAYLOAD,
      title: PAYLOAD,
      trigger: PAYLOAD,
    });
    // Three scalar sinks + close label all escaped; payload must never appear unescaped.
    expect(rendered).not.toContain(PAYLOAD);
    expect(rendered).toContain(ESCAPED);
    // Body composition slot is left raw (app escapes it at the call site).
    expect(rendered).toContain(RAW_CHILD);
  });

  it('escapes Drawer (sheet) title/description/trigger/closeLabel but passes the body slot through raw', () => {
    const rendered = Drawer.definition.render({
      children: RAW_CHILD,
      closeLabel: PAYLOAD,
      contentId: 'drawer-1',
      description: PAYLOAD,
      title: PAYLOAD,
      trigger: PAYLOAD,
    });
    expect(rendered).not.toContain(PAYLOAD);
    expect(rendered).toContain(ESCAPED);
    expect(rendered).toContain(RAW_CHILD);
  });

  it('escapes the standalone Drawer title/description/trigger/closeLabel but passes the body slot through raw', () => {
    const rendered = DrawerPanel.definition.render({
      children: RAW_CHILD,
      closeLabel: PAYLOAD,
      contentId: 'drawer-2',
      description: PAYLOAD,
      title: PAYLOAD,
      trigger: PAYLOAD,
    });
    expect(rendered).not.toContain(PAYLOAD);
    expect(rendered).toContain(ESCAPED);
    expect(rendered).toContain(RAW_CHILD);
  });

  it('escapes the Table caption but passes the table body children through raw', () => {
    const rendered = Table.definition.render({
      caption: PAYLOAD,
      children: RAW_CHILD,
    });
    expect(rendered).toContain(ESCAPED);
    // The payload must not appear unescaped anywhere, including inside <caption>.
    expect(rendered).not.toContain(PAYLOAD);
    // The app-composed body children are emitted raw.
    expect(rendered).toContain(RAW_CHILD);
  });
});
