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

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/combobox.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const INPUT_CLASS =
  'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-400 data-[placeholder]:text-neutral-500';
const LISTBOX_CLASS =
  'max-h-56 overflow-auto rounded-md border border-neutral-200 bg-white p-1 shadow-sm data-[state=closed]:hidden';
const OPTION_CLASS =
  'rounded px-2 py-1.5 text-sm text-neutral-700 data-[highlighted]:bg-neutral-100 data-[state=checked]:font-medium data-[state=checked]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const VALUE_CLASS = 'text-sm text-neutral-700 data-[placeholder]:text-neutral-500';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

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
      form: 'gallery-combobox-form',
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
        class={ROOT_CLASS}
        data-gallery-interactive="combobox"
        fw-c="gallery-combobox-demo"
        fw-state='{"highlightedValue":"austin","open":false,"value":"austin"}'
      >
        <label id="gallery-combobox-label" for="gallery-combobox-input" class={LABEL_CLASS}>
          City
        </label>
        <form id="gallery-combobox-form" data-gallery-form="combobox" />
        <input
          {...comboboxInputAttributes({
            ...comboboxState,
            id: 'gallery-combobox-input',
            labelledBy: 'gallery-combobox-label',
          })}
          id="gallery-combobox-input"
          class={INPUT_CLASS}
          on:input="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=5a3cc515#GalleryComboboxDemo$input_input"
          on:keydown="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=5a3cc515#GalleryComboboxDemo$input_keydown"
        />
        <div
          {...comboboxListboxAttributes({
            ...comboboxState,
            id: listboxId,
            labelledBy: 'gallery-combobox-label',
          })}
          class={LISTBOX_CLASS}
        >
          <button
            {...comboboxOptionAttributes({
              ...comboboxState,
              id: 'gallery-combobox-listbox-option-0',
              itemLabel: 'Austin',
              itemValue: 'austin',
            })}
            class={OPTION_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=5a3cc515#GalleryComboboxDemo$button_click"
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
            class={OPTION_CLASS}
          >
            Boston
          </button>
          <button
            {...comboboxOptionAttributes({
              ...comboboxState,
              id: 'gallery-combobox-listbox-option-2',
              itemValue: 'chicago',
            })}
            class={OPTION_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=5a3cc515#GalleryComboboxDemo$button_click_2"
          >
            Chicago city
          </button>
        </div>
        <output
          {...comboboxValueAttributes(comboboxState)}
          class={VALUE_CLASS}
          data-demo-state="combobox-value"
        >
          {comboboxValueText(comboboxState)}
        </output>
      </section>
    );
  },
});
