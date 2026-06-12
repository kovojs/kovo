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
  '/components/avatar',
  '/components/badge',
  '/components/breadcrumb',
  '/components/button',
  '/components/card',
  '/components/checkbox',
  '/components/dialog',
  '/components/drawer',
  '/components/field',
  '/components/kbd',
  '/components/meter',
  '/components/number-field',
  '/components/otp-field',
  '/components/progress',
  '/components/radio-group',
  '/components/scroll-area',
  '/components/select',
  '/components/separator',
  '/components/sheet',
  '/components/skeleton',
  '/components/switch',
  '/components/table',
  '/components/tabs',
  '/components/toggle',
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

  it('renders dialog fixture with native invoker and IDREF wiring', () => {
    const dialog = findFixture('/components/dialog');

    expect(dialog.html).toContain('command="show-modal"');
    expect(dialog.html).toContain('commandfor="gallery-dialog-content"');
    expect(dialog.html).toContain('aria-controls="gallery-dialog-content"');
    expect(dialog.html).toContain('aria-labelledby="gallery-dialog-title"');
    expect(dialog.html).toContain('aria-describedby="gallery-dialog-description"');
    expect(dialog.html).toContain('open');
  });

  it('renders field fixture with native label, message, and fieldset wiring', () => {
    const field = findFixture('/components/field');

    expect(field.html).toContain('for="gallery-field-email"');
    expect(field.html).toContain('name="email"');
    expect(field.html).toContain(
      'aria-describedby="gallery-field-description gallery-field-error"',
    );
    expect(field.html).toContain('aria-invalid="true"');
    expect(field.html).toContain('role="alert"');
    expect(field.html).toContain('aria-describedby="gallery-fieldset-description"');
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
    expect(otpField.html).toContain('readOnly');
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
    expect(radioGroup.html).toContain('disabled tabIndex="-1"');
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
    expect(scrollArea.html).toContain('tabIndex="0"');
    expect(scrollArea.html).toContain('id="gallery-scroll-area-scrollbar-y"');
    expect(scrollArea.html).toContain('data-orientation="vertical"');
    expect(scrollArea.html).toContain('id="gallery-scroll-area-thumb-y"');
    expect(scrollArea.html).toContain('data-state="visible"');
    expect(scrollArea.html).toContain('id="gallery-scroll-area-scrollbar-x"');
    expect(scrollArea.html).toContain('data-orientation="horizontal"');
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
    expect(select.html).toContain('name="gallery-plan"');
    expect(select.html).toContain('required');
    expect(select.html).toContain('aria-labelledby="gallery-select-label"');
    expect(select.html).toContain('value="growth"');
    expect(select.html).toContain('selected');
    expect(select.html).toContain('disabled');
    expect(select.html).toContain('<span>Growth</span>');
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

  it('renders tabs fixture with tablist, trigger, and panel wiring', () => {
    const tabs = findFixture('/components/tabs');

    expect(tabs.html).toContain('role="tablist"');
    expect(tabs.html).toContain('aria-label="Gallery tabs"');
    expect(tabs.html).toContain('role="tab"');
    expect(tabs.html).toContain('aria-selected="true"');
    expect(tabs.html).toContain('aria-controls="gallery-tabs-overview-panel"');
    expect(tabs.html).toContain('role="tabpanel"');
    expect(tabs.html).toContain('aria-labelledby="gallery-tabs-overview"');
    expect(tabs.html).toContain('disabled role="tab" tabIndex="-1"');
  });

  it('renders progress fixture states through native progress attributes', () => {
    const progress = findFixture('/components/progress');

    expect(progress.html).toContain('data-state="loading"');
    expect(progress.html).toContain('data-value="42"');
    expect(progress.html).toContain('aria-valuetext="42 of 100 tasks complete"');
    expect(progress.html).toContain('data-state="complete"');
    expect(progress.html).toContain('data-state="indeterminate"');
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
    const drawer = findFixture('/components/drawer');
    const kbd = findFixture('/components/kbd');
    const sheet = findFixture('/components/sheet');
    const skeleton = findFixture('/components/skeleton');
    const table = findFixture('/components/table');

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

    expect(drawer.html).toContain('data-ui-demo="drawer"');
    expect(drawer.html).toContain('command="show-modal" commandfor="gallery-drawer"');
    expect(drawer.html).toContain('<dialog aria-describedby="gallery-drawer-description"');
    expect(drawer.html).toContain('id="gallery-drawer" open>');
    expect(drawer.html).toContain('bottom-0 max-h-[85vh] border-t');
    expect(drawer.html).toContain('command="request-close" commandfor="gallery-drawer"');

    expect(kbd.html).toContain('data-ui-demo="kbd"');
    expect(kbd.html).toContain('<kbd class="inline-flex h-5 min-w-5');
    expect(kbd.html).toContain('uppercase">K</kbd>');

    expect(sheet.html).toContain('data-ui-demo="sheet"');
    expect(sheet.html).toContain('command="show-modal" commandfor="gallery-sheet"');
    expect(sheet.html).toContain('<dialog aria-describedby="gallery-sheet-description"');
    expect(sheet.html).toContain('id="gallery-sheet" open>');
    expect(sheet.html).toContain('command="request-close" commandfor="gallery-sheet"');

    expect(skeleton.html).toContain('data-ui-demo="skeleton"');
    expect(skeleton.html).toContain('aria-hidden="true"');
    expect(skeleton.html).toContain('animate-pulse rounded-md bg-neutral-200 h-4 w-40');

    expect(table.html).toContain('data-ui-demo="table"');
    expect(table.html).toContain('<caption class="mt-3 text-sm text-neutral-500">');
    expect(table.html).toContain('<thead class="border-b border-neutral-200 bg-neutral-50">');
    expect(table.html).toContain('<th class="h-10 px-3 text-left align-middle');
    expect(table.html).toContain('scope="row">INV-0042</th>');
    expect(table.html).toContain('colspan="3"');
  });
});

function findFixture(path: (typeof galleryRoutes)[number]['path']) {
  const fixture = galleryFixtures().find((candidate) => candidate.path === path);

  if (!fixture) {
    throw new Error(`Missing gallery fixture for ${path}`);
  }

  return fixture;
}
