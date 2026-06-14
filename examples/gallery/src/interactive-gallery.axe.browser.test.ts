import { afterEach, describe, expect, it, vi } from 'vitest';

import { GalleryCommandDemo } from './generated/interactive/command-demo.js';
import { GalleryDropdownMenuDemo } from './generated/interactive/dropdown-menu-demo.js';
import { GalleryFieldDemo } from './generated/interactive/field-demo.js';
import { GalleryToastDemo } from './generated/interactive/toast-demo.js';
import { renderInteractiveGalleryRoute } from './interactive-docs.js';
import {
  expectNoAxeViolations,
  installGeneratedGalleryLoader,
  mountInteractiveDemo,
  required,
  staticVisualFixtureHtml,
  type StaticVisualFixturePath,
} from './interactive-gallery-browser-fixtures.js';

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
    const disabledAction = required(
      toastRoot.querySelector<HTMLButtonElement>('[data-toast-disabled-action]'),
    );

    expect(toast.hidden).toBe(false);
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(disabledAction.disabled).toBe(true);
    expect(disabledAction.getAttribute('data-dismiss-on-action')).toBe('false');
    expect(disabledAction.getAttribute('data-disabled')).toBe('');

    await expectNoAxeViolations(toastRoot);
  });

  it('has no axe violations in the static styled component fixtures', async () => {
    // SPEC §12.1: the static-only styled families (no interactive end-state to drive) must each be
    // axe-clean as rendered. These fixtures are otherwise only geometry/hash-checked, so this is the
    // sole accessibility gate for the static tier.
    const staticOnlyFixtures = [
      '/components/alert',
      '/components/avatar',
      '/components/badge',
      '/components/breadcrumb',
      '/components/button',
      '/components/card',
      '/components/kbd',
      '/components/separator',
      '/components/skeleton',
      '/components/table',
    ] as const satisfies readonly StaticVisualFixturePath[];

    for (const fixture of staticOnlyFixtures) {
      // Each fixture's route element is itself a <main> landmark. We axe-run that single route
      // <main> in isolation (via a <div> host, not the <main> wrapper mountStaticGalleryRoute uses
      // for its geometry baselines) so the assertion is about the styled component's own markup, not
      // a nested-landmark artifact of the test harness's mount wrapper.
      const host = document.createElement('div');
      host.innerHTML = staticVisualFixtureHtml[fixture];
      document.body.append(host);
      const route = required(host.querySelector<HTMLElement>(`[data-gallery-route="${fixture}"]`));

      await expectNoAxeViolations(route);

      // Each route is its own <main> landmark; remove this fixture before mounting the next one so
      // the document never holds two main landmarks at once (axe's landmark rules are document-wide,
      // not scoped to the axe.run root).
      host.remove();
    }
  });
});
