/** @jsxImportSource @kovojs/server */
import { describe, expect, it } from 'vitest';
import {
  autocompleteInputAttributes,
  autocompleteListAttributes,
  autocompleteOptionAttributes,
  autocompleteValueAttributes,
} from '@kovojs/headless-ui/autocomplete';
import {
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupLabelAttributes,
  checkboxGroupRootAttributes,
} from '@kovojs/headless-ui/checkbox-group';
import { checkboxRootAttributes } from '@kovojs/headless-ui/checkbox';
import {
  comboboxInputAttributes,
  comboboxListboxAttributes,
  comboboxOptionAttributes,
} from '@kovojs/headless-ui/combobox';
import {
  fieldControlAttributes,
  fieldLabelAttributes,
  fieldRootAttributes,
  fieldsetLegendAttributes,
  fieldsetRootAttributes,
} from '@kovojs/headless-ui/field';
import {
  numberFieldIncrementAttributes,
  numberFieldInputAttributes,
} from '@kovojs/headless-ui/number-field';
import {
  otpFieldHiddenInputAttributes,
  otpFieldInputAttributes,
  otpFieldRootAttributes,
} from '@kovojs/headless-ui/otp-field';
import {
  selectContentAttributes,
  selectItemAttributes,
  selectRootAttributes,
  selectTriggerAttributes,
  selectValueAttributes,
} from '@kovojs/headless-ui/select';
import {
  sliderHiddenInputAttributes,
  sliderInputAttributes,
  sliderThumbAttributes,
  sliderTrackAttributes,
} from '@kovojs/headless-ui/slider';
import { switchRootAttributes } from '@kovojs/headless-ui/switch';
import {
  toggleGroupButtonAttributes,
  toggleGroupItemAttributes,
  toggleGroupRootAttributes,
} from '@kovojs/headless-ui/toggle-group';
import { toggleRootAttributes } from '@kovojs/headless-ui/toggle';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
} from '@kovojs/headless-ui/toolbar';
import { mergeCompilerPrimitiveAttrs, rewriteIdrefs } from './gallery-merge-fixtures-oracle.js';
describe('gallery G5 primitive merge fixtures', () => {
  it('renders a golden combobox merge with active descendant and option conflicts', () => {
    const state = {
      highlightedValue: 'enterprise',
      invalid: true,
      items: [
        { label: 'Starter', value: 'starter' },
        { label: 'Enterprise', value: 'enterprise' },
      ],
      listboxId: 'gallery-combobox-listbox',
      name: 'gallery-plan',
      open: true,
      required: true,
      value: 'enterprise',
    };
    const input = mergeCompilerPrimitiveAttrs(
      {
        ...comboboxInputAttributes({
          ...state,
          descriptionId: 'gallery-combobox-description',
          errorId: 'gallery-combobox-error',
          id: 'gallery-combobox-input',
          labelledBy: 'gallery-combobox-label',
          placeholder: 'Choose a plan',
        }),
        class: 'combobox-input',
      },
      {
        'aria-describedby': 'author-combobox-description',
        class: 'combobox-input rounded',
        'data-state': 'author-open',
        name: 'author-plan',
        required: false,
      },
    );
    const listbox = mergeCompilerPrimitiveAttrs(
      {
        ...comboboxListboxAttributes({
          ...state,
          id: 'gallery-combobox-listbox',
          labelledBy: 'gallery-combobox-label',
        }),
        class: 'combobox-listbox',
      },
      {
        class: 'combobox-listbox shadow',
        role: 'menu',
      },
    );
    const option = mergeCompilerPrimitiveAttrs(
      {
        ...comboboxOptionAttributes({
          ...state,
          id: 'gallery-combobox-option-1',
          itemLabel: 'Enterprise',
          itemValue: 'enterprise',
        }),
        class: 'combobox-option',
      },
      {
        'aria-selected': 'false',
        class: 'combobox-option font-medium',
        'data-state': 'author-selected',
        role: 'menuitem',
      },
    );
    expect(input.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(listbox.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(option.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-selected',
        // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "true" vs author "false" → KV317 error.
        code: 'KV317',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      String(
        <section data-gallery-merge="combobox">
          <input {...input.attrs} />
          <div {...listbox.attrs}>
            <div {...option.attrs}>Enterprise</div>
          </div>
        </section>,
      ),
    ).toBe(
      '<section data-gallery-merge="combobox"><input data-state="open" data-invalid="" data-required="" aria-autocomplete="list" aria-expanded="true" role="combobox" type="text" value="enterprise" aria-activedescendant="gallery-combobox-listbox-option-0" aria-controls="gallery-combobox-listbox" id="gallery-combobox-input" aria-labelledby="gallery-combobox-label" aria-describedby="author-combobox-description" aria-invalid="true" name="author-plan" placeholder="Choose a plan" required class="combobox-input rounded"><div data-state="open" data-invalid="" data-required="" role="menu" id="gallery-combobox-listbox" aria-labelledby="gallery-combobox-label" class="combobox-listbox shadow"><div data-state="checked" data-highlighted="" aria-selected="true" role="menuitem" id="gallery-combobox-option-1" label="Enterprise" value="enterprise" class="combobox-option font-medium">Enterprise</div></div></section>',
    );
  });
  it('renders a golden autocomplete merge with native datalist attrs and value display', () => {
    const state = {
      highlightedValue: 'chicago',
      inputValue: 'chi',
      invalid: true,
      items: [
        { label: 'Austin', value: 'austin' },
        { disabled: true, label: 'Boston', value: 'boston' },
        { textValue: 'Chicago city', value: 'chicago' },
      ],
      listId: 'gallery-autocomplete-list',
      name: 'gallery-city',
      open: true,
      required: true,
      value: 'austin',
    };
    const input = mergeCompilerPrimitiveAttrs(
      {
        ...autocompleteInputAttributes({
          ...state,
          descriptionId: 'gallery-autocomplete-description',
          errorId: 'gallery-autocomplete-error',
          id: 'gallery-autocomplete-input',
          labelledBy: 'gallery-autocomplete-label',
          placeholder: 'Choose a city',
        }),
        class: 'autocomplete-input',
      },
      {
        'aria-describedby': 'author-autocomplete-help',
        autocomplete: 'name',
        class: 'autocomplete-input rounded',
        'data-state': 'author-open',
        name: 'author-city',
        required: false,
        role: 'searchbox',
      },
    );
    const list = mergeCompilerPrimitiveAttrs(
      {
        ...autocompleteListAttributes({
          ...state,
          id: 'gallery-autocomplete-list',
          labelledBy: 'gallery-autocomplete-label',
        }),
        class: 'autocomplete-list',
      },
      {
        class: 'autocomplete-list shadow',
        id: 'author-autocomplete-list',
      },
    );
    const option = mergeCompilerPrimitiveAttrs(
      {
        ...autocompleteOptionAttributes({
          ...state,
          id: 'gallery-autocomplete-option-2',
          itemLabel: 'Chicago',
          itemValue: 'chicago',
        }),
        class: 'autocomplete-option',
      },
      {
        class: 'autocomplete-option font-medium',
        'data-state': 'author-selected',
        disabled: true,
        label: 'Author Chicago',
        selected: true,
      },
    );
    const value = mergeCompilerPrimitiveAttrs(
      {
        ...autocompleteValueAttributes({
          id: 'gallery-autocomplete-value',
          placeholder: 'Choose a city',
          value: '',
        }),
        class: 'autocomplete-value',
      },
      {
        class: 'autocomplete-value text-muted',
        'data-placeholder': 'author-placeholder',
        id: 'author-autocomplete-value',
      },
    );
    expect(input.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(list.diagnostics).toEqual([]);
    expect(option.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(value.diagnostics).toEqual([]);
    expect(
      String(
        <section data-gallery-merge="autocomplete">
          <input {...input.attrs} />
          <datalist {...list.attrs}>
            <option {...option.attrs}>Chicago</option>
          </datalist>
          <span {...value.attrs}>Choose a city</span>
        </section>,
      ),
    ).toBe(
      '<section data-gallery-merge="autocomplete"><input data-state="open" data-invalid="" data-required="" aria-autocomplete="list" aria-expanded="true" autocomplete="name" role="searchbox" type="text" value="chi" aria-activedescendant="gallery-autocomplete-list-option-0" aria-controls="gallery-autocomplete-list" id="gallery-autocomplete-input" aria-labelledby="gallery-autocomplete-label" aria-describedby="author-autocomplete-help" aria-invalid="true" name="author-city" placeholder="Choose a city" required class="autocomplete-input rounded"><datalist data-state="open" data-invalid="" data-required="" id="author-autocomplete-list" aria-labelledby="gallery-autocomplete-label" role="listbox" class="autocomplete-list shadow"><option data-state="unchecked" data-highlighted="" aria-selected="false" role="option" value="chicago" id="gallery-autocomplete-option-2" label="Author Chicago" class="autocomplete-option font-medium" disabled selected>Chicago</option></datalist><span data-placeholder="author-placeholder" id="author-autocomplete-value" class="autocomplete-value text-muted">Choose a city</span></section>',
    );
  });
  it('renders a golden slider merge with native range input and decorative parts', () => {
    const state = {
      invalid: true,
      max: 10,
      min: 0,
      name: 'gallery-volume',
      orientation: 'vertical' as const,
      required: true,
      step: 2,
      value: 6,
    };
    const input = mergeCompilerPrimitiveAttrs(
      {
        ...sliderInputAttributes({
          ...state,
          descriptionId: 'gallery-slider-description',
          errorId: 'gallery-slider-error',
          id: 'gallery-slider-input',
          labelledBy: 'gallery-slider-label',
          valueText: '60 percent',
        }),
        class: 'slider-input',
      },
      {
        'aria-orientation': 'horizontal',
        class: 'slider-input sr-only',
        'data-value': 'author-value',
        max: 12,
        name: 'author-volume',
        required: false,
      },
    );
    const track = mergeCompilerPrimitiveAttrs(
      {
        ...sliderTrackAttributes({ ...state, id: 'gallery-slider-track' }),
        class: 'slider-track',
      },
      {
        'aria-hidden': 'false',
        class: 'slider-track h-24',
        role: 'presentation',
      },
    );
    const thumb = mergeCompilerPrimitiveAttrs(
      {
        ...sliderThumbAttributes({ ...state, id: 'gallery-slider-thumb' }),
        class: 'slider-thumb',
      },
      {
        class: 'slider-thumb shadow',
        'data-value-ratio': 'author-ratio',
      },
    );
    const hidden = mergeCompilerPrimitiveAttrs(
      {
        ...sliderHiddenInputAttributes({
          ...state,
          form: 'gallery-slider-form',
        }),
        class: 'slider-hidden',
      },
      {
        class: 'slider-hidden author-hidden',
        value: 8,
      },
    );
    expect(input.diagnostics).toEqual([
      {
        attr: 'aria-orientation',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(track.diagnostics).toEqual([]);
    expect(thumb.diagnostics).toEqual([]);
    expect(hidden.diagnostics).toEqual([]);
    expect(
      String(
        <section data-gallery-merge="slider">
          <input {...input.attrs} />
          <input {...hidden.attrs} />
          <div {...track.attrs}>
            <span {...thumb.attrs} />
          </div>
        </section>,
      ),
    ).toBe(
      '<section data-gallery-merge="slider"><input data-orientation="vertical" data-invalid="" data-required="" data-max="10" data-min="0" data-value="author-value" aria-describedby="gallery-slider-description gallery-slider-error" aria-invalid="true" aria-orientation="horizontal" aria-labelledby="gallery-slider-label" aria-valuetext="60 percent" id="gallery-slider-input" max="12" min="0" name="author-volume" required step="2" type="range" value="6" class="slider-input sr-only"><input form="gallery-slider-form" name="gallery-volume" type="hidden" value="8" class="slider-hidden author-hidden"><div data-orientation="vertical" data-invalid="" data-required="" data-max="10" data-min="0" data-value="6" data-part="track" data-value-ratio="0.6" id="gallery-slider-track" class="slider-track h-24" aria-hidden="false" role="presentation"><span data-orientation="vertical" data-invalid="" data-required="" data-max="10" data-min="0" data-value="6" aria-invalid="true" aria-orientation="vertical" aria-valuemax="10" aria-valuemin="0" aria-valuenow="6" data-part="thumb" data-value-ratio="author-ratio" id="gallery-slider-thumb" role="slider" tabIndex="0" class="slider-thumb shadow"></span></div></section>',
    );
  });
  it('renders a golden toggle merge with authored class, handlers, scalars, and state overrides', () => {
    const merged = mergeCompilerPrimitiveAttrs(
      {
        ...toggleRootAttributes({ pressed: true }),
        class: 'inline-flex saved',
        'kovo-deps': 'toggle:pressed',
        'on:click': '/gallery/toggle.client.js#primitiveToggle',
        style: '--toggle-state: pressed; color: blue',
      },
      {
        'aria-pressed': 'mixed',
        class: 'saved rounded-sm',
        'data-state': 'author-pressed',
        disabled: true,
        'kovo-deps': 'route:gallery',
        'on:click': '/gallery/author.client.js#trackToggle',
        style: 'color: red; margin: 0',
        type: 'submit',
      },
    );
    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-pressed',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(String(<button {...merged.attrs}>Saved</button>)).toBe(
      // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "true" wins over author "mixed".
      '<button data-state="pressed" aria-pressed="true" disabled type="submit" class="inline-flex saved rounded-sm" kovo-deps="toggle:pressed route:gallery" on:click="/gallery/author.client.js#trackToggle /gallery/toggle.client.js#primitiveToggle" style="--toggle-state: pressed; color: blue; color: red; margin: 0">Saved</button>',
    );
  });
  it('renders a golden checkbox merge with native control logical-OR attributes', () => {
    const merged = mergeCompilerPrimitiveAttrs(
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
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-checked',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(String(<input {...merged.attrs} />)).toBe(
      // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "mixed" wins over author "false".
      '<input data-state="indeterminate" aria-checked="mixed" disabled name="author-consent" required type="checkbox" value="author-yes" class="checkbox-control rounded border">',
    );
  });
  it('renders a golden field merge with native label and control wiring', () => {
    const root = mergeCompilerPrimitiveAttrs(
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
    const control = mergeCompilerPrimitiveAttrs(
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
    const label = mergeCompilerPrimitiveAttrs(
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
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
      {
        attr: 'aria-invalid',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(label.diagnostics).toEqual([
      {
        attr: 'for',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(
      String(
        <div data-gallery-merge="field">
          <div {...root.attrs}>
            <label {...label.attrs}>Email</label>
            <input {...control.attrs} />
          </div>
        </div>,
      ),
    ).toBe(
      '<div data-gallery-merge="field"><div data-invalid="author-invalid" data-required="" id="author-field" class="field-root grid gap-1"><label for="author-field-email" class="field-label">Email</label><input data-invalid="" data-required="" aria-describedby="author-field-description" aria-invalid="false" id="gallery-field-email" name="author-email" required class="field-control border"></div></div>',
    );
  });
  it('renders a golden otp-field merge with aggregate input and slot overrides', () => {
    const root = mergeCompilerPrimitiveAttrs(
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
    const hiddenInput = mergeCompilerPrimitiveAttrs(
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
    const slot = mergeCompilerPrimitiveAttrs(
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
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(hiddenInput.diagnostics).toEqual([
      {
        attr: 'aria-hidden',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(slot.diagnostics).toEqual([
      {
        attr: 'aria-label',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      String(
        <div data-gallery-merge="otp-field">
          <div {...root.attrs}>
            <input {...hiddenInput.attrs} />
            <input {...slot.attrs} />
          </div>
        </div>,
      ),
    ).toBe(
      '<div data-gallery-merge="otp-field"><div data-invalid="" data-required="" role="application" id="gallery-otp-field" aria-labelledby="gallery-otp-label" aria-describedby="author-otp-description" aria-invalid="true" class="otp-root gap-2"><input data-required="" aria-hidden="false" data-slot="hidden-input" autoComplete="one-time-code" disabled inputMode="numeric" maxLength="6" minLength="6" tabIndex="-1" type="text" value="1234" name="author-otp-code" pattern="[0-9]*" required class="otp-hidden sr-only"><input data-required="" data-filled="" aria-label="Author digit label" data-slot="0" autoComplete="one-time-code" inputMode="numeric" maxLength="2" type="text" value="9" required class="otp-slot text-center"></div></div>',
    );
  });
  it('renders a golden number-field merge with native input scalars and step button wiring', () => {
    const input = mergeCompilerPrimitiveAttrs(
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
    const increment = mergeCompilerPrimitiveAttrs(
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
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(increment.diagnostics).toEqual([]);
    expect(
      String(
        <div data-gallery-merge="number-field">
          <input {...input.attrs} />
          <button {...increment.attrs}>+</button>
        </div>,
      ),
    ).toBe(
      '<div data-gallery-merge="number-field"><input data-invalid="author-invalid" data-required="" aria-describedby="author-number-description" aria-invalid="true" aria-labelledby="gallery-number-label" id="gallery-number-input" max="8" min="0" name="author-quantity" required step="2" type="number" value="6" class="number-input tabular-nums"><button data-action="author-increment" aria-label="Increase quantity" type="submit" id="gallery-number-increment" aria-controls="gallery-number-input" class="number-step rounded-r">+</button></div>',
    );
  });
  it('renders a golden select merge with custom trigger and option scalars', () => {
    const state = {
      items: [
        { label: 'Starter', value: 'starter' },
        { label: 'Growth', value: 'growth' },
      ],
      name: 'gallery-plan',
      required: true,
      value: 'growth',
    };
    const trigger = mergeCompilerPrimitiveAttrs(
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
    const option = mergeCompilerPrimitiveAttrs(
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
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "true" vs author "false" → KV317 error.
        code: 'KV317',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(option.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      String(
        <button {...trigger.attrs}>
          <div {...option.attrs}>Growth</div>
        </button>,
      ),
    ).toBe(
      '<button data-state="open" data-required="" aria-expanded="true" aria-haspopup="listbox" role="combobox" type="button" id="gallery-select" aria-labelledby="gallery-select-label" class="select-trigger min-w-40" name="author-plan"><div data-state="checked" aria-selected="true" role="option" id="select-option-1" value="author-growth" label="Author Growth" class="select-option font-medium">Growth</div></button>',
    );
  });
  it('renders a golden switch merge with native logical-OR attributes', () => {
    const merged = mergeCompilerPrimitiveAttrs(
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
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-checked',
        // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "true" vs author "false" → KV317 error.
        code: 'KV317',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(String(<input {...merged.attrs} />)).toBe(
      '<input data-state="checked" aria-checked="true" checked disabled name="gallery-notifications" role="switch" required type="checkbox" value="enabled" class="switch-control rounded-full">',
    );
  });
  it('renders golden checkbox-group merges across root, item, control, and label attrs', () => {
    const state = {
      activeValue: 'email',
      descriptionId: 'gallery-notifications-help',
      errorId: 'gallery-notifications-error',
      invalid: true,
      items: [{ value: 'email' }, { disabled: true, value: 'sms' }],
      name: 'notifications',
      orientation: 'vertical' as const,
      required: true,
      value: ['email'],
    };
    const root = mergeCompilerPrimitiveAttrs(
      {
        ...checkboxGroupRootAttributes({
          ...state,
          id: 'gallery-notifications',
          labelledBy: 'gallery-notifications-label',
        }),
        class: 'checkbox-group',
      },
      {
        'aria-describedby': 'author-notifications-help',
        class: 'checkbox-group gap-2',
        role: 'group',
      },
    );
    const item = mergeCompilerPrimitiveAttrs(
      {
        ...checkboxGroupItemAttributes({
          ...state,
          id: 'gallery-notifications-email-item',
          itemValue: 'email',
        }),
        class: 'checkbox-group-item',
      },
      {
        class: 'checkbox-group-item flex',
        'data-state': 'unchecked',
        id: 'author-notifications-email-item',
      },
    );
    const control = mergeCompilerPrimitiveAttrs(
      checkboxGroupControlAttributes({
        ...state,
        controlId: 'gallery-notifications-email',
        itemValue: 'email',
      }),
      {
        'aria-checked': 'false',
        class: 'checkbox-group-control',
        disabled: true,
        id: 'author-notifications-email',
        required: false,
      },
    );
    const label = mergeCompilerPrimitiveAttrs(
      rewriteIdrefs(
        checkboxGroupLabelAttributes({
          ...state,
          controlId: 'gallery-notifications-email',
          id: 'gallery-notifications-email-label',
          itemValue: 'email',
        }),
        new Map([['gallery-notifications-email', 'author-notifications-email']]),
      ),
      { class: 'checkbox-group-label' },
    );
    expect(root.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(item.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(control.diagnostics).toEqual([
      {
        attr: 'aria-checked',
        // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "true" vs author "false" → KV317 error.
        code: 'KV317',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(label.diagnostics).toEqual([]);
    expect(
      String(
        <fieldset data-gallery-merge="checkbox-group">
          <div {...root.attrs}>
            <div {...item.attrs}>
              <input {...control.attrs} />
              <label {...label.attrs}>Email</label>
            </div>
          </div>
        </fieldset>,
      ),
    ).toBe(
      '<fieldset data-gallery-merge="checkbox-group"><div data-orientation="vertical" data-invalid="" data-required="" role="group" id="gallery-notifications" aria-labelledby="gallery-notifications-label" aria-describedby="author-notifications-help" aria-invalid="true" aria-required="true" class="checkbox-group gap-2"><div data-state="checked" id="author-notifications-email-item" class="checkbox-group-item flex"><input data-state="checked" aria-checked="true" checked disabled tabIndex="0" type="checkbox" value="email" id="author-notifications-email" name="notifications" required class="checkbox-group-control"><label data-state="checked" for="author-notifications-email" id="gallery-notifications-email-label" class="checkbox-group-label">Email</label></div></div></fieldset>',
    );
  });
  it('renders golden toggle-group and toolbar merges for roving button attrs', () => {
    const toggleState = {
      activeValue: 'bold',
      items: [{ value: 'bold' }, { disabled: true, value: 'italic' }],
      orientation: 'horizontal' as const,
      type: 'multiple' as const,
      value: ['bold'],
    };
    const toggleRoot = mergeCompilerPrimitiveAttrs(
      {
        ...toggleGroupRootAttributes({
          ...toggleState,
          descriptionId: 'gallery-formatting-help',
          id: 'gallery-formatting',
          labelledBy: 'gallery-formatting-label',
        }),
        class: 'toggle-group',
      },
      {
        'aria-labelledby': 'author-formatting-label',
        class: 'toggle-group rounded',
        role: 'toolbar',
      },
    );
    const toggleItem = mergeCompilerPrimitiveAttrs(
      {
        ...toggleGroupItemAttributes({
          ...toggleState,
          id: 'gallery-bold-item',
          itemValue: 'bold',
        }),
        class: 'toggle-group-item',
      },
      { class: 'toggle-group-item selected', 'data-state': 'off' },
    );
    const toggleButton = mergeCompilerPrimitiveAttrs(
      toggleGroupButtonAttributes({
        ...toggleState,
        id: 'gallery-bold-button',
        itemValue: 'bold',
      }),
      {
        'aria-pressed': 'false',
        class: 'toggle-group-button',
        disabled: true,
        value: 'author-bold',
      },
    );
    const toolbarState = {
      activeValue: 'align-left',
      items: [{ value: 'align-left' }, { disabled: true, value: 'align-right' }],
      orientation: 'vertical' as const,
    };
    const toolbar = mergeCompilerPrimitiveAttrs(
      {
        ...toolbarRootAttributes({
          ...toolbarState,
          descriptionId: 'gallery-toolbar-help',
          id: 'gallery-toolbar',
          label: 'Editor toolbar',
        }),
        class: 'toolbar-root',
      },
      {
        'aria-orientation': 'horizontal',
        class: 'toolbar-root gap-1',
        role: 'group',
      },
    );
    const toolbarItem = mergeCompilerPrimitiveAttrs(
      {
        ...toolbarItemAttributes({
          ...toolbarState,
          id: 'gallery-align-left-item',
          itemValue: 'align-left',
        }),
        class: 'toolbar-item',
      },
      { class: 'toolbar-item shrink-0' },
    );
    const toolbarButton = mergeCompilerPrimitiveAttrs(
      toolbarButtonAttributes({
        ...toolbarState,
        id: 'gallery-align-left-button',
        itemValue: 'align-left',
        pressed: true,
      }),
      {
        'aria-pressed': 'false',
        class: 'toolbar-button',
        disabled: true,
        value: 'author-align-left',
      },
    );
    expect(toggleRoot.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(toggleItem.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(toggleButton.diagnostics).toEqual([
      {
        attr: 'aria-pressed',
        // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "true" vs author "false" → KV317 error.
        code: 'KV317',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(toolbar.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-orientation',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(toolbarItem.diagnostics).toEqual([]);
    expect(toolbarButton.diagnostics).toEqual([
      {
        attr: 'aria-pressed',
        // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "true" vs author "false" → KV317 error.
        code: 'KV317',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      String(
        <section data-gallery-merge="roving-groups">
          <div {...toggleRoot.attrs}>
            <span {...toggleItem.attrs}>
              <button {...toggleButton.attrs}>Bold</button>
            </span>
          </div>
          <div {...toolbar.attrs}>
            <span {...toolbarItem.attrs}>
              <button {...toolbarButton.attrs}>Left</button>
            </span>
          </div>
        </section>,
      ),
    ).toBe(
      '<section data-gallery-merge="roving-groups"><div data-orientation="horizontal" role="toolbar" id="gallery-formatting" aria-labelledby="author-formatting-label" aria-describedby="gallery-formatting-help" class="toggle-group rounded"><span data-state="pressed" id="gallery-bold-item" class="toggle-group-item selected"><button data-state="pressed" aria-pressed="true" disabled tabIndex="0" type="button" value="author-bold" id="gallery-bold-button" class="toggle-group-button">Bold</button></span></div><div data-orientation="vertical" role="group" id="gallery-toolbar" aria-label="Editor toolbar" aria-describedby="gallery-toolbar-help" aria-orientation="horizontal" class="toolbar-root gap-1"><span id="gallery-align-left-item" class="toolbar-item shrink-0"><button disabled tabIndex="0" type="button" value="author-align-left" aria-pressed="true" data-pressed="true" id="gallery-align-left-button" class="toolbar-button">Left</button></span></div></section>',
    );
  });
  it('renders golden select merges across root, trigger, content, value, and option attrs', () => {
    const state = {
      disabled: true,
      invalid: true,
      items: [
        { label: 'Starter', value: 'starter' },
        { disabled: true, label: 'Growth', value: 'growth' },
      ],
      name: 'gallery-plan',
      open: false,
      placeholder: 'Choose a plan',
      required: true,
      value: '',
    };
    const root = mergeCompilerPrimitiveAttrs(
      { ...selectRootAttributes({ ...state, id: 'gallery-select-root' }), class: 'select-root' },
      {
        class: 'select-root grid',
        'data-placeholder': 'author-placeholder',
        id: 'author-select-root',
      },
    );
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...selectTriggerAttributes({
          ...state,
          descriptionId: 'gallery-select-description',
          errorId: 'gallery-select-error',
          id: 'gallery-select-trigger',
          labelledBy: 'gallery-select-label',
        }),
        class: 'select-trigger',
      },
      {
        'aria-describedby': 'author-select-description',
        class: 'select-trigger w-44',
        disabled: false,
        name: 'author-plan',
        required: false,
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...selectContentAttributes({
          ...state,
          id: 'gallery-select-content',
          labelledBy: 'gallery-select-label',
        }),
        class: 'select-content',
      },
      {
        'aria-labelledby': 'author-select-label',
        class: 'select-content shadow',
      },
    );
    const value = mergeCompilerPrimitiveAttrs(
      {
        ...selectValueAttributes({ ...state, id: 'gallery-select-value' }),
        class: 'select-value',
      },
      {
        class: 'select-value text-muted',
        'data-placeholder': 'author-placeholder',
        id: 'author-select-value',
      },
    );
    const option = mergeCompilerPrimitiveAttrs(
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
        disabled: false,
        selected: true,
        value: 'author-growth',
      },
    );
    expect(root.diagnostics).toEqual([]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'aria-describedby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'aria-labelledby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(value.diagnostics).toEqual([]);
    expect(option.diagnostics).toEqual([]);
    expect(
      String(
        <section data-gallery-merge="select-family">
          <div {...root.attrs}>
            <button {...trigger.attrs}>
              <div {...option.attrs}>Growth</div>
            </button>
            <div {...content.attrs}>
              <span {...value.attrs}>Choose a plan</span>
            </div>
          </div>
        </section>,
      ),
    ).toBe(
      '<section data-gallery-merge="select-family"><div data-state="closed" data-disabled="" data-placeholder="author-placeholder" data-invalid="" data-required="" id="author-select-root" class="select-root grid"><button data-state="closed" data-disabled="" data-placeholder="" data-invalid="" data-required="" aria-expanded="false" aria-haspopup="listbox" role="combobox" type="button" disabled id="gallery-select-trigger" aria-labelledby="gallery-select-label" aria-describedby="author-select-description" aria-invalid="true" class="select-trigger w-44" name="author-plan"><div data-state="unchecked" data-disabled="" aria-selected="false" role="option" id="select-option-1" aria-disabled="true" value="author-growth" label="Growth" class="select-option font-medium" selected>Growth</div></button><div data-state="closed" data-disabled="" data-placeholder="" data-invalid="" data-required="" role="listbox" id="gallery-select-content" aria-labelledby="author-select-label" hidden class="select-content shadow"><span data-placeholder="author-placeholder" id="author-select-value" class="select-value text-muted">Choose a plan</span></div></div></section>',
    );
  });
  it('renders golden fieldset merges for grouped field semantics', () => {
    const root = mergeCompilerPrimitiveAttrs(
      {
        ...fieldsetRootAttributes({
          descriptionId: 'gallery-fieldset-description',
          disabled: true,
          errorId: 'gallery-fieldset-error',
          id: 'gallery-fieldset',
          invalid: true,
          required: true,
        }),
        class: 'fieldset-root',
      },
      {
        'aria-describedby': 'author-fieldset-description',
        class: 'fieldset-root gap-2',
        disabled: false,
      },
    );
    const legend = mergeCompilerPrimitiveAttrs(
      {
        ...fieldsetLegendAttributes({
          id: 'gallery-fieldset-legend',
          invalid: true,
          required: true,
        }),
        class: 'fieldset-legend',
      },
      {
        class: 'fieldset-legend text-sm',
        'data-invalid': 'author-invalid',
      },
    );
    expect(root.diagnostics).toEqual([
      {
        attr: 'aria-describedby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(legend.diagnostics).toEqual([]);
    expect(
      String(
        <fieldset {...root.attrs}>
          <legend {...legend.attrs}>Shipping speed</legend>
        </fieldset>,
      ),
    ).toBe(
      '<fieldset data-disabled="" data-invalid="" data-required="" aria-describedby="author-fieldset-description" aria-invalid="true" disabled id="gallery-fieldset" class="fieldset-root gap-2"><legend data-invalid="author-invalid" data-required="" id="gallery-fieldset-legend" class="fieldset-legend text-sm">Shipping speed</legend></fieldset>',
    );
  });
});
