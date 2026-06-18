import { afterEach, describe, expect, it } from 'vitest';

import { mountStaticGalleryRoute, required } from './interactive-gallery.generated-browser-fixtures.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('compiled interactive gallery demos in the browser', () => {
  it('preserves styled checkbox and switch native form ownership in static routes', async () => {
    const checkboxRoute = mountStaticGalleryRoute('/components/checkbox');
    const checkboxForm = required(
      checkboxRoute.querySelector<HTMLFormElement>('#gallery-checkbox-form'),
    );
    const checkbox = required(
      checkboxRoute.querySelector<HTMLInputElement>('#gallery-checkbox-consent'),
    );

    expect(checkbox.getAttribute('aria-describedby')).toBe('gallery-checkbox-help');
    expect(checkbox.form).toBe(checkboxForm);
    expect(new FormData(checkboxForm).get('gallery-consent')).toBe('accepted');

    checkbox.checked = false;
    expect(new FormData(checkboxForm).get('gallery-consent')).toBeNull();

    const switchRoute = mountStaticGalleryRoute('/components/switch');
    const switchForm = required(switchRoute.querySelector<HTMLFormElement>('#gallery-switch-form'));
    const switchInput = required(
      switchRoute.querySelector<HTMLInputElement>('#gallery-switch-notifications'),
    );

    expect(switchInput.getAttribute('aria-describedby')).toBe('gallery-switch-help');
    expect(switchInput.getAttribute('role')).toBe('switch');
    expect(switchInput.form).toBe(switchForm);
    expect(new FormData(switchForm).get('gallery-notifications')).toBe('enabled');

    switchInput.checked = false;
    expect(new FormData(switchForm).get('gallery-notifications')).toBeNull();
  });

  it('preserves styled radio-group native form ownership in static routes', async () => {
    const radioRoute = mountStaticGalleryRoute('/components/radio-group');
    const radioForm = required(radioRoute.querySelector<HTMLFormElement>('#gallery-radio-form'));
    const radioGroup = required(
      radioRoute.querySelector<HTMLElement>('#gallery-radio-group[role="radiogroup"]'),
    );
    const standard = required(
      radioRoute.querySelector<HTMLInputElement>('#gallery-radio-standard'),
    );
    const express = required(radioRoute.querySelector<HTMLInputElement>('#gallery-radio-express'));
    const freight = required(radioRoute.querySelector<HTMLInputElement>('#gallery-radio-freight'));

    expect(radioGroup.getAttribute('aria-labelledby')).toBe('gallery-radio-label');
    expect(radioGroup.getAttribute('aria-describedby')).toBe(
      'gallery-radio-description gallery-radio-error',
    );
    expect(radioGroup.getAttribute('aria-invalid')).toBe('true');
    expect(express.form).toBe(radioForm);
    expect(new FormData(radioForm).get('gallery-shipping-speed')).toBe('express');

    standard.checked = true;
    expect(new FormData(radioForm).get('gallery-shipping-speed')).toBe('standard');

    expect(freight.disabled).toBe(true);
    freight.checked = true;
    expect(new FormData(radioForm).get('gallery-shipping-speed')).toBeNull();
  });

  it('preserves native disabled behavior for styled menu and command buttons in static routes', async () => {
    const commandRoute = mountStaticGalleryRoute('/components/command');
    const commandDelete = required(
      commandRoute.querySelector<HTMLButtonElement>('#gallery-command-listbox-item-2'),
    );
    const dropdownRoute = mountStaticGalleryRoute('/components/dropdown-menu');
    const dropdownArchive = required(
      dropdownRoute.querySelector<HTMLButtonElement>('#gallery-dropdown-menu-archive'),
    );
    const contextRoute = mountStaticGalleryRoute('/components/context-menu');
    const contextDelete = required(
      contextRoute.querySelector<HTMLButtonElement>('#gallery-context-menu-delete'),
    );
    const menubarRoute = mountStaticGalleryRoute('/components/menubar');
    const menubarImport = required(
      menubarRoute.querySelector<HTMLButtonElement>('#gallery-menubar-import'),
    );

    for (const button of [commandDelete, dropdownArchive, contextDelete, menubarImport]) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.getAttribute('data-disabled')).toBe('');

      button.focus();
      expect(document.activeElement).not.toBe(button);
    }
  });
});
