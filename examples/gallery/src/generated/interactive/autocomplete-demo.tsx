// @jiso-ir - lowered from examples/gallery/src/interactive/autocomplete-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  autocompleteInputAttributes,
  autocompleteListAttributes,
  autocompleteOptionAttributes,
  autocompleteRootAttributes,
  autocompleteValueAttributes,
  autocompleteValueText,
  type AutocompleteItem,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/autocomplete.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const INPUT_CLASS =
  'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-400 data-[placeholder]:text-neutral-500';
const LIST_CLASS =
  'rounded-md border border-neutral-200 bg-white text-sm text-neutral-950 shadow-sm';
const OPTION_CLASS =
  'text-neutral-950 data-[highlighted]:font-medium data-[state=checked]:font-medium disabled:text-neutral-400';
const VALUE_CLASS = 'text-sm text-neutral-700 data-[placeholder]:text-neutral-500';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

export interface GalleryAutocompleteDemoState {
  highlightedValue: string;
  inputValue: string;
  open: boolean;
  value: string;
}

const tagOptions: readonly AutocompleteItem[] = Object.freeze([
  { label: 'Design', value: 'design' },
  { disabled: true, label: 'Deprecated', value: 'deprecated' },
  { textValue: 'Development', value: 'development' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryAutocompleteDemo = component('gallery-autocomplete-demo', {
  state: () => ({ highlightedValue: 'design', inputValue: 'de', open: false, value: 'design' }),
  render: (_queries: Record<string, never>, state: GalleryAutocompleteDemoState) => {
    const listId = 'gallery-autocomplete-list';
    const autocompleteState = {
      form: 'gallery-autocomplete-form',
      highlightedValue: state.highlightedValue,
      inputValue: state.inputValue,
      items: tagOptions,
      listId,
      name: 'gallery-tag',
      open: state.open,
      placeholder: 'Choose tag',
      required: true,
      value: state.value,
    };

    return (
      <section
        {...autocompleteRootAttributes({
          ...autocompleteState,
          id: 'gallery-autocomplete-root',
        })}
        class={ROOT_CLASS}
        data-gallery-interactive="autocomplete"
        fw-c="gallery-autocomplete-demo"
        fw-state='{"highlightedValue":"design","inputValue":"de","open":false,"value":"design"}'
      >
        <label id="gallery-autocomplete-label" for="gallery-autocomplete-input" class={LABEL_CLASS}>
          Tag
        </label>
        <form id="gallery-autocomplete-form" data-gallery-form="autocomplete" />
        <input
          {...autocompleteInputAttributes({
            ...autocompleteState,
            id: 'gallery-autocomplete-input',
            labelledBy: 'gallery-autocomplete-label',
          })}
          id="gallery-autocomplete-input"
          class={INPUT_CLASS}
          on:input="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=fdcc3c5d#GalleryAutocompleteDemo$input_input"
          on:keydown="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=fdcc3c5d#GalleryAutocompleteDemo$input_keydown"
        />
        <datalist
          {...autocompleteListAttributes({
            ...autocompleteState,
            id: listId,
            labelledBy: 'gallery-autocomplete-label',
          })}
          class={LIST_CLASS}
        >
          <option
            {...autocompleteOptionAttributes({
              ...autocompleteState,
              id: 'gallery-autocomplete-list-option-0',
              itemValue: 'development',
            })}
            class={OPTION_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=fdcc3c5d#GalleryAutocompleteDemo$option_click"
          >
            Development
          </option>
        </datalist>
        <output
          {...autocompleteValueAttributes(autocompleteState)}
          class={VALUE_CLASS}
          data-demo-state="autocomplete-value"
        >
          {autocompleteValueText(autocompleteState)}
        </output>
      </section>
    );
  },
});
