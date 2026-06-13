import axe from 'axe-core';
import { installJisoLoader, type JisoLoader } from '@jiso/runtime';
import { applyCheckboxIndeterminate } from '@jiso/headless-ui/primitives';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as accordionClient from './generated/interactive/accordion-demo.client.js';
import { GalleryAccordionDemo } from './generated/interactive/accordion-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as alertDialogClient from './generated/interactive/alert-dialog-demo.client.js';
import { GalleryAlertDialogDemo } from './generated/interactive/alert-dialog-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as autocompleteClient from './generated/interactive/autocomplete-demo.client.js';
import { GalleryAutocompleteDemo } from './generated/interactive/autocomplete-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as checkboxClient from './generated/interactive/checkbox-demo.client.js';
import { GalleryCheckboxDemo } from './generated/interactive/checkbox-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as checkboxGroupClient from './generated/interactive/checkbox-group-demo.client.js';
import { GalleryCheckboxGroupDemo } from './generated/interactive/checkbox-group-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as collapsibleClient from './generated/interactive/collapsible-demo.client.js';
import { GalleryCollapsibleDemo } from './generated/interactive/collapsible-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as comboboxClient from './generated/interactive/combobox-demo.client.js';
import { GalleryComboboxDemo } from './generated/interactive/combobox-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as commandClient from './generated/interactive/command-demo.client.js';
import { GalleryCommandDemo } from './generated/interactive/command-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as contextMenuClient from './generated/interactive/context-menu-demo.client.js';
import { GalleryContextMenuDemo } from './generated/interactive/context-menu-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as disclosureClient from './generated/interactive/disclosure-demo.client.js';
import { GalleryDisclosureDemo } from './generated/interactive/disclosure-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as dialogClient from './generated/interactive/dialog-demo.client.js';
import { GalleryDialogDemo } from './generated/interactive/dialog-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as dropdownMenuClient from './generated/interactive/dropdown-menu-demo.client.js';
import { GalleryDropdownMenuDemo } from './generated/interactive/dropdown-menu-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as fieldClient from './generated/interactive/field-demo.client.js';
import { GalleryFieldDemo } from './generated/interactive/field-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as hoverCardClient from './generated/interactive/hover-card-demo.client.js';
import { GalleryHoverCardDemo } from './generated/interactive/hover-card-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as menubarClient from './generated/interactive/menubar-demo.client.js';
import { GalleryMenubarDemo } from './generated/interactive/menubar-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as meterClient from './generated/interactive/meter-demo.client.js';
import { GalleryMeterDemo } from './generated/interactive/meter-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as navigationMenuClient from './generated/interactive/navigation-menu-demo.client.js';
import { GalleryNavigationMenuDemo } from './generated/interactive/navigation-menu-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as numberFieldClient from './generated/interactive/number-field-demo.client.js';
import { GalleryNumberFieldDemo } from './generated/interactive/number-field-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as otpFieldClient from './generated/interactive/otp-field-demo.client.js';
import { GalleryOtpFieldDemo } from './generated/interactive/otp-field-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as popoverClient from './generated/interactive/popover-demo.client.js';
import { GalleryPopoverDemo } from './generated/interactive/popover-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as progressClient from './generated/interactive/progress-demo.client.js';
import { GalleryProgressDemo } from './generated/interactive/progress-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as radioGroupClient from './generated/interactive/radio-group-demo.client.js';
import { GalleryRadioGroupDemo } from './generated/interactive/radio-group-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as scrollAreaClient from './generated/interactive/scroll-area-demo.client.js';
import { GalleryScrollAreaDemo } from './generated/interactive/scroll-area-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as selectClient from './generated/interactive/select-demo.client.js';
import { GallerySelectDemo } from './generated/interactive/select-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as sliderClient from './generated/interactive/slider-demo.client.js';
import { GallerySliderDemo } from './generated/interactive/slider-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as switchClient from './generated/interactive/switch-demo.client.js';
import { GallerySwitchDemo } from './generated/interactive/switch-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as tabsClient from './generated/interactive/tabs-demo.client.js';
import { GalleryTabsDemo } from './generated/interactive/tabs-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as toolbarClient from './generated/interactive/toolbar-demo.client.js';
import { GalleryToolbarDemo } from './generated/interactive/toolbar-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as toggleClient from './generated/interactive/toggle-demo.client.js';
import { GalleryToggleDemo } from './generated/interactive/toggle-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as toggleGroupClient from './generated/interactive/toggle-group-demo.client.js';
import { GalleryToggleGroupDemo } from './generated/interactive/toggle-group-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as toastClient from './generated/interactive/toast-demo.client.js';
import { GalleryToastDemo } from './generated/interactive/toast-demo.js';
// @ts-expect-error generated client modules are compiler artifacts without declarations.
import * as tooltipClient from './generated/interactive/tooltip-demo.client.js';
import { GalleryTooltipDemo } from './generated/interactive/tooltip-demo.js';
import checkboxGroupStaticRouteHtml from './visual-fixtures/checkbox-group.html.txt?raw';
import commandStaticRouteHtml from './visual-fixtures/command.html.txt?raw';
import contextMenuStaticRouteHtml from './visual-fixtures/context-menu.html.txt?raw';
import dropdownMenuStaticRouteHtml from './visual-fixtures/dropdown-menu.html.txt?raw';
import menubarStaticRouteHtml from './visual-fixtures/menubar.html.txt?raw';
import navigationMenuStaticRouteHtml from './visual-fixtures/navigation-menu.html.txt?raw';
import numberFieldStaticRouteHtml from './visual-fixtures/number-field.html.txt?raw';
import otpFieldStaticRouteHtml from './visual-fixtures/otp-field.html.txt?raw';
import radioGroupStaticRouteHtml from './visual-fixtures/radio-group.html.txt?raw';
import selectStaticRouteHtml from './visual-fixtures/select.html.txt?raw';
import sliderStaticRouteHtml from './visual-fixtures/slider.html.txt?raw';
import tableStaticRouteHtml from './visual-fixtures/table.html.txt?raw';
import tabsStaticRouteHtml from './visual-fixtures/tabs.html.txt?raw';
import { renderInteractiveGalleryRoute } from './interactive-docs.js';

interface InteractiveDemoComponent {
  definition: {
    render: (queries: Record<string, never>, state: never) => string;
    state: () => unknown;
  };
}

type StaticVisualFixturePath =
  | '/components/checkbox-group'
  | '/components/command'
  | '/components/context-menu'
  | '/components/dropdown-menu'
  | '/components/menubar'
  | '/components/navigation-menu'
  | '/components/number-field'
  | '/components/otp-field'
  | '/components/radio-group'
  | '/components/select'
  | '/components/slider'
  | '/components/table'
  | '/components/tabs';

const staticVisualFixtureHtml: Record<StaticVisualFixturePath, string> = {
  '/components/checkbox-group': checkboxGroupStaticRouteHtml,
  '/components/command': commandStaticRouteHtml,
  '/components/context-menu': contextMenuStaticRouteHtml,
  '/components/dropdown-menu': dropdownMenuStaticRouteHtml,
  '/components/menubar': menubarStaticRouteHtml,
  '/components/navigation-menu': navigationMenuStaticRouteHtml,
  '/components/number-field': numberFieldStaticRouteHtml,
  '/components/otp-field': otpFieldStaticRouteHtml,
  '/components/radio-group': radioGroupStaticRouteHtml,
  '/components/select': selectStaticRouteHtml,
  '/components/slider': sliderStaticRouteHtml,
  '/components/table': tableStaticRouteHtml,
  '/components/tabs': tabsStaticRouteHtml,
};

const generatedModules: Record<string, Record<string, unknown>> = {
  '/c/examples/gallery/src/generated/interactive/accordion-demo.client.js': accordionClient,
  '/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js': alertDialogClient,
  '/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js': autocompleteClient,
  '/c/examples/gallery/src/generated/interactive/checkbox-demo.client.js': checkboxClient,
  '/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js':
    checkboxGroupClient,
  '/c/examples/gallery/src/generated/interactive/collapsible-demo.client.js': collapsibleClient,
  '/c/examples/gallery/src/generated/interactive/combobox-demo.client.js': comboboxClient,
  '/c/examples/gallery/src/generated/interactive/command-demo.client.js': commandClient,
  '/c/examples/gallery/src/generated/interactive/context-menu-demo.client.js': contextMenuClient,
  '/c/examples/gallery/src/generated/interactive/disclosure-demo.client.js': disclosureClient,
  '/c/examples/gallery/src/generated/interactive/dialog-demo.client.js': dialogClient,
  '/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js': dropdownMenuClient,
  '/c/examples/gallery/src/generated/interactive/field-demo.client.js': fieldClient,
  '/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js': hoverCardClient,
  '/c/examples/gallery/src/generated/interactive/menubar-demo.client.js': menubarClient,
  '/c/examples/gallery/src/generated/interactive/meter-demo.client.js': meterClient,
  '/c/examples/gallery/src/generated/interactive/navigation-menu-demo.client.js':
    navigationMenuClient,
  '/c/examples/gallery/src/generated/interactive/number-field-demo.client.js': numberFieldClient,
  '/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js': otpFieldClient,
  '/c/examples/gallery/src/generated/interactive/popover-demo.client.js': popoverClient,
  '/c/examples/gallery/src/generated/interactive/progress-demo.client.js': progressClient,
  '/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js': radioGroupClient,
  '/c/examples/gallery/src/generated/interactive/scroll-area-demo.client.js': scrollAreaClient,
  '/c/examples/gallery/src/generated/interactive/select-demo.client.js': selectClient,
  '/c/examples/gallery/src/generated/interactive/slider-demo.client.js': sliderClient,
  '/c/examples/gallery/src/generated/interactive/switch-demo.client.js': switchClient,
  '/c/examples/gallery/src/generated/interactive/tabs-demo.client.js': tabsClient,
  '/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js': toolbarClient,
  '/c/examples/gallery/src/generated/interactive/toggle-demo.client.js': toggleClient,
  '/c/examples/gallery/src/generated/interactive/toggle-group-demo.client.js': toggleGroupClient,
  '/c/examples/gallery/src/generated/interactive/toast-demo.client.js': toastClient,
  '/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js': tooltipClient,
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('compiled interactive gallery demos in the browser', () => {
  it('has no axe violations across the compiled interactive gallery route', async () => {
    const host = document.createElement('div');
    host.innerHTML = renderInteractiveGalleryRoute();
    document.body.append(host);

    await expectNoAxeViolations(host);
  });

  it('has no axe violations in representative generated interactive states', async () => {
    const dropdownRoot = mountInteractiveDemo(GalleryDropdownMenuDemo);
    const dropdownTrigger = required(
      dropdownRoot.querySelector<HTMLButtonElement>('#gallery-dropdown-menu-trigger'),
    );
    const dropdownContent = required(
      dropdownRoot.querySelector<HTMLElement>('#gallery-dropdown-menu-content'),
    );
    installGeneratedGalleryLoader(dropdownRoot, { events: ['click', 'keydown'] });

    dropdownTrigger.click();

    await vi.waitFor(() => {
      expect(dropdownContent.hidden).toBe(false);
      expect(dropdownTrigger.getAttribute('aria-expanded')).toBe('true');
    });

    await expectNoAxeViolations(dropdownRoot);

    const commandRoot = mountInteractiveDemo(GalleryCommandDemo);
    const commandTrigger = required(
      commandRoot.querySelector<HTMLButtonElement>('#gallery-command-trigger'),
    );
    const commandDialog = required(
      commandRoot.querySelector<HTMLDialogElement>('#gallery-command-dialog'),
    );
    installGeneratedGalleryLoader(commandRoot, { events: ['click', 'input', 'keydown'] });

    commandTrigger.click();

    await vi.waitFor(() => {
      expect(commandDialog.open).toBe(true);
    });

    await expectNoAxeViolations(commandRoot);

    const fieldRoot = mountInteractiveDemo(GalleryFieldDemo);
    const email = required(
      fieldRoot.querySelector<HTMLInputElement>('#gallery-interactive-field-email-input'),
    );
    const error = required(
      fieldRoot.querySelector<HTMLElement>('#gallery-interactive-field-email-error'),
    );

    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(error.hidden).toBe(false);

    await expectNoAxeViolations(fieldRoot);

    const toastRoot = mountInteractiveDemo(GalleryToastDemo);
    const toast = required(toastRoot.querySelector<HTMLElement>('#gallery-toast'));

    expect(toast.hidden).toBe(false);
    expect(toast.getAttribute('aria-live')).toBe('polite');

    await expectNoAxeViolations(toastRoot);
  });

  it('keeps stable visual baselines for the compiled route and representative states', async () => {
    await page.viewport(900, 700);

    const host = document.createElement('div');
    host.innerHTML = renderInteractiveGalleryRoute();
    installVisualBaselineStyles();
    document.body.append(host);

    const route = required(
      host.querySelector<HTMLElement>('[data-gallery-route="/gallery/interactive"]'),
    );
    const switchDemo = required(
      host.querySelector<HTMLElement>('[data-gallery-interactive-route="switch-demo"]'),
    );
    const menuDemo = required(
      host.querySelector<HTMLElement>('[data-gallery-interactive-route="dropdown-menu-demo"]'),
    );

    expect(visualGeometry(route)).toEqual({
      height: 5442,
      width: 820,
    });
    expect(visualGeometry(switchDemo)).toEqual({
      height: 102,
      width: 780,
    });
    expect(visualGeometry(menuDemo)).toEqual({
      height: 183,
      width: 780,
    });

    expect(await visualBaselineHash(route)).toBe('4cc3e6a7');
    expect(await visualBaselineHash(switchDemo)).toBe('1dc30a6d');
    expect(await visualBaselineHash(menuDemo)).toBe('b19a1055');
  });

  it('keeps stable visual baselines for representative styled static gallery routes', async () => {
    await page.viewport(960, 720);
    installVisualBaselineStyles();

    const tabsRoute = mountStaticGalleryRoute('/components/tabs');
    const selectRoute = mountStaticGalleryRoute('/components/select');
    const tableRoute = mountStaticGalleryRoute('/components/table');
    const commandRoute = mountStaticGalleryRoute('/components/command');
    const checkboxGroupRoute = mountStaticGalleryRoute('/components/checkbox-group');
    const radioGroupRoute = mountStaticGalleryRoute('/components/radio-group');
    const numberFieldRoute = mountStaticGalleryRoute('/components/number-field');
    const otpFieldRoute = mountStaticGalleryRoute('/components/otp-field');
    const sliderRoute = mountStaticGalleryRoute('/components/slider');
    const contextMenuRoute = mountStaticGalleryRoute('/components/context-menu');
    const dropdownMenuRoute = mountStaticGalleryRoute('/components/dropdown-menu');
    const menubarRoute = mountStaticGalleryRoute('/components/menubar');
    const navigationMenuRoute = mountStaticGalleryRoute('/components/navigation-menu');

    expect(visualGeometry(tabsRoute)).toEqual({
      height: 539,
      width: 860,
    });
    expect(visualGeometry(selectRoute)).toEqual({
      height: 532,
      width: 860,
    });
    expect(visualGeometry(tableRoute)).toEqual({
      height: 591,
      width: 860,
    });
    expect(visualGeometry(commandRoute)).toEqual({
      height: 512,
      width: 860,
    });
    expect(visualGeometry(checkboxGroupRoute)).toEqual({
      height: 713,
      width: 860,
    });
    expect(visualGeometry(radioGroupRoute)).toEqual({
      height: 545,
      width: 860,
    });
    expect(visualGeometry(numberFieldRoute)).toEqual({
      height: 648,
      width: 860,
    });
    expect(visualGeometry(otpFieldRoute)).toEqual({
      height: 700,
      width: 860,
    });
    expect(visualGeometry(sliderRoute)).toEqual({
      height: 637,
      width: 860,
    });
    expect(visualGeometry(contextMenuRoute)).toEqual({
      height: 531,
      width: 860,
    });
    expect(visualGeometry(dropdownMenuRoute)).toEqual({
      height: 540,
      width: 860,
    });
    expect(visualGeometry(menubarRoute)).toEqual({
      height: 551,
      width: 860,
    });
    expect(visualGeometry(navigationMenuRoute)).toEqual({
      height: 561,
      width: 860,
    });

    expect(await visualBaselineHash(tabsRoute)).toBe('9044926b');
    expect(await visualBaselineHash(selectRoute)).toBe('e0f770a7');
    expect(await visualBaselineHash(tableRoute)).toBe('09f0362a');
    expect(await visualBaselineHash(commandRoute)).toBe('d46c4bd3');
    expect(await visualBaselineHash(checkboxGroupRoute)).toBe('e9a5f503');
    expect(await visualBaselineHash(radioGroupRoute)).toBe('80d7704e');
    expect(await visualBaselineHash(numberFieldRoute)).toBe('d5277948');
    expect(await visualBaselineHash(otpFieldRoute)).toBe('6b72f908');
    expect(await visualBaselineHash(sliderRoute)).toBe('5ff031a5');
    expect(await visualBaselineHash(contextMenuRoute)).toBe('08c100b6');
    expect(await visualBaselineHash(dropdownMenuRoute)).toBe('bc8bc631');
    expect(await visualBaselineHash(menubarRoute)).toBe('279cb945');
    expect(await visualBaselineHash(navigationMenuRoute)).toBe('3c8e6a99');
  });

  it('updates accordion ARIA and panel visibility through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryAccordionDemo);
    const shipping = required(
      root.querySelector<HTMLButtonElement>('#gallery-accordion-shipping-trigger'),
    );
    const billing = required(
      root.querySelector<HTMLButtonElement>('#gallery-accordion-billing-trigger'),
    );
    const shippingPanel = required(
      root.querySelector<HTMLElement>('#gallery-accordion-shipping-content'),
    );
    const billingPanel = required(
      root.querySelector<HTMLElement>('#gallery-accordion-billing-content'),
    );
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="accordion-value"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root, { events: ['click', 'keydown'] });

    expect(root.getAttribute('fw-state')).toBe('{"value":"shipping"}');
    expect(shipping.getAttribute('aria-expanded')).toBe('true');
    expect(shippingPanel.hidden).toBe(false);
    expect(billing.getAttribute('aria-expanded')).toBe('false');
    expect(billingPanel.hidden).toBe(true);
    expect(output.textContent).toBe('shipping');

    billing.click();

    await vi.waitFor(() => {
      const currentShipping = required(
        root.querySelector<HTMLButtonElement>('#gallery-accordion-shipping-trigger'),
      );
      const currentBilling = required(
        root.querySelector<HTMLButtonElement>('#gallery-accordion-billing-trigger'),
      );
      const currentShippingPanel = required(
        root.querySelector<HTMLElement>('#gallery-accordion-shipping-content'),
      );
      const currentBillingPanel = required(
        root.querySelector<HTMLElement>('#gallery-accordion-billing-content'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="accordion-value"]'),
      );

      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/accordion-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"value":"billing"}');
      expect(currentShipping.getAttribute('aria-expanded')).toBe('false');
      expect(currentShippingPanel.hidden).toBe(true);
      expect(currentBilling.getAttribute('aria-expanded')).toBe('true');
      expect(currentBillingPanel.hidden).toBe(false);
      expect(currentOutput.textContent).toBe('billing');
    });
  });

  it('opens and resolves a native alert dialog through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryAlertDialogDemo);
    const trigger = required(root.querySelector<HTMLButtonElement>('button[command="show-modal"]'));
    const dialog = required(
      root.querySelector<HTMLDialogElement>('#gallery-interactive-alert-dialog-content'),
    );
    const cancel = required(dialog.querySelector<HTMLButtonElement>('[data-intent="cancel"]'));
    const action = required(dialog.querySelector<HTMLButtonElement>('[data-intent="destructive"]'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="alert-dialog-open"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root, { events: ['click', 'keydown'] });

    expect(root.getAttribute('fw-state')).toBe('{"open":false}');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-controls')).toBe('gallery-interactive-alert-dialog-content');
    expect(dialog.open).toBe(false);
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('gallery-interactive-alert-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe(
      'gallery-interactive-alert-dialog-description',
    );
    expect(cancel.autofocus).toBe(true);
    expect(action.getAttribute('command')).toBe('request-close');
    expect(output.textContent).toBe('closed');

    trigger.click();

    await vi.waitFor(() => {
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/alert-dialog-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(dialog.open).toBe(true);
    });

    await vi.waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    cancel.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(dialog.open).toBe(false);
      expect(output.textContent).toBe('closed');
    });

    trigger.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(dialog.open).toBe(true);
    });

    const escapeDialog = required(
      root.querySelector<HTMLDialogElement>('#gallery-interactive-alert-dialog-content'),
    );
    if (escapeDialog.open) escapeDialog.close();

    await vi.waitFor(() => {
      expect(
        required(root.querySelector<HTMLDialogElement>('#gallery-interactive-alert-dialog-content'))
          .open,
      ).toBe(false);
    });

    trigger.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(dialog.open).toBe(true);
    });

    action.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(dialog.open).toBe(false);
    });
  });

  it('updates native select value and display text through a generated change handler', async () => {
    const root = mountInteractiveDemo(GallerySelectDemo);
    const select = required(root.querySelector<HTMLSelectElement>('#gallery-select-control'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-select-form'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="select-value"]'),
    );
    const disabled = required(select.querySelector<HTMLOptionElement>('option[value="drone"]'));
    const standard = required(select.querySelector<HTMLOptionElement>('option[value="standard"]'));
    const express = required(select.querySelector<HTMLOptionElement>('option[value="express"]'));
    const { imports } = installGeneratedGalleryLoader(root, { events: ['change'] });

    expect(root.getAttribute('fw-state')).toBe('{"value":"standard"}');
    expect(form.dataset.galleryForm).toBe('select');
    expect(select.name).toBe('gallery-shipping-speed');
    expect(select.form).toBe(form);
    expect(select.required).toBe(true);
    expect(select.disabled).toBe(false);
    expect(select.hasAttribute('disabled')).toBe(false);
    expect(select.value).toBe('standard');
    expect(select.getAttribute('aria-labelledby')).toBe('gallery-select-label');
    expect(standard.selected).toBe(true);
    expect(standard.hasAttribute('selected')).toBe(true);
    expect(express.selected).toBe(false);
    expect(express.hasAttribute('selected')).toBe(false);
    expect(disabled.disabled).toBe(true);
    expect(output.textContent).toBe('Standard');
    expect(new FormData(form).get('gallery-shipping-speed')).toBe('standard');

    select.value = 'express';
    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      const currentSelect = required(
        root.querySelector<HTMLSelectElement>('#gallery-select-control'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="select-value"]'),
      );

      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/select-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"value":"express"}');
      expect(currentSelect.value).toBe('express');
      expect(new FormData(form).get('gallery-shipping-speed')).toBe('express');
      expect(currentOutput.textContent).toBe('Express');
    });

    const currentSelect = required(
      root.querySelector<HTMLSelectElement>('#gallery-select-control'),
    );
    currentSelect.value = 'drone';
    const disabledChange = new Event('change', { bubbles: true, cancelable: true });
    currentSelect.dispatchEvent(disabledChange);

    await vi.waitFor(() => {
      const restoredSelect = required(
        root.querySelector<HTMLSelectElement>('#gallery-select-control'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="select-value"]'),
      );

      expect(disabledChange.defaultPrevented).toBe(true);
      expect(root.getAttribute('fw-state')).toBe('{"value":"express"}');
      expect(restoredSelect.value).toBe('express');
      expect(new FormData(form).get('gallery-shipping-speed')).toBe('express');
      expect(currentOutput.textContent).toBe('Express');
    });
  });

  it('updates combobox listbox ARIA and selected value through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryComboboxDemo);
    const input = required(root.querySelector<HTMLInputElement>('#gallery-combobox-input'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-combobox-form'));
    const listbox = required(root.querySelector<HTMLElement>('#gallery-combobox-listbox'));
    const chicago = required(
      root.querySelector<HTMLButtonElement>('#gallery-combobox-listbox-option-2'),
    );
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="combobox-value"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root, {
      events: ['click', 'input', 'keydown'],
    });

    expect(root.getAttribute('fw-state')).toBe(
      '{"highlightedValue":"austin","open":false,"value":"austin"}',
    );
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBe('gallery-combobox-listbox');
    expect(input.name).toBe('gallery-city');
    expect(input.form).toBe(form);
    expect(input.value).toBe('austin');
    expect(new FormData(form).get('gallery-city')).toBe('austin');
    expect(listbox.hidden).toBe(true);
    expect(chicago.getAttribute('role')).toBe('option');
    expect(output.textContent).toBe('Austin');

    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-combobox-input'),
      );
      const currentListbox = required(root.querySelector<HTMLElement>('#gallery-combobox-listbox'));
      const currentChicago = required(
        root.querySelector<HTMLButtonElement>('#gallery-combobox-listbox-option-2'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="combobox-value"]'),
      );

      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/combobox-demo.client.js',
      );
      expect(root.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"chicago","open":true,"value":"chicago"}',
      );
      expect(currentInput.getAttribute('aria-expanded')).toBe('true');
      expect(currentInput.getAttribute('aria-activedescendant')).toBe(
        'gallery-combobox-listbox-option-2',
      );
      expect(currentInput.value).toBe('chicago');
      expect(new FormData(form).get('gallery-city')).toBe('chicago');
      expect(currentListbox.hidden).toBe(false);
      expect(currentChicago.getAttribute('data-highlighted')).toBe('');
      expect(currentChicago.getAttribute('aria-selected')).toBe('true');
      expect(currentOutput.textContent).toBe('Chicago city');
    });

    required(root.querySelector<HTMLInputElement>('#gallery-combobox-input')).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
    );

    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-combobox-input'),
      );
      const currentListbox = required(root.querySelector<HTMLElement>('#gallery-combobox-listbox'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="combobox-value"]'),
      );

      expect(root.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"chicago","open":false,"value":"chicago"}',
      );
      expect(currentInput.getAttribute('aria-expanded')).toBe('false');
      expect(currentInput.value).toBe('chicago');
      expect(new FormData(form).get('gallery-city')).toBe('chicago');
      expect(currentListbox.hidden).toBe(true);
      expect(currentOutput.textContent).toBe('Chicago city');
    });

    required(root.querySelector<HTMLButtonElement>('#gallery-combobox-listbox-option-0')).click();

    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-combobox-input'),
      );
      const currentListbox = required(root.querySelector<HTMLElement>('#gallery-combobox-listbox'));

      expect(root.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"austin","open":false,"value":"austin"}',
      );
      expect(currentInput.value).toBe('austin');
      expect(new FormData(form).get('gallery-city')).toBe('austin');
      expect(currentListbox.hidden).toBe(true);
    });
  });

  it('updates autocomplete datalist suggestions and value through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryAutocompleteDemo);
    const input = required(root.querySelector<HTMLInputElement>('#gallery-autocomplete-input'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-autocomplete-form'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="autocomplete-value"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root, {
      events: ['click', 'input', 'keydown'],
    });

    expect(root.getAttribute('fw-state')).toBe(
      '{"highlightedValue":"design","inputValue":"de","open":false,"value":"design"}',
    );
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBe('gallery-autocomplete-list');
    expect(input.name).toBe('gallery-tag');
    expect(input.form).toBe(form);
    expect(input.value).toBe('de');
    expect(new FormData(form).get('gallery-tag')).toBe('de');
    expect(output.textContent).toBe('Design');

    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-autocomplete-input'),
      );
      const currentDevelopment = required(
        root.querySelector<HTMLOptionElement>('#gallery-autocomplete-list-option-0'),
      );

      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js',
      );
      expect(root.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"development","inputValue":"dev","open":true,"value":"design"}',
      );
      expect(currentInput.getAttribute('aria-expanded')).toBe('true');
      expect(currentInput.getAttribute('aria-activedescendant')).toBe(
        'gallery-autocomplete-list-option-0',
      );
      expect(currentInput.value).toBe('dev');
      expect(new FormData(form).get('gallery-tag')).toBe('dev');
      expect(currentDevelopment.value).toBe('development');
      expect(currentDevelopment.getAttribute('data-highlighted')).toBe('');
    });

    required(root.querySelector<HTMLInputElement>('#gallery-autocomplete-input')).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
    );

    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-autocomplete-input'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="autocomplete-value"]'),
      );

      expect(root.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"development","inputValue":"development","open":false,"value":"development"}',
      );
      expect(currentInput.getAttribute('aria-expanded')).toBe('false');
      expect(currentInput.value).toBe('development');
      expect(new FormData(form).get('gallery-tag')).toBe('development');
      expect(currentOutput.textContent).toBe('Development');
    });

    required(
      root.querySelector<HTMLOptionElement>('#gallery-autocomplete-list-option-0'),
    ).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-autocomplete-input'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="autocomplete-value"]'),
      );

      expect(root.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"development","inputValue":"development","open":false,"value":"development"}',
      );
      expect(currentInput.value).toBe('development');
      expect(new FormData(form).get('gallery-tag')).toBe('development');
      expect(currentOutput.textContent).toBe('Development');
    });
  });

  it('updates toggle stamped state from generated click and keyboard handlers', async () => {
    const root = mountInteractiveDemo(GalleryToggleDemo);
    const { imports } = installGeneratedGalleryLoader(root);
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="pressed"]'));

    expect(imports).toEqual([]);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('data-state')).toBe('off');
    expect(output.textContent).toBe('off');

    button.click();

    await vi.waitFor(() => {
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/toggle-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"pressed":true}');
    });

    button.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"pressed":false}');
    });
  });

  it('updates checkbox stamped and native checked state through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryCheckboxDemo);
    const input = required(root.querySelector<HTMLInputElement>('input'));
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="checked"]'));
    installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"checked":"indeterminate"}');
    expect(input.getAttribute('aria-checked')).toBe('mixed');
    applyCheckboxIndeterminate(input, 'indeterminate');
    expect(input.indeterminate).toBe(true);
    expect(output.textContent).toBe('indeterminate');

    input.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"checked":true}');
      expect(input.checked).toBe(true);
      expect(input.indeterminate).toBe(false);
    });

    input.focus();
    await userEvent.keyboard('{Space}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"checked":false}');
      expect(input.checked).toBe(false);
      expect(input.indeterminate).toBe(false);
    });
  });

  it('updates checkbox-group ARIA, roving tabindex, and native checked state', async () => {
    const root = mountInteractiveDemo(GalleryCheckboxGroupDemo);
    const updates = required(
      root.querySelector<HTMLInputElement>('#gallery-checkbox-group-updates'),
    );
    const billing = required(
      root.querySelector<HTMLInputElement>('#gallery-checkbox-group-billing'),
    );
    installGeneratedGalleryLoader(root, { events: ['click', 'input', 'change', 'keydown'] });

    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-labelledby')).toBe('gallery-checkbox-group-label');
    expect(root.getAttribute('fw-state')).toBe('{"activeValue":"updates","value":"updates"}');
    const form = required(root.querySelector<HTMLFormElement>('#gallery-checkbox-group-form'));
    expect(new FormData(form).getAll('gallery-notifications')).toEqual(['updates']);
    expect(updates.name).toBe('gallery-notifications');
    expect(updates.form).toBe(form);
    expect(updates.checked).toBe(true);
    expect(updates.getAttribute('aria-checked')).toBe('true');
    expect(updates.tabIndex).toBe(0);
    expect(billing.checked).toBe(false);
    expect(billing.getAttribute('aria-checked')).toBe('false');
    expect(billing.tabIndex).toBe(-1);

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    await vi.waitFor(() => {
      const currentUpdates = required(
        root.querySelector<HTMLInputElement>('#gallery-checkbox-group-updates'),
      );
      const currentBilling = required(
        root.querySelector<HTMLInputElement>('#gallery-checkbox-group-billing'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"activeValue":"billing","value":"updates"}');
      expect(currentUpdates.tabIndex).toBe(-1);
      expect(currentBilling.tabIndex).toBe(0);
      expect(document.activeElement).toBe(currentBilling);
    });

    required(root.querySelector<HTMLInputElement>('#gallery-checkbox-group-billing')).click();

    await vi.waitFor(() => {
      const currentUpdates = required(
        root.querySelector<HTMLInputElement>('#gallery-checkbox-group-updates'),
      );
      const currentBilling = required(
        root.querySelector<HTMLInputElement>('#gallery-checkbox-group-billing'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="checkbox-group-value"]'),
      );

      expect(root.getAttribute('fw-state')).toBe(
        '{"activeValue":"billing","value":"updates,billing"}',
      );
      expect(currentUpdates.checked).toBe(true);
      expect(currentBilling.checked).toBe(true);
      expect(currentBilling.getAttribute('aria-checked')).toBe('true');
      expect(currentOutput.textContent).toBe('updates,billing');
      expect(new FormData(form).getAll('gallery-notifications')).toEqual(['updates', 'billing']);
    });
  });

  it('updates disclosure stamped state from generated click and keyboard handlers', async () => {
    const root = mountInteractiveDemo(GalleryDisclosureDemo);
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const panel = required(
      root.querySelector<HTMLElement>('#gallery-interactive-disclosure-panel'),
    );
    installGeneratedGalleryLoader(root);

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('gallery-interactive-disclosure-panel');
    expect(panel.hidden).toBe(true);

    button.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
    });

    button.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
    });
  });

  it('updates number-field stamped state and form data through generated input and steppers', async () => {
    const root = mountInteractiveDemo(GalleryNumberFieldDemo);
    const form = root as HTMLFormElement;
    const input = required(root.querySelector<HTMLInputElement>('input'));
    const increment = required(root.querySelector<HTMLButtonElement>('[data-action="increment"]'));
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="value"]'));
    const { imports } = installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"value":2}');
    expect(input.type).toBe('number');
    expect(input.name).toBe('gallery-seat-count');
    expect(input.form).toBe(form);
    expect(input.required).toBe(true);
    expect(input.value).toBe('2');
    expect(output.textContent).toBe('2');
    expect(new FormData(form).get('gallery-seat-count')).toBe('2');

    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/number-field-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"value":4}');
      expect(output.textContent).toBe('4');
      expect(new FormData(form).get('gallery-seat-count')).toBe('4');
    });

    increment.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"value":5}');
      expect(new FormData(form).get('gallery-seat-count')).toBe('5');
    });

    required(root.querySelector<HTMLButtonElement>('[data-action="decrement"]')).click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"value":4}');
      expect(new FormData(form).get('gallery-seat-count')).toBe('4');
    });
  });

  it('updates field IDREF, native select, and fieldset state through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryFieldDemo);
    const form = root as HTMLFormElement;
    const email = required(
      root.querySelector<HTMLInputElement>('#gallery-interactive-field-email-input'),
    );
    const emailError = required(
      root.querySelector<HTMLElement>('#gallery-interactive-field-email-error'),
    );
    const emailOutput = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="field-email"]'),
    );
    const plan = required(
      root.querySelector<HTMLSelectElement>('#gallery-interactive-field-plan-select'),
    );
    const planOutput = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="field-plan"]'),
    );
    const fieldset = required(
      root.querySelector<HTMLFieldSetElement>('#gallery-interactive-fieldset'),
    );
    const seat = required(root.querySelector<HTMLInputElement>('input[name="gallery-seat"]'));
    const shippingToggle = required(
      root.querySelector<HTMLInputElement>('input[name="gallery-shipping-disabled"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root, {
      events: ['input', 'change', 'click'],
    });

    expect(root.getAttribute('fw-state')).toBe(
      '{"email":"ada@example","invalid":true,"plan":"team","shippingDisabled":false}',
    );
    expect(root.id).toBe('gallery-interactive-field-form');
    expect(email.name).toBe('gallery-email');
    expect(email.form).toBe(form);
    expect(email.pattern).toBe('.+@jiso\\.dev');
    expect(email.required).toBe(true);
    expect(email.value).toBe('ada@example');
    expect(email.checkValidity()).toBe(false);
    expect(email.getAttribute('aria-describedby')).toBe(
      'gallery-interactive-field-email-description gallery-interactive-field-email-error',
    );
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(emailError.getAttribute('role')).toBe('alert');
    expect(emailError.hidden).toBe(false);
    expect(emailOutput.textContent).toBe('ada@example');
    expect(plan.name).toBe('gallery-plan');
    expect(plan.form).toBe(form);
    expect(plan.required).toBe(true);
    expect(plan.value).toBe('team');
    expect(planOutput.textContent).toBe('team');
    expect(fieldset.getAttribute('aria-describedby')).toBe(
      'gallery-interactive-fieldset-description',
    );
    expect(fieldset.form).toBe(form);
    expect(fieldset.name).toBe('gallery-shipping');
    expect(fieldset.disabled).toBe(false);
    expect(seat.form).toBe(form);
    expect(seat.value).toBe('window');
    expect(new FormData(form).get('gallery-email')).toBe('ada@example');
    expect(new FormData(form).get('gallery-plan')).toBe('team');
    expect(new FormData(form).get('gallery-seat')).toBe('window');

    email.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      const currentEmail = required(
        root.querySelector<HTMLInputElement>('#gallery-interactive-field-email-input'),
      );
      const currentError = required(
        root.querySelector<HTMLElement>('#gallery-interactive-field-email-error'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="field-email"]'),
      );

      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/field-demo.client.js',
      );
      expect(root.getAttribute('fw-state')).toBe(
        '{"email":"ada@jiso.dev","invalid":false,"plan":"team","shippingDisabled":false}',
      );
      expect(currentEmail.value).toBe('ada@jiso.dev');
      expect(currentEmail.checkValidity()).toBe(true);
      expect(new FormData(form).get('gallery-email')).toBe('ada@jiso.dev');
      expect(currentEmail.getAttribute('aria-describedby')).toBe(
        'gallery-interactive-field-email-description',
      );
      expect(currentEmail.hasAttribute('aria-invalid')).toBe(false);
      expect(currentError.hidden).toBe(true);
      expect(currentOutput.textContent).toBe('ada@jiso.dev');
    });

    required(
      root.querySelector<HTMLSelectElement>('#gallery-interactive-field-plan-select'),
    ).dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      const currentPlan = required(
        root.querySelector<HTMLSelectElement>('#gallery-interactive-field-plan-select'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="field-plan"]'),
      );

      expect(root.getAttribute('fw-state')).toBe(
        '{"email":"ada@jiso.dev","invalid":false,"plan":"enterprise","shippingDisabled":false}',
      );
      expect(currentPlan.value).toBe('enterprise');
      expect(new FormData(form).get('gallery-plan')).toBe('enterprise');
      expect(currentOutput.textContent).toBe('enterprise');
    });

    shippingToggle.click();

    await vi.waitFor(() => {
      const currentFieldset = required(
        root.querySelector<HTMLFieldSetElement>('#gallery-interactive-fieldset'),
      );
      const currentToggle = required(
        root.querySelector<HTMLInputElement>('input[name="gallery-shipping-disabled"]'),
      );

      expect(root.getAttribute('fw-state')).toBe(
        '{"email":"ada@jiso.dev","invalid":false,"plan":"enterprise","shippingDisabled":true}',
      );
      expect(currentFieldset.disabled).toBe(true);
      expect(currentFieldset.getAttribute('data-disabled')).toBe('');
      expect(currentToggle.checked).toBe(true);
      expect(new FormData(form).get('gallery-seat')).toBeNull();
      expect(new FormData(form).get('gallery-shipping-disabled')).toBe('on');
    });

    required(
      root.querySelector<HTMLInputElement>('input[name="gallery-shipping-disabled"]'),
    ).click();

    await vi.waitFor(() => {
      const currentFieldset = required(
        root.querySelector<HTMLFieldSetElement>('#gallery-interactive-fieldset'),
      );
      const currentToggle = required(
        root.querySelector<HTMLInputElement>('input[name="gallery-shipping-disabled"]'),
      );

      expect(root.getAttribute('fw-state')).toBe(
        '{"email":"ada@jiso.dev","invalid":false,"plan":"enterprise","shippingDisabled":false}',
      );
      expect(currentFieldset.disabled).toBe(false);
      expect(currentFieldset.hasAttribute('data-disabled')).toBe(false);
      expect(currentToggle.checked).toBe(false);
      expect(new FormData(form).get('gallery-seat')).toBe('window');
      expect(new FormData(form).get('gallery-shipping-disabled')).toBeNull();
    });
  });

  it('updates OTP aggregate value, visible slots, and focus through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryOtpFieldDemo);
    const form = required(root.querySelector<HTMLFormElement>('#gallery-otp-form'));
    const hidden = required(
      root.querySelector<HTMLInputElement>('#gallery-interactive-otp-hidden'),
    );
    const first = required(root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-0'));
    const second = required(
      root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-1'),
    );
    const third = required(root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-2'));
    const fourth = required(
      root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-3'),
    );
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="otp-value"]'));
    const { imports } = installGeneratedGalleryLoader(root, { events: ['input', 'keydown'] });

    expect(root.getAttribute('fw-state')).toBe('{"activeSlot":2,"value":"12"}');
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-labelledby')).toBe('gallery-interactive-otp-label');
    expect(hidden.form).toBe(form);
    expect(hidden.name).toBe('gallery-otp-code');
    expect(hidden.value).toBe('12');
    expect(new FormData(form).get('gallery-otp-code')).toBe('12');
    expect(first.value).toBe('1');
    expect(second.value).toBe('2');
    expect(third.value).toBe('');
    expect(output.textContent).toBe('12');

    third.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js',
      );
      expect(root.getAttribute('fw-state')).toBe('{"activeSlot":3,"value":"123"}');
      expect(hidden.value).toBe('123');
      expect(new FormData(form).get('gallery-otp-code')).toBe('123');
      expect(third.value).toBe('3');
      expect(third.getAttribute('data-filled')).toBe('');
      expect(fourth.tabIndex).toBe(0);
      expect(output.textContent).toBe('123');
    });

    fourth.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"activeSlot":3,"value":"1234"}');
      expect(root.getAttribute('data-complete')).toBe('');
      expect(hidden.value).toBe('1234');
      expect(new FormData(form).get('gallery-otp-code')).toBe('1234');
      expect(fourth.value).toBe('4');
      expect(fourth.getAttribute('data-complete')).toBe('');
      expect(output.textContent).toBe('1234');
    });
  });

  it('opens and closes a native dialog through generated handlers and invoker attributes', async () => {
    const root = mountInteractiveDemo(GalleryDialogDemo);
    const trigger = required(root.querySelector<HTMLButtonElement>('button[command="show-modal"]'));
    const dialog = required(root.querySelector<HTMLDialogElement>('#gallery-dialog-content'));
    const close = required(
      dialog.querySelector<HTMLButtonElement>('button[command="request-close"]'),
    );
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="open"]'));
    const { imports } = installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"open":false}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('gallery-dialog-content');
    expect(dialog.open).toBe(false);
    expect(dialog.getAttribute('aria-labelledby')).toBe('gallery-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('gallery-dialog-description');
    expect(output.textContent).toBe('closed');

    trigger.click();

    await vi.waitFor(() => {
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/dialog-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(dialog.open).toBe(true);
    });

    await vi.waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    close.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(dialog.open).toBe(false);
    });

    trigger.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(dialog.open).toBe(true);
    });

    const escapeDialog = required(root.querySelector<HTMLDialogElement>('#gallery-dialog-content'));
    if (escapeDialog.open) escapeDialog.close();

    await vi.waitFor(() => {
      expect(required(root.querySelector<HTMLDialogElement>('#gallery-dialog-content')).open).toBe(
        false,
      );
    });
  });

  it('updates switch stamped state while native checked state moves in the browser', async () => {
    const form = document.createElement('form');
    form.id = 'gallery-switch-form';
    form.dataset.galleryForm = 'switch';
    document.body.append(form);

    const root = mountInteractiveDemo(GallerySwitchDemo);
    const input = required(root.querySelector<HTMLInputElement>('input'));
    installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"checked":false}');
    expect(input.form).toBe(form);
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.checked).toBe(false);
    expect(new FormData(form).get('gallery-notifications')).toBeNull();

    input.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"checked":true}');
      expect(input.checked).toBe(true);
      expect(new FormData(form).get('gallery-notifications')).toBe('enabled');
    });

    input.focus();
    await userEvent.keyboard('{Space}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"checked":false}');
      expect(input.checked).toBe(false);
      expect(new FormData(form).get('gallery-notifications')).toBeNull();
    });
  });

  it('updates collapsible stamped state while native details open state moves', async () => {
    const root = mountInteractiveDemo(GalleryCollapsibleDemo) as HTMLDetailsElement;
    const summary = required(root.querySelector<HTMLElement>('summary'));
    const content = required(root.querySelector<HTMLElement>('#gallery-collapsible-content'));
    installGeneratedGalleryLoader(root);

    expect(root.open).toBe(false);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(content.id).toBe('gallery-collapsible-content');

    summary.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(root.open).toBe(true);
    });

    summary.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(root.open).toBe(false);
    });
  });

  it('updates popover stamped state while native top-layer state moves', async () => {
    const root = mountInteractiveDemo(GalleryPopoverDemo);
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const content = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
    installGeneratedGalleryLoader(root);

    expect(button.getAttribute('popovertarget')).toBe('gallery-popover-content');
    expect(content.matches(':popover-open')).toBe(false);

    button.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(content.matches(':popover-open')).toBe(true);
    });

    button.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(content.matches(':popover-open')).toBe(false);
    });

    button.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(content.matches(':popover-open')).toBe(true);
    });

    const escapeContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
    if (escapeContent.matches(':popover-open')) {
      escapeContent.hidePopover();
    }

    await vi.waitFor(() => {
      expect(
        required(root.querySelector<HTMLElement>('#gallery-popover-content')).matches(
          ':popover-open',
        ),
      ).toBe(false);
    });
  });

  it('updates radio-group selection from keyboard and native radio clicks', async () => {
    const root = mountInteractiveDemo(GalleryRadioGroupDemo);
    const email = required(root.querySelector<HTMLInputElement>('#gallery-radio-email'));
    const phone = required(root.querySelector<HTMLInputElement>('#gallery-radio-phone'));
    const sms = required(root.querySelector<HTMLInputElement>('#gallery-radio-sms'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-radio-form'));
    const { imports } = installGeneratedGalleryLoader(root, {
      events: ['click', 'input', 'change', 'keydown'],
    });

    expect(root.getAttribute('role')).toBe('radiogroup');
    expect(root.getAttribute('aria-required')).toBe('true');
    expect(root.getAttribute('fw-state')).toBe('{"value":"email"}');
    expect(form.dataset.galleryForm).toBe('radio-group');
    expect(email.name).toBe('gallery-contact-channel');
    expect(email.form).toBe(form);
    expect(email.required).toBe(true);
    expect(email.checked).toBe(true);
    expect(email.tabIndex).toBe(0);
    expect(phone.disabled).toBe(true);
    expect(phone.checked).toBe(false);
    expect(phone.tabIndex).toBe(-1);
    expect(phone.getAttribute('data-disabled')).toBe('');
    expect(sms.checked).toBe(false);
    expect(new FormData(form).get('gallery-contact-channel')).toBe('email');
    expect(sms.tabIndex).toBe(-1);

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    await vi.waitFor(() => {
      const currentEmail = required(root.querySelector<HTMLInputElement>('#gallery-radio-email'));
      const currentPhone = required(root.querySelector<HTMLInputElement>('#gallery-radio-phone'));
      const currentSms = required(root.querySelector<HTMLInputElement>('#gallery-radio-sms'));
      const currentForm = required(root.querySelector<HTMLFormElement>('#gallery-radio-form'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="radio-value"]'),
      );

      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js',
      );
      expect(root.getAttribute('fw-state')).toBe('{"value":"sms"}');
      expect(currentEmail.checked).toBe(false);
      expect(currentEmail.tabIndex).toBe(-1);
      expect(currentPhone.checked).toBe(false);
      expect(currentPhone.tabIndex).toBe(-1);
      expect(currentSms.checked).toBe(true);
      expect(currentSms.tabIndex).toBe(0);
      expect(new FormData(currentForm).get('gallery-contact-channel')).toBe('sms');
      expect(currentOutput.textContent).toBe('sms');
    });

    required(root.querySelector<HTMLInputElement>('#gallery-radio-email')).click();

    await vi.waitFor(() => {
      const currentEmail = required(root.querySelector<HTMLInputElement>('#gallery-radio-email'));
      const currentSms = required(root.querySelector<HTMLInputElement>('#gallery-radio-sms'));
      const currentForm = required(root.querySelector<HTMLFormElement>('#gallery-radio-form'));

      expect(root.getAttribute('fw-state')).toBe('{"value":"email"}');
      expect(currentEmail.checked).toBe(true);
      expect(currentSms.checked).toBe(false);
      expect(new FormData(currentForm).get('gallery-contact-channel')).toBe('email');
    });
  });

  it('updates slider stamped state while the native range input moves', async () => {
    const root = mountInteractiveDemo(GallerySliderDemo);
    const input = required(root.querySelector<HTMLInputElement>('#gallery-slider-input'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-slider-form'));
    const range = required(root.querySelector<HTMLElement>('[data-part="range"]'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="slider-value"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root, { events: ['input'] });

    expect(root.getAttribute('fw-state')).toBe('{"value":25}');
    expect(root.getAttribute('data-value')).toBe('25');
    expect(input.type).toBe('range');
    expect(input.form).toBe(form);
    expect(input.name).toBe('gallery-completion');
    expect(input.value).toBe('25');
    expect(new FormData(form).get('gallery-completion')).toBe('25');
    expect(input.getAttribute('aria-valuetext')).toBe('25 percent');
    expect(range.getAttribute('data-value-ratio')).toBe('0.25');
    expect(output.textContent).toBe('25');

    input.value = '63';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      const currentInput = required(root.querySelector<HTMLInputElement>('#gallery-slider-input'));
      const currentRange = required(root.querySelector<HTMLElement>('[data-part="range"]'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="slider-value"]'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"value":75}');
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/slider-demo.client.js',
      ]);
      expect(root.getAttribute('data-value')).toBe('75');
      expect(currentInput.value).toBe('75');
      expect(new FormData(form).get('gallery-completion')).toBe('75');
      expect(currentInput.getAttribute('data-value')).toBe('75');
      expect(currentInput.getAttribute('aria-valuetext')).toBe('75 percent');
      expect(currentRange.getAttribute('data-value-ratio')).toBe('0.75');
      expect(currentOutput.textContent).toBe('75');
    });
  });

  it('updates scroll-area viewport position and primitive state through a generated handler', async () => {
    const root = mountInteractiveDemo(GalleryScrollAreaDemo);
    const viewport = required(root.querySelector<HTMLElement>('#gallery-scroll-area-viewport'));
    const scrollbar = required(root.querySelector<HTMLElement>('#gallery-scroll-area-scrollbar'));
    const thumb = required(root.querySelector<HTMLElement>('#gallery-scroll-area-thumb'));
    const corner = required(root.querySelector<HTMLElement>('#gallery-scroll-area-corner'));
    const button = required(root.querySelector<HTMLButtonElement>('#gallery-scroll-area-toggle'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="scroll-area-position"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"position":"top"}');
    expect(root.getAttribute('data-scrollbars')).toBe('vertical');
    expect(viewport.getAttribute('role')).toBe('region');
    expect(viewport.getAttribute('aria-label')).toBe('Release notes');
    expect(viewport.tabIndex).toBe(0);
    expect(viewport.scrollTop).toBe(0);
    expect(viewport.getAttribute('data-scroll-position')).toBe('top');
    expect(scrollbar.getAttribute('aria-hidden')).toBe('true');
    expect(scrollbar.getAttribute('data-orientation')).toBe('vertical');
    expect(scrollbar.getAttribute('data-state')).toBe('visible');
    expect(thumb.getAttribute('data-scroll-position')).toBe('top');
    expect(corner.hidden).toBe(true);
    expect(button.getAttribute('aria-controls')).toBe('gallery-scroll-area-viewport');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(output.textContent).toBe('top');

    button.click();

    await vi.waitFor(() => {
      const currentViewport = required(
        root.querySelector<HTMLElement>('#gallery-scroll-area-viewport'),
      );
      const currentThumb = required(root.querySelector<HTMLElement>('#gallery-scroll-area-thumb'));
      const currentButton = required(
        root.querySelector<HTMLButtonElement>('#gallery-scroll-area-toggle'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="scroll-area-position"]'),
      );

      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/scroll-area-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"position":"end"}');
      expect(currentViewport.scrollTop).toBe(160);
      expect(currentViewport.getAttribute('data-scroll-position')).toBe('end');
      expect(currentThumb.getAttribute('data-scroll-position')).toBe('end');
      expect(currentButton.getAttribute('aria-pressed')).toBe('true');
      expect(currentButton.textContent).toBe('Back to top');
      expect(currentOutput.textContent).toBe('end');
    });
  });

  it('updates progress native value and indeterminate state through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryProgressDemo);
    const progress = required(root.querySelector<HTMLProgressElement>('#gallery-progress-value'));
    const complete = required(root.querySelector<HTMLButtonElement>('button'));
    const pending = required(root.querySelectorAll<HTMLButtonElement>('button').item(1));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="progress-value"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"value":40}');
    expect(progress.max).toBe(100);
    expect(progress.value).toBe(40);
    expect(progress.getAttribute('data-state')).toBe('loading');
    expect(progress.getAttribute('aria-valuetext')).toBe('40 percent uploaded');
    expect(output.textContent).toBe('40%');

    complete.click();

    await vi.waitFor(() => {
      const currentProgress = required(
        root.querySelector<HTMLProgressElement>('#gallery-progress-value'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="progress-value"]'),
      );

      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/progress-demo.client.js',
      );
      expect(root.getAttribute('fw-state')).toBe('{"value":100}');
      expect(currentProgress.value).toBe(100);
      expect(currentProgress.getAttribute('data-state')).toBe('complete');
      expect(currentProgress.getAttribute('aria-valuetext')).toBe('100 percent uploaded');
      expect(currentOutput.textContent).toBe('100%');
    });

    pending.click();

    await vi.waitFor(() => {
      const currentProgress = required(
        root.querySelector<HTMLProgressElement>('#gallery-progress-value'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="progress-value"]'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"value":null}');
      expect(currentProgress.hasAttribute('value')).toBe(false);
      expect(currentProgress.getAttribute('data-state')).toBe('indeterminate');
      expect(currentProgress.getAttribute('aria-valuetext')).toBe('Upload pending');
      expect(currentOutput.textContent).toBe('pending');
    });
  });

  it('updates meter native value and qualitative state through a generated handler', async () => {
    const root = mountInteractiveDemo(GalleryMeterDemo);
    const meter = required(root.querySelector<HTMLMeterElement>('#gallery-meter-value'));
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="meter-value"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"value":72}');
    expect(meter.min).toBe(0);
    expect(meter.max).toBe(100);
    expect(meter.low).toBe(40);
    expect(meter.high).toBe(80);
    expect(meter.optimum).toBe(90);
    expect(meter.value).toBe(72);
    expect(meter.getAttribute('data-state')).toBe('suboptimum');
    expect(meter.getAttribute('aria-valuetext')).toBe('72 percent capacity');
    expect(output.textContent).toBe('72');

    button.click();

    await vi.waitFor(() => {
      const currentMeter = required(root.querySelector<HTMLMeterElement>('#gallery-meter-value'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="meter-value"]'),
      );

      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/meter-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"value":92}');
      expect(currentMeter.value).toBe(92);
      expect(currentMeter.getAttribute('data-state')).toBe('optimum');
      expect(currentMeter.getAttribute('aria-valuetext')).toBe('92 percent capacity');
      expect(currentOutput.textContent).toBe('92');
    });
  });

  it('updates tabs stamped state from generated click and manual keyboard handlers', async () => {
    const root = mountInteractiveDemo(GalleryTabsDemo);
    const overview = required(
      root.querySelector<HTMLButtonElement>('#gallery-tabs-overview-trigger'),
    );
    const details = required(
      root.querySelector<HTMLButtonElement>('#gallery-tabs-details-trigger'),
    );
    const audit = required(root.querySelector<HTMLButtonElement>('#gallery-tabs-audit-trigger'));
    const overviewPanel = required(root.querySelector<HTMLElement>('#gallery-tabs-overview-panel'));
    const detailsPanel = required(root.querySelector<HTMLElement>('#gallery-tabs-details-panel'));
    const auditPanel = required(root.querySelector<HTMLElement>('#gallery-tabs-audit-panel'));
    const { imports } = installGeneratedGalleryLoader(root, { events: ['click', 'keydown'] });

    expect(root.getAttribute('fw-state')).toBe('{"activeValue":"overview","value":"overview"}');
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(overview.tabIndex).toBe(0);
    expect(details.getAttribute('aria-selected')).toBe('false');
    expect(details.tabIndex).toBe(-1);
    expect(audit.disabled).toBe(true);
    expect(audit.getAttribute('aria-selected')).toBe('false');
    expect(audit.getAttribute('data-disabled')).toBe('');
    expect(audit.tabIndex).toBe(-1);
    expect(overviewPanel.hidden).toBe(false);
    expect(detailsPanel.hidden).toBe(true);
    expect(auditPanel.hidden).toBe(true);

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    await vi.waitFor(() => {
      const currentOverview = required(
        root.querySelector<HTMLButtonElement>('#gallery-tabs-overview-trigger'),
      );
      const currentDetails = required(
        root.querySelector<HTMLButtonElement>('#gallery-tabs-details-trigger'),
      );
      const currentOverviewPanel = required(
        root.querySelector<HTMLElement>('#gallery-tabs-overview-panel'),
      );
      const currentDetailsPanel = required(
        root.querySelector<HTMLElement>('#gallery-tabs-details-panel'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"activeValue":"details","value":"overview"}');
      expect(currentOverview.getAttribute('aria-selected')).toBe('true');
      expect(currentOverview.tabIndex).toBe(-1);
      expect(currentOverviewPanel.hidden).toBe(false);
      expect(currentDetails.getAttribute('aria-selected')).toBe('false');
      expect(currentDetails.tabIndex).toBe(0);
      expect(currentDetailsPanel.hidden).toBe(true);
    });

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    await vi.waitFor(() => {
      const currentOverview = required(
        root.querySelector<HTMLButtonElement>('#gallery-tabs-overview-trigger'),
      );
      const currentDetails = required(
        root.querySelector<HTMLButtonElement>('#gallery-tabs-details-trigger'),
      );
      const currentOverviewPanel = required(
        root.querySelector<HTMLElement>('#gallery-tabs-overview-panel'),
      );
      const currentDetailsPanel = required(
        root.querySelector<HTMLElement>('#gallery-tabs-details-panel'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"activeValue":"details","value":"details"}');
      expect(currentOverview.getAttribute('aria-selected')).toBe('false');
      expect(currentOverviewPanel.hidden).toBe(true);
      expect(currentDetails.getAttribute('aria-selected')).toBe('true');
      expect(currentDetailsPanel.hidden).toBe(false);
    });

    details.click();

    await vi.waitFor(() => {
      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/tabs-demo.client.js',
        '/c/examples/gallery/src/generated/interactive/tabs-demo.client.js',
        '/c/examples/gallery/src/generated/interactive/tabs-demo.client.js',
      ]);
      const currentOverview = required(
        root.querySelector<HTMLButtonElement>('#gallery-tabs-overview-trigger'),
      );
      const currentDetails = required(
        root.querySelector<HTMLButtonElement>('#gallery-tabs-details-trigger'),
      );
      const currentAudit = required(
        root.querySelector<HTMLButtonElement>('#gallery-tabs-audit-trigger'),
      );
      const currentOverviewPanel = required(
        root.querySelector<HTMLElement>('#gallery-tabs-overview-panel'),
      );
      const currentDetailsPanel = required(
        root.querySelector<HTMLElement>('#gallery-tabs-details-panel'),
      );
      const currentAuditPanel = required(
        root.querySelector<HTMLElement>('#gallery-tabs-audit-panel'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"activeValue":"details","value":"details"}');
      expect(currentOverview.getAttribute('aria-selected')).toBe('false');
      expect(currentOverviewPanel.hidden).toBe(true);
      expect(currentDetails.getAttribute('aria-selected')).toBe('true');
      expect(currentDetailsPanel.hidden).toBe(false);
      expect(currentAudit.disabled).toBe(true);
      expect(currentAuditPanel.hidden).toBe(true);
    });
  });

  it('updates toolbar roving tabindex and pressed state through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryToolbarDemo);
    const bold = required(root.querySelector<HTMLButtonElement>('#gallery-toolbar-bold'));
    const italic = required(root.querySelector<HTMLButtonElement>('#gallery-toolbar-italic'));
    const link = required(root.querySelector<HTMLButtonElement>('#gallery-toolbar-link'));
    const activeOutput = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="toolbar-active"]'),
    );
    const pressedOutput = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="toolbar-pressed"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root, {
      events: ['click', 'keydown'],
    });

    expect(root.getAttribute('role')).toBe('toolbar');
    expect(root.getAttribute('aria-label')).toBe('Formatting toolbar');
    expect(root.getAttribute('fw-state')).toBe('{"activeValue":"bold","pressedValue":"bold"}');
    expect(bold.tabIndex).toBe(0);
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(bold.getAttribute('data-pressed')).toBe('true');
    expect(italic.disabled).toBe(true);
    expect(italic.getAttribute('data-pressed')).toBe('false');
    expect(italic.tabIndex).toBe(-1);
    expect(link.tabIndex).toBe(-1);
    expect(link.getAttribute('data-pressed')).toBe('false');
    expect(activeOutput.textContent).toBe('bold');
    expect(pressedOutput.textContent).toBe('bold');

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/toolbar-demo.client.js',
      );
      expect(root.getAttribute('fw-state')).toBe('{"activeValue":"link","pressedValue":"bold"}');
      expect(bold.tabIndex).toBe(-1);
      expect(link.tabIndex).toBe(0);
      expect(document.activeElement).toBe(link);
      expect(activeOutput.textContent).toBe('link');
    });

    link.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"activeValue":"link","pressedValue":"link"}');
      expect(bold.getAttribute('data-pressed')).toBe('false');
      expect(link.getAttribute('aria-pressed')).toBe('true');
      expect(link.getAttribute('data-pressed')).toBe('true');
      expect(pressedOutput.textContent).toBe('link');
    });
  });

  it('updates toggle-group pressed state and roving tabindex through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryToggleGroupDemo);
    const bold = required(root.querySelector<HTMLButtonElement>('#gallery-toggle-group-bold'));
    const strike = required(root.querySelector<HTMLButtonElement>('#gallery-toggle-group-strike'));
    const italic = required(root.querySelector<HTMLButtonElement>('#gallery-toggle-group-italic'));
    installGeneratedGalleryLoader(root, { events: ['click', 'input', 'change', 'keydown'] });

    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('fw-state')).toBe('{"activeValue":"bold","value":"bold"}');
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(bold.getAttribute('data-state')).toBe('pressed');
    expect(bold.tabIndex).toBe(0);
    expect(strike.disabled).toBe(true);
    expect(strike.getAttribute('data-disabled')).toBe('');
    expect(strike.getAttribute('data-state')).toBe('off');
    expect(strike.tabIndex).toBe(-1);
    expect(italic.getAttribute('aria-pressed')).toBe('false');
    expect(italic.getAttribute('data-state')).toBe('off');
    expect(italic.tabIndex).toBe(-1);

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    await vi.waitFor(() => {
      const currentBold = required(
        root.querySelector<HTMLButtonElement>('#gallery-toggle-group-bold'),
      );
      const currentStrike = required(
        root.querySelector<HTMLButtonElement>('#gallery-toggle-group-strike'),
      );
      const currentItalic = required(
        root.querySelector<HTMLButtonElement>('#gallery-toggle-group-italic'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"activeValue":"italic","value":"bold"}');
      expect(currentBold.tabIndex).toBe(-1);
      expect(currentStrike.tabIndex).toBe(-1);
      expect(currentItalic.tabIndex).toBe(0);
      expect(document.activeElement).toBe(currentItalic);
    });

    required(root.querySelector<HTMLButtonElement>('#gallery-toggle-group-italic')).click();

    await vi.waitFor(() => {
      const currentBold = required(
        root.querySelector<HTMLButtonElement>('#gallery-toggle-group-bold'),
      );
      const currentItalic = required(
        root.querySelector<HTMLButtonElement>('#gallery-toggle-group-italic'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="toggle-group-value"]'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"activeValue":"italic","value":"bold,italic"}');
      expect(currentBold.getAttribute('aria-pressed')).toBe('true');
      expect(currentBold.getAttribute('data-state')).toBe('pressed');
      expect(currentItalic.getAttribute('aria-pressed')).toBe('true');
      expect(currentItalic.getAttribute('data-state')).toBe('pressed');
      expect(currentOutput.textContent).toBe('bold,italic');
    });
  });

  it('opens and selects from generated dropdown and context menu handlers', async () => {
    const dropdownRoot = mountInteractiveDemo(GalleryDropdownMenuDemo);
    const dropdownTrigger = required(
      dropdownRoot.querySelector<HTMLButtonElement>('#gallery-dropdown-menu-trigger'),
    );
    const dropdownContent = required(
      dropdownRoot.querySelector<HTMLElement>('#gallery-dropdown-menu-content'),
    );
    const rename = required(
      dropdownRoot.querySelector<HTMLButtonElement>('#gallery-dropdown-menu-rename'),
    );
    const archive = required(
      dropdownRoot.querySelector<HTMLButtonElement>('#gallery-dropdown-menu-archive'),
    );
    const dropdownValue = required(
      dropdownRoot.querySelector<HTMLOutputElement>('[data-demo-state="dropdown-value"]'),
    );
    const dropdownLoader = installGeneratedGalleryLoader(dropdownRoot, {
      events: ['click', 'keydown'],
    });

    expect(dropdownRoot.getAttribute('fw-state')).toBe(
      '{"highlightedValue":"duplicate","open":false,"value":"duplicate"}',
    );
    expect(dropdownTrigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(dropdownTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(dropdownContent.getAttribute('role')).toBe('menu');
    expect(dropdownContent.hidden).toBe(true);
    expect(archive.getAttribute('aria-disabled')).toBe('true');

    dropdownTrigger.click();

    await vi.waitFor(() => {
      expect(dropdownLoader.imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js',
      );
      expect(dropdownRoot.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"duplicate","open":true,"value":"duplicate"}',
      );
      expect(dropdownTrigger.getAttribute('aria-expanded')).toBe('true');
      expect(dropdownContent.hidden).toBe(false);
    });

    rename.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(dropdownRoot.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"rename","open":false,"value":"rename"}',
      );
      expect(dropdownContent.hidden).toBe(true);
      expect(rename.getAttribute('data-highlighted')).toBe('');
      expect(dropdownValue.textContent).toBe('rename');
    });

    const contextRoot = mountInteractiveDemo(GalleryContextMenuDemo);
    const trigger = required(
      contextRoot.querySelector<HTMLElement>('#gallery-context-menu-trigger'),
    );
    const content = required(
      contextRoot.querySelector<HTMLElement>('#gallery-context-menu-content'),
    );
    const inspect = required(
      contextRoot.querySelector<HTMLButtonElement>('#gallery-context-menu-inspect'),
    );
    const contextValue = required(
      contextRoot.querySelector<HTMLOutputElement>('[data-demo-state="context-value"]'),
    );
    const contextLoader = installGeneratedGalleryLoader(contextRoot, {
      events: ['click', 'contextmenu', 'keydown'],
    });

    expect(trigger.getAttribute('jiso-context-menu')).toBe('gallery-context-menu-content');
    expect(content.hidden).toBe(true);
    expect(content.getAttribute('data-anchor-x')).toBe('24');
    expect(content.getAttribute('data-anchor-y')).toBe('40');

    trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(contextLoader.imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/context-menu-demo.client.js',
      );
      expect(contextRoot.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"copy","open":true,"value":"copy"}',
      );
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(content.hidden).toBe(false);
    });

    inspect.focus();
    await userEvent.keyboard('{Space}');

    await vi.waitFor(() => {
      expect(contextRoot.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"inspect","open":false,"value":"inspect"}',
      );
      expect(content.hidden).toBe(true);
      expect(contextValue.textContent).toBe('inspect');
    });
  });

  it('updates generated menubar and navigation-menu roving/open state', async () => {
    const menubarDemo = mountInteractiveDemo(GalleryMenubarDemo);
    const menubarRoot = required(menubarDemo.querySelector<HTMLElement>('[role="menubar"]'));
    const file = required(menubarRoot.querySelector<HTMLButtonElement>('#gallery-menubar-file'));
    const edit = required(menubarRoot.querySelector<HTMLButtonElement>('#gallery-menubar-edit'));
    const newFile = required(menubarDemo.querySelector<HTMLButtonElement>('#gallery-menubar-new'));
    const fileMenu = required(menubarDemo.querySelector<HTMLElement>('#gallery-menubar-file-menu'));
    const openOutput = required(
      menubarDemo.querySelector<HTMLOutputElement>('[data-demo-state="menubar-open"]'),
    );
    const valueOutput = required(
      menubarDemo.querySelector<HTMLOutputElement>('[data-demo-state="menubar-value"]'),
    );
    const menubarLoader = installGeneratedGalleryLoader(menubarDemo, {
      events: ['click', 'keydown'],
    });

    expect(menubarRoot.getAttribute('role')).toBe('menubar');
    expect(file.getAttribute('aria-haspopup')).toBe('menu');
    expect(file.getAttribute('aria-expanded')).toBe('false');
    expect(file.tabIndex).toBe(0);
    expect(edit.tabIndex).toBe(-1);
    expect(fileMenu.hidden).toBe(true);

    menubarDemo.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    await vi.waitFor(() => {
      expect(menubarLoader.imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/menubar-demo.client.js',
      );
      expect(menubarDemo.getAttribute('fw-state')).toBe(
        '{"activeValue":"edit","openValue":"","value":"new"}',
      );
      expect(file.tabIndex).toBe(-1);
      expect(edit.tabIndex).toBe(0);
    });

    file.click();

    await vi.waitFor(() => {
      expect(menubarDemo.getAttribute('fw-state')).toBe(
        '{"activeValue":"file","openValue":"file","value":"new"}',
      );
      expect(file.getAttribute('aria-expanded')).toBe('true');
      expect(fileMenu.hidden).toBe(false);
      expect(openOutput.textContent).toBe('file');
    });

    newFile.focus();
    await userEvent.keyboard('{Space}');

    await vi.waitFor(() => {
      expect(menubarDemo.getAttribute('fw-state')).toBe(
        '{"activeValue":"file","openValue":"","value":"new"}',
      );
      expect(file.getAttribute('aria-expanded')).toBe('false');
      expect(fileMenu.hidden).toBe(true);
      expect(openOutput.textContent).toBe('none');
      expect(valueOutput.textContent).toBe('new');
    });

    const navRoot = mountInteractiveDemo(GalleryNavigationMenuDemo);
    const products = required(
      navRoot.querySelector<HTMLButtonElement>('#gallery-navigation-products-trigger'),
    );
    const docs = required(
      navRoot.querySelector<HTMLAnchorElement>('#gallery-navigation-docs-link'),
    );
    const productsContent = required(
      navRoot.querySelector<HTMLElement>('#gallery-navigation-products-content'),
    );
    const viewport = required(navRoot.querySelector<HTMLElement>('#gallery-navigation-viewport'));
    const navValue = required(
      navRoot.querySelector<HTMLOutputElement>('[data-demo-state="navigation-value"]'),
    );
    installGeneratedGalleryLoader(navRoot, { events: ['click', 'keydown'] });

    expect(navRoot.getAttribute('role')).toBe('navigation');
    expect(products.getAttribute('aria-haspopup')).toBe('true');
    expect(products.getAttribute('aria-expanded')).toBe('false');
    expect(docs.getAttribute('href')).toBe('/docs');
    expect(products.tabIndex).toBe(0);
    expect(docs.tabIndex).toBe(-1);
    expect(productsContent.hidden).toBe(true);
    expect(viewport.hidden).toBe(true);

    products.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(navRoot.getAttribute('fw-state')).toBe(
        '{"activeValue":"products","openValue":"products","value":"none"}',
      );
      expect(products.getAttribute('aria-expanded')).toBe('true');
      expect(productsContent.hidden).toBe(false);
      expect(viewport.hidden).toBe(false);
    });

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(navRoot.getAttribute('fw-state')).toBe(
        '{"activeValue":"products","openValue":"products","value":"escape-canceled"}',
      );
      expect(products.getAttribute('aria-expanded')).toBe('true');
      expect(productsContent.hidden).toBe(false);
      expect(viewport.hidden).toBe(false);
      expect(navValue.textContent).toBe('escape-canceled');
    });

    navRoot.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    await vi.waitFor(() => {
      expect(navRoot.getAttribute('fw-state')).toBe(
        '{"activeValue":"docs","openValue":"products","value":"escape-canceled"}',
      );
      expect(products.tabIndex).toBe(-1);
      expect(docs.tabIndex).toBe(0);
    });

    docs.removeAttribute('href');
    docs.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(navRoot.getAttribute('fw-state')).toBe(
        '{"activeValue":"docs","openValue":"","value":"docs"}',
      );
      expect(navValue.textContent).toBe('docs');
    });
  });

  it('updates command dialog and toast visible state through generated handlers', async () => {
    const commandRoot = mountInteractiveDemo(GalleryCommandDemo);
    const trigger = required(
      commandRoot.querySelector<HTMLButtonElement>('#gallery-command-trigger'),
    );
    const dialog = required(
      commandRoot.querySelector<HTMLDialogElement>('#gallery-command-dialog'),
    );
    const form = required(commandRoot.querySelector<HTMLFormElement>('#gallery-command-form'));
    const input = required(commandRoot.querySelector<HTMLInputElement>('#gallery-command-input'));
    const invite = required(
      commandRoot.querySelector<HTMLButtonElement>('#gallery-command-listbox-item-1'),
    );
    const commandInput = required(
      commandRoot.querySelector<HTMLOutputElement>('[data-demo-state="command-input"]'),
    );
    const commandKeyCanceled = required(
      commandRoot.querySelector<HTMLOutputElement>('[data-demo-state="command-key-canceled"]'),
    );
    const commandValue = required(
      commandRoot.querySelector<HTMLOutputElement>('[data-demo-state="command-value"]'),
    );
    const { imports } = installGeneratedGalleryLoader(commandRoot, {
      events: ['click', 'input', 'keydown'],
    });

    expect(trigger.getAttribute('command')).toBe('show-modal');
    expect(dialog.open).toBe(false);
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.form).toBe(form);
    expect(input.name).toBe('gallery-command-query');
    expect(input.required).toBe(true);
    expect(new FormData(form).get('gallery-command-query')).toBe('');
    expect(commandInput.textContent).toBe('empty');

    trigger.click();

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/command-demo.client.js',
      );
      expect(commandRoot.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"dashboard","inputValue":"","lastKeyAction":"idle","open":true,"value":"dashboard"}',
      );
      expect(dialog.open).toBe(true);
    });

    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(commandRoot.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"invite","inputValue":"invite","lastKeyAction":"idle","open":true,"value":"dashboard"}',
      );
      expect(input.value).toBe('invite');
      expect(input.getAttribute('aria-activedescendant')).toBe('gallery-command-listbox-item-1');
      expect(invite.getAttribute('aria-selected')).toBe('true');
      expect(new FormData(form).get('gallery-command-query')).toBe('invite');
      expect(commandInput.textContent).toBe('invite');
    });

    const canceledEnter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    input.dispatchEvent(canceledEnter);

    await vi.waitFor(() => {
      expect(commandRoot.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"invite","inputValue":"invite","lastKeyAction":"canceled","open":true,"value":"dashboard"}',
      );
      expect(canceledEnter.defaultPrevented).toBe(true);
      expect(dialog.open).toBe(true);
      expect(commandKeyCanceled.textContent).toBe('canceled');
      expect(commandValue.textContent).toBe('Open dashboard');
    });

    invite.click();

    await vi.waitFor(() => {
      expect(commandRoot.getAttribute('fw-state')).toBe(
        '{"highlightedValue":"invite","inputValue":"invite","lastKeyAction":"canceled","open":false,"value":"invite"}',
      );
      expect(dialog.open).toBe(false);
      expect(commandValue.textContent).toBe('Invite teammate');
    });

    const toastRoot = mountInteractiveDemo(GalleryToastDemo);
    const toast = required(toastRoot.querySelector<HTMLElement>('#gallery-toast'));
    const cancelDismiss = required(
      toastRoot.querySelector<HTMLButtonElement>('[data-toast-cancel-dismiss]'),
    );
    const dismiss = required(toastRoot.querySelector<HTMLButtonElement>('[data-dismiss]'));
    const toastOutput = required(
      toastRoot.querySelector<HTMLOutputElement>('[data-demo-state="toast-open"]'),
    );
    installGeneratedGalleryLoader(toastRoot, { events: ['click', 'keydown'] });

    expect(toastRoot.getAttribute('role')).toBe('region');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.getAttribute('data-state')).toBe('open');
    expect(toast.hidden).toBe(false);
    expect(toastOutput.textContent).toBe('open');

    cancelDismiss.click();

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('fw-state')).toBe('{"open":true}');
      expect(toast.hidden).toBe(false);
      expect(toast.getAttribute('data-state')).toBe('open');
      expect(toastOutput.textContent).toBe('canceled');
    });

    dismiss.click();

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('fw-state')).toBe('{"open":false}');
      expect(toast.hidden).toBe(true);
      expect(toast.getAttribute('data-state')).toBe('closed');
      expect(toastOutput.textContent).toBe('closed');
    });
  });

  it('shows and hides a generated tooltip through browser-visible ARIA and popover state', async () => {
    const root = mountInteractiveDemo(GalleryTooltipDemo);
    const button = required(root.querySelector<HTMLButtonElement>('[jiso-tooltip]'));
    const content = required(root.querySelector<HTMLElement>('#gallery-tooltip-content'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="tooltip-open"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root, {
      events: ['blur', 'focus', 'keydown', 'pointerenter', 'pointerleave'],
    });

    expect(root.getAttribute('fw-state')).toBe('{"open":false}');
    expect(button.getAttribute('jiso-tooltip')).toBe('gallery-tooltip-content');
    expect(button.getAttribute('aria-describedby')).toBeNull();
    expect(content.getAttribute('role')).toBe('tooltip');
    expect(content.getAttribute('popover')).toBe('manual');
    expect(content.hidden).toBe(true);
    expect(content.matches(':popover-open')).toBe(false);
    expect(output.textContent).toBe('closed');

    button.dispatchEvent(new Event('pointerenter', { bubbles: true }));

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/tooltip-demo.client.js',
      );
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(button.getAttribute('aria-describedby')).toBe('gallery-tooltip-content');
      expect(content.hidden).toBe(false);
      expect(content.getAttribute('data-state')).toBe('open');
      expect(content.matches(':popover-open')).toBe(true);
      expect(output.textContent).toBe('open');
    });

    button.dispatchEvent(new Event('pointerleave', { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(button.getAttribute('aria-describedby')).toBeNull();
      expect(content.hidden).toBe(true);
      expect(content.matches(':popover-open')).toBe(false);
      expect(output.textContent).toBe('closed');
    });

    button.focus();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(content.hidden).toBe(false);
      expect(content.matches(':popover-open')).toBe(true);
    });

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(button.getAttribute('aria-describedby')).toBeNull();
      expect(content.hidden).toBe(true);
      expect(content.matches(':popover-open')).toBe(false);
    });
  });

  it('shows and hides a generated hover-card through browser-visible ARIA and popover state', async () => {
    const root = mountInteractiveDemo(GalleryHoverCardDemo);
    const trigger = required(root.querySelector<HTMLAnchorElement>('[jiso-hover-card]'));
    const content = required(root.querySelector<HTMLElement>('#gallery-hover-card-content'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="hover-card-open"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root, {
      events: ['blur', 'focus', 'keydown', 'pointerenter', 'pointerleave'],
    });

    expect(root.getAttribute('fw-state')).toBe('{"open":false}');
    expect(trigger.getAttribute('jiso-hover-card')).toBe('gallery-hover-card-content');
    expect(trigger.getAttribute('aria-controls')).toBe('gallery-hover-card-content');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(content.getAttribute('popover')).toBe('manual');
    expect(content.hidden).toBe(true);
    expect(content.matches(':popover-open')).toBe(false);
    expect(output.textContent).toBe('closed');

    trigger.dispatchEvent(new Event('pointerenter', { bubbles: true }));

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe(
        '/c/examples/gallery/src/generated/interactive/hover-card-demo.client.js',
      );
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(content.hidden).toBe(false);
      expect(content.getAttribute('data-state')).toBe('open');
      expect(content.matches(':popover-open')).toBe(true);
      expect(output.textContent).toBe('open');
    });

    trigger.dispatchEvent(new Event('pointerleave', { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(content.hidden).toBe(true);
      expect(content.matches(':popover-open')).toBe(false);
      expect(output.textContent).toBe('closed');
    });

    trigger.focus();

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(content.hidden).toBe(false);
      expect(content.matches(':popover-open')).toBe(true);
    });

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(content.hidden).toBe(true);
      expect(content.matches(':popover-open')).toBe(false);
    });
  });
});

function mountInteractiveDemo(component: InteractiveDemoComponent): HTMLElement {
  const host = document.createElement('main');
  host.innerHTML = component.definition.render({}, component.definition.state() as never);
  document.body.append(host);

  return required(host.firstElementChild as HTMLElement | null);
}

function mountStaticGalleryRoute(path: StaticVisualFixturePath): HTMLElement {
  const html = staticVisualFixtureHtml[path];
  const host = document.createElement('main');
  host.innerHTML = html;
  document.body.append(host);

  return required(host.querySelector<HTMLElement>(`[data-gallery-route="${path}"]`));
}

function installGeneratedGalleryLoader(
  root: HTMLElement,
  options: { events?: readonly string[] } = {},
): {
  imports: string[];
  loader: JisoLoader;
} {
  const imports: string[] = [];
  const loader = installJisoLoader({
    async importModule(url) {
      const modulePath = url.split('?')[0] ?? url;
      imports.push(modulePath);

      const mod = generatedModules[modulePath];
      if (!mod) throw new Error(`Missing generated interactive module: ${url}`);

      return mod;
    },
    ...(options.events ? { events: options.events } : {}),
    root,
  });

  return { imports, loader };
}

function required<ElementType extends Element>(element: ElementType | null): ElementType {
  if (!element) throw new Error('Missing interactive gallery browser fixture element');

  return element;
}

async function visualBaselineHash(element: HTMLElement): Promise<string> {
  const screenshot = await page.screenshot({
    element,
    save: false,
  });

  return fnv1a(screenshot);
}

function visualGeometry(element: HTMLElement): { height: number; width: number } {
  const rect = element.getBoundingClientRect();

  return {
    height: Math.round(rect.height),
    width: Math.round(rect.width),
  };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function installVisualBaselineStyles(): void {
  const style = document.createElement('style');
  style.dataset.galleryVisualBaseline = 'true';
  style.textContent = `
    *, *::before, *::after {
      box-sizing: border-box;
      caret-color: transparent !important;
      transition-duration: 0s !important;
      animation-duration: 0s !important;
    }

    body {
      margin: 0;
      background: #f8fafc;
      color: #0f172a;
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    [data-gallery-route="/gallery/interactive"] {
      width: 820px;
      margin: 0;
      padding: 24px 20px 32px;
      background: #ffffff;
    }

    [data-gallery-route^="/components/"] {
      width: 860px;
      margin: 0 0 18px;
      padding: 24px 22px 30px;
      background: #ffffff;
    }

    [data-gallery-route] > h1 {
      margin: 0 0 6px;
      font-size: 24px;
      line-height: 1.2;
    }

    [data-demo-summary] {
      margin: 0 0 18px;
      max-width: 680px;
      color: #475569;
    }

    nav[aria-label] {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 0 18px;
    }

    nav[aria-label] a {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 4px 8px;
      color: #1d4ed8;
      text-decoration: none;
    }

    [data-gallery-interactive-route] {
      width: 780px;
      margin: 0 0 12px;
      padding: 14px;
      border: 1px solid #dbe3ec;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
    }

    [data-gallery-interactive-route] h2,
    [data-gallery-demo] h2,
    [data-gallery-demo] h3,
    [data-gallery-interactive] h3,
    [data-gallery-interactive] p {
      margin-top: 0;
    }

    [data-gallery-demo] {
      display: grid;
      gap: 10px;
      width: 816px;
      margin: 0;
      padding: 14px;
      border: 1px solid #dbe3ec;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
    }

    [data-gallery-contract] {
      margin: 0;
      color: #475569;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      border-bottom: 1px solid #e2e8f0;
      padding: 6px 8px;
      text-align: left;
    }

    button,
    input,
    select {
      font: inherit;
    }

    button,
    [role="button"],
    [role="menuitem"],
    [role="option"],
    [role="tab"] {
      border: 1px solid #94a3b8;
      border-radius: 6px;
      background: #f8fafc;
      color: #0f172a;
      padding: 5px 9px;
    }

    [aria-selected="true"],
    [aria-checked="true"],
    [aria-pressed="true"],
    [data-state="open"] {
      border-color: #2563eb;
      background: #dbeafe;
    }

    [role="menu"],
    [role="listbox"],
    [role="tablist"],
    [role="toolbar"],
    [role="radiogroup"],
    [role="group"] {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-block: 8px;
    }

    [role="progressbar"],
    [role="meter"] {
      display: block;
      min-height: 14px;
      border-radius: 999px;
      background: #dbeafe;
    }

    output {
      display: inline-block;
      min-width: 4ch;
      border-radius: 4px;
      padding: 2px 5px;
      background: #eef2ff;
      color: #3730a3;
    }
  `;
  document.head.append(style);
}

function applyRouteCheckboxIndeterminate(root: ParentNode): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-state="indeterminate"]',
  )) {
    applyCheckboxIndeterminate(input, 'indeterminate');
  }
}

async function expectNoAxeViolations(root: HTMLElement): Promise<void> {
  applyRouteCheckboxIndeterminate(root);

  const results = await axe.run(root);

  expect(formatAxeViolations(results.violations)).toEqual([]);
}

function formatAxeViolations(violations: axe.Result[]): string[] {
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => {
      const target = node.target.join(' ');
      return `${violation.id}: ${target}: ${node.failureSummary ?? violation.help}`;
    }),
  );
}
