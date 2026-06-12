// @jiso-ir - lowered from examples/gallery/src/interactive/combobox-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  comboboxInputAttributes,
  comboboxListboxAttributes,
  comboboxOptionAttributes,
  comboboxRootAttributes,
  comboboxValueAttributes,
  comboboxValueText,
  type ComboboxItem,
} from '@jiso/headless-ui/primitives';

export interface GalleryComboboxDemoState {
  highlightedValue: string;
  open: boolean;
  value: string;
}

const cityOptions: readonly ComboboxItem[] = Object.freeze([
  { label: 'Austin', value: 'austin' },
  { disabled: true, label: 'Boston', value: 'boston' },
  { textValue: 'Chicago city', value: 'chicago' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryComboboxDemo = component('gallery-combobox-demo', {
  state: () => ({ highlightedValue: 'austin', open: false, value: 'austin' }),
  render: (_queries: Record<string, never>, state: GalleryComboboxDemoState) => {
    const listboxId = 'gallery-combobox-listbox';
    const comboboxState = {
      highlightedValue: state.highlightedValue,
      items: cityOptions,
      listboxId,
      name: 'gallery-city',
      open: state.open,
      placeholder: 'Choose city',
      required: true,
      value: state.value,
    };

    return (
      <section
        {...comboboxRootAttributes({ ...comboboxState, id: 'gallery-combobox-root' })}
        class="grid gap-2"
        data-gallery-interactive="combobox"
        fw-c="gallery-combobox-demo"
        fw-state='{"highlightedValue":"austin","open":false,"value":"austin"}'
      >
        <label id="gallery-combobox-label" for="gallery-combobox-input">
          City
        </label>
        <input
          {...comboboxInputAttributes({
            ...comboboxState,
            id: 'gallery-combobox-input',
            labelledBy: 'gallery-combobox-label',
          })}
          id="gallery-combobox-input"
          on:input="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=053f7fa5#GalleryComboboxDemo$input_input"
          on:keydown="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=053f7fa5#GalleryComboboxDemo$input_keydown"
        />
        <div
          {...comboboxListboxAttributes({
            ...comboboxState,
            id: listboxId,
            labelledBy: 'gallery-combobox-label',
          })}
        >
          <button
            {...comboboxOptionAttributes({
              ...comboboxState,
              id: 'gallery-combobox-listbox-option-0',
              itemLabel: 'Austin',
              itemValue: 'austin',
            })}
            on:click="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=053f7fa5#GalleryComboboxDemo$button_click"
          >
            Austin
          </button>
          <button
            {...comboboxOptionAttributes({
              ...comboboxState,
              id: 'gallery-combobox-listbox-option-1',
              itemDisabled: true,
              itemLabel: 'Boston',
              itemValue: 'boston',
            })}
          >
            Boston
          </button>
          <button
            {...comboboxOptionAttributes({
              ...comboboxState,
              id: 'gallery-combobox-listbox-option-2',
              itemValue: 'chicago',
            })}
            on:click="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=053f7fa5#GalleryComboboxDemo$button_click_2"
          >
            Chicago city
          </button>
        </div>
        <output {...comboboxValueAttributes(comboboxState)} data-demo-state="combobox-value">
          {comboboxValueText(comboboxState)}
        </output>
      </section>
    );
  },
});
