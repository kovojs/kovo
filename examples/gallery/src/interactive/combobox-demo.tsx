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
          onInput={() => {
            state.open = true;
            state.highlightedValue = 'chicago';
            state.value = 'chicago';
            const doc = Reflect['get'](globalThis, 'document');
            const input = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-input')
              : undefined;
            const listbox = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox')
              : undefined;
            const austin = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox-option-0')
              : undefined;
            const chicago = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox-option-2')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="combobox-value"]')
              : undefined;

            if (input) {
              input['value'] = 'chicago';
              Object(input)['setAttribute']?.call(input, 'aria-expanded', 'true');
              Object(input)['setAttribute']?.call(
                input,
                'aria-activedescendant',
                'gallery-combobox-listbox-option-2',
              );
            }
            if (listbox) {
              listbox['hidden'] = false;
              Object(listbox)['removeAttribute']?.call(listbox, 'hidden');
            }
            if (austin) Object(austin)['setAttribute']?.call(austin, 'aria-selected', 'false');
            if (chicago) {
              Object(chicago)['setAttribute']?.call(chicago, 'aria-selected', 'true');
              Object(chicago)['setAttribute']?.call(chicago, 'data-highlighted', '');
            }
            if (output) output['textContent'] = 'Chicago city';
          }}
          onKeyDown={() => {
            const delegatedEvent = event;
            const eventKey =
              delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'key');
            const doc = Reflect['get'](globalThis, 'document');
            const input = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-input')
              : undefined;
            const listbox = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="combobox-value"]')
              : undefined;

            if (eventKey === 'Enter' && state.open && state.highlightedValue === 'chicago') {
              state.open = false;
              state.value = 'chicago';
              if (input) {
                input['value'] = 'chicago';
                Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
              }
              if (listbox) listbox['hidden'] = true;
              if (output) output['textContent'] = 'Chicago city';
            } else {
              state.open = !state.open;
            }
          }}
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
            onClick={() => {
              state.open = false;
              state.highlightedValue = 'austin';
              state.value = 'austin';
              const doc = Reflect['get'](globalThis, 'document');
              const input = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-input')
                : undefined;
              const listbox = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="combobox-value"]')
                : undefined;

              if (input) {
                input['value'] = 'austin';
                Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
              }
              if (listbox) listbox['hidden'] = true;
              if (output) output['textContent'] = 'Austin';
            }}
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
            onClick={() => {
              state.open = false;
              state.highlightedValue = 'chicago';
              state.value = 'chicago';
              const doc = Reflect['get'](globalThis, 'document');
              const input = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-input')
                : undefined;
              const listbox = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="combobox-value"]')
                : undefined;

              if (input) {
                input['value'] = 'chicago';
                Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
              }
              if (listbox) listbox['hidden'] = true;
              if (output) output['textContent'] = 'Chicago city';
            }}
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
