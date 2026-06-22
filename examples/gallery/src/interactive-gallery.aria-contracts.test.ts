import { describe, expect, it } from 'vitest';

import {
  clientHandler,
  evaluateClientModule,
  fakeDocument,
  inputEvent,
  keyEvent,
  resolveGeneratedBindingName,
} from './interactive-gallery-harness.js';

function deriveRun(exports: Record<string, unknown>, name: string, state: unknown): unknown {
  const resolvedName = resolveGeneratedBindingName(exports, name);
  const derive = exports[resolvedName] as { run(value: unknown): unknown } | undefined;
  if (derive === undefined) throw new Error(`Missing generated derive export: ${name}`);

  return derive.run(state);
}

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
      clientHandler(radioGroup, 'GalleryRadioGroupDemo$div_keydown')(
        Object.assign(new Event('keydown'), { key: 'ArrowRight' }),
        {
          params: {},
          signal,
          state: radioState,
        },
      );
      expect(radioState).toEqual({ value: 'sms' });

      const checkboxGroup = evaluateClientModule('checkbox-group-demo.client.js', { document });
      const checkboxState = { activeValue: 'updates', value: 'updates' };
      // C unblock: the select-all is now the styled `Checkbox`; the per-item
      // controls are `CheckboxGroupControl`. Click the billing item control.
      clientHandler(checkboxGroup, 'GalleryCheckboxGroupDemo$CheckboxGroupControl_click_2')(
        new Event('click'),
        {
          params: {},
          signal,
          state: checkboxState,
        },
      );
      expect(checkboxState).toEqual({ activeValue: 'billing', value: 'updates,billing' });
      // Select-all Checkbox derives: aria-checked true, .checked present, and
      // .indeterminate false now that both items are selected (SPEC §4.8).
      expect(
        deriveRun(
          checkboxGroup,
          'GalleryCheckboxGroupDemo$Checkbox_aria_checked_derive',
          checkboxState,
        ),
      ).toBe('true');
      expect(
        deriveRun(checkboxGroup, 'GalleryCheckboxGroupDemo$Checkbox_checked_derive', checkboxState),
      ).toBe('');
      expect(
        deriveRun(
          checkboxGroup,
          'GalleryCheckboxGroupDemo$Checkbox_indeterminate_derive',
          checkboxState,
        ),
      ).toBe(null);
      // Billing item control reflects checked.
      expect(
        deriveRun(
          checkboxGroup,
          'GalleryCheckboxGroupDemo$CheckboxGroupControl_aria_checked_derive_2',
          checkboxState,
        ),
      ).toBe('true');
      expect(
        deriveRun(checkboxGroup, 'GalleryCheckboxGroupDemo$output_text_derive', checkboxState),
      ).toBe('updates,billing');

      const dropdownMenu = evaluateClientModule('dropdown-menu-demo.client.js', { document });
      const dropdownState = { highlightedValue: 'duplicate', open: false, value: 'duplicate' };
      clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: dropdownState,
      });
      expect(dropdownState).toEqual({
        highlightedValue: 'duplicate',
        open: true,
        value: 'duplicate',
      });
      expect(
        deriveRun(
          dropdownMenu,
          'GalleryDropdownMenuDemo$button_aria_expanded_derive',
          dropdownState,
        ),
      ).toBe('true');
      expect(
        deriveRun(dropdownMenu, 'GalleryDropdownMenuDemo$div_hidden_derive', dropdownState),
      ).toBeNull();
      expect(
        deriveRun(
          dropdownMenu,
          'GalleryDropdownMenuDemo$button_data_highlighted_derive',
          dropdownState,
        ),
      ).toBe('');
      expect(
        deriveRun(dropdownMenu, 'GalleryDropdownMenuDemo$output_text_derive', dropdownState),
      ).toBe('open');

      const dropdownMoveEvent = keyEvent('ArrowDown');
      clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_keydown_2')(dropdownMoveEvent, {
        params: {},
        signal,
        state: dropdownState,
      });
      expect(dropdownMoveEvent.defaultPrevented).toBe(true);
      expect(dropdownState).toEqual({
        highlightedValue: 'rename',
        open: true,
        value: 'duplicate',
      });
      expect(
        deriveRun(
          dropdownMenu,
          'GalleryDropdownMenuDemo$button_data_highlighted_derive',
          dropdownState,
        ),
      ).toBeNull();
      expect(
        deriveRun(
          dropdownMenu,
          'GalleryDropdownMenuDemo$button_data_highlighted_derive_2',
          dropdownState,
        ),
      ).toBe('');
      expect(
        deriveRun(dropdownMenu, 'GalleryDropdownMenuDemo$button_tabIndex_derive', dropdownState),
      ).toBe(-1);
      expect(
        deriveRun(dropdownMenu, 'GalleryDropdownMenuDemo$button_tabIndex_derive_2', dropdownState),
      ).toBe(0);

      const dropdownEnterEvent = keyEvent('Enter');
      clientHandler(dropdownMenu, 'GalleryDropdownMenuDemo$button_keydown_3')(dropdownEnterEvent, {
        params: {},
        signal,
        state: dropdownState,
      });
      expect(dropdownEnterEvent.defaultPrevented).toBe(true);
      expect(dropdownState).toEqual({ highlightedValue: 'rename', open: false, value: 'rename' });
      expect(
        deriveRun(
          dropdownMenu,
          'GalleryDropdownMenuDemo$button_aria_expanded_derive',
          dropdownState,
        ),
      ).toBe('false');
      expect(
        deriveRun(dropdownMenu, 'GalleryDropdownMenuDemo$div_hidden_derive', dropdownState),
      ).toBe('');
      expect(
        deriveRun(dropdownMenu, 'GalleryDropdownMenuDemo$output_text_derive', dropdownState),
      ).toBe('closed');

      const menubar = evaluateClientModule('menubar-demo.client.js', { document });
      const menubarState = { activeValue: 'file', openValue: '', value: 'new' };
      const menubarMoveEvent = keyEvent('ArrowRight');
      clientHandler(menubar, 'GalleryMenubarDemo$section_keydown')(menubarMoveEvent, {
        params: {},
        signal,
        state: menubarState,
      });
      expect(menubarMoveEvent.defaultPrevented).toBe(true);
      expect(menubarState).toEqual({ activeValue: 'edit', openValue: '', value: 'new' });
      expect(deriveRun(menubar, 'GalleryMenubarDemo$button_tabIndex_derive', menubarState)).toBe(
        -1,
      );
      expect(deriveRun(menubar, 'GalleryMenubarDemo$button_tabIndex_derive_2', menubarState)).toBe(
        0,
      );
      clientHandler(menubar, 'GalleryMenubarDemo$button_click')(new Event('click'), {
        params: {},
        signal,
        state: menubarState,
      });
      expect(menubarState).toEqual({ activeValue: 'new', openValue: 'file', value: 'new' });
      expect(
        deriveRun(menubar, 'GalleryMenubarDemo$button_aria_expanded_derive', menubarState),
      ).toBe('true');
      expect(deriveRun(menubar, 'GalleryMenubarDemo$div_hidden_derive', menubarState)).toBeNull();
      expect(deriveRun(menubar, 'GalleryMenubarDemo$output_text_derive', menubarState)).toBe(
        'file',
      );
      const menubarKeyEvent = keyEvent('Escape');
      clientHandler(menubar, 'GalleryMenubarDemo$button_keydown_2')(menubarKeyEvent, {
        params: {},
        signal,
        state: menubarState,
      });
      expect(menubarKeyEvent.defaultPrevented).toBe(true);
      expect(menubarState).toEqual({ activeValue: 'file', openValue: '', value: 'new' });
      expect(
        deriveRun(menubar, 'GalleryMenubarDemo$button_aria_expanded_derive', menubarState),
      ).toBe('false');
      expect(deriveRun(menubar, 'GalleryMenubarDemo$div_hidden_derive', menubarState)).toBe('');
      expect(deriveRun(menubar, 'GalleryMenubarDemo$output_text_derive', menubarState)).toBe(
        'none',
      );

      const navigationMenu = evaluateClientModule('navigation-menu-demo.client.js', { document });
      const navigationState = { activeValue: 'products', openValue: '', value: 'none' };
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(
        keyEvent('ArrowRight'),
        { params: {}, signal, state: navigationState },
      );
      expect(navigationState).toEqual({ activeValue: 'docs', openValue: '', value: 'none' });
      expect(
        deriveRun(
          navigationMenu,
          'GalleryNavigationMenuDemo$button_tabIndex_derive',
          navigationState,
        ),
      ).toBe(-1);
      expect(
        deriveRun(navigationMenu, 'GalleryNavigationMenuDemo$a_tabIndex_derive', navigationState),
      ).toBe(0);
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$button_pointerenter')(
        new Event('pointerenter'),
        {
          params: {},
          signal,
          state: navigationState,
        },
      );
      expect(navigationState).toEqual({
        activeValue: 'products',
        openValue: 'products',
        value: 'none',
      });
      expect(
        deriveRun(
          navigationMenu,
          'GalleryNavigationMenuDemo$button_aria_expanded_derive',
          navigationState,
        ),
      ).toBe('true');
      expect(
        deriveRun(navigationMenu, 'GalleryNavigationMenuDemo$div_hidden_derive', navigationState),
      ).toBeNull();
      expect(
        deriveRun(navigationMenu, 'GalleryNavigationMenuDemo$div_hidden_derive_2', navigationState),
      ).toBeNull();
      expect(
        deriveRun(navigationMenu, 'GalleryNavigationMenuDemo$output_text_derive', navigationState),
      ).toBe('products');
      const navEscape = keyEvent('Escape');
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(navEscape, {
        params: {},
        signal,
        state: navigationState,
      });
      expect(navEscape.defaultPrevented).toBe(true);
      expect(navigationState).toEqual({ activeValue: 'products', openValue: '', value: 'none' });
      expect(
        deriveRun(
          navigationMenu,
          'GalleryNavigationMenuDemo$button_aria_expanded_derive',
          navigationState,
        ),
      ).toBe('false');
      expect(
        deriveRun(navigationMenu, 'GalleryNavigationMenuDemo$div_hidden_derive', navigationState),
      ).toBe('');
      expect(
        deriveRun(navigationMenu, 'GalleryNavigationMenuDemo$output_text_derive', navigationState),
      ).toBe('none');
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$section_keydown')(
        keyEvent('ArrowRight'),
        { params: {}, signal, state: navigationState },
      );
      const navClick = new Event('click', { cancelable: true });
      clientHandler(navigationMenu, 'GalleryNavigationMenuDemo$a_click')(navClick, {
        params: {},
        signal,
        state: navigationState,
      });
      expect(navClick.defaultPrevented).toBe(true);
      expect(navigationState).toEqual({ activeValue: 'docs', openValue: '', value: 'docs' });

      const scrollArea = evaluateClientModule('scroll-area-demo.client.js');
      const scrollAreaState = {
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
      expect(scrollAreaState).toMatchObject({
        scrollTop: 1000000,
        scrollY: 'end',
        thumbOffset: 100,
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
      expect(scrollAreaState).toMatchObject({
        scrollTop: 100,
        scrollY: 'middle',
        thumbOffset: 50,
        verticalVisible: true,
      });

      const command = evaluateClientModule('command-demo.client.js', { document });
      const commandState = {
        highlightedValue: 'dashboard',
        inputValue: '',
        lastKeyAction: 'idle',
        open: false,
        value: 'dashboard',
      };
      clientHandler(command, 'GalleryCommandDemo$input_input')(inputEvent('invite'), {
        params: {},
        signal,
        state: commandState,
      });
      expect(commandState).toMatchObject({
        highlightedValue: 'invite',
        inputValue: 'invite',
        open: true,
      });
      expect(
        deriveRun(command, 'GalleryCommandDemo$input_aria_activedescendant_derive', commandState),
      ).toBe('gallery-command-listbox-item-1');
      expect(
        deriveRun(command, 'GalleryCommandDemo$button_aria_selected_derive_2', commandState),
      ).toBe('true');
      expect(deriveRun(command, 'GalleryCommandDemo$output_text_derive', commandState)).toBe(
        'invite',
      );
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
        lastKeyAction: 'selected',
        open: false,
        value: 'invite',
      });
      expect(deriveRun(command, 'GalleryCommandDemo$dialog_open_derive', commandState)).toBeNull();
      expect(deriveRun(command, 'GalleryCommandDemo$output_text_derive_2', commandState)).toBe(
        'Invite teammate',
      );
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
      expect(
        deriveRun(command, 'GalleryCommandDemo$button_data_selected_derive_2', commandState),
      ).toBe('');

      const toolbar = evaluateClientModule('toolbar-demo.client.js', { document });
      const toolbarState = { activeValue: 'bold', pressedValue: 'bold' };
      const toolbarKeyboardEvent = keyEvent('ArrowRight');
      clientHandler(toolbar, 'GalleryToolbarDemo$div_keydown')(toolbarKeyboardEvent, {
        params: {},
        signal,
        state: toolbarState,
      });
      expect(toolbarKeyboardEvent.defaultPrevented).toBe(true);
      expect(toolbarState).toEqual({ activeValue: 'link', pressedValue: 'bold' });
      expect(deriveRun(toolbar, 'GalleryToolbarDemo$button_tabIndex_derive', toolbarState)).toBe(
        -1,
      );
      expect(deriveRun(toolbar, 'GalleryToolbarDemo$button_tabIndex_derive_2', toolbarState)).toBe(
        0,
      );
      clientHandler(toolbar, 'GalleryToolbarDemo$button_click_2')(new Event('click'), {
        params: {},
        signal,
        state: toolbarState,
      });
      expect(toolbarState).toEqual({ activeValue: 'link', pressedValue: 'link' });
      expect(
        deriveRun(toolbar, 'GalleryToolbarDemo$button_aria_pressed_derive', toolbarState),
      ).toBe('false');
      expect(
        deriveRun(toolbar, 'GalleryToolbarDemo$button_aria_pressed_derive_2', toolbarState),
      ).toBe('true');
      expect(deriveRun(toolbar, 'GalleryToolbarDemo$output_text_derive', toolbarState)).toBe(
        'link',
      );

      const toggleGroup = evaluateClientModule('toggle-group-demo.client.js', { document });
      const toggleGroupState = { activeValue: 'bold', value: 'bold' };
      clientHandler(toggleGroup, 'GalleryToggleGroupDemo$button_click_2')(new Event('click'), {
        params: {},
        signal,
        state: toggleGroupState,
      });
      // Single-select: clicking italic REPLACES bold (siblings deselect), so value
      // is just 'italic' and bold is no longer pressed.
      expect(toggleGroupState).toEqual({ activeValue: 'italic', value: 'italic' });
      expect(
        deriveRun(
          toggleGroup,
          'GalleryToggleGroupDemo$button_aria_pressed_derive',
          toggleGroupState,
        ),
      ).toBe('false');
      expect(
        deriveRun(toggleGroup, 'GalleryToggleGroupDemo$button_data_state_derive', toggleGroupState),
      ).toBe('off');
      expect(
        deriveRun(
          toggleGroup,
          'GalleryToggleGroupDemo$button_aria_pressed_derive_2',
          toggleGroupState,
        ),
      ).toBe('true');
      expect(
        deriveRun(
          toggleGroup,
          'GalleryToggleGroupDemo$button_data_state_derive_2',
          toggleGroupState,
        ),
      ).toBe('pressed');
      expect(
        deriveRun(toggleGroup, 'GalleryToggleGroupDemo$output_text_derive', toggleGroupState),
      ).toBe('italic');

      const toast = evaluateClientModule('toast-demo.client.js', { document });
      const toastState = {
        activeCount: 0,
        activeOpen: false,
        previousCount: 0,
        previousOpen: false,
      };
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
      expect(deriveRun(toast, 'GalleryToastDemo$div_data_state_derive_2', toastState)).toBe('open');
      expect(deriveRun(toast, 'GalleryToastDemo$div_hidden_derive_2', toastState)).toBeNull();
      expect(deriveRun(toast, 'GalleryToastDemo$output_text_derive', toastState)).toBe('open');
      clientHandler(toast, 'GalleryToastDemo$section_keydown')(keyEvent('Enter'), {
        params: {},
        signal,
        state: toastState,
      });
      expect(toastState.activeOpen).toBe(true);
      clientHandler(toast, 'GalleryToastDemo$div_animationend')(animationEvent(), {
        params: {},
        signal,
        state: toastState,
      });
      expect(toastState.activeOpen).toBe(false);
      expect(deriveRun(toast, 'GalleryToastDemo$div_data_state_derive_2', toastState)).toBe(
        'closed',
      );
      expect(deriveRun(toast, 'GalleryToastDemo$div_hidden_derive_2', toastState)).toBe('');
      toastState.activeOpen = true;
      const disabledToastClick = new Event('click', { cancelable: true });
      clientHandler(toast, 'GalleryToastDemo$button_click_6')(disabledToastClick, {
        params: {},
        signal,
        state: toastState,
      });
      expect(disabledToastClick.defaultPrevented).toBe(true);
      expect(toastState.activeOpen).toBe(true);
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

function animationEvent(): Event {
  const event = new Event('animationend', { cancelable: true });
  Object.defineProperty(event, 'animationName', { value: 'gallery-toast-auto-dismiss' });
  return event;
}
