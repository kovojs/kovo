import { describe, expect, it } from 'vitest';

import { readGenerated } from './interactive-gallery-harness.js';

describe('compiled interactive gallery demos', () => {
  it('compiles stateful gallery demos into server TSX and client handler modules', () => {
    const accordion = readGenerated('accordion-demo.tsx');
    const accordionClient = readGenerated('accordion-demo.client.js');
    const alertDialog = readGenerated('alert-dialog-demo.tsx');
    const autocomplete = readGenerated('autocomplete-demo.tsx');
    const autocompleteClient = readGenerated('autocomplete-demo.client.js');
    const toggle = readGenerated('toggle-demo.tsx');
    const checkbox = readGenerated('checkbox-demo.tsx');
    const checkboxGroup = readGenerated('checkbox-group-demo.tsx');
    const collapsible = readGenerated('collapsible-demo.tsx');
    const combobox = readGenerated('combobox-demo.tsx');
    const comboboxClient = readGenerated('combobox-demo.client.js');
    const command = readGenerated('command-demo.tsx');
    const commandClient = readGenerated('command-demo.client.js');
    const contextMenu = readGenerated('context-menu-demo.tsx');
    const contextMenuClient = readGenerated('context-menu-demo.client.js');
    const disclosure = readGenerated('disclosure-demo.tsx');
    const dialog = readGenerated('dialog-demo.tsx');
    const drawer = readGenerated('drawer-demo.tsx');
    const dropdownMenu = readGenerated('dropdown-menu-demo.tsx');
    const dropdownMenuClient = readGenerated('dropdown-menu-demo.client.js');
    const field = readGenerated('field-demo.tsx');
    const fieldClient = readGenerated('field-demo.client.js');
    const hoverCard = readGenerated('hover-card-demo.tsx');
    const hoverCardClient = readGenerated('hover-card-demo.client.js');
    const menubar = readGenerated('menubar-demo.tsx');
    const meter = readGenerated('meter-demo.tsx');
    const navigationMenu = readGenerated('navigation-menu-demo.tsx');
    const navigationMenuClient = readGenerated('navigation-menu-demo.client.js');
    const numberField = readGenerated('number-field-demo.tsx');
    const numberFieldClient = readGenerated('number-field-demo.client.js');
    const otpField = readGenerated('otp-field-demo.tsx');
    const popover = readGenerated('popover-demo.tsx');
    const popoverClient = readGenerated('popover-demo.client.js');
    const progress = readGenerated('progress-demo.tsx');
    const radioGroup = readGenerated('radio-group-demo.tsx');
    const scrollArea = readGenerated('scroll-area-demo.tsx');
    const select = readGenerated('select-demo.tsx');
    const sheet = readGenerated('sheet-demo.tsx');
    const slider = readGenerated('slider-demo.tsx');
    const switchDemo = readGenerated('switch-demo.tsx');
    const tabs = readGenerated('tabs-demo.tsx');
    const toolbar = readGenerated('toolbar-demo.tsx');
    const tooltip = readGenerated('tooltip-demo.tsx');
    const tooltipClient = readGenerated('tooltip-demo.client.js');
    const toggleGroup = readGenerated('toggle-group-demo.tsx');
    const toggleGroupClient = readGenerated('toggle-group-demo.client.js');
    const toast = readGenerated('toast-demo.tsx');
    const toastClient = readGenerated('toast-demo.client.js');

    expect(accordion).toContain('data-gallery-interactive="accordion"');
    expect(accordion).toContain('fw-state=\'{"activeValue":"shipping","value":"shipping"}\'');
    expect(accordion).toContain('accordionTriggerAttributes({');
    expect(accordion).toContain('accordionKeyDown as _accordionKeyDown');
    expect(accordion).toContain('accordionTriggerClick as _accordionTriggerClick');
    expect(accordion).toContain('data-bind:aria-expanded=');
    expect(accordion).toContain('data-bind:tabIndex=');
    expect(accordion).toContain('data-bind:hidden=');
    expect(accordionClient).toContain('accordionKeyDown as _accordionKeyDown');
    expect(accordionClient).toContain('accordionTriggerClick as _accordionTriggerClick');
    expect(accordionClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(accordion).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/accordion-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAccordionDemo\$section_keydown"/,
    );
    expect(accordion).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/accordion-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAccordionDemo\$button_click"/,
    );
    expect(accordion).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/accordion-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAccordionDemo\$button_click_2"/,
    );

    expect(alertDialog).toContain('data-gallery-interactive="alert-dialog"');
    expect(alertDialog).toContain('fw-state=\'{"open":false}\'');
    expect(alertDialog).toContain('alertDialogTriggerAttributes({ contentId, open: state.open })');
    expect(alertDialog).toContain('alertDialogCancelAttributes({');
    expect(alertDialog).toContain("intent: 'destructive'");
    expect(alertDialog).toContain('alertDialogTriggerClick as _alertDialogTriggerClick');
    expect(alertDialog).toContain('alertDialogCancel as _alertDialogCancel');
    expect(alertDialog).toContain('alertDialogActionClick as _alertDialogActionClick');
    expect(alertDialog).toContain('data-bind:data-state=');
    expect(alertDialog).toContain('data-bind:open=');
    expect(alertDialog).not.toContain('closedby');
    expect(alertDialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$button_click"/,
    );
    expect(alertDialog).toMatch(
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$dialog_cancel"/,
    );
    expect(alertDialog).not.toContain('on:keydown=');
    expect(alertDialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$button_click_2"/,
    );
    expect(alertDialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$button_click_3"/,
    );

    expect(autocomplete).toContain('data-gallery-interactive="autocomplete"');
    expect(autocomplete).toContain(
      'fw-state=\'{"highlightedValue":"design","inputValue":"de","open":false,"value":"design"}\'',
    );
    expect(autocomplete).toContain('autocompleteInputAttributes({');
    expect(autocomplete).toContain(
      'id="gallery-autocomplete-form" data-gallery-form="autocomplete"',
    );
    expect(autocomplete).toContain("form: 'gallery-autocomplete-form'");
    expect(autocomplete).toContain('autocompleteListAttributes({');
    expect(autocomplete).toContain('autocompleteOptionAttributes({');
    expect(autocomplete).not.toContain('<datalist');
    expect(autocomplete).toContain('data-bind:aria-expanded=');
    expect(autocomplete).toContain('data-bind:aria-activedescendant=');
    expect(autocomplete).toContain('data-bind:hidden=');
    expect(autocomplete).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAutocompleteDemo\$input_input"/,
    );
    expect(autocomplete).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAutocompleteDemo\$input_keydown"/,
    );
    expect(autocomplete).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAutocompleteDemo\$button_click_2"/,
    );
    expect(autocompleteClient).toContain('autocompleteInput as _autocompleteInput');
    expect(autocompleteClient).toContain('autocompleteKeyDown as _autocompleteKeyDown');
    expect(autocompleteClient).toContain('autocompleteOptionClick as _autocompleteOptionClick');
    expect(autocompleteClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis|ctx\.params)\b/,
    );

    expect(toggle).toContain('data-gallery-interactive="toggle"');
    expect(toggle).toContain('fw-state=\'{"pressed":false}\'');
    expect(toggle).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toggle-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToggleDemo\$button_click"/,
    );

    expect(checkbox).toContain('data-gallery-interactive="checkbox"');
    expect(checkbox).toContain('fw-state=\'{"checked":"indeterminate"}\'');
    expect(checkbox).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxDemo\$input_click"/,
    );

    expect(checkboxGroup).toContain('data-gallery-interactive="checkbox-group"');
    expect(checkboxGroup).toContain('fw-state=\'{"activeValue":"updates","value":"updates"}\'');
    expect(checkboxGroup).toContain('id="gallery-checkbox-group-form"');
    expect(checkboxGroup).toContain("form: 'gallery-checkbox-group-form'");
    expect(checkboxGroup).toContain('checkboxGroupControlAttributes({');
    expect(checkboxGroup).toContain('id="gallery-checkbox-group-all"');
    expect(checkboxGroup).toContain('data-bind:indeterminate=');
    expect(checkboxGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxGroupDemo\$input_click_2"/,
    );
    expect(checkboxGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxGroupDemo\$input_click_3"/,
    );

    expect(combobox).toContain('data-gallery-interactive="combobox"');
    expect(combobox).toContain(
      'fw-state=\'{"highlightedValue":"austin","inputValue":"austin","open":false,"value":"austin"}\'',
    );
    expect(combobox).toContain('comboboxInputAttributes({');
    expect(combobox).toContain('id="gallery-combobox-form" data-gallery-form="combobox"');
    expect(combobox).toContain("form: 'gallery-combobox-form'");
    expect(combobox).toContain('comboboxListboxAttributes({');
    expect(combobox).toContain('data-bind:aria-expanded=');
    expect(combobox).toContain('data-bind:aria-activedescendant=');
    expect(combobox).toContain('data-bind:hidden=');
    expect(combobox).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryComboboxDemo\$input_input"/,
    );
    expect(combobox).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryComboboxDemo\$input_keydown"/,
    );
    expect(combobox).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryComboboxDemo\$button_click"/,
    );
    expect(comboboxClient).toContain('comboboxInput as _comboboxInput');
    expect(comboboxClient).toContain('comboboxKeyDown as _comboboxKeyDown');
    expect(comboboxClient).toContain('comboboxOptionClick as _comboboxOptionClick');
    expect(comboboxClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis|ctx\.params)\b/,
    );

    expect(command).toContain('data-gallery-interactive="command"');
    expect(command).toContain(
      'fw-state=\'{"highlightedValue":"dashboard","inputValue":"","lastKeyAction":"idle","open":false,"value":"dashboard"}\'',
    );
    expect(command).toContain(
      "{ id: 'gallery-command-listbox-item-1', label: 'Invite teammate', value: 'invite' }",
    );
    expect(command).toContain(
      '<form id="gallery-command-form" data-gallery-form="command"></form>',
    );
    expect(command).toContain("form: 'gallery-command-form'");
    expect(command).toContain("name: 'gallery-command-query'");
    expect(command).toContain('required: true');
    expect(command).toContain('commandDialogAttributes({');
    expect(command).toContain('data-bind:aria-expanded=');
    expect(command).toContain('data-bind:aria-activedescendant=');
    expect(command).toContain('data-bind:hidden=');
    expect(command).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCommandDemo\$input_input"/,
    );
    expect(command).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCommandDemo\$input_keydown"/,
    );
    expect(command).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCommandDemo\$button_click_3"/,
    );
    expect(commandClient).toContain('commandInput as _commandInput');
    expect(commandClient).toContain('commandKeyDown as _commandKeyDown');
    expect(commandClient).toContain('commandItemClick as _commandItemClick');
    expect(commandClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis|commandState)\b|ctx\.params/,
    );

    expect(contextMenu).toContain('data-gallery-interactive="context-menu"');
    expect(contextMenu).toContain(
      'fw-state=\'{"highlightedValue":"copy","open":false,"point":{"x":24,"y":40},"value":"copy"}\'',
    );
    expect(contextMenu).toContain('contextMenuTriggerAttributes({');
    expect(contextMenu).toContain('contextMenuFocusElement as _contextMenuFocusElement');
    expect(contextMenu).toContain('contextMenuItemClick as _contextMenuItemClick');
    expect(contextMenu).toContain('contextMenuItemKeyDown as _contextMenuItemKeyDown');
    expect(contextMenu).toContain('contextMenuMove as _contextMenuMove');
    expect(contextMenu).toContain('contextMenuTriggerContextMenu as _contextMenuTriggerContextMenu');
    expect(contextMenu).toContain('contextMenuTriggerKeyDown as _contextMenuTriggerKeyDown');
    expect(contextMenu).toContain('contextMenuTypeahead as _contextMenuTypeahead');
    expect(contextMenu).toContain('data-bind:aria-expanded=');
    expect(contextMenu).toContain('data-bind:data-anchor-x=');
    expect(contextMenu).toContain('data-bind:data-anchor-y=');
    expect(contextMenu).toContain('data-bind:data-highlighted=');
    expect(contextMenu).toContain('data-bind:hidden=');
    expect(contextMenu).toContain('data-bind:tabIndex=');
    expect(contextMenuClient).toContain('contextMenuFocusElement as _contextMenuFocusElement');
    expect(contextMenuClient).toContain('contextMenuItemKeyDown as _contextMenuItemKeyDown');
    expect(contextMenuClient).toContain(
      'contextMenuTriggerContextMenu as _contextMenuTriggerContextMenu',
    );
    expect(contextMenuClient).toContain('contextMenuTypeahead as _contextMenuTypeahead');
    expect(contextMenuClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(contextMenu).toMatch(
      /on:contextmenu="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$div_contextmenu"/,
    );
    expect(contextMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$button_click"/,
    );
    expect(contextMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$button_keydown"/,
    );
    expect(contextMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$button_keydown_2"/,
    );
    expect(contextMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$button_click_2"/,
    );

    expect(disclosure).toContain('data-gallery-interactive="disclosure"');
    expect(disclosure).toContain('fw-state=\'{"open":false}\'');
    expect(disclosure).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/disclosure-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDisclosureDemo\$button_click"/,
    );

    expect(dialog).toContain('data-gallery-interactive="dialog"');
    expect(dialog).toContain('fw-state=\'{"open":false}\'');
    expect(dialog).toContain('dialogTriggerAttributes({ contentId, open: state.open })');
    expect(dialog).toContain('dialogCloseAttributes({ contentId, open: state.open })');
    expect(dialog).toContain('dialogTriggerClick as _dialogTriggerClick');
    expect(dialog).toContain('dialogCloseClick as _dialogCloseClick');
    expect(dialog).toContain('data-bind:aria-expanded=');
    expect(dialog).toContain('data-bind:data-state=');
    expect(dialog).toContain('data-bind:open=');
    expect(dialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$button_click"/,
    );
    expect(dialog).toMatch(
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$dialog_cancel"/,
    );
    expect(dialog).not.toContain('on:keydown=');
    expect(dialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$button_click_2"/,
    );

    expect(drawer).toContain('data-gallery-interactive="drawer"');
    expect(drawer).toContain('data-side="bottom"');
    expect(drawer).toContain('fw-state=\'{"open":false}\'');
    expect(drawer).toContain('dialogTriggerAttributes({ contentId, open: state.open })');
    expect(drawer).toContain('dialogCloseAttributes({ contentId, open: state.open })');
    expect(drawer).toContain('dialogTriggerClick as _dialogTriggerClick');
    expect(drawer).toContain('data-bind:aria-expanded=');
    expect(drawer).toContain('data-bind:data-state=');
    expect(drawer).toContain('data-bind:open=');
    expect(drawer).toContain('Vaul drag, snap, and background-scale gestures are not');
    expect(drawer).toContain('modeled.');
    expect(drawer).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/drawer-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDrawerDemo\$button_click"/,
    );
    expect(drawer).toMatch(
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/drawer-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDrawerDemo\$dialog_cancel"/,
    );
    expect(drawer).not.toContain('on:keydown=');
    expect(drawer).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/drawer-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDrawerDemo\$button_click_2"/,
    );

    expect(dropdownMenu).toContain('data-gallery-interactive="dropdown-menu"');
    expect(dropdownMenu).toContain(
      'fw-state=\'{"highlightedValue":"duplicate","open":false,"value":"duplicate"}\'',
    );
    expect(dropdownMenu).toContain('dropdownMenuContentAttributes({');
    expect(dropdownMenu).toContain('dropdownMenuFocusElement as _dropdownMenuFocusElement');
    expect(dropdownMenu).toContain('dropdownMenuItemClick as _dropdownMenuItemClick');
    expect(dropdownMenu).toContain('dropdownMenuItemKeyDown as _dropdownMenuItemKeyDown');
    expect(dropdownMenu).toContain('dropdownMenuMove as _dropdownMenuMove');
    expect(dropdownMenu).toContain('dropdownMenuTriggerClick as _dropdownMenuTriggerClick');
    expect(dropdownMenu).toContain('dropdownMenuTriggerKeyDown as _dropdownMenuTriggerKeyDown');
    expect(dropdownMenu).toContain('dropdownMenuTypeahead as _dropdownMenuTypeahead');
    expect(dropdownMenu).toContain('data-bind:aria-expanded=');
    expect(dropdownMenu).toContain('data-bind:data-state=');
    expect(dropdownMenu).toContain('data-bind:data-highlighted=');
    expect(dropdownMenu).toContain('data-bind:hidden=');
    expect(dropdownMenu).toContain('data-bind:tabIndex=');
    expect(dropdownMenuClient).toContain('dropdownMenuFocusElement as _dropdownMenuFocusElement');
    expect(dropdownMenuClient).toContain('dropdownMenuItemKeyDown as _dropdownMenuItemKeyDown');
    expect(dropdownMenuClient).toContain(
      'dropdownMenuTriggerKeyDown as _dropdownMenuTriggerKeyDown',
    );
    expect(dropdownMenuClient).toContain('dropdownMenuTypeahead as _dropdownMenuTypeahead');
    expect(dropdownMenuClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(dropdownMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_click"/,
    );
    expect(dropdownMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_keydown"/,
    );
    expect(dropdownMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_keydown_2"/,
    );
    expect(dropdownMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_click_2"/,
    );
    expect(dropdownMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_keydown_3"/,
    );
    expect(dropdownMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_click_3"/,
    );

    expect(field).toContain('data-gallery-interactive="field"');
    expect(field).toContain(
      'fw-state=\'{"email":"ada@example","invalid":true,"plan":"team","shippingDisabled":false}\'',
    );
    expect(field).toContain('fieldControlAttributes({');
    expect(field).toContain('fieldsetRootAttributes({');
    expect(field).toContain("name: 'gallery-shipping'");
    expect(field).toContain('name="gallery-seat"');
    expect(field).toContain('data-bind:aria-describedby=');
    expect(field).toContain('data-bind:aria-invalid=');
    expect(field).toContain('data-bind:data-invalid=');
    expect(field).toContain('data-bind:hidden=');
    expect(field).toContain('data-bind:value=');
    expect(field).toContain('data-bind:disabled=');
    expect(field).toContain('data-bind:checked=');
    expect(fieldClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(field).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryFieldDemo\$input_input"/,
    );
    expect(field).toMatch(
      /on:change="\/c\/examples\/gallery\/src\/generated\/interactive\/field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryFieldDemo\$select_change"/,
    );
    expect(field).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryFieldDemo\$input_click"/,
    );

    expect(hoverCard).toContain('data-gallery-interactive="hover-card"');
    expect(hoverCard).toContain('fw-state=\'{"open":false}\'');
    expect(hoverCard).toContain('hoverCardTriggerAttributes({ contentId, open: state.open })');
    expect(hoverCard).toContain('hoverCardContentPointerEnter as _hoverCardContentPointerEnter');
    expect(hoverCard).toContain('data-bind:data-state=');
    expect(hoverCard).toContain('data-bind:hidden=');
    expect(hoverCard).not.toContain('aria-controls');
    expect(hoverCard).not.toContain('aria-expanded');
    expect(hoverCardClient).toContain('hoverCardTriggerPointerEnter as _hoverCardTriggerPointerEnter');
    expect(hoverCardClient).toContain('hoverCardContentPointerEnter as _hoverCardContentPointerEnter');
    expect(hoverCardClient).toContain('setTimeout');
    expect(hoverCardClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(hoverCard).toMatch(
      /on:focus="\/c\/examples\/gallery\/src\/generated\/interactive\/hover-card-demo\.client\.js\?v=[0-9a-f]{8}#GalleryHoverCardDemo\$a_focus"/,
    );
    expect(hoverCard).toMatch(
      /on:pointerenter="\/c\/examples\/gallery\/src\/generated\/interactive\/hover-card-demo\.client\.js\?v=[0-9a-f]{8}#GalleryHoverCardDemo\$a_pointerenter"/,
    );
    expect(hoverCard).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/hover-card-demo\.client\.js\?v=[0-9a-f]{8}#GalleryHoverCardDemo\$a_keydown"/,
    );

    expect(menubar).toContain('data-gallery-interactive="menubar"');
    expect(menubar).toContain('fw-state=\'{"activeValue":"file","openValue":"","value":"new"}\'');
    expect(menubar).toContain('menubarSubmenuAttributes({');
    expect(menubar).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryMenubarDemo\$section_keydown"/,
    );
    expect(menubar).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryMenubarDemo\$button_click"/,
    );
    expect(menubar).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryMenubarDemo\$button_keydown"/,
    );

    expect(meter).toContain('data-gallery-interactive="meter"');
    expect(meter).toContain('fw-state=\'{"dataState":"suboptimum","value":72}\'');
    expect(meter).toContain('meterRootAttributes(meterState)');
    expect(meter).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/meter-demo\.client\.js\?v=[0-9a-f]{8}#GalleryMeterDemo\$button_click"/,
    );

    expect(navigationMenu).toContain('data-gallery-interactive="navigation-menu"');
    expect(navigationMenu).toContain(
      'fw-state=\'{"activeValue":"products","openValue":"","value":"none"}\'',
    );
    expect(navigationMenuClient).toContain("key === 'Escape'");
    expect(navigationMenu).toContain('navigationMenuTriggerAttributes({');
    expect(navigationMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNavigationMenuDemo\$section_keydown"/,
    );
    expect(navigationMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNavigationMenuDemo\$a_click"/,
    );

    expect(numberField).toContain('data-gallery-interactive="number-field"');
    expect(numberField).toContain('fw-state=\'{"value":2}\'');
    expect(numberField).toContain('numberFieldInput as _numberFieldInput');
    expect(numberField).toContain('numberFieldKeyDown as _numberFieldKeyDown');
    expect(numberField).toContain('data-bind:value=');
    expect(numberField).toContain('data-bind:disabled=');
    expect(numberField).toContain('data-bind:data-disabled=');
    expect(numberFieldClient).toContain('numberFieldInput as _numberFieldInput');
    expect(numberFieldClient).toContain('numberFieldKeyDown as _numberFieldKeyDown');
    expect(numberFieldClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(numberField).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNumberFieldDemo\$input_input"/,
    );
    expect(numberField).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNumberFieldDemo\$input_keydown"/,
    );
    expect(numberField).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNumberFieldDemo\$button_click"/,
    );
    expect(numberField).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNumberFieldDemo\$button_click_2"/,
    );

    expect(otpField).toContain('data-gallery-interactive="otp-field"');
    expect(otpField).toContain('fw-state=\'{"activeSlot":2,"value":"12"}\'');
    expect(otpField).toContain("const formId = 'gallery-otp-form'");
    expect(otpField).toContain('<form id={formId} data-gallery-form="otp-field" />');
    expect(otpField).toContain('otpFieldHiddenInputAttributes({');
    expect(otpField).toContain('form: formId');
    expect(otpField).toContain('otpFieldInput as _otpFieldInput');
    expect(otpField).toContain('data-bind:value=');
    expect(otpField).toContain('data-bind:data-filled=');
    expect(otpField).toContain('data-bind:tabIndex=');
    expect(otpField).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/otp-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryOtpFieldDemo\$input_input"/,
    );
    expect(otpField).toMatch(
      /on:paste="\/c\/examples\/gallery\/src\/generated\/interactive\/otp-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryOtpFieldDemo\$input_paste_4"/,
    );

    expect(collapsible).toContain('data-gallery-interactive="collapsible"');
    expect(collapsible).toContain('fw-state=\'{"open":false}\'');
    expect(collapsible).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/collapsible-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCollapsibleDemo\$summary_click"/,
    );

    expect(popover).toContain('data-gallery-interactive="popover"');
    expect(popover).toContain('fw-state=\'{"open":false}\'');
    expect(popover).toContain('data-demo-state="popover-open"');
    expect(popover).toContain('popoverBeforeToggle as _popoverBeforeToggle');
    expect(popover).toContain('data-bind:aria-expanded=');
    expect(popover).toContain('data-bind:data-state=');
    expect(popover).toMatch(
      /on:beforetoggle="\/c\/examples\/gallery\/src\/generated\/interactive\/popover-demo\.client\.js\?v=[0-9a-f]{8}#GalleryPopoverDemo\$div_beforetoggle"/,
    );
    expect(popover).not.toContain('on:click=');
    expect(popover).not.toContain('on:keydown=');
    expect(popoverClient).toContain('popoverBeforeToggle as _popoverBeforeToggle');
    expect(popoverClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );

    expect(progress).toContain('data-gallery-interactive="progress"');
    expect(progress).toContain('fw-state=\'{"value":40}\'');
    expect(progress).toContain(
      'progressRootAttributes({ max: 100, value: state.value, valueText })',
    );
    expect(progress).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/progress-demo\.client\.js\?v=[0-9a-f]{8}#GalleryProgressDemo\$button_click"/,
    );
    expect(progress).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/progress-demo\.client\.js\?v=[0-9a-f]{8}#GalleryProgressDemo\$button_click_2"/,
    );

    expect(radioGroup).toContain('data-gallery-interactive="radio-group"');
    expect(radioGroup).toContain('id="gallery-radio-form" data-gallery-form="radio-group"');
    expect(radioGroup).toContain("form: 'gallery-radio-form'");
    expect(radioGroup).toContain('fw-state=\'{"value":"email"}\'');
    expect(radioGroup).toContain('radioGroupRadioAttributes({');
    expect(radioGroup).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/radio-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryRadioGroupDemo\$div_keydown"/,
    );
    expect(radioGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/radio-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryRadioGroupDemo\$input_click_2"/,
    );

    expect(scrollArea).toContain('data-gallery-interactive="scroll-area"');
    expect(scrollArea).toContain(
      'fw-state=\'{"dragging":false,"dragPointerStart":0,"dragScrollTop":0,"dragThumbSize":28,"dragTrackSize":72,"hasOverflowY":true,"hovering":false,"scrolling":false,"scrollTop":0,"scrollY":"start","thumbOffset":0,"thumbSize":28,"verticalVisible":true}\'',
    );
    expect(scrollArea).toContain('scrollAreaViewportAttributes({');
    expect(scrollArea).toContain('scrollAreaThumbAttributes({');
    expect(scrollArea).toContain('scrollAreaViewportScroll as _scrollAreaViewportScroll');
    expect(scrollArea).toContain('scrollAreaThumbDrag as _scrollAreaThumbDrag');
    expect(scrollArea).toContain('scrollAreaTrackPointerDown as _scrollAreaTrackPointerDown');
    expect(scrollArea).toContain('data-bind:data-has-overflow-y=');
    expect(scrollArea).toContain('data-bind:data-scrolling=');
    expect(scrollArea).toContain('data-bind:scrollTop=');
    expect(scrollArea).toContain('data-bind:style=');
    expect(scrollArea).toMatch(
      /on:scroll="\/c\/examples\/gallery\/src\/generated\/interactive\/scroll-area-demo\.client\.js\?v=[0-9a-f]{8}#GalleryScrollAreaDemo\$div_scroll"/,
    );
    expect(scrollArea).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/scroll-area-demo\.client\.js\?v=[0-9a-f]{8}#GalleryScrollAreaDemo\$button_click"/,
    );
    expect(scrollArea).toMatch(
      /on:pointerdown="\/c\/examples\/gallery\/src\/generated\/interactive\/scroll-area-demo\.client\.js\?v=[0-9a-f]{8}#GalleryScrollAreaDemo\$span_pointerdown"/,
    );

    expect(select).toContain('data-gallery-interactive="select"');
    expect(select).toContain('id="gallery-select-form" data-gallery-form="select"');
    expect(select).toContain("form: 'gallery-select-form'");
    expect(select).toContain(
      'fw-state=\'{"highlightedValue":"standard","open":false,"value":"standard"}\'',
    );
    expect(select).toContain('selectHiddenInputAttributes(selectState)');
    expect(select).toContain('selectTriggerAttributes({');
    expect(select).toContain('selectItemAttributes({');
    expect(select).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/select-demo\.client\.js\?v=[0-9a-f]{8}#GallerySelectDemo\$button_click"/,
    );
    expect(select).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/select-demo\.client\.js\?v=[0-9a-f]{8}#GallerySelectDemo\$button_keydown"/,
    );
    expect(select).toContain('selectContentAttributes({');
    expect(select).toContain('selectItemClick as _selectItemClick');
    expect(select).toContain('data-bind:aria-selected=');

    expect(sheet).toContain('data-gallery-interactive="sheet"');
    expect(sheet).toContain('data-side="right"');
    expect(sheet).toContain('fw-state=\'{"open":false}\'');
    expect(sheet).toContain('dialogTriggerAttributes({ contentId, open: state.open })');
    expect(sheet).toContain('dialogCloseAttributes({ contentId, open: state.open })');
    expect(sheet).toContain('dialogTriggerClick as _dialogTriggerClick');
    expect(sheet).toContain('data-bind:aria-expanded=');
    expect(sheet).toContain('data-bind:data-state=');
    expect(sheet).toContain('data-bind:open=');
    expect(sheet).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/sheet-demo\.client\.js\?v=[0-9a-f]{8}#GallerySheetDemo\$button_click"/,
    );
    expect(sheet).toMatch(
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/sheet-demo\.client\.js\?v=[0-9a-f]{8}#GallerySheetDemo\$dialog_cancel"/,
    );
    expect(sheet).not.toContain('on:keydown=');
    expect(sheet).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/sheet-demo\.client\.js\?v=[0-9a-f]{8}#GallerySheetDemo\$button_click_2"/,
    );

    expect(slider).toContain('data-gallery-interactive="slider"');
    expect(slider).toContain('id="gallery-slider-form" data-gallery-form="slider"');
    expect(slider).toContain("form: 'gallery-slider-form'");
    expect(slider).toContain(
      'fw-state=\'{"dragging":false,"dragPointerStart":0,"dragValueStart":25,"value":25}\'',
    );
    expect(slider).toContain('sliderHiddenInputAttributes(sliderState)');
    expect(slider).toContain('sliderThumbAttributes(sliderState)');
    expect(slider).toContain('data-bind:aria-valuenow=');
    expect(slider).toMatch(
      /on:pointerdown="\/c\/examples\/gallery\/src\/generated\/interactive\/slider-demo\.client\.js\?v=[0-9a-f]{8}#GallerySliderDemo\$div_pointerdown"/,
    );
    expect(slider).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/slider-demo\.client\.js\?v=[0-9a-f]{8}#GallerySliderDemo\$span_keydown"/,
    );
    expect(slider).toMatch(
      /on:pointermove="\/c\/examples\/gallery\/src\/generated\/interactive\/slider-demo\.client\.js\?v=[0-9a-f]{8}#GallerySliderDemo\$span_pointermove"/,
    );

    expect(switchDemo).toContain('data-gallery-interactive="switch"');
    expect(switchDemo).toContain('form="gallery-switch-form"');
    expect(switchDemo).toContain('fw-state=\'{"checked":false}\'');
    expect(switchDemo).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/switch-demo\.client\.js\?v=[0-9a-f]{8}#GallerySwitchDemo\$input_click"/,
    );

    expect(tabs).toContain('data-gallery-interactive="tabs"');
    expect(tabs).toContain('fw-state=\'{"activeValue":"overview","value":"overview"}\'');
    expect(tabs).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/tabs-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTabsDemo\$section_keydown"/,
    );
    expect(tabs).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/tabs-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTabsDemo\$button_click_2"/,
    );

    expect(toolbar).toContain('data-gallery-interactive="toolbar"');
    expect(toolbar).toContain('fw-state=\'{"activeValue":"bold","pressedValue":"bold"}\'');
    expect(toolbar).toContain('toolbarButtonAttributes({');
    expect(toolbar).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/toolbar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToolbarDemo\$div_keydown"/,
    );
    expect(toolbar).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toolbar-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToolbarDemo\$button_click_2"/,
    );
    expect(toolbar).toContain('data-bind:aria-pressed=');
    expect(toolbar).toContain('data-bind:data-pressed=');
    expect(toolbar).toContain('data-bind:tabIndex=');
    expect(toolbar).toContain('data-bind="state.activeValue"');
    const toolbarClient = readGenerated('toolbar-demo.client.js');
    expect(toolbarClient).toContain('toolbarKeyDown as _toolbarKeyDown');
    expect(toolbarClient).not.toMatch(/Reflect|getElementById|setAttribute|document|globalThis/);

    expect(tooltip).toContain('data-gallery-interactive="tooltip"');
    expect(tooltip).toContain('fw-state=\'{"open":false}\'');
    expect(tooltip).toContain('tooltipTriggerAttributes({ contentId, open: state.open })');
    expect(tooltip).toContain('tooltipTriggerPointerEnter as _tooltipTriggerPointerEnter');
    expect(tooltip).toContain('data-bind:aria-describedby=');
    expect(tooltip).toContain('data-bind:data-state=');
    expect(tooltip).toContain('data-bind:hidden=');
    expect(tooltip).not.toContain('popover=');
    expect(tooltipClient).toContain('tooltipTriggerPointerEnter as _tooltipTriggerPointerEnter');
    expect(tooltipClient).toContain('tooltipEscapeKeyDown as _tooltipEscapeKeyDown');
    expect(tooltipClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(tooltip).toMatch(
      /on:focus="\/c\/examples\/gallery\/src\/generated\/interactive\/tooltip-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTooltipDemo\$button_focus"/,
    );
    expect(tooltip).toMatch(
      /on:pointerenter="\/c\/examples\/gallery\/src\/generated\/interactive\/tooltip-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTooltipDemo\$button_pointerenter"/,
    );
    expect(tooltip).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/tooltip-demo\.client\.js\?v=[0-9a-f]{8}#GalleryTooltipDemo\$button_keydown"/,
    );

    expect(toggleGroup).toContain('data-gallery-interactive="toggle-group"');
    expect(toggleGroup).toContain('fw-state=\'{"activeValue":"bold","value":"bold"}\'');
    expect(toggleGroup).toContain('toggleGroupButtonAttributes({');
    expect(toggleGroup).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/toggle-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToggleGroupDemo\$section_keydown"/,
    );
    expect(toggleGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toggle-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToggleGroupDemo\$button_click_2"/,
    );
    expect(toggleGroup).toContain('data-bind:aria-pressed=');
    expect(toggleGroup).toContain('data-bind:data-state=');
    expect(toggleGroup).toContain('data-bind:tabIndex=');
    expect(toggleGroupClient).toContain('toggleGroupKeyDown as _toggleGroupKeyDown');
    expect(toggleGroupClient).toContain('toggleGroupItemClick as _toggleGroupItemClick');
    expect(toggleGroupClient).not.toMatch(/Reflect|getElementById|setAttribute|document|globalThis/);

    expect(toast).toContain('data-gallery-interactive="toast"');
    expect(toast).toContain(
      'fw-state=\'{"activeCount":0,"activeOpen":false,"previousCount":0,"previousOpen":false}\'',
    );
    expect(toast).toContain('toastRootAttributes(activeToastState)');
    expect(toast).toContain('toastRootAttributes(previousToastState)');
    expect(toast).toContain('data-toast-show=""');
    expect(toast).toContain('data-toast-duration-ms={durationMs}');
    expect(toast).toContain('normalizeToastDuration(5000)');
    expect(toast).toContain('toastAnimationEnd as _toastAnimationEnd');
    expect(toast).toContain('toastViewportKeyDown as _toastViewportKeyDown');
    expect(toast).toContain('data-bind:hidden=');
    expect(toast).toContain('data-bind:data-state=');
    expect(toast).toContain('data-demo-state="toast-count"');
    expect(toast).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToastDemo\$section_keydown"/,
    );
    expect(toast).toMatch(
      /on:animationend="\/c\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToastDemo\$div_animationend"/,
    );
    expect(toast).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToastDemo\$button_click"/,
    );
    expect(toast).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToastDemo\$button_click_3"/,
    );
    expect(toast).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToastDemo\$button_click_4"/,
    );
    expect(toast).toContain('data-toast-cancel-dismiss=""');
    expect(toast).toContain('data-toast-disabled-action=""');
    expect(toast).toContain('dismissOnAction: false');
    expect(toastClient).toContain('toastAnimationEnd as _toastAnimationEnd');
    expect(toastClient).toContain('toastViewportKeyDown as _toastViewportKeyDown');
    expect(toastClient).not.toMatch(/Reflect|getElementById|setAttribute|document|globalThis/);
  });
});
