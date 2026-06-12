/** @jsxImportSource @jiso/server */
import { describe, expect, it } from 'vitest';

import {
  accordionContentAttributes,
  accordionTriggerAttributes,
  avatarFallbackAttributes,
  avatarRootAttributes,
  checkboxRootAttributes,
  dialogContentAttributes,
  dialogTriggerAttributes,
  fieldControlAttributes,
  fieldLabelAttributes,
  fieldRootAttributes,
  numberFieldIncrementAttributes,
  numberFieldInputAttributes,
  meterRootAttributes,
  otpFieldHiddenInputAttributes,
  otpFieldInputAttributes,
  otpFieldRootAttributes,
  progressRootAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaViewportAttributes,
  separatorRootAttributes,
  selectItemAttributes,
  selectTriggerAttributes,
  switchRootAttributes,
  tabsPanelAttributes,
  tabsTriggerAttributes,
  tooltipTriggerAttributes,
  toggleRootAttributes,
} from '@jiso/headless-ui/primitives';

type AttributeValue = boolean | number | string | undefined;
type AttributeRecord = Readonly<Record<string, AttributeValue>>;

interface MergeDiagnostic {
  attr: string;
  code: 'FW231' | 'FW232' | 'FW233';
  message: string;
}

interface MergeFixtureResult {
  attrs: Record<string, AttributeValue>;
  diagnostics: readonly MergeDiagnostic[];
}

const idrefAttributes = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-owns',
  'commandfor',
  'for',
  'jiso-tooltip',
  'popovertarget',
]);

const logicalOrAttributes = new Set(['aria-disabled', 'disabled', 'readonly', 'required']);

describe('gallery G5 primitive merge fixtures', () => {
  it('renders a golden accordion merge with primitive-owned state and authored ARIA overrides', () => {
    const state = {
      orientation: 'vertical' as const,
      type: 'multiple' as const,
      value: ['shipping'],
    };
    const trigger = mergePrimitiveAttrs(
      {
        ...accordionTriggerAttributes({
          ...state,
          contentId: 'gallery-accordion-shipping-panel',
          itemValue: 'shipping',
          triggerId: 'gallery-accordion-shipping-trigger',
        }),
        class: 'accordion-trigger',
      },
      {
        'aria-expanded': 'false',
        class: 'accordion-trigger font-medium',
        'data-state': 'author-open',
        disabled: true,
        id: 'author-accordion-trigger',
      },
    );
    const content = mergePrimitiveAttrs(
      {
        ...accordionContentAttributes({
          ...state,
          contentId: 'gallery-accordion-shipping-panel',
          itemValue: 'shipping',
          triggerId: 'gallery-accordion-shipping-trigger',
        }),
        class: 'accordion-panel',
      },
      {
        class: 'accordion-panel px-3',
        id: 'author-accordion-panel',
        role: 'group',
      },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="accordion">
        <button {...trigger.attrs}>Shipping</button>
        <div {...content.attrs}>Ships soon.</div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="accordion"><button data-state="open" aria-expanded="false" disabled type="button" aria-controls="gallery-accordion-shipping-panel" id="author-accordion-trigger" class="accordion-trigger font-medium">Shipping</button><div data-state="open" id="author-accordion-panel" aria-labelledby="gallery-accordion-shipping-trigger" role="group" class="accordion-panel px-3">Ships soon.</div></section>',
    );
  });

  it('renders a golden avatar merge with fallback scalar and semantic root overrides', () => {
    const root = mergePrimitiveAttrs(
      {
        ...avatarRootAttributes({
          label: 'Ada Lovelace avatar',
          src: '/avatars/ada.png',
          status: 'loading',
        }),
        class: 'avatar-root',
      },
      {
        'aria-label': 'Author label',
        class: 'avatar-root rounded-full',
        'data-state': 'author-loading',
        role: 'figure',
      },
    );
    const fallback = mergePrimitiveAttrs(
      {
        ...avatarFallbackAttributes({
          delayMs: 250,
          src: '/avatars/ada.png',
          status: 'loaded',
        }),
        class: 'avatar-fallback',
      },
      {
        class: 'avatar-fallback text-xs',
        'data-state': 'author-loaded',
        hidden: false,
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-label',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(fallback.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <div data-gallery-merge="avatar">
        <span {...root.attrs}>
          <span {...fallback.attrs}>AL</span>
        </span>
      </div>,
    ).toBe(
      '<div data-gallery-merge="avatar"><span data-state="loading" aria-label="Author label" role="figure" class="avatar-root rounded-full"><span data-state="loaded" data-delay="250" class="avatar-fallback text-xs">AL</span></span></div>',
    );
  });

  it('renders a golden toggle merge with authored class, handlers, scalars, and state overrides', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...toggleRootAttributes({ pressed: true }),
        class: 'inline-flex saved',
        'fw-deps': 'toggle:pressed',
        'on:click': '/gallery/toggle.client.js#primitiveToggle',
        style: '--toggle-state: pressed; color: blue',
      },
      {
        'aria-pressed': 'mixed',
        class: 'saved rounded-sm',
        'data-state': 'author-pressed',
        disabled: true,
        'fw-deps': 'route:gallery',
        'on:click': '/gallery/author.client.js#trackToggle',
        style: 'color: red; margin: 0',
        type: 'submit',
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-pressed',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<button {...merged.attrs}>Saved</button>).toBe(
      '<button data-state="pressed" aria-pressed="mixed" disabled type="submit" class="inline-flex saved rounded-sm" fw-deps="toggle:pressed route:gallery" on:click="/gallery/author.client.js#trackToggle /gallery/toggle.client.js#primitiveToggle" style="--toggle-state: pressed; color: blue; color: red; margin: 0">Saved</button>',
    );
  });

  it('renders a golden checkbox merge with native control logical-OR attributes', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...checkboxRootAttributes({
          checked: 'indeterminate',
          name: 'gallery-consent',
          required: true,
          value: 'yes',
        }),
        class: 'checkbox-control',
      },
      {
        'aria-checked': 'false',
        class: 'rounded border',
        'data-state': 'author-indeterminate',
        disabled: true,
        name: 'author-consent',
        required: false,
        value: 'author-yes',
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-checked',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<input {...merged.attrs} />).toBe(
      '<input data-state="indeterminate" aria-checked="false" disabled name="author-consent" required type="checkbox" value="author-yes" class="checkbox-control rounded border">',
    );
  });

  it('renders a golden field merge with native label and control wiring', () => {
    const root = mergePrimitiveAttrs(
      {
        ...fieldRootAttributes({ id: 'gallery-field', invalid: true, required: true }),
        class: 'field-root',
      },
      {
        class: 'field-root grid gap-1',
        'data-invalid': 'author-invalid',
        id: 'author-field',
      },
    );
    const control = mergePrimitiveAttrs(
      {
        ...fieldControlAttributes({
          descriptionId: 'gallery-field-description',
          errorId: 'gallery-field-error',
          id: 'gallery-field-email',
          invalid: true,
          name: 'email',
          required: true,
        }),
        class: 'field-control',
      },
      {
        'aria-describedby': 'author-field-description',
        'aria-invalid': 'false',
        class: 'field-control border',
        name: 'author-email',
        required: false,
      },
    );
    const label = mergePrimitiveAttrs(
      rewriteIdrefs(
        fieldLabelAttributes({ controlId: 'gallery-field-email' }),
        new Map([['gallery-field-email', 'author-field-email']]),
      ),
      {
        class: 'field-label',
        for: 'author-field-email',
      },
    );

    expect(root.diagnostics).toEqual([]);
    expect(control.diagnostics).toEqual([
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
      {
        attr: 'aria-invalid',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(label.diagnostics).toEqual([]);
    expect(
      <div data-gallery-merge="field">
        <div {...root.attrs}>
          <label {...label.attrs}>Email</label>
          <input {...control.attrs} />
        </div>
      </div>,
    ).toBe(
      '<div data-gallery-merge="field"><div data-invalid="author-invalid" data-required="" id="author-field" class="field-root grid gap-1"><label for="author-field-email" class="field-label">Email</label><input data-invalid="" data-required="" aria-describedby="author-field-description" aria-invalid="false" id="gallery-field-email" name="author-email" required class="field-control border"></div></div>',
    );
  });

  it('renders a golden meter merge with threshold scalars and author value text', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...meterRootAttributes({
          high: 90,
          low: 50,
          max: 100,
          min: 0,
          optimum: 80,
          value: 42,
          valueText: '42 percent quality score',
        }),
        class: 'meter-root',
      },
      {
        'aria-valuetext': 'Author meter label',
        class: 'meter-root h-2',
        'data-state': 'author-suboptimum',
        high: 95,
        low: 40,
        optimum: 75,
        value: 64,
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-valuetext',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<meter {...merged.attrs}>64%</meter>).toBe(
      '<meter data-high="90" data-low="50" data-max="100" data-min="0" data-optimum="80" data-state="suboptimum" data-value="42" high="95" low="40" max="100" min="0" optimum="75" value="64" aria-valuetext="Author meter label" class="meter-root h-2">64%</meter>',
    );
  });

  it('renders a golden progress merge with scalar author values and primitive-owned state', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...progressRootAttributes({
          max: 100,
          value: 42,
          valueText: '42 of 100 tasks complete',
        }),
        class: 'progress-root',
      },
      {
        'aria-valuetext': 'Author progress label',
        class: 'progress-root h-2',
        'data-state': 'author-loading',
        max: 80,
        value: 50,
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-valuetext',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<progress {...merged.attrs}>50%</progress>).toBe(
      '<progress data-max="100" data-state="loading" max="80" data-value="42" value="50" aria-valuetext="Author progress label" class="progress-root h-2">50%</progress>',
    );
  });

  it('renders a golden otp-field merge with aggregate input and slot overrides', () => {
    const root = mergePrimitiveAttrs(
      {
        ...otpFieldRootAttributes({
          descriptionId: 'gallery-otp-description',
          errorId: 'gallery-otp-error',
          id: 'gallery-otp-field',
          invalid: true,
          labelledBy: 'gallery-otp-label',
          required: true,
          value: '1234',
        }),
        class: 'otp-root',
      },
      {
        'aria-describedby': 'author-otp-description',
        class: 'otp-root gap-2',
        role: 'application',
      },
    );
    const hiddenInput = mergePrimitiveAttrs(
      {
        ...otpFieldHiddenInputAttributes({
          length: 6,
          name: 'gallery-otp-code',
          pattern: '[0-9]*',
          required: true,
          value: '1234',
        }),
        class: 'otp-hidden',
      },
      {
        'aria-hidden': 'false',
        class: 'otp-hidden sr-only',
        disabled: true,
        name: 'author-otp-code',
        required: false,
      },
    );
    const slot = mergePrimitiveAttrs(
      {
        ...otpFieldInputAttributes({
          inputMode: 'numeric',
          label: 'One-time code digit 1',
          length: 6,
          required: true,
          slotIndex: 0,
          value: '1234',
        }),
        class: 'otp-slot',
      },
      {
        'aria-label': 'Author digit label',
        class: 'otp-slot text-center',
        maxLength: 2,
        value: '9',
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(hiddenInput.diagnostics).toEqual([
      {
        attr: 'aria-hidden',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(slot.diagnostics).toEqual([
      {
        attr: 'aria-label',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <div data-gallery-merge="otp-field">
        <div {...root.attrs}>
          <input {...hiddenInput.attrs} />
          <input {...slot.attrs} />
        </div>
      </div>,
    ).toBe(
      '<div data-gallery-merge="otp-field"><div data-invalid="" data-required="" role="application" id="gallery-otp-field" aria-labelledby="gallery-otp-label" aria-describedby="author-otp-description" aria-invalid="true" aria-required="true" class="otp-root gap-2"><input data-required="" aria-hidden="false" data-slot="hidden-input" autoComplete="one-time-code" disabled inputMode="numeric" readOnly tabIndex="-1" type="text" value="1234" name="author-otp-code" pattern="[0-9]*" required class="otp-hidden sr-only"><input data-required="" data-filled="" aria-label="Author digit label" data-slot="0" autoComplete="one-time-code" inputMode="numeric" maxLength="2" type="text" value="9" required class="otp-slot text-center"></div></div>',
    );
  });

  it('renders a golden number-field merge with native input scalars and step button wiring', () => {
    const input = mergePrimitiveAttrs(
      {
        ...numberFieldInputAttributes({
          descriptionId: 'gallery-number-description',
          errorId: 'gallery-number-error',
          id: 'gallery-number-input',
          invalid: true,
          labelledBy: 'gallery-number-label',
          max: 10,
          min: 0,
          name: 'gallery-quantity',
          required: true,
          step: 2,
          value: 4,
        }),
        class: 'number-input',
      },
      {
        'aria-describedby': 'author-number-description',
        class: 'number-input tabular-nums',
        'data-invalid': 'author-invalid',
        max: 8,
        name: 'author-quantity',
        required: false,
        value: 6,
      },
    );
    const increment = mergePrimitiveAttrs(
      {
        ...numberFieldIncrementAttributes({
          id: 'gallery-number-increment',
          inputId: 'gallery-number-input',
          label: 'Increase quantity',
          max: 10,
          value: 4,
        }),
        class: 'number-step',
      },
      {
        class: 'number-step rounded-r',
        'data-action': 'author-increment',
        type: 'submit',
      },
    );

    expect(input.diagnostics).toEqual([
      {
        attr: 'aria-describedby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(increment.diagnostics).toEqual([]);
    expect(
      <div data-gallery-merge="number-field">
        <input {...input.attrs} />
        <button {...increment.attrs}>+</button>
      </div>,
    ).toBe(
      '<div data-gallery-merge="number-field"><input data-invalid="author-invalid" data-required="" aria-describedby="author-number-description" aria-invalid="true" aria-labelledby="gallery-number-label" id="gallery-number-input" max="8" min="0" name="author-quantity" required step="2" type="number" value="6" class="number-input tabular-nums"><button data-action="author-increment" aria-label="Increase quantity" type="submit" id="gallery-number-increment" aria-controls="gallery-number-input" class="number-step rounded-r">+</button></div>',
    );
  });

  it('renders a golden separator merge with orientation and semantic overrides', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...separatorRootAttributes({ decorative: false, orientation: 'vertical' }),
        class: 'separator-root',
      },
      {
        'aria-orientation': 'horizontal',
        class: 'separator-root my-2',
        role: 'presentation',
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'aria-orientation',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<div {...merged.attrs} />).toBe(
      '<div data-orientation="vertical" aria-orientation="horizontal" role="presentation" class="separator-root my-2"></div>',
    );
  });

  it('renders a golden scroll-area merge with viewport ARIA overrides and hidden parts', () => {
    const viewport = mergePrimitiveAttrs(
      {
        ...scrollAreaViewportAttributes({
          descriptionId: 'gallery-scroll-description',
          id: 'gallery-scroll-viewport',
          labelledBy: 'gallery-scroll-title',
          scrollbars: 'both',
        }),
        class: 'scroll-viewport',
      },
      {
        'aria-labelledby': 'author-scroll-title',
        class: 'scroll-viewport overscroll-contain',
        role: 'feed',
        tabIndex: -1,
      },
    );
    const scrollbar = mergePrimitiveAttrs(
      {
        ...scrollAreaScrollbarAttributes({
          forceMount: true,
          id: 'gallery-scrollbar-x',
          orientation: 'horizontal',
          scrollbars: 'both',
          visible: false,
        }),
        class: 'scrollbar',
      },
      {
        'aria-hidden': 'false',
        class: 'scrollbar h-2',
        'data-state': 'author-visible',
        hidden: false,
      },
    );

    expect(viewport.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(scrollbar.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-hidden',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <div data-gallery-merge="scroll-area">
        <div {...viewport.attrs}>Feed</div>
        <div {...scrollbar.attrs} />
      </div>,
    ).toBe(
      '<div data-gallery-merge="scroll-area"><div data-scrollbars="both" tabIndex="-1" aria-describedby="gallery-scroll-description" role="feed" aria-labelledby="author-scroll-title" id="gallery-scroll-viewport" class="scroll-viewport overscroll-contain">Feed</div><div data-scrollbars="both" data-orientation="horizontal" data-state="hidden" aria-hidden="false" id="gallery-scrollbar-x" class="scrollbar h-2"></div></div>',
    );
  });

  it('renders a golden select merge with native trigger and option scalars', () => {
    const state = {
      items: [
        { label: 'Starter', value: 'starter' },
        { label: 'Growth', value: 'growth' },
      ],
      name: 'gallery-plan',
      required: true,
      value: 'growth',
    };
    const trigger = mergePrimitiveAttrs(
      {
        ...selectTriggerAttributes({
          ...state,
          id: 'gallery-select',
          labelledBy: 'gallery-select-label',
          open: true,
        }),
        class: 'select-trigger',
      },
      {
        'aria-expanded': 'false',
        class: 'select-trigger min-w-40',
        'data-state': 'author-open',
        name: 'author-plan',
        required: false,
      },
    );
    const option = mergePrimitiveAttrs(
      {
        ...selectItemAttributes({
          ...state,
          itemLabel: 'Growth',
          itemValue: 'growth',
        }),
        class: 'select-option',
      },
      {
        class: 'select-option font-medium',
        'data-state': 'author-checked',
        label: 'Author Growth',
        selected: false,
        value: 'author-growth',
      },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(option.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <select {...trigger.attrs}>
        <option {...option.attrs}>Growth</option>
      </select>,
    ).toBe(
      '<select data-state="open" data-required="" aria-expanded="false" id="gallery-select" aria-labelledby="gallery-select-label" name="author-plan" required class="select-trigger min-w-40"><option data-state="checked" value="author-growth" label="Author Growth" class="select-option font-medium">Growth</option></select>',
    );
  });

  it('renders a golden switch merge with native logical-OR attributes', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...switchRootAttributes({
          checked: true,
          name: 'gallery-notifications',
          required: true,
          value: 'enabled',
        }),
        class: 'switch-control',
      },
      {
        'aria-checked': 'false',
        class: 'switch-control rounded-full',
        'data-state': 'author-checked',
        disabled: true,
        required: false,
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-checked',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<input {...merged.attrs} />).toBe(
      '<input data-state="checked" aria-checked="false" checked disabled name="gallery-notifications" role="switch" required type="checkbox" value="enabled" class="switch-control rounded-full">',
    );
  });

  it('rewires dialog trigger IDREFs when an authored dialog content id wins', () => {
    const idRewrites = new Map([['gallery-dialog-content', 'authored-dialog-content']]);
    const trigger = mergePrimitiveAttrs(
      rewriteIdrefs(
        dialogTriggerAttributes({ contentId: 'gallery-dialog-content', open: false }),
        idRewrites,
      ),
      { class: 'dialog-trigger' },
    );
    const content = mergePrimitiveAttrs(
      dialogContentAttributes({
        contentId: 'gallery-dialog-content',
        descriptionId: 'gallery-dialog-description',
        open: true,
        titleId: 'gallery-dialog-title',
      }),
      { class: 'dialog-panel', id: 'authored-dialog-content' },
    );

    expect(trigger.diagnostics).toEqual([]);
    expect(content.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="dialog-idref">
        <button {...trigger.attrs}>Open</button>
        <dialog {...content.attrs}>Body</dialog>
      </section>,
    ).toBe(
      '<section data-gallery-merge="dialog-idref"><button data-state="closed" aria-expanded="false" aria-haspopup="dialog" type="button" aria-controls="authored-dialog-content" command="show-modal" commandfor="authored-dialog-content" class="dialog-trigger">Open</button><dialog data-state="open" open id="authored-dialog-content" aria-labelledby="gallery-dialog-title" aria-describedby="gallery-dialog-description" class="dialog-panel">Body</dialog></section>',
    );
  });

  it('rewires tab trigger and panel IDREFs when authored ids win', () => {
    const idRewrites = new Map([
      ['gallery-tabs-overview', 'authored-tabs-overview'],
      ['gallery-tabs-overview-panel', 'authored-tabs-overview-panel'],
    ]);
    const trigger = mergePrimitiveAttrs(
      rewriteIdrefs(
        tabsTriggerAttributes({
          activeValue: 'overview',
          id: 'gallery-tabs-overview',
          itemValue: 'overview',
          panelId: 'gallery-tabs-overview-panel',
          value: 'overview',
        }),
        idRewrites,
      ),
      { class: 'tabs-trigger', id: 'authored-tabs-overview' },
    );
    const panel = mergePrimitiveAttrs(
      rewriteIdrefs(
        tabsPanelAttributes({
          id: 'gallery-tabs-overview-panel',
          itemValue: 'overview',
          triggerId: 'gallery-tabs-overview',
          value: 'overview',
        }),
        idRewrites,
      ),
      { class: 'tabs-panel', id: 'authored-tabs-overview-panel' },
    );

    expect(trigger.diagnostics).toEqual([]);
    expect(panel.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="tabs-idref">
        <button {...trigger.attrs}>Overview</button>
        <div {...panel.attrs}>Panel</div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="tabs-idref"><button data-state="active" aria-selected="true" role="tab" tabIndex="0" type="button" value="overview" aria-controls="authored-tabs-overview-panel" id="authored-tabs-overview" class="tabs-trigger">Overview</button><div data-state="active" role="tabpanel" tabIndex="0" aria-labelledby="authored-tabs-overview" id="authored-tabs-overview-panel" class="tabs-panel">Panel</div></section>',
    );
  });

  it('rewires radio label IDREFs when an authored native radio id wins', () => {
    const idRewrites = new Map([['gallery-radio-express', 'authored-radio-express']]);
    const state = {
      items: [{ value: 'standard' }, { value: 'express' }],
      name: 'gallery-shipping-speed',
      required: true,
      value: 'express',
    };
    const radio = mergePrimitiveAttrs(
      radioGroupRadioAttributes({
        ...state,
        controlId: 'gallery-radio-express',
        itemValue: 'express',
      }),
      { class: 'radio-input', id: 'authored-radio-express', required: false },
    );
    const label = mergePrimitiveAttrs(
      rewriteIdrefs(
        radioGroupLabelAttributes({
          ...state,
          controlId: 'gallery-radio-express',
          itemValue: 'express',
        }),
        idRewrites,
      ),
      { class: 'radio-label' },
    );

    expect(radio.diagnostics).toEqual([]);
    expect(label.diagnostics).toEqual([]);
    expect(
      <div data-gallery-merge="radio-idref">
        <input {...radio.attrs} />
        <label {...label.attrs}>Express</label>
      </div>,
    ).toBe(
      '<div data-gallery-merge="radio-idref"><input data-state="checked" aria-checked="true" checked tabIndex="0" type="radio" value="express" id="authored-radio-express" name="gallery-shipping-speed" required class="radio-input"><label data-state="checked" for="authored-radio-express" class="radio-label">Express</label></div>',
    );
  });

  it('pins FW231 for package-prefixed behavior IDREF conflicts', () => {
    const merged = mergePrimitiveAttrs(
      tooltipTriggerAttributes({
        contentId: 'gallery-tooltip-content',
        open: true,
      }),
      { 'jiso-tooltip': 'author-tooltip-content' },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'jiso-tooltip',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
  });

  it('pins FW231 for double-wired dialog trigger relationships', () => {
    const merged = mergePrimitiveAttrs(
      dialogTriggerAttributes({ contentId: 'gallery-dialog-content', open: false }),
      { commandfor: 'other-dialog' },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
  });
});

function mergePrimitiveAttrs(
  primitive: AttributeRecord,
  author: AttributeRecord,
): MergeFixtureResult {
  const attrs: Record<string, AttributeValue> = {};
  const diagnostics: MergeDiagnostic[] = [];
  const keys = stableKeys(primitive, author);

  // SPEC.md §4.6 is the normative merge table. This gallery-only oracle keeps
  // G5 deterministic while compiler/runtime merge lowering remains outside this slice.
  for (const key of keys) {
    const primitiveValue = primitive[key];
    const authorValue = author[key];
    const primitiveSet = primitiveValue !== undefined;
    const authorSet = authorValue !== undefined;

    if (key === 'class') {
      attrs[key] = mergeTokenLists(primitiveValue, authorValue);
      continue;
    }

    if (key === 'style') {
      attrs[key] = mergeStyles(primitiveValue, authorValue);
      continue;
    }

    if (key.startsWith('on:')) {
      attrs[key] = mergeRefs(authorValue, primitiveValue);
      continue;
    }

    if (key === 'id') {
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (idrefAttributes.has(key)) {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW231',
          message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (key.startsWith('aria-') || key === 'role') {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW232',
          message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (key === 'data-state') {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW232',
          message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
        });
      }
      attrs[key] = primitiveSet ? primitiveValue : authorValue;
      continue;
    }

    if (key.startsWith('data-p-')) {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW231',
          message: 'Unmergeable primitive handler-param conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (key === 'data-bind' || key.startsWith('data-bind:')) {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW233',
          message: 'Unmergeable primitive binding conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (logicalOrAttributes.has(key)) {
      attrs[key] = Boolean(primitiveValue) || Boolean(authorValue);
      continue;
    }

    if (key === 'fw-deps') {
      attrs[key] = mergeTokenLists(primitiveValue, authorValue);
      continue;
    }

    if (key === 'fw-c' || key === 'fw-state') {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW231',
          message: 'Unmergeable primitive island conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    attrs[key] = authorSet ? authorValue : primitiveValue;
  }

  return { attrs, diagnostics };
}

function rewriteIdrefs(
  attrs: AttributeRecord,
  rewrites: ReadonlyMap<string, string>,
): AttributeRecord {
  const rewritten: Record<string, AttributeValue> = {};

  for (const [key, value] of Object.entries(attrs)) {
    rewritten[key] =
      typeof value === 'string' && idrefAttributes.has(key)
        ? rewriteIdrefValue(value, rewrites)
        : value;
  }

  return rewritten;
}

function rewriteIdrefValue(value: string, rewrites: ReadonlyMap<string, string>): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => rewrites.get(token) ?? token)
    .join(' ');
}

function stableKeys(primitive: AttributeRecord, author: AttributeRecord): readonly string[] {
  return [...new Set([...Object.keys(primitive), ...Object.keys(author)])];
}

function mergeRefs(
  authorValue: AttributeValue,
  primitiveValue: AttributeValue,
): string | undefined {
  return mergeTokenLists(authorValue, primitiveValue);
}

function mergeStyles(
  primitiveValue: AttributeValue,
  authorValue: AttributeValue,
): string | undefined {
  return (
    [primitiveValue, authorValue]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().replace(/;+$/, ''))
      .join('; ') || undefined
  );
}

function mergeTokenLists(first: AttributeValue, second: AttributeValue): string | undefined {
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const value of [first, second]) {
    if (typeof value !== 'string') continue;

    for (const token of value.trim().split(/\s+/)) {
      if (!token || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }

  return tokens.join(' ') || undefined;
}
