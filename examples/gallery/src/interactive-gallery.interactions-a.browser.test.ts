import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { GalleryAccordionDemo } from './interactive/accordion-demo.js';
import { GalleryAlertDialogDemo } from './interactive/alert-dialog-demo.js';
import { GalleryAutocompleteDemo } from './interactive/autocomplete-demo.js';
import { GalleryCheckboxDemo } from './interactive/checkbox-demo.js';
import { GalleryCheckboxGroupDemo } from './interactive/checkbox-group-demo.js';
import { GalleryComboboxDemo } from './interactive/combobox-demo.js';
import { GalleryDisclosureDemo } from './interactive/disclosure-demo.js';
import { GalleryDialogDemo } from './interactive/dialog-demo.js';
import { GalleryDrawerDemo } from './interactive/drawer-demo.js';
import { GalleryFieldDemo } from './interactive/field-demo.js';
import { GalleryNumberFieldDemo } from './interactive/number-field-demo.js';
import { GalleryOtpFieldDemo } from './interactive/otp-field-demo.js';
import { GallerySelectDemo } from './interactive/select-demo.js';
import { GallerySheetDemo } from './interactive/sheet-demo.js';
import { GallerySwitchDemo } from './interactive/switch-demo.js';
import { GalleryToggleDemo } from './interactive/toggle-demo.js';
import {
  expectInteractiveSideDialog,
  expectNoAxeViolations,
  installInteractiveGalleryLoader,
  mountInteractiveDemo,
  required,
} from './interactive-gallery.browser-fixtures.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('compiled interactive gallery demos in the browser', () => {
  it('updates accordion ARIA and panel visibility through generated handlers', async () => {
    const root = await mountInteractiveDemo(GalleryAccordionDemo);
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
    const { imports } = installInteractiveGalleryLoader(root, { events: ['click', 'keydown'] });

    expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"shipping","value":"shipping"}');
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

      expect(imports).toEqual(['/c/src/interactive/accordion-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"billing","value":"billing"}');
      expect(currentShipping.getAttribute('aria-expanded')).toBe('false');
      expect(currentShippingPanel.hidden).toBe(true);
      expect(currentBilling.getAttribute('aria-expanded')).toBe('true');
      expect(currentBillingPanel.hidden).toBe(false);
      expect(currentOutput.textContent).toBe('billing');
    });

    // SPEC §12.1: the accordion expanded end-state (one trigger aria-expanded=true with its
    // panel visible) must stay axe-clean.
    await expectNoAxeViolations(root);
  });

  it('opens and resolves a native alert dialog through generated handlers', async () => {
    const root = await mountInteractiveDemo(GalleryAlertDialogDemo);
    const trigger = required(root.querySelector<HTMLButtonElement>('button[command="show-modal"]'));
    const dialog = required(
      root.querySelector<HTMLDialogElement>('#gallery-interactive-alert-dialog-content'),
    );
    const cancel = required(dialog.querySelector<HTMLButtonElement>('[data-intent="cancel"]'));
    const action = required(dialog.querySelector<HTMLButtonElement>('[data-intent="destructive"]'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="alert-dialog-open"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root, { events: ['click', 'keydown'] });

    expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-controls')).toBe('gallery-interactive-alert-dialog-content');
    expect(dialog.open).toBe(false);
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Backdrop light-dismiss is now enabled (closedby="any"); it fires `cancel`,
    // which the demo's onCancel syncs (same path as Escape). The explicit
    // X / Cancel / Action choices remain.
    expect(dialog.getAttribute('closedby')).toBe('any');
    expect(dialog.getAttribute('aria-labelledby')).toBe('gallery-interactive-alert-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe(
      'gallery-interactive-alert-dialog-description',
    );
    expect(cancel.autofocus).toBe(true);
    expect(action.getAttribute('command')).toBe('request-close');
    expect(output.textContent).toBe('closed');

    trigger.click();

    await vi.waitFor(() => {
      expect(imports).toEqual(['/c/src/interactive/alert-dialog-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(dialog.open).toBe(true);
    });

    await vi.waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    // SPEC §12.1: the open alertdialog top-layer state (role=alertdialog, aria-modal, labelled +
    // described, focus trapped inside) must stay axe-clean. axe.run(root) descends into the
    // promoted <dialog> because it remains a DOM child of root.
    await expectNoAxeViolations(root);

    cancel.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(dialog.open).toBe(false);
      expect(output.textContent).toBe('closed');
    });

    trigger.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
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
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(dialog.open).toBe(true);
    });

    action.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(dialog.open).toBe(false);
    });
  });

  it('updates custom select listbox state and submitted value through generated handlers', async () => {
    const root = await mountInteractiveDemo(GallerySelectDemo);
    const input = required(root.querySelector<HTMLInputElement>('#gallery-select-control'));
    const trigger = required(root.querySelector<HTMLButtonElement>('#gallery-select-trigger'));
    const listbox = required(root.querySelector<HTMLElement>('#gallery-select-listbox'));
    const standard = required(root.querySelector<HTMLElement>('#gallery-select-option-standard'));
    const express = required(root.querySelector<HTMLElement>('#gallery-select-option-express'));
    const drone = required(root.querySelector<HTMLElement>('#gallery-select-option-drone'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-select-form'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="select-value"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root, { events: ['click', 'keydown'] });

    expect(root.getAttribute('kovo-state')).toBe(
      '{"highlightedValue":"standard","open":false,"value":"standard"}',
    );
    expect(form.dataset.galleryForm).toBe('select');
    expect(input.type).toBe('hidden');
    expect(input.name).toBe('gallery-shipping-speed');
    expect(input.form).toBe(form);
    expect(input.value).toBe('standard');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('gallery-select-listbox');
    expect(listbox.getAttribute('role')).toBe('listbox');
    expect(listbox.hidden).toBe(true);
    expect(standard.getAttribute('role')).toBe('option');
    expect(standard.getAttribute('aria-selected')).toBe('true');
    expect(express.getAttribute('aria-selected')).toBe('false');
    expect(drone.getAttribute('aria-disabled')).toBe('true');
    expect(output.textContent).toBe('Standard');
    expect(new FormData(form).get('gallery-shipping-speed')).toBe('standard');

    trigger.click();

    await vi.waitFor(() => {
      expect(imports).toEqual(['/c/src/interactive/select-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"standard","open":true,"value":"standard"}',
      );
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(listbox.hidden).toBe(false);
      expect(standard.getAttribute('data-highlighted')).toBe('');
    });

    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }),
    );

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"express","open":true,"value":"standard"}',
      );
      expect(express.getAttribute('data-highlighted')).toBe('');
    });

    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
    );

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"express","open":false,"value":"express"}',
      );
      expect(input.value).toBe('express');
      expect(new FormData(form).get('gallery-shipping-speed')).toBe('express');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(express.getAttribute('aria-selected')).toBe('true');
      expect(
        required(root.querySelector<HTMLOutputElement>('[data-demo-state="select-value"]'))
          .textContent,
      ).toBe('Standard');
    });

    trigger.click();
    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"express","open":true,"value":"express"}',
      );
    });
    const disabledClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    drone.dispatchEvent(disabledClick);

    await vi.waitFor(() => {
      expect(disabledClick.defaultPrevented).toBe(true);
      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"express","open":true,"value":"express"}',
      );
      expect(input.value).toBe('express');
      expect(new FormData(form).get('gallery-shipping-speed')).toBe('express');
      expect(
        required(root.querySelector<HTMLOutputElement>('[data-demo-state="select-value"]'))
          .textContent,
      ).toBe('Standard');
    });

    // SPEC §12.1: the select end-state after keyboard selection and a canceled
    // disabled option click must stay axe-clean.
    await expectNoAxeViolations(root);
  });

  it('updates combobox listbox ARIA and selected value through generated handlers', async () => {
    const root = await mountInteractiveDemo(GalleryComboboxDemo);
    const input = required(root.querySelector<HTMLInputElement>('#gallery-combobox-input'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-combobox-form'));
    const listbox = required(root.querySelector<HTMLElement>('#gallery-combobox-listbox'));
    const chicago = required(
      root.querySelector<HTMLButtonElement>('#gallery-combobox-listbox-option-2'),
    );
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="combobox-value"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root, {
      events: ['click', 'input', 'keydown'],
    });

    expect(root.getAttribute('kovo-state')).toBe(
      '{"highlightedValue":"austin","inputValue":"","open":false,"value":"austin"}',
    );
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBe('gallery-combobox-listbox');
    expect(input.name).toBe('gallery-city');
    expect(input.form).toBe(form);
    // Seeded empty so the listbox isn't stuck pre-filtered to the current value
    // (the "does not filter" fix); the query is typed/cleared by the user.
    expect(input.value).toBe('');
    expect(new FormData(form).get('gallery-city')).toBe('');
    expect(listbox.hidden).toBe(true);
    expect(chicago.getAttribute('role')).toBe('option');
    expect(output.textContent).toBe('Austin');

    input.value = 'chi';
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

      expect(imports.at(-1)).toBe('/c/src/interactive/combobox-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"chicago","inputValue":"chi","open":true,"value":"austin"}',
      );
      expect(currentInput.getAttribute('aria-expanded')).toBe('true');
      expect(currentInput.getAttribute('aria-activedescendant')).toBe(
        'gallery-combobox-listbox-option-2',
      );
      expect(currentInput.value).toBe('chi');
      expect(new FormData(form).get('gallery-city')).toBe('chi');
      expect(currentListbox.hidden).toBe(false);
      expect(currentChicago.getAttribute('data-highlighted')).toBe('');
      expect(currentChicago.getAttribute('aria-selected')).toBe('false');
      expect(currentOutput.textContent).toBe('Austin');
    });

    // SPEC §12.1: the combobox open state (expanded combobox with an active descendant
    // over a visible role="listbox" carrying a disabled option) must stay axe-clean.
    await expectNoAxeViolations(root);

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

      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"chicago","inputValue":"chicago","open":false,"value":"chicago"}',
      );
      expect(currentInput.getAttribute('aria-expanded')).toBe('false');
      expect(currentInput.value).toBe('chicago');
      expect(new FormData(form).get('gallery-city')).toBe('chicago');
      expect(currentListbox.hidden).toBe(true);
      expect(currentOutput.textContent).toBe('Austin');
    });

    required(root.querySelector<HTMLButtonElement>('#gallery-combobox-listbox-option-0')).click();

    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-combobox-input'),
      );
      const currentListbox = required(root.querySelector<HTMLElement>('#gallery-combobox-listbox'));

      // Selecting Austin (value changed chicago→austin) syncs inputValue to the label.
      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"austin","inputValue":"austin","open":false,"value":"austin"}',
      );
      expect(currentInput.value).toBe('austin');
      expect(new FormData(form).get('gallery-city')).toBe('austin');
      expect(currentListbox.hidden).toBe(true);
    });
  });

  it('opens the combobox listbox by clicking the input and selects by clicking the current option', async () => {
    // Reproduces the reported bug: the listbox starts hidden, so without an
    // open-on-pointer affordance a mouse user can never reach an option to click
    // it (including re-selecting the current value).
    const root = await mountInteractiveDemo(GalleryComboboxDemo);
    const input = required(root.querySelector<HTMLInputElement>('#gallery-combobox-input'));
    const listbox = required(root.querySelector<HTMLElement>('#gallery-combobox-listbox'));
    installInteractiveGalleryLoader(root, { events: ['click', 'input', 'keydown'] });

    expect(listbox.hidden).toBe(true);

    // Clicking the input opens the listbox and highlights the current value.
    input.click();
    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-combobox-input'),
      );
      const currentListbox = required(root.querySelector<HTMLElement>('#gallery-combobox-listbox'));
      expect(currentListbox.hidden).toBe(false);
      expect(currentInput.getAttribute('aria-expanded')).toBe('true');
      expect(currentInput.getAttribute('aria-activedescendant')).toBe(
        'gallery-combobox-listbox-option-0',
      );
    });

    // Clicking the currently selected option (Austin) closes the listbox.
    required(root.querySelector<HTMLButtonElement>('#gallery-combobox-listbox-option-0')).click();
    await vi.waitFor(() => {
      const currentListbox = required(root.querySelector<HTMLElement>('#gallery-combobox-listbox'));
      expect(currentListbox.hidden).toBe(true);
      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"austin","inputValue":"","open":false,"value":"austin"}',
      );
    });
  });

  it('updates autocomplete listbox suggestions and value through generated handlers', async () => {
    const root = await mountInteractiveDemo(GalleryAutocompleteDemo);
    const input = required(root.querySelector<HTMLInputElement>('#gallery-autocomplete-input'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-autocomplete-form'));
    const listbox = required(root.querySelector<HTMLElement>('#gallery-autocomplete-list'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="autocomplete-value"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root, {
      events: ['click', 'input', 'keydown'],
    });

    expect(root.getAttribute('kovo-state')).toBe(
      '{"highlightedValue":"design","inputValue":"","open":false,"value":"design"}',
    );
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBe('gallery-autocomplete-list');
    expect(input.name).toBe('gallery-tag');
    expect(input.form).toBe(form);
    // Seeded empty (was 'de'): non-prefix queries no longer hide everything and
    // the list isn't pre-filtered on load.
    expect(input.value).toBe('');
    expect(new FormData(form).get('gallery-tag')).toBe('');
    expect(listbox.getAttribute('role')).toBe('listbox');
    expect(listbox.hidden).toBe(true);
    expect(output.textContent).toBe('Design');

    input.value = 'dev';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-autocomplete-input'),
      );
      const currentListbox = required(
        root.querySelector<HTMLElement>('#gallery-autocomplete-list'),
      );
      const currentDevelopment = required(
        root.querySelector<HTMLButtonElement>('#gallery-autocomplete-list-option-2'),
      );

      expect(imports.at(-1)).toBe('/c/src/interactive/autocomplete-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"development","inputValue":"dev","open":true,"value":"design"}',
      );
      expect(currentInput.getAttribute('aria-expanded')).toBe('true');
      expect(currentInput.getAttribute('aria-activedescendant')).toBe(
        'gallery-autocomplete-list-option-2',
      );
      expect(currentInput.value).toBe('dev');
      expect(new FormData(form).get('gallery-tag')).toBe('dev');
      expect(currentListbox.hidden).toBe(false);
      expect(currentDevelopment.textContent).toBe('Development');
      expect(currentDevelopment.getAttribute('role')).toBe('option');
      expect(currentDevelopment.getAttribute('aria-selected')).toBe('false');
      expect(currentDevelopment.getAttribute('data-highlighted')).toBe('');
    });

    // SPEC §12.1: the autocomplete open state (expanded combobox with an active
    // descendant over the suggestion listbox) must stay axe-clean.
    await expectNoAxeViolations(root);

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

      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"development","inputValue":"development","open":false,"value":"development"}',
      );
      expect(currentInput.getAttribute('aria-expanded')).toBe('false');
      expect(currentInput.value).toBe('development');
      expect(new FormData(form).get('gallery-tag')).toBe('development');
      expect(currentOutput.textContent).toBe('Design');
    });

    required(
      root.querySelector<HTMLButtonElement>('#gallery-autocomplete-list-option-2'),
    ).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      const currentInput = required(
        root.querySelector<HTMLInputElement>('#gallery-autocomplete-input'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="autocomplete-value"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"development","inputValue":"development","open":false,"value":"development"}',
      );
      expect(currentInput.value).toBe('development');
      expect(new FormData(form).get('gallery-tag')).toBe('development');
      expect(currentOutput.textContent).toBe('Design');
    });
  });

  it('updates toggle stamped state from generated click and keyboard handlers', async () => {
    const root = await mountInteractiveDemo(GalleryToggleDemo);
    const { imports } = installInteractiveGalleryLoader(root);
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="pressed"]'));

    expect(imports).toEqual([]);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('data-state')).toBe('off');
    expect(output.textContent).toBe('off');

    button.click();

    await vi.waitFor(() => {
      expect(imports).toEqual(['/c/src/interactive/toggle-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toBe('{"pressed":true}');
    });

    // SPEC §12.1: the toggle pressed end-state (aria-pressed=true, data-state=on) must stay
    // axe-clean. Asserted before the keyboard toggle flips it back off.
    await expectNoAxeViolations(root);

    button.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"pressed":false}');
    });
  });

  it('updates checkbox stamped and native checked state through generated handlers', async () => {
    const root = await mountInteractiveDemo(GalleryCheckboxDemo);
    const input = required(root.querySelector<HTMLInputElement>('input'));
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="checked"]'));
    installInteractiveGalleryLoader(root);

    expect(root.getAttribute('kovo-state')).toBe('{"checked":"indeterminate"}');
    expect(input.getAttribute('aria-checked')).toBe('mixed');
    expect(input.indeterminate).toBe(true);
    expect(output.textContent).toBe('indeterminate');

    input.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"checked":true}');
      expect(input.checked).toBe(true);
      expect(input.indeterminate).toBe(false);
    });

    input.focus();
    await userEvent.keyboard('{Space}');

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"checked":false}');
      expect(input.checked).toBe(false);
      expect(input.indeterminate).toBe(false);
    });
  });

  it('updates checkbox-group ARIA, parent mixed state, and native checked state', async () => {
    const root = await mountInteractiveDemo(GalleryCheckboxGroupDemo);
    const all = required(root.querySelector<HTMLInputElement>('#gallery-checkbox-group-all'));
    const updates = required(
      root.querySelector<HTMLInputElement>('#gallery-checkbox-group-updates'),
    );
    const billing = required(
      root.querySelector<HTMLInputElement>('#gallery-checkbox-group-billing'),
    );
    installInteractiveGalleryLoader(root, { events: ['click', 'input', 'change', 'keydown'] });

    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-labelledby')).toBe('gallery-checkbox-group-label');
    expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"updates","value":"updates"}');
    const form = required(root.querySelector<HTMLFormElement>('#gallery-checkbox-group-form'));
    expect(new FormData(form).getAll('gallery-notifications')).toEqual(['updates']);
    expect(updates.name).toBe('gallery-notifications');
    expect(updates.form).toBe(form);
    expect(updates.checked).toBe(true);
    expect(updates.getAttribute('aria-checked')).toBe('true');
    expect(updates.tabIndex).toBe(0);
    expect(all.getAttribute('aria-checked')).toBe('mixed');
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
    expect(billing.checked).toBe(false);
    expect(billing.getAttribute('aria-checked')).toBe('false');
    expect(billing.tabIndex).toBe(-1);

    required(root.querySelector<HTMLInputElement>('#gallery-checkbox-group-billing')).click();

    await vi.waitFor(() => {
      const currentAll = required(
        root.querySelector<HTMLInputElement>('#gallery-checkbox-group-all'),
      );
      const currentUpdates = required(
        root.querySelector<HTMLInputElement>('#gallery-checkbox-group-updates'),
      );
      const currentBilling = required(
        root.querySelector<HTMLInputElement>('#gallery-checkbox-group-billing'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="checkbox-group-value"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe(
        '{"activeValue":"billing","value":"updates,billing"}',
      );
      expect(currentAll.getAttribute('aria-checked')).toBe('true');
      expect(currentAll.indeterminate).toBe(false);
      expect(currentAll.checked).toBe(true);
      expect(currentUpdates.checked).toBe(true);
      expect(currentBilling.checked).toBe(true);
      expect(currentBilling.getAttribute('aria-checked')).toBe('true');
      expect(currentOutput.textContent).toBe('updates,billing');
      expect(new FormData(form).getAll('gallery-notifications')).toEqual(['updates', 'billing']);
    });

    all.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"billing","value":""}');
      expect(all.getAttribute('aria-checked')).toBe('false');
      expect(all.indeterminate).toBe(false);
      expect(all.checked).toBe(false);
      expect(new FormData(form).getAll('gallery-notifications')).toEqual([]);
    });

    // SPEC §12.1: the checkbox-group multi-checked and parent unchecked states must stay axe-clean.
    await expectNoAxeViolations(root);
  });

  it('updates disclosure stamped state from generated click and keyboard handlers', async () => {
    const root = await mountInteractiveDemo(GalleryDisclosureDemo);
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const panel = required(
      root.querySelector<HTMLElement>('#gallery-interactive-disclosure-panel'),
    );
    installInteractiveGalleryLoader(root);

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('gallery-interactive-disclosure-panel');
    expect(panel.hidden).toBe(true);

    button.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
    });

    // SPEC §12.1: the disclosure open end-state (trigger aria-expanded=true, panel revealed) must
    // stay axe-clean. Asserted before the keyboard toggle collapses it.
    await expectNoAxeViolations(root);

    button.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
    });
  });

  it('updates number-field stamped state and form data through generated input and steppers', async () => {
    const root = await mountInteractiveDemo(GalleryNumberFieldDemo);
    const form = root as HTMLFormElement;
    const input = required(root.querySelector<HTMLInputElement>('input'));
    const increment = required(root.querySelector<HTMLButtonElement>('[data-action="increment"]'));
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="value"]'));
    const { imports } = installInteractiveGalleryLoader(root);

    expect(root.getAttribute('kovo-state')).toBe('{"value":2}');
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
      expect(imports).toEqual(['/c/src/interactive/number-field-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toBe('{"value":4}');
      expect(output.textContent).toBe('4');
      expect(new FormData(form).get('gallery-seat-count')).toBe('4');
    });

    increment.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"value":5}');
      expect(increment.disabled).toBe(true);
      expect(increment.getAttribute('data-disabled')).toBe('');
      expect(new FormData(form).get('gallery-seat-count')).toBe('5');
    });

    const decrement = required(root.querySelector<HTMLButtonElement>('[data-action="decrement"]'));
    decrement.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"value":4}');
      expect(increment.disabled).toBe(false);
      expect(increment.hasAttribute('data-disabled')).toBe(false);
      expect(new FormData(form).get('gallery-seat-count')).toBe('4');
    });

    input.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Home' }),
    );

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"value":0}');
      expect(decrement.disabled).toBe(true);
      expect(decrement.getAttribute('data-disabled')).toBe('');
      expect(output.textContent).toBe('0');
      expect(new FormData(form).get('gallery-seat-count')).toBe('0');
    });

    // SPEC §12.1: the number-field value/required/stepper state after input and stepper
    // changes plus keyboard stepping must stay axe-clean.
    await expectNoAxeViolations(root);
  });

  it('updates field IDREF, native select, and fieldset state through generated handlers', async () => {
    const root = await mountInteractiveDemo(GalleryFieldDemo);
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
    const { imports } = installInteractiveGalleryLoader(root, {
      events: ['input', 'change', 'click'],
    });

    expect(root.getAttribute('kovo-state')).toBe(
      '{"email":"ada@example","invalid":true,"plan":"team","shippingDisabled":false}',
    );
    expect(root.id).toBe('gallery-interactive-field-form');
    expect(email.name).toBe('gallery-email');
    expect(email.form).toBe(form);
    expect(email.pattern).toBe('.+@kovo\\.sh');
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

    email.value = 'ada@kovo.sh';
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

      expect(imports.at(-1)).toBe('/c/src/interactive/field-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe(
        '{"email":"ada@kovo.sh","invalid":false,"plan":"team","shippingDisabled":false}',
      );
      expect(currentEmail.value).toBe('ada@kovo.sh');
      expect(currentEmail.checkValidity()).toBe(true);
      expect(new FormData(form).get('gallery-email')).toBe('ada@kovo.sh');
      expect(currentEmail.getAttribute('aria-describedby')).toBe(
        'gallery-interactive-field-email-description',
      );
      expect(currentEmail.hasAttribute('aria-invalid')).toBe(false);
      expect(currentError.hidden).toBe(true);
      expect(currentOutput.textContent).toBe('ada@kovo.sh');
    });

    const nextPlan = required(
      root.querySelector<HTMLSelectElement>('#gallery-interactive-field-plan-select'),
    );
    nextPlan.value = 'enterprise';
    nextPlan.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      const currentPlan = required(
        root.querySelector<HTMLSelectElement>('#gallery-interactive-field-plan-select'),
      );
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="field-plan"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe(
        '{"email":"ada@kovo.sh","invalid":false,"plan":"enterprise","shippingDisabled":false}',
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

      expect(root.getAttribute('kovo-state')).toBe(
        '{"email":"ada@kovo.sh","invalid":false,"plan":"enterprise","shippingDisabled":true}',
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

      expect(root.getAttribute('kovo-state')).toBe(
        '{"email":"ada@kovo.sh","invalid":false,"plan":"enterprise","shippingDisabled":false}',
      );
      expect(currentFieldset.disabled).toBe(false);
      expect(currentFieldset.hasAttribute('data-disabled')).toBe(false);
      expect(currentToggle.checked).toBe(false);
      expect(new FormData(form).get('gallery-seat')).toBe('window');
      expect(new FormData(form).get('gallery-shipping-disabled')).toBeNull();
    });

    // SPEC §12.1: the field/fieldset valid + re-enabled state after clearing the error and
    // toggling fieldset disablement must stay axe-clean, complementing the initial error state.
    await expectNoAxeViolations(root);
  });

  it('updates OTP aggregate value, visible slots, and focus through generated handlers', async () => {
    const root = await mountInteractiveDemo(GalleryOtpFieldDemo);
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
    const { imports } = installInteractiveGalleryLoader(root, { events: ['input', 'keydown'] });

    expect(root.getAttribute('kovo-state')).toBe('{"activeSlot":2,"value":"12"}');
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-labelledby')).toBe('gallery-interactive-otp-label');
    expect(hidden.form).toBe(form);
    expect(hidden.name).toBe('gallery-otp-code');
    expect(hidden.value).toBe('12');
    expect(new FormData(form).get('gallery-otp-code')).toBe('12');
    expect(first.value).toBe('1');
    expect(second.value).toBe('');
    expect(third.value).toBe('');
    expect(output.textContent).toBe('12');

    third.value = '3';
    third.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe('/c/src/interactive/otp-field-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe('{"activeSlot":3,"value":"123"}');
      expect(hidden.value).toBe('123');
      expect(new FormData(form).get('gallery-otp-code')).toBe('123');
      expect(third.value).toBe('3');
      expect(third.getAttribute('data-filled')).toBe('');
      expect(fourth.tabIndex).toBe(0);
      expect(output.textContent).toBe('123');
    });

    fourth.value = '4';
    fourth.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"activeSlot":3,"value":"1234"}');
      expect(root.getAttribute('data-complete')).toBe('');
      expect(hidden.value).toBe('1234');
      expect(new FormData(form).get('gallery-otp-code')).toBe('1234');
      expect(fourth.value).toBe('4');
      expect(fourth.getAttribute('data-complete')).toBe('');
      expect(output.textContent).toBe('1234');
    });

    // SPEC §12.1: the OTP filled/complete aggregate end-state (all slots filled, group
    // data-complete set, hidden aggregate input carrying the value) must stay axe-clean.
    await expectNoAxeViolations(root);
  });

  it('moves real DOM focus across OTP slots on type/arrow and deletes across slots', async () => {
    // Reproduces the reported bug: typing only flipped tabIndex; DOM focus stayed
    // on the current slot so the user could neither continue typing nor delete
    // across slots.
    const root = await mountInteractiveDemo(GalleryOtpFieldDemo);
    const third = required(root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-2'));
    const hidden = required(
      root.querySelector<HTMLInputElement>('#gallery-interactive-otp-hidden'),
    );
    installInteractiveGalleryLoader(root, { events: ['input', 'keydown'] });

    third.focus();
    expect(document.activeElement).toBe(third);

    // Typing a digit advances DOM focus to the next slot.
    third.value = '3';
    third.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      const fourth = required(
        root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-3'),
      );
      expect(document.activeElement).toBe(fourth);
    });

    // ArrowLeft moves DOM focus back to the previous slot.
    required(root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-3')).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' }),
    );
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        required(root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-2')),
      );
    });

    // Backspace on the now-focused filled slot deletes that digit.
    required(root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-2')).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' }),
    );
    await vi.waitFor(() => {
      expect(hidden.value).toBe('12');
      expect(
        required(root.querySelector<HTMLInputElement>('#gallery-interactive-otp-slot-2')).value,
      ).toBe('');
    });
  });

  it('keeps generated OTP delete and paste states accessible', async () => {
    const root = await mountInteractiveDemo(GalleryOtpFieldDemo);
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
    const { imports } = installInteractiveGalleryLoader(root, { events: ['keydown', 'paste'] });

    // Backspace on the empty active slot (2) now walks focus left to the previous
    // slot (1) so repeated Backspace can delete across slots — the "can't delete
    // multiple numbers" fix. The value is unchanged on this first press.
    third.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Backspace' }));

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe('/c/src/interactive/otp-field-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe('{"activeSlot":1,"value":"12"}');
      expect(root.hasAttribute('data-complete')).toBe(false);
      expect(hidden.value).toBe('12');
      expect(new FormData(form).get('gallery-otp-code')).toBe('12');
      expect(first.value).toBe('1');
      expect(second.value).toBe('2');
      expect(second.getAttribute('data-filled')).toBe('');
      expect(output.textContent).toBe('12');
    });

    await expectNoAxeViolations(root);

    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: Pick<DataTransfer, 'getData'>;
    };
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => '9 8 7 6' },
    });

    first.dispatchEvent(paste);

    await vi.waitFor(() => {
      expect(paste.defaultPrevented).toBe(true);
      expect(root.getAttribute('kovo-state')).toBe('{"activeSlot":3,"value":"9876"}');
      expect(root.getAttribute('data-complete')).toBe('');
      expect(hidden.value).toBe('9876');
      expect(hidden.getAttribute('data-complete')).toBe('');
      expect(new FormData(form).get('gallery-otp-code')).toBe('9876');
      expect(first.value).toBe('9');
      expect(second.value).toBe('8');
      expect(third.value).toBe('7');
      expect(fourth.value).toBe('6');
      expect(fourth.getAttribute('data-complete')).toBe('');
      expect(fourth.tabIndex).toBe(0);
      expect(output.textContent).toBe('9876');
    });

    await expectNoAxeViolations(root);
  });

  it('opens and closes a native dialog through generated handlers and invoker attributes', async () => {
    const root = await mountInteractiveDemo(GalleryDialogDemo);
    const trigger = required(root.querySelector<HTMLButtonElement>('button[command="show-modal"]'));
    const dialog = required(root.querySelector<HTMLDialogElement>('#gallery-dialog-content'));
    const close = required(
      dialog.querySelector<HTMLButtonElement>('button[command="request-close"]'),
    );
    const output = required(root.querySelector<HTMLOutputElement>('[data-demo-state="open"]'));
    const { imports } = installInteractiveGalleryLoader(root);

    expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('gallery-dialog-content');
    expect(dialog.open).toBe(false);
    expect(dialog.getAttribute('closedby')).toBe('any');
    expect(dialog.getAttribute('aria-labelledby')).toBe('gallery-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('gallery-dialog-description');
    expect(output.textContent).toBe('closed');

    trigger.click();

    await vi.waitFor(() => {
      expect(imports).toEqual(['/c/src/interactive/dialog-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(dialog.open).toBe(true);
    });

    await vi.waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    // SPEC §12.1: the open modal dialog top-layer state (aria-labelledby/aria-describedby wired,
    // focus trapped inside the promoted <dialog>) must stay axe-clean. axe.run(root) descends into
    // the dialog because it remains a DOM child of root.
    await expectNoAxeViolations(root);

    close.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(dialog.open).toBe(false);
    });

    trigger.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
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

  it('opens and closes sheet and drawer dialog variants through generated handlers', async () => {
    await expectInteractiveSideDialog({
      clientModulePath: '/c/src/interactive/sheet-demo.client.js',
      component: GallerySheetDemo,
      contentId: 'gallery-interactive-sheet-content',
      demoStateName: 'sheet-open',
      side: 'right',
    });

    await expectInteractiveSideDialog({
      clientModulePath: '/c/src/interactive/drawer-demo.client.js',
      component: GalleryDrawerDemo,
      contentId: 'gallery-interactive-drawer-content',
      demoStateName: 'drawer-open',
      side: 'bottom',
    });
  });

  it('updates switch stamped state while native checked state moves in the browser', async () => {
    const form = document.createElement('form');
    form.id = 'gallery-switch-form';
    form.dataset.galleryForm = 'switch';
    document.body.append(form);

    const root = await mountInteractiveDemo(GallerySwitchDemo);
    const input = required(root.querySelector<HTMLInputElement>('input'));
    installInteractiveGalleryLoader(root);

    expect(root.getAttribute('kovo-state')).toBe('{"checked":false}');
    expect(input.form).toBe(form);
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.checked).toBe(false);
    expect(new FormData(form).get('gallery-notifications')).toBeNull();

    input.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"checked":true}');
      expect(input.checked).toBe(true);
      expect(new FormData(form).get('gallery-notifications')).toBe('enabled');
    });

    input.focus();
    await userEvent.keyboard('{Space}');

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"checked":false}');
      expect(input.checked).toBe(false);
      expect(new FormData(form).get('gallery-notifications')).toBeNull();
    });

    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"checked":true}');
      expect(input.checked).toBe(true);
      expect(new FormData(form).get('gallery-notifications')).toBe('enabled');
    });
  });
});
