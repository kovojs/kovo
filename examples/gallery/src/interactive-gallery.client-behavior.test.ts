import { describe, expect, it } from 'vitest';

import {
  changeEvent,
  clientHandler,
  evaluateClientModule,
  inputEvent,
  keyEvent,
} from './interactive-gallery-harness.js';

describe('compiled interactive gallery demos', () => {
  it('executes generated client behavior for the stateful demos', () => {
    const accordion = evaluateClientModule('accordion-demo.client.js');
    const alertDialog = evaluateClientModule('alert-dialog-demo.client.js');
    const autocomplete = evaluateClientModule('autocomplete-demo.client.js');
    const toggle = evaluateClientModule('toggle-demo.client.js');
    const checkbox = evaluateClientModule('checkbox-demo.client.js');
    const checkboxGroup = evaluateClientModule('checkbox-group-demo.client.js');
    const collapsible = evaluateClientModule('collapsible-demo.client.js');
    const combobox = evaluateClientModule('combobox-demo.client.js');
    const command = evaluateClientModule('command-demo.client.js');
    const contextMenu = evaluateClientModule('context-menu-demo.client.js');
    const disclosure = evaluateClientModule('disclosure-demo.client.js');
    const dialog = evaluateClientModule('dialog-demo.client.js');
    const dropdownMenu = evaluateClientModule('dropdown-menu-demo.client.js');
    const field = evaluateClientModule('field-demo.client.js');
    const hoverCard = evaluateClientModule('hover-card-demo.client.js');
    const menubar = evaluateClientModule('menubar-demo.client.js');
    const meter = evaluateClientModule('meter-demo.client.js');
    const navigationMenu = evaluateClientModule('navigation-menu-demo.client.js');
    const numberField = evaluateClientModule('number-field-demo.client.js');
    const otpField = evaluateClientModule('otp-field-demo.client.js');
    const popover = evaluateClientModule('popover-demo.client.js');
    const progress = evaluateClientModule('progress-demo.client.js');
    const radioGroup = evaluateClientModule('radio-group-demo.client.js');
    const scrollArea = evaluateClientModule('scroll-area-demo.client.js');
    const select = evaluateClientModule('select-demo.client.js');
    const slider = evaluateClientModule('slider-demo.client.js');
    const switchDemo = evaluateClientModule('switch-demo.client.js');
    const tabs = evaluateClientModule('tabs-demo.client.js');
    const toolbar = evaluateClientModule('toolbar-demo.client.js');
    const tooltip = evaluateClientModule('tooltip-demo.client.js');
    const toggleGroup = evaluateClientModule('toggle-group-demo.client.js');
    const toast = evaluateClientModule('toast-demo.client.js');
    const signal = new AbortController().signal;

    const accordionState = { activeValue: 'shipping', value: 'shipping' };
    const billingTrigger = {
      focusCalls: 0,
      focus() {
        this.focusCalls += 1;
      },
    };
    const accordionRoot = {
      querySelector: (selector: string) =>
        selector === '[value="billing"]' ? billingTrigger : undefined,
    };
    const accordionKeyEvent = keyEvent('ArrowDown');
    Object.defineProperty(accordionKeyEvent, 'target', {
      value: { closest: () => accordionRoot },
    });
    clientHandler(accordion, 'GalleryAccordionDemo$section_keydown')(accordionKeyEvent, {
      params: {},
      signal,
      state: accordionState,
    });
    expect(accordionState).toEqual({ activeValue: 'billing', value: 'shipping' });
    expect(billingTrigger.focusCalls).toBe(1);
    clientHandler(accordion, 'GalleryAccordionDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: accordionState,
    });
    expect(accordionState).toEqual({ activeValue: 'billing', value: 'billing' });

    const alertDialogState = { open: false };
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: true });
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$dialog_cancel')(new Event('cancel'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: false });
    alertDialogState.open = true;
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: false });
    alertDialogState.open = true;
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: false });
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    clientHandler(alertDialog, 'GalleryAlertDialogDemo$button_click_3')(new Event('click'), {
      params: {},
      signal,
      state: alertDialogState,
    });
    expect(alertDialogState).toEqual({ open: false });

    const autocompleteState = {
      highlightedValue: 'design',
      inputValue: 'de',
      open: false,
      value: 'design',
    };
    clientHandler(autocomplete, 'GalleryAutocompleteDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: autocompleteState,
    });
    expect(autocompleteState).toEqual({
      highlightedValue: 'development',
      inputValue: 'dev',
      open: true,
      value: 'design',
    });
    clientHandler(autocomplete, 'GalleryAutocompleteDemo$input_keydown')(keyEvent('Enter'), {
      params: {},
      signal,
      state: autocompleteState,
    });
    expect(autocompleteState).toEqual({
      highlightedValue: 'development',
      inputValue: 'development',
      open: false,
      value: 'development',
    });
    clientHandler(autocomplete, 'GalleryAutocompleteDemo$option_click')(new Event('click'), {
      params: { value: 'development' },
      signal,
      state: autocompleteState,
    });
    expect(autocompleteState).toEqual({
      highlightedValue: 'development',
      inputValue: 'development',
      open: false,
      value: 'development',
    });

    const toggleState = { pressed: false };
    clientHandler(toggle, 'GalleryToggleDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: toggleState,
    });
    expect(toggleState).toEqual({ pressed: true });

    const checkboxState = { checked: 'indeterminate' };
    clientHandler(checkbox, 'GalleryCheckboxDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: checkboxState,
    });
    expect(checkboxState).toEqual({ checked: true });

    const checkboxGroupState = { activeValue: 'updates', value: 'updates' };
    clientHandler(checkboxGroup, 'GalleryCheckboxGroupDemo$input_click_2')(new Event('click'), {
      params: {},
      signal,
      state: checkboxGroupState,
    });
    expect(checkboxGroupState).toEqual({ activeValue: 'updates', value: '' });
    clientHandler(checkboxGroup, 'GalleryCheckboxGroupDemo$input_click_3')(new Event('click'), {
      params: {},
      signal,
      state: checkboxGroupState,
    });
    expect(checkboxGroupState).toEqual({
      activeValue: 'billing',
      value: 'billing',
    });

    const comboboxState = { highlightedValue: 'austin', open: false, value: 'austin' };
    clientHandler(combobox, 'GalleryComboboxDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: comboboxState,
    });
    expect(comboboxState).toEqual({ highlightedValue: 'chicago', open: true, value: 'chicago' });
    clientHandler(combobox, 'GalleryComboboxDemo$input_keydown')(keyEvent('Enter'), {
      params: {},
      signal,
      state: comboboxState,
    });
    expect(comboboxState).toEqual({ highlightedValue: 'chicago', open: false, value: 'chicago' });
    clientHandler(combobox, 'GalleryComboboxDemo$button_click')(new Event('click'), {
      params: { value: 'austin' },
      signal,
      state: comboboxState,
    });
    expect(comboboxState).toEqual({ highlightedValue: 'austin', open: false, value: 'austin' });

    const commandState = {
      highlightedValue: 'dashboard',
      inputValue: '',
      lastKeyAction: 'idle',
      open: false,
      value: 'dashboard',
    };
    clientHandler(command, 'GalleryCommandDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: commandState,
    });
    expect(commandState).toEqual({
      highlightedValue: 'dashboard',
      inputValue: '',
      lastKeyAction: 'idle',
      open: true,
      value: 'dashboard',
    });
    clientHandler(command, 'GalleryCommandDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: commandState,
    });
    expect(commandState).toEqual({
      highlightedValue: 'invite',
      inputValue: 'invite',
      lastKeyAction: 'idle',
      open: true,
      value: 'dashboard',
    });
    clientHandler(command, 'GalleryCommandDemo$input_keydown')(keyEvent('Enter'), {
      params: {},
      signal,
      state: commandState,
    });
    expect(commandState).toEqual({
      highlightedValue: 'invite',
      inputValue: 'invite',
      lastKeyAction: 'canceled',
      open: true,
      value: 'dashboard',
    });
    commandState.open = true;
    clientHandler(command, 'GalleryCommandDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: commandState,
    });
    expect(commandState).toEqual({
      highlightedValue: 'invite',
      inputValue: 'invite',
      lastKeyAction: 'canceled',
      open: false,
      value: 'invite',
    });

    const contextMenuState = { highlightedValue: 'copy', open: false, value: 'copy' };
    clientHandler(contextMenu, 'GalleryContextMenuDemo$div_contextmenu')(new Event('contextmenu'), {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextMenuState).toEqual({ highlightedValue: 'copy', open: true, value: 'copy' });
    const contextKeyboardEvent = Object.assign(new Event('keydown', { cancelable: true }), {
      key: ' ',
    });
    clientHandler(contextMenu, 'GalleryContextMenuDemo$button_keydown')(contextKeyboardEvent, {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextKeyboardEvent.defaultPrevented).toBe(true);
    expect(contextMenuState).toEqual({
      highlightedValue: 'inspect',
      open: false,
      value: 'inspect',
    });

    contextMenuState.open = true;
    clientHandler(contextMenu, 'GalleryContextMenuDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextMenuState).toEqual({
      highlightedValue: 'inspect',
      open: false,
      value: 'inspect',
    });

    const disclosureState = { open: false };
    clientHandler(disclosure, 'GalleryDisclosureDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: disclosureState,
    });
    expect(disclosureState).toEqual({ open: true });

    const dialogState = { open: false };
    clientHandler(dialog, 'GalleryDialogDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: dialogState,
    });
    expect(dialogState).toEqual({ open: true });
    clientHandler(dialog, 'GalleryDialogDemo$dialog_cancel')(new Event('cancel'), {
      params: {},
      signal,
      state: dialogState,
    });
    expect(dialogState).toEqual({ open: false });
    dialogState.open = true;
    clientHandler(dialog, 'GalleryDialogDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: dialogState,
    });
    expect(dialogState).toEqual({ open: false });
    dialogState.open = true;
    clientHandler(dialog, 'GalleryDialogDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: dialogState,
    });
    expect(dialogState).toEqual({ open: false });

    const dropdownMenuState = { highlightedValue: 'duplicate', open: false, value: 'duplicate' };
    clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: dropdownMenuState,
    });
    expect(dropdownMenuState).toEqual({
      highlightedValue: 'duplicate',
      open: true,
      value: 'duplicate',
    });
    clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_click_3')(new Event('click'), {
      params: {},
      signal,
      state: dropdownMenuState,
    });
    expect(dropdownMenuState).toEqual({ highlightedValue: 'rename', open: false, value: 'rename' });

    const hoverCardState = { open: false };
    clientHandler(hoverCard, 'GalleryHoverCardDemo$a_pointerenter')(new Event('pointerenter'), {
      params: {},
      signal,
      state: hoverCardState,
    });
    expect(hoverCardState).toEqual({ open: true });
    clientHandler(hoverCard, 'GalleryHoverCardDemo$a_keydown')(
      Object.assign(new Event('keydown'), { key: 'Escape' }),
      {
        params: {},
        signal,
        state: hoverCardState,
      },
    );
    expect(hoverCardState).toEqual({ open: false });
    clientHandler(hoverCard, 'GalleryHoverCardDemo$a_focus')(new Event('focus'), {
      params: {},
      signal,
      state: hoverCardState,
    });
    expect(hoverCardState).toEqual({ open: true });

    const menubarState = { activeValue: 'file', openValue: '', value: 'new' };
    clientHandler(menubar, 'GalleryMenubarDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarState).toEqual({ activeValue: 'edit', openValue: '', value: 'new' });
    clientHandler(menubar, 'GalleryMenubarDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarState).toEqual({ activeValue: 'file', openValue: 'file', value: 'new' });
    const menubarKeyboardEvent = Object.assign(new Event('keydown', { cancelable: true }), {
      key: ' ',
    });
    clientHandler(menubar, 'GalleryMenubarDemo$button_keydown')(menubarKeyboardEvent, {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarKeyboardEvent.defaultPrevented).toBe(true);
    expect(menubarState).toEqual({ activeValue: 'file', openValue: '', value: 'new' });

    const meterState = { dataState: 'suboptimum', value: 72 };
    clientHandler(meter, 'GalleryMeterDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: meterState,
    });
    expect(meterState).toEqual({ dataState: 'optimum', value: 92 });

    const navigationMenuState = { activeValue: 'products', openValue: '', value: 'none' };
    clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(
      keyEvent('ArrowRight'),
      {
        params: {},
        signal,
        state: navigationMenuState,
      },
    );
    expect(navigationMenuState).toEqual({ activeValue: 'docs', openValue: '', value: 'none' });
    const navigationKeyboardEvent = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'Enter',
    });
    navigationMenuState.activeValue = 'products';
    clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(
      navigationKeyboardEvent,
      {
        params: {},
        signal,
        state: navigationMenuState,
      },
    );
    expect(navigationKeyboardEvent.defaultPrevented).toBe(true);
    expect(navigationMenuState).toEqual({
      activeValue: 'products',
      openValue: 'products',
      value: 'none',
    });
    const navigationEscapeEvent = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'Escape',
    });
    clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(
      navigationEscapeEvent,
      {
        params: {},
        signal,
        state: navigationMenuState,
      },
    );
    expect(navigationEscapeEvent.defaultPrevented).toBe(true);
    expect(navigationMenuState).toEqual({
      activeValue: 'products',
      openValue: 'products',
      value: 'escape-canceled',
    });
    navigationMenuState.activeValue = 'docs';
    navigationMenuState.openValue = '';
    navigationMenuState.value = 'none';
    clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: navigationMenuState,
    });
    expect(navigationMenuState).toEqual({
      activeValue: 'docs',
      openValue: 'products',
      value: 'none',
    });

    const numberFieldState = { value: 2 };
    clientHandler(numberField, 'GalleryNumberFieldDemo$input_input')(inputEvent('4'), {
      params: {},
      signal,
      state: numberFieldState,
    });
    expect(numberFieldState).toEqual({ value: 4 });
    clientHandler(numberField, 'GalleryNumberFieldDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: numberFieldState,
    });
    expect(numberFieldState).toEqual({ value: 5 });
    clientHandler(numberField, 'GalleryNumberFieldDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: numberFieldState,
    });
    expect(numberFieldState).toEqual({ value: 4 });
    clientHandler(numberField, 'GalleryNumberFieldDemo$input_keydown')(keyEvent('Home'), {
      params: {},
      signal,
      state: numberFieldState,
    });
    expect(numberFieldState).toEqual({ value: 0 });

    const fieldState = {
      email: 'ada@example',
      invalid: true,
      plan: 'team',
      shippingDisabled: false,
    };
    clientHandler(field, 'GalleryFieldDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@jiso.dev',
      invalid: false,
      plan: 'team',
      shippingDisabled: false,
    });
    clientHandler(field, 'GalleryFieldDemo$select_change')(new Event('change'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@jiso.dev',
      invalid: false,
      plan: 'enterprise',
      shippingDisabled: false,
    });
    clientHandler(field, 'GalleryFieldDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@jiso.dev',
      invalid: false,
      plan: 'enterprise',
      shippingDisabled: true,
    });
    clientHandler(field, 'GalleryFieldDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@jiso.dev',
      invalid: false,
      plan: 'enterprise',
      shippingDisabled: false,
    });

    const otpFieldState = { activeSlot: 2, value: '12' };
    clientHandler(otpField, 'GalleryOtpFieldDemo$input_input')(new Event('input'), {
      params: {},
      signal,
      state: otpFieldState,
    });
    expect(otpFieldState).toEqual({ activeSlot: 3, value: '123' });
    clientHandler(otpField, 'GalleryOtpFieldDemo$input_input_2')(new Event('input'), {
      params: {},
      signal,
      state: otpFieldState,
    });
    expect(otpFieldState).toEqual({ activeSlot: 3, value: '1234' });
    clientHandler(otpField, 'GalleryOtpFieldDemo$input_keydown_2')(new Event('keydown'), {
      params: {},
      signal,
      state: otpFieldState,
    });
    expect(otpFieldState).toEqual({ activeSlot: 1, value: '1' });

    const collapsibleState = { open: false };
    clientHandler(collapsible, 'GalleryCollapsibleDemo$summary_click')(new Event('click'), {
      params: {},
      signal,
      state: collapsibleState,
    });
    expect(collapsibleState).toEqual({ open: true });

    const popoverState = { open: false };
    clientHandler(popover, 'GalleryPopoverDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: popoverState,
    });
    expect(popoverState).toEqual({ open: true });
    clientHandler(popover, 'GalleryPopoverDemo$section_keydown')(keyEvent('ArrowDown'), {
      params: {},
      signal,
      state: popoverState,
    });
    expect(popoverState).toEqual({ open: true });
    clientHandler(popover, 'GalleryPopoverDemo$section_keydown')(keyEvent('Escape'), {
      params: {},
      signal,
      state: popoverState,
    });
    expect(popoverState).toEqual({ open: false });
    clientHandler(popover, 'GalleryPopoverDemo$section_keydown')(new Event('keydown'), {
      params: {},
      signal,
      state: popoverState,
    });
    expect(popoverState).toEqual({ open: false });

    const progressState: { value: number | null } = { value: 40 };
    clientHandler(progress, 'GalleryProgressDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: progressState,
    });
    expect(progressState).toEqual({ value: 100 });
    clientHandler(progress, 'GalleryProgressDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: progressState,
    });
    expect(progressState).toEqual({ value: null });

    const radioGroupState = { value: 'email' };
    clientHandler(radioGroup, 'GalleryRadioGroupDemo$div_keydown')(
      Object.assign(new Event('keydown'), { key: 'ArrowRight' }),
      {
        params: {},
        signal,
        state: radioGroupState,
      },
    );
    expect(radioGroupState).toEqual({ value: 'sms' });
    clientHandler(radioGroup, 'GalleryRadioGroupDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: radioGroupState,
    });
    expect(radioGroupState).toEqual({ value: 'email' });

    const scrollAreaState = { position: 'top' };
    clientHandler(scrollArea, 'GalleryScrollAreaDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: scrollAreaState,
    });
    expect(scrollAreaState).toEqual({ position: 'end' });

    const selectState = { value: 'standard' };
    clientHandler(select, 'GallerySelectDemo$select_change')(changeEvent('express'), {
      params: {},
      signal,
      state: selectState,
    });
    expect(selectState).toEqual({ value: 'express' });
    const disabledSelectEvent = changeEvent('drone');
    clientHandler(select, 'GallerySelectDemo$select_change')(disabledSelectEvent, {
      params: {},
      signal,
      state: selectState,
    });
    expect(selectState).toEqual({ value: 'express' });
    expect(disabledSelectEvent.defaultPrevented).toBe(true);

    const sliderState = { value: 25 };
    clientHandler(slider, 'GallerySliderDemo$input_input')(inputEvent('63'), {
      params: {},
      signal,
      state: sliderState,
    });
    expect(sliderState).toEqual({ value: 75 });

    const switchState = { checked: false };
    clientHandler(switchDemo, 'GallerySwitchDemo$input_click')(new Event('click'), {
      params: {},
      signal,
      state: switchState,
    });
    expect(switchState).toEqual({ checked: true });
    const switchEnterEvent = keyEvent('Enter');
    clientHandler(switchDemo, 'GallerySwitchDemo$input_keydown')(switchEnterEvent, {
      params: {},
      signal,
      state: switchState,
    });
    expect(switchEnterEvent.defaultPrevented).toBe(true);
    expect(switchState).toEqual({ checked: false });

    const tabsState = { activeValue: 'overview', value: 'overview' };
    clientHandler(tabs, 'GalleryTabsDemo$section_keydown')(keyEvent('ArrowRight'), {
      params: {},
      signal,
      state: tabsState,
    });
    expect(tabsState).toEqual({ activeValue: 'details', value: 'overview' });
    clientHandler(tabs, 'GalleryTabsDemo$section_keydown')(keyEvent('Enter'), {
      params: {},
      signal,
      state: tabsState,
    });
    expect(tabsState).toEqual({ activeValue: 'details', value: 'details' });
    clientHandler(tabs, 'GalleryTabsDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: tabsState,
    });
    expect(tabsState).toEqual({ activeValue: 'overview', value: 'overview' });

    const toolbarState = { activeValue: 'bold', pressedValue: 'bold' };
    const toolbarNextEvent = keyEvent('ArrowRight');
    clientHandler(toolbar, 'GalleryToolbarDemo$div_keydown')(toolbarNextEvent, {
      params: {},
      signal,
      state: toolbarState,
    });
    expect(toolbarNextEvent.defaultPrevented).toBe(true);
    expect(toolbarState).toEqual({ activeValue: 'link', pressedValue: 'bold' });
    clientHandler(toolbar, 'GalleryToolbarDemo$div_keydown')(keyEvent('ArrowLeft'), {
      params: {},
      signal,
      state: toolbarState,
    });
    expect(toolbarState).toEqual({ activeValue: 'bold', pressedValue: 'bold' });
    clientHandler(toolbar, 'GalleryToolbarDemo$div_keydown')(keyEvent('End'), {
      params: {},
      signal,
      state: toolbarState,
    });
    expect(toolbarState).toEqual({ activeValue: 'link', pressedValue: 'bold' });
    clientHandler(toolbar, 'GalleryToolbarDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: toolbarState,
    });
    expect(toolbarState).toEqual({ activeValue: 'link', pressedValue: 'link' });

    const tooltipState = { open: false };
    clientHandler(tooltip, 'GalleryTooltipDemo$button_focus')(new Event('focus'), {
      params: {},
      signal,
      state: tooltipState,
    });
    expect(tooltipState).toEqual({ open: true });
    clientHandler(tooltip, 'GalleryTooltipDemo$button_keydown')(
      Object.assign(new Event('keydown'), { key: 'Escape' }),
      {
        params: {},
        signal,
        state: tooltipState,
      },
    );
    expect(tooltipState).toEqual({ open: false });

    const toggleGroupState = { activeValue: 'bold', value: 'bold' };
    const toggleGroupKeyboardEvent = keyEvent('ArrowRight');
    clientHandler(toggleGroup, 'GalleryToggleGroupDemo$section_keydown')(toggleGroupKeyboardEvent, {
      params: {},
      signal,
      state: toggleGroupState,
    });
    expect(toggleGroupKeyboardEvent.defaultPrevented).toBe(true);
    expect(toggleGroupState).toEqual({ activeValue: 'italic', value: 'bold' });
    clientHandler(toggleGroup, 'GalleryToggleGroupDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: toggleGroupState,
    });
    expect(toggleGroupState).toEqual({ activeValue: 'italic', value: 'bold,italic' });

    const toastState = { open: true };
    const canceledToastClick = new Event('click', { cancelable: true });
    clientHandler(toast, 'GalleryToastDemo$button_click_2')(canceledToastClick, {
      params: {},
      signal,
      state: toastState,
    });
    expect(canceledToastClick.defaultPrevented).toBe(true);
    expect(toastState).toEqual({ open: true });
    clientHandler(toast, 'GalleryToastDemo$button_click_3')(new Event('click'), {
      params: {},
      signal,
      state: toastState,
    });
    expect(toastState).toEqual({ open: false });
    toastState.open = true;
    const disabledToastClick = new Event('click', { cancelable: true });
    clientHandler(toast, 'GalleryToastDemo$button_click_4')(disabledToastClick, {
      params: {},
      signal,
      state: toastState,
    });
    expect(disabledToastClick.defaultPrevented).toBe(true);
    expect(toastState).toEqual({ open: true });
  });
});
