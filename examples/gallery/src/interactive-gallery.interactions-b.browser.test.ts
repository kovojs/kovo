import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { GalleryAccordionDemo } from './interactive/accordion-demo.js';
import { GalleryCollapsibleDemo } from './interactive/collapsible-demo.js';
import { GalleryCommandDemo } from './interactive/command-demo.js';
import { GalleryContextMenuDemo } from './interactive/context-menu-demo.js';
import { GalleryDropdownMenuDemo } from './interactive/dropdown-menu-demo.js';
import { GalleryHoverCardDemo } from './interactive/hover-card-demo.js';
import { GalleryMenubarDemo } from './interactive/menubar-demo.js';
import { GalleryMeterDemo } from './interactive/meter-demo.js';
import { GalleryNavigationMenuDemo } from './interactive/navigation-menu-demo.js';
import { GalleryPopoverDemo } from './interactive/popover-demo.js';
import { GalleryProgressDemo } from './interactive/progress-demo.js';
import { GalleryPureMarkupDemo } from './interactive/pure-markup-demo.js';
import { GalleryRadioGroupDemo } from './interactive/radio-group-demo.js';
import { GalleryScrollAreaDemo } from './interactive/scroll-area-demo.js';
import { GallerySliderDemo } from './interactive/slider-demo.js';
import { GalleryTabsDemo } from './interactive/tabs-demo.js';
import { GalleryToastDemo } from './interactive/toast-demo.js';
import { GalleryToggleGroupDemo } from './interactive/toggle-group-demo.js';
import { GalleryToolbarDemo } from './interactive/toolbar-demo.js';
import { GalleryTooltipDemo } from './interactive/tooltip-demo.js';
import {
  expectNoAxeViolations,
  installInteractiveGalleryLoader,
  mountInteractiveDemo,
  required,
} from './interactive-gallery.browser-fixtures.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('compiled interactive gallery demos in the browser', () => {
  it('updates accordion roving tabindex and stamped panel state through generated handlers', async () => {
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
    expect(root.getAttribute('data-orientation')).toBe('vertical');
    expect(shipping.getAttribute('aria-expanded')).toBe('true');
    expect(shipping.getAttribute('data-state')).toBe('open');
    expect(shipping.tabIndex).toBe(0);
    expect(shippingPanel.hidden).toBe(false);
    expect(billing.getAttribute('aria-expanded')).toBe('false');
    expect(billing.getAttribute('data-state')).toBe('closed');
    expect(billing.tabIndex).toBe(-1);
    expect(billingPanel.hidden).toBe(true);
    expect(output.textContent).toBe('shipping');

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));

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

      expect(imports).toEqual(['/c/src/interactive/accordion-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"billing","value":"shipping"}');
      expect(currentShipping.getAttribute('aria-expanded')).toBe('true');
      expect(currentShipping.tabIndex).toBe(-1);
      expect(currentShippingPanel.hidden).toBe(false);
      expect(currentBilling.getAttribute('aria-expanded')).toBe('false');
      expect(currentBilling.tabIndex).toBe(0);
      expect(currentBillingPanel.hidden).toBe(true);
      expect(document.activeElement).toBe(currentBilling);
    });

    required(root.querySelector<HTMLButtonElement>('#gallery-accordion-billing-trigger')).click();

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

      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"billing","value":"billing"}');
      expect(currentShipping.getAttribute('aria-expanded')).toBe('false');
      expect(currentShipping.getAttribute('data-state')).toBe('closed');
      expect(currentShippingPanel.hidden).toBe(true);
      expect(currentBilling.getAttribute('aria-expanded')).toBe('true');
      expect(currentBilling.getAttribute('data-state')).toBe('open');
      expect(currentBillingPanel.hidden).toBe(false);
      expect(currentOutput.textContent).toBe('billing');
    });

    // SPEC §12.1: the accordion roving and expanded state after keyboard movement and
    // click activation must stay axe-clean.
    await expectNoAxeViolations(root);
  });

  it('updates collapsible stamped state while native details open state moves', async () => {
    const root = (await mountInteractiveDemo(GalleryCollapsibleDemo)) as HTMLDetailsElement;
    const summary = required(root.querySelector<HTMLElement>('summary'));
    const content = required(root.querySelector<HTMLElement>('#gallery-collapsible-content'));
    installInteractiveGalleryLoader(root);

    expect(root.open).toBe(false);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(content.id).toBe('gallery-collapsible-content');

    summary.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(root.open).toBe(true);
    });

    // SPEC §12.1: the collapsible open end-state (native <details open>, summary aria-expanded=true,
    // content revealed) must stay axe-clean. Asserted before the keyboard toggle collapses it.
    await expectNoAxeViolations(root);

    summary.focus();
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(root.open).toBe(false);
    });
  });

  it('updates popover stamped state while native top-layer state moves', async () => {
    const root = await mountInteractiveDemo(GalleryPopoverDemo);
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const content = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
    );
    installInteractiveGalleryLoader(root, { events: ['beforetoggle'] });

    expect(button.getAttribute('popovertarget')).toBe('gallery-popover-content');
    expect(content.matches(':popover-open')).toBe(false);
    expect(output.textContent).toBe('closed');

    button.click();

    await vi.waitFor(() => {
      const currentContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(currentContent.matches(':popover-open')).toBe(true);
      expect(currentOutput.textContent).toBe('open');
    });

    // SPEC §12.1: the popover open top-layer state (content :popover-open, promoted to the top
    // layer) must stay axe-clean. The popover content stays a DOM child of root, so axe.run(root)
    // descends into it.
    await expectNoAxeViolations(root);

    required(root.querySelector<HTMLButtonElement>('button')).click();

    await vi.waitFor(() => {
      const currentContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(currentContent.matches(':popover-open')).toBe(false);
      expect(currentOutput.textContent).toBe('closed');
    });

    required(root.querySelector<HTMLButtonElement>('button')).click();

    await vi.waitFor(() => {
      const currentContent = required(root.querySelector<HTMLElement>('#gallery-popover-content'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(currentContent.matches(':popover-open')).toBe(true);
      expect(currentOutput.textContent).toBe('open');
    });

    required(root.querySelector<HTMLElement>('#gallery-popover-content')).hidePopover();

    await vi.waitFor(() => {
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(currentOutput.textContent).toBe('closed');
      expect(
        required(root.querySelector<HTMLElement>('#gallery-popover-content')).matches(
          ':popover-open',
        ),
      ).toBe(false);
    });

    required(root.querySelector<HTMLButtonElement>('button')).click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(
        required(root.querySelector<HTMLElement>('#gallery-popover-content')).matches(
          ':popover-open',
        ),
      ).toBe(true);
    });

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="popover-open"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(currentOutput.textContent).toBe('closed');
      expect(
        required(root.querySelector<HTMLElement>('#gallery-popover-content')).matches(
          ':popover-open',
        ),
      ).toBe(false);
    });
  });

  it('updates radio-group selection from keyboard and native radio clicks', async () => {
    const root = await mountInteractiveDemo(GalleryRadioGroupDemo);
    const email = required(root.querySelector<HTMLInputElement>('#gallery-radio-email'));
    const phone = required(root.querySelector<HTMLInputElement>('#gallery-radio-phone'));
    const sms = required(root.querySelector<HTMLInputElement>('#gallery-radio-sms'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-radio-form'));
    const { imports } = installInteractiveGalleryLoader(root, {
      events: ['click', 'input', 'change', 'keydown'],
    });

    expect(root.getAttribute('role')).toBe('radiogroup');
    expect(root.getAttribute('aria-required')).toBe('true');
    expect(root.getAttribute('kovo-state')).toBe('{"value":"email"}');
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

    sms.focus();
    await userEvent.keyboard('{ArrowRight}');

    await vi.waitFor(() => {
      const currentEmail = required(root.querySelector<HTMLInputElement>('#gallery-radio-email'));
      const currentPhone = required(root.querySelector<HTMLInputElement>('#gallery-radio-phone'));
      const currentSms = required(root.querySelector<HTMLInputElement>('#gallery-radio-sms'));
      const currentForm = required(root.querySelector<HTMLFormElement>('#gallery-radio-form'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="radio-value"]'),
      );

      expect(imports.at(-1)).toBe('/c/src/interactive/radio-group-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe('{"value":"sms"}');
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

      expect(root.getAttribute('kovo-state')).toBe('{"value":"email"}');
      expect(currentEmail.checked).toBe(true);
      expect(currentSms.checked).toBe(false);
      expect(new FormData(currentForm).get('gallery-contact-channel')).toBe('email');
    });

    // SPEC §12.1: the radio-group selected/roving state after keyboard and click changes
    // must stay axe-clean, including the disabled item.
    await expectNoAxeViolations(root);
  });

  it('updates slider stamped state through custom thumb, keyboard, and track handlers', async () => {
    const root = await mountInteractiveDemo(GallerySliderDemo);
    const input = required(root.querySelector<HTMLInputElement>('#gallery-slider-input'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-slider-form'));
    const track = required(root.querySelector<HTMLElement>('[data-part="track"]'));
    const range = required(root.querySelector<HTMLElement>('[data-part="range"]'));
    const thumb = required(root.querySelector<HTMLElement>('[data-part="thumb"]'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="slider-value"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root, {
      events: ['keydown', 'pointerdown', 'pointermove', 'pointerup'],
    });

    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 200 });

    expect(root.getAttribute('kovo-state')).toBe(
      '{"dragging":false,"dragPointerStart":0,"dragValueStart":25,"value":25}',
    );
    expect(root.getAttribute('data-value')).toBe('25');
    expect(input.type).toBe('range');
    expect(input.form).toBe(form);
    expect(input.name).toBe('gallery-completion');
    expect(input.value).toBe('25');
    expect(new FormData(form).get('gallery-completion')).toBe('25');
    expect(thumb.getAttribute('role')).toBe('slider');
    expect(thumb.getAttribute('aria-valuemin')).toBe('0');
    expect(thumb.getAttribute('aria-valuemax')).toBe('100');
    expect(thumb.getAttribute('aria-valuenow')).toBe('25');
    expect(thumb.getAttribute('aria-valuetext')).toBe('25 percent');
    expect(range.getAttribute('data-value-ratio')).toBe('0.25');
    expect(output.textContent).toBe('25');

    const trackDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(trackDown, 'offsetX', { configurable: true, value: 150 });
    track.dispatchEvent(trackDown);

    await vi.waitFor(() => {
      const currentInput = required(root.querySelector<HTMLInputElement>('#gallery-slider-input'));
      const currentRange = required(root.querySelector<HTMLElement>('[data-part="range"]'));
      const currentThumb = required(root.querySelector<HTMLElement>('[data-part="thumb"]'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="slider-value"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe(
        '{"dragging":false,"dragPointerStart":0,"dragValueStart":25,"value":75}',
      );
      expect(imports).toEqual(['/c/src/interactive/slider-demo.client.js']);
      expect(root.getAttribute('data-value')).toBe('75');
      expect(currentInput.value).toBe('75');
      expect(new FormData(form).get('gallery-completion')).toBe('75');
      expect(currentRange.getAttribute('data-value-ratio')).toBe('0.75');
      expect(currentThumb.getAttribute('aria-valuenow')).toBe('75');
      expect(currentThumb.getAttribute('aria-valuetext')).toBe('75 percent');
      expect(currentOutput.textContent).toBe('75');
    });

    thumb.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Home' }),
    );

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe(
        '{"dragging":false,"dragPointerStart":0,"dragValueStart":25,"value":0}',
      );
      expect(input.value).toBe('0');
      expect(thumb.getAttribute('aria-valuenow')).toBe('0');
      expect(output.textContent).toBe('0');
    });

    thumb.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 20 }),
    );
    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe(
        '{"dragging":true,"dragPointerStart":20,"dragValueStart":0,"value":0}',
      );
      expect(thumb.getAttribute('data-dragging')).toBe('');
    });

    thumb.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: 170 }),
    );
    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe(
        '{"dragging":true,"dragPointerStart":20,"dragValueStart":0,"value":75}',
      );
      expect(input.value).toBe('75');
      expect(thumb.getAttribute('aria-valuenow')).toBe('75');
    });

    thumb.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe(
        '{"dragging":false,"dragPointerStart":20,"dragValueStart":0,"value":75}',
      );
      expect(thumb.hasAttribute('data-dragging')).toBe(false);
    });

    // SPEC §12.1: the custom slider end-state after pointer and keyboard changes
    // must keep its role/valuenow/valuetext contract axe-clean.
    await expectNoAxeViolations(root);
  });

  it('updates scroll-area viewport position and primitive state through a generated handler', async () => {
    const root = await mountInteractiveDemo(GalleryScrollAreaDemo);
    const viewport = required(root.querySelector<HTMLElement>('#gallery-scroll-area-viewport'));
    const scrollbar = required(root.querySelector<HTMLElement>('#gallery-scroll-area-scrollbar'));
    const thumb = required(root.querySelector<HTMLElement>('#gallery-scroll-area-thumb'));
    const corner = required(root.querySelector<HTMLElement>('#gallery-scroll-area-corner'));
    const button = required(root.querySelector<HTMLButtonElement>('#gallery-scroll-area-toggle'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="scroll-area-position"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root);

    expect(root.getAttribute('kovo-state')).toBe(
      '{"dragging":false,"dragPointerStart":0,"dragScrollTop":0,"dragThumbSize":28,"dragTrackSize":72,"hasOverflowY":true,"hovering":false,"scrolling":false,"scrollTop":0,"scrollY":"start","thumbOffset":0,"thumbSize":28,"verticalVisible":true}',
    );
    expect(viewport.getAttribute('role')).toBe('region');
    expect(viewport.getAttribute('aria-label')).toBe('Release notes');
    expect(viewport.tabIndex).toBe(0);
    expect(viewport.scrollTop).toBe(0);
    expect(viewport.getAttribute('data-scroll-y')).toBe('start');
    expect(viewport.getAttribute('data-has-overflow-y')).toBe('');
    expect(scrollbar.getAttribute('aria-hidden')).toBe('true');
    expect(scrollbar.getAttribute('data-orientation')).toBe('vertical');
    expect(scrollbar.getAttribute('data-state')).toBe('hidden');
    expect(scrollbar.hidden).toBe(true);
    expect(thumb.getAttribute('data-scroll-position')).toBe('start');
    expect(thumb.hidden).toBe(true);
    expect(corner.hidden).toBe(true);
    expect(button.getAttribute('aria-controls')).toBe('gallery-scroll-area-viewport');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(output.textContent).toBe('start');

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

      expect(imports).toEqual(['/c/src/interactive/scroll-area-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toContain('"scrollY":"end"');
      expect(root.getAttribute('kovo-state')).toContain('"scrolling":true');
      expect(currentViewport.getAttribute('data-scroll-y')).toBe('end');
      expect(currentThumb.getAttribute('data-scroll-position')).toBe('end');
      expect(currentThumb.hidden).toBe(false);
      expect(currentThumb.style.top).toBe('53%');
      expect(currentButton.getAttribute('aria-pressed')).toBe('true');
      expect(currentButton.textContent).toBe('Back to top');
      expect(currentOutput.textContent).toBe('end');
    });

    viewport.scrollTop = 80;
    viewport.dispatchEvent(new Event('scroll'));

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toContain('"scrollY":"middle"');
      expect(root.getAttribute('kovo-state')).toContain('"hasOverflowY":true');
      expect(viewport.getAttribute('data-scroll-y')).toBe('middle');
      expect(thumb.getAttribute('data-scroll-position')).toBe('middle');
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(output.textContent).toBe('middle');
    });

    Object.defineProperty(scrollbar, 'clientHeight', { configurable: true, value: 72 });
    Object.defineProperty(thumb, 'clientHeight', { configurable: true, value: 20 });
    thumb.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientY: 10,
      }),
    );

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toContain('"dragging":true');
      expect(thumb.getAttribute('data-dragging')).toBe('');
    });

    thumb.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
      }),
    );

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toContain('"dragging":false');
    });

    await expectNoAxeViolations(root);
  });

  it('updates progress native value and indeterminate state through generated handlers', async () => {
    const root = await mountInteractiveDemo(GalleryProgressDemo);
    const progress = required(root.querySelector<HTMLProgressElement>('progress'));
    const complete = required(root.querySelector<HTMLButtonElement>('button'));
    const pending = required(root.querySelectorAll<HTMLButtonElement>('button').item(1));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="progress-value"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root);

    expect(root.getAttribute('kovo-state')).toBe('{"value":40}');
    expect(progress.max).toBe(100);
    expect(progress.value).toBe(40);
    expect(progress.getAttribute('data-state')).toBe('loading');
    expect(progress.getAttribute('aria-valuetext')).toBe('40 percent uploaded');
    expect(output.textContent).toBe('40%');

    complete.click();

    await vi.waitFor(() => {
      const currentProgress = required(root.querySelector<HTMLProgressElement>('progress'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="progress-value"]'),
      );

      expect(imports.at(-1)).toBe('/c/src/interactive/progress-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe('{"value":100}');
      expect(currentProgress.value).toBe(100);
      // data-state is now reactive (was frozen at the SSR 'loading'): value=max ⇒ complete.
      expect(currentProgress.getAttribute('data-state')).toBe('complete');
      expect(currentProgress.getAttribute('aria-valuetext')).toBe('100 percent uploaded');
      expect(currentOutput.textContent).toBe('100%');
    });

    // SPEC §12.1: the progress determinate state (value=100, aria-valuetext describing it) must
    // stay axe-clean.
    await expectNoAxeViolations(root);

    pending.click();

    await vi.waitFor(() => {
      const currentProgress = required(root.querySelector<HTMLProgressElement>('progress'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="progress-value"]'),
      );

      expect(root.getAttribute('kovo-state')).toBe('{"value":null}');
      expect(currentProgress.hasAttribute('value')).toBe(false);
      // Reactive data-state: value=null ⇒ indeterminate (was frozen at 'loading').
      expect(currentProgress.getAttribute('data-state')).toBe('indeterminate');
      expect(currentProgress.getAttribute('aria-valuetext')).toBe('Upload pending');
      expect(currentOutput.textContent).toBe('pending');
    });

    // SPEC §12.1: the progress pending end-state (no value attribute with an aria-valuetext) must
    // stay axe-clean.
    await expectNoAxeViolations(root);
  });

  it('renders pure markup styled surfaces and updates submit state through generated handlers', async () => {
    const root = await mountInteractiveDemo(GalleryPureMarkupDemo);
    const heading = required(root.querySelector<HTMLHeadingElement>('h3'));
    const card = required(heading.closest('section'));
    const badge = required(card.querySelector<HTMLElement>('span'));
    const breadcrumb = required(root.querySelector<HTMLElement>('nav[aria-label="Release trail"]'));
    const current = required(breadcrumb.querySelector<HTMLAnchorElement>('[aria-current="page"]'));
    const form = required(root.querySelector<HTMLFormElement>('#gallery-pure-markup-form'));
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const table = required(root.querySelector<HTMLTableElement>('table'));
    const skeleton = required(root.querySelector<HTMLElement>('div[aria-hidden="true"]'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="pure-markup-submit"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root);

    expect(root.getAttribute('kovo-state')).toBe('{"submitted":false}');
    expect(root.dataset.galleryInteractive).toBe('pure-markup');
    expect(card.getAttribute('data-style-src')).toContain('card.tsx#root');
    expect(badge.getAttribute('data-style-src')).toContain('badge.tsx#root');
    expect(current.textContent).toBe('Table');
    expect(button.form).toBe(form);
    expect(button.type).toBe('button');
    expect(table.tHead?.rows.item(0)?.cells).toHaveLength(2);
    expect(table.tBodies.item(0)?.rows).toHaveLength(2);
    expect(skeleton.getAttribute('style') ?? '').toContain('background:var(--edge,#e5e5e5)');
    expect(output.textContent).toBe('pending');

    await expectNoAxeViolations(root);

    button.click();

    await vi.waitFor(() => {
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="pure-markup-submit"]'),
      );

      expect(imports).toEqual(['/c/src/interactive/pure-markup-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toBe('{"submitted":true}');
      expect(currentOutput.textContent).toBe('confirmed');
    });
  });

  it('updates meter native value and qualitative state through a generated handler', async () => {
    const root = await mountInteractiveDemo(GalleryMeterDemo);
    const meter = required(root.querySelector<HTMLMeterElement>('meter'));
    const button = required(root.querySelector<HTMLButtonElement>('button'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="meter-value"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root);

    // Meter thresholds were retuned (optimum 70, high 85) so the default 72% reads
    // as `optimum` (green) instead of the old alarming brown; the compiler now
    // derives that qualitative data-state from value/threshold props.
    expect(root.getAttribute('kovo-state')).toBe('{"value":72}');
    expect(meter.min).toBe(0);
    expect(meter.max).toBe(100);
    expect(meter.low).toBe(40);
    expect(meter.high).toBe(85);
    expect(meter.optimum).toBe(70);
    expect(meter.value).toBe(72);
    expect(meter.getAttribute('data-state')).toBe('optimum');
    expect(meter.getAttribute('aria-valuetext')).toBe('72 percent capacity');
    expect(output.textContent).toBe('72');

    button.click();

    await vi.waitFor(() => {
      const currentMeter = required(root.querySelector<HTMLMeterElement>('meter'));
      const currentOutput = required(
        root.querySelector<HTMLOutputElement>('[data-demo-state="meter-value"]'),
      );

      expect(imports).toEqual(['/c/src/interactive/meter-demo.client.js']);
      expect(root.getAttribute('kovo-state')).toBe('{"value":30}');
      expect(currentMeter.value).toBe(30);
      expect(currentMeter.getAttribute('data-state')).toBe('suboptimum');
      expect(currentMeter.getAttribute('aria-valuetext')).toBe('30 percent capacity');
      expect(currentOutput.textContent).toBe('30');
    });

    // SPEC §12.1: the meter end-state (value in a defined band, data-state set with an
    // aria-valuetext) must stay axe-clean.
    await expectNoAxeViolations(root);
  });

  it('updates tabs stamped state from generated click and manual keyboard handlers', async () => {
    const root = await mountInteractiveDemo(GalleryTabsDemo);
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
    const { imports } = installInteractiveGalleryLoader(root, { events: ['click', 'keydown'] });

    expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"overview","value":"overview"}');
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

    overview.focus();
    await userEvent.keyboard('{ArrowRight}');

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

      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"details","value":"overview"}');
      expect(currentOverview.getAttribute('aria-selected')).toBe('true');
      expect(currentOverview.tabIndex).toBe(-1);
      expect(currentOverviewPanel.hidden).toBe(false);
      expect(currentDetails.getAttribute('aria-selected')).toBe('false');
      expect(currentDetails.tabIndex).toBe(0);
      expect(currentDetailsPanel.hidden).toBe(true);
      expect(document.activeElement).toBe(currentDetails);
    });

    await userEvent.keyboard('{Enter}');

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

      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"details","value":"details"}');
      expect(currentOverview.getAttribute('aria-selected')).toBe('false');
      expect(currentOverviewPanel.hidden).toBe(true);
      expect(currentDetails.getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(currentDetails);
      expect(currentDetailsPanel.hidden).toBe(false);
    });

    details.click();

    await vi.waitFor(() => {
      expect(imports).toEqual(['/c/src/interactive/tabs-demo.client.js']);
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

      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"details","value":"details"}');
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
    const root = await mountInteractiveDemo(GalleryToolbarDemo);
    const toolbar = required(root.querySelector<HTMLElement>('[role="toolbar"]'));
    const bold = required(root.querySelector<HTMLButtonElement>('#gallery-toolbar-bold'));
    const italic = required(root.querySelector<HTMLButtonElement>('#gallery-toolbar-italic'));
    const link = required(root.querySelector<HTMLButtonElement>('#gallery-toolbar-link'));
    const activeOutput = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="toolbar-active"]'),
    );
    const pressedOutput = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="toolbar-pressed"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root, {
      events: ['click', 'keydown'],
    });

    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Formatting toolbar');
    expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"bold","pressedValue":"bold"}');
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

    toolbar.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe('/c/src/interactive/toolbar-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"link","pressedValue":"bold"}');
      expect(bold.tabIndex).toBe(-1);
      expect(link.tabIndex).toBe(0);
      expect(document.activeElement).toBe(link);
      expect(activeOutput.textContent).toBe('link');
    });

    link.click();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"link","pressedValue":"link"}');
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
    const root = await mountInteractiveDemo(GalleryToggleGroupDemo);
    const group = required(root.querySelector<HTMLElement>('[role="group"]'));
    const bold = required(root.querySelector<HTMLButtonElement>('#gallery-toggle-group-bold'));
    const strike = required(root.querySelector<HTMLButtonElement>('#gallery-toggle-group-strike'));
    const italic = required(root.querySelector<HTMLButtonElement>('#gallery-toggle-group-italic'));
    installInteractiveGalleryLoader(root, { events: ['click', 'input', 'change', 'keydown'] });

    expect(group.getAttribute('role')).toBe('group');
    expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"bold","value":"bold"}');
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

    group.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

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

      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"italic","value":"bold"}');
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

      // Single-select: selecting italic replaces bold (siblings deselect).
      expect(root.getAttribute('kovo-state')).toBe('{"activeValue":"italic","value":"italic"}');
      expect(currentBold.getAttribute('aria-pressed')).toBe('false');
      expect(currentBold.getAttribute('data-state')).toBe('off');
      expect(currentItalic.getAttribute('aria-pressed')).toBe('true');
      expect(currentItalic.getAttribute('data-state')).toBe('pressed');
      expect(currentOutput.textContent).toBe('italic');
    });

    // SPEC §12.1: the toggle-group single-pressed/roving state after keyboard move and
    // press must stay axe-clean, including the disabled item.
    await expectNoAxeViolations(root);
  });

  it('opens and selects from generated dropdown and context menu handlers', async () => {
    const dropdownRoot = await mountInteractiveDemo(GalleryDropdownMenuDemo);
    const dropdownTrigger = required(
      dropdownRoot.querySelector<HTMLButtonElement>('#gallery-dropdown-menu-trigger'),
    );
    const dropdownContent = required(
      dropdownRoot.querySelector<HTMLElement>('#gallery-dropdown-menu-content'),
    );
    const duplicate = required(
      dropdownRoot.querySelector<HTMLButtonElement>('#gallery-dropdown-menu-duplicate'),
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
    const dropdownLoader = installInteractiveGalleryLoader(dropdownRoot, {
      events: ['click', 'keydown'],
    });

    expect(dropdownRoot.getAttribute('kovo-state')).toBe(
      '{"highlightedValue":"duplicate","open":false,"value":"duplicate"}',
    );
    expect(dropdownTrigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(dropdownTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(dropdownContent.getAttribute('role')).toBe('menu');
    expect(dropdownContent.hidden).toBe(true);
    expect(archive.getAttribute('aria-disabled')).toBe('true');

    dropdownTrigger.click();

    await vi.waitFor(() => {
      expect(dropdownLoader.imports.at(-1)).toBe('/c/src/interactive/dropdown-menu-demo.client.js');
      expect(dropdownRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"duplicate","open":true,"value":"duplicate"}',
      );
      expect(dropdownTrigger.getAttribute('aria-expanded')).toBe('true');
      expect(dropdownContent.hidden).toBe(false);
      expect(duplicate.getAttribute('data-highlighted')).toBe('');
      expect(document.activeElement).toBe(duplicate);
    });

    // SPEC §12.1: the dropdown-menu open state (expanded trigger, visible role="menu"
    // with a disabled item) must stay axe-clean.
    await expectNoAxeViolations(dropdownRoot);

    duplicate.focus();
    await userEvent.keyboard('{ArrowDown}');

    await vi.waitFor(() => {
      expect(dropdownRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"rename","open":true,"value":"duplicate"}',
      );
      expect(duplicate.getAttribute('data-highlighted')).toBeNull();
      expect(rename.getAttribute('data-highlighted')).toBe('');
      expect(archive.getAttribute('data-highlighted')).toBeNull();
      expect(document.activeElement).toBe(rename);
    });

    await userEvent.keyboard('d');

    await vi.waitFor(() => {
      expect(dropdownRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"duplicate","open":true,"value":"duplicate"}',
      );
      expect(duplicate.getAttribute('data-highlighted')).toBe('');
      expect(rename.getAttribute('data-highlighted')).toBeNull();
      expect(document.activeElement).toBe(duplicate);
    });

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(dropdownRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"duplicate","open":false,"value":"duplicate"}',
      );
      expect(dropdownTrigger.getAttribute('aria-expanded')).toBe('false');
      expect(dropdownContent.hidden).toBe(true);
      expect(document.activeElement).toBe(dropdownTrigger);
    });

    dropdownTrigger.focus();
    await userEvent.keyboard('{ArrowUp}');

    await vi.waitFor(() => {
      expect(dropdownRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"rename","open":true,"value":"duplicate"}',
      );
      expect(dropdownTrigger.getAttribute('aria-expanded')).toBe('true');
      expect(dropdownContent.hidden).toBe(false);
      expect(document.activeElement).toBe(rename);
    });

    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(dropdownRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"rename","open":false,"value":"rename"}',
      );
      expect(dropdownContent.hidden).toBe(true);
      expect(rename.getAttribute('data-highlighted')).toBe('');
      expect(dropdownValue.textContent).toBe('rename');
    });

    const contextRoot = await mountInteractiveDemo(GalleryContextMenuDemo);
    const trigger = required(
      contextRoot.querySelector<HTMLElement>('#gallery-context-menu-trigger'),
    );
    const content = required(
      contextRoot.querySelector<HTMLElement>('#gallery-context-menu-content'),
    );
    const copy = required(
      contextRoot.querySelector<HTMLButtonElement>('#gallery-context-menu-copy'),
    );
    const deleteItem = required(
      contextRoot.querySelector<HTMLButtonElement>('#gallery-context-menu-delete'),
    );
    const inspect = required(
      contextRoot.querySelector<HTMLButtonElement>('#gallery-context-menu-inspect'),
    );
    const contextValue = required(
      contextRoot.querySelector<HTMLOutputElement>('[data-demo-state="context-value"]'),
    );
    const contextLoader = installInteractiveGalleryLoader(contextRoot, {
      events: ['click', 'contextmenu', 'keydown'],
    });

    expect(trigger.getAttribute('kovo-context-menu')).toBe('gallery-context-menu-content');
    expect(content.hidden).toBe(true);
    expect(content.getAttribute('data-anchor-x')).toBe('24');
    expect(content.getAttribute('data-anchor-y')).toBe('40');
    expect(deleteItem.getAttribute('aria-disabled')).toBe('true');

    trigger.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 72,
        clientY: 96,
      }),
    );

    await vi.waitFor(() => {
      expect(contextLoader.imports.at(-1)).toBe('/c/src/interactive/context-menu-demo.client.js');
      expect(contextRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"copy","open":true,"point":{"x":72,"y":96},"value":"copy"}',
      );
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(content.getAttribute('data-anchor-x')).toBe('72');
      expect(content.getAttribute('data-anchor-y')).toBe('96');
      expect(content.hidden).toBe(false);
      expect(copy.getAttribute('data-highlighted')).toBe('');
      expect(document.activeElement).toBe(copy);
    });

    // SPEC §12.1: the context-menu open state (anchored, visible role="menu" with a
    // disabled item) must stay axe-clean.
    await expectNoAxeViolations(contextRoot);

    await userEvent.keyboard('{ArrowDown}');

    await vi.waitFor(() => {
      expect(contextRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"inspect","open":true,"point":{"x":72,"y":96},"value":"copy"}',
      );
      expect(copy.getAttribute('data-highlighted')).toBeNull();
      expect(inspect.getAttribute('data-highlighted')).toBe('');
      expect(deleteItem.getAttribute('data-highlighted')).toBeNull();
      expect(document.activeElement).toBe(inspect);
    });

    await userEvent.keyboard('c');

    await vi.waitFor(() => {
      expect(contextRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"copy","open":true,"point":{"x":72,"y":96},"value":"copy"}',
      );
      expect(copy.getAttribute('data-highlighted')).toBe('');
      expect(inspect.getAttribute('data-highlighted')).toBeNull();
      expect(document.activeElement).toBe(copy);
    });

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(contextRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"copy","open":false,"point":{"x":72,"y":96},"value":"copy"}',
      );
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(content.hidden).toBe(true);
      expect(document.activeElement).toBe(trigger);
    });

    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'F10',
        shiftKey: true,
      }),
    );

    await vi.waitFor(() => {
      expect(contextRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"copy","open":true,"point":{"x":72,"y":96},"value":"copy"}',
      );
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(content.hidden).toBe(false);
      expect(document.activeElement).toBe(copy);
    });

    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Space}');

    await vi.waitFor(() => {
      expect(contextRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"inspect","open":false,"point":{"x":72,"y":96},"value":"inspect"}',
      );
      expect(content.hidden).toBe(true);
      expect(contextValue.textContent).toBe('inspect');
    });
  });

  it('updates generated menubar and navigation-menu roving/open state', async () => {
    const menubarDemo = await mountInteractiveDemo(GalleryMenubarDemo);
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
    const menubarLoader = installInteractiveGalleryLoader(menubarDemo, {
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
      expect(menubarLoader.imports.at(-1)).toBe('/c/src/interactive/menubar-demo.client.js');
      expect(menubarDemo.getAttribute('kovo-state')).toBe(
        '{"activeValue":"edit","openValue":"","value":"new"}',
      );
      expect(file.tabIndex).toBe(-1);
      expect(edit.tabIndex).toBe(0);
    });

    file.click();

    await vi.waitFor(() => {
      expect(menubarDemo.getAttribute('kovo-state')).toBe(
        '{"activeValue":"new","openValue":"file","value":"new"}',
      );
      expect(file.getAttribute('aria-expanded')).toBe('true');
      expect(fileMenu.hidden).toBe(false);
      expect(openOutput.textContent).toBe('file');
      expect(newFile.getAttribute('data-highlighted')).toBe('');
      expect(document.activeElement).toBe(newFile);
    });

    // SPEC §12.1: the menubar open state (expanded top-level item, visible nested
    // role="menu" with a disabled item) must stay axe-clean.
    await expectNoAxeViolations(menubarDemo);

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(menubarDemo.getAttribute('kovo-state')).toBe(
        '{"activeValue":"file","openValue":"","value":"new"}',
      );
      expect(file.getAttribute('aria-expanded')).toBe('false');
      expect(fileMenu.hidden).toBe(true);
      expect(openOutput.textContent).toBe('none');
      expect(document.activeElement).toBe(file);
    });

    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(menubarDemo.getAttribute('kovo-state')).toBe(
        '{"activeValue":"new","openValue":"file","value":"new"}',
      );
      expect(file.getAttribute('aria-expanded')).toBe('true');
      expect(fileMenu.hidden).toBe(false);
      expect(document.activeElement).toBe(newFile);
    });

    await userEvent.keyboard('{Space}');

    await vi.waitFor(() => {
      expect(menubarDemo.getAttribute('kovo-state')).toBe(
        '{"activeValue":"file","openValue":"","value":"new"}',
      );
      expect(file.getAttribute('aria-expanded')).toBe('false');
      expect(fileMenu.hidden).toBe(true);
      expect(openOutput.textContent).toBe('none');
      expect(valueOutput.textContent).toBe('new');
    });

    const navRoot = await mountInteractiveDemo(GalleryNavigationMenuDemo);
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
    installInteractiveGalleryLoader(navRoot, {
      events: ['click', 'focus', 'keydown', 'pointerenter'],
    });

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
      expect(navRoot.getAttribute('kovo-state')).toBe(
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
      expect(navRoot.getAttribute('kovo-state')).toBe(
        '{"activeValue":"products","openValue":"","value":"none"}',
      );
      expect(products.getAttribute('aria-expanded')).toBe('false');
      expect(productsContent.hidden).toBe(true);
      expect(viewport.hidden).toBe(true);
      expect(navValue.textContent).toBe('none');
      expect(document.activeElement).toBe(products);
    });

    navRoot.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    await vi.waitFor(() => {
      expect(navRoot.getAttribute('kovo-state')).toBe(
        '{"activeValue":"docs","openValue":"","value":"none"}',
      );
      expect(products.tabIndex).toBe(-1);
      expect(docs.tabIndex).toBe(0);
      expect(document.activeElement).toBe(docs);
    });

    docs.removeAttribute('href');
    docs.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(navRoot.getAttribute('kovo-state')).toBe(
        '{"activeValue":"docs","openValue":"","value":"docs"}',
      );
      expect(navValue.textContent).toBe('docs');
    });

    products.dispatchEvent(new Event('pointerenter', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(navRoot.getAttribute('kovo-state')).toBe(
        '{"activeValue":"products","openValue":"products","value":"docs"}',
      );
      expect(products.getAttribute('aria-expanded')).toBe('true');
      expect(productsContent.hidden).toBe(false);
      expect(viewport.hidden).toBe(false);
    });
  });

  it('updates command dialog and toast visible state through generated handlers', async () => {
    const commandRoot = await mountInteractiveDemo(GalleryCommandDemo);
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
    const { imports } = installInteractiveGalleryLoader(commandRoot, {
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

    // An outside sentinel proves the rest of the page stays interactive after the
    // command palette closes (regression: a show-modal dialog closed only by
    // removing its `open` attribute stays in the top layer and inertizes the page).
    const outside = document.createElement('button');
    let outsideClicks = 0;
    outside.addEventListener('click', () => (outsideClicks += 1));
    document.body.append(outside);

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe('/c/src/interactive/command-demo.client.js');
      expect(commandRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"dashboard","inputValue":"","lastKeyAction":"idle","open":true,"value":"dashboard"}',
      );
      expect(dialog.open).toBe(true);
      // The native show-modal invoker puts the dialog in the top layer, so the
      // open state must be a real modal, not just an `open` attribute.
      expect(dialog.matches(':modal')).toBe(true);
    });

    input.value = 'invite';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(commandRoot.getAttribute('kovo-state')).toBe(
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

    const selectedEnter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    input.dispatchEvent(selectedEnter);

    await vi.waitFor(() => {
      expect(commandRoot.getAttribute('kovo-state')).toBe(
        '{"highlightedValue":"invite","inputValue":"invite","lastKeyAction":"selected","open":false,"value":"invite"}',
      );
      expect(selectedEnter.defaultPrevented).toBe(true);
      expect(dialog.open).toBe(false);
      // Selecting an item closes via Kovo state alone; the reactive open write
      // must call dialog.close() so the dialog leaves the top layer instead of
      // lingering as an invisible inert backdrop over the page.
      expect(dialog.matches(':modal')).toBe(false);
      expect(commandKeyCanceled.textContent).toBe('selected');
      expect(commandValue.textContent).toBe('Invite teammate');
    });

    // With the dialog out of the top layer, the rest of the page is interactive
    // again: a click on the outside sentinel reaches its handler.
    outside.click();
    expect(outsideClicks).toBe(1);
    outside.remove();

    const toastRoot = await mountInteractiveDemo(GalleryToastDemo);
    const showToast = required(toastRoot.querySelector<HTMLButtonElement>('[data-toast-show]'));
    const toast = required(toastRoot.querySelector<HTMLElement>('#gallery-toast'));
    const previousToast = required(toastRoot.querySelector<HTMLElement>('#gallery-toast-previous'));
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
    const toastCount = required(
      toastRoot.querySelector<HTMLOutputElement>('[data-demo-state="toast-count"]'),
    );
    installInteractiveGalleryLoader(toastRoot, { events: ['click', 'keydown', 'animationend'] });

    // The Show-toast trigger now sits in the demo flow (not inside the fixed
    // viewport), so the demo root is a wrapper; the role=region viewport is a child.
    const viewport = required(toastRoot.querySelector<HTMLElement>('#gallery-toast-viewport'));
    expect(viewport.getAttribute('role')).toBe('region');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toastRoot.getAttribute('kovo-state')).toBe(
      '{"activeCount":0,"activeOpen":false,"previousCount":0,"previousOpen":false}',
    );
    expect(toast.getAttribute('data-state')).toBe('closed');
    expect(toast.hidden).toBe(true);
    expect(previousToast.hidden).toBe(true);
    expect(disabledAction.disabled).toBe(true);
    expect(toastOutput.textContent).toBe('empty');
    expect(toastCount.textContent).toBe('0');

    showToast.click();

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('kovo-state')).toBe(
        '{"activeCount":1,"activeOpen":true,"previousCount":0,"previousOpen":false}',
      );
      expect(toast.hidden).toBe(false);
      expect(toast.getAttribute('data-state')).toBe('open');
      expect(toastOutput.textContent).toBe('open');
      expect(toastCount.textContent).toBe('1');
    });

    showToast.click();

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('kovo-state')).toBe(
        '{"activeCount":2,"activeOpen":true,"previousCount":1,"previousOpen":true}',
      );
      expect(previousToast.hidden).toBe(false);
      expect(previousToast.getAttribute('data-state')).toBe('open');
      expect(toastOutput.textContent).toBe('open');
      expect(toastCount.textContent).toBe('2');
    });

    disabledAction.click();

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('kovo-state')).toBe(
        '{"activeCount":2,"activeOpen":true,"previousCount":1,"previousOpen":true}',
      );
      expect(toast.hidden).toBe(false);
      expect(toast.getAttribute('data-state')).toBe('open');
      expect(toastOutput.textContent).toBe('open');
    });

    cancelDismiss.click();

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('kovo-state')).toBe(
        '{"activeCount":2,"activeOpen":true,"previousCount":1,"previousOpen":true}',
      );
      expect(toast.hidden).toBe(false);
      expect(toast.getAttribute('data-state')).toBe('open');
      expect(toastOutput.textContent).toBe('open');
    });

    // SPEC §12.1: the toast open state after a canceled dismiss (live region with a
    // disabled action that did not auto-dismiss) must stay axe-clean.
    await expectNoAxeViolations(toastRoot);

    toast.dispatchEvent(
      new AnimationEvent('animationend', {
        animationName: 'gallery-toast-auto-dismiss',
        bubbles: true,
        cancelable: true,
      }),
    );

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('kovo-state')).toBe(
        '{"activeCount":2,"activeOpen":false,"previousCount":1,"previousOpen":true}',
      );
      expect(toast.hidden).toBe(true);
      expect(toast.getAttribute('data-state')).toBe('closed');
      expect(toastOutput.textContent).toBe('stacked');
    });

    dismiss.click();

    await vi.waitFor(() => {
      expect(toastRoot.getAttribute('kovo-state')).toBe(
        '{"activeCount":2,"activeOpen":false,"previousCount":1,"previousOpen":false}',
      );
      expect(previousToast.hidden).toBe(true);
      expect(toastOutput.textContent).toBe('empty');
    });
  });

  it('shows and hides a generated tooltip through browser-visible ARIA and hidden state', async () => {
    const root = await mountInteractiveDemo(GalleryTooltipDemo);
    const button = required(root.querySelector<HTMLButtonElement>('[kovo-tooltip]'));
    const content = required(root.querySelector<HTMLElement>('#gallery-tooltip-content'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="tooltip-open"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root, {
      events: ['blur', 'focus', 'keydown', 'pointerenter', 'pointerleave'],
    });

    expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
    expect(button.getAttribute('kovo-tooltip')).toBe('gallery-tooltip-content');
    expect(button.getAttribute('aria-describedby')).toBeNull();
    expect(content.getAttribute('role')).toBe('tooltip');
    expect(content.hasAttribute('popover')).toBe(false);
    expect(content.hidden).toBe(true);
    expect(output.textContent).toBe('closed');

    button.dispatchEvent(new Event('pointerenter', { bubbles: true }));

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe('/c/src/interactive/tooltip-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(button.getAttribute('aria-describedby')).toBe('gallery-tooltip-content');
      expect(content.hidden).toBe(false);
      expect(content.getAttribute('data-state')).toBe('open');
      expect(output.textContent).toBe('open');
    });

    // SPEC §12.1: the tooltip open state (trigger aria-describedby pointing at the visible
    // role=tooltip content) must stay axe-clean.
    await expectNoAxeViolations(root);

    button.dispatchEvent(new Event('pointerleave', { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(button.getAttribute('aria-describedby')).toBeNull();
      expect(content.hidden).toBe(true);
      expect(output.textContent).toBe('closed');
    });

    button.focus();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(content.hidden).toBe(false);
    });

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(button.getAttribute('aria-describedby')).toBeNull();
      expect(content.hidden).toBe(true);
    });
  });

  it('shows and hides a generated hover-card through browser-visible hidden state', async () => {
    const root = await mountInteractiveDemo(GalleryHoverCardDemo);
    const trigger = required(root.querySelector<HTMLAnchorElement>('[kovo-hover-card]'));
    const content = required(root.querySelector<HTMLElement>('#gallery-hover-card-content'));
    const output = required(
      root.querySelector<HTMLOutputElement>('[data-demo-state="hover-card-open"]'),
    );
    const { imports } = installInteractiveGalleryLoader(root, {
      events: ['blur', 'focus', 'keydown', 'pointerenter', 'pointerleave'],
    });

    expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
    expect(trigger.getAttribute('kovo-hover-card')).toBe('gallery-hover-card-content');
    expect(trigger.getAttribute('aria-controls')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBeNull();
    // No longer a manual popover (it stayed display:none without an imperative
    // showPopover()); visibility is governed by hidden + [data-state] instead.
    expect(content.getAttribute('popover')).toBeNull();
    expect(content.hidden).toBe(true);
    expect(content.matches(':popover-open')).toBe(false);
    expect(output.textContent).toBe('closed');

    trigger.dispatchEvent(new Event('pointerenter', { bubbles: true }));

    await vi.waitFor(() => {
      expect(imports.at(-1)).toBe('/c/src/interactive/hover-card-demo.client.js');
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(trigger.getAttribute('aria-expanded')).toBeNull();
      expect(content.hidden).toBe(false);
      expect(content.getAttribute('data-state')).toBe('open');
      expect(content.matches(':popover-open')).toBe(false);
      expect(output.textContent).toBe('open');
    });

    trigger.dispatchEvent(new Event('pointerleave', { bubbles: true }));
    content.dispatchEvent(new Event('pointerenter', { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(trigger.getAttribute('aria-expanded')).toBeNull();
      expect(content.hidden).toBe(false);
      expect(content.getAttribute('data-state')).toBe('open');
      expect(output.textContent).toBe('open');
    });

    content.dispatchEvent(new Event('pointerleave', { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(trigger.getAttribute('aria-expanded')).toBeNull();
      expect(content.hidden).toBe(true);
      expect(content.matches(':popover-open')).toBe(false);
      expect(output.textContent).toBe('closed');
    });

    trigger.focus();

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":true}');
      expect(content.hidden).toBe(false);
      expect(content.matches(':popover-open')).toBe(false);
    });

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(root.getAttribute('kovo-state')).toBe('{"open":false}');
      expect(trigger.getAttribute('aria-expanded')).toBeNull();
      expect(content.hidden).toBe(true);
      expect(content.matches(':popover-open')).toBe(false);
    });
  });
});
