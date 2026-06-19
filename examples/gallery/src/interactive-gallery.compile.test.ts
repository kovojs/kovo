import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { galleryRoot, readCompiledDemo, readGenerated } from './interactive-gallery-harness.js';

describe('compiled interactive gallery demos', () => {
  it('keeps app-authored interactive demos on the styled UI surface', () => {
    // rules/api-surface.md forbids `@kovojs/ui` re-exporting its `@kovojs/headless-ui`
    // dependency (no `export *` on a public barrel), so the styled component surface now
    // comes from `@kovojs/ui/<primitive>` while behavior handlers/state come from
    // `@kovojs/headless-ui/<primitive>`. The invariant is that every interactive demo still
    // renders styled `@kovojs/ui` components rather than dropping to raw markup.
    const interactiveRoot = resolve(galleryRoot, 'src/interactive');
    const sources: Array<[string, string]> = readdirSync(interactiveRoot)
      .filter((fileName) => fileName.endsWith('.tsx'))
      .map((fileName) => [fileName, readFileSync(resolve(interactiveRoot, fileName), 'utf8')]);

    for (const [fileName, source] of sources) {
      expect(source, `${fileName} imports styled @kovojs/ui values`).toMatch(
        /from '@kovojs\/ui\/[a-z-]+';/,
      );
    }
  });

  it('compiles stateful gallery demos into server TSX and client handler modules', () => {
    const accordion = readCompiledDemo('accordion-demo.tsx');
    const accordionClient = readGenerated('accordion-demo.client.js');
    const alertDialog = readCompiledDemo('alert-dialog-demo.tsx');
    const autocomplete = readCompiledDemo('autocomplete-demo.tsx');
    const autocompleteClient = readGenerated('autocomplete-demo.client.js');
    const toggle = readCompiledDemo('toggle-demo.tsx');
    const checkbox = readCompiledDemo('checkbox-demo.tsx');
    const checkboxGroup = readCompiledDemo('checkbox-group-demo.tsx');
    const collapsible = readCompiledDemo('collapsible-demo.tsx');
    const combobox = readCompiledDemo('combobox-demo.tsx');
    const comboboxClient = readGenerated('combobox-demo.client.js');
    const command = readCompiledDemo('command-demo.tsx');
    const commandClient = readGenerated('command-demo.client.js');
    const contextMenu = readCompiledDemo('context-menu-demo.tsx');
    const contextMenuClient = readGenerated('context-menu-demo.client.js');
    const disclosure = readCompiledDemo('disclosure-demo.tsx');
    const dialog = readCompiledDemo('dialog-demo.tsx');
    const drawer = readCompiledDemo('drawer-demo.tsx');
    const dropdownMenu = readCompiledDemo('dropdown-menu-demo.tsx');
    const dropdownMenuClient = readGenerated('dropdown-menu-demo.client.js');
    const field = readCompiledDemo('field-demo.tsx');
    const fieldClient = readGenerated('field-demo.client.js');
    const hoverCard = readCompiledDemo('hover-card-demo.tsx');
    const hoverCardClient = readGenerated('hover-card-demo.client.js');
    const menubar = readCompiledDemo('menubar-demo.tsx');
    const menubarClient = readGenerated('menubar-demo.client.js');
    const meter = readCompiledDemo('meter-demo.tsx');
    const navigationMenu = readCompiledDemo('navigation-menu-demo.tsx');
    const navigationMenuClient = readGenerated('navigation-menu-demo.client.js');
    const numberField = readCompiledDemo('number-field-demo.tsx');
    const numberFieldClient = readGenerated('number-field-demo.client.js');
    const otpField = readCompiledDemo('otp-field-demo.tsx');
    const popover = readCompiledDemo('popover-demo.tsx');
    const popoverClient = readGenerated('popover-demo.client.js');
    const progress = readCompiledDemo('progress-demo.tsx');
    const pureMarkup = readCompiledDemo('pure-markup-demo.tsx');
    const radioGroup = readCompiledDemo('radio-group-demo.tsx');
    const scrollArea = readCompiledDemo('scroll-area-demo.tsx');
    const select = readCompiledDemo('select-demo.tsx');
    const sheet = readCompiledDemo('sheet-demo.tsx');
    const slider = readCompiledDemo('slider-demo.tsx');
    const switchDemo = readCompiledDemo('switch-demo.tsx');
    const tabs = readCompiledDemo('tabs-demo.tsx');
    const toolbar = readCompiledDemo('toolbar-demo.tsx');
    const tooltip = readCompiledDemo('tooltip-demo.tsx');
    const tooltipClient = readGenerated('tooltip-demo.client.js');
    const toggleGroup = readCompiledDemo('toggle-group-demo.tsx');
    const toggleGroupClient = readGenerated('toggle-group-demo.client.js');
    const toast = readCompiledDemo('toast-demo.tsx');
    const toastClient = readGenerated('toast-demo.client.js');

    expect(accordion).toContain('data-gallery-interactive="accordion"');
    expect(accordion).toContain('kovo-state=\'{"activeValue":"shipping","value":"shipping"}\'');
    expect(accordion).toContain('<AccordionTrigger');
    expect(accordion).toContain('accordionKeyDown as _accordionKeyDown');
    expect(accordion).toContain('accordionTriggerClick as _accordionTriggerClick');
    expect(accordion).toContain('data-bind:value=');
    expect(accordion).toContain('data-bind:tabIndex=');
    expect(accordion).toContain('<AccordionContent');
    expect(accordionClient).toContain('accordionKeyDown as _accordionKeyDown');
    expect(accordionClient).toContain('accordionTriggerClick as _accordionTriggerClick');
    expect(accordionClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(accordion).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/accordion-demo\.client\.js#GalleryAccordionDemo\$[A-Za-z]+_keydown"/,
    );
    expect(accordion).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/accordion-demo\.client\.js#GalleryAccordionDemo\$[A-Za-z]+_click"/,
    );
    expect(accordion).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/accordion-demo\.client\.js#GalleryAccordionDemo\$[A-Za-z]+_click_2"/,
    );

    expect(alertDialog).toContain('data-gallery-interactive="alert-dialog"');
    expect(alertDialog).toContain('kovo-state=\'{"open":false}\'');
    expect(alertDialog).toContain('<AlertDialogTrigger');
    expect(alertDialog).toContain('<AlertDialogCancel');
    expect(alertDialog).toContain('intent="destructive"');
    expect(alertDialog).toContain('alertDialogTriggerClick as _alertDialogTriggerClick');
    expect(alertDialog).toContain('alertDialogCancel as _alertDialogCancel');
    expect(alertDialog).toContain('alertDialogActionClick as _alertDialogActionClick');
    expect(alertDialog).toContain('data-bind:data-state=');
    expect(alertDialog).toContain('data-bind:open=');
    expect(alertDialog).not.toContain('closedby');
    expect(alertDialog).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js#GalleryAlertDialogDemo\$[A-Za-z]+_click"/,
    );
    expect(alertDialog).toMatch(
      /on:cancel="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js#GalleryAlertDialogDemo\$[A-Za-z]+_cancel"/,
    );
    expect(alertDialog).not.toContain('on:keydown=');
    expect(alertDialog).toContain('GalleryAlertDialogDemo$AlertDialogCancel_click');
    expect(alertDialog).toContain('GalleryAlertDialogDemo$AlertDialogAction_click');

    expect(autocomplete).toContain('data-gallery-interactive="autocomplete"');
    expect(autocomplete).toContain(
      'kovo-state=\'{"highlightedValue":"design","inputValue":"de","open":false,"value":"design"}\'',
    );
    expect(autocomplete).toContain('<AutocompleteInput');
    expect(autocomplete).toContain(
      'id="gallery-autocomplete-form" data-gallery-form="autocomplete"',
    );
    expect(autocomplete).toContain("form: 'gallery-autocomplete-form'");
    expect(autocomplete).toContain('<AutocompleteList');
    expect(autocomplete).toContain('<AutocompleteOption');
    expect(autocomplete).not.toContain('<datalist');
    expect(autocomplete).toContain('data-bind:aria-expanded=');
    expect(autocomplete).toContain('data-bind:aria-activedescendant=');
    expect(autocomplete).toContain('data-bind:hidden=');
    expect(autocomplete).toMatch(
      /on:input="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js#GalleryAutocompleteDemo\$[A-Za-z]+_input"/,
    );
    expect(autocomplete).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js#GalleryAutocompleteDemo\$[A-Za-z]+_keydown"/,
    );
    expect(autocomplete).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js#GalleryAutocompleteDemo\$[A-Za-z]+_click_2"/,
    );
    expect(autocompleteClient).toContain('autocompleteInput as _autocompleteInput');
    expect(autocompleteClient).toContain('autocompleteKeyDown as _autocompleteKeyDown');
    expect(autocompleteClient).toContain('autocompleteOptionClick as _autocompleteOptionClick');
    expect(autocompleteClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis|ctx\.params)\b/,
    );

    expect(toggle).toContain('data-gallery-interactive="toggle"');
    expect(toggle).toContain('kovo-state=\'{"pressed":false}\'');
    expect(toggle).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/toggle-demo\.client\.js#GalleryToggleDemo\$[A-Za-z]+_click"/,
    );

    expect(checkbox).toContain('data-gallery-interactive="checkbox"');
    expect(checkbox).toContain('kovo-state=\'{"checked":"indeterminate"}\'');
    expect(checkbox).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/checkbox-demo\.client\.js#GalleryCheckboxDemo\$[A-Za-z]+_click"/,
    );

    expect(checkboxGroup).toContain('data-gallery-interactive="checkbox-group"');
    expect(checkboxGroup).toContain('kovo-state=\'{"activeValue":"updates","value":"updates"}\'');
    expect(checkboxGroup).toContain('id="gallery-checkbox-group-form"');
    expect(checkboxGroup).toContain("form: 'gallery-checkbox-group-form'");
    expect(checkboxGroup).toContain('<CheckboxGroupControl');
    expect(checkboxGroup).toContain('id="gallery-checkbox-group-all"');
    expect(checkboxGroup).toContain('data-bind:indeterminate=');
    expect(checkboxGroup).toContain('GalleryCheckboxGroupDemo$input_click');
    expect(checkboxGroup).toContain('GalleryCheckboxGroupDemo$CheckboxGroupControl_click');
    expect(checkboxGroup).toContain('GalleryCheckboxGroupDemo$CheckboxGroupControl_click_2');

    expect(combobox).toContain('data-gallery-interactive="combobox"');
    expect(combobox).toContain(
      'kovo-state=\'{"highlightedValue":"austin","inputValue":"austin","open":false,"value":"austin"}\'',
    );
    expect(combobox).toContain('<ComboboxInput');
    expect(combobox).toContain('id="gallery-combobox-form" data-gallery-form="combobox"');
    expect(combobox).toContain("form: 'gallery-combobox-form'");
    expect(combobox).toContain('<ComboboxListbox');
    expect(combobox).toContain('data-bind:aria-expanded=');
    expect(combobox).toContain('data-bind:aria-activedescendant=');
    expect(combobox).toContain('data-bind:hidden=');
    expect(combobox).toMatch(
      /on:input="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js#GalleryComboboxDemo\$[A-Za-z]+_input"/,
    );
    expect(combobox).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js#GalleryComboboxDemo\$[A-Za-z]+_keydown"/,
    );
    expect(combobox).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js#GalleryComboboxDemo\$[A-Za-z]+_click"/,
    );
    expect(comboboxClient).toContain('comboboxInput as _comboboxInput');
    expect(comboboxClient).toContain('comboboxKeyDown as _comboboxKeyDown');
    expect(comboboxClient).toContain('comboboxOptionClick as _comboboxOptionClick');
    expect(comboboxClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis|ctx\.params)\b/,
    );

    expect(command).toContain('data-gallery-interactive="command"');
    expect(command).toContain(
      'kovo-state=\'{"highlightedValue":"dashboard","inputValue":"","lastKeyAction":"idle","open":false,"value":"dashboard"}\'',
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
    expect(command).toContain('<CommandDialog');
    expect(command).toContain('data-bind:aria-expanded=');
    expect(command).toContain('data-bind:aria-activedescendant=');
    expect(command).toContain('data-bind:hidden=');
    expect(command).toMatch(
      /on:input="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js#GalleryCommandDemo\$[A-Za-z]+_input"/,
    );
    expect(command).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js#GalleryCommandDemo\$[A-Za-z]+_keydown"/,
    );
    expect(command).toContain('GalleryCommandDemo$CommandItem_click');
    expect(command).toContain('GalleryCommandDemo$CommandItem_click_2');
    expect(command).toContain('GalleryCommandDemo$CommandClose_click');
    expect(commandClient).toContain('commandInput as _commandInput');
    expect(commandClient).toContain('commandKeyDown as _commandKeyDown');
    expect(commandClient).toContain('commandItemClick as _commandItemClick');
    expect(commandClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis|commandState)\b|ctx\.params/,
    );

    expect(contextMenu).toContain('data-gallery-interactive="context-menu"');
    expect(contextMenu).toContain(
      'kovo-state=\'{"highlightedValue":"copy","open":false,"point":{"x":24,"y":40},"value":"copy"}\'',
    );
    expect(contextMenu).toContain('<ContextMenuTrigger');
    expect(contextMenu).toContain('contextMenuFocusElement as _contextMenuFocusElement');
    expect(contextMenu).toContain('contextMenuItemClick as _contextMenuItemClick');
    expect(contextMenu).toContain('contextMenuItemKeyDown as _contextMenuItemKeyDown');
    expect(contextMenu).toContain('contextMenuMove as _contextMenuMove');
    expect(contextMenu).toContain(
      'contextMenuTriggerContextMenu as _contextMenuTriggerContextMenu',
    );
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
      /on:contextmenu="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js#GalleryContextMenuDemo\$[A-Za-z]+_contextmenu"/,
    );
    expect(contextMenu).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js#GalleryContextMenuDemo\$[A-Za-z]+_click"/,
    );
    expect(contextMenu).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js#GalleryContextMenuDemo\$[A-Za-z]+_keydown"/,
    );
    expect(contextMenu).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js#GalleryContextMenuDemo\$[A-Za-z]+_keydown_2"/,
    );
    expect(contextMenu).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js#GalleryContextMenuDemo\$[A-Za-z]+_click_2"/,
    );

    expect(disclosure).toContain('data-gallery-interactive="disclosure"');
    expect(disclosure).toContain('kovo-state=\'{"open":false}\'');
    expect(disclosure).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/disclosure-demo\.client\.js#GalleryDisclosureDemo\$[A-Za-z]+_click"/,
    );

    expect(dialog).toContain('data-gallery-interactive="dialog"');
    expect(dialog).toContain('kovo-state=\'{"open":false}\'');
    expect(dialog).toContain('<DialogTrigger');
    expect(dialog).toContain('<DialogClose');
    expect(dialog).toContain('dialogTriggerClick as _dialogTriggerClick');
    expect(dialog).toContain('dialogCloseClick as _dialogCloseClick');
    expect(dialog).toContain('data-bind:open=');
    expect(dialog).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js#GalleryDialogDemo\$[A-Za-z]+_click"/,
    );
    expect(dialog).toMatch(
      /on:cancel="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js#GalleryDialogDemo\$[A-Za-z]+_cancel"/,
    );
    expect(dialog).not.toContain('on:keydown=');

    expect(drawer).toContain('data-gallery-interactive="drawer"');
    expect(drawer).toContain('data-side="bottom"');
    expect(drawer).toContain('kovo-state=\'{"open":false}\'');
    expect(drawer).toContain('<DrawerTrigger');
    expect(drawer).toContain('<DrawerClose');
    expect(drawer).toContain('dialogTriggerClick as _dialogTriggerClick');
    expect(drawer).toContain('data-bind:aria-expanded=');
    expect(drawer).toContain('data-bind:data-state=');
    expect(drawer).toContain('data-bind:open=');
    expect(drawer).toContain('Vaul drag, snap, and background-scale gestures are not');
    expect(drawer).toContain('modeled.');
    expect(drawer).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/drawer-demo\.client\.js#GalleryDrawerDemo\$[A-Za-z]+_click"/,
    );
    expect(drawer).toMatch(
      /on:cancel="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/drawer-demo\.client\.js#GalleryDrawerDemo\$[A-Za-z]+_cancel"/,
    );
    expect(drawer).not.toContain('on:keydown=');
    expect(drawer).toContain('GalleryDrawerDemo$DrawerTrigger_click');
    expect(drawer).toContain('GalleryDrawerDemo$DrawerClose_click');

    expect(dropdownMenu).toContain('data-gallery-interactive="dropdown-menu"');
    expect(dropdownMenu).toContain(
      'kovo-state=\'{"highlightedValue":"duplicate","open":false,"value":"duplicate"}\'',
    );
    expect(dropdownMenu).toContain('<DropdownMenuContent');
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
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js#GalleryDropdownMenuDemo\$[A-Za-z]+_click"/,
    );
    expect(dropdownMenu).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js#GalleryDropdownMenuDemo\$[A-Za-z]+_keydown"/,
    );
    expect(dropdownMenu).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js#GalleryDropdownMenuDemo\$[A-Za-z]+_keydown_2"/,
    );
    expect(dropdownMenu).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js#GalleryDropdownMenuDemo\$[A-Za-z]+_click_2"/,
    );
    expect(dropdownMenu).toContain('GalleryDropdownMenuDemo$DropdownMenuItem_keydown');
    expect(dropdownMenu).toContain('GalleryDropdownMenuDemo$DropdownMenuItem_keydown_2');
    expect(dropdownMenu).toContain('GalleryDropdownMenuDemo$DropdownMenuItem_click');
    expect(dropdownMenu).toContain('GalleryDropdownMenuDemo$DropdownMenuItem_click_2');

    expect(field).toContain('data-gallery-interactive="field"');
    expect(field).toContain(
      'kovo-state=\'{"email":"ada@example","invalid":true,"plan":"team","shippingDisabled":false}\'',
    );
    expect(field).toContain('<FieldControl');
    expect(field).toContain('<Fieldset');
    expect(field).toContain('name="gallery-shipping"');
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
      /on:input="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/field-demo\.client\.js#GalleryFieldDemo\$[A-Za-z]+_input"/,
    );
    expect(field).toMatch(
      /on:change="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/field-demo\.client\.js#GalleryFieldDemo\$[A-Za-z]+_change"/,
    );
    expect(field).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/field-demo\.client\.js#GalleryFieldDemo\$[A-Za-z]+_click"/,
    );

    expect(hoverCard).toContain('data-gallery-interactive="hover-card"');
    expect(hoverCard).toContain('kovo-state=\'{"open":false}\'');
    expect(hoverCard).toContain('<HoverCardTrigger');
    expect(hoverCard).toContain('hoverCardContentPointerEnter as _hoverCardContentPointerEnter');
    expect(hoverCard).toContain('data-bind:data-state=');
    expect(hoverCard).toContain('data-bind:hidden=');
    expect(hoverCard).not.toContain('aria-controls');
    expect(hoverCard).not.toContain('aria-expanded');
    expect(hoverCardClient).toContain(
      'hoverCardTriggerPointerEnter as _hoverCardTriggerPointerEnter',
    );
    expect(hoverCardClient).toContain(
      'hoverCardContentPointerEnter as _hoverCardContentPointerEnter',
    );
    expect(hoverCardClient).toContain('setTimeout');
    expect(hoverCardClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(hoverCard).toMatch(
      /on:focus="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/hover-card-demo\.client\.js#GalleryHoverCardDemo\$[A-Za-z]+_focus"/,
    );
    expect(hoverCard).toMatch(
      /on:pointerenter="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/hover-card-demo\.client\.js#GalleryHoverCardDemo\$[A-Za-z]+_pointerenter"/,
    );
    expect(hoverCard).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/hover-card-demo\.client\.js#GalleryHoverCardDemo\$[A-Za-z]+_keydown"/,
    );

    expect(menubar).toContain('data-gallery-interactive="menubar"');
    expect(menubar).toContain('kovo-state=\'{"activeValue":"file","openValue":"","value":"new"}\'');
    expect(menubar).toContain('<MenubarSubmenu');
    expect(menubar).toContain('menubarFocusElement as _menubarFocusElement');
    expect(menubar).toContain('menubarItemClick as _menubarItemClick');
    expect(menubar).toContain('menubarItemKeyDown as _menubarItemKeyDown');
    expect(menubar).toContain('menubarKeyDown as _menubarKeyDown');
    expect(menubar).toContain('menubarMove as _menubarMove');
    expect(menubar).toContain('menubarSubmenuTriggerClick as _menubarSubmenuTriggerClick');
    expect(menubar).toContain('menubarTypeahead as _menubarTypeahead');
    expect(menubar).toContain('data-bind:aria-expanded=');
    expect(menubar).toContain('data-bind:data-highlighted=');
    expect(menubar).toContain('data-bind:hidden=');
    expect(menubar).toContain('data-bind:tabIndex=');
    expect(menubarClient).toContain('menubarFocusElement as _menubarFocusElement');
    expect(menubarClient).toContain('menubarItemKeyDown as _menubarItemKeyDown');
    expect(menubarClient).toContain('menubarKeyDown as _menubarKeyDown');
    expect(menubarClient).toContain('menubarSubmenuTriggerClick as _menubarSubmenuTriggerClick');
    expect(menubarClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(menubar).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js#GalleryMenubarDemo\$[A-Za-z]+_keydown"/,
    );
    expect(menubar).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js#GalleryMenubarDemo\$[A-Za-z]+_click"/,
    );
    expect(menubar).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js#GalleryMenubarDemo\$[A-Za-z]+_keydown"/,
    );
    expect(menubar).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js#GalleryMenubarDemo\$[A-Za-z]+_click_2"/,
    );
    expect(menubar).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js#GalleryMenubarDemo\$[A-Za-z]+_keydown_2"/,
    );
    expect(menubar).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/menubar-demo\.client\.js#GalleryMenubarDemo\$[A-Za-z]+_click_3"/,
    );

    expect(meter).toContain('data-gallery-interactive="meter"');
    expect(meter).toContain('kovo-state=\'{"dataState":"suboptimum","value":72}\'');
    expect(meter).toContain('<Meter');
    expect(meter).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/meter-demo\.client\.js#GalleryMeterDemo\$[A-Za-z]+_click"/,
    );

    expect(navigationMenu).toContain('data-gallery-interactive="navigation-menu"');
    expect(navigationMenu).toContain(
      'kovo-state=\'{"activeValue":"products","openValue":"","value":"none"}\'',
    );
    expect(navigationMenu).toContain('<NavigationMenuTrigger');
    expect(navigationMenu).toContain('navigationMenuFocusElement as _navigationMenuFocusElement');
    expect(navigationMenu).toContain('navigationMenuKeyDown as _navigationMenuKeyDown');
    expect(navigationMenu).toContain('navigationMenuLinkClick as _navigationMenuLinkClick');
    expect(navigationMenu).toContain('navigationMenuMove as _navigationMenuMove');
    expect(navigationMenu).toContain('navigationMenuTriggerClick as _navigationMenuTriggerClick');
    expect(navigationMenu).toContain('navigationMenuTriggerFocus as _navigationMenuTriggerFocus');
    expect(navigationMenu).toContain(
      'navigationMenuTriggerPointerEnter as _navigationMenuTriggerPointerEnter',
    );
    expect(navigationMenu).toContain('navigationMenuTypeahead as _navigationMenuTypeahead');
    expect(navigationMenu).toContain('data-bind:aria-expanded=');
    expect(navigationMenu).toContain('data-bind:data-highlighted=');
    expect(navigationMenu).toContain('data-bind:hidden=');
    expect(navigationMenu).toContain('data-bind:tabIndex=');
    expect(navigationMenuClient).toContain('navigationMenuKeyDown as _navigationMenuKeyDown');
    expect(navigationMenuClient).toContain('navigationMenuLinkClick as _navigationMenuLinkClick');
    expect(navigationMenuClient).toContain(
      'navigationMenuTriggerPointerEnter as _navigationMenuTriggerPointerEnter',
    );
    expect(navigationMenuClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(navigationMenu).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js#GalleryNavigationMenuDemo\$[A-Za-z]+_keydown"/,
    );
    expect(navigationMenu).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js#GalleryNavigationMenuDemo\$[A-Za-z]+_click"/,
    );
    expect(navigationMenu).toMatch(
      /on:focus="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js#GalleryNavigationMenuDemo\$[A-Za-z]+_focus"/,
    );
    expect(navigationMenu).toMatch(
      /on:pointerenter="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js#GalleryNavigationMenuDemo\$[A-Za-z]+_pointerenter"/,
    );
    expect(navigationMenu).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js#GalleryNavigationMenuDemo\$[A-Za-z]+_click"/,
    );
    expect(navigationMenu).toMatch(
      /on:focus="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/navigation-menu-demo\.client\.js#GalleryNavigationMenuDemo\$[A-Za-z]+_focus"/,
    );

    expect(numberField).toContain('data-gallery-interactive="number-field"');
    expect(numberField).toContain('kovo-state=\'{"value":2}\'');
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
      /on:input="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js#GalleryNumberFieldDemo\$[A-Za-z]+_input"/,
    );
    expect(numberField).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js#GalleryNumberFieldDemo\$[A-Za-z]+_keydown"/,
    );
    expect(numberField).toContain('GalleryNumberFieldDemo$NumberFieldDecrement_click');
    expect(numberField).toContain('GalleryNumberFieldDemo$NumberFieldIncrement_click');

    expect(otpField).toContain('data-gallery-interactive="otp-field"');
    expect(otpField).toContain('kovo-state=\'{"activeSlot":2,"value":"12"}\'');
    expect(otpField).toContain("const formId = 'gallery-otp-form'");
    expect(otpField).toContain('<form id={formId} data-gallery-form="otp-field" />');
    expect(otpField).toContain('<OtpFieldHiddenInput');
    expect(otpField).toContain('form: formId');
    expect(otpField).toContain('otpFieldInput as _otpFieldInput');
    expect(otpField).toContain('data-bind:value=');
    expect(otpField).toContain('data-bind:data-filled=');
    expect(otpField).toContain('data-bind:tabIndex=');
    expect(otpField).toMatch(
      /on:input="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/otp-field-demo\.client\.js#GalleryOtpFieldDemo\$[A-Za-z]+_input"/,
    );
    expect(otpField).toMatch(
      /on:paste="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/otp-field-demo\.client\.js#GalleryOtpFieldDemo\$[A-Za-z]+_paste_4"/,
    );

    expect(collapsible).toContain('data-gallery-interactive="collapsible"');
    expect(collapsible).toContain('kovo-state=\'{"open":false}\'');
    expect(collapsible).toContain('GalleryCollapsibleDemo$CollapsibleTrigger_click');

    expect(popover).toContain('data-gallery-interactive="popover"');
    expect(popover).toContain('kovo-state=\'{"open":false}\'');
    expect(popover).toContain('<PopoverTrigger');
    expect(popover).toContain('<PopoverContent');
    expect(popover).toContain('data-demo-state="popover-open"');
    expect(popover).toContain('popoverBeforeToggle as _popoverBeforeToggle');
    expect(popover).toContain('data-bind:open=');
    expect(popover).toMatch(
      /on:beforetoggle="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/popover-demo\.client\.js#GalleryPopoverDemo\$[A-Za-z]+_beforetoggle"/,
    );
    expect(popover).not.toContain('on:click=');
    expect(popover).not.toContain('on:keydown=');
    expect(popoverClient).toContain('popoverBeforeToggle as _popoverBeforeToggle');
    expect(popoverClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );

    expect(progress).toContain('data-gallery-interactive="progress"');
    expect(progress).toContain('kovo-state=\'{"value":40}\'');
    expect(progress).toContain('<Progress');
    expect(progress).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/progress-demo\.client\.js#GalleryProgressDemo\$[A-Za-z]+_click"/,
    );
    expect(progress).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/progress-demo\.client\.js#GalleryProgressDemo\$[A-Za-z]+_click_2"/,
    );

    expect(pureMarkup).toContain('data-gallery-interactive="pure-markup"');
    expect(pureMarkup).toContain("import { Badge } from '@kovojs/ui/badge';");
    expect(pureMarkup).toContain("import { Card } from '@kovojs/ui/card';");
    expect(pureMarkup).toContain("import { Kbd } from '@kovojs/ui/kbd';");
    expect(pureMarkup).toContain("import { Table } from '@kovojs/ui/table';");
    expect(pureMarkup).not.toContain('@kovojs/headless-ui');

    expect(radioGroup).toContain('data-gallery-interactive="radio-group"');
    expect(radioGroup).toContain('id="gallery-radio-form" data-gallery-form="radio-group"');
    expect(radioGroup).toContain("form: 'gallery-radio-form'");
    expect(radioGroup).toContain('kovo-state=\'{"value":"email"}\'');
    expect(radioGroup).toContain('<RadioGroupRadio');
    expect(radioGroup).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/radio-group-demo\.client\.js#GalleryRadioGroupDemo\$[A-Za-z]+_keydown"/,
    );
    expect(radioGroup).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/radio-group-demo\.client\.js#GalleryRadioGroupDemo\$[A-Za-z]+_click_2"/,
    );

    expect(scrollArea).toContain('data-gallery-interactive="scroll-area"');
    expect(scrollArea).toContain(
      'kovo-state=\'{"dragging":false,"dragPointerStart":0,"dragScrollTop":0,"dragThumbSize":28,"dragTrackSize":72,"hasOverflowY":true,"hovering":false,"scrolling":false,"scrollTop":0,"scrollY":"start","thumbOffset":0,"thumbSize":28,"verticalVisible":true}\'',
    );
    expect(scrollArea).toContain('<ScrollAreaViewport');
    expect(scrollArea).toContain('<ScrollAreaThumb');
    expect(scrollArea).toContain('scrollAreaViewportScroll as _scrollAreaViewportScroll');
    expect(scrollArea).toContain('scrollAreaThumbDrag as _scrollAreaThumbDrag');
    expect(scrollArea).toContain('scrollAreaTrackPointerDown as _scrollAreaTrackPointerDown');
    expect(scrollArea).toContain('data-bind:data-has-overflow-y=');
    expect(scrollArea).toContain('data-bind:data-scrolling=');
    expect(scrollArea).toContain('data-bind:scrollTop=');
    expect(scrollArea).toContain('data-bind:style=');
    expect(scrollArea).toMatch(
      /on:scroll="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/scroll-area-demo\.client\.js#GalleryScrollAreaDemo\$[A-Za-z]+_scroll"/,
    );
    expect(scrollArea).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/scroll-area-demo\.client\.js#GalleryScrollAreaDemo\$[A-Za-z]+_click"/,
    );
    expect(scrollArea).toMatch(
      /on:pointerdown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/scroll-area-demo\.client\.js#GalleryScrollAreaDemo\$[A-Za-z]+_pointerdown"/,
    );

    expect(select).toContain('data-gallery-interactive="select"');
    expect(select).toContain('id="gallery-select-form" data-gallery-form="select"');
    expect(select).toContain("form: 'gallery-select-form'");
    expect(select).toContain(
      'kovo-state=\'{"highlightedValue":"standard","open":false,"value":"standard"}\'',
    );
    expect(select).toContain('<SelectHiddenInput');
    expect(select).toContain('<SelectTrigger');
    expect(select).toContain('<SelectItem');
    expect(select).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/select-demo\.client\.js#GallerySelectDemo\$[A-Za-z]+_click"/,
    );
    expect(select).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/select-demo\.client\.js#GallerySelectDemo\$[A-Za-z]+_keydown"/,
    );
    expect(select).toContain('<SelectContent');
    expect(select).toContain('selectItemClick as _selectItemClick');
    expect(select).toContain('data-bind:aria-selected=');

    expect(sheet).toContain('data-gallery-interactive="sheet"');
    expect(sheet).toContain('data-side="right"');
    expect(sheet).toContain('kovo-state=\'{"open":false}\'');
    expect(sheet).toContain('<SheetTrigger');
    expect(sheet).toContain('<SheetClose');
    expect(sheet).toContain('dialogTriggerClick as _dialogTriggerClick');
    expect(sheet).toContain('data-bind:aria-expanded=');
    expect(sheet).toContain('data-bind:data-state=');
    expect(sheet).toContain('data-bind:open=');
    expect(sheet).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/sheet-demo\.client\.js#GallerySheetDemo\$[A-Za-z]+_click"/,
    );
    expect(sheet).toMatch(
      /on:cancel="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/sheet-demo\.client\.js#GallerySheetDemo\$[A-Za-z]+_cancel"/,
    );
    expect(sheet).not.toContain('on:keydown=');
    expect(sheet).toContain('GallerySheetDemo$SheetTrigger_click');
    expect(sheet).toContain('GallerySheetDemo$SheetClose_click');

    expect(slider).toContain('data-gallery-interactive="slider"');
    expect(slider).toContain('id="gallery-slider-form" data-gallery-form="slider"');
    expect(slider).toContain("form: 'gallery-slider-form'");
    expect(slider).toContain(
      'kovo-state=\'{"dragging":false,"dragPointerStart":0,"dragValueStart":25,"value":25}\'',
    );
    expect(slider).toContain('<SliderInput');
    expect(slider).toContain('<SliderThumb');
    expect(slider).toContain('data-bind:aria-valuenow=');
    expect(slider).toMatch(
      /on:pointerdown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/slider-demo\.client\.js#GallerySliderDemo\$[A-Za-z]+_pointerdown"/,
    );
    expect(slider).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/slider-demo\.client\.js#GallerySliderDemo\$[A-Za-z]+_keydown"/,
    );
    expect(slider).toMatch(
      /on:pointermove="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/slider-demo\.client\.js#GallerySliderDemo\$[A-Za-z]+_pointermove"/,
    );

    expect(switchDemo).toContain('data-gallery-interactive="switch"');
    expect(switchDemo).toContain('form="gallery-switch-form"');
    expect(switchDemo).toContain('kovo-state=\'{"checked":false}\'');
    expect(switchDemo).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/switch-demo\.client\.js#GallerySwitchDemo\$[A-Za-z]+_click"/,
    );

    expect(tabs).toContain('data-gallery-interactive="tabs"');
    expect(tabs).toContain('kovo-state=\'{"activeValue":"overview","value":"overview"}\'');
    expect(tabs).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/tabs-demo\.client\.js#GalleryTabsDemo\$[A-Za-z]+_keydown"/,
    );
    expect(tabs).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/tabs-demo\.client\.js#GalleryTabsDemo\$[A-Za-z]+_click_2"/,
    );

    expect(toolbar).toContain('data-gallery-interactive="toolbar"');
    expect(toolbar).toContain('kovo-state=\'{"activeValue":"bold","pressedValue":"bold"}\'');
    expect(toolbar).toContain('<ToolbarButton');
    expect(toolbar).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/toolbar-demo\.client\.js#GalleryToolbarDemo\$[A-Za-z]+_keydown"/,
    );
    expect(toolbar).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/toolbar-demo\.client\.js#GalleryToolbarDemo\$[A-Za-z]+_click_2"/,
    );
    expect(toolbar).toContain('data-bind:aria-pressed=');
    expect(toolbar).toContain('data-bind:data-pressed=');
    expect(toolbar).toContain('data-bind:tabIndex=');
    expect(toolbar).toContain('data-bind="state.activeValue"');
    const toolbarClient = readGenerated('toolbar-demo.client.js');
    expect(toolbarClient).toContain('toolbarKeyDown as _toolbarKeyDown');
    expect(toolbarClient).not.toMatch(/Reflect|getElementById|setAttribute|document|globalThis/);

    expect(tooltip).toContain('data-gallery-interactive="tooltip"');
    expect(tooltip).toContain('kovo-state=\'{"open":false}\'');
    expect(tooltip).toContain('<TooltipTrigger');
    expect(tooltip).toContain('tooltipTriggerPointerEnter as _tooltipTriggerPointerEnter');
    expect(tooltip).toContain('data-bind:aria-describedby=');
    expect(tooltip).toContain('data-bind:open=');
    expect(tooltip).not.toContain('popover=');
    expect(tooltipClient).toContain('tooltipTriggerPointerEnter as _tooltipTriggerPointerEnter');
    expect(tooltipClient).toContain('tooltipEscapeKeyDown as _tooltipEscapeKeyDown');
    expect(tooltipClient).not.toMatch(
      /\b(?:Reflect|getElementById|setAttribute|document|globalThis)\b|ctx\.params/,
    );
    expect(tooltip).toMatch(
      /on:focus="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/tooltip-demo\.client\.js#GalleryTooltipDemo\$[A-Za-z]+_focus"/,
    );
    expect(tooltip).toMatch(
      /on:pointerenter="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/tooltip-demo\.client\.js#GalleryTooltipDemo\$[A-Za-z]+_pointerenter"/,
    );
    expect(tooltip).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/tooltip-demo\.client\.js#GalleryTooltipDemo\$[A-Za-z]+_keydown"/,
    );

    expect(toggleGroup).toContain('data-gallery-interactive="toggle-group"');
    expect(toggleGroup).toContain('kovo-state=\'{"activeValue":"bold","value":"bold"}\'');
    expect(toggleGroup).toContain('<ToggleGroupButton');
    expect(toggleGroup).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/toggle-group-demo\.client\.js#GalleryToggleGroupDemo\$[A-Za-z]+_keydown"/,
    );
    expect(toggleGroup).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/toggle-group-demo\.client\.js#GalleryToggleGroupDemo\$[A-Za-z]+_click_2"/,
    );
    expect(toggleGroup).toContain('data-bind:aria-pressed=');
    expect(toggleGroup).toContain('data-bind:data-state=');
    expect(toggleGroup).toContain('data-bind:tabIndex=');
    expect(toggleGroupClient).toContain('toggleGroupKeyDown as _toggleGroupKeyDown');
    expect(toggleGroupClient).toContain('toggleGroupItemClick as _toggleGroupItemClick');
    expect(toggleGroupClient).not.toMatch(
      /Reflect|getElementById|setAttribute|document|globalThis/,
    );

    expect(toast).toContain('data-gallery-interactive="toast"');
    expect(toast).toContain(
      'kovo-state=\'{"activeCount":0,"activeOpen":false,"previousCount":0,"previousOpen":false}\'',
    );
    expect(toast).toContain('<Toast');
    expect(toast).toContain('<ToastViewport');
    expect(toast).toContain('data-toast-show=""');
    expect(toast).toContain('data-toast-duration-ms={durationMs}');
    expect(toast).toContain('normalizeToastDuration(5000)');
    expect(toast).toContain('toastAnimationEnd as _toastAnimationEnd');
    expect(toast).toContain('toastViewportKeyDown as _toastViewportKeyDown');
    expect(toast).toContain('data-bind:hidden=');
    expect(toast).toContain('data-bind:data-state=');
    expect(toast).toContain('data-demo-state="toast-count"');
    expect(toast).toMatch(
      /on:keydown="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js#GalleryToastDemo\$[A-Za-z]+_keydown"/,
    );
    expect(toast).toMatch(
      /on:animationend="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js#GalleryToastDemo\$[A-Za-z]+_animationend"/,
    );
    expect(toast).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{8}\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js#GalleryToastDemo\$[A-Za-z]+_click"/,
    );
    expect(toast).toContain('GalleryToastDemo$ToastAction_click');
    expect(toast).toContain('GalleryToastDemo$ToastAction_click_2');
    expect(toast).toContain('GalleryToastDemo$ToastClose_click_2');
    expect(toast).toContain('GalleryToastDemo$ToastAction_click_3');
    expect(toast).toContain('data-toast-cancel-dismiss=""');
    expect(toast).toContain('data-toast-disabled-action=""');
    expect(toast).toContain('dismissOnAction: false');
    expect(toastClient).toContain('toastAnimationEnd as _toastAnimationEnd');
    expect(toastClient).toContain('toastViewportKeyDown as _toastViewportKeyDown');
    expect(toastClient).not.toMatch(/Reflect|getElementById|setAttribute|document|globalThis/);
  });
});
