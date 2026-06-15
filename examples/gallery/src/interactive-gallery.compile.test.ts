import { describe, expect, it } from 'vitest';

import { readGenerated } from './interactive-gallery-harness.js';

describe('compiled interactive gallery demos', () => {
  it('compiles stateful gallery demos into server TSX and client handler modules', () => {
    const accordion = readGenerated('accordion-demo.tsx');
    const alertDialog = readGenerated('alert-dialog-demo.tsx');
    const autocomplete = readGenerated('autocomplete-demo.tsx');
    const toggle = readGenerated('toggle-demo.tsx');
    const checkbox = readGenerated('checkbox-demo.tsx');
    const checkboxGroup = readGenerated('checkbox-group-demo.tsx');
    const collapsible = readGenerated('collapsible-demo.tsx');
    const combobox = readGenerated('combobox-demo.tsx');
    const command = readGenerated('command-demo.tsx');
    const contextMenu = readGenerated('context-menu-demo.tsx');
    const disclosure = readGenerated('disclosure-demo.tsx');
    const dialog = readGenerated('dialog-demo.tsx');
    const drawer = readGenerated('drawer-demo.tsx');
    const dropdownMenu = readGenerated('dropdown-menu-demo.tsx');
    const field = readGenerated('field-demo.tsx');
    const hoverCard = readGenerated('hover-card-demo.tsx');
    const menubar = readGenerated('menubar-demo.tsx');
    const meter = readGenerated('meter-demo.tsx');
    const navigationMenu = readGenerated('navigation-menu-demo.tsx');
    const navigationMenuClient = readGenerated('navigation-menu-demo.client.js');
    const numberField = readGenerated('number-field-demo.tsx');
    const otpField = readGenerated('otp-field-demo.tsx');
    const popover = readGenerated('popover-demo.tsx');
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
    const toggleGroup = readGenerated('toggle-group-demo.tsx');
    const toggleGroupClient = readGenerated('toggle-group-demo.client.js');
    const toast = readGenerated('toast-demo.tsx');

    expect(accordion).toContain('data-gallery-interactive="accordion"');
    expect(accordion).toContain('fw-state=\'{"value":"shipping"}\'');
    expect(accordion).toContain('accordionTriggerAttributes({');
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
    expect(alertDialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$button_click"/,
    );
    expect(alertDialog).toMatch(
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$dialog_cancel"/,
    );
    expect(alertDialog).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/alert-dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAlertDialogDemo\$section_keydown"/,
    );
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
    expect(autocomplete).toContain('autocompleteOptionAttributes({');
    expect(autocomplete).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAutocompleteDemo\$input_input"/,
    );
    expect(autocomplete).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAutocompleteDemo\$input_keydown"/,
    );
    expect(autocomplete).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/autocomplete-demo\.client\.js\?v=[0-9a-f]{8}#GalleryAutocompleteDemo\$option_click"/,
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
    expect(checkboxGroup).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxGroupDemo\$section_keydown"/,
    );
    expect(checkboxGroup).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/checkbox-group-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCheckboxGroupDemo\$input_click_2"/,
    );

    expect(combobox).toContain('data-gallery-interactive="combobox"');
    expect(combobox).toContain(
      'fw-state=\'{"highlightedValue":"austin","open":false,"value":"austin"}\'',
    );
    expect(combobox).toContain('comboboxInputAttributes({');
    expect(combobox).toContain('id="gallery-combobox-form" data-gallery-form="combobox"');
    expect(combobox).toContain("form: 'gallery-combobox-form'");
    expect(combobox).toContain('comboboxListboxAttributes({');
    expect(combobox).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryComboboxDemo\$input_input"/,
    );
    expect(combobox).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryComboboxDemo\$input_keydown"/,
    );
    expect(combobox).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/combobox-demo\.client\.js\?v=[0-9a-f]{8}#GalleryComboboxDemo\$button_click"/,
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
    expect(command).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCommandDemo\$input_input"/,
    );
    expect(command).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCommandDemo\$input_keydown"/,
    );
    expect(command).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/command-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCommandDemo\$button_click_2"/,
    );

    expect(contextMenu).toContain('data-gallery-interactive="context-menu"');
    expect(contextMenu).toContain(
      'fw-state=\'{"highlightedValue":"copy","open":false,"value":"copy"}\'',
    );
    expect(contextMenu).toContain('contextMenuTriggerAttributes({');
    expect(contextMenu).toMatch(
      /on:contextmenu="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$div_contextmenu"/,
    );
    expect(contextMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$button_click"/,
    );
    expect(contextMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/context-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryContextMenuDemo\$button_keydown"/,
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
    expect(dialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$button_click"/,
    );
    expect(dialog).toMatch(
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$dialog_cancel"/,
    );
    expect(dialog).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$section_keydown"/,
    );
    expect(dialog).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dialog-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDialogDemo\$button_click_2"/,
    );

    expect(drawer).toContain('data-gallery-interactive="drawer"');
    expect(drawer).toContain('data-side="bottom"');
    expect(drawer).toContain('fw-state=\'{"open":false}\'');
    expect(drawer).toContain('dialogTriggerAttributes({ contentId, open: state.open })');
    expect(drawer).toContain('dialogCloseAttributes({ contentId, open: state.open })');
    expect(drawer).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/drawer-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDrawerDemo\$button_click"/,
    );
    expect(drawer).toMatch(
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/drawer-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDrawerDemo\$dialog_cancel"/,
    );
    expect(drawer).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/drawer-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDrawerDemo\$section_keydown"/,
    );
    expect(drawer).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/drawer-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDrawerDemo\$button_click_2"/,
    );

    expect(dropdownMenu).toContain('data-gallery-interactive="dropdown-menu"');
    expect(dropdownMenu).toContain(
      'fw-state=\'{"highlightedValue":"duplicate","open":false,"value":"duplicate"}\'',
    );
    expect(dropdownMenu).toContain('dropdownMenuContentAttributes({');
    expect(dropdownMenu).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_click"/,
    );
    expect(dropdownMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$div_keydown"/,
    );
    expect(dropdownMenu).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/dropdown-menu-demo\.client\.js\?v=[0-9a-f]{8}#GalleryDropdownMenuDemo\$button_keydown"/,
    );

    expect(field).toContain('data-gallery-interactive="field"');
    expect(field).toContain(
      'fw-state=\'{"email":"ada@example","invalid":true,"plan":"team","shippingDisabled":false}\'',
    );
    expect(field).toContain('fieldControlAttributes({');
    expect(field).toContain('fieldsetRootAttributes({');
    expect(field).toContain("name: 'gallery-shipping'");
    expect(field).toContain('name="gallery-seat"');
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
    expect(meter).toContain('fw-state=\'{"value":72}\'');
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
    expect(numberField).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/number-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryNumberFieldDemo\$input_input"/,
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
    expect(otpField).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/otp-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryOtpFieldDemo\$input_input"/,
    );
    expect(otpField).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/otp-field-demo\.client\.js\?v=[0-9a-f]{8}#GalleryOtpFieldDemo\$input_keydown_2"/,
    );

    expect(collapsible).toContain('data-gallery-interactive="collapsible"');
    expect(collapsible).toContain('fw-state=\'{"open":false}\'');
    expect(collapsible).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/collapsible-demo\.client\.js\?v=[0-9a-f]{8}#GalleryCollapsibleDemo\$summary_click"/,
    );

    expect(popover).toContain('data-gallery-interactive="popover"');
    expect(popover).toContain('fw-state=\'{"open":false}\'');
    expect(popover).toContain('data-demo-state="popover-open"');
    expect(popover).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/popover-demo\.client\.js\?v=[0-9a-f]{8}#GalleryPopoverDemo\$section_keydown"/,
    );
    expect(popover).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/popover-demo\.client\.js\?v=[0-9a-f]{8}#GalleryPopoverDemo\$button_click"/,
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
    expect(scrollArea).toContain('fw-state=\'{"position":"top"}\'');
    expect(scrollArea).toContain('scrollAreaViewportAttributes({');
    expect(scrollArea).toContain('scrollAreaThumbAttributes({');
    expect(scrollArea).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/scroll-area-demo\.client\.js\?v=[0-9a-f]{8}#GalleryScrollAreaDemo\$button_click"/,
    );

    expect(select).toContain('data-gallery-interactive="select"');
    expect(select).toContain('id="gallery-select-form" data-gallery-form="select"');
    expect(select).toContain("form: 'gallery-select-form'");
    expect(select).toContain('fw-state=\'{"value":"standard"}\'');
    expect(select).toContain('selectTriggerAttributes({');
    expect(select).toContain('selectItemAttributes({');
    expect(select).toMatch(
      /on:change="\/c\/examples\/gallery\/src\/generated\/interactive\/select-demo\.client\.js\?v=[0-9a-f]{8}#GallerySelectDemo\$select_change"/,
    );

    expect(sheet).toContain('data-gallery-interactive="sheet"');
    expect(sheet).toContain('data-side="right"');
    expect(sheet).toContain('fw-state=\'{"open":false}\'');
    expect(sheet).toContain('dialogTriggerAttributes({ contentId, open: state.open })');
    expect(sheet).toContain('dialogCloseAttributes({ contentId, open: state.open })');
    expect(sheet).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/sheet-demo\.client\.js\?v=[0-9a-f]{8}#GallerySheetDemo\$button_click"/,
    );
    expect(sheet).toMatch(
      /on:cancel="\/c\/examples\/gallery\/src\/generated\/interactive\/sheet-demo\.client\.js\?v=[0-9a-f]{8}#GallerySheetDemo\$dialog_cancel"/,
    );
    expect(sheet).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/sheet-demo\.client\.js\?v=[0-9a-f]{8}#GallerySheetDemo\$section_keydown"/,
    );
    expect(sheet).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/sheet-demo\.client\.js\?v=[0-9a-f]{8}#GallerySheetDemo\$button_click_2"/,
    );

    expect(slider).toContain('data-gallery-interactive="slider"');
    expect(slider).toContain('id="gallery-slider-form" data-gallery-form="slider"');
    expect(slider).toContain("form: 'gallery-slider-form'");
    expect(slider).toContain('fw-state=\'{"value":25}\'');
    expect(slider).toContain('sliderInputAttributes(sliderState)');
    expect(slider).toMatch(
      /on:input="\/c\/examples\/gallery\/src\/generated\/interactive\/slider-demo\.client\.js\?v=[0-9a-f]{8}#GallerySliderDemo\$input_input"/,
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

    expect(tooltip).toContain('data-gallery-interactive="tooltip"');
    expect(tooltip).toContain('fw-state=\'{"open":false}\'');
    expect(tooltip).toContain('tooltipTriggerAttributes({ contentId, open: state.open })');
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
    expect(toggleGroupClient).toContain("Object(italic)['focus']?.call(italic)");

    expect(toast).toContain('data-gallery-interactive="toast"');
    expect(toast).toContain('fw-state=\'{"open":true}\'');
    expect(toast).toContain('toastRootAttributes(toastState)');
    expect(toast).toMatch(
      /on:keydown="\/c\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToastDemo\$section_keydown"/,
    );
    expect(toast).toMatch(
      /on:click="\/c\/examples\/gallery\/src\/generated\/interactive\/toast-demo\.client\.js\?v=[0-9a-f]{8}#GalleryToastDemo\$button_click_2"/,
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
  });
});
