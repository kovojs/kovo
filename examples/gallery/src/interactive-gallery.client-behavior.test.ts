import { describe, expect, it } from 'vitest';

import {
  asyncClientHandler,
  changeEvent,
  clientHandler,
  evaluateClientModule,
  inputEvent,
  keyEvent,
} from './interactive-gallery-harness.js';

describe('compiled interactive gallery demos', () => {
  it('executes generated client behavior for the stateful demos', async () => {
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
        selector === '#gallery-accordion-billing-trigger' ? billingTrigger : undefined,
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
    clientHandler(autocomplete, 'GalleryAutocompleteDemo$input_input')(inputEvent('dev'), {
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
    clientHandler(autocomplete, 'GalleryAutocompleteDemo$button_click_2')(new Event('click'), {
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

    const comboboxState = {
      highlightedValue: 'austin',
      inputValue: 'austin',
      open: false,
      value: 'austin',
    };
    clientHandler(combobox, 'GalleryComboboxDemo$input_input')(inputEvent('chi'), {
      params: {},
      signal,
      state: comboboxState,
    });
    expect(comboboxState).toEqual({
      highlightedValue: 'chicago',
      inputValue: 'chi',
      open: true,
      value: 'austin',
    });
    clientHandler(combobox, 'GalleryComboboxDemo$input_keydown')(keyEvent('Enter'), {
      params: {},
      signal,
      state: comboboxState,
    });
    expect(comboboxState).toEqual({
      highlightedValue: 'chicago',
      inputValue: 'chicago',
      open: false,
      value: 'chicago',
    });
    clientHandler(combobox, 'GalleryComboboxDemo$button_click')(new Event('click'), {
      params: { value: 'austin' },
      signal,
      state: comboboxState,
    });
    expect(comboboxState).toEqual({
      highlightedValue: 'austin',
      inputValue: 'austin',
      open: false,
      value: 'austin',
    });

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
    clientHandler(command, 'GalleryCommandDemo$input_input')(inputEvent('invite'), {
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
      lastKeyAction: 'selected',
      open: false,
      value: 'invite',
    });
    commandState.open = true;
    commandState.value = 'dashboard';
    clientHandler(command, 'GalleryCommandDemo$button_click_3')(new Event('click'), {
      params: {},
      signal,
      state: commandState,
    });
    expect(commandState).toEqual({
      highlightedValue: 'invite',
      inputValue: 'invite',
      lastKeyAction: 'selected',
      open: false,
      value: 'invite',
    });

    const contextMenuState = {
      highlightedValue: 'copy',
      open: false,
      point: { x: 24, y: 40 },
      value: 'copy',
    };
    const contextOpenEvent = Object.assign(new Event('contextmenu', { cancelable: true }), {
      clientX: 80,
      clientY: 120,
    });
    clientHandler(contextMenu, 'GalleryContextMenuDemo$div_contextmenu')(contextOpenEvent, {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextMenuState).toEqual({
      highlightedValue: 'copy',
      open: true,
      point: { x: 80, y: 120 },
      value: 'copy',
    });
    expect(contextOpenEvent.defaultPrevented).toBe(true);

    const contextMoveEvent = keyEvent('ArrowDown');
    clientHandler(contextMenu, 'GalleryContextMenuDemo$button_keydown')(contextMoveEvent, {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextMoveEvent.defaultPrevented).toBe(true);
    expect(contextMenuState).toEqual({
      highlightedValue: 'inspect',
      open: true,
      point: { x: 80, y: 120 },
      value: 'copy',
    });

    const contextTypeaheadEvent = keyEvent('c');
    clientHandler(contextMenu, 'GalleryContextMenuDemo$button_keydown_2')(contextTypeaheadEvent, {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextTypeaheadEvent.defaultPrevented).toBe(true);
    expect(contextMenuState).toEqual({
      highlightedValue: 'copy',
      open: true,
      point: { x: 80, y: 120 },
      value: 'copy',
    });

    const contextEscapeEvent = keyEvent('Escape');
    clientHandler(contextMenu, 'GalleryContextMenuDemo$button_keydown')(contextEscapeEvent, {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextEscapeEvent.defaultPrevented).toBe(true);
    expect(contextMenuState).toEqual({
      highlightedValue: 'copy',
      open: false,
      point: { x: 80, y: 120 },
      value: 'copy',
    });

    const contextTriggerKeyEvent = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'F10',
      shiftKey: true,
    });
    clientHandler(contextMenu, 'GalleryContextMenuDemo$div_keydown')(contextTriggerKeyEvent, {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextTriggerKeyEvent.defaultPrevented).toBe(true);
    expect(contextMenuState).toEqual({
      highlightedValue: 'copy',
      open: true,
      point: { x: 80, y: 120 },
      value: 'copy',
    });

    clientHandler(contextMenu, 'GalleryContextMenuDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: contextMenuState,
    });
    expect(contextMenuState).toEqual({
      highlightedValue: 'inspect',
      open: false,
      point: { x: 80, y: 120 },
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
    const dropdownMoveEvent = keyEvent('ArrowDown');
    clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_keydown_2')(dropdownMoveEvent, {
      params: {},
      signal,
      state: dropdownMenuState,
    });
    expect(dropdownMoveEvent.defaultPrevented).toBe(true);
    expect(dropdownMenuState).toEqual({
      highlightedValue: 'rename',
      open: true,
      value: 'duplicate',
    });
    const dropdownTypeaheadEvent = keyEvent('d');
    clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_keydown_3')(
      dropdownTypeaheadEvent,
      {
        params: {},
        signal,
        state: dropdownMenuState,
      },
    );
    expect(dropdownTypeaheadEvent.defaultPrevented).toBe(true);
    expect(dropdownMenuState).toEqual({
      highlightedValue: 'duplicate',
      open: true,
      value: 'duplicate',
    });
    const dropdownEscapeEvent = keyEvent('Escape');
    clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_keydown_2')(dropdownEscapeEvent, {
      params: {},
      signal,
      state: dropdownMenuState,
    });
    expect(dropdownEscapeEvent.defaultPrevented).toBe(true);
    expect(dropdownMenuState).toEqual({
      highlightedValue: 'duplicate',
      open: false,
      value: 'duplicate',
    });
    const dropdownTriggerKeyEvent = keyEvent('ArrowUp');
    clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_keydown')(dropdownTriggerKeyEvent, {
      params: {},
      signal,
      state: dropdownMenuState,
    });
    expect(dropdownTriggerKeyEvent.defaultPrevented).toBe(true);
    expect(dropdownMenuState).toEqual({
      highlightedValue: 'rename',
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
    clientHandler(hoverCard, 'GalleryHoverCardDemo$aside_pointerenter')(new Event('pointerenter'), {
      params: {},
      signal,
      state: hoverCardState,
    });
    expect(hoverCardState).toEqual({ open: true });
    clientHandler(hoverCard, 'GalleryHoverCardDemo$aside_pointerleave')(new Event('pointerleave'), {
      params: {},
      signal,
      state: hoverCardState,
    });
    expect(hoverCardState).toEqual({ open: false });
    hoverCardState.open = true;
    await asyncClientHandler(hoverCard, 'GalleryHoverCardDemo$a_pointerleave')(
      new Event('pointerleave'),
      {
        params: {},
        signal,
        state: hoverCardState,
      },
    );
    expect(hoverCardState).toEqual({ open: false });

    const menubarState = { activeValue: 'file', openValue: '', value: 'new' };
    const menubarMoveEvent = keyEvent('ArrowRight');
    clientHandler(menubar, 'GalleryMenubarDemo$section_keydown')(menubarMoveEvent, {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarMoveEvent.defaultPrevented).toBe(true);
    expect(menubarState).toEqual({ activeValue: 'edit', openValue: '', value: 'new' });
    clientHandler(menubar, 'GalleryMenubarDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarState).toEqual({ activeValue: 'new', openValue: 'file', value: 'new' });
    const menubarEscapeEvent = keyEvent('Escape');
    clientHandler(menubar, 'GalleryMenubarDemo$button_keydown_2')(menubarEscapeEvent, {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarEscapeEvent.defaultPrevented).toBe(true);
    expect(menubarState).toEqual({ activeValue: 'file', openValue: '', value: 'new' });
    const menubarKeyboardOpenEvent = keyEvent('Enter');
    clientHandler(menubar, 'GalleryMenubarDemo$button_keydown')(menubarKeyboardOpenEvent, {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarKeyboardOpenEvent.defaultPrevented).toBe(true);
    expect(menubarState).toEqual({ activeValue: 'new', openValue: 'file', value: 'new' });
    const menubarSelectEvent = keyEvent(' ');
    clientHandler(menubar, 'GalleryMenubarDemo$button_keydown_2')(menubarSelectEvent, {
      params: {},
      signal,
      state: menubarState,
    });
    expect(menubarSelectEvent.defaultPrevented).toBe(true);
    expect(menubarState).toEqual({ activeValue: 'file', openValue: '', value: 'new' });

    // Meter demo thresholds were retuned so the default 72% reads as `optimum`
    // (green) instead of the old alarming brown; the toggle now drops to 30%
    // (below `low`, so `suboptimum`) and back.
    const meterState = { dataState: 'optimum', value: 72 };
    clientHandler(meter, 'GalleryMeterDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: meterState,
    });
    expect(meterState).toEqual({ dataState: 'suboptimum', value: 30 });

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
      openValue: '',
      value: 'none',
    });
    clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$button_pointerenter')(
      new Event('pointerenter'),
      {
        params: {},
        signal,
        state: navigationMenuState,
      },
    );
    expect(navigationMenuState).toEqual({
      activeValue: 'products',
      openValue: 'products',
      value: 'none',
    });
    const navigationMoveToDocsEvent = keyEvent('ArrowRight');
    clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(
      navigationMoveToDocsEvent,
      {
        params: {},
        signal,
        state: navigationMenuState,
      },
    );
    expect(navigationMoveToDocsEvent.defaultPrevented).toBe(true);
    expect(navigationMenuState).toEqual({
      activeValue: 'docs',
      openValue: '',
      value: 'none',
    });
    const navigationClickEvent = new Event('click', { cancelable: true });
    clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$a_click')(navigationClickEvent, {
      params: {},
      signal,
      state: navigationMenuState,
    });
    expect(navigationClickEvent.defaultPrevented).toBe(true);
    expect(navigationMenuState).toEqual({
      activeValue: 'docs',
      openValue: '',
      value: 'docs',
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
    clientHandler(field, 'GalleryFieldDemo$input_input')(inputEvent('ada@kovo.sh'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@kovo.sh',
      invalid: false,
      plan: 'team',
      shippingDisabled: false,
    });
    clientHandler(field, 'GalleryFieldDemo$select_change')(changeEvent('enterprise'), {
      params: {},
      signal,
      state: fieldState,
    });
    expect(fieldState).toEqual({
      email: 'ada@kovo.sh',
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
      email: 'ada@kovo.sh',
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
      email: 'ada@kovo.sh',
      invalid: false,
      plan: 'enterprise',
      shippingDisabled: false,
    });

    const otpFieldState = { activeSlot: 2, value: '12' };
    clientHandler(otpField, 'GalleryOtpFieldDemo$input_input_3')(inputEvent('3'), {
      params: {},
      signal,
      state: otpFieldState,
    });
    expect(otpFieldState).toEqual({ activeSlot: 3, value: '123' });
    clientHandler(otpField, 'GalleryOtpFieldDemo$input_input_4')(inputEvent('4'), {
      params: {},
      signal,
      state: otpFieldState,
    });
    expect(otpFieldState).toEqual({ activeSlot: 3, value: '1234' });
    const otpDeleteState = { activeSlot: 1, value: '12' };
    clientHandler(otpField, 'GalleryOtpFieldDemo$input_keydown_2')(keyEvent('Backspace'), {
      params: {},
      signal,
      state: otpDeleteState,
    });
    expect(otpDeleteState).toEqual({ activeSlot: 1, value: '1' });

    const collapsibleState = { open: false };
    clientHandler(collapsible, 'GalleryCollapsibleDemo$summary_click')(new Event('click'), {
      params: {},
      signal,
      state: collapsibleState,
    });
    expect(collapsibleState).toEqual({ open: true });

    const popoverState = { open: false };
    clientHandler(popover, 'GalleryPopoverDemo$div_beforetoggle')(
      Object.assign(new Event('beforetoggle'), { newState: 'open' }),
      {
        params: {},
        signal,
        state: popoverState,
      },
    );
    expect(popoverState).toEqual({ open: true });
    clientHandler(popover, 'GalleryPopoverDemo$div_beforetoggle')(
      Object.assign(new Event('beforetoggle'), { newState: 'closed' }),
      {
        params: {},
        signal,
        state: popoverState,
      },
    );
    expect(popoverState).toEqual({ open: false });
    clientHandler(popover, 'GalleryPopoverDemo$div_beforetoggle')(
      Object.assign(new Event('beforetoggle'), { newState: undefined }),
      {
        params: {},
        signal,
        state: popoverState,
      },
    );
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

    const scrollAreaState = {
      dragging: false,
      dragPointerStart: 0,
      dragScrollTop: 0,
      dragThumbSize: 28,
      dragTrackSize: 72,
      hasOverflowY: true,
      hovering: false,
      scrolling: false,
      scrollTop: 0,
      scrollY: 'start',
      thumbOffset: 0,
      thumbSize: 28,
      verticalVisible: true,
    };
    clientHandler(scrollArea, 'GalleryScrollAreaDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: scrollAreaState,
    });
    expect(scrollAreaState).toEqual({
      dragging: false,
      dragPointerStart: 0,
      dragScrollTop: 0,
      dragThumbSize: 28,
      dragTrackSize: 72,
      hasOverflowY: true,
      hovering: false,
      scrolling: true,
      scrollTop: 1000000,
      scrollY: 'end',
      thumbOffset: 100,
      thumbSize: 28,
      verticalVisible: true,
    });
    const scrollEvent = new Event('scroll');
    Object.defineProperty(scrollEvent, 'target', {
      value: {
        clientHeight: 100,
        clientWidth: 100,
        scrollHeight: 300,
        scrollLeft: 0,
        scrollTop: 100,
        scrollWidth: 100,
      },
    });
    clientHandler(scrollArea, 'GalleryScrollAreaDemo$div_scroll')(scrollEvent, {
      params: {},
      signal,
      state: scrollAreaState,
    });
    expect(scrollAreaState).toEqual({
      dragging: false,
      dragPointerStart: 0,
      dragScrollTop: 0,
      dragThumbSize: 28,
      dragTrackSize: 72,
      hasOverflowY: true,
      hovering: false,
      scrolling: true,
      scrollTop: 100,
      scrollY: 'middle',
      thumbOffset: 50,
      thumbSize: 33.33333333333333,
      verticalVisible: true,
    });
    scrollAreaState.scrollTop = 0;
    scrollAreaState.scrollY = 'start';
    scrollAreaState.thumbOffset = 0;
    clientHandler(scrollArea, 'GalleryScrollAreaDemo$div_pointerdown')(
      pointerEvent('pointerdown', {
        offsetY: 72,
        target: { clientHeight: 72 },
      }),
      {
        params: {},
        signal,
        state: scrollAreaState,
      },
    );
    expect(scrollAreaState).toMatchObject({
      hasOverflowY: true,
      scrolling: true,
      scrollTop: 188,
      scrollY: 'end',
      thumbOffset: 100,
      verticalVisible: true,
    });

    scrollAreaState.scrollTop = 0;
    scrollAreaState.scrollY = 'start';
    scrollAreaState.thumbOffset = 0;
    clientHandler(scrollArea, 'GalleryScrollAreaDemo$span_pointerdown')(
      pointerEvent('pointerdown', {
        clientY: 10,
        target: {
          clientHeight: 20,
          parentElement: { clientHeight: 72 },
        },
      }),
      {
        params: {},
        signal,
        state: scrollAreaState,
      },
    );
    expect(scrollAreaState).toMatchObject({
      dragging: true,
      dragPointerStart: 10,
      dragScrollTop: 0,
      dragThumbSize: 20,
      dragTrackSize: 72,
      scrolling: true,
    });
    clientHandler(scrollArea, 'GalleryScrollAreaDemo$span_pointermove')(
      pointerEvent('pointermove', { clientY: 40 }),
      {
        params: {},
        signal,
        state: scrollAreaState,
      },
    );
    expect(scrollAreaState).toMatchObject({
      dragging: true,
      scrollY: 'middle',
      verticalVisible: true,
    });
    clientHandler(scrollArea, 'GalleryScrollAreaDemo$span_pointerup')(new Event('pointerup'), {
      params: {},
      signal,
      state: scrollAreaState,
    });
    expect(scrollAreaState.dragging).toBe(false);
    expect(scrollAreaState.scrolling).toBe(false);

    const selectState = { highlightedValue: 'standard', open: false, value: 'standard' };
    clientHandler(select, 'GallerySelectDemo$button_click')(
      new Event('click', { cancelable: true }),
      {
        params: {},
        signal,
        state: selectState,
      },
    );
    expect(selectState).toEqual({ highlightedValue: 'standard', open: true, value: 'standard' });
    const selectArrowDown = keyEvent('ArrowDown');
    clientHandler(select, 'GallerySelectDemo$button_keydown')(selectArrowDown, {
      params: {},
      signal,
      state: selectState,
    });
    expect(selectArrowDown.defaultPrevented).toBe(true);
    expect(selectState).toEqual({ highlightedValue: 'express', open: true, value: 'standard' });
    const selectEnter = keyEvent('Enter');
    clientHandler(select, 'GallerySelectDemo$button_keydown')(selectEnter, {
      params: {},
      signal,
      state: selectState,
    });
    expect(selectEnter.defaultPrevented).toBe(true);
    expect(selectState).toEqual({ highlightedValue: 'express', open: false, value: 'express' });
    selectState.open = true;
    const disabledSelectEvent = new Event('click', { cancelable: true });
    clientHandler(select, 'GallerySelectDemo$div_click_3')(disabledSelectEvent, {
      params: {},
      signal,
      state: selectState,
    });
    expect(selectState).toEqual({ highlightedValue: 'express', open: true, value: 'express' });
    expect(disabledSelectEvent.defaultPrevented).toBe(true);

    const sliderState = {
      dragging: false,
      dragPointerStart: 0,
      dragValueStart: 25,
      value: 25,
    };
    clientHandler(slider, 'GallerySliderDemo$div_pointerdown')(
      pointerEvent('pointerdown', {
        offsetX: 150,
        target: { clientWidth: 200 },
      }),
      {
        params: {},
        signal,
        state: sliderState,
      },
    );
    expect(sliderState).toEqual({
      dragging: false,
      dragPointerStart: 0,
      dragValueStart: 25,
      value: 75,
    });
    const sliderKeyDown = keyEvent('ArrowLeft');
    clientHandler(slider, 'GallerySliderDemo$span_keydown')(sliderKeyDown, {
      params: {},
      signal,
      state: sliderState,
    });
    expect(sliderKeyDown.defaultPrevented).toBe(true);
    expect(sliderState.value).toBe(50);
    clientHandler(slider, 'GallerySliderDemo$span_pointerdown')(
      pointerEvent('pointerdown', { clientX: 20 }),
      {
        params: {},
        signal,
        state: sliderState,
      },
    );
    expect(sliderState).toMatchObject({
      dragging: true,
      dragPointerStart: 20,
      dragValueStart: 50,
    });
    clientHandler(slider, 'GallerySliderDemo$span_pointermove')(
      pointerEvent('pointermove', {
        clientX: 120,
        target: { parentElement: { clientWidth: 200 } },
      }),
      {
        params: {},
        signal,
        state: sliderState,
      },
    );
    expect(sliderState.value).toBe(100);
    clientHandler(slider, 'GallerySliderDemo$span_pointerup')(new Event('pointerup'), {
      params: {},
      signal,
      state: sliderState,
    });
    expect(sliderState.dragging).toBe(false);

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

    const toastState = { activeCount: 0, activeOpen: false, previousCount: 0, previousOpen: false };
    clientHandler(toast, 'GalleryToastDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: toastState,
    });
    expect(toastState).toEqual({
      activeCount: 1,
      activeOpen: true,
      previousCount: 0,
      previousOpen: false,
    });
    clientHandler(toast, 'GalleryToastDemo$button_click')(new Event('click'), {
      params: {},
      signal,
      state: toastState,
    });
    expect(toastState).toEqual({
      activeCount: 2,
      activeOpen: true,
      previousCount: 1,
      previousOpen: true,
    });
    const timeoutEvent = animationEvent('gallery-toast-auto-dismiss');
    clientHandler(toast, 'GalleryToastDemo$div_animationend')(timeoutEvent, {
      params: {},
      signal,
      state: toastState,
    });
    expect(toastState).toEqual({
      activeCount: 2,
      activeOpen: false,
      previousCount: 1,
      previousOpen: true,
    });
    clientHandler(toast, 'GalleryToastDemo$button_click_2')(new Event('click'), {
      params: {},
      signal,
      state: toastState,
    });
    expect(toastState).toEqual({
      activeCount: 2,
      activeOpen: false,
      previousCount: 1,
      previousOpen: false,
    });
    toastState.activeOpen = true;
    const disabledToastClick = new Event('click', { cancelable: true });
    clientHandler(toast, 'GalleryToastDemo$button_click_6')(disabledToastClick, {
      params: {},
      signal,
      state: toastState,
    });
    expect(disabledToastClick.defaultPrevented).toBe(true);
    expect(toastState.activeOpen).toBe(true);
  });
});

function pointerEvent(
  type: string,
  options: {
    clientX?: number;
    clientY?: number;
    offsetX?: number;
    offsetY?: number;
    target?: unknown;
  },
): Event {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(options)) {
    Object.defineProperty(event, key, {
      configurable: true,
      value,
    });
  }
  return event;
}

function animationEvent(animationName: string): Event {
  const event = new Event('animationend', { cancelable: true });
  Object.defineProperty(event, 'animationName', { value: animationName });
  return event;
}
