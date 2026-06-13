import { describe, expect, it } from 'vitest';

import {
  galleryFixtures,
  galleryRoutes,
  renderGalleryRoute,
  type GalleryRoute,
} from './demo-fixtures.js';

const expectedRoutes = [
  '/components/accordion',
  '/components/alert',
  '/components/alert-dialog',
  '/components/autocomplete',
  '/components/avatar',
  '/components/badge',
  '/components/breadcrumb',
  '/components/button',
  '/components/card',
  '/components/checkbox',
  '/components/checkbox-group',
  '/components/collapsible',
  '/components/combobox',
  '/components/command',
  '/components/context-menu',
  '/components/dialog',
  '/components/disclosure',
  '/components/drawer',
  '/components/dropdown-menu',
  '/components/field',
  '/components/hover-card',
  '/components/kbd',
  '/components/menubar',
  '/components/meter',
  '/components/navigation-menu',
  '/components/number-field',
  '/components/otp-field',
  '/components/popover',
  '/components/progress',
  '/components/radio-group',
  '/components/scroll-area',
  '/components/select',
  '/components/separator',
  '/components/sheet',
  '/components/skeleton',
  '/components/slider',
  '/components/switch',
  '/components/table',
  '/components/tabs',
  '/components/toast',
  '/components/toggle',
  '/components/toggle-group',
  '/components/toolbar',
  '/components/tooltip',
] as const satisfies readonly GalleryRoute['path'][];

describe('gallery demo fixtures', () => {
  it('renders one route fixture for each covered demo component', () => {
    expect(galleryRoutes.map((route) => route.path)).toEqual(expectedRoutes);
    expect(new Set(galleryRoutes.map((route) => route.path)).size).toBe(galleryRoutes.length);
    expect(galleryRoutes.map((route) => route.path)).toEqual(
      galleryRoutes.map((route) => `/components/${route.component}`),
    );

    expect(galleryFixtures()).toHaveLength(galleryRoutes.length);
  });

  it('keeps rendered demos as the test fixture surface', () => {
    for (const fixture of galleryFixtures()) {
      expect(fixture.html).toContain(`data-gallery-route="${fixture.path}"`);
      expect(fixture.html).toContain(`data-gallery-demo="${fixture.component}"`);
      expect(fixture.html).toContain('data-gallery-contract');
      expect(fixture.html).toContain('data-demo-summary="no-js"');
    }
  });

  it('renders route navigation links to every covered demo', () => {
    const route = galleryRoutes[0];

    if (!route) {
      throw new Error('Expected at least one gallery route');
    }

    const html = renderGalleryRoute(route);
    for (const path of expectedRoutes) {
      expect(html).toContain(`href="${path}"`);
    }
    expect(html).toContain(`aria-current="page" href="${route.path}"`);
  });

  it('renders accordion fixture with item, trigger, and panel wiring', () => {
    const accordion = findFixture('/components/accordion');

    expect(accordion.html).toContain('data-orientation="vertical"');
    expect(accordion.html).toContain('aria-expanded="true"');
    expect(accordion.html).toContain('aria-controls="gallery-accordion-shipping-panel"');
    expect(accordion.html).toContain('role="region"');
    expect(accordion.html).toContain('aria-labelledby="gallery-accordion-shipping-trigger"');
    expect(accordion.html).toContain('hidden id="gallery-accordion-billing-panel"');
  });

  it('renders avatar fixture with native image and fallback states', () => {
    const avatar = findFixture('/components/avatar');

    expect(avatar.html).toContain('data-state="loading"');
    expect(avatar.html).toContain('role="img"');
    expect(avatar.html).toContain('aria-label="Ada Lovelace avatar"');
    expect(avatar.html).toContain('alt="Ada Lovelace"');
    expect(avatar.html).toContain('decoding="async"');
    expect(avatar.html).toContain('loading="lazy"');
    expect(avatar.html).toContain('sizes="40px"');
    expect(avatar.html).toContain('srcset="/avatars/ada@2x.png 2x"');
    expect(avatar.html).toContain('data-delay="250"');
    expect(avatar.html).toContain('data-state="loaded"');
    expect(avatar.html).toContain('hidden>GH</span>');
    expect(avatar.html).toContain('data-state="error"');
    expect(avatar.html).toContain('hidden src="/avatars/missing.png"');
  });

  it('renders alert-dialog fixture with native alertdialog and action wiring', () => {
    const alertDialog = findFixture('/components/alert-dialog');

    expect(alertDialog.html).toContain('data-gallery-demo="alert-dialog"');
    expect(alertDialog.html).toContain('command="show-modal"');
    expect(alertDialog.html).toContain('commandfor="gallery-alert-dialog-content"');
    expect(alertDialog.html).toContain('aria-controls="gallery-alert-dialog-content"');
    expect(alertDialog.html).toContain('role="alertdialog"');
    expect(alertDialog.html).toContain('aria-modal="true"');
    expect(alertDialog.html).toContain('id="gallery-alert-dialog-content"');
    expect(alertDialog.html).toContain('aria-labelledby="gallery-alert-dialog-title"');
    expect(alertDialog.html).toContain('aria-describedby="gallery-alert-dialog-description"');
    expect(alertDialog.html).toContain('autofocus');
    expect(alertDialog.html).toContain('data-intent="cancel"');
    expect(alertDialog.html).toContain('data-intent="destructive"');
    expect(alertDialog.html).toContain('command="request-close"');
  });

  it('renders autocomplete fixture with native input and datalist wiring', () => {
    const autocomplete = findFixture('/components/autocomplete');

    expect(autocomplete.html).toContain('data-gallery-demo="autocomplete"');
    expect(autocomplete.html).toContain('data-ui-demo="autocomplete"');
    expect(autocomplete.html).toContain('id="gallery-autocomplete"');
    expect(autocomplete.html).toContain('for="gallery-autocomplete-input"');
    expect(autocomplete.html).toContain('role="combobox"');
    expect(autocomplete.html).toContain('aria-autocomplete="list"');
    expect(autocomplete.html).toContain('aria-expanded="true"');
    expect(autocomplete.html).toContain('aria-controls="gallery-autocomplete-list"');
    expect(autocomplete.html).toContain(
      'aria-activedescendant="gallery-autocomplete-list-option-1"',
    );
    expect(autocomplete.html).toContain('list="gallery-autocomplete-list"');
    expect(autocomplete.html).toContain('name="gallery-plan-search"');
    expect(autocomplete.html).toContain('<datalist');
    expect(autocomplete.html).toContain('id="gallery-autocomplete-list"');
    expect(autocomplete.html).toContain('data-highlighted="" data-state="checked"');
    expect(autocomplete.html).toContain('value="growth"');
    expect(autocomplete.html).toContain('disabled');
    expect(autocomplete.html).toContain('id="gallery-autocomplete-value">Growth plan</span>');
  });

  it('renders checkbox fixture with native form states', () => {
    const checkbox = findFixture('/components/checkbox');

    expect(checkbox.html).toContain('type="checkbox"');
    expect(checkbox.html).toContain('name="gallery-consent"');
    expect(checkbox.html).toContain('required');
    expect(checkbox.html).toContain('data-state="checked"');
    expect(checkbox.html).toContain('aria-checked="mixed"');
    expect(checkbox.html).toContain('data-state="indeterminate"');
    expect(checkbox.html).toContain('data-fixture-state="disabled"');
    expect(checkbox.html).toContain('disabled');
  });

  it('renders checkbox-group fixture with native checkbox inputs and roving attributes', () => {
    const checkboxGroup = findFixture('/components/checkbox-group');

    expect(checkboxGroup.html).toContain('data-gallery-demo="checkbox-group"');
    expect(checkboxGroup.html).toContain('data-ui-demo="checkbox-group"');
    expect(checkboxGroup.html).toContain('role="group"');
    expect(checkboxGroup.html).toContain('aria-labelledby="gallery-checkbox-group-label"');
    expect(checkboxGroup.html).toContain(
      'aria-describedby="gallery-checkbox-group-description gallery-checkbox-group-error"',
    );
    expect(checkboxGroup.html).toContain('aria-invalid="true"');
    expect(checkboxGroup.html).toContain('aria-required="true"');
    expect(checkboxGroup.html).toContain('name="gallery-notifications"');
    expect(checkboxGroup.html).toContain('type="checkbox"');
    expect(checkboxGroup.html).toContain('id="gallery-checkbox-group-updates"');
    expect(checkboxGroup.html).toContain('aria-checked="true"');
    expect(checkboxGroup.html).toContain('tabIndex="0"');
    expect(checkboxGroup.html).toContain('data-state="checked"');
    expect(checkboxGroup.html).toContain('value="security"');
    expect(checkboxGroup.html).toContain('disabled id="gallery-checkbox-group-security"');
    expect(checkboxGroup.html).toContain('tabIndex="-1" type="checkbox" value="security"');
  });

  it('renders combobox fixture with styled input, listbox, and option states', () => {
    const combobox = findFixture('/components/combobox');

    expect(combobox.html).toContain('data-gallery-demo="combobox"');
    expect(combobox.html).toContain('data-ui-demo="combobox"');
    expect(combobox.html).toContain('id="gallery-combobox"');
    expect(combobox.html).toContain('for="gallery-combobox-input"');
    expect(combobox.html).toContain('role="combobox"');
    expect(combobox.html).toContain('aria-autocomplete="list"');
    expect(combobox.html).toContain('aria-expanded="true"');
    expect(combobox.html).toContain('aria-controls="gallery-combobox-listbox"');
    expect(combobox.html).toContain('aria-activedescendant="gallery-combobox-listbox-option-1"');
    expect(combobox.html).toContain('name="gallery-assignee"');
    expect(combobox.html).toContain('role="listbox"');
    expect(combobox.html).toContain('id="gallery-combobox-listbox"');
    expect(combobox.html).toContain('aria-selected="true"');
    expect(combobox.html).toContain('data-highlighted="" data-state="unchecked"');
    expect(combobox.html).toContain('aria-disabled="true"');
    expect(combobox.html).toContain('id="gallery-combobox-value">Ada Lovelace</span>');
  });

  it('renders H1 disclosure and popover fixtures with styled primitive wrappers', () => {
    const collapsible = findFixture('/components/collapsible');
    const disclosure = findFixture('/components/disclosure');
    const hoverCard = findFixture('/components/hover-card');
    const popover = findFixture('/components/popover');

    expect(collapsible.html).toContain('data-gallery-demo="collapsible"');
    expect(collapsible.html).toContain('<details');
    expect(collapsible.html).toContain('aria-controls="gallery-collapsible-content"');
    expect(collapsible.html).toContain('data-disabled="" data-state="closed"');

    expect(disclosure.html).toContain('data-gallery-demo="disclosure"');
    expect(disclosure.html).toContain('aria-expanded="true"');
    expect(disclosure.html).toContain('id="gallery-disclosure-content"');

    expect(hoverCard.html).toContain('data-gallery-demo="hover-card"');
    expect(hoverCard.html).toContain('jiso-hover-card="gallery-hover-card-content"');
    expect(hoverCard.html).toContain('popover="manual"');

    expect(popover.html).toContain('data-gallery-demo="popover"');
    expect(popover.html).toContain('popovertarget="gallery-popover-content"');
    expect(popover.html).toContain('popover="auto"');
  });

  it('renders dialog fixture with native invoker and IDREF wiring', () => {
    const dialog = findFixture('/components/dialog');

    expect(dialog.html).toContain('command="show-modal"');
    expect(dialog.html).toContain('commandfor="gallery-dialog-content"');
    expect(dialog.html).toContain('aria-controls="gallery-dialog-content"');
    expect(dialog.html).toContain('aria-labelledby="gallery-dialog-title"');
    expect(dialog.html).toContain('aria-describedby="gallery-dialog-description"');
    expect(dialog.html).toContain('open');
  });

  it('renders H3 menu fixtures with styled menu semantics', () => {
    const command = findFixture('/components/command');
    const contextMenu = findFixture('/components/context-menu');
    const dropdownMenu = findFixture('/components/dropdown-menu');
    const menubar = findFixture('/components/menubar');
    const navigationMenu = findFixture('/components/navigation-menu');

    expect(command.html).toContain('data-ui-demo="command"');
    expect(command.html).toContain('command="show-modal" commandfor="gallery-command-dialog"');
    expect(command.html).toContain('aria-modal="true"');
    expect(command.html).toContain('role="combobox"');
    expect(command.html).toContain('aria-activedescendant="gallery-command-listbox-item-1"');
    expect(command.html).toContain('role="listbox"');
    expect(command.html).toContain('aria-selected="true"');
    expect(command.html).toContain('data-highlighted="" data-state="active"');
    expect(command.html).toContain('command="request-close" commandfor="gallery-command-dialog"');
    expect(command.html).toContain('id="gallery-command-value">Invite teammate</span>');

    expect(contextMenu.html).toContain('data-ui-demo="context-menu"');
    expect(contextMenu.html).toContain('jiso-context-menu="gallery-context-menu-content"');
    expect(contextMenu.html).toContain('aria-haspopup="menu"');
    expect(contextMenu.html).toContain('data-anchor-x="24" data-anchor-y="32"');
    expect(contextMenu.html).toContain('role="menu" tabIndex="-1"');
    expect(contextMenu.html).toContain('id="gallery-context-menu-inspect"');
    expect(contextMenu.html).toContain('data-highlighted="" data-state="active"');

    expect(dropdownMenu.html).toContain('data-ui-demo="dropdown-menu"');
    expect(dropdownMenu.html).toContain('aria-controls="gallery-dropdown-menu-content"');
    expect(dropdownMenu.html).toContain('aria-expanded="true"');
    expect(dropdownMenu.html).toContain('aria-haspopup="menu"');
    expect(dropdownMenu.html).toContain('role="menu" tabIndex="-1"');
    expect(dropdownMenu.html).toContain('id="gallery-dropdown-menu-rename"');
    expect(dropdownMenu.html).toContain('tabIndex="0" type="button" value="rename"');

    expect(menubar.html).toContain('data-ui-demo="menubar"');
    expect(menubar.html).toContain('aria-label="Document commands"');
    expect(menubar.html).toContain('role="menubar"');
    expect(menubar.html).toContain('aria-controls="gallery-menubar-file-menu"');
    expect(menubar.html).toContain('aria-expanded="true"');
    expect(menubar.html).toContain('role="menu" tabIndex="-1"');
    expect(menubar.html).toContain('id="gallery-menubar-import"');
    expect(menubar.html).toContain('aria-disabled="true"');

    expect(navigationMenu.html).toContain('data-ui-demo="navigation-menu"');
    expect(navigationMenu.html).toContain('aria-label="Primary navigation"');
    expect(navigationMenu.html).toContain('role="navigation"');
    expect(navigationMenu.html).toContain('role="list"');
    expect(navigationMenu.html).toContain('role="listitem"');
    expect(navigationMenu.html).toContain('aria-controls="gallery-navigation-products-panel"');
    expect(navigationMenu.html).toContain('aria-expanded="true"');
    expect(navigationMenu.html).toContain('href="/docs"');
    expect(navigationMenu.html).toContain('id="gallery-navigation-viewport"');
  });

  it('renders field fixture with native label, message, and fieldset wiring', () => {
    const field = findFixture('/components/field');

    expect(field.html).toContain('for="gallery-field-email"');
    expect(field.html).toContain('name="email"');
    expect(field.html).toContain('placeholder="ada@example.com"');
    expect(field.html).toContain(
      'aria-describedby="gallery-field-description gallery-field-error"',
    );
    expect(field.html).toContain('aria-invalid="true"');
    expect(field.html).toContain('role="alert"');
    expect(field.html).toContain('for="gallery-field-bio"');
    expect(field.html).toContain('<textarea aria-describedby="gallery-field-bio-description"');
    expect(field.html).toContain('id="gallery-field-bio" name="bio" rows="3"');
    expect(field.html).toContain('for="gallery-field-plan"');
    expect(field.html).toContain('<select aria-describedby="gallery-field-plan-description"');
    expect(field.html).toContain('id="gallery-field-plan" name="plan" required value="team"');
    expect(field.html).toContain('<option value="team" selected>Team</option>');
    expect(field.html).toContain('aria-describedby="gallery-fieldset-description"');
    expect(field.html).toContain('disabled id="gallery-fieldset"');
    expect(field.html).toContain('for="gallery-fieldset-seat"');
    expect(field.html).toContain('id="gallery-fieldset-seat" name="seat"');
    expect(field.html).toContain('value="window"');
    expect(field.html).toContain('id="gallery-fieldset"');
  });

  it('renders meter fixture with threshold data and native meter attributes', () => {
    const meter = findFixture('/components/meter');

    expect(meter.html).toContain('<meter');
    expect(meter.html).toContain('data-low="50"');
    expect(meter.html).toContain('data-high="90"');
    expect(meter.html).toContain('data-optimum="80"');
    expect(meter.html).toContain('data-state="optimum"');
    expect(meter.html).toContain('data-state="suboptimum"');
    expect(meter.html).toContain('aria-valuetext="84 percent quality score"');
  });

  it('renders number-field fixture with native number input and stepper wiring', () => {
    const numberField = findFixture('/components/number-field');

    expect(numberField.html).toContain('data-gallery-demo="number-field"');
    expect(numberField.html).toContain('id="gallery-number-field"');
    expect(numberField.html).toContain('for="gallery-number-field-input"');
    expect(numberField.html).toContain('type="number"');
    expect(numberField.html).toContain('name="gallery-quantity"');
    expect(numberField.html).toContain('required');
    expect(numberField.html).toContain('min="0"');
    expect(numberField.html).toContain('max="10"');
    expect(numberField.html).toContain('step="2"');
    expect(numberField.html).toContain('value="2"');
    expect(numberField.html).toContain(
      'aria-describedby="gallery-number-field-description gallery-number-field-error"',
    );
    expect(numberField.html).toContain('aria-invalid="true"');
    expect(numberField.html).toContain('aria-controls="gallery-number-field-input"');
    expect(numberField.html).toContain('data-action="decrement"');
    expect(numberField.html).toContain('data-action="increment"');
    expect(numberField.html).toContain('data-fixture-state="disabled-boundary"');
    expect(numberField.html).toContain('data-disabled');
    expect(numberField.html).toContain('disabled type="button"');
  });

  it('renders otp-field fixture with aggregate native input and slot wiring', () => {
    const otpField = findFixture('/components/otp-field');

    expect(otpField.html).toContain('data-gallery-demo="otp-field"');
    expect(otpField.html).toContain('id="gallery-otp-field"');
    expect(otpField.html).toContain('role="group"');
    expect(otpField.html).toContain('aria-labelledby="gallery-otp-label"');
    expect(otpField.html).toContain('aria-describedby="gallery-otp-description gallery-otp-error"');
    expect(otpField.html).toContain('aria-invalid="true"');
    expect(otpField.html).toContain('aria-required="true"');
    expect(otpField.html).toContain('for="gallery-otp-code"');
    expect(otpField.html).toContain('data-slot="hidden-input"');
    expect(otpField.html).toContain('autoComplete="one-time-code"');
    expect(otpField.html).toContain('name="gallery-otp-code"');
    expect(otpField.html).toContain('maxLength="6"');
    expect(otpField.html).toContain('minLength="6"');
    expect(otpField.html).toContain('tabIndex="-1"');
    expect(otpField.html).toContain('value="1234"');
    expect(otpField.html).toContain('data-slot="0"');
    expect(otpField.html).toContain('id="gallery-otp-slot-1"');
    expect(otpField.html).toContain('aria-label="One-time code digit 1"');
    expect(otpField.html).toContain('maxLength="1"');
    expect(otpField.html).toContain('data-filled');
    expect(otpField.html).toContain('data-slot="5"');
    expect(otpField.html).toContain('id="gallery-otp-slot-6"');
    expect(otpField.html).toContain('data-fixture-state="disabled-complete"');
    expect(otpField.html).toContain('data-complete');
    expect(otpField.html).toContain('data-disabled');
    expect(otpField.html).toContain('name="gallery-disabled-otp-code"');
  });

  it('renders toggle fixture states through headless-ui attributes', () => {
    const toggle = findFixture('/components/toggle');

    expect(toggle.html).toContain('data-fixture-state="pressed"');
    expect(toggle.html).toContain('data-state="pressed"');
    expect(toggle.html).toContain('aria-pressed="true"');
    expect(toggle.html).toContain('data-fixture-state="disabled"');
    expect(toggle.html).toContain('data-disabled');
    expect(toggle.html).toContain('disabled');
  });

  it('renders toggle-group fixture with grouped pressed buttons and roving attributes', () => {
    const toggleGroup = findFixture('/components/toggle-group');

    expect(toggleGroup.html).toContain('data-gallery-demo="toggle-group"');
    expect(toggleGroup.html).toContain('data-ui-demo="toggle-group"');
    expect(toggleGroup.html).toContain('role="group"');
    expect(toggleGroup.html).toContain('aria-labelledby="gallery-toggle-group-label"');
    expect(toggleGroup.html).toContain('aria-describedby="gallery-toggle-group-description"');
    expect(toggleGroup.html).toContain('data-state="pressed"');
    expect(toggleGroup.html).toContain('aria-pressed="true"');
    expect(toggleGroup.html).toContain('id="gallery-toggle-group-bold"');
    expect(toggleGroup.html).toContain('tabIndex="0" type="button" value="bold"');
    expect(toggleGroup.html).toContain('data-state="off"');
    expect(toggleGroup.html).toContain('id="gallery-toggle-group-strike"');
    expect(toggleGroup.html).toContain('data-disabled="" data-state="off" disabled');
    expect(toggleGroup.html).toContain('tabIndex="-1" type="button" value="strike"');
  });

  it('renders toolbar fixture with native buttons and roving attributes', () => {
    const toolbar = findFixture('/components/toolbar');

    expect(toolbar.html).toContain('data-gallery-demo="toolbar"');
    expect(toolbar.html).toContain('data-ui-demo="toolbar"');
    expect(toolbar.html).toContain('role="toolbar"');
    expect(toolbar.html).toContain('aria-labelledby="gallery-toolbar-label"');
    expect(toolbar.html).toContain('aria-describedby="gallery-toolbar-description"');
    expect(toolbar.html).toContain('aria-pressed="true"');
    expect(toolbar.html).toContain('data-pressed="true"');
    expect(toolbar.html).toContain('id="gallery-toolbar-bold"');
    expect(toolbar.html).toContain('tabIndex="0" type="button" value="bold"');
    expect(toolbar.html).toContain('id="gallery-toolbar-link"');
    expect(toolbar.html).toContain('data-disabled="" data-pressed="false" disabled');
    expect(toolbar.html).toContain('tabIndex="-1" type="button" value="link"');
  });

  it('renders radio-group fixture with native radio inputs and roving attributes', () => {
    const radioGroup = findFixture('/components/radio-group');

    expect(radioGroup.html).toContain('role="radiogroup"');
    expect(radioGroup.html).toContain('aria-describedby="gallery-radio-description"');
    expect(radioGroup.html).toContain('name="gallery-shipping-speed"');
    expect(radioGroup.html).toContain('type="radio"');
    expect(radioGroup.html).toContain('aria-checked="true"');
    expect(radioGroup.html).toContain('tabIndex="0"');
    expect(radioGroup.html).toContain('data-state="checked"');
    expect(radioGroup.html).toContain('value="freight"');
    expect(radioGroup.html).toContain('disabled id="gallery-radio-freight"');
    expect(radioGroup.html).toContain('tabIndex="-1" type="radio" value="freight"');
  });

  it('renders scroll-area fixture with native viewport and decorative scrollbar parts', () => {
    const scrollArea = findFixture('/components/scroll-area');

    expect(scrollArea.html).toContain('data-gallery-demo="scroll-area"');
    expect(scrollArea.html).toContain('id="gallery-scroll-area"');
    expect(scrollArea.html).toContain('data-scrollbars="both"');
    expect(scrollArea.html).toContain('dir="ltr"');
    expect(scrollArea.html).toContain('id="gallery-scroll-area-viewport"');
    expect(scrollArea.html).toContain('role="region"');
    expect(scrollArea.html).toContain('aria-labelledby="gallery-scroll-area-title"');
    expect(scrollArea.html).toContain('aria-describedby="gallery-scroll-area-description"');
    expect(scrollArea.html).toContain('data-scroll-x="none"');
    expect(scrollArea.html).toContain('data-scroll-y="start"');
    expect(scrollArea.html).toContain('tabIndex="0"');
    expect(scrollArea.html).toContain('id="gallery-scroll-area-scrollbar-y"');
    expect(scrollArea.html).toContain('data-orientation="vertical"');
    expect(scrollArea.html).toContain('id="gallery-scroll-area-thumb-y"');
    expect(scrollArea.html).toContain('data-scroll-position="start"');
    expect(scrollArea.html).toContain('data-state="visible"');
    expect(scrollArea.html).toContain('id="gallery-scroll-area-scrollbar-x"');
    expect(scrollArea.html).toContain('data-orientation="horizontal"');
    expect(scrollArea.html).toContain('data-scroll-position="none"');
    expect(scrollArea.html).toContain('data-state="hidden"');
    expect(scrollArea.html).toContain('id="gallery-scroll-area-corner"');
    expect(scrollArea.html).toContain('data-fixture-state="disabled"');
    expect(scrollArea.html).toContain('aria-disabled="true"');
    expect(scrollArea.html).toContain('tabIndex="-1"');
    expect(scrollArea.html).toContain('data-disabled');
  });

  it('renders select fixture with native select and option states', () => {
    const select = findFixture('/components/select');

    expect(select.html).toContain('<select');
    expect(select.html).toContain('id="gallery-select"');
    expect(select.html).toContain('data-ui-demo="select"');
    expect(select.html).toContain('name="gallery-plan"');
    expect(select.html).toContain('required');
    expect(select.html).toContain('aria-labelledby="gallery-select-label"');
    expect(select.html).toContain('value="growth"');
    expect(select.html).toContain('selected');
    expect(select.html).toContain('disabled');
    expect(select.html).toContain('<optgroup');
    expect(select.html).toContain('label="Plans"');
    expect(select.html).toContain('id="gallery-select-value">Growth</span>');
  });

  it('renders separator fixture with decorative and semantic variants', () => {
    const separator = findFixture('/components/separator');

    expect(separator.html).toContain('data-fixture-state="decorative"');
    expect(separator.html).toContain('role="none"');
    expect(separator.html).toContain('data-fixture-state="semantic"');
    expect(separator.html).toContain('role="separator"');
    expect(separator.html).toContain('aria-orientation="vertical"');
  });

  it('renders switch fixture with native checkbox switch semantics', () => {
    const switchFixture = findFixture('/components/switch');

    expect(switchFixture.html).toContain('role="switch"');
    expect(switchFixture.html).toContain('type="checkbox"');
    expect(switchFixture.html).toContain('aria-checked="true"');
    expect(switchFixture.html).toContain('name="gallery-notifications"');
    expect(switchFixture.html).toContain('data-state="unchecked"');
    expect(switchFixture.html).toContain('data-disabled');
  });

  it('renders slider fixture with native range input and decorative parts', () => {
    const slider = findFixture('/components/slider');

    expect(slider.html).toContain('data-gallery-demo="slider"');
    expect(slider.html).toContain('data-ui-demo="slider"');
    expect(slider.html).toContain('id="gallery-slider"');
    expect(slider.html).toContain('for="gallery-slider-input"');
    expect(slider.html).toContain('type="range"');
    expect(slider.html).toContain('name="gallery-coverage"');
    expect(slider.html).toContain('min="0"');
    expect(slider.html).toContain('max="100"');
    expect(slider.html).toContain('step="5"');
    expect(slider.html).toContain('value="65"');
    expect(slider.html).toContain(
      'aria-describedby="gallery-slider-description gallery-slider-error"',
    );
    expect(slider.html).toContain('aria-invalid="true"');
    expect(slider.html).toContain('aria-valuetext="65 percent coverage"');
    expect(slider.html).toContain('data-part="track"');
    expect(slider.html).toContain('data-part="range"');
    expect(slider.html).toContain('data-part="thumb"');
    expect(slider.html).toContain('data-value-ratio="0.65"');
  });

  it('renders tabs fixture with tablist, trigger, and panel wiring', () => {
    const tabs = findFixture('/components/tabs');

    expect(tabs.html).toContain('role="tablist"');
    expect(tabs.html).toContain('aria-label="Gallery tabs"');
    expect(tabs.html).toContain('role="tab"');
    expect(tabs.html).toContain('aria-selected="true"');
    expect(tabs.html).toContain('aria-controls="gallery-tabs-overview-panel"');
    expect(tabs.html).toContain('role="tabpanel"');
    expect(tabs.html).toContain('aria-labelledby="gallery-tabs-overview"');
    expect(tabs.html).toContain('data-disabled="" data-state="inactive" disabled');
    expect(tabs.html).toContain('role="tab" tabIndex="-1" type="button" value="audit"');
  });

  it('renders progress fixture states through native progress attributes', () => {
    const progress = findFixture('/components/progress');

    expect(progress.html).toContain('data-state="loading"');
    expect(progress.html).toContain('data-value="42"');
    expect(progress.html).toContain('aria-valuetext="42 of 100 tasks complete"');
    expect(progress.html).toContain('data-state="complete"');
    expect(progress.html).toContain('data-state="indeterminate"');
  });

  it('renders toast fixture with live region, actions, and closed state', () => {
    const toast = findFixture('/components/toast');

    expect(toast.html).toContain('data-gallery-demo="toast"');
    expect(toast.html).toContain('data-ui-demo="toast"');
    expect(toast.html).toContain('aria-label="Gallery notifications"');
    expect(toast.html).toContain('data-placement="top-center"');
    expect(toast.html).toContain('id="gallery-toast-viewport"');
    expect(toast.html).toContain('role="region"');
    expect(toast.html).toContain('tabIndex="-1"');
    expect(toast.html).toContain('aria-atomic="true"');
    expect(toast.html).toContain('aria-live="polite"');
    expect(toast.html).toContain('aria-labelledby="gallery-toast-title"');
    expect(toast.html).toContain('aria-describedby="gallery-toast-description"');
    expect(toast.html).toContain('data-state="open" data-variant="success"');
    expect(toast.html).toContain('role="status"');
    expect(toast.html).toContain('data-part="title" id="gallery-toast-title"');
    expect(toast.html).toContain('data-part="description" id="gallery-toast-description"');
    expect(toast.html).toContain('data-action=""');
    expect(toast.html).toContain('type="button" value="open-deploy"');
    expect(toast.html).toContain('data-dismiss=""');
    expect(toast.html).toContain('data-state="closed" data-variant="error" hidden');
    expect(toast.html).toContain('role="alert"');
  });

  it('renders tooltip fixture with package-prefixed behavior and popover content', () => {
    const tooltip = findFixture('/components/tooltip');

    expect(tooltip.html).toContain('jiso-tooltip="gallery-tooltip-content"');
    expect(tooltip.html).toContain('aria-describedby="gallery-tooltip-content"');
    expect(tooltip.html).toContain('id="gallery-tooltip-content"');
    expect(tooltip.html).toContain('popover="manual"');
    expect(tooltip.html).toContain('role="tooltip"');
  });

  it('renders @jiso/ui styled component fixtures from current package exports', () => {
    const alert = findFixture('/components/alert');
    const button = findFixture('/components/button');
    const badge = findFixture('/components/badge');
    const breadcrumb = findFixture('/components/breadcrumb');
    const card = findFixture('/components/card');
    const autocomplete = findFixture('/components/autocomplete');
    const checkboxGroup = findFixture('/components/checkbox-group');
    const combobox = findFixture('/components/combobox');
    const command = findFixture('/components/command');
    const contextMenu = findFixture('/components/context-menu');
    const drawer = findFixture('/components/drawer');
    const dropdownMenu = findFixture('/components/dropdown-menu');
    const kbd = findFixture('/components/kbd');
    const menubar = findFixture('/components/menubar');
    const navigationMenu = findFixture('/components/navigation-menu');
    const select = findFixture('/components/select');
    const sheet = findFixture('/components/sheet');
    const skeleton = findFixture('/components/skeleton');
    const slider = findFixture('/components/slider');
    const table = findFixture('/components/table');
    const tabs = findFixture('/components/tabs');
    const toast = findFixture('/components/toast');
    const toggleGroup = findFixture('/components/toggle-group');
    const toolbar = findFixture('/components/toolbar');

    expect(alert.html).toContain('data-ui-demo="alert"');
    expect(alert.html).toContain('role="status"');
    expect(alert.html).toContain('border-emerald-200 bg-emerald-50');
    expect(alert.html).toContain('role="alert"');
    expect(alert.html).toContain('border-red-200 bg-red-50');

    expect(button.html).toContain('data-ui-demo="button"');
    expect(button.html).toContain('rounded-md border text-sm font-medium');
    expect(button.html).toContain('type="button"');
    expect(button.html).toContain('disabled type="button"');

    expect(badge.html).toContain('data-ui-demo="badge"');
    expect(badge.html).toContain('bg-emerald-50');
    expect(badge.html).toContain('bg-amber-50');

    expect(breadcrumb.html).toContain('data-ui-demo="breadcrumb"');
    expect(breadcrumb.html).toContain('aria-label="Account path"');
    expect(breadcrumb.html).toContain('href="/account"');
    expect(breadcrumb.html).toContain('aria-current="page"');
    expect(breadcrumb.html).toContain('data-orientation="horizontal" role="none"');

    expect(card.html).toContain('data-ui-demo="card"');
    expect(card.html).toContain('rounded-lg border border-neutral-200');
    expect(card.html).toContain('<h2>Release candidate</h2>');

    expect(checkboxGroup.html).toContain('data-ui-demo="checkbox-group"');
    expect(checkboxGroup.html).toContain('data-[orientation=horizontal]:flex');
    expect(checkboxGroup.html).toContain('accent-neutral-950');
    expect(checkboxGroup.html).toContain('gallery-checkbox-group-updates');

    expect(autocomplete.html).toContain('data-ui-demo="autocomplete"');
    expect(autocomplete.html).toContain('rounded-md border border-neutral-300');
    expect(autocomplete.html).toContain('gallery-autocomplete-list');
    expect(autocomplete.html).toContain('Growth plan');

    expect(combobox.html).toContain('data-ui-demo="combobox"');
    expect(combobox.html).toContain('rounded-md border border-neutral-300');
    expect(combobox.html).toContain('role="listbox"');
    expect(combobox.html).toContain('Ada Lovelace');

    expect(command.html).toContain('data-ui-demo="command"');
    expect(command.html).toContain('backdrop:bg-black/20');
    expect(command.html).toContain('Type a command');

    expect(contextMenu.html).toContain('data-ui-demo="context-menu"');
    expect(contextMenu.html).toContain('border-dashed border-neutral-300');
    expect(contextMenu.html).toContain('gallery-context-menu-inspect');

    expect(drawer.html).toContain('data-ui-demo="drawer"');
    expect(drawer.html).toContain('command="show-modal" commandfor="gallery-drawer"');
    expect(drawer.html).toContain('<dialog aria-describedby="gallery-drawer-description"');
    expect(drawer.html).toContain('id="gallery-drawer" open>');
    expect(drawer.html).toContain('bottom-0 max-h-[85vh] border-t');
    expect(drawer.html).toContain('command="request-close" commandfor="gallery-drawer"');

    expect(dropdownMenu.html).toContain('data-ui-demo="dropdown-menu"');
    expect(dropdownMenu.html).toContain('data-[state=open]:bg-neutral-100');
    expect(dropdownMenu.html).toContain('gallery-dropdown-menu-rename');

    expect(kbd.html).toContain('data-ui-demo="kbd"');
    expect(kbd.html).toContain('<kbd class="inline-flex h-5 min-w-5');
    expect(kbd.html).toContain('uppercase">K</kbd>');

    expect(menubar.html).toContain('data-ui-demo="menubar"');
    expect(menubar.html).toContain('data-[state=open]:bg-neutral-100');
    expect(menubar.html).toContain('gallery-menubar-file-menu');

    expect(navigationMenu.html).toContain('data-ui-demo="navigation-menu"');
    expect(navigationMenu.html).toContain('data-[state=open]:bg-neutral-100');
    expect(navigationMenu.html).toContain('gallery-navigation-products-panel');

    expect(select.html).toContain('data-ui-demo="select"');
    expect(select.html).toContain('rounded-md border border-neutral-300');
    expect(select.html).toContain('<optgroup');
    expect(select.html).toContain('Growth</span>');

    expect(sheet.html).toContain('data-ui-demo="sheet"');
    expect(sheet.html).toContain('command="show-modal" commandfor="gallery-sheet"');
    expect(sheet.html).toContain('<dialog aria-describedby="gallery-sheet-description"');
    expect(sheet.html).toContain('id="gallery-sheet" open>');
    expect(sheet.html).toContain('command="request-close" commandfor="gallery-sheet"');

    expect(skeleton.html).toContain('data-ui-demo="skeleton"');
    expect(skeleton.html).toContain('aria-hidden="true"');
    expect(skeleton.html).toContain('animate-pulse rounded-md bg-neutral-200 h-4 w-40');

    expect(slider.html).toContain('data-ui-demo="slider"');
    expect(slider.html).toContain('accent-neutral-950');
    expect(slider.html).toContain('data-value-ratio="0.65"');
    expect(slider.html).toContain('type="range"');

    expect(table.html).toContain('data-ui-demo="table"');
    expect(table.html).toContain('<caption class="mt-3 text-sm text-neutral-500">');
    expect(table.html).toContain('<thead class="border-b border-neutral-200 bg-neutral-50">');
    expect(table.html).toContain('<th class="h-10 px-3 text-left align-middle');
    expect(table.html).toContain('scope="row">INV-0042</th>');
    expect(table.html).toContain('colspan="3"');

    expect(tabs.html).toContain('data-ui-demo="tabs"');
    expect(tabs.html).toContain('rounded-md border border-neutral-200 bg-neutral-100');
    expect(tabs.html).toContain('data-[state=active]:bg-white');
    expect(tabs.html).toContain('overview content');

    expect(toast.html).toContain('data-ui-demo="toast"');
    expect(toast.html).toContain('data-[variant=success]:bg-emerald-50');
    expect(toast.html).toContain('aria-live="polite"');
    expect(toast.html).toContain('data-dismiss=""');

    expect(toggleGroup.html).toContain('data-ui-demo="toggle-group"');
    expect(toggleGroup.html).toContain('rounded-md border border-neutral-200 bg-neutral-100');
    expect(toggleGroup.html).toContain('data-[state=pressed]:bg-white');
    expect(toggleGroup.html).toContain('gallery-toggle-group-bold');

    expect(toolbar.html).toContain('data-ui-demo="toolbar"');
    expect(toolbar.html).toContain('rounded-md border border-neutral-200 bg-white');
    expect(toolbar.html).toContain('data-[pressed=true]:bg-neutral-950');
    expect(toolbar.html).toContain('gallery-toolbar-bold');
  });
});

function findFixture(path: (typeof galleryRoutes)[number]['path']) {
  const fixture = galleryFixtures().find((candidate) => candidate.path === path);

  if (!fixture) {
    throw new Error(`Missing gallery fixture for ${path}`);
  }

  return fixture;
}
