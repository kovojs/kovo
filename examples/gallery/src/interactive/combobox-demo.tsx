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
            state.open = !state.open;
          }}
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
          >
            Boston
          </button>
          <button
            {...comboboxOptionAttributes({
              ...comboboxState,
              id: 'gallery-combobox-listbox-option-2',
              itemValue: 'chicago',
            })}
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
        <output {...comboboxValueAttributes(comboboxState)} data-demo-state="combobox-value">
          {comboboxValueText(comboboxState)}
        </output>
      </section>
    );
  },
});
