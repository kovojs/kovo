/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  comboboxFilteredItems as _comboboxFilteredItems,
  comboboxInput as _comboboxInput,
  comboboxInputAttributes,
  comboboxKeyDown as _comboboxKeyDown,
  comboboxListboxAttributes,
  comboboxOptionAttributes,
  comboboxOptionClick as _comboboxOptionClick,
  comboboxRootAttributes,
  comboboxValueAttributes,
  type ComboboxItem,
} from '@kovojs/headless-ui/combobox';
import {
  comboboxClasses,
  comboboxInputClasses,
  comboboxListboxClasses,
  comboboxOptionClasses,
  comboboxValueClasses,
} from '@kovojs/ui/combobox';

const ROOT_CLASS = comboboxClasses.join(' ');
const INPUT_CLASS = comboboxInputClasses.join(' ');
const LISTBOX_CLASS = comboboxListboxClasses.join(' ');
const OPTION_CLASS = comboboxOptionClasses.join(' ');
const VALUE_CLASS = comboboxValueClasses.join(' ');
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

export interface GalleryComboboxDemoState {
  highlightedValue: string;
  inputValue: string;
  open: boolean;
  value: string;
}

const cityOptions: readonly ComboboxItem[] = Object.freeze([
  { id: 'gallery-combobox-listbox-option-0', label: 'Austin', value: 'austin' },
  { disabled: true, id: 'gallery-combobox-listbox-option-1', label: 'Boston', value: 'boston' },
  { id: 'gallery-combobox-listbox-option-2', textValue: 'Chicago city', value: 'chicago' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryComboboxDemo = component({
  state: () => ({ highlightedValue: 'austin', inputValue: 'austin', open: false, value: 'austin' }),
  render: (_queries: Record<string, never>, state: GalleryComboboxDemoState) => {
    const listboxId = 'gallery-combobox-listbox';
    const inputState = {
      form: 'gallery-combobox-form',
      highlightedValue: state.highlightedValue,
      items: cityOptions,
      listboxId,
      name: 'gallery-city',
      open: state.open,
      placeholder: 'Choose city',
      required: true,
      value: state.inputValue,
    };
    const selectedState = {
      ...inputState,
      value: state.value,
    };

    return (
      <section
        {...comboboxRootAttributes({ ...inputState, id: 'gallery-combobox-root' })}
        class={ROOT_CLASS}
        data-gallery-interactive="combobox"
        data-state={state.open ? 'open' : 'closed'}
      >
        <label id="gallery-combobox-label" for="gallery-combobox-input" class={LABEL_CLASS}>
          City
        </label>
        <form id="gallery-combobox-form" data-gallery-form="combobox" />
        <input
          {...comboboxInputAttributes({
            ...inputState,
            id: 'gallery-combobox-input',
            labelledBy: 'gallery-combobox-label',
          })}
          id="gallery-combobox-input"
          aria-activedescendant={
            state.highlightedValue === 'chicago'
              ? 'gallery-combobox-listbox-option-2'
              : state.highlightedValue === 'boston'
                ? 'gallery-combobox-listbox-option-1'
                : state.highlightedValue === 'austin'
                  ? 'gallery-combobox-listbox-option-0'
                  : null
          }
          aria-expanded={state.open ? 'true' : 'false'}
          class={INPUT_CLASS}
          data-placeholder={state.inputValue === '' ? '' : null}
          data-state={state.open ? 'open' : 'closed'}
          value={state.inputValue}
          onInput={() => {
            const result = _comboboxInput(Object(event), { value: state.inputValue });
            if (!result) return;
            state.inputValue = result.value ?? '';
            state.open = true;
            const filteredItems = _comboboxFilteredItems({
              items: [
                {
                  id: 'gallery-combobox-listbox-option-0',
                  label: 'Austin',
                  value: 'austin',
                },
                {
                  disabled: true,
                  id: 'gallery-combobox-listbox-option-1',
                  label: 'Boston',
                  value: 'boston',
                },
                {
                  id: 'gallery-combobox-listbox-option-2',
                  textValue: 'Chicago city',
                  value: 'chicago',
                },
              ],
              value: state.inputValue,
            });
            state.highlightedValue =
              filteredItems[0]?.disabled === true ? '' : (filteredItems[0]?.value ?? '');
          }}
          onKeyDown={() => {
            const result = _comboboxKeyDown(Object(event), {
              highlightedValue: state.highlightedValue,
              items: _comboboxFilteredItems({
                items: [
                  {
                    id: 'gallery-combobox-listbox-option-0',
                    label: 'Austin',
                    value: 'austin',
                  },
                  {
                    disabled: true,
                    id: 'gallery-combobox-listbox-option-1',
                    label: 'Boston',
                    value: 'boston',
                  },
                  {
                    id: 'gallery-combobox-listbox-option-2',
                    textValue: 'Chicago city',
                    value: 'chicago',
                  },
                ],
                value: state.inputValue,
              }),
              open: state.open,
              value: state.value,
            });
            if (!result) return;

            if ('value' in result) {
              if (result.value.changed) {
                state.open = result.open.open;
                state.value = result.value.value ?? state.value;
                state.inputValue = state.value;
                state.highlightedValue = state.value;
              }
            } else if ('highlightedValue' in result) {
              state.highlightedValue = result.highlightedValue ?? '';
            } else {
              state.open = result.open;
              if (Object(event)['key'] === 'Escape') {
                state.inputValue = state.value;
                state.highlightedValue = state.value;
              }
            }
          }}
        />
        <div
          {...comboboxListboxAttributes({
            ...inputState,
            id: listboxId,
            labelledBy: 'gallery-combobox-label',
          })}
          class={LISTBOX_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
        >
          <button
            {...comboboxOptionAttributes({
              ...selectedState,
              id: 'gallery-combobox-listbox-option-0',
              itemLabel: 'Austin',
              itemValue: 'austin',
            })}
            aria-selected={state.value === 'austin' ? 'true' : 'false'}
            class={OPTION_CLASS}
            data-highlighted={state.highlightedValue === 'austin' ? '' : null}
            data-state={state.value === 'austin' ? 'checked' : 'unchecked'}
            hidden={
              state.inputValue !== '' &&
              !'austin austin'.includes(state.inputValue.toLocaleLowerCase())
            }
            onClick={() => {
              const result = _comboboxOptionClick(Object(event), {
                highlightedValue: state.highlightedValue,
                items: [
                  {
                    id: 'gallery-combobox-listbox-option-0',
                    label: 'Austin',
                    value: 'austin',
                  },
                  {
                    disabled: true,
                    id: 'gallery-combobox-listbox-option-1',
                    label: 'Boston',
                    value: 'boston',
                  },
                  {
                    id: 'gallery-combobox-listbox-option-2',
                    textValue: 'Chicago city',
                    value: 'chicago',
                  },
                ],
                itemValue: 'austin',
                open: state.open,
                value: state.value,
              });
              if (!result) return;
              if (result.value.changed) {
                state.open = result.open.open;
                state.value = result.value.value ?? state.value;
                state.inputValue = state.value;
                state.highlightedValue = state.value;
              }
            }}
            tabIndex={state.highlightedValue === 'austin' ? 0 : -1}
          >
            Austin
          </button>
          <button
            {...comboboxOptionAttributes({
              ...selectedState,
              id: 'gallery-combobox-listbox-option-1',
              itemDisabled: true,
              itemLabel: 'Boston',
              itemValue: 'boston',
            })}
            aria-selected={state.value === 'boston' ? 'true' : 'false'}
            class={OPTION_CLASS}
            data-highlighted={state.highlightedValue === 'boston' ? '' : null}
            data-state={state.value === 'boston' ? 'checked' : 'unchecked'}
            hidden={
              state.inputValue !== '' &&
              !'boston boston'.includes(state.inputValue.toLocaleLowerCase())
            }
            tabIndex={-1}
          >
            Boston
          </button>
          <button
            {...comboboxOptionAttributes({
              ...selectedState,
              id: 'gallery-combobox-listbox-option-2',
              itemValue: 'chicago',
            })}
            aria-selected={state.value === 'chicago' ? 'true' : 'false'}
            class={OPTION_CLASS}
            data-highlighted={state.highlightedValue === 'chicago' ? '' : null}
            data-state={state.value === 'chicago' ? 'checked' : 'unchecked'}
            hidden={
              state.inputValue !== '' &&
              !'chicago city chicago'.includes(state.inputValue.toLocaleLowerCase())
            }
            onClick={() => {
              const result = _comboboxOptionClick(Object(event), {
                highlightedValue: state.highlightedValue,
                items: [
                  {
                    id: 'gallery-combobox-listbox-option-0',
                    label: 'Austin',
                    value: 'austin',
                  },
                  {
                    disabled: true,
                    id: 'gallery-combobox-listbox-option-1',
                    label: 'Boston',
                    value: 'boston',
                  },
                  {
                    id: 'gallery-combobox-listbox-option-2',
                    textValue: 'Chicago city',
                    value: 'chicago',
                  },
                ],
                itemValue: 'chicago',
                open: state.open,
                value: state.value,
              });
              if (!result) return;
              if (result.value.changed) {
                state.open = result.open.open;
                state.value = result.value.value ?? state.value;
                state.inputValue = state.value;
                state.highlightedValue = state.value;
              }
            }}
            tabIndex={state.highlightedValue === 'chicago' ? 0 : -1}
          >
            Chicago city
          </button>
        </div>
        <output
          {...comboboxValueAttributes(selectedState)}
          class={VALUE_CLASS}
          data-demo-state="combobox-value"
        >
          {state.value === 'chicago' ? 'Chicago city' : 'Austin'}
        </output>
      </section>
    );
  },
});
