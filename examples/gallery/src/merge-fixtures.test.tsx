/** @jsxImportSource @jiso/server */
import { describe, expect, it } from 'vitest';

import * as primitiveExports from '@jiso/headless-ui/primitives';
import {
  accordionContentAttributes,
  accordionTriggerAttributes,
  alertDialogActionAttributes,
  alertDialogCancelAttributes,
  alertDialogContentAttributes,
  alertDialogTriggerAttributes,
  autocompleteInputAttributes,
  autocompleteListAttributes,
  autocompleteOptionAttributes,
  autocompleteValueAttributes,
  avatarFallbackAttributes,
  avatarImageAttributes,
  avatarRootAttributes,
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupLabelAttributes,
  checkboxGroupRootAttributes,
  checkboxRootAttributes,
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerAttributes,
  commandCloseAttributes,
  commandDialogAttributes,
  commandEmptyAttributes,
  commandInputAttributes,
  commandItemAttributes,
  commandListboxAttributes,
  commandRootAttributes,
  commandTriggerAttributes,
  comboboxInputAttributes,
  comboboxListboxAttributes,
  comboboxOptionAttributes,
  contextMenuContentAttributes,
  contextMenuGroupAttributes,
  contextMenuItemAttributes,
  contextMenuSeparatorAttributes,
  contextMenuTriggerAttributes,
  disclosureContentAttributes,
  disclosureRootAttributes,
  disclosureTriggerAttributes,
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
  dropdownMenuContentAttributes,
  dropdownMenuGroupAttributes,
  dropdownMenuItemAttributes,
  dropdownMenuSeparatorAttributes,
  dropdownMenuTriggerAttributes,
  fieldControlAttributes,
  fieldLabelAttributes,
  fieldRootAttributes,
  fieldsetLegendAttributes,
  fieldsetRootAttributes,
  hoverCardContentAttributes,
  hoverCardTriggerAttributes,
  menubarGroupAttributes,
  menubarItemAttributes,
  menubarRootAttributes,
  menubarSeparatorAttributes,
  menubarSubmenuAttributes,
  numberFieldIncrementAttributes,
  numberFieldInputAttributes,
  meterRootAttributes,
  navigationMenuContentAttributes,
  navigationMenuIndicatorAttributes,
  navigationMenuItemAttributes,
  navigationMenuLinkAttributes,
  navigationMenuListAttributes,
  navigationMenuRootAttributes,
  navigationMenuTriggerAttributes,
  navigationMenuViewportAttributes,
  otpFieldHiddenInputAttributes,
  otpFieldInputAttributes,
  otpFieldRootAttributes,
  popoverContentAttributes,
  popoverTriggerAttributes,
  progressRootAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  scrollAreaCornerAttributes,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaThumbAttributes,
  scrollAreaViewportAttributes,
  separatorRootAttributes,
  selectContentAttributes,
  selectItemAttributes,
  selectRootAttributes,
  selectTriggerAttributes,
  selectValueAttributes,
  sliderInputAttributes,
  sliderThumbAttributes,
  sliderTrackAttributes,
  switchRootAttributes,
  tabsPanelAttributes,
  tabsTriggerAttributes,
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
  toastActionAttributes,
  toastCloseAttributes,
  toastDescriptionAttributes,
  toastRootAttributes,
  toastTitleAttributes,
  toastViewportAttributes,
  toggleGroupButtonAttributes,
  toggleGroupItemAttributes,
  toggleGroupRootAttributes,
  tooltipTriggerAttributes,
  toggleRootAttributes,
} from '@jiso/headless-ui/primitives';

type AttributeValue = boolean | number | string | undefined;
type AttributeRecord = Readonly<Record<string, AttributeValue>>;

interface MergeDiagnostic {
  attr: string;
  code: 'FW231' | 'FW232' | 'FW233';
  message: string;
}

interface MergeFixtureResult {
  attrs: Record<string, AttributeValue>;
  diagnostics: readonly MergeDiagnostic[];
}

const idrefAttributes = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-owns',
  'commandfor',
  'for',
  'jiso-context-menu',
  'jiso-hover-card',
  'jiso-tooltip',
  'popovertarget',
]);

const logicalOrAttributes = new Set(['aria-disabled', 'disabled', 'readonly', 'required']);

const primitiveAttributeBuilderNames = [
  'accordionContentAttributes',
  'accordionHeaderAttributes',
  'accordionItemAttributes',
  'accordionRootAttributes',
  'accordionTriggerAttributes',
  'alertDialogActionAttributes',
  'alertDialogCancelAttributes',
  'alertDialogContentAttributes',
  'alertDialogRootAttributes',
  'alertDialogTriggerAttributes',
  'autocompleteInputAttributes',
  'autocompleteListAttributes',
  'autocompleteOptionAttributes',
  'autocompleteRootAttributes',
  'autocompleteValueAttributes',
  'avatarFallbackAttributes',
  'avatarImageAttributes',
  'avatarRootAttributes',
  'checkboxGroupControlAttributes',
  'checkboxGroupItemAttributes',
  'checkboxGroupLabelAttributes',
  'checkboxGroupRootAttributes',
  'checkboxRootAttributes',
  'collapsibleContentAttributes',
  'collapsibleRootAttributes',
  'collapsibleTriggerAttributes',
  'comboboxInputAttributes',
  'comboboxListboxAttributes',
  'comboboxOptionAttributes',
  'comboboxRootAttributes',
  'comboboxValueAttributes',
  'commandCloseAttributes',
  'commandDialogAttributes',
  'commandEmptyAttributes',
  'commandInputAttributes',
  'commandItemAttributes',
  'commandListboxAttributes',
  'commandRootAttributes',
  'commandTriggerAttributes',
  'contextMenuContentAttributes',
  'contextMenuGroupAttributes',
  'contextMenuItemAttributes',
  'contextMenuRootAttributes',
  'contextMenuSeparatorAttributes',
  'contextMenuTriggerAttributes',
  'dialogCloseAttributes',
  'dialogContentAttributes',
  'dialogRootAttributes',
  'dialogTriggerAttributes',
  'disclosureContentAttributes',
  'disclosureRootAttributes',
  'disclosureTriggerAttributes',
  'dropdownMenuContentAttributes',
  'dropdownMenuGroupAttributes',
  'dropdownMenuItemAttributes',
  'dropdownMenuRootAttributes',
  'dropdownMenuSeparatorAttributes',
  'dropdownMenuTriggerAttributes',
  'fieldControlAttributes',
  'fieldDescriptionAttributes',
  'fieldErrorAttributes',
  'fieldLabelAttributes',
  'fieldRootAttributes',
  'fieldsetLegendAttributes',
  'fieldsetRootAttributes',
  'hoverCardContentAttributes',
  'hoverCardRootAttributes',
  'hoverCardTriggerAttributes',
  'menubarGroupAttributes',
  'menubarItemAttributes',
  'menubarRootAttributes',
  'menubarSeparatorAttributes',
  'menubarSubmenuAttributes',
  'meterRootAttributes',
  'navigationMenuContentAttributes',
  'navigationMenuIndicatorAttributes',
  'navigationMenuItemAttributes',
  'navigationMenuLinkAttributes',
  'navigationMenuListAttributes',
  'navigationMenuRootAttributes',
  'navigationMenuTriggerAttributes',
  'navigationMenuViewportAttributes',
  'numberFieldDecrementAttributes',
  'numberFieldIncrementAttributes',
  'numberFieldInputAttributes',
  'numberFieldRootAttributes',
  'otpFieldHiddenInputAttributes',
  'otpFieldInputAttributes',
  'otpFieldRootAttributes',
  'popoverContentAttributes',
  'popoverRootAttributes',
  'popoverTriggerAttributes',
  'progressRootAttributes',
  'radioGroupItemAttributes',
  'radioGroupLabelAttributes',
  'radioGroupRadioAttributes',
  'radioGroupRootAttributes',
  'scrollAreaCornerAttributes',
  'scrollAreaRootAttributes',
  'scrollAreaScrollbarAttributes',
  'scrollAreaThumbAttributes',
  'scrollAreaViewportAttributes',
  'selectContentAttributes',
  'selectItemAttributes',
  'selectRootAttributes',
  'selectTriggerAttributes',
  'selectValueAttributes',
  'separatorRootAttributes',
  'sliderInputAttributes',
  'sliderRangeAttributes',
  'sliderRootAttributes',
  'sliderThumbAttributes',
  'sliderTrackAttributes',
  'switchRootAttributes',
  'tabsListAttributes',
  'tabsPanelAttributes',
  'tabsRootAttributes',
  'tabsTriggerAttributes',
  'toastActionAttributes',
  'toastCloseAttributes',
  'toastDescriptionAttributes',
  'toastRootAttributes',
  'toastTitleAttributes',
  'toastViewportAttributes',
  'toggleGroupButtonAttributes',
  'toggleGroupItemAttributes',
  'toggleGroupRootAttributes',
  'toggleRootAttributes',
  'toolbarButtonAttributes',
  'toolbarItemAttributes',
  'toolbarRootAttributes',
  'tooltipContentAttributes',
  'tooltipRootAttributes',
  'tooltipTriggerAttributes',
] as const;

describe('gallery G5 primitive merge fixtures', () => {
  it('renders a golden accordion merge with primitive-owned state and authored ARIA overrides', () => {
    const state = {
      orientation: 'vertical' as const,
      type: 'multiple' as const,
      value: ['shipping'],
    };
    const trigger = mergePrimitiveAttrs(
      {
        ...accordionTriggerAttributes({
          ...state,
          contentId: 'gallery-accordion-shipping-panel',
          itemValue: 'shipping',
          triggerId: 'gallery-accordion-shipping-trigger',
        }),
        class: 'accordion-trigger',
      },
      {
        'aria-expanded': 'false',
        class: 'accordion-trigger font-medium',
        'data-state': 'author-open',
        disabled: true,
        id: 'author-accordion-trigger',
      },
    );
    const content = mergePrimitiveAttrs(
      {
        ...accordionContentAttributes({
          ...state,
          contentId: 'gallery-accordion-shipping-panel',
          itemValue: 'shipping',
          triggerId: 'gallery-accordion-shipping-trigger',
        }),
        class: 'accordion-panel',
      },
      {
        class: 'accordion-panel px-3',
        id: 'author-accordion-panel',
        role: 'group',
      },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="accordion">
        <button {...trigger.attrs}>Shipping</button>
        <div {...content.attrs}>Ships soon.</div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="accordion"><button data-state="open" aria-expanded="false" disabled type="button" aria-controls="gallery-accordion-shipping-panel" id="author-accordion-trigger" class="accordion-trigger font-medium">Shipping</button><div data-state="open" id="author-accordion-panel" aria-labelledby="gallery-accordion-shipping-trigger" role="group" class="accordion-panel px-3">Ships soon.</div></section>',
    );
  });

  it('renders a golden avatar merge with fallback scalar and semantic root overrides', () => {
    const root = mergePrimitiveAttrs(
      {
        ...avatarRootAttributes({
          label: 'Ada Lovelace avatar',
          src: '/avatars/ada.png',
          status: 'loading',
        }),
        class: 'avatar-root',
      },
      {
        'aria-label': 'Author label',
        class: 'avatar-root rounded-full',
        'data-state': 'author-loading',
        role: 'figure',
      },
    );
    const fallback = mergePrimitiveAttrs(
      {
        ...avatarFallbackAttributes({
          delayMs: 250,
          src: '/avatars/ada.png',
          status: 'loaded',
        }),
        class: 'avatar-fallback',
      },
      {
        class: 'avatar-fallback text-xs',
        'data-state': 'author-loaded',
        hidden: false,
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-label',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(fallback.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <div data-gallery-merge="avatar">
        <span {...root.attrs}>
          <span {...fallback.attrs}>AL</span>
        </span>
      </div>,
    ).toBe(
      '<div data-gallery-merge="avatar"><span data-state="loading" aria-label="Author label" role="figure" class="avatar-root rounded-full"><span data-state="loaded" data-delay="250" class="avatar-fallback text-xs">AL</span></span></div>',
    );
  });

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
    const input = mergePrimitiveAttrs(
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
    const listbox = mergePrimitiveAttrs(
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
    const item = mergePrimitiveAttrs(
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
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-activedescendant',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(listbox.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-selected',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
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
    const trigger = mergePrimitiveAttrs(
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
    const content = mergePrimitiveAttrs(
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
    const group = mergePrimitiveAttrs(
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
    const item = mergePrimitiveAttrs(
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
    const separator = mergePrimitiveAttrs(
      dropdownMenuSeparatorAttributes({ id: 'gallery-dropdown-separator' }),
      { role: 'none' },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(group.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(separator.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
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
    const trigger = mergePrimitiveAttrs(
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
        'jiso-context-menu': 'author-context-content',
      },
    );
    const content = mergePrimitiveAttrs(
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
    const group = mergePrimitiveAttrs(
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
    const item = mergePrimitiveAttrs(
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
    const separator = mergePrimitiveAttrs(
      contextMenuSeparatorAttributes({ id: 'gallery-context-separator' }),
      { role: 'none' },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
      {
        attr: 'jiso-context-menu',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(group.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(separator.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
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
      '<section data-gallery-merge="context-menu"><div data-state="open" aria-expanded="false" aria-haspopup="menu" role="button" aria-controls="author-context-content" jiso-context-menu="author-context-content" id="gallery-context-trigger" aria-labelledby="gallery-context-label" class="context-trigger rounded">Canvas</div><div data-state="open" role="listbox" tabIndex="-1" id="author-context-content" aria-labelledby="gallery-context-trigger" data-anchor-x="128" data-anchor-y="64" class="context-content shadow"><div data-state="open" role="presentation" id="gallery-context-group" aria-labelledby="author-context-group-label" class="context-group"><div data-state="active" data-highlighted="" role="option" tabIndex="-1" id="gallery-context-paste" label="Paste" value="author-paste" class="context-item px-2" aria-disabled="true">Paste</div></div><div role="none" id="gallery-context-separator"></div></div></section>',
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
    const root = mergePrimitiveAttrs(
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
    const list = mergePrimitiveAttrs(
      {
        ...navigationMenuListAttributes({ ...state, id: 'gallery-nav-list' }),
        class: 'navigation-list',
      },
      {
        class: 'navigation-list gap-2',
        role: 'menu',
      },
    );
    const item = mergePrimitiveAttrs(
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
    const trigger = mergePrimitiveAttrs(
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
    const content = mergePrimitiveAttrs(
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
    const link = mergePrimitiveAttrs(
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
    const viewport = mergePrimitiveAttrs(
      {
        ...navigationMenuViewportAttributes({ id: 'gallery-nav-viewport', openValue: 'products' }),
        class: 'navigation-viewport',
      },
      {
        class: 'navigation-viewport rounded',
        hidden: true,
      },
    );
    const indicator = mergePrimitiveAttrs(
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
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-label',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(list.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(link.diagnostics).toEqual([]);
    expect(viewport.diagnostics).toEqual([]);
    expect(indicator.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
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

  it('renders a golden combobox merge with active descendant and option conflicts', () => {
    const state = {
      highlightedValue: 'enterprise',
      invalid: true,
      items: [
        { label: 'Starter', value: 'starter' },
        { label: 'Enterprise', value: 'enterprise' },
      ],
      listboxId: 'gallery-combobox-listbox',
      name: 'gallery-plan',
      open: true,
      required: true,
      value: 'enterprise',
    };
    const input = mergePrimitiveAttrs(
      {
        ...comboboxInputAttributes({
          ...state,
          descriptionId: 'gallery-combobox-description',
          errorId: 'gallery-combobox-error',
          id: 'gallery-combobox-input',
          labelledBy: 'gallery-combobox-label',
          placeholder: 'Choose a plan',
        }),
        class: 'combobox-input',
      },
      {
        'aria-describedby': 'author-combobox-description',
        class: 'combobox-input rounded',
        'data-state': 'author-open',
        name: 'author-plan',
        required: false,
      },
    );
    const listbox = mergePrimitiveAttrs(
      {
        ...comboboxListboxAttributes({
          ...state,
          id: 'gallery-combobox-listbox',
          labelledBy: 'gallery-combobox-label',
        }),
        class: 'combobox-listbox',
      },
      {
        class: 'combobox-listbox shadow',
        role: 'menu',
      },
    );
    const option = mergePrimitiveAttrs(
      {
        ...comboboxOptionAttributes({
          ...state,
          id: 'gallery-combobox-option-1',
          itemLabel: 'Enterprise',
          itemValue: 'enterprise',
        }),
        class: 'combobox-option',
      },
      {
        'aria-selected': 'false',
        class: 'combobox-option font-medium',
        'data-state': 'author-selected',
        role: 'menuitem',
      },
    );

    expect(input.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(listbox.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(option.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-selected',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="combobox">
        <input {...input.attrs} />
        <div {...listbox.attrs}>
          <div {...option.attrs}>Enterprise</div>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="combobox"><input data-state="open" data-invalid="" data-required="" aria-autocomplete="list" aria-expanded="true" role="combobox" type="text" value="enterprise" aria-activedescendant="gallery-combobox-listbox-option-1" aria-controls="gallery-combobox-listbox" id="gallery-combobox-input" aria-labelledby="gallery-combobox-label" aria-describedby="author-combobox-description" aria-invalid="true" name="author-plan" placeholder="Choose a plan" required class="combobox-input rounded"><div data-state="open" data-invalid="" data-required="" role="menu" id="gallery-combobox-listbox" aria-labelledby="gallery-combobox-label" class="combobox-listbox shadow"><div data-state="checked" data-highlighted="" aria-selected="false" role="menuitem" id="gallery-combobox-option-1" label="Enterprise" value="enterprise" class="combobox-option font-medium">Enterprise</div></div></section>',
    );
  });

  it('renders a golden autocomplete merge with native datalist attrs and value display', () => {
    const state = {
      highlightedValue: 'chicago',
      inputValue: 'chi',
      invalid: true,
      items: [
        { label: 'Austin', value: 'austin' },
        { disabled: true, label: 'Boston', value: 'boston' },
        { textValue: 'Chicago city', value: 'chicago' },
      ],
      listId: 'gallery-autocomplete-list',
      name: 'gallery-city',
      open: true,
      required: true,
      value: 'austin',
    };
    const input = mergePrimitiveAttrs(
      {
        ...autocompleteInputAttributes({
          ...state,
          descriptionId: 'gallery-autocomplete-description',
          errorId: 'gallery-autocomplete-error',
          id: 'gallery-autocomplete-input',
          labelledBy: 'gallery-autocomplete-label',
          placeholder: 'Choose a city',
        }),
        class: 'autocomplete-input',
      },
      {
        'aria-describedby': 'author-autocomplete-help',
        autocomplete: 'name',
        class: 'autocomplete-input rounded',
        'data-state': 'author-open',
        name: 'author-city',
        required: false,
        role: 'searchbox',
      },
    );
    const list = mergePrimitiveAttrs(
      {
        ...autocompleteListAttributes({
          ...state,
          id: 'gallery-autocomplete-list',
          labelledBy: 'gallery-autocomplete-label',
        }),
        class: 'autocomplete-list',
      },
      {
        class: 'autocomplete-list shadow',
        id: 'author-autocomplete-list',
      },
    );
    const option = mergePrimitiveAttrs(
      {
        ...autocompleteOptionAttributes({
          ...state,
          id: 'gallery-autocomplete-option-2',
          itemLabel: 'Chicago',
          itemValue: 'chicago',
        }),
        class: 'autocomplete-option',
      },
      {
        class: 'autocomplete-option font-medium',
        'data-state': 'author-selected',
        disabled: true,
        label: 'Author Chicago',
        selected: true,
      },
    );
    const value = mergePrimitiveAttrs(
      {
        ...autocompleteValueAttributes({
          id: 'gallery-autocomplete-value',
          placeholder: 'Choose a city',
          value: '',
        }),
        class: 'autocomplete-value',
      },
      {
        class: 'autocomplete-value text-muted',
        'data-placeholder': 'author-placeholder',
        id: 'author-autocomplete-value',
      },
    );

    expect(input.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(list.diagnostics).toEqual([]);
    expect(option.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(value.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="autocomplete">
        <input {...input.attrs} />
        <datalist {...list.attrs}>
          <option {...option.attrs}>Chicago</option>
        </datalist>
        <span {...value.attrs}>Choose a city</span>
      </section>,
    ).toBe(
      '<section data-gallery-merge="autocomplete"><input data-state="open" data-invalid="" data-required="" aria-autocomplete="list" aria-expanded="true" autocomplete="name" role="searchbox" type="text" value="chi" aria-activedescendant="gallery-autocomplete-list-option-2" aria-controls="gallery-autocomplete-list" list="gallery-autocomplete-list" id="gallery-autocomplete-input" aria-labelledby="gallery-autocomplete-label" aria-describedby="author-autocomplete-help" aria-invalid="true" name="author-city" placeholder="Choose a city" required class="autocomplete-input rounded"><datalist data-state="open" data-invalid="" data-required="" id="author-autocomplete-list" aria-labelledby="gallery-autocomplete-label" class="autocomplete-list shadow"><option data-state="unchecked" data-highlighted="" disabled selected value="chicago" id="gallery-autocomplete-option-2" label="Author Chicago" class="autocomplete-option font-medium">Chicago</option></datalist><span data-placeholder="author-placeholder" id="author-autocomplete-value" class="autocomplete-value text-muted">Choose a city</span></section>',
    );
  });

  it('renders a golden slider merge with native range input and decorative parts', () => {
    const state = {
      invalid: true,
      max: 10,
      min: 0,
      name: 'gallery-volume',
      orientation: 'vertical' as const,
      required: true,
      step: 2,
      value: 6,
    };
    const input = mergePrimitiveAttrs(
      {
        ...sliderInputAttributes({
          ...state,
          descriptionId: 'gallery-slider-description',
          errorId: 'gallery-slider-error',
          id: 'gallery-slider-input',
          labelledBy: 'gallery-slider-label',
          valueText: '60 percent',
        }),
        class: 'slider-input',
      },
      {
        'aria-orientation': 'horizontal',
        class: 'slider-input sr-only',
        'data-value': 'author-value',
        max: 12,
        name: 'author-volume',
        required: false,
      },
    );
    const track = mergePrimitiveAttrs(
      {
        ...sliderTrackAttributes({ ...state, id: 'gallery-slider-track' }),
        class: 'slider-track',
      },
      {
        'aria-hidden': 'false',
        class: 'slider-track h-24',
        role: 'presentation',
      },
    );
    const thumb = mergePrimitiveAttrs(
      {
        ...sliderThumbAttributes({ ...state, id: 'gallery-slider-thumb' }),
        class: 'slider-thumb',
      },
      {
        class: 'slider-thumb shadow',
        'data-value-ratio': 'author-ratio',
      },
    );

    expect(input.diagnostics).toEqual([
      {
        attr: 'aria-orientation',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(track.diagnostics).toEqual([
      {
        attr: 'aria-hidden',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(thumb.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="slider">
        <input {...input.attrs} />
        <div {...track.attrs}>
          <span {...thumb.attrs} />
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="slider"><input data-orientation="vertical" data-invalid="" data-required="" data-max="10" data-min="0" data-value="author-value" aria-describedby="gallery-slider-description gallery-slider-error" aria-invalid="true" aria-orientation="horizontal" aria-labelledby="gallery-slider-label" aria-valuetext="60 percent" id="gallery-slider-input" max="12" min="0" name="author-volume" required step="2" type="range" value="6" class="slider-input sr-only"><div data-orientation="vertical" data-invalid="" data-required="" data-max="10" data-min="0" data-value="6" aria-hidden="false" data-part="track" data-value-ratio="0.6" id="gallery-slider-track" class="slider-track h-24" role="presentation"><span data-orientation="vertical" data-invalid="" data-required="" data-max="10" data-min="0" data-value="6" aria-hidden="true" data-part="thumb" data-value-ratio="author-ratio" id="gallery-slider-thumb" class="slider-thumb shadow"></span></div></section>',
    );
  });

  it('renders a golden toast merge with live-region roles and action buttons', () => {
    const state = { id: 'gallery-toast', open: true };
    const viewport = mergePrimitiveAttrs(
      {
        ...toastViewportAttributes({
          id: 'gallery-toast-viewport',
          label: 'Gallery notifications',
          placement: 'top-end',
        }),
        class: 'toast-viewport',
      },
      {
        'aria-label': 'Author notifications',
        class: 'toast-viewport fixed',
        role: 'log',
        tabIndex: 0,
      },
    );
    const root = mergePrimitiveAttrs(
      {
        ...toastRootAttributes({
          ...state,
          descriptionId: 'gallery-toast-description',
          politeness: 'assertive',
          titleId: 'gallery-toast-title',
          variant: 'error',
        }),
        class: 'toast-root',
      },
      {
        'aria-live': 'polite',
        class: 'toast-root border',
        'data-state': 'author-open',
        role: 'status',
      },
    );
    const action = mergePrimitiveAttrs(
      {
        ...toastActionAttributes({ ...state, actionValue: 'retry' }),
        class: 'toast-action',
      },
      {
        class: 'toast-action underline',
        disabled: true,
        type: 'submit',
      },
    );
    const close = mergePrimitiveAttrs(
      {
        ...toastCloseAttributes(state),
        class: 'toast-close',
      },
      {
        class: 'toast-close absolute',
        'data-dismiss': 'author-dismiss',
      },
    );

    expect(viewport.diagnostics).toEqual([
      {
        attr: 'aria-label',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-live',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(action.diagnostics).toEqual([]);
    expect(close.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="toast">
        <div {...viewport.attrs}>
          <article {...root.attrs}>
            <button {...action.attrs}>Retry</button>
            <button {...close.attrs}>Dismiss</button>
          </article>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="toast"><div data-placement="top-end" aria-label="Author notifications" role="log" tabIndex="0" id="gallery-toast-viewport" class="toast-viewport fixed"><article data-state="open" data-variant="error" aria-atomic="true" aria-live="polite" aria-describedby="gallery-toast-description" aria-labelledby="gallery-toast-title" id="gallery-toast" role="status" class="toast-root border"><button data-state="open" data-variant="default" data-action="" disabled type="submit" value="retry" class="toast-action underline">Retry</button><button data-state="open" data-variant="default" data-dismiss="author-dismiss" type="button" class="toast-close absolute">Dismiss</button></article></div></section>',
    );
  });

  it('renders a golden alert-dialog merge with command wiring and action intents', () => {
    const trigger = mergePrimitiveAttrs(
      {
        ...alertDialogTriggerAttributes({
          contentId: 'gallery-delete-dialog',
          open: true,
        }),
        class: 'alert-dialog-trigger',
      },
      {
        'aria-expanded': 'false',
        class: 'alert-dialog-trigger destructive',
        commandfor: 'author-delete-dialog',
        'data-state': 'author-open',
      },
    );
    const content = mergePrimitiveAttrs(
      {
        ...alertDialogContentAttributes({
          contentId: 'gallery-delete-dialog',
          descriptionId: 'gallery-delete-description',
          open: true,
          titleId: 'gallery-delete-title',
        }),
        class: 'alert-dialog-panel',
      },
      {
        'aria-describedby': 'author-delete-description',
        class: 'alert-dialog-panel shadow-xl',
        id: 'author-delete-dialog',
        role: 'dialog',
      },
    );
    const cancel = mergePrimitiveAttrs(
      {
        ...alertDialogCancelAttributes({
          autoFocus: true,
          contentId: 'gallery-delete-dialog',
          open: true,
        }),
        class: 'alert-dialog-cancel',
      },
      {
        autofocus: false,
        class: 'alert-dialog-cancel muted',
        commandfor: 'author-delete-dialog',
        type: 'submit',
      },
    );
    const action = mergePrimitiveAttrs(
      {
        ...alertDialogActionAttributes({
          contentId: 'gallery-delete-dialog',
          intent: 'destructive',
          open: true,
        }),
        class: 'alert-dialog-action',
      },
      {
        class: 'alert-dialog-action danger',
        'data-intent': 'author-danger',
        disabled: true,
      },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'commandfor',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(cancel.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(action.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="alert-dialog">
        <button {...trigger.attrs}>Delete</button>
        <dialog {...content.attrs}>
          <button {...cancel.attrs}>Cancel</button>
          <button {...action.attrs}>Confirm</button>
        </dialog>
      </section>,
    ).toBe(
      '<section data-gallery-merge="alert-dialog"><button data-state="open" aria-expanded="false" aria-haspopup="dialog" type="button" aria-controls="gallery-delete-dialog" command="show-modal" commandfor="author-delete-dialog" class="alert-dialog-trigger destructive">Delete</button><dialog data-state="open" aria-modal="true" open role="dialog" id="author-delete-dialog" aria-labelledby="gallery-delete-title" aria-describedby="author-delete-description" class="alert-dialog-panel shadow-xl"><button data-state="open" data-intent="cancel" type="submit" command="request-close" commandfor="author-delete-dialog" class="alert-dialog-cancel muted">Cancel</button><button data-state="open" data-intent="author-danger" disabled type="button" command="request-close" commandfor="gallery-delete-dialog" class="alert-dialog-action danger">Confirm</button></dialog></section>',
    );
  });

  it('renders a golden popover merge with native popover target conflicts', () => {
    const trigger = mergePrimitiveAttrs(
      {
        ...popoverTriggerAttributes({
          contentId: 'gallery-account-popover',
          open: false,
        }),
        class: 'popover-trigger',
      },
      {
        'aria-controls': 'author-account-popover',
        'aria-expanded': 'true',
        class: 'popover-trigger compact',
        'data-state': 'author-open',
        popovertarget: 'author-account-popover',
        type: 'submit',
      },
    );
    const content = mergePrimitiveAttrs(
      {
        ...popoverContentAttributes({
          contentId: 'gallery-account-popover',
          open: false,
        }),
        class: 'popover-content',
      },
      {
        class: 'popover-content min-w-48',
        id: 'author-account-popover',
        popover: 'manual',
      },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
      {
        attr: 'popovertarget',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="popover">
        <button {...trigger.attrs}>Account</button>
        <div {...content.attrs}>Menu</div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="popover"><button data-state="closed" aria-expanded="true" type="submit" aria-controls="author-account-popover" popovertarget="author-account-popover" popovertargetaction="toggle" class="popover-trigger compact">Account</button><div data-state="closed" id="author-account-popover" popover="manual" class="popover-content min-w-48">Menu</div></section>',
    );
  });

  it('renders a golden hover-card merge with package-prefixed behavior IDREFs', () => {
    const trigger = mergePrimitiveAttrs(
      {
        ...hoverCardTriggerAttributes({
          contentId: 'gallery-profile-card',
          open: true,
        }),
        class: 'hover-card-trigger',
      },
      {
        'aria-controls': 'author-profile-card',
        'aria-expanded': 'false',
        class: 'hover-card-trigger underline',
        'data-state': 'author-open',
        'jiso-hover-card': 'author-profile-card',
      },
    );
    const content = mergePrimitiveAttrs(
      {
        ...hoverCardContentAttributes({
          contentId: 'gallery-profile-card',
          open: false,
        }),
        class: 'hover-card-content',
      },
      {
        class: 'hover-card-content w-64',
        hidden: false,
        id: 'author-profile-card',
        popover: 'auto',
      },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
      {
        attr: 'jiso-hover-card',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="hover-card">
        <a {...trigger.attrs}>Ada</a>
        <aside {...content.attrs}>Profile</aside>
      </section>,
    ).toBe(
      '<section data-gallery-merge="hover-card"><a data-state="open" aria-expanded="false" aria-controls="author-profile-card" jiso-hover-card="author-profile-card" class="hover-card-trigger underline">Ada</a><aside data-state="closed" id="author-profile-card" popover="auto" class="hover-card-content w-64">Profile</aside></section>',
    );
  });

  it('renders a golden collapsible merge with details and summary attrs', () => {
    const root = mergePrimitiveAttrs(
      {
        ...collapsibleRootAttributes({ disabled: true, open: false }),
        class: 'collapsible-root',
      },
      {
        class: 'collapsible-root border',
        'data-state': 'author-open',
        open: true,
      },
    );
    const trigger = mergePrimitiveAttrs(
      {
        ...collapsibleTriggerAttributes({
          contentId: 'gallery-filters-panel',
          open: false,
        }),
        class: 'collapsible-trigger',
      },
      {
        'aria-controls': 'author-filters-panel',
        'aria-expanded': 'true',
        class: 'collapsible-trigger font-medium',
        'data-state': 'author-open',
      },
    );
    const content = mergePrimitiveAttrs(
      {
        ...collapsibleContentAttributes({
          contentId: 'gallery-filters-panel',
          open: false,
        }),
        class: 'collapsible-content',
      },
      {
        class: 'collapsible-content p-3',
        id: 'author-filters-panel',
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([]);
    expect(
      <details {...root.attrs}>
        <summary {...trigger.attrs}>Filters</summary>
        <div {...content.attrs}>Panel</div>
      </details>,
    ).toBe(
      '<details data-state="closed" data-disabled="" open class="collapsible-root border"><summary data-state="closed" aria-expanded="true" aria-controls="author-filters-panel" class="collapsible-trigger font-medium">Filters</summary><div data-state="closed" id="author-filters-panel" class="collapsible-content p-3">Panel</div></details>',
    );
  });

  it('renders a golden toggle merge with authored class, handlers, scalars, and state overrides', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...toggleRootAttributes({ pressed: true }),
        class: 'inline-flex saved',
        'fw-deps': 'toggle:pressed',
        'on:click': '/gallery/toggle.client.js#primitiveToggle',
        style: '--toggle-state: pressed; color: blue',
      },
      {
        'aria-pressed': 'mixed',
        class: 'saved rounded-sm',
        'data-state': 'author-pressed',
        disabled: true,
        'fw-deps': 'route:gallery',
        'on:click': '/gallery/author.client.js#trackToggle',
        style: 'color: red; margin: 0',
        type: 'submit',
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-pressed',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<button {...merged.attrs}>Saved</button>).toBe(
      '<button data-state="pressed" aria-pressed="mixed" disabled type="submit" class="inline-flex saved rounded-sm" fw-deps="toggle:pressed route:gallery" on:click="/gallery/author.client.js#trackToggle /gallery/toggle.client.js#primitiveToggle" style="--toggle-state: pressed; color: blue; color: red; margin: 0">Saved</button>',
    );
  });

  it('renders a golden checkbox merge with native control logical-OR attributes', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...checkboxRootAttributes({
          checked: 'indeterminate',
          name: 'gallery-consent',
          required: true,
          value: 'yes',
        }),
        class: 'checkbox-control',
      },
      {
        'aria-checked': 'false',
        class: 'rounded border',
        'data-state': 'author-indeterminate',
        disabled: true,
        name: 'author-consent',
        required: false,
        value: 'author-yes',
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-checked',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<input {...merged.attrs} />).toBe(
      '<input data-state="indeterminate" aria-checked="false" disabled name="author-consent" required type="checkbox" value="author-yes" class="checkbox-control rounded border">',
    );
  });

  it('renders a golden field merge with native label and control wiring', () => {
    const root = mergePrimitiveAttrs(
      {
        ...fieldRootAttributes({ id: 'gallery-field', invalid: true, required: true }),
        class: 'field-root',
      },
      {
        class: 'field-root grid gap-1',
        'data-invalid': 'author-invalid',
        id: 'author-field',
      },
    );
    const control = mergePrimitiveAttrs(
      {
        ...fieldControlAttributes({
          descriptionId: 'gallery-field-description',
          errorId: 'gallery-field-error',
          id: 'gallery-field-email',
          invalid: true,
          name: 'email',
          required: true,
        }),
        class: 'field-control',
      },
      {
        'aria-describedby': 'author-field-description',
        'aria-invalid': 'false',
        class: 'field-control border',
        name: 'author-email',
        required: false,
      },
    );
    const label = mergePrimitiveAttrs(
      rewriteIdrefs(
        fieldLabelAttributes({ controlId: 'gallery-field-email' }),
        new Map([['gallery-field-email', 'author-field-email']]),
      ),
      {
        class: 'field-label',
        for: 'author-field-email',
      },
    );

    expect(root.diagnostics).toEqual([]);
    expect(control.diagnostics).toEqual([
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
      {
        attr: 'aria-invalid',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(label.diagnostics).toEqual([]);
    expect(
      <div data-gallery-merge="field">
        <div {...root.attrs}>
          <label {...label.attrs}>Email</label>
          <input {...control.attrs} />
        </div>
      </div>,
    ).toBe(
      '<div data-gallery-merge="field"><div data-invalid="author-invalid" data-required="" id="author-field" class="field-root grid gap-1"><label for="author-field-email" class="field-label">Email</label><input data-invalid="" data-required="" aria-describedby="author-field-description" aria-invalid="false" id="gallery-field-email" name="author-email" required class="field-control border"></div></div>',
    );
  });

  it('renders a golden meter merge with threshold scalars and author value text', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...meterRootAttributes({
          high: 90,
          low: 50,
          max: 100,
          min: 0,
          optimum: 80,
          value: 42,
          valueText: '42 percent quality score',
        }),
        class: 'meter-root',
      },
      {
        'aria-valuetext': 'Author meter label',
        class: 'meter-root h-2',
        'data-state': 'author-suboptimum',
        high: 95,
        low: 40,
        optimum: 75,
        value: 64,
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-valuetext',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<meter {...merged.attrs}>64%</meter>).toBe(
      '<meter data-high="90" data-low="50" data-max="100" data-min="0" data-optimum="80" data-state="suboptimum" data-value="42" high="95" low="40" max="100" min="0" optimum="75" value="64" aria-valuetext="Author meter label" class="meter-root h-2">64%</meter>',
    );
  });

  it('renders a golden progress merge with scalar author values and primitive-owned state', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...progressRootAttributes({
          max: 100,
          value: 42,
          valueText: '42 of 100 tasks complete',
        }),
        class: 'progress-root',
      },
      {
        'aria-valuetext': 'Author progress label',
        class: 'progress-root h-2',
        'data-state': 'author-loading',
        max: 80,
        value: 50,
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-valuetext',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<progress {...merged.attrs}>50%</progress>).toBe(
      '<progress data-max="100" data-state="loading" max="80" data-value="42" value="50" aria-valuetext="Author progress label" class="progress-root h-2">50%</progress>',
    );
  });

  it('renders a golden otp-field merge with aggregate input and slot overrides', () => {
    const root = mergePrimitiveAttrs(
      {
        ...otpFieldRootAttributes({
          descriptionId: 'gallery-otp-description',
          errorId: 'gallery-otp-error',
          id: 'gallery-otp-field',
          invalid: true,
          labelledBy: 'gallery-otp-label',
          required: true,
          value: '1234',
        }),
        class: 'otp-root',
      },
      {
        'aria-describedby': 'author-otp-description',
        class: 'otp-root gap-2',
        role: 'application',
      },
    );
    const hiddenInput = mergePrimitiveAttrs(
      {
        ...otpFieldHiddenInputAttributes({
          length: 6,
          name: 'gallery-otp-code',
          pattern: '[0-9]*',
          required: true,
          value: '1234',
        }),
        class: 'otp-hidden',
      },
      {
        'aria-hidden': 'false',
        class: 'otp-hidden sr-only',
        disabled: true,
        name: 'author-otp-code',
        required: false,
      },
    );
    const slot = mergePrimitiveAttrs(
      {
        ...otpFieldInputAttributes({
          inputMode: 'numeric',
          label: 'One-time code digit 1',
          length: 6,
          required: true,
          slotIndex: 0,
          value: '1234',
        }),
        class: 'otp-slot',
      },
      {
        'aria-label': 'Author digit label',
        class: 'otp-slot text-center',
        maxLength: 2,
        value: '9',
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(hiddenInput.diagnostics).toEqual([
      {
        attr: 'aria-hidden',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(slot.diagnostics).toEqual([
      {
        attr: 'aria-label',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <div data-gallery-merge="otp-field">
        <div {...root.attrs}>
          <input {...hiddenInput.attrs} />
          <input {...slot.attrs} />
        </div>
      </div>,
    ).toBe(
      '<div data-gallery-merge="otp-field"><div data-invalid="" data-required="" role="application" id="gallery-otp-field" aria-labelledby="gallery-otp-label" aria-describedby="author-otp-description" aria-invalid="true" class="otp-root gap-2"><input data-required="" aria-hidden="false" data-slot="hidden-input" autoComplete="one-time-code" disabled inputMode="numeric" maxLength="6" minLength="6" tabIndex="-1" type="text" value="1234" name="author-otp-code" pattern="[0-9]*" required class="otp-hidden sr-only"><input data-required="" data-filled="" aria-label="Author digit label" data-slot="0" autoComplete="one-time-code" inputMode="numeric" maxLength="2" type="text" value="9" required class="otp-slot text-center"></div></div>',
    );
  });

  it('renders a golden number-field merge with native input scalars and step button wiring', () => {
    const input = mergePrimitiveAttrs(
      {
        ...numberFieldInputAttributes({
          descriptionId: 'gallery-number-description',
          errorId: 'gallery-number-error',
          id: 'gallery-number-input',
          invalid: true,
          labelledBy: 'gallery-number-label',
          max: 10,
          min: 0,
          name: 'gallery-quantity',
          required: true,
          step: 2,
          value: 4,
        }),
        class: 'number-input',
      },
      {
        'aria-describedby': 'author-number-description',
        class: 'number-input tabular-nums',
        'data-invalid': 'author-invalid',
        max: 8,
        name: 'author-quantity',
        required: false,
        value: 6,
      },
    );
    const increment = mergePrimitiveAttrs(
      {
        ...numberFieldIncrementAttributes({
          id: 'gallery-number-increment',
          inputId: 'gallery-number-input',
          label: 'Increase quantity',
          max: 10,
          value: 4,
        }),
        class: 'number-step',
      },
      {
        class: 'number-step rounded-r',
        'data-action': 'author-increment',
        type: 'submit',
      },
    );

    expect(input.diagnostics).toEqual([
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(increment.diagnostics).toEqual([]);
    expect(
      <div data-gallery-merge="number-field">
        <input {...input.attrs} />
        <button {...increment.attrs}>+</button>
      </div>,
    ).toBe(
      '<div data-gallery-merge="number-field"><input data-invalid="author-invalid" data-required="" aria-describedby="author-number-description" aria-invalid="true" aria-labelledby="gallery-number-label" id="gallery-number-input" max="8" min="0" name="author-quantity" required step="2" type="number" value="6" class="number-input tabular-nums"><button data-action="author-increment" aria-label="Increase quantity" type="submit" id="gallery-number-increment" aria-controls="gallery-number-input" class="number-step rounded-r">+</button></div>',
    );
  });

  it('renders a golden separator merge with orientation and semantic overrides', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...separatorRootAttributes({ decorative: false, orientation: 'vertical' }),
        class: 'separator-root',
      },
      {
        'aria-orientation': 'horizontal',
        class: 'separator-root my-2',
        role: 'presentation',
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'aria-orientation',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<div {...merged.attrs} />).toBe(
      '<div data-orientation="vertical" aria-orientation="horizontal" role="presentation" class="separator-root my-2"></div>',
    );
  });

  it('renders a golden scroll-area merge with viewport ARIA overrides and hidden parts', () => {
    const viewport = mergePrimitiveAttrs(
      {
        ...scrollAreaViewportAttributes({
          descriptionId: 'gallery-scroll-description',
          id: 'gallery-scroll-viewport',
          labelledBy: 'gallery-scroll-title',
          scrollbars: 'both',
        }),
        class: 'scroll-viewport',
      },
      {
        'aria-labelledby': 'author-scroll-title',
        class: 'scroll-viewport overscroll-contain',
        role: 'feed',
        tabIndex: -1,
      },
    );
    const scrollbar = mergePrimitiveAttrs(
      {
        ...scrollAreaScrollbarAttributes({
          forceMount: true,
          id: 'gallery-scrollbar-x',
          orientation: 'horizontal',
          scrollbars: 'both',
          visible: false,
        }),
        class: 'scrollbar',
      },
      {
        'aria-hidden': 'false',
        class: 'scrollbar h-2',
        'data-state': 'author-visible',
        hidden: false,
      },
    );

    expect(viewport.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(scrollbar.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-hidden',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <div data-gallery-merge="scroll-area">
        <div {...viewport.attrs}>Feed</div>
        <div {...scrollbar.attrs} />
      </div>,
    ).toBe(
      '<div data-gallery-merge="scroll-area"><div data-scrollbars="both" tabIndex="-1" aria-describedby="gallery-scroll-description" role="feed" aria-labelledby="author-scroll-title" id="gallery-scroll-viewport" class="scroll-viewport overscroll-contain">Feed</div><div data-scrollbars="both" data-orientation="horizontal" data-state="hidden" aria-hidden="false" id="gallery-scrollbar-x" class="scrollbar h-2"></div></div>',
    );
  });

  it('renders a golden select merge with native trigger and option scalars', () => {
    const state = {
      items: [
        { label: 'Starter', value: 'starter' },
        { label: 'Growth', value: 'growth' },
      ],
      name: 'gallery-plan',
      required: true,
      value: 'growth',
    };
    const trigger = mergePrimitiveAttrs(
      {
        ...selectTriggerAttributes({
          ...state,
          id: 'gallery-select',
          labelledBy: 'gallery-select-label',
          open: true,
        }),
        class: 'select-trigger',
      },
      {
        'aria-expanded': 'false',
        class: 'select-trigger min-w-40',
        'data-state': 'author-open',
        name: 'author-plan',
        required: false,
      },
    );
    const option = mergePrimitiveAttrs(
      {
        ...selectItemAttributes({
          ...state,
          itemLabel: 'Growth',
          itemValue: 'growth',
        }),
        class: 'select-option',
      },
      {
        class: 'select-option font-medium',
        'data-state': 'author-checked',
        label: 'Author Growth',
        selected: false,
        value: 'author-growth',
      },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(option.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <select {...trigger.attrs}>
        <option {...option.attrs}>Growth</option>
      </select>,
    ).toBe(
      '<select data-state="open" data-required="" aria-expanded="false" id="gallery-select" aria-labelledby="gallery-select-label" name="author-plan" required class="select-trigger min-w-40"><option data-state="checked" value="author-growth" label="Author Growth" class="select-option font-medium">Growth</option></select>',
    );
  });

  it('renders a golden switch merge with native logical-OR attributes', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...switchRootAttributes({
          checked: true,
          name: 'gallery-notifications',
          required: true,
          value: 'enabled',
        }),
        class: 'switch-control',
      },
      {
        'aria-checked': 'false',
        class: 'switch-control rounded-full',
        'data-state': 'author-checked',
        disabled: true,
        required: false,
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-checked',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<input {...merged.attrs} />).toBe(
      '<input data-state="checked" aria-checked="false" checked disabled name="gallery-notifications" role="switch" required type="checkbox" value="enabled" class="switch-control rounded-full">',
    );
  });

  it('rewires dialog trigger IDREFs when an authored dialog content id wins', () => {
    const idRewrites = new Map([['gallery-dialog-content', 'authored-dialog-content']]);
    const trigger = mergePrimitiveAttrs(
      rewriteIdrefs(
        dialogTriggerAttributes({ contentId: 'gallery-dialog-content', open: false }),
        idRewrites,
      ),
      { class: 'dialog-trigger' },
    );
    const content = mergePrimitiveAttrs(
      dialogContentAttributes({
        contentId: 'gallery-dialog-content',
        descriptionId: 'gallery-dialog-description',
        open: true,
        titleId: 'gallery-dialog-title',
      }),
      { class: 'dialog-panel', id: 'authored-dialog-content' },
    );

    expect(trigger.diagnostics).toEqual([]);
    expect(content.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="dialog-idref">
        <button {...trigger.attrs}>Open</button>
        <dialog {...content.attrs}>Body</dialog>
      </section>,
    ).toBe(
      '<section data-gallery-merge="dialog-idref"><button data-state="closed" aria-expanded="false" aria-haspopup="dialog" type="button" aria-controls="authored-dialog-content" command="show-modal" commandfor="authored-dialog-content" class="dialog-trigger">Open</button><dialog data-state="open" open id="authored-dialog-content" aria-labelledby="gallery-dialog-title" aria-describedby="gallery-dialog-description" class="dialog-panel">Body</dialog></section>',
    );
  });

  it('rewires tab trigger and panel IDREFs when authored ids win', () => {
    const idRewrites = new Map([
      ['gallery-tabs-overview', 'authored-tabs-overview'],
      ['gallery-tabs-overview-panel', 'authored-tabs-overview-panel'],
    ]);
    const trigger = mergePrimitiveAttrs(
      rewriteIdrefs(
        tabsTriggerAttributes({
          activeValue: 'overview',
          id: 'gallery-tabs-overview',
          itemValue: 'overview',
          panelId: 'gallery-tabs-overview-panel',
          value: 'overview',
        }),
        idRewrites,
      ),
      { class: 'tabs-trigger', id: 'authored-tabs-overview' },
    );
    const panel = mergePrimitiveAttrs(
      rewriteIdrefs(
        tabsPanelAttributes({
          id: 'gallery-tabs-overview-panel',
          itemValue: 'overview',
          triggerId: 'gallery-tabs-overview',
          value: 'overview',
        }),
        idRewrites,
      ),
      { class: 'tabs-panel', id: 'authored-tabs-overview-panel' },
    );

    expect(trigger.diagnostics).toEqual([]);
    expect(panel.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="tabs-idref">
        <button {...trigger.attrs}>Overview</button>
        <div {...panel.attrs}>Panel</div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="tabs-idref"><button data-state="active" aria-selected="true" role="tab" tabIndex="0" type="button" value="overview" aria-controls="authored-tabs-overview-panel" id="authored-tabs-overview" class="tabs-trigger">Overview</button><div data-state="active" role="tabpanel" tabIndex="0" aria-labelledby="authored-tabs-overview" id="authored-tabs-overview-panel" class="tabs-panel">Panel</div></section>',
    );
  });

  it('rewires radio label IDREFs when an authored native radio id wins', () => {
    const idRewrites = new Map([['gallery-radio-express', 'authored-radio-express']]);
    const state = {
      items: [{ value: 'standard' }, { value: 'express' }],
      name: 'gallery-shipping-speed',
      required: true,
      value: 'express',
    };
    const radio = mergePrimitiveAttrs(
      radioGroupRadioAttributes({
        ...state,
        controlId: 'gallery-radio-express',
        itemValue: 'express',
      }),
      { class: 'radio-input', id: 'authored-radio-express', required: false },
    );
    const label = mergePrimitiveAttrs(
      rewriteIdrefs(
        radioGroupLabelAttributes({
          ...state,
          controlId: 'gallery-radio-express',
          itemValue: 'express',
        }),
        idRewrites,
      ),
      { class: 'radio-label' },
    );

    expect(radio.diagnostics).toEqual([]);
    expect(label.diagnostics).toEqual([]);
    expect(
      <div data-gallery-merge="radio-idref">
        <input {...radio.attrs} />
        <label {...label.attrs}>Express</label>
      </div>,
    ).toBe(
      '<div data-gallery-merge="radio-idref"><input data-state="checked" aria-checked="true" checked tabIndex="0" type="radio" value="express" id="authored-radio-express" name="gallery-shipping-speed" required class="radio-input"><label data-state="checked" for="authored-radio-express" class="radio-label">Express</label></div>',
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
    const root = mergePrimitiveAttrs(
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
    const item = mergePrimitiveAttrs(
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
    const submenu = mergePrimitiveAttrs(
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
    const group = mergePrimitiveAttrs(
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
    const separator = mergePrimitiveAttrs(
      menubarSeparatorAttributes({ id: 'gallery-file-separator' }),
      { role: 'none' },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-label',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(submenu.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(group.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(separator.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
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

  it('renders golden checkbox-group merges across root, item, control, and label attrs', () => {
    const state = {
      activeValue: 'email',
      descriptionId: 'gallery-notifications-help',
      errorId: 'gallery-notifications-error',
      invalid: true,
      items: [{ value: 'email' }, { disabled: true, value: 'sms' }],
      name: 'notifications',
      orientation: 'vertical' as const,
      required: true,
      value: ['email'],
    };
    const root = mergePrimitiveAttrs(
      {
        ...checkboxGroupRootAttributes({
          ...state,
          id: 'gallery-notifications',
          labelledBy: 'gallery-notifications-label',
        }),
        class: 'checkbox-group',
      },
      {
        'aria-describedby': 'author-notifications-help',
        class: 'checkbox-group gap-2',
        role: 'group',
      },
    );
    const item = mergePrimitiveAttrs(
      {
        ...checkboxGroupItemAttributes({
          ...state,
          id: 'gallery-notifications-email-item',
          itemValue: 'email',
        }),
        class: 'checkbox-group-item',
      },
      {
        class: 'checkbox-group-item flex',
        'data-state': 'unchecked',
        id: 'author-notifications-email-item',
      },
    );
    const control = mergePrimitiveAttrs(
      checkboxGroupControlAttributes({
        ...state,
        controlId: 'gallery-notifications-email',
        itemValue: 'email',
      }),
      {
        'aria-checked': 'false',
        class: 'checkbox-group-control',
        disabled: true,
        id: 'author-notifications-email',
        required: false,
      },
    );
    const label = mergePrimitiveAttrs(
      rewriteIdrefs(
        checkboxGroupLabelAttributes({
          ...state,
          controlId: 'gallery-notifications-email',
          id: 'gallery-notifications-email-label',
          itemValue: 'email',
        }),
        new Map([['gallery-notifications-email', 'author-notifications-email']]),
      ),
      { class: 'checkbox-group-label' },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(control.diagnostics).toEqual([
      {
        attr: 'aria-checked',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(label.diagnostics).toEqual([]);
    expect(
      <fieldset data-gallery-merge="checkbox-group">
        <div {...root.attrs}>
          <div {...item.attrs}>
            <input {...control.attrs} />
            <label {...label.attrs}>Email</label>
          </div>
        </div>
      </fieldset>,
    ).toBe(
      '<fieldset data-gallery-merge="checkbox-group"><div data-orientation="vertical" data-invalid="" data-required="" role="group" id="gallery-notifications" aria-labelledby="gallery-notifications-label" aria-describedby="author-notifications-help" aria-invalid="true" aria-required="true" class="checkbox-group gap-2"><div data-state="checked" id="author-notifications-email-item" class="checkbox-group-item flex"><input data-state="checked" aria-checked="false" checked disabled tabIndex="0" type="checkbox" value="email" id="author-notifications-email" name="notifications" required class="checkbox-group-control"><label data-state="checked" for="author-notifications-email" id="gallery-notifications-email-label" class="checkbox-group-label">Email</label></div></div></fieldset>',
    );
  });

  it('renders golden toggle-group and toolbar merges for roving button attrs', () => {
    const toggleState = {
      activeValue: 'bold',
      items: [{ value: 'bold' }, { disabled: true, value: 'italic' }],
      orientation: 'horizontal' as const,
      type: 'multiple' as const,
      value: ['bold'],
    };
    const toggleRoot = mergePrimitiveAttrs(
      {
        ...toggleGroupRootAttributes({
          ...toggleState,
          descriptionId: 'gallery-formatting-help',
          id: 'gallery-formatting',
          labelledBy: 'gallery-formatting-label',
        }),
        class: 'toggle-group',
      },
      {
        'aria-labelledby': 'author-formatting-label',
        class: 'toggle-group rounded',
        role: 'toolbar',
      },
    );
    const toggleItem = mergePrimitiveAttrs(
      {
        ...toggleGroupItemAttributes({
          ...toggleState,
          id: 'gallery-bold-item',
          itemValue: 'bold',
        }),
        class: 'toggle-group-item',
      },
      { class: 'toggle-group-item selected', 'data-state': 'off' },
    );
    const toggleButton = mergePrimitiveAttrs(
      toggleGroupButtonAttributes({
        ...toggleState,
        id: 'gallery-bold-button',
        itemValue: 'bold',
      }),
      {
        'aria-pressed': 'false',
        class: 'toggle-group-button',
        disabled: true,
        value: 'author-bold',
      },
    );
    const toolbarState = {
      activeValue: 'align-left',
      items: [{ value: 'align-left' }, { disabled: true, value: 'align-right' }],
      orientation: 'vertical' as const,
    };
    const toolbar = mergePrimitiveAttrs(
      {
        ...toolbarRootAttributes({
          ...toolbarState,
          descriptionId: 'gallery-toolbar-help',
          id: 'gallery-toolbar',
          label: 'Editor toolbar',
        }),
        class: 'toolbar-root',
      },
      {
        'aria-orientation': 'horizontal',
        class: 'toolbar-root gap-1',
        role: 'group',
      },
    );
    const toolbarItem = mergePrimitiveAttrs(
      {
        ...toolbarItemAttributes({
          ...toolbarState,
          id: 'gallery-align-left-item',
          itemValue: 'align-left',
        }),
        class: 'toolbar-item',
      },
      { class: 'toolbar-item shrink-0' },
    );
    const toolbarButton = mergePrimitiveAttrs(
      toolbarButtonAttributes({
        ...toolbarState,
        id: 'gallery-align-left-button',
        itemValue: 'align-left',
        pressed: true,
      }),
      {
        'aria-pressed': 'false',
        class: 'toolbar-button',
        disabled: true,
        value: 'author-align-left',
      },
    );

    expect(toggleRoot.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(toggleItem.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(toggleButton.diagnostics).toEqual([
      {
        attr: 'aria-pressed',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(toolbar.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-orientation',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(toolbarItem.diagnostics).toEqual([]);
    expect(toolbarButton.diagnostics).toEqual([
      {
        attr: 'aria-pressed',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="roving-groups">
        <div {...toggleRoot.attrs}>
          <span {...toggleItem.attrs}>
            <button {...toggleButton.attrs}>Bold</button>
          </span>
        </div>
        <div {...toolbar.attrs}>
          <span {...toolbarItem.attrs}>
            <button {...toolbarButton.attrs}>Left</button>
          </span>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="roving-groups"><div data-orientation="horizontal" role="toolbar" id="gallery-formatting" aria-labelledby="author-formatting-label" aria-describedby="gallery-formatting-help" class="toggle-group rounded"><span data-state="pressed" id="gallery-bold-item" class="toggle-group-item selected"><button data-state="pressed" aria-pressed="false" disabled tabIndex="0" type="button" value="author-bold" id="gallery-bold-button" class="toggle-group-button">Bold</button></span></div><div data-orientation="vertical" role="group" id="gallery-toolbar" aria-label="Editor toolbar" aria-describedby="gallery-toolbar-help" aria-orientation="horizontal" class="toolbar-root gap-1"><span id="gallery-align-left-item" class="toolbar-item shrink-0"><button disabled tabIndex="0" type="button" value="author-align-left" aria-pressed="false" data-pressed="true" id="gallery-align-left-button" class="toolbar-button">Left</button></span></div></section>',
    );
  });

  it('renders golden disclosure and avatar image merges for remaining simple attrs records', () => {
    const disclosure = { disabled: true, open: true };
    const root = mergePrimitiveAttrs(
      { ...disclosureRootAttributes(disclosure), class: 'disclosure-root' },
      { class: 'disclosure-root rounded', 'data-state': 'closed' },
    );
    const trigger = mergePrimitiveAttrs(
      {
        ...disclosureTriggerAttributes({
          ...disclosure,
          contentId: 'gallery-disclosure-panel',
        }),
        class: 'disclosure-trigger',
      },
      {
        'aria-controls': 'author-disclosure-panel',
        'aria-expanded': 'false',
        class: 'disclosure-trigger font-medium',
        disabled: false,
      },
    );
    const content = mergePrimitiveAttrs(
      {
        ...disclosureContentAttributes({
          ...disclosure,
          contentId: 'gallery-disclosure-panel',
        }),
        class: 'disclosure-panel',
      },
      {
        class: 'disclosure-panel p-3',
        hidden: true,
        id: 'author-disclosure-panel',
      },
    );
    const image = mergePrimitiveAttrs(
      {
        ...avatarImageAttributes({
          alt: 'Ada Lovelace',
          loading: 'lazy',
          src: '/avatars/ada.png',
          status: 'loaded',
        }),
        class: 'avatar-image',
      },
      {
        alt: 'Author alt',
        class: 'avatar-image object-cover',
        'data-state': 'loading',
        hidden: true,
        src: '/avatars/author.png',
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([]);
    expect(image.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="disclosure-avatar-image">
        <div {...root.attrs}>
          <button {...trigger.attrs}>Details</button>
          <div {...content.attrs}>Panel</div>
        </div>
        <img {...image.attrs} />
      </section>,
    ).toBe(
      '<section data-gallery-merge="disclosure-avatar-image"><div data-state="open" data-disabled="" class="disclosure-root rounded"><button data-state="open" data-disabled="" aria-expanded="false" disabled type="button" aria-controls="author-disclosure-panel" class="disclosure-trigger font-medium">Details</button><div data-state="open" hidden id="author-disclosure-panel" class="disclosure-panel p-3">Panel</div></div><img alt="Author alt" data-state="loaded" decoding="async" hidden loading="lazy" src="/avatars/author.png" class="avatar-image object-cover"></section>',
    );
  });

  it('pins FW231 for package-prefixed behavior IDREF conflicts', () => {
    const merged = mergePrimitiveAttrs(
      tooltipTriggerAttributes({
        contentId: 'gallery-tooltip-content',
        open: true,
      }),
      { 'jiso-tooltip': 'author-tooltip-content' },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'jiso-tooltip',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
  });

  it('pins FW231 for double-wired dialog trigger relationships', () => {
    const merged = mergePrimitiveAttrs(
      dialogTriggerAttributes({ contentId: 'gallery-dialog-content', open: false }),
      { commandfor: 'other-dialog' },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
  });

  it('renders golden scroll-area merges across root, viewport, scrollbar, thumb, and corner attrs', () => {
    const root = mergePrimitiveAttrs(
      {
        ...scrollAreaRootAttributes({
          dir: 'rtl',
          disabled: true,
          id: 'gallery-scroll-root',
          scrollbars: 'both',
        }),
        class: 'scroll-root',
      },
      {
        class: 'scroll-root rounded',
        'data-scrollbars': 'author-scrollbars',
        dir: 'ltr',
        id: 'author-scroll-root',
      },
    );
    const viewport = mergePrimitiveAttrs(
      {
        ...scrollAreaViewportAttributes({
          descriptionId: 'gallery-scroll-description',
          id: 'gallery-scroll-viewport',
          label: 'Invoices',
          scrollbars: 'both',
        }),
        class: 'scroll-viewport',
      },
      {
        'aria-label': 'Author invoices',
        class: 'scroll-viewport focus-ring',
        role: 'feed',
      },
    );
    const thumb = mergePrimitiveAttrs(
      {
        ...scrollAreaThumbAttributes({
          forceMount: true,
          id: 'gallery-scroll-thumb-y',
          orientation: 'vertical',
          scrollbars: 'both',
          visible: true,
        }),
        class: 'scroll-thumb',
      },
      {
        'aria-hidden': 'false',
        class: 'scroll-thumb rounded-full',
        'data-state': 'hidden',
      },
    );
    const corner = mergePrimitiveAttrs(
      {
        ...scrollAreaCornerAttributes({
          forceMount: true,
          id: 'gallery-scroll-corner',
          scrollbars: 'both',
          visible: false,
        }),
        class: 'scroll-corner',
      },
      {
        'aria-hidden': 'false',
        class: 'scroll-corner bg-muted',
        'data-state': 'visible',
        hidden: false,
      },
    );

    expect(root.diagnostics).toEqual([]);
    expect(viewport.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-label',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(thumb.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-hidden',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(corner.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-hidden',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="scroll-area-family">
        <div {...root.attrs}>
          <div {...viewport.attrs}>Scrollable invoices</div>
          <span {...thumb.attrs}></span>
          <span {...corner.attrs}></span>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="scroll-area-family"><div data-disabled="" data-scrollbars="author-scrollbars" dir="ltr" id="author-scroll-root" class="scroll-root rounded"><div data-scrollbars="both" tabIndex="0" aria-describedby="gallery-scroll-description" role="feed" aria-label="Author invoices" id="gallery-scroll-viewport" class="scroll-viewport focus-ring">Scrollable invoices</div><span data-scrollbars="both" data-orientation="vertical" data-state="visible" aria-hidden="false" id="gallery-scroll-thumb-y" class="scroll-thumb rounded-full"></span><span data-scrollbars="both" data-state="hidden" aria-hidden="false" id="gallery-scroll-corner" class="scroll-corner bg-muted"></span></div></section>',
    );
  });

  it('renders golden select merges across root, trigger, content, value, and option attrs', () => {
    const state = {
      disabled: true,
      invalid: true,
      items: [
        { label: 'Starter', value: 'starter' },
        { disabled: true, label: 'Growth', value: 'growth' },
      ],
      name: 'gallery-plan',
      open: false,
      placeholder: 'Choose a plan',
      required: true,
      value: '',
    };
    const root = mergePrimitiveAttrs(
      { ...selectRootAttributes({ ...state, id: 'gallery-select-root' }), class: 'select-root' },
      {
        class: 'select-root grid',
        'data-placeholder': 'author-placeholder',
        id: 'author-select-root',
      },
    );
    const trigger = mergePrimitiveAttrs(
      {
        ...selectTriggerAttributes({
          ...state,
          descriptionId: 'gallery-select-description',
          errorId: 'gallery-select-error',
          id: 'gallery-select-trigger',
          labelledBy: 'gallery-select-label',
        }),
        class: 'select-trigger',
      },
      {
        'aria-describedby': 'author-select-description',
        class: 'select-trigger w-44',
        disabled: false,
        name: 'author-plan',
        required: false,
      },
    );
    const content = mergePrimitiveAttrs(
      {
        ...selectContentAttributes({
          ...state,
          id: 'gallery-select-content',
          labelledBy: 'gallery-select-label',
        }),
        class: 'select-content',
      },
      {
        'aria-labelledby': 'author-select-label',
        class: 'select-content shadow',
      },
    );
    const value = mergePrimitiveAttrs(
      {
        ...selectValueAttributes({ ...state, id: 'gallery-select-value' }),
        class: 'select-value',
      },
      {
        class: 'select-value text-muted',
        'data-placeholder': 'author-placeholder',
        id: 'author-select-value',
      },
    );
    const option = mergePrimitiveAttrs(
      {
        ...selectItemAttributes({
          ...state,
          itemLabel: 'Growth',
          itemValue: 'growth',
        }),
        class: 'select-option',
      },
      {
        class: 'select-option font-medium',
        disabled: false,
        selected: true,
        value: 'author-growth',
      },
    );

    expect(root.diagnostics).toEqual([]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'aria-labelledby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(value.diagnostics).toEqual([]);
    expect(option.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="select-family">
        <div {...root.attrs}>
          <select {...trigger.attrs}>
            <option {...option.attrs}>Growth</option>
          </select>
          <span {...content.attrs}>
            <span {...value.attrs}>Choose a plan</span>
          </span>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="select-family"><div data-state="closed" data-disabled="" data-placeholder="author-placeholder" data-invalid="" data-required="" id="author-select-root" class="select-root grid"><select data-state="closed" data-disabled="" data-placeholder="" data-invalid="" data-required="" aria-expanded="false" disabled id="gallery-select-trigger" aria-labelledby="gallery-select-label" aria-describedby="author-select-description" aria-invalid="true" name="author-plan" required class="select-trigger w-44"><option data-state="unchecked" data-disabled="" disabled value="author-growth" label="Growth" class="select-option font-medium" selected>Growth</option></select><span data-state="closed" data-disabled="" data-placeholder="" data-invalid="" data-required="" id="gallery-select-content" aria-labelledby="author-select-label" class="select-content shadow"><span data-placeholder="author-placeholder" id="author-select-value" class="select-value text-muted">Choose a plan</span></span></div></section>',
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
    const root = mergePrimitiveAttrs(
      { ...commandRootAttributes({ ...state, id: 'gallery-command-root' }), class: 'command-root' },
      { class: 'command-root border', 'data-state': 'author-open' },
    );
    const trigger = mergePrimitiveAttrs(
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
    const dialog = mergePrimitiveAttrs(
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
    const close = mergePrimitiveAttrs(
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
    const empty = mergePrimitiveAttrs(
      { ...commandEmptyAttributes({ ...state, id: 'gallery-command-empty' }), class: 'empty' },
      { class: 'empty py-6', hidden: true },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(dialog.diagnostics).toEqual([
      {
        attr: 'aria-modal',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(close.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'FW231',
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

  it('renders golden dialog root and close merges with native command relationships', () => {
    const state = {
      contentId: 'gallery-profile-dialog',
      descriptionId: 'gallery-profile-description',
      open: true,
      titleId: 'gallery-profile-title',
    };
    const root = mergePrimitiveAttrs(
      { ...dialogRootAttributes(state), class: 'dialog-root' },
      { class: 'dialog-root isolate', 'data-state': 'author-open', id: 'author-dialog-root' },
    );
    const close = mergePrimitiveAttrs(
      { ...dialogCloseAttributes(state), class: 'dialog-close' },
      {
        class: 'dialog-close top-2',
        commandfor: 'author-profile-dialog',
        disabled: true,
        type: 'submit',
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(close.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="dialog-close">
        <div {...root.attrs}>
          <button {...close.attrs}>Close</button>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="dialog-close"><div data-state="open" class="dialog-root isolate" id="author-dialog-root"><button data-state="open" disabled type="submit" command="request-close" commandfor="author-profile-dialog" class="dialog-close top-2">Close</button></div></section>',
    );
  });

  it('renders golden fieldset merges for grouped field semantics', () => {
    const root = mergePrimitiveAttrs(
      {
        ...fieldsetRootAttributes({
          descriptionId: 'gallery-fieldset-description',
          disabled: true,
          errorId: 'gallery-fieldset-error',
          id: 'gallery-fieldset',
          invalid: true,
          required: true,
        }),
        class: 'fieldset-root',
      },
      {
        'aria-describedby': 'author-fieldset-description',
        class: 'fieldset-root gap-2',
        disabled: false,
      },
    );
    const legend = mergePrimitiveAttrs(
      {
        ...fieldsetLegendAttributes({
          id: 'gallery-fieldset-legend',
          invalid: true,
          required: true,
        }),
        class: 'fieldset-legend',
      },
      {
        class: 'fieldset-legend text-sm',
        'data-invalid': 'author-invalid',
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(legend.diagnostics).toEqual([]);
    expect(
      <fieldset {...root.attrs}>
        <legend {...legend.attrs}>Shipping speed</legend>
      </fieldset>,
    ).toBe(
      '<fieldset data-disabled="" data-invalid="" data-required="" aria-describedby="author-fieldset-description" aria-invalid="true" disabled id="gallery-fieldset" class="fieldset-root gap-2"><legend data-invalid="author-invalid" data-required="" id="gallery-fieldset-legend" class="fieldset-legend text-sm">Shipping speed</legend></fieldset>',
    );
  });

  it('renders golden toast title and description merges with part attrs', () => {
    const title = mergePrimitiveAttrs(
      { ...toastTitleAttributes({ id: 'gallery-toast-title' }), class: 'toast-title' },
      {
        class: 'toast-title font-medium',
        'data-part': 'author-title',
        id: 'author-toast-title',
      },
    );
    const description = mergePrimitiveAttrs(
      {
        ...toastDescriptionAttributes({ id: 'gallery-toast-description' }),
        class: 'toast-description',
      },
      {
        class: 'toast-description text-sm',
        'data-part': 'author-description',
        id: 'author-toast-description',
      },
    );

    expect(title.diagnostics).toEqual([]);
    expect(description.diagnostics).toEqual([]);
    expect(
      <article data-gallery-merge="toast-parts">
        <h2 {...title.attrs}>Synced</h2>
        <p {...description.attrs}>Changes are available offline.</p>
      </article>,
    ).toBe(
      '<article data-gallery-merge="toast-parts"><h2 data-part="author-title" id="author-toast-title" class="toast-title font-medium">Synced</h2><p data-part="author-description" id="author-toast-description" class="toast-description text-sm">Changes are available offline.</p></article>',
    );
  });

  it('covers every exported primitive attrs builder with the merge oracle', () => {
    const exportedAttributeBuilders = Object.keys(primitiveExports)
      .filter((name) => /^[a-z]/.test(name) && name.endsWith('Attributes'))
      .sort();

    expect([...primitiveAttributeBuilderNames].sort()).toEqual(exportedAttributeBuilders);

    const cases = primitiveAttributeBuilderNames.map((name) => {
      const primitive: AttributeRecord = {
        ...samplePrimitiveAttributes(name),
        class: `primitive-${name}`,
      };
      const author = authorStressAttrs(name, primitive);
      const merged = mergePrimitiveAttrs(primitive, author);

      expect(merged.attrs.class).toBe(`primitive-${name} author-${name}`);

      for (const attr of Object.keys(primitive)) {
        const authorValue = author[attr];
        if (authorValue === undefined || primitive[attr] === authorValue) continue;

        if (attr === 'data-state') {
          expect(merged.diagnostics).toContainEqual({
            attr,
            code: 'FW232',
            message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
          });
        }

        if (attr === 'role' || attr.startsWith('aria-')) {
          const code = idrefAttributes.has(attr) ? 'FW231' : 'FW232';
          const message =
            code === 'FW231'
              ? 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6'
              : 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6';
          expect(merged.diagnostics).toContainEqual({ attr, code, message });
        }

        if (idrefAttributes.has(attr)) {
          expect(merged.diagnostics).toContainEqual({
            attr,
            code: 'FW231',
            message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
          });
        }
      }

      return {
        attrCount: Object.keys(primitive).length,
        diagnostics: merged.diagnostics.length,
        html: renderMergedBuilder(name, merged.attrs),
        name,
      };
    });

    expect(cases).toHaveLength(134);
    expect(cases.some((testCase) => testCase.diagnostics > 0)).toBe(true);
    expect(cases.filter((testCase) => testCase.attrCount > 1).length).toBeGreaterThan(100);
    expect(
      cases.map(({ diagnostics, html, name }) => ({
        diagnostics,
        html,
        name,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="accordionContentAttributes" data-state="open" id="author-accordionContentAttributes" aria-labelledby="author-aria-labelledby" role="presentation" class="primitive-accordionContentAttributes author-accordionContentAttributes">merged</div>",
          "name": "accordionContentAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="accordionHeaderAttributes" data-state="open" aria-level="author-aria" role="presentation" class="primitive-accordionHeaderAttributes author-accordionHeaderAttributes">merged</div>",
          "name": "accordionHeaderAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="accordionItemAttributes" data-state="open" open class="primitive-accordionItemAttributes author-accordionItemAttributes">merged</div>",
          "name": "accordionItemAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="accordionRootAttributes" data-orientation="author-accordionRootAttributes" class="primitive-accordionRootAttributes author-accordionRootAttributes">merged</div>",
          "name": "accordionRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="accordionTriggerAttributes" data-state="open" aria-expanded="false" disabled type="author-accordionTriggerAttributes" aria-controls="author-aria-controls" id="author-accordionTriggerAttributes" class="primitive-accordionTriggerAttributes author-accordionTriggerAttributes">merged</div>",
          "name": "accordionTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="alertDialogActionAttributes" data-state="open" data-intent="author-alertDialogActionAttributes" disabled type="author-alertDialogActionAttributes" command="author-alertDialogActionAttributes" commandfor="author-commandfor" class="primitive-alertDialogActionAttributes author-alertDialogActionAttributes">merged</div>",
          "name": "alertDialogActionAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="alertDialogCancelAttributes" data-state="open" data-intent="author-alertDialogCancelAttributes" disabled type="author-alertDialogCancelAttributes" command="author-alertDialogCancelAttributes" commandfor="author-commandfor" class="primitive-alertDialogCancelAttributes author-alertDialogCancelAttributes">merged</div>",
          "name": "alertDialogCancelAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="alertDialogContentAttributes" data-state="open" aria-modal="false" open role="presentation" id="author-alertDialogContentAttributes" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" class="primitive-alertDialogContentAttributes author-alertDialogContentAttributes">merged</div>",
          "name": "alertDialogContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="alertDialogRootAttributes" data-state="open" class="primitive-alertDialogRootAttributes author-alertDialogRootAttributes">merged</div>",
          "name": "alertDialogRootAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="alertDialogTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" disabled type="author-alertDialogTriggerAttributes" aria-controls="author-aria-controls" command="author-alertDialogTriggerAttributes" commandfor="author-commandfor" class="primitive-alertDialogTriggerAttributes author-alertDialogTriggerAttributes">merged</div>",
          "name": "alertDialogTriggerAttributes",
        },
        {
          "diagnostics": 9,
          "html": "<div data-gallery-merge-builder="autocompleteInputAttributes" data-state="open" data-invalid="author-autocompleteInputAttributes" data-required="author-autocompleteInputAttributes" aria-autocomplete="author-aria" aria-expanded="false" autocomplete="author-autocompleteInputAttributes" disabled role="presentation" type="author-autocompleteInputAttributes" value="author-autocompleteInputAttributes" aria-activedescendant="author-aria-activedescendant" aria-controls="author-aria-controls" list="author-autocompleteInputAttributes" id="author-autocompleteInputAttributes" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" aria-invalid="false" name="author-autocompleteInputAttributes" placeholder="author-autocompleteInputAttributes" required class="primitive-autocompleteInputAttributes author-autocompleteInputAttributes">merged</div>",
          "name": "autocompleteInputAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="autocompleteListAttributes" data-state="open" data-invalid="author-autocompleteListAttributes" data-required="author-autocompleteListAttributes" id="author-autocompleteListAttributes" aria-labelledby="author-aria-labelledby" class="primitive-autocompleteListAttributes author-autocompleteListAttributes">merged</div>",
          "name": "autocompleteListAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="autocompleteOptionAttributes" data-state="unchecked" disabled id="author-autocompleteOptionAttributes" class="primitive-autocompleteOptionAttributes author-autocompleteOptionAttributes">merged</div>",
          "name": "autocompleteOptionAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="autocompleteRootAttributes" data-state="open" data-invalid="author-autocompleteRootAttributes" data-required="author-autocompleteRootAttributes" id="author-autocompleteRootAttributes" class="primitive-autocompleteRootAttributes author-autocompleteRootAttributes">merged</div>",
          "name": "autocompleteRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="autocompleteValueAttributes" id="author-autocompleteValueAttributes" class="primitive-autocompleteValueAttributes author-autocompleteValueAttributes">merged</div>",
          "name": "autocompleteValueAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="avatarFallbackAttributes" data-state="loaded" hidden data-delay="author-avatarFallbackAttributes" class="primitive-avatarFallbackAttributes author-avatarFallbackAttributes">merged</div>",
          "name": "avatarFallbackAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="avatarImageAttributes" data-state="loaded" decoding="author-avatarImageAttributes" src="author-avatarImageAttributes" class="primitive-avatarImageAttributes author-avatarImageAttributes">merged</div>",
          "name": "avatarImageAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="avatarRootAttributes" data-state="loaded" aria-label="author-aria" role="presentation" class="primitive-avatarRootAttributes author-avatarRootAttributes">merged</div>",
          "name": "avatarRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="checkboxGroupControlAttributes" data-state="checked" aria-checked="false" checked disabled tabIndex="1" type="author-checkboxGroupControlAttributes" value="author-checkboxGroupControlAttributes" id="author-checkboxGroupControlAttributes" name="author-checkboxGroupControlAttributes" required class="primitive-checkboxGroupControlAttributes author-checkboxGroupControlAttributes">merged</div>",
          "name": "checkboxGroupControlAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="checkboxGroupItemAttributes" data-state="checked" id="author-checkboxGroupItemAttributes" class="primitive-checkboxGroupItemAttributes author-checkboxGroupItemAttributes">merged</div>",
          "name": "checkboxGroupItemAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="checkboxGroupLabelAttributes" data-state="checked" for="author-for" id="author-checkboxGroupLabelAttributes" class="primitive-checkboxGroupLabelAttributes author-checkboxGroupLabelAttributes">merged</div>",
          "name": "checkboxGroupLabelAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="checkboxGroupRootAttributes" data-orientation="author-checkboxGroupRootAttributes" data-invalid="author-checkboxGroupRootAttributes" data-required="author-checkboxGroupRootAttributes" role="presentation" id="author-checkboxGroupRootAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" aria-required="false" class="primitive-checkboxGroupRootAttributes author-checkboxGroupRootAttributes">merged</div>",
          "name": "checkboxGroupRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="checkboxRootAttributes" data-state="indeterminate" aria-checked="author-aria" disabled name="author-checkboxRootAttributes" required type="author-checkboxRootAttributes" value="author-checkboxRootAttributes" class="primitive-checkboxRootAttributes author-checkboxRootAttributes">merged</div>",
          "name": "checkboxRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="collapsibleContentAttributes" data-state="open" id="author-collapsibleContentAttributes" class="primitive-collapsibleContentAttributes author-collapsibleContentAttributes">merged</div>",
          "name": "collapsibleContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="collapsibleRootAttributes" data-state="open" open class="primitive-collapsibleRootAttributes author-collapsibleRootAttributes">merged</div>",
          "name": "collapsibleRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="collapsibleTriggerAttributes" data-state="open" aria-expanded="false" aria-controls="author-aria-controls" class="primitive-collapsibleTriggerAttributes author-collapsibleTriggerAttributes">merged</div>",
          "name": "collapsibleTriggerAttributes",
        },
        {
          "diagnostics": 9,
          "html": "<div data-gallery-merge-builder="comboboxInputAttributes" data-state="open" data-invalid="author-comboboxInputAttributes" data-required="author-comboboxInputAttributes" aria-autocomplete="author-aria" aria-expanded="false" role="presentation" type="author-comboboxInputAttributes" value="author-comboboxInputAttributes" aria-activedescendant="author-aria-activedescendant" aria-controls="author-aria-controls" id="author-comboboxInputAttributes" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" aria-invalid="false" disabled name="author-comboboxInputAttributes" placeholder="author-comboboxInputAttributes" required class="primitive-comboboxInputAttributes author-comboboxInputAttributes">merged</div>",
          "name": "comboboxInputAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="comboboxListboxAttributes" data-state="open" data-invalid="author-comboboxListboxAttributes" data-required="author-comboboxListboxAttributes" role="presentation" id="author-comboboxListboxAttributes" aria-labelledby="author-aria-labelledby" class="primitive-comboboxListboxAttributes author-comboboxListboxAttributes">merged</div>",
          "name": "comboboxListboxAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="comboboxOptionAttributes" data-state="checked" data-highlighted="author-comboboxOptionAttributes" aria-selected="false" role="presentation" id="author-comboboxOptionAttributes" label="author-comboboxOptionAttributes" value="author-comboboxOptionAttributes" class="primitive-comboboxOptionAttributes author-comboboxOptionAttributes">merged</div>",
          "name": "comboboxOptionAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="comboboxRootAttributes" data-state="open" data-invalid="author-comboboxRootAttributes" data-required="author-comboboxRootAttributes" id="author-comboboxRootAttributes" class="primitive-comboboxRootAttributes author-comboboxRootAttributes">merged</div>",
          "name": "comboboxRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="comboboxValueAttributes" id="author-comboboxValueAttributes" class="primitive-comboboxValueAttributes author-comboboxValueAttributes">merged</div>",
          "name": "comboboxValueAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="commandCloseAttributes" data-state="open" disabled type="author-commandCloseAttributes" command="author-commandCloseAttributes" commandfor="author-commandfor" class="primitive-commandCloseAttributes author-commandCloseAttributes">merged</div>",
          "name": "commandCloseAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="commandDialogAttributes" data-state="open" aria-modal="false" id="author-commandDialogAttributes" aria-describedby="author-aria-describedby" aria-labelledby="author-aria-labelledby" open class="primitive-commandDialogAttributes author-commandDialogAttributes">merged</div>",
          "name": "commandDialogAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="commandEmptyAttributes" data-empty="author-commandEmptyAttributes" hidden id="author-commandEmptyAttributes" class="primitive-commandEmptyAttributes author-commandEmptyAttributes">merged</div>",
          "name": "commandEmptyAttributes",
        },
        {
          "diagnostics": 8,
          "html": "<div data-gallery-merge-builder="commandInputAttributes" data-state="open" aria-autocomplete="author-aria" aria-expanded="false" autocomplete="author-commandInputAttributes" role="presentation" type="author-commandInputAttributes" value="author-commandInputAttributes" aria-activedescendant="author-aria-activedescendant" aria-controls="author-aria-controls" aria-describedby="author-aria-describedby" id="author-commandInputAttributes" aria-labelledby="author-aria-labelledby" disabled placeholder="author-commandInputAttributes" class="primitive-commandInputAttributes author-commandInputAttributes">merged</div>",
          "name": "commandInputAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="commandItemAttributes" data-state="active" data-selected="author-commandItemAttributes" data-highlighted="author-commandItemAttributes" aria-selected="false" role="presentation" tabIndex="1" id="author-commandItemAttributes" label="author-commandItemAttributes" value="author-commandItemAttributes" class="primitive-commandItemAttributes author-commandItemAttributes">merged</div>",
          "name": "commandItemAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="commandListboxAttributes" data-state="open" role="presentation" id="author-commandListboxAttributes" aria-labelledby="author-aria-labelledby" class="primitive-commandListboxAttributes author-commandListboxAttributes">merged</div>",
          "name": "commandListboxAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="commandRootAttributes" data-state="open" id="author-commandRootAttributes" class="primitive-commandRootAttributes author-commandRootAttributes">merged</div>",
          "name": "commandRootAttributes",
        },
        {
          "diagnostics": 6,
          "html": "<div data-gallery-merge-builder="commandTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" disabled type="author-commandTriggerAttributes" aria-controls="author-aria-controls" command="author-commandTriggerAttributes" commandfor="author-commandfor" id="author-commandTriggerAttributes" aria-labelledby="author-aria-labelledby" class="primitive-commandTriggerAttributes author-commandTriggerAttributes">merged</div>",
          "name": "commandTriggerAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="contextMenuContentAttributes" data-state="open" role="presentation" tabIndex="0" id="author-contextMenuContentAttributes" aria-labelledby="author-aria-labelledby" data-anchor-x="author-contextMenuContentAttributes" data-anchor-y="author-contextMenuContentAttributes" class="primitive-contextMenuContentAttributes author-contextMenuContentAttributes">merged</div>",
          "name": "contextMenuContentAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="contextMenuGroupAttributes" data-state="open" role="presentation" id="author-contextMenuGroupAttributes" aria-labelledby="author-aria-labelledby" class="primitive-contextMenuGroupAttributes author-contextMenuGroupAttributes">merged</div>",
          "name": "contextMenuGroupAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="contextMenuItemAttributes" data-state="active" data-highlighted="author-contextMenuItemAttributes" role="presentation" tabIndex="1" id="author-contextMenuItemAttributes" label="author-contextMenuItemAttributes" value="author-contextMenuItemAttributes" class="primitive-contextMenuItemAttributes author-contextMenuItemAttributes">merged</div>",
          "name": "contextMenuItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="contextMenuRootAttributes" data-state="open" id="author-contextMenuRootAttributes" class="primitive-contextMenuRootAttributes author-contextMenuRootAttributes">merged</div>",
          "name": "contextMenuRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="contextMenuSeparatorAttributes" role="presentation" id="author-contextMenuSeparatorAttributes" class="primitive-contextMenuSeparatorAttributes author-contextMenuSeparatorAttributes">merged</div>",
          "name": "contextMenuSeparatorAttributes",
        },
        {
          "diagnostics": 7,
          "html": "<div data-gallery-merge-builder="contextMenuTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" role="presentation" aria-controls="author-aria-controls" jiso-context-menu="author-jiso-context-menu" id="author-contextMenuTriggerAttributes" aria-labelledby="author-aria-labelledby" class="primitive-contextMenuTriggerAttributes author-contextMenuTriggerAttributes">merged</div>",
          "name": "contextMenuTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="dialogCloseAttributes" data-state="open" disabled type="author-dialogCloseAttributes" command="author-dialogCloseAttributes" commandfor="author-commandfor" class="primitive-dialogCloseAttributes author-dialogCloseAttributes">merged</div>",
          "name": "dialogCloseAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="dialogContentAttributes" data-state="open" open id="author-dialogContentAttributes" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" class="primitive-dialogContentAttributes author-dialogContentAttributes">merged</div>",
          "name": "dialogContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="dialogRootAttributes" data-state="open" class="primitive-dialogRootAttributes author-dialogRootAttributes">merged</div>",
          "name": "dialogRootAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="dialogTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" disabled type="author-dialogTriggerAttributes" aria-controls="author-aria-controls" command="author-dialogTriggerAttributes" commandfor="author-commandfor" class="primitive-dialogTriggerAttributes author-dialogTriggerAttributes">merged</div>",
          "name": "dialogTriggerAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="disclosureContentAttributes" data-state="open" id="author-disclosureContentAttributes" class="primitive-disclosureContentAttributes author-disclosureContentAttributes">merged</div>",
          "name": "disclosureContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="disclosureRootAttributes" data-state="open" class="primitive-disclosureRootAttributes author-disclosureRootAttributes">merged</div>",
          "name": "disclosureRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="disclosureTriggerAttributes" data-state="open" aria-expanded="false" disabled type="author-disclosureTriggerAttributes" aria-controls="author-aria-controls" class="primitive-disclosureTriggerAttributes author-disclosureTriggerAttributes">merged</div>",
          "name": "disclosureTriggerAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="dropdownMenuContentAttributes" data-state="open" role="presentation" tabIndex="0" id="author-dropdownMenuContentAttributes" aria-labelledby="author-aria-labelledby" class="primitive-dropdownMenuContentAttributes author-dropdownMenuContentAttributes">merged</div>",
          "name": "dropdownMenuContentAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="dropdownMenuGroupAttributes" data-state="open" role="presentation" id="author-dropdownMenuGroupAttributes" aria-labelledby="author-aria-labelledby" class="primitive-dropdownMenuGroupAttributes author-dropdownMenuGroupAttributes">merged</div>",
          "name": "dropdownMenuGroupAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="dropdownMenuItemAttributes" data-state="active" data-highlighted="author-dropdownMenuItemAttributes" role="presentation" tabIndex="1" id="author-dropdownMenuItemAttributes" label="author-dropdownMenuItemAttributes" value="author-dropdownMenuItemAttributes" class="primitive-dropdownMenuItemAttributes author-dropdownMenuItemAttributes">merged</div>",
          "name": "dropdownMenuItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="dropdownMenuRootAttributes" data-state="open" id="author-dropdownMenuRootAttributes" class="primitive-dropdownMenuRootAttributes author-dropdownMenuRootAttributes">merged</div>",
          "name": "dropdownMenuRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="dropdownMenuSeparatorAttributes" role="presentation" id="author-dropdownMenuSeparatorAttributes" class="primitive-dropdownMenuSeparatorAttributes author-dropdownMenuSeparatorAttributes">merged</div>",
          "name": "dropdownMenuSeparatorAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="dropdownMenuTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" disabled type="author-dropdownMenuTriggerAttributes" aria-controls="author-aria-controls" id="author-dropdownMenuTriggerAttributes" aria-labelledby="author-aria-labelledby" class="primitive-dropdownMenuTriggerAttributes author-dropdownMenuTriggerAttributes">merged</div>",
          "name": "dropdownMenuTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="fieldControlAttributes" data-invalid="author-fieldControlAttributes" data-required="author-fieldControlAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" id="author-fieldControlAttributes" name="author-fieldControlAttributes" required class="primitive-fieldControlAttributes author-fieldControlAttributes">merged</div>",
          "name": "fieldControlAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="fieldDescriptionAttributes" data-invalid="author-fieldDescriptionAttributes" data-required="author-fieldDescriptionAttributes" id="author-fieldDescriptionAttributes" class="primitive-fieldDescriptionAttributes author-fieldDescriptionAttributes">merged</div>",
          "name": "fieldDescriptionAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="fieldErrorAttributes" data-invalid="author-fieldErrorAttributes" data-required="author-fieldErrorAttributes" id="author-fieldErrorAttributes" role="presentation" class="primitive-fieldErrorAttributes author-fieldErrorAttributes">merged</div>",
          "name": "fieldErrorAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="fieldLabelAttributes" data-invalid="author-fieldLabelAttributes" data-required="author-fieldLabelAttributes" id="author-fieldLabelAttributes" for="author-for" class="primitive-fieldLabelAttributes author-fieldLabelAttributes">merged</div>",
          "name": "fieldLabelAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="fieldRootAttributes" data-invalid="author-fieldRootAttributes" data-required="author-fieldRootAttributes" id="author-fieldRootAttributes" class="primitive-fieldRootAttributes author-fieldRootAttributes">merged</div>",
          "name": "fieldRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="fieldsetLegendAttributes" data-invalid="author-fieldsetLegendAttributes" data-required="author-fieldsetLegendAttributes" id="author-fieldsetLegendAttributes" class="primitive-fieldsetLegendAttributes author-fieldsetLegendAttributes">merged</div>",
          "name": "fieldsetLegendAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="fieldsetRootAttributes" data-invalid="author-fieldsetRootAttributes" data-required="author-fieldsetRootAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" id="author-fieldsetRootAttributes" name="author-fieldsetRootAttributes" class="primitive-fieldsetRootAttributes author-fieldsetRootAttributes">merged</div>",
          "name": "fieldsetRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="hoverCardContentAttributes" data-state="open" id="author-hoverCardContentAttributes" popover="author-hoverCardContentAttributes" class="primitive-hoverCardContentAttributes author-hoverCardContentAttributes">merged</div>",
          "name": "hoverCardContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="hoverCardRootAttributes" data-state="open" class="primitive-hoverCardRootAttributes author-hoverCardRootAttributes">merged</div>",
          "name": "hoverCardRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="hoverCardTriggerAttributes" data-state="open" aria-expanded="false" aria-controls="author-aria-controls" jiso-hover-card="author-jiso-hover-card" class="primitive-hoverCardTriggerAttributes author-hoverCardTriggerAttributes">merged</div>",
          "name": "hoverCardTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="menubarGroupAttributes" data-state="closed" data-orientation="author-menubarGroupAttributes" role="presentation" id="author-menubarGroupAttributes" class="primitive-menubarGroupAttributes author-menubarGroupAttributes">merged</div>",
          "name": "menubarGroupAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="menubarItemAttributes" data-state="active" data-highlighted="author-menubarItemAttributes" role="presentation" tabIndex="1" value="author-menubarItemAttributes" id="author-menubarItemAttributes" label="author-menubarItemAttributes" class="primitive-menubarItemAttributes author-menubarItemAttributes">merged</div>",
          "name": "menubarItemAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="menubarRootAttributes" data-state="closed" data-orientation="author-menubarRootAttributes" role="presentation" id="author-menubarRootAttributes" class="primitive-menubarRootAttributes author-menubarRootAttributes">merged</div>",
          "name": "menubarRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="menubarSeparatorAttributes" role="presentation" id="author-menubarSeparatorAttributes" class="primitive-menubarSeparatorAttributes author-menubarSeparatorAttributes">merged</div>",
          "name": "menubarSeparatorAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="menubarSubmenuAttributes" data-state="open" role="presentation" tabIndex="0" id="author-menubarSubmenuAttributes" class="primitive-menubarSubmenuAttributes author-menubarSubmenuAttributes">merged</div>",
          "name": "menubarSubmenuAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="meterRootAttributes" data-high="author-meterRootAttributes" data-low="author-meterRootAttributes" data-max="author-meterRootAttributes" data-min="author-meterRootAttributes" data-optimum="author-meterRootAttributes" data-state="optimum" data-value="author-meterRootAttributes" high="91" low="31" max="101" min="1" optimum="51" value="41" aria-valuetext="author-aria" class="primitive-meterRootAttributes author-meterRootAttributes">merged</div>",
          "name": "meterRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="navigationMenuContentAttributes" data-state="closed" role="presentation" tabIndex="0" id="author-navigationMenuContentAttributes" aria-labelledby="author-aria-labelledby" hidden class="primitive-navigationMenuContentAttributes author-navigationMenuContentAttributes">merged</div>",
          "name": "navigationMenuContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="navigationMenuIndicatorAttributes" data-state="open" id="author-navigationMenuIndicatorAttributes" class="primitive-navigationMenuIndicatorAttributes author-navigationMenuIndicatorAttributes">merged</div>",
          "name": "navigationMenuIndicatorAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="navigationMenuItemAttributes" data-state="active" data-highlighted="author-navigationMenuItemAttributes" role="presentation" id="author-navigationMenuItemAttributes" class="primitive-navigationMenuItemAttributes author-navigationMenuItemAttributes">merged</div>",
          "name": "navigationMenuItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="navigationMenuLinkAttributes" data-state="active" data-highlighted="author-navigationMenuLinkAttributes" tabIndex="1" value="author-navigationMenuLinkAttributes" href="author-navigationMenuLinkAttributes" id="author-navigationMenuLinkAttributes" label="author-navigationMenuLinkAttributes" class="primitive-navigationMenuLinkAttributes author-navigationMenuLinkAttributes">merged</div>",
          "name": "navigationMenuLinkAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="navigationMenuListAttributes" data-state="open" data-orientation="author-navigationMenuListAttributes" role="presentation" id="author-navigationMenuListAttributes" aria-labelledby="author-aria-labelledby" class="primitive-navigationMenuListAttributes author-navigationMenuListAttributes">merged</div>",
          "name": "navigationMenuListAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="navigationMenuRootAttributes" data-state="open" data-orientation="author-navigationMenuRootAttributes" role="presentation" id="author-navigationMenuRootAttributes" aria-label="author-aria" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" class="primitive-navigationMenuRootAttributes author-navigationMenuRootAttributes">merged</div>",
          "name": "navigationMenuRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="navigationMenuTriggerAttributes" data-state="open" data-highlighted="author-navigationMenuTriggerAttributes" aria-expanded="false" aria-haspopup="false" disabled tabIndex="1" type="author-navigationMenuTriggerAttributes" value="author-navigationMenuTriggerAttributes" aria-controls="author-aria-controls" id="author-navigationMenuTriggerAttributes" label="author-navigationMenuTriggerAttributes" class="primitive-navigationMenuTriggerAttributes author-navigationMenuTriggerAttributes">merged</div>",
          "name": "navigationMenuTriggerAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="navigationMenuViewportAttributes" data-state="open" id="author-navigationMenuViewportAttributes" class="primitive-navigationMenuViewportAttributes author-navigationMenuViewportAttributes">merged</div>",
          "name": "navigationMenuViewportAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="numberFieldDecrementAttributes" data-invalid="author-numberFieldDecrementAttributes" data-required="author-numberFieldDecrementAttributes" data-action="author-numberFieldDecrementAttributes" aria-label="author-aria" disabled type="author-numberFieldDecrementAttributes" id="author-numberFieldDecrementAttributes" class="primitive-numberFieldDecrementAttributes author-numberFieldDecrementAttributes">merged</div>",
          "name": "numberFieldDecrementAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="numberFieldIncrementAttributes" data-invalid="author-numberFieldIncrementAttributes" data-required="author-numberFieldIncrementAttributes" data-action="author-numberFieldIncrementAttributes" aria-label="author-aria" disabled type="author-numberFieldIncrementAttributes" id="author-numberFieldIncrementAttributes" class="primitive-numberFieldIncrementAttributes author-numberFieldIncrementAttributes">merged</div>",
          "name": "numberFieldIncrementAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="numberFieldInputAttributes" data-invalid="author-numberFieldInputAttributes" data-required="author-numberFieldInputAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" aria-label="author-aria" aria-labelledby="author-aria-labelledby" disabled id="author-numberFieldInputAttributes" max="11" min="1" name="author-numberFieldInputAttributes" required step="2" type="author-numberFieldInputAttributes" value="5" class="primitive-numberFieldInputAttributes author-numberFieldInputAttributes">merged</div>",
          "name": "numberFieldInputAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="numberFieldRootAttributes" data-invalid="author-numberFieldRootAttributes" data-required="author-numberFieldRootAttributes" id="author-numberFieldRootAttributes" class="primitive-numberFieldRootAttributes author-numberFieldRootAttributes">merged</div>",
          "name": "numberFieldRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="otpFieldHiddenInputAttributes" data-invalid="author-otpFieldHiddenInputAttributes" data-required="author-otpFieldHiddenInputAttributes" aria-hidden="false" data-slot="author-otpFieldHiddenInputAttributes" autoComplete="author-otpFieldHiddenInputAttributes" disabled inputMode="author-otpFieldHiddenInputAttributes" maxLength="7" minLength="7" tabIndex="0" type="author-otpFieldHiddenInputAttributes" value="author-otpFieldHiddenInputAttributes" id="author-otpFieldHiddenInputAttributes" name="author-otpFieldHiddenInputAttributes" required class="primitive-otpFieldHiddenInputAttributes author-otpFieldHiddenInputAttributes">merged</div>",
          "name": "otpFieldHiddenInputAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="otpFieldInputAttributes" data-invalid="author-otpFieldInputAttributes" data-required="author-otpFieldInputAttributes" data-filled="author-otpFieldInputAttributes" aria-label="author-aria" data-slot="author-otpFieldInputAttributes" autoComplete="author-otpFieldInputAttributes" disabled inputMode="author-otpFieldInputAttributes" maxLength="2" type="author-otpFieldInputAttributes" value="author-otpFieldInputAttributes" id="author-otpFieldInputAttributes" required aria-invalid="false" class="primitive-otpFieldInputAttributes author-otpFieldInputAttributes">merged</div>",
          "name": "otpFieldInputAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="otpFieldRootAttributes" data-invalid="author-otpFieldRootAttributes" data-required="author-otpFieldRootAttributes" role="presentation" id="author-otpFieldRootAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" class="primitive-otpFieldRootAttributes author-otpFieldRootAttributes">merged</div>",
          "name": "otpFieldRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="popoverContentAttributes" data-state="open" id="author-popoverContentAttributes" popover="author-popoverContentAttributes" class="primitive-popoverContentAttributes author-popoverContentAttributes">merged</div>",
          "name": "popoverContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="popoverRootAttributes" data-state="open" class="primitive-popoverRootAttributes author-popoverRootAttributes">merged</div>",
          "name": "popoverRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="popoverTriggerAttributes" data-state="open" aria-expanded="false" disabled type="author-popoverTriggerAttributes" aria-controls="author-aria-controls" popovertarget="author-popovertarget" popovertargetaction="author-popoverTriggerAttributes" class="primitive-popoverTriggerAttributes author-popoverTriggerAttributes">merged</div>",
          "name": "popoverTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="progressRootAttributes" data-max="author-progressRootAttributes" data-state="loading" max="101" data-value="author-progressRootAttributes" value="41" aria-valuetext="author-aria" class="primitive-progressRootAttributes author-progressRootAttributes">merged</div>",
          "name": "progressRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="radioGroupItemAttributes" data-state="checked" id="author-radioGroupItemAttributes" class="primitive-radioGroupItemAttributes author-radioGroupItemAttributes">merged</div>",
          "name": "radioGroupItemAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="radioGroupLabelAttributes" data-state="checked" for="author-for" id="author-radioGroupLabelAttributes" class="primitive-radioGroupLabelAttributes author-radioGroupLabelAttributes">merged</div>",
          "name": "radioGroupLabelAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="radioGroupRadioAttributes" data-state="checked" aria-checked="false" checked disabled tabIndex="1" type="author-radioGroupRadioAttributes" value="author-radioGroupRadioAttributes" id="author-radioGroupRadioAttributes" name="author-radioGroupRadioAttributes" required class="primitive-radioGroupRadioAttributes author-radioGroupRadioAttributes">merged</div>",
          "name": "radioGroupRadioAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="radioGroupRootAttributes" data-orientation="author-radioGroupRootAttributes" data-invalid="author-radioGroupRootAttributes" data-required="author-radioGroupRootAttributes" role="presentation" id="author-radioGroupRootAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" aria-required="false" class="primitive-radioGroupRootAttributes author-radioGroupRootAttributes">merged</div>",
          "name": "radioGroupRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="scrollAreaCornerAttributes" data-scrollbars="author-scrollAreaCornerAttributes" data-state="visible" aria-hidden="false" id="author-scrollAreaCornerAttributes" class="primitive-scrollAreaCornerAttributes author-scrollAreaCornerAttributes">merged</div>",
          "name": "scrollAreaCornerAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="scrollAreaRootAttributes" data-scrollbars="author-scrollAreaRootAttributes" dir="author-scrollAreaRootAttributes" id="author-scrollAreaRootAttributes" class="primitive-scrollAreaRootAttributes author-scrollAreaRootAttributes">merged</div>",
          "name": "scrollAreaRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="scrollAreaScrollbarAttributes" data-scrollbars="author-scrollAreaScrollbarAttributes" data-orientation="author-scrollAreaScrollbarAttributes" data-state="visible" aria-hidden="false" id="author-scrollAreaScrollbarAttributes" class="primitive-scrollAreaScrollbarAttributes author-scrollAreaScrollbarAttributes">merged</div>",
          "name": "scrollAreaScrollbarAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="scrollAreaThumbAttributes" data-scrollbars="author-scrollAreaThumbAttributes" data-orientation="author-scrollAreaThumbAttributes" data-state="visible" aria-hidden="false" id="author-scrollAreaThumbAttributes" class="primitive-scrollAreaThumbAttributes author-scrollAreaThumbAttributes">merged</div>",
          "name": "scrollAreaThumbAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="scrollAreaViewportAttributes" data-scrollbars="author-scrollAreaViewportAttributes" tabIndex="1" aria-describedby="author-aria-describedby" role="presentation" aria-label="author-aria" aria-labelledby="author-aria-labelledby" id="author-scrollAreaViewportAttributes" class="primitive-scrollAreaViewportAttributes author-scrollAreaViewportAttributes">merged</div>",
          "name": "scrollAreaViewportAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="selectContentAttributes" data-state="open" data-invalid="author-selectContentAttributes" data-required="author-selectContentAttributes" id="author-selectContentAttributes" aria-labelledby="author-aria-labelledby" class="primitive-selectContentAttributes author-selectContentAttributes">merged</div>",
          "name": "selectContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="selectItemAttributes" data-state="checked" selected value="author-selectItemAttributes" label="author-selectItemAttributes" class="primitive-selectItemAttributes author-selectItemAttributes">merged</div>",
          "name": "selectItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="selectRootAttributes" data-state="open" data-invalid="author-selectRootAttributes" data-required="author-selectRootAttributes" id="author-selectRootAttributes" class="primitive-selectRootAttributes author-selectRootAttributes">merged</div>",
          "name": "selectRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="selectTriggerAttributes" data-state="open" data-invalid="author-selectTriggerAttributes" data-required="author-selectTriggerAttributes" aria-expanded="false" id="author-selectTriggerAttributes" aria-labelledby="author-aria-labelledby" aria-invalid="false" name="author-selectTriggerAttributes" required class="primitive-selectTriggerAttributes author-selectTriggerAttributes">merged</div>",
          "name": "selectTriggerAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="selectValueAttributes" id="author-selectValueAttributes" class="primitive-selectValueAttributes author-selectValueAttributes">merged</div>",
          "name": "selectValueAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="separatorRootAttributes" data-orientation="author-separatorRootAttributes" aria-orientation="author-aria" role="presentation" class="primitive-separatorRootAttributes author-separatorRootAttributes">merged</div>",
          "name": "separatorRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="sliderInputAttributes" data-orientation="author-sliderInputAttributes" data-invalid="author-sliderInputAttributes" data-required="author-sliderInputAttributes" data-max="author-sliderInputAttributes" data-min="author-sliderInputAttributes" data-value="author-sliderInputAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" aria-labelledby="author-aria-labelledby" aria-valuetext="author-aria" disabled id="author-sliderInputAttributes" max="101" min="1" name="author-sliderInputAttributes" required step="2" type="author-sliderInputAttributes" value="41" class="primitive-sliderInputAttributes author-sliderInputAttributes">merged</div>",
          "name": "sliderInputAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="sliderRangeAttributes" data-orientation="author-sliderRangeAttributes" data-invalid="author-sliderRangeAttributes" data-required="author-sliderRangeAttributes" data-max="author-sliderRangeAttributes" data-min="author-sliderRangeAttributes" data-value="author-sliderRangeAttributes" aria-hidden="false" data-part="author-sliderRangeAttributes" data-value-ratio="author-sliderRangeAttributes" id="author-sliderRangeAttributes" class="primitive-sliderRangeAttributes author-sliderRangeAttributes">merged</div>",
          "name": "sliderRangeAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="sliderRootAttributes" data-orientation="author-sliderRootAttributes" data-invalid="author-sliderRootAttributes" data-required="author-sliderRootAttributes" data-max="author-sliderRootAttributes" data-min="author-sliderRootAttributes" data-value="author-sliderRootAttributes" id="author-sliderRootAttributes" class="primitive-sliderRootAttributes author-sliderRootAttributes">merged</div>",
          "name": "sliderRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="sliderThumbAttributes" data-orientation="author-sliderThumbAttributes" data-invalid="author-sliderThumbAttributes" data-required="author-sliderThumbAttributes" data-max="author-sliderThumbAttributes" data-min="author-sliderThumbAttributes" data-value="author-sliderThumbAttributes" aria-hidden="false" data-part="author-sliderThumbAttributes" data-value-ratio="author-sliderThumbAttributes" id="author-sliderThumbAttributes" class="primitive-sliderThumbAttributes author-sliderThumbAttributes">merged</div>",
          "name": "sliderThumbAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="sliderTrackAttributes" data-orientation="author-sliderTrackAttributes" data-invalid="author-sliderTrackAttributes" data-required="author-sliderTrackAttributes" data-max="author-sliderTrackAttributes" data-min="author-sliderTrackAttributes" data-value="author-sliderTrackAttributes" aria-hidden="false" data-part="author-sliderTrackAttributes" data-value-ratio="author-sliderTrackAttributes" id="author-sliderTrackAttributes" class="primitive-sliderTrackAttributes author-sliderTrackAttributes">merged</div>",
          "name": "sliderTrackAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="switchRootAttributes" data-state="checked" aria-checked="false" checked disabled name="author-switchRootAttributes" role="presentation" required type="author-switchRootAttributes" value="author-switchRootAttributes" class="primitive-switchRootAttributes author-switchRootAttributes">merged</div>",
          "name": "switchRootAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="tabsListAttributes" data-orientation="author-tabsListAttributes" role="presentation" id="author-tabsListAttributes" aria-label="author-aria" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" aria-orientation="author-aria" class="primitive-tabsListAttributes author-tabsListAttributes">merged</div>",
          "name": "tabsListAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="tabsPanelAttributes" data-state="active" role="presentation" tabIndex="1" aria-labelledby="author-aria-labelledby" id="author-tabsPanelAttributes" class="primitive-tabsPanelAttributes author-tabsPanelAttributes">merged</div>",
          "name": "tabsPanelAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="tabsRootAttributes" data-orientation="author-tabsRootAttributes" id="author-tabsRootAttributes" class="primitive-tabsRootAttributes author-tabsRootAttributes">merged</div>",
          "name": "tabsRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="tabsTriggerAttributes" data-state="active" aria-selected="false" disabled role="presentation" tabIndex="1" type="author-tabsTriggerAttributes" value="author-tabsTriggerAttributes" aria-controls="author-aria-controls" id="author-tabsTriggerAttributes" class="primitive-tabsTriggerAttributes author-tabsTriggerAttributes">merged</div>",
          "name": "tabsTriggerAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toastActionAttributes" data-state="open" data-variant="author-toastActionAttributes" data-action="author-toastActionAttributes" disabled type="author-toastActionAttributes" class="primitive-toastActionAttributes author-toastActionAttributes">merged</div>",
          "name": "toastActionAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toastCloseAttributes" data-state="open" data-variant="author-toastCloseAttributes" data-dismiss="author-toastCloseAttributes" disabled type="author-toastCloseAttributes" class="primitive-toastCloseAttributes author-toastCloseAttributes">merged</div>",
          "name": "toastCloseAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="toastDescriptionAttributes" data-part="author-toastDescriptionAttributes" id="author-toastDescriptionAttributes" class="primitive-toastDescriptionAttributes author-toastDescriptionAttributes">merged</div>",
          "name": "toastDescriptionAttributes",
        },
        {
          "diagnostics": 6,
          "html": "<div data-gallery-merge-builder="toastRootAttributes" data-state="open" data-variant="author-toastRootAttributes" aria-atomic="false" aria-live="author-aria" aria-describedby="author-aria-describedby" aria-labelledby="author-aria-labelledby" id="author-toastRootAttributes" role="presentation" class="primitive-toastRootAttributes author-toastRootAttributes">merged</div>",
          "name": "toastRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="toastTitleAttributes" data-part="author-toastTitleAttributes" id="author-toastTitleAttributes" class="primitive-toastTitleAttributes author-toastTitleAttributes">merged</div>",
          "name": "toastTitleAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="toastViewportAttributes" data-placement="author-toastViewportAttributes" aria-label="author-aria" role="presentation" tabIndex="0" id="author-toastViewportAttributes" class="primitive-toastViewportAttributes author-toastViewportAttributes">merged</div>",
          "name": "toastViewportAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="toggleGroupButtonAttributes" data-state="pressed" aria-pressed="false" disabled tabIndex="1" type="author-toggleGroupButtonAttributes" value="author-toggleGroupButtonAttributes" id="author-toggleGroupButtonAttributes" class="primitive-toggleGroupButtonAttributes author-toggleGroupButtonAttributes">merged</div>",
          "name": "toggleGroupButtonAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toggleGroupItemAttributes" data-state="pressed" id="author-toggleGroupItemAttributes" class="primitive-toggleGroupItemAttributes author-toggleGroupItemAttributes">merged</div>",
          "name": "toggleGroupItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toggleGroupRootAttributes" data-orientation="author-toggleGroupRootAttributes" role="presentation" id="author-toggleGroupRootAttributes" class="primitive-toggleGroupRootAttributes author-toggleGroupRootAttributes">merged</div>",
          "name": "toggleGroupRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="toggleRootAttributes" data-state="pressed" aria-pressed="false" disabled type="author-toggleRootAttributes" class="primitive-toggleRootAttributes author-toggleRootAttributes">merged</div>",
          "name": "toggleRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="toolbarButtonAttributes" disabled tabIndex="1" type="author-toolbarButtonAttributes" value="author-toolbarButtonAttributes" id="author-toolbarButtonAttributes" class="primitive-toolbarButtonAttributes author-toolbarButtonAttributes">merged</div>",
          "name": "toolbarButtonAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="toolbarItemAttributes" id="author-toolbarItemAttributes" class="primitive-toolbarItemAttributes author-toolbarItemAttributes">merged</div>",
          "name": "toolbarItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toolbarRootAttributes" data-orientation="author-toolbarRootAttributes" role="presentation" id="author-toolbarRootAttributes" class="primitive-toolbarRootAttributes author-toolbarRootAttributes">merged</div>",
          "name": "toolbarRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="tooltipContentAttributes" data-state="open" id="author-tooltipContentAttributes" popover="author-tooltipContentAttributes" role="presentation" class="primitive-tooltipContentAttributes author-tooltipContentAttributes">merged</div>",
          "name": "tooltipContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="tooltipRootAttributes" data-state="open" class="primitive-tooltipRootAttributes author-tooltipRootAttributes">merged</div>",
          "name": "tooltipRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="tooltipTriggerAttributes" data-state="open" jiso-tooltip="author-jiso-tooltip" aria-describedby="author-aria-describedby" class="primitive-tooltipTriggerAttributes author-tooltipTriggerAttributes">merged</div>",
          "name": "tooltipTriggerAttributes",
        },
      ]
    `);
  });
});

function renderMergedBuilder(name: string, attrs: AttributeRecord): string {
  return (
    <div data-gallery-merge-builder={name} {...attrs}>
      merged
    </div>
  );
}

function samplePrimitiveAttributes(name: (typeof primitiveAttributeBuilderNames)[number]) {
  const builder = primitiveExports[name] as (options?: Record<string, unknown>) => AttributeRecord;

  if (name.startsWith('accordion')) return builder(accordionSample);
  if (name.startsWith('alertDialog')) return builder(dialogSample);
  if (name.startsWith('autocomplete')) return builder(autocompleteSample);
  if (name.startsWith('avatar')) return builder(avatarSample);
  if (name.startsWith('checkboxGroup')) return builder(checkboxGroupSample);
  if (name.startsWith('checkbox')) return builder(checkboxSample);
  if (name.startsWith('collapsible')) return builder(openSample);
  if (name.startsWith('combobox')) return builder(comboboxSample);
  if (name.startsWith('command')) return builder(commandSample);
  if (name.startsWith('contextMenu')) return builder(menuSample);
  if (name.startsWith('dialog')) return builder(dialogSample);
  if (name.startsWith('disclosure')) return builder(openSample);
  if (name.startsWith('dropdownMenu')) return builder(menuSample);
  if (name.startsWith('fieldset')) return builder(fieldSample);
  if (name.startsWith('field')) return builder(fieldSample);
  if (name.startsWith('hoverCard')) return builder(hoverCardSample);
  if (name.startsWith('menubar')) return builder(menubarSample);
  if (name.startsWith('meter')) return builder(meterSample);
  if (name.startsWith('navigationMenu')) return builder(navigationMenuSample);
  if (name.startsWith('numberField')) return builder(numberFieldSample);
  if (name.startsWith('otpField')) return builder(otpFieldSample);
  if (name.startsWith('popover')) return builder(popoverSample);
  if (name.startsWith('progress')) return builder(progressSample);
  if (name.startsWith('radioGroup')) return builder(radioGroupSample);
  if (name.startsWith('scrollArea')) return builder(scrollAreaSample);
  if (name.startsWith('select')) return builder(selectSample);
  if (name.startsWith('separator')) return builder(separatorSample);
  if (name.startsWith('slider')) return builder(sliderSample);
  if (name.startsWith('switch')) return builder(switchSample);
  if (name.startsWith('tabs')) return builder(tabsSample);
  if (name.startsWith('toast')) return builder(toastSample);
  if (name.startsWith('toggleGroup')) return builder(toggleGroupSample);
  if (name.startsWith('toggle')) return builder(toggleSample);
  if (name.startsWith('toolbar')) return builder(toolbarSample);
  if (name.startsWith('tooltip')) return builder(tooltipSample);

  throw new Error(`Missing primitive attrs sample for ${name}`);
}

function authorStressAttrs(name: string, primitive: AttributeRecord): AttributeRecord {
  const author: Record<string, AttributeValue> = {
    class: `author-${name}`,
  };

  for (const attr of Object.keys(primitive)) {
    const value = primitive[attr];
    if (value === undefined || attr === 'class') continue;

    if (attr === 'data-state') {
      author[attr] = 'author-state';
      continue;
    }

    if (attr === 'role') {
      author[attr] = 'presentation';
      continue;
    }

    if (idrefAttributes.has(attr)) {
      author[attr] = `author-${attr}`;
      continue;
    }

    if (attr.startsWith('aria-')) {
      author[attr] = value === 'true' ? 'false' : 'author-aria';
      continue;
    }

    if (logicalOrAttributes.has(attr)) {
      author[attr] = true;
      continue;
    }

    if (attr === 'id') {
      author[attr] = `author-${name}`;
      continue;
    }

    if (typeof value === 'number') {
      author[attr] = value + 1;
      continue;
    }

    if (typeof value === 'string') {
      author[attr] = `author-${name}`;
    }
  }

  return author;
}

const accordionSample = {
  contentId: 'panel',
  disabled: false,
  itemValue: 'one',
  level: 3,
  orientation: 'horizontal',
  triggerId: 'trigger',
  type: 'multiple',
  value: ['one'],
};
const autocompleteSample = {
  descriptionId: 'description',
  errorId: 'error',
  highlightedValue: 'one',
  id: 'autocomplete',
  inputValue: 'on',
  invalid: true,
  items: [{ label: 'One', value: 'one' }],
  labelledBy: 'label',
  listId: 'list',
  name: 'autocomplete',
  open: true,
  placeholder: 'Pick one',
  required: true,
  value: 'one',
};
const avatarSample = {
  delayMs: 250,
  label: 'Avatar',
  src: '/avatar.png',
  status: 'loaded',
};
const checkboxGroupSample = {
  activeValue: 'one',
  controlId: 'control',
  descriptionId: 'description',
  errorId: 'error',
  id: 'checkbox-group',
  invalid: true,
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  name: 'checkbox-group',
  orientation: 'horizontal',
  required: true,
  value: ['one'],
};
const checkboxSample = {
  checked: 'indeterminate',
  disabled: false,
  id: 'checkbox',
  name: 'checkbox',
  required: true,
  value: 'one',
};
const comboboxSample = {
  descriptionId: 'description',
  errorId: 'error',
  highlightedValue: 'one',
  id: 'combobox',
  invalid: true,
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  labelledBy: 'label',
  listboxId: 'listbox',
  name: 'combobox',
  open: true,
  placeholder: 'Pick one',
  required: true,
  value: 'one',
};
const commandSample = {
  contentId: 'command-dialog',
  descriptionId: 'description',
  highlightedValue: 'one',
  id: 'command',
  inputValue: 'on',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  labelledBy: 'label',
  listboxId: 'listbox',
  open: true,
  placeholder: 'Run command',
  titleId: 'title',
  value: 'one',
};
const dialogSample = {
  contentId: 'dialog',
  descriptionId: 'description',
  disabled: false,
  open: true,
  titleId: 'title',
};
const fieldSample = {
  controlId: 'control',
  descriptionId: 'description',
  errorId: 'error',
  id: 'field',
  invalid: true,
  name: 'field',
  required: true,
  visible: true,
};
const hoverCardSample = {
  contentId: 'hover-card-content',
  id: 'hover-card',
  labelledBy: 'label',
  open: true,
};
const menuSample = {
  contentId: 'menu-content',
  highlightedValue: 'one',
  id: 'menu',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  labelledBy: 'label',
  open: true,
  point: { x: 10, y: 20 },
};
const menubarSample = {
  activeValue: 'one',
  highlightedValue: 'one',
  id: 'menubar',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  orientation: 'horizontal',
  submenuOpenValue: 'one',
};
const meterSample = {
  high: 90,
  id: 'meter',
  label: 'Usage',
  labelledBy: 'label',
  low: 30,
  max: 100,
  min: 0,
  optimum: 50,
  value: 40,
  valueText: '40 percent',
};
const navigationMenuSample = {
  activeValue: 'one',
  contentId: 'nav-content',
  descriptionId: 'description',
  href: '/one',
  id: 'navigation-menu',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  label: 'Navigation',
  labelledBy: 'label',
  openValue: 'one',
};
const numberFieldSample = {
  descriptionId: 'description',
  errorId: 'error',
  id: 'number-field',
  invalid: true,
  label: 'Quantity',
  labelledBy: 'label',
  max: 10,
  min: 0,
  name: 'quantity',
  required: true,
  step: 1,
  value: 4,
};
const openSample = {
  contentId: 'content',
  disabled: false,
  open: true,
};
const otpFieldSample = {
  descriptionId: 'description',
  errorId: 'error',
  id: 'otp',
  invalid: true,
  length: 6,
  name: 'otp',
  required: true,
  slot: 0,
  value: '123',
};
const popoverSample = {
  contentId: 'popover-content',
  id: 'popover',
  labelledBy: 'label',
  open: true,
};
const progressSample = {
  id: 'progress',
  label: 'Progress',
  labelledBy: 'label',
  max: 100,
  value: 40,
  valueText: '40 percent',
};
const radioGroupSample = {
  activeValue: 'one',
  controlId: 'radio',
  descriptionId: 'description',
  errorId: 'error',
  id: 'radio-group',
  invalid: true,
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  name: 'radio-group',
  orientation: 'horizontal',
  required: true,
  value: 'one',
};
const scrollAreaSample = {
  descriptionId: 'description',
  dir: 'ltr',
  id: 'scroll-area',
  label: 'Scroll area',
  labelledBy: 'label',
  orientation: 'horizontal',
  scrollbars: 'both',
  visible: true,
};
const selectSample = {
  contentId: 'select-content',
  highlightedValue: 'one',
  id: 'select',
  invalid: true,
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  label: 'One',
  labelledBy: 'label',
  name: 'select',
  open: true,
  placeholder: 'Pick one',
  required: true,
  value: 'one',
};
const separatorSample = {
  decorative: false,
  id: 'separator',
  orientation: 'vertical',
};
const sliderSample = {
  descriptionId: 'description',
  errorId: 'error',
  id: 'slider',
  invalid: true,
  labelledBy: 'label',
  max: 100,
  min: 0,
  name: 'slider',
  orientation: 'horizontal',
  required: true,
  step: 1,
  value: 40,
  valueText: '40 percent',
};
const switchSample = {
  checked: true,
  id: 'switch',
  name: 'switch',
  required: true,
  value: 'on',
};
const tabsSample = {
  activeValue: 'one',
  descriptionId: 'description',
  id: 'tabs',
  itemValue: 'one',
  items: [{ value: 'one' }],
  label: 'Tabs',
  labelledBy: 'label',
  orientation: 'vertical',
  panelId: 'panel',
  triggerId: 'trigger',
  value: 'one',
};
const toastSample = {
  descriptionId: 'description',
  id: 'toast',
  intent: 'action',
  label: 'Undo',
  open: true,
  titleId: 'title',
};
const toggleGroupSample = {
  activeValue: 'one',
  id: 'toggle-group',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  name: 'toggle-group',
  orientation: 'horizontal',
  type: 'multiple',
  value: ['one'],
};
const toggleSample = {
  disabled: false,
  id: 'toggle',
  label: 'Toggle',
  pressed: true,
};
const toolbarSample = {
  activeValue: 'one',
  id: 'toolbar',
  itemLabel: 'One',
  itemValue: 'one',
  items: [{ label: 'One', value: 'one' }],
  orientation: 'horizontal',
};
const tooltipSample = {
  contentId: 'tooltip-content',
  id: 'tooltip',
  labelledBy: 'label',
  open: true,
};

function mergePrimitiveAttrs(
  primitive: AttributeRecord,
  author: AttributeRecord,
): MergeFixtureResult {
  const attrs: Record<string, AttributeValue> = {};
  const diagnostics: MergeDiagnostic[] = [];
  const keys = stableKeys(primitive, author);

  // SPEC.md §4.6 is the normative merge table. This gallery-only oracle keeps
  // G5 deterministic while compiler/runtime merge lowering remains outside this slice.
  for (const key of keys) {
    const primitiveValue = primitive[key];
    const authorValue = author[key];
    const primitiveSet = primitiveValue !== undefined;
    const authorSet = authorValue !== undefined;

    if (key === 'class') {
      attrs[key] = mergeTokenLists(primitiveValue, authorValue);
      continue;
    }

    if (key === 'style') {
      attrs[key] = mergeStyles(primitiveValue, authorValue);
      continue;
    }

    if (key.startsWith('on:')) {
      attrs[key] = mergeRefs(authorValue, primitiveValue);
      continue;
    }

    if (key === 'id') {
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (idrefAttributes.has(key)) {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW231',
          message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (key.startsWith('aria-') || key === 'role') {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW232',
          message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (key === 'data-state') {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW232',
          message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
        });
      }
      attrs[key] = primitiveSet ? primitiveValue : authorValue;
      continue;
    }

    if (key.startsWith('data-p-')) {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW231',
          message: 'Unmergeable primitive handler-param conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (key === 'data-bind' || key.startsWith('data-bind:')) {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW233',
          message: 'Unmergeable primitive binding conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (logicalOrAttributes.has(key)) {
      attrs[key] = Boolean(primitiveValue) || Boolean(authorValue);
      continue;
    }

    if (key === 'fw-deps') {
      attrs[key] = mergeTokenLists(primitiveValue, authorValue);
      continue;
    }

    if (key === 'fw-c' || key === 'fw-state') {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW231',
          message: 'Unmergeable primitive island conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    attrs[key] = authorSet ? authorValue : primitiveValue;
  }

  return { attrs, diagnostics };
}

function rewriteIdrefs(
  attrs: AttributeRecord,
  rewrites: ReadonlyMap<string, string>,
): AttributeRecord {
  const rewritten: Record<string, AttributeValue> = {};

  for (const [key, value] of Object.entries(attrs)) {
    rewritten[key] =
      typeof value === 'string' && idrefAttributes.has(key)
        ? rewriteIdrefValue(value, rewrites)
        : value;
  }

  return rewritten;
}

function rewriteIdrefValue(value: string, rewrites: ReadonlyMap<string, string>): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => rewrites.get(token) ?? token)
    .join(' ');
}

function stableKeys(primitive: AttributeRecord, author: AttributeRecord): readonly string[] {
  return [...new Set([...Object.keys(primitive), ...Object.keys(author)])];
}

function mergeRefs(
  authorValue: AttributeValue,
  primitiveValue: AttributeValue,
): string | undefined {
  return mergeTokenLists(authorValue, primitiveValue);
}

function mergeStyles(
  primitiveValue: AttributeValue,
  authorValue: AttributeValue,
): string | undefined {
  return (
    [primitiveValue, authorValue]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().replace(/;+$/, ''))
      .join('; ') || undefined
  );
}

function mergeTokenLists(first: AttributeValue, second: AttributeValue): string | undefined {
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const value of [first, second]) {
    if (typeof value !== 'string') continue;

    for (const token of value.trim().split(/\s+/)) {
      if (!token || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }

  return tokens.join(' ') || undefined;
}
