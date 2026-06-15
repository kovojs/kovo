import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { GalleryCollapsibleDemo } from './generated/interactive/collapsible-demo.js';
import { GalleryCommandDemo } from './generated/interactive/command-demo.js';
import { GalleryContextMenuDemo } from './generated/interactive/context-menu-demo.js';
import { GalleryDropdownMenuDemo } from './generated/interactive/dropdown-menu-demo.js';
import { GalleryHoverCardDemo } from './generated/interactive/hover-card-demo.js';
import { GalleryMenubarDemo } from './generated/interactive/menubar-demo.js';
import { GalleryMeterDemo } from './generated/interactive/meter-demo.js';
import { GalleryNavigationMenuDemo } from './generated/interactive/navigation-menu-demo.js';
import { GalleryPopoverDemo } from './generated/interactive/popover-demo.js';
import { GalleryProgressDemo } from './generated/interactive/progress-demo.js';
import { GalleryPureMarkupDemo } from './generated/interactive/pure-markup-demo.js';
import { GalleryRadioGroupDemo } from './generated/interactive/radio-group-demo.js';
import { GalleryScrollAreaDemo } from './generated/interactive/scroll-area-demo.js';
import { GallerySliderDemo } from './generated/interactive/slider-demo.js';
import { GalleryTabsDemo } from './generated/interactive/tabs-demo.js';
import { GalleryToastDemo } from './generated/interactive/toast-demo.js';
import { GalleryToggleGroupDemo } from './generated/interactive/toggle-group-demo.js';
import { GalleryToolbarDemo } from './generated/interactive/toolbar-demo.js';
import { GalleryTooltipDemo } from './generated/interactive/tooltip-demo.js';
import {
  expectNoAxeViolations,
  installGeneratedGalleryLoader,
  mountInteractiveDemo,
  required,
} from './interactive-gallery-browser-fixtures.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('compiled interactive gallery demos in the browser', () => {
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

    // SPEC §12.1: the collapsible open end-state (native <details open>, summary aria-expanded=true,
    // content revealed) must stay axe-clean. Asserted before the keyboard toggle collapses it.
    await expectNoAxeViolations(root);

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
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
    );
    installGeneratedGalleryLoader(root, { events: ['click', 'keydown'] });

    expect(button.getAttribute('popovertarget')).toBe('gallery-popover-content');
    expect(content.matches(':popover-open')).toBe(false);
    expect(output.textContent).toBe('closed');

    button.click();

    await vi.waitFor(() => {
      const currentContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(currentContent.matches(':popover-open')).toBe(true);
      expect(currentOutput.textContent).toBe('open');
    });

    // SPEC §12.1: the popover open top-layer state (content :popover-open, promoted to the top
    // layer) must stay axe-clean. The popover content stays a DOM child of root, so axe.run(root)
    // descends into it.
    await expectNoAxeViolations(root);

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));

    await vi.waitFor(() => {
      const currentContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(currentContent.matches(':popover-open')).toBe(true);
      expect(currentOutput.textContent).toBe('open');
    });

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));

    await vi.waitFor(() => {
      const currentContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(currentContent.matches(':popover-open')).toBe(false);
      expect(currentOutput.textContent).toBe('closed');
    });

    required(root.querySelector<HTMLButtonElement>('button')).click();

    await vi.waitFor(() => {
      const currentContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(currentContent.matches(':popover-open')).toBe(true);
      expect(currentOutput.textContent).toBe('open');
    });

    required(root.querySelector<HTMLButtonElement>('button')).click();

    await vi.waitFor(() => {
      const currentContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"open":false}');
      expect(currentContent.matches(':popover-open')).toBe(false);
      expect(currentOutput.textContent).toBe('closed');
    });

    required(root.querySelector<HTMLButtonElement>('button')).click();

    await vi.waitFor(() => {
      const currentContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('fw-state')).toBe('{"open":true}');
      expect(currentContent.matches(':popover-open')).toBe(true);
      expect(currentOutput.textContent).toBe('open');
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

    // SPEC §12.1: the radio-group selected/roving state after keyboard and click changes
    // must stay axe-clean, including the disabled item.
    await expectNoAxeViolations(root);
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

    // SPEC §12.1: the slider end-state after the native range moves to 75 (updated
    // aria-valuetext and range ratio) must stay axe-clean.
    await expectNoAxeViolations(root);
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
    expect(viewport.getAttribute('data-scroll-y')).toBe('start');
    expect(scrollbar.getAttribute('aria-hidden')).toBe('true');
    expect(scrollbar.getAttribute('data-orientation')).toBe('vertical');
    expect(scrollbar.getAttribute('data-state')).toBe('visible');
    expect(thumb.getAttribute('data-scroll-position')).toBe('start');
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
      expect(currentViewport.getAttribute('data-scroll-y')).toBe('end');
      expect(currentThumb.getAttribute('data-scroll-position')).toBe('end');
      expect(currentButton.getAttribute('aria-pressed')).toBe('true');
      expect(currentButton.textContent).toBe('Back to top');
      expect(currentOutput.textContent).toBe('end');
    });

    await expectNoAxeViolations(root);
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

    // SPEC §12.1: the progress complete state (value=max=100, aria-valuetext describing it) must
    // stay axe-clean.
    await expectNoAxeViolations(root);

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

    // SPEC §12.1: the progress indeterminate end-state (no value attribute, data-state=indeterminate
    // with an aria-valuetext) must stay axe-clean.
    await expectNoAxeViolations(root);
  });

  it('renders pure markup styled surfaces and updates submit state through generated handlers', async () => {
    const root = mountInteractiveDemo(GalleryPureMarkupDemo);
    const card = required(root.querySelector<HTMLElement>('[data-card="summary"]'));
    const badge = required(card.querySelector<HTMLElement>('span'));
    const breadcrumb = required(root.querySelector<HTMLElement>('nav[aria-label="Release trail"]'));
    const current = required(breadcrumb.querySelector<HTMLAnchorElement>('[aria-current="page"]'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-pure-markup-form'));
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const table = required(root.querySelector<HTMLTableElement>('table[aria-label]'));
    const skeleton = required(
      root.querySelector<HTMLElement>('[aria-hidden="true"].animate-pulse'),
    );
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="pure-markup-submit"]'),
    );
    const { imports } = installGeneratedGalleryLoader(root);

    expect(root.getAttribute('fw-state')).toBe('{"submitted":false}');
    expect(root.dataset.galleryInteractive).toBe('pure-markup');
    expect(card.className).toContain('rounded-lg');
    expect(badge.className).toContain('border-emerald-200');
    expect(current.textContent).toBe('Table');
    expect(button.form).toBe(form);
    expect(button.type).toBe('button');
    expect(table.tHead?.rows.item(0)?.cells).toHaveLength(2);
    expect(table.tBodies.item(0)?.rows).toHaveLength(2);
    expect(skeleton.className).toContain('animate-pulse');
    expect(output.textContent).toBe('pending');

    await expectNoAxeViolations(root);

    button.click();

    await vi.waitFor(() => {
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="pure-markup-submit"]'),
      );

      expect(imports).toEqual([
        '/c/examples/gallery/src/generated/interactive/pure-markup-demo.client.js',
      ]);
      expect(root.getAttribute('fw-state')).toBe('{"submitted":true}');
      expect(currentOutput.textContent).toBe('confirmed');
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

    // SPEC §12.1: the meter optimum end-state (value in the optimum band, data-state=optimum with an
    // aria-valuetext) must stay axe-clean.
    await expectNoAxeViolations(root);
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

    // SPEC §12.1: the active tab/panel state after keyboard roving and activation must
    // stay axe-clean, not only the initial render.
    await expectNoAxeViolations(root);
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

    // SPEC §12.1: the toolbar roving/pressed state after keyboard move and press must stay
    // axe-clean, including the disabled toolbar button.
    await expectNoAxeViolations(root);
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

    // SPEC §12.1: the toggle-group multi-pressed/roving state after keyboard move and
    // press must stay axe-clean, including the disabled item.
    await expectNoAxeViolations(root);
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

    // SPEC §12.1: the dropdown-menu open state (expanded trigger, visible role="menu"
    // with a disabled item) must stay axe-clean.
    await expectNoAxeViolations(dropdownRoot);

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

    // SPEC §12.1: the context-menu open state (anchored, visible role="menu" with a
    // disabled item) must stay axe-clean.
    await expectNoAxeViolations(contextRoot);

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

    // SPEC §12.1: the menubar open state (expanded top-level item, visible nested
    // role="menu" with a disabled item) must stay axe-clean.
    await expectNoAxeViolations(menubarDemo);

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

    // SPEC §12.1: the navigation-menu open state (expanded trigger, visible content
    // viewport) must stay axe-clean.
    await expectNoAxeViolations(navRoot);

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

    // SPEC §12.1: the command open dialog state (filtered listbox with an active
    // descendant and a disabled item) must stay axe-clean.
    await expectNoAxeViolations(commandRoot);

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
    const disabledAction = required(
      toastRoot.querySelector<HTMLButtonElement>('[data-toast-disabled-action]'),
    );
    const toastOutput = required(
      toastRoot.querySelector<HTMLOutputElement>('[data-demo-state="toast-open"]'),
    );
    installGeneratedGalleryLoader(toastRoot, { events: ['click', 'keydown'] });

    expect(toastRoot.getAttribute('role')).toBe('region');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.getAttribute('data-state')).toBe('open');
    expect(toast.hidden).toBe(false);
    expect(disabledAction.disabled).toBe(true);
    expect(toastOutput.textContent).toBe('open');

    disabledAction.click();

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('fw-state')).toBe('{"open":true}');
      expect(toast.hidden).toBe(false);
      expect(toast.getAttribute('data-state')).toBe('open');
      expect(toastOutput.textContent).toBe('open');
    });

    cancelDismiss.click();

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('fw-state')).toBe('{"open":true}');
      expect(toast.hidden).toBe(false);
      expect(toast.getAttribute('data-state')).toBe('open');
      expect(toastOutput.textContent).toBe('open');
    });

    // SPEC §12.1: the toast open state after a canceled dismiss (live region with a
    // disabled action that did not auto-dismiss) must stay axe-clean.
    await expectNoAxeViolations(toastRoot);

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

    // SPEC §12.1: the tooltip open state (trigger aria-describedby pointing at the visible
    // role=tooltip content, content :popover-open) must stay axe-clean. The tooltip content is a
    // popover="manual" DOM child of root, so axe.run(root) descends into it.
    await expectNoAxeViolations(root);

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
