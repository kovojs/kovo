/** @jsxImportSource @kovojs/server */
import { describe, expect, it } from 'vitest';

import {
  commandCloseAttributes,
  commandDialogAttributes,
  commandEmptyAttributes,
  commandInputAttributes,
  commandItemAttributes,
  commandListboxAttributes,
  commandRootAttributes,
  commandTriggerAttributes,
  contextMenuContentAttributes,
  contextMenuGroupAttributes,
  contextMenuItemAttributes,
  contextMenuSeparatorAttributes,
  contextMenuTriggerAttributes,
  dropdownMenuContentAttributes,
  dropdownMenuGroupAttributes,
  dropdownMenuItemAttributes,
  dropdownMenuSeparatorAttributes,
  dropdownMenuTriggerAttributes,
  menubarGroupAttributes,
  menubarItemAttributes,
  menubarRootAttributes,
  menubarSeparatorAttributes,
  menubarSubmenuAttributes,
  navigationMenuContentAttributes,
  navigationMenuIndicatorAttributes,
  navigationMenuItemAttributes,
  navigationMenuLinkAttributes,
  navigationMenuListAttributes,
  navigationMenuRootAttributes,
  navigationMenuTriggerAttributes,
  navigationMenuViewportAttributes,
} from '@kovojs/headless-ui/primitives';
import { mergeCompilerPrimitiveAttrs } from './merge-fixtures-oracle.js';

describe('gallery G5 primitive merge fixtures', () => {
  it('renders a golden command merge with combobox IDREFs and option semantics', () => {
    const state = {
      highlightedValue: 'settings',
      inputValue: 'se',
      items: [
        { label: 'Search docs', value: 'search' },
        { label: 'Settings', value: 'settings' },
      ],
      open: true,
      value: 'settings',
    };
    const input = mergeCompilerPrimitiveAttrs(
      {
        ...commandInputAttributes({
          ...state,
          descriptionId: 'gallery-command-description',
          id: 'gallery-command-input',
          labelledBy: 'gallery-command-label',
          listboxId: 'gallery-command-listbox',
          placeholder: 'Run a command',
        }),
        class: 'command-input',
      },
      {
        'aria-activedescendant': 'author-command-option',
        class: 'command-input text-sm',
        'data-state': 'author-open',
        role: 'searchbox',
        value: 'author query',
      },
    );
    const listbox = mergeCompilerPrimitiveAttrs(
      {
        ...commandListboxAttributes({
          ...state,
          id: 'gallery-command-listbox',
          labelledBy: 'gallery-command-label',
        }),
        class: 'command-listbox',
      },
      {
        class: 'command-listbox max-h-72',
        hidden: false,
        id: 'author-command-listbox',
        role: 'menu',
      },
    );
    const item = mergeCompilerPrimitiveAttrs(
      {
        ...commandItemAttributes({
          ...state,
          id: 'gallery-command-option-1',
          itemLabel: 'Settings',
          itemValue: 'settings',
        }),
        class: 'command-item',
      },
      {
        'aria-selected': 'false',
        class: 'command-item px-2',
        'data-state': 'author-checked',
        role: 'menuitem',
        tabIndex: -1,
      },
    );

    expect(input.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-activedescendant',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(listbox.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-selected',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="command">
        <input {...input.attrs} />
        <div {...listbox.attrs}>
          <div {...item.attrs}>Settings</div>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="command"><input data-state="open" aria-autocomplete="list" aria-expanded="true" autocomplete="off" role="searchbox" type="text" value="author query" aria-activedescendant="author-command-option" aria-controls="gallery-command-listbox" aria-describedby="gallery-command-description" id="gallery-command-input" aria-labelledby="gallery-command-label" placeholder="Run a command" class="command-input text-sm"><div data-state="open" role="menu" id="author-command-listbox" aria-labelledby="gallery-command-label" class="command-listbox max-h-72"><div data-state="active" data-selected="" data-highlighted="" aria-selected="false" role="menuitem" tabIndex="-1" id="gallery-command-option-1" label="Settings" value="settings" class="command-item px-2">Settings</div></div></section>',
    );
  });

  it('renders a golden dropdown-menu merge with menu roles and item overrides', () => {
    const state = {
      highlightedValue: 'profile',
      items: [
        { label: 'Profile', value: 'profile' },
        { disabled: true, label: 'Billing', value: 'billing' },
      ],
      open: true,
    };
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...dropdownMenuTriggerAttributes({
          ...state,
          contentId: 'gallery-dropdown-content',
          id: 'gallery-dropdown-trigger',
        }),
        class: 'dropdown-trigger',
      },
      {
        'aria-controls': 'author-dropdown-content',
        'aria-expanded': 'false',
        class: 'dropdown-trigger px-2',
        type: 'submit',
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...dropdownMenuContentAttributes({
          ...state,
          id: 'gallery-dropdown-content',
          labelledBy: 'gallery-dropdown-trigger',
        }),
        class: 'dropdown-content',
      },
      {
        class: 'dropdown-content shadow',
        id: 'author-dropdown-content',
        role: 'listbox',
      },
    );
    const group = mergeCompilerPrimitiveAttrs(
      {
        ...dropdownMenuGroupAttributes({
          ...state,
          id: 'gallery-dropdown-group',
          labelledBy: 'gallery-dropdown-group-label',
        }),
      },
      {
        'aria-labelledby': 'author-dropdown-group-label',
        class: 'dropdown-group',
        role: 'presentation',
      },
    );
    const item = mergeCompilerPrimitiveAttrs(
      {
        ...dropdownMenuItemAttributes({
          ...state,
          id: 'gallery-dropdown-profile',
          itemLabel: 'Profile',
          itemValue: 'profile',
        }),
        class: 'dropdown-item',
      },
      {
        'aria-disabled': 'true',
        class: 'dropdown-item font-medium',
        role: 'option',
        tabIndex: 5,
        value: 'author-profile',
      },
    );
    const separator = mergeCompilerPrimitiveAttrs(
      dropdownMenuSeparatorAttributes({ id: 'gallery-dropdown-separator' }),
      { role: 'none' },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'aria-expanded',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(group.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(separator.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="dropdown-menu">
        <button {...trigger.attrs}>Account</button>
        <div {...content.attrs}>
          <div {...group.attrs}>
            <div {...item.attrs}>Profile</div>
          </div>
          <div {...separator.attrs}></div>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="dropdown-menu"><button data-state="open" aria-expanded="false" aria-haspopup="menu" type="submit" aria-controls="author-dropdown-content" id="gallery-dropdown-trigger" class="dropdown-trigger px-2">Account</button><div data-state="open" role="listbox" tabIndex="-1" id="author-dropdown-content" aria-labelledby="gallery-dropdown-trigger" class="dropdown-content shadow"><div data-state="open" role="presentation" id="gallery-dropdown-group" aria-labelledby="author-dropdown-group-label" class="dropdown-group"><div data-state="active" data-highlighted="" role="option" tabIndex="5" id="gallery-dropdown-profile" label="Profile" value="author-profile" class="dropdown-item font-medium" aria-disabled="true">Profile</div></div><div role="none" id="gallery-dropdown-separator"></div></div></section>',
    );
  });

  it('renders a golden context-menu merge with behavior IDREFs and anchor coordinates', () => {
    const state = {
      highlightedValue: 'paste',
      items: [
        { label: 'Copy', value: 'copy' },
        { label: 'Paste', value: 'paste' },
        { disabled: true, label: 'Delete', value: 'delete' },
      ],
      open: true,
      point: { x: 32, y: 64 },
    };
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...contextMenuTriggerAttributes({
          ...state,
          contentId: 'gallery-context-content',
          id: 'gallery-context-trigger',
          labelledBy: 'gallery-context-label',
        }),
        class: 'context-trigger',
      },
      {
        'aria-controls': 'author-context-content',
        'aria-expanded': 'false',
        class: 'context-trigger rounded',
        'data-state': 'author-open',
        'kovo-context-menu': 'author-context-content',
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...contextMenuContentAttributes({
          ...state,
          id: 'gallery-context-content',
          labelledBy: 'gallery-context-trigger',
        }),
        class: 'context-content',
      },
      {
        'data-anchor-x': '128',
        class: 'context-content shadow',
        id: 'author-context-content',
        role: 'listbox',
      },
    );
    const group = mergeCompilerPrimitiveAttrs(
      {
        ...contextMenuGroupAttributes({
          ...state,
          id: 'gallery-context-group',
          labelledBy: 'gallery-context-group-label',
        }),
      },
      {
        'aria-labelledby': 'author-context-group-label',
        class: 'context-group',
        role: 'presentation',
      },
    );
    const item = mergeCompilerPrimitiveAttrs(
      {
        ...contextMenuItemAttributes({
          ...state,
          id: 'gallery-context-paste',
          itemLabel: 'Paste',
          itemValue: 'paste',
        }),
        class: 'context-item',
      },
      {
        'aria-disabled': 'true',
        class: 'context-item px-2',
        'data-state': 'author-active',
        role: 'option',
        tabIndex: -1,
        value: 'author-paste',
      },
    );
    const separator = mergeCompilerPrimitiveAttrs(
      contextMenuSeparatorAttributes({ id: 'gallery-context-separator' }),
      { role: 'none' },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
      {
        attr: 'kovo-context-menu',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(group.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(separator.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="context-menu">
        <div {...trigger.attrs}>Canvas</div>
        <div {...content.attrs}>
          <div {...group.attrs}>
            <div {...item.attrs}>Paste</div>
          </div>
          <div {...separator.attrs}></div>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="context-menu"><div data-state="open" aria-expanded="false" aria-haspopup="menu" role="button" aria-controls="author-context-content" kovo-context-menu="author-context-content" id="gallery-context-trigger" aria-labelledby="gallery-context-label" class="context-trigger rounded">Canvas</div><div data-state="open" role="listbox" tabIndex="-1" id="author-context-content" aria-labelledby="gallery-context-trigger" data-anchor-x="128" data-anchor-y="64" class="context-content shadow"><div data-state="open" role="presentation" id="gallery-context-group" aria-labelledby="author-context-group-label" class="context-group"><div data-state="active" data-highlighted="" role="option" tabIndex="-1" id="gallery-context-paste" label="Paste" value="author-paste" class="context-item px-2" aria-disabled="true">Paste</div></div><div role="none" id="gallery-context-separator"></div></div></section>',
    );
  });

  it('renders a golden navigation-menu merge with list-driven content and viewport attrs', () => {
    const state = {
      activeValue: 'products',
      items: [
        { label: 'Products', value: 'products' },
        { disabled: true, label: 'Solutions', value: 'solutions' },
        { label: 'Company', value: 'company' },
      ],
      openValue: 'products',
    };
    const root = mergeCompilerPrimitiveAttrs(
      {
        ...navigationMenuRootAttributes({
          ...state,
          descriptionId: 'gallery-nav-description',
          id: 'gallery-nav-root',
          label: 'Gallery navigation',
        }),
        class: 'navigation-root',
      },
      {
        'aria-label': 'Author nav',
        class: 'navigation-root border',
        'data-state': 'author-open',
        role: 'menubar',
      },
    );
    const list = mergeCompilerPrimitiveAttrs(
      {
        ...navigationMenuListAttributes({ ...state, id: 'gallery-nav-list' }),
        class: 'navigation-list',
      },
      {
        class: 'navigation-list gap-2',
        role: 'menu',
      },
    );
    const item = mergeCompilerPrimitiveAttrs(
      {
        ...navigationMenuItemAttributes({
          ...state,
          id: 'gallery-nav-products-item',
          itemValue: 'products',
        }),
        class: 'navigation-item',
      },
      {
        class: 'navigation-item px-2',
        'data-state': 'author-active',
        role: 'presentation',
      },
    );
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...navigationMenuTriggerAttributes({
          ...state,
          contentId: 'gallery-nav-products-panel',
          id: 'gallery-nav-products-trigger',
          itemLabel: 'Products',
          itemValue: 'products',
        }),
        class: 'navigation-trigger',
      },
      {
        'aria-controls': 'author-nav-products-panel',
        'aria-expanded': 'false',
        class: 'navigation-trigger font-medium',
        disabled: true,
        type: 'submit',
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...navigationMenuContentAttributes({
          id: 'gallery-nav-products-panel',
          labelledBy: 'gallery-nav-products-trigger',
          openValue: 'products',
          value: 'products',
        }),
        class: 'navigation-content',
      },
      {
        class: 'navigation-content shadow',
        id: 'author-nav-products-panel',
        role: 'region',
      },
    );
    const link = mergeCompilerPrimitiveAttrs(
      {
        ...navigationMenuLinkAttributes({
          ...state,
          href: '/company',
          id: 'gallery-nav-company-link',
          itemLabel: 'Company',
          itemValue: 'company',
        }),
        class: 'navigation-link',
      },
      {
        class: 'navigation-link underline',
        href: '/author-company',
        tabIndex: 3,
        value: 'author-company',
      },
    );
    const viewport = mergeCompilerPrimitiveAttrs(
      {
        ...navigationMenuViewportAttributes({ id: 'gallery-nav-viewport', openValue: 'products' }),
        class: 'navigation-viewport',
      },
      {
        class: 'navigation-viewport rounded',
        hidden: true,
      },
    );
    const indicator = mergeCompilerPrimitiveAttrs(
      {
        ...navigationMenuIndicatorAttributes({
          id: 'gallery-nav-indicator',
          openValue: 'products',
        }),
        class: 'navigation-indicator',
      },
      {
        class: 'navigation-indicator accent',
        'data-state': 'author-open',
        hidden: true,
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-label',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(list.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'aria-expanded',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(link.diagnostics).toEqual([]);
    expect(viewport.diagnostics).toEqual([]);
    expect(indicator.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="navigation-menu">
        <nav {...root.attrs}>
          <div {...list.attrs}>
            <div {...item.attrs}>
              <button {...trigger.attrs}>Products</button>
              <div {...content.attrs}>Product links</div>
            </div>
            <a {...link.attrs}>Company</a>
          </div>
          <div {...viewport.attrs}></div>
          <span {...indicator.attrs}></span>
        </nav>
      </section>,
    ).toBe(
      '<section data-gallery-merge="navigation-menu"><nav data-state="open" data-orientation="horizontal" role="menubar" id="gallery-nav-root" aria-label="Author nav" aria-describedby="gallery-nav-description" class="navigation-root border"><div data-state="open" data-orientation="horizontal" role="menu" id="gallery-nav-list" class="navigation-list gap-2"><div data-state="active" data-highlighted="" role="presentation" id="gallery-nav-products-item" class="navigation-item px-2"><button data-state="open" data-highlighted="" aria-expanded="false" aria-haspopup="true" disabled tabIndex="0" type="submit" value="products" aria-controls="author-nav-products-panel" id="gallery-nav-products-trigger" label="Products" class="navigation-trigger font-medium">Products</button><div data-state="open" role="region" tabIndex="-1" id="author-nav-products-panel" aria-labelledby="gallery-nav-products-trigger" class="navigation-content shadow">Product links</div></div><a data-state="inactive" tabIndex="3" value="author-company" href="/author-company" id="gallery-nav-company-link" label="Company" class="navigation-link underline">Company</a></div><div data-state="open" id="gallery-nav-viewport" class="navigation-viewport rounded" hidden></div><span data-state="open" id="gallery-nav-indicator" class="navigation-indicator accent" hidden></span></nav></section>',
    );
  });

  it('renders a golden menubar merge with submenu, group, and separator attrs', () => {
    const state = {
      activeValue: 'file',
      items: [
        { hasPopup: true, label: 'File', value: 'file' },
        { disabled: true, label: 'Edit', value: 'edit' },
      ],
      openValue: 'file',
      orientation: 'horizontal' as const,
    };
    const root = mergeCompilerPrimitiveAttrs(
      {
        ...menubarRootAttributes({
          ...state,
          descriptionId: 'gallery-menubar-help',
          id: 'gallery-menubar',
          label: 'Editor',
        }),
        class: 'menubar-root',
      },
      {
        'aria-label': 'Author editor',
        class: 'menubar-root border',
        role: 'menu',
      },
    );
    const item = mergeCompilerPrimitiveAttrs(
      {
        ...menubarItemAttributes({
          ...state,
          contentId: 'gallery-file-menu',
          id: 'gallery-file-item',
          itemLabel: 'File',
          itemValue: 'file',
        }),
        class: 'menubar-item',
      },
      {
        'aria-controls': 'author-file-menu',
        'aria-expanded': 'false',
        class: 'menubar-item px-2',
        role: 'option',
        value: 'author-file',
      },
    );
    const submenu = mergeCompilerPrimitiveAttrs(
      {
        ...menubarSubmenuAttributes({
          ...state,
          id: 'gallery-file-menu',
          labelledBy: 'gallery-file-item',
          value: 'file',
        }),
        class: 'menubar-submenu',
      },
      {
        class: 'menubar-submenu shadow',
        id: 'author-file-menu',
        role: 'listbox',
      },
    );
    const group = mergeCompilerPrimitiveAttrs(
      {
        ...menubarGroupAttributes({
          ...state,
          id: 'gallery-file-group',
          labelledBy: 'gallery-file-group-label',
        }),
        class: 'menubar-group',
      },
      {
        'aria-labelledby': 'author-file-group-label',
        class: 'menubar-group py-1',
        role: 'presentation',
      },
    );
    const separator = mergeCompilerPrimitiveAttrs(
      menubarSeparatorAttributes({ id: 'gallery-file-separator' }),
      { role: 'none' },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-label',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(submenu.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(group.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(separator.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <nav data-gallery-merge="menubar">
        <div {...root.attrs}>
          <button {...item.attrs}>File</button>
          <div {...submenu.attrs}>
            <div {...group.attrs}>Open</div>
            <div {...separator.attrs}></div>
          </div>
        </div>
      </nav>,
    ).toBe(
      '<nav data-gallery-merge="menubar"><div data-state="open" data-orientation="horizontal" role="menu" id="gallery-menubar" aria-label="Author editor" aria-describedby="gallery-menubar-help" class="menubar-root border"><button data-state="active" data-highlighted="" role="option" tabIndex="0" value="author-file" aria-haspopup="menu" aria-expanded="false" aria-controls="author-file-menu" id="gallery-file-item" label="File" class="menubar-item px-2">File</button><div data-state="open" role="listbox" tabIndex="-1" id="author-file-menu" aria-labelledby="gallery-file-item" class="menubar-submenu shadow"><div data-state="open" data-orientation="horizontal" role="presentation" id="gallery-file-group" aria-labelledby="author-file-group-label" class="menubar-group py-1">Open</div><div role="none" id="gallery-file-separator"></div></div></div></nav>',
    );
  });

  it('renders golden command shell merges across dialog, trigger, close, and empty attrs', () => {
    const state = {
      disabled: false,
      inputValue: 'zz',
      items: [{ label: 'Deploy', value: 'deploy' }],
      open: true,
      value: '',
    };
    const root = mergeCompilerPrimitiveAttrs(
      { ...commandRootAttributes({ ...state, id: 'gallery-command-root' }), class: 'command-root' },
      { class: 'command-root border', 'data-state': 'author-open' },
    );
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...commandTriggerAttributes({
          ...state,
          contentId: 'gallery-command-dialog',
          id: 'gallery-command-trigger',
          labelledBy: 'gallery-command-label',
        }),
        class: 'command-trigger',
      },
      {
        class: 'command-trigger px-2',
        commandfor: 'author-command-dialog',
        type: 'submit',
      },
    );
    const dialog = mergeCompilerPrimitiveAttrs(
      {
        ...commandDialogAttributes({
          ...state,
          contentId: 'gallery-command-dialog',
          descriptionId: 'gallery-command-description',
          titleId: 'gallery-command-title',
        }),
        class: 'command-dialog',
      },
      {
        'aria-modal': 'false',
        class: 'command-dialog shadow',
        id: 'author-command-dialog',
      },
    );
    const close = mergeCompilerPrimitiveAttrs(
      {
        ...commandCloseAttributes({ ...state, contentId: 'gallery-command-dialog' }),
        class: 'command-close',
      },
      {
        class: 'command-close absolute',
        commandfor: 'author-command-dialog',
        disabled: true,
      },
    );
    const empty = mergeCompilerPrimitiveAttrs(
      { ...commandEmptyAttributes({ ...state, id: 'gallery-command-empty' }), class: 'empty' },
      { class: 'empty py-6', hidden: true },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(dialog.diagnostics).toEqual([
      {
        attr: 'aria-modal',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(close.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(empty.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="command-shell">
        <div {...root.attrs}>
          <button {...trigger.attrs}>Open command</button>
          <dialog {...dialog.attrs}>
            <p {...empty.attrs}>No commands</p>
            <button {...close.attrs}>Close</button>
          </dialog>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="command-shell"><div data-state="open" id="gallery-command-root" class="command-root border"><button data-state="open" aria-expanded="true" aria-haspopup="dialog" type="submit" aria-controls="gallery-command-dialog" command="show-modal" commandfor="author-command-dialog" id="gallery-command-trigger" aria-labelledby="gallery-command-label" class="command-trigger px-2">Open command</button><dialog data-state="open" aria-modal="false" id="author-command-dialog" aria-describedby="gallery-command-description" aria-labelledby="gallery-command-title" open class="command-dialog shadow"><p data-empty="" id="gallery-command-empty" class="empty py-6" hidden>No commands</p><button data-state="open" disabled type="button" command="request-close" commandfor="author-command-dialog" class="command-close absolute">Close</button></dialog></div></section>',
    );
  });
});
