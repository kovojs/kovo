import { describe, expect, it } from 'vitest';

import {
  clientHandler,
  element,
  evaluateClientModule,
  fakeDocument,
  keyEvent,
  selector,
} from './interactive-gallery-harness.js';

describe('compiled interactive gallery demos', () => {
  it('updates browser-observable ARIA, focus, visibility, and output contracts', () => {
    const previousDocument = Reflect.get(globalThis, 'document') as unknown;
    const hadDocument = Reflect.has(globalThis, 'document');
    const signal = new AbortController().signal;

    try {
      const document = fakeDocument({
        ids: [
          'gallery-radio-email',
          'gallery-radio-sms',
          'gallery-checkbox-group-updates',
          'gallery-checkbox-group-billing',
          'gallery-dropdown-menu-trigger',
          'gallery-dropdown-menu-content',
          'gallery-dropdown-menu-rename',
          'gallery-menubar-file',
          'gallery-menubar-edit',
          'gallery-menubar-file-menu',
          'gallery-navigation-products-trigger',
          'gallery-navigation-docs-link',
          'gallery-navigation-products-content',
          'gallery-navigation-viewport',
          'gallery-scroll-area-toggle',
          'gallery-scroll-area-thumb',
          'gallery-scroll-area-viewport',
          'gallery-command-input',
          'gallery-command-listbox-item-1',
          'gallery-command-dialog',
          'gallery-toolbar-bold',
          'gallery-toolbar-link',
          'gallery-toggle-group-bold',
          'gallery-toggle-group-italic',
          'gallery-toast',
        ],
        selectors: [
          '[data-demo-state="radio-value"]',
          '[data-demo-state="checkbox-group-value"]',
          '[data-demo-state="dropdown-open"]',
          '[data-demo-state="dropdown-value"]',
          '[data-demo-state="menubar-active"]',
          '[data-demo-state="menubar-open"]',
          '[data-demo-state="menubar-value"]',
          '[data-demo-state="navigation-open"]',
          '[data-demo-state="navigation-value"]',
          '[data-demo-state="scroll-area-position"]',
          '[data-demo-state="command-input"]',
          '[data-demo-state="command-key-canceled"]',
          '[data-demo-state="command-value"]',
          '[data-demo-state="toolbar-active"]',
          '[data-demo-state="toolbar-pressed"]',
          '[data-demo-state="toggle-group-value"]',
          '[data-demo-state="toast-open"]',
        ],
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: document,
      });

      const radioGroup = evaluateClientModule('radio-group-demo.client.js', { document });
      const radioState = { value: 'email' };
      clientHandler(radioGroup, 'GalleryRadioGroupDemo$div_keydown')(new Event('keydown'), {
        params: {},
        signal,
        state: radioState,
      });
      expect(radioState).toEqual({ value: 'sms' });
      expect(element(document, 'gallery-radio-email')).toMatchObject({
        checked: false,
        tabIndex: -1,
      });
      expect(element(document, 'gallery-radio-email').attrs['aria-checked']).toBe('false');
      expect(element(document, 'gallery-radio-sms')).toMatchObject({ checked: true, tabIndex: 0 });
      expect(selector(document, '[data-demo-state="radio-value"]').textContent).toBe('sms');

      const checkboxGroup = evaluateClientModule('checkbox-group-demo.client.js', { document });
      const checkboxState = { activeValue: 'updates', value: 'updates' };
      clientHandler(checkboxGroup, 'GalleryCheckboxGroupDemo$input_click_2')(new Event('click'), {
        params: {},
        signal,
        state: checkboxState,
      });
      expect(checkboxState).toEqual({ activeValue: 'updates', value: 'updates,billing' });
      expect(element(document, 'gallery-checkbox-group-billing')).toMatchObject({
        checked: true,
      });
      expect(element(document, 'gallery-checkbox-group-billing').attrs).toMatchObject({
        'aria-checked': 'true',
        'data-state': 'checked',
      });
      expect(selector(document, '[data-demo-state="checkbox-group-value"]').textContent).toBe(
        'updates,billing',
      );

      const dropdownMenu = evaluateClientModule('dropdown-menu-demo.client.js', { document });
      const dropdownState = { highlightedValue: 'duplicate', open: false, value: 'duplicate' };
      clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: dropdownState,
      });
      expect(element(document, 'gallery-dropdown-menu-trigger').attrs['aria-expanded']).toBe(
        'true',
      );
      expect(element(document, 'gallery-dropdown-menu-content').hidden).toBe(false);
      expect(selector(document, '[data-demo-state="dropdown-open"]').textContent).toBe('open');
      const dropdownKeyboardEvent = Object.assign(new Event('keydown', { cancelable: true }), {
        key: 'Enter',
      });
      clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_keydown')(dropdownKeyboardEvent, {
        params: {},
        signal,
        state: dropdownState,
      });
      expect(dropdownKeyboardEvent.defaultPrevented).toBe(true);
      expect(element(document, 'gallery-dropdown-menu-content').hidden).toBe(true);
      expect(element(document, 'gallery-dropdown-menu-rename').attrs['data-highlighted']).toBe('');
      expect(selector(document, '[data-demo-state="dropdown-value"]').textContent).toBe('rename');

      dropdownState.open = true;
      element(document, 'gallery-dropdown-menu-content').hidden = false;
      clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_click_3')(new Event('click'), {
        params: {},
        signal,
        state: dropdownState,
      });
      expect(element(document, 'gallery-dropdown-menu-content').hidden).toBe(true);
      expect(element(document, 'gallery-dropdown-menu-rename').attrs['data-highlighted']).toBe('');
      expect(selector(document, '[data-demo-state="dropdown-value"]').textContent).toBe('rename');

      const menubar = evaluateClientModule('menubar-demo.client.js', { document });
      const menubarState = { activeValue: 'file', openValue: '', value: 'new' };
      clientHandler(menubar, 'GalleryMenubarDemo$section_keydown')(new Event('keydown'), {
        params: {},
        signal,
        state: menubarState,
      });
      expect(element(document, 'gallery-menubar-file').tabIndex).toBe(-1);
      expect(element(document, 'gallery-menubar-edit').tabIndex).toBe(0);
      expect(selector(document, '[data-demo-state="menubar-active"]').textContent).toBe('edit');
      clientHandler(menubar, 'GalleryMenubarDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: menubarState,
      });
      expect(element(document, 'gallery-menubar-file').attrs['aria-expanded']).toBe('true');
      expect(element(document, 'gallery-menubar-file-menu').hidden).toBe(false);
      expect(selector(document, '[data-demo-state="menubar-open"]').textContent).toBe('file');
      const menubarKeyEvent = Object.assign(new Event('keydown', { cancelable: true }), {
        key: 'Enter',
      });
      clientHandler(menubar, 'GalleryMenubarDemo$button_keydown')(menubarKeyEvent, {
        params: {},
        signal,
        state: menubarState,
      });
      expect(menubarKeyEvent.defaultPrevented).toBe(true);
      expect(element(document, 'gallery-menubar-file').attrs['aria-expanded']).toBe('false');
      expect(element(document, 'gallery-menubar-file-menu').hidden).toBe(true);
      expect(selector(document, '[data-demo-state="menubar-open"]').textContent).toBe('none');
      expect(selector(document, '[data-demo-state="menubar-value"]').textContent).toBe('new');

      const navigationMenu = evaluateClientModule('navigation-menu-demo.client.js', { document });
      const navigationState = { activeValue: 'products', openValue: '', value: 'none' };
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(
        keyEvent('ArrowRight'),
        { params: {}, signal, state: navigationState },
      );
      expect(element(document, 'gallery-navigation-products-trigger').tabIndex).toBe(-1);
      expect(element(document, 'gallery-navigation-docs-link').tabIndex).toBe(0);
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: navigationState,
      });
      expect(element(document, 'gallery-navigation-products-trigger').attrs['aria-expanded']).toBe(
        'true',
      );
      expect(element(document, 'gallery-navigation-products-content').hidden).toBe(false);
      expect(element(document, 'gallery-navigation-viewport').hidden).toBe(false);
      expect(selector(document, '[data-demo-state="navigation-open"]').textContent).toBe(
        'products',
      );
      const navEscape = Object.assign(new Event('keydown', { cancelable: true }), {
        key: 'Escape',
      });
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(navEscape, {
        params: {},
        signal,
        state: navigationState,
      });
      expect(navEscape.defaultPrevented).toBe(true);
      expect(element(document, 'gallery-navigation-products-trigger').attrs['aria-expanded']).toBe(
        'true',
      );
      expect(element(document, 'gallery-navigation-products-content').hidden).toBe(false);
      expect(selector(document, '[data-demo-state="navigation-open"]').textContent).toBe(
        'products',
      );
      expect(selector(document, '[data-demo-state="navigation-value"]').textContent).toBe(
        'escape-canceled',
      );
      const navClick = new Event('click', { cancelable: true });
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$a_click')(navClick, {
        params: {},
        signal,
        state: navigationState,
      });
      expect(navClick.defaultPrevented).toBe(true);
      expect(selector(document, '[data-demo-state="navigation-value"]').textContent).toBe('docs');

      const scrollArea = evaluateClientModule('scroll-area-demo.client.js', { document });
      const scrollAreaState = { position: 'top' };
      clientHandler(scrollArea, 'GalleryScrollAreaDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: scrollAreaState,
      });
      expect(scrollAreaState).toEqual({ position: 'end' });
      expect(element(document, 'gallery-scroll-area-viewport')).toMatchObject({
        scrollTop: 160,
      });
      expect(element(document, 'gallery-scroll-area-viewport').attrs['data-scroll-y']).toBe('end');
      expect(element(document, 'gallery-scroll-area-thumb').attrs['data-scroll-position']).toBe(
        'end',
      );
      expect(element(document, 'gallery-scroll-area-toggle').attrs['aria-pressed']).toBe('true');
      expect(selector(document, '[data-demo-state="scroll-area-position"]').textContent).toBe(
        'end',
      );

      const command = evaluateClientModule('command-demo.client.js', { document });
      const commandState = {
        highlightedValue: 'dashboard',
        inputValue: '',
        lastKeyAction: 'idle',
        open: false,
        value: 'dashboard',
      };
      clientHandler(command, 'GalleryCommandDemo$input_input')(new Event('input'), {
        params: {},
        signal,
        state: commandState,
      });
      expect(element(document, 'gallery-command-input')).toMatchObject({ value: 'invite' });
      expect(element(document, 'gallery-command-input').attrs['aria-activedescendant']).toBe(
        'gallery-command-listbox-item-1',
      );
      expect(element(document, 'gallery-command-listbox-item-1').attrs['aria-selected']).toBe(
        'true',
      );
      expect(selector(document, '[data-demo-state="command-input"]').textContent).toBe('invite');
      const commandEnter = keyEvent('Enter');
      clientHandler(command, 'GalleryCommandDemo$input_keydown')(commandEnter, {
        params: {},
        signal,
        state: commandState,
      });
      expect(commandEnter.defaultPrevented).toBe(true);
      expect(commandState).toEqual({
        highlightedValue: 'invite',
        inputValue: 'invite',
        lastKeyAction: 'canceled',
        open: true,
        value: 'dashboard',
      });
      expect(element(document, 'gallery-command-dialog').closeCalls).toBe(0);
      expect(selector(document, '[data-demo-state="command-key-canceled"]').textContent).toBe(
        'canceled',
      );
      expect(selector(document, '[data-demo-state="command-value"]').textContent).toBe(
        'Open dashboard',
      );
      commandState.open = true;
      clientHandler(command, 'GalleryCommandDemo$button_click_2')(new Event('click'), {
        params: {},
        signal,
        state: commandState,
      });
      expect(element(document, 'gallery-command-dialog').closeCalls).toBe(1);
      expect(selector(document, '[data-demo-state="command-value"]').textContent).toBe(
        'Invite teammate',
      );

      const toolbar = evaluateClientModule('toolbar-demo.client.js', { document });
      const toolbarState = { activeValue: 'bold', pressedValue: 'bold' };
      clientHandler(toolbar, 'GalleryToolbarDemo$div_keydown')(new Event('keydown'), {
        params: {},
        signal,
        state: toolbarState,
      });
      expect(element(document, 'gallery-toolbar-bold').tabIndex).toBe(-1);
      expect(element(document, 'gallery-toolbar-link').tabIndex).toBe(0);
      expect(element(document, 'gallery-toolbar-link').focusCalls).toBe(1);
      expect(selector(document, '[data-demo-state="toolbar-active"]').textContent).toBe('link');
      clientHandler(toolbar, 'GalleryToolbarDemo$button_click_2')(new Event('click'), {
        params: {},
        signal,
        state: toolbarState,
      });
      expect(element(document, 'gallery-toolbar-link').attrs['aria-pressed']).toBe('true');
      expect(selector(document, '[data-demo-state="toolbar-pressed"]').textContent).toBe('link');

      const toggleGroup = evaluateClientModule('toggle-group-demo.client.js', { document });
      const toggleGroupState = { activeValue: 'bold', value: 'bold' };
      clientHandler(toggleGroup, 'GalleryToggleGroupDemo$button_click_2')(new Event('click'), {
        params: {},
        signal,
        state: toggleGroupState,
      });
      expect(element(document, 'gallery-toggle-group-bold').attrs).toMatchObject({
        'aria-pressed': 'true',
        'data-state': 'pressed',
      });
      expect(element(document, 'gallery-toggle-group-italic').attrs).toMatchObject({
        'aria-pressed': 'true',
        'data-state': 'pressed',
      });
      expect(selector(document, '[data-demo-state="toggle-group-value"]').textContent).toBe(
        'bold,italic',
      );

      const toast = evaluateClientModule('toast-demo.client.js', { document });
      const toastState = { open: true };
      const canceledToastClick = new Event('click', { cancelable: true });
      clientHandler(toast, 'GalleryToastDemo$button_click_2')(canceledToastClick, {
        params: {},
        signal,
        state: toastState,
      });
      expect(canceledToastClick.defaultPrevented).toBe(true);
      expect(toastState).toEqual({ open: true });
      expect(element(document, 'gallery-toast').hidden).toBe(false);
      expect(element(document, 'gallery-toast').attrs['data-state']).toBe('open');
      clientHandler(toast, 'GalleryToastDemo$section_keydown')(
        Object.assign(new Event('keydown'), { key: 'Enter' }),
        { params: {}, signal, state: toastState },
      );
      expect(toastState).toEqual({ open: true });
      clientHandler(toast, 'GalleryToastDemo$section_keydown')(
        Object.assign(new Event('keydown'), { key: 'Escape' }),
        { params: {}, signal, state: toastState },
      );
      expect(element(document, 'gallery-toast').hidden).toBe(true);
      expect(element(document, 'gallery-toast').attrs['data-state']).toBe('closed');
      toastState.open = true;
      const disabledToastClick = new Event('click', { cancelable: true });
      clientHandler(toast, 'GalleryToastDemo$button_click_4')(disabledToastClick, {
        params: {},
        signal,
        state: toastState,
      });
      expect(disabledToastClick.defaultPrevented).toBe(true);
      expect(toastState).toEqual({ open: true });
    } finally {
      if (hadDocument) {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
    }
  });
});
