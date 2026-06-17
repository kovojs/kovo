/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  selectContentAttributes,
  selectHiddenInputAttributes,
  selectItemClick as _selectItemClick,
  selectItemAttributes,
  selectKeyDown as _selectKeyDown,
  selectMove as _selectMove,
  selectRootAttributes,
  selectTriggerClick as _selectTriggerClick,
  selectTriggerAttributes,
  selectValueAttributes,
  type SelectItem,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/select.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const TRIGGER_CLASS =
  'inline-flex h-9 w-full items-center justify-between rounded-md border border-neutral-300 bg-white px-3 text-left text-sm text-neutral-950 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-400 data-[placeholder]:text-neutral-500';
const CONTENT_CLASS =
  'grid gap-1 rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-sm data-[state=closed]:hidden';
const ITEM_CLASS =
  'cursor-default rounded px-2 py-1 text-neutral-950 data-[highlighted]:bg-neutral-100 data-[state=checked]:font-medium data-[disabled]:cursor-not-allowed data-[disabled]:text-neutral-400';
const VALUE_CLASS = 'text-sm text-neutral-700 data-[placeholder]:text-neutral-500';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

export interface GallerySelectDemoState {
  highlightedValue: string;
  open: boolean;
  value: string;
}

const shippingOptions: readonly SelectItem[] = Object.freeze([
  { id: 'gallery-select-option-standard', label: 'Standard', value: 'standard' },
  { id: 'gallery-select-option-express', label: 'Express', value: 'express' },
  { disabled: true, id: 'gallery-select-option-drone', label: 'Drone', value: 'drone' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySelectDemo = component({
  state: () => ({ highlightedValue: 'standard', open: false, value: 'standard' }),
  render: (_queries: Record<string, never>, state: GallerySelectDemoState) => {
    const selectState = {
      form: 'gallery-select-form',
      highlightedValue: state.highlightedValue,
      items: shippingOptions,
      listboxId: 'gallery-select-listbox',
      name: 'gallery-shipping-speed',
      open: state.open,
      required: true,
      value: state.value,
    };

    return (
      <section
        {...selectRootAttributes({ ...selectState, id: 'gallery-select-root' })}
        class={ROOT_CLASS}
        data-gallery-interactive="select"
      >
        <form id="gallery-select-form" data-gallery-form="select" />
        <label id="gallery-select-label" for="gallery-select-trigger" class={LABEL_CLASS}>
          Shipping speed
        </label>
        <input
          {...selectHiddenInputAttributes(selectState)}
          id="gallery-select-control"
          value={state.value}
        />
        <button
          {...selectTriggerAttributes({
            ...selectState,
            id: 'gallery-select-trigger',
            labelledBy: 'gallery-select-label',
          })}
          id="gallery-select-trigger"
          class={TRIGGER_CLASS}
          aria-expanded={String(state.open)}
          data-state={state.open ? 'open' : 'closed'}
          onClick={() => {
            const result = _selectTriggerClick(Object(event), {
              highlightedValue: state.highlightedValue,
              items: [
                { label: 'Standard', value: 'standard' },
                { label: 'Express', value: 'express' },
                { disabled: true, label: 'Drone', value: 'drone' },
              ],
              open: state.open,
              value: state.value,
            });
            if (!result?.changed) return;
            state.open = result.open;
            state.highlightedValue = state.value;
          }}
          onKeyDown={() => {
            const keyResult = _selectKeyDown(Object(event), {
              highlightedValue: state.highlightedValue,
              items: [
                { label: 'Standard', value: 'standard' },
                { label: 'Express', value: 'express' },
                { disabled: true, label: 'Drone', value: 'drone' },
              ],
              open: state.open,
              value: state.value,
            });
            if (!keyResult) return;
            if ('open' in keyResult && typeof keyResult.open === 'object') {
              state.value = keyResult.value.value ?? state.value;
              state.highlightedValue = keyResult.value.value ?? state.highlightedValue;
              state.open = keyResult.open.open;
              return;
            }
            if ('open' in keyResult) {
              state.open = keyResult.open;
              if (keyResult.open) state.highlightedValue = state.value;
              return;
            }
            if ('highlightedValue' in keyResult) {
              state.highlightedValue = keyResult.highlightedValue ?? state.highlightedValue;
              return;
            }
            if ('matchIndex' in keyResult) {
              state.highlightedValue = keyResult.value ?? state.highlightedValue;
              return;
            }
          }}
        >
          <span>{state.value === 'express' ? 'Express' : 'Standard'}</span>
        </button>
        <div
          {...selectContentAttributes({
            ...selectState,
            id: 'gallery-select-listbox',
            labelledBy: 'gallery-select-label',
          })}
          class={CONTENT_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
          onKeyDown={() => {
            const move = _selectMove(
              {
                highlightedValue: state.highlightedValue,
                items: [
                  { label: 'Standard', value: 'standard' },
                  { label: 'Express', value: 'express' },
                  { disabled: true, label: 'Drone', value: 'drone' },
                ],
                open: state.open,
                value: state.value,
              },
              Object(event).key,
              { loop: true },
            );
            if (!move) return;
            state.highlightedValue = move.highlightedValue ?? state.highlightedValue;
          }}
        >
          <div
            {...selectItemAttributes({
              ...selectState,
              id: 'gallery-select-option-standard',
              itemLabel: 'Standard',
              itemValue: 'standard',
            })}
            class={ITEM_CLASS}
            aria-selected={state.value === 'standard' ? 'true' : 'false'}
            data-highlighted={state.highlightedValue === 'standard' ? '' : null}
            data-state={state.value === 'standard' ? 'checked' : 'unchecked'}
            onClick={() => {
              const result = _selectItemClick(Object(event), {
                highlightedValue: state.highlightedValue,
                items: [
                  { label: 'Standard', value: 'standard' },
                  { label: 'Express', value: 'express' },
                  { disabled: true, label: 'Drone', value: 'drone' },
                ],
                open: state.open,
                itemValue: 'standard',
                value: state.value,
              });
              if (!result?.value.changed) return;
              state.value = result.value.value ?? state.value;
              state.highlightedValue = result.value.value ?? state.highlightedValue;
              state.open = result.open.open;
            }}
          >
            Standard
          </div>
          <div
            {...selectItemAttributes({
              ...selectState,
              id: 'gallery-select-option-express',
              itemLabel: 'Express',
              itemValue: 'express',
            })}
            class={ITEM_CLASS}
            aria-selected={state.value === 'express' ? 'true' : 'false'}
            data-highlighted={state.highlightedValue === 'express' ? '' : null}
            data-state={state.value === 'express' ? 'checked' : 'unchecked'}
            onClick={() => {
              const result = _selectItemClick(Object(event), {
                highlightedValue: state.highlightedValue,
                items: [
                  { label: 'Standard', value: 'standard' },
                  { label: 'Express', value: 'express' },
                  { disabled: true, label: 'Drone', value: 'drone' },
                ],
                open: state.open,
                itemValue: 'express',
                value: state.value,
              });
              if (!result?.value.changed) return;
              state.value = result.value.value ?? state.value;
              state.highlightedValue = result.value.value ?? state.highlightedValue;
              state.open = result.open.open;
            }}
          >
            Express
          </div>
          <div
            {...selectItemAttributes({
              ...selectState,
              id: 'gallery-select-option-drone',
              itemDisabled: true,
              itemLabel: 'Drone',
              itemValue: 'drone',
            })}
            class={ITEM_CLASS}
            aria-selected={state.value === 'drone' ? 'true' : 'false'}
            data-highlighted={state.highlightedValue === 'drone' ? '' : null}
            data-state={state.value === 'drone' ? 'checked' : 'unchecked'}
            onClick={() => {
              const result = _selectItemClick(Object(event), {
                highlightedValue: state.highlightedValue,
                items: [
                  { label: 'Standard', value: 'standard' },
                  { label: 'Express', value: 'express' },
                  { disabled: true, label: 'Drone', value: 'drone' },
                ],
                open: state.open,
                itemDisabled: true,
                itemValue: 'drone',
                value: state.value,
              });
              if (!result?.value.changed) return;
              state.value = result.value.value ?? state.value;
              state.highlightedValue = result.value.value ?? state.highlightedValue;
              state.open = result.open.open;
            }}
          >
            Drone
          </div>
        </div>
        <output
          {...selectValueAttributes(selectState)}
          class={VALUE_CLASS}
          data-demo-state="select-value"
        >
          {state.value === 'express' ? 'Express' : 'Standard'}
        </output>
      </section>
    );
  },
});
