/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import type { SelectItem as GallerySelectItem } from '@kovojs/headless-ui/select';
import {
  Select,
  SelectContent,
  SelectHiddenInput,
  selectItemClick as _selectItemClick,
  SelectItem,
  selectKeyDown as _selectKeyDown,
  selectMove as _selectMove,
  SelectTrigger,
  selectTriggerClick as _selectTriggerClick,
  SelectValue,
} from '@kovojs/ui/select';

const LABEL_STYLE = 'font-size:0.875rem;font-weight:500;line-height:1;color:#171717';

export interface GallerySelectDemoState {
  highlightedValue: string;
  open: boolean;
  value: string;
}

const shippingOptions: readonly GallerySelectItem[] = Object.freeze([
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
      <Select {...selectState} data-gallery-interactive="select" id="gallery-select-root">
        <form id="gallery-select-form" data-gallery-form="select" />
        <label id="gallery-select-label" for="gallery-select-trigger" style={LABEL_STYLE}>
          Shipping speed
        </label>
        <SelectHiddenInput {...selectState} id="gallery-select-control" value={state.value} />
        <SelectTrigger
          {...selectState}
          aria-expanded={String(state.open)}
          data-state={state.open ? 'open' : 'closed'}
          id="gallery-select-trigger"
          labelledBy="gallery-select-label"
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
        </SelectTrigger>
        <SelectContent
          {...selectState}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
          id="gallery-select-listbox"
          labelledBy="gallery-select-label"
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
          <SelectItem
            {...selectState}
            aria-selected={state.value === 'standard' ? 'true' : 'false'}
            data-highlighted={state.highlightedValue === 'standard' ? '' : null}
            data-state={state.value === 'standard' ? 'checked' : 'unchecked'}
            id="gallery-select-option-standard"
            itemLabel="Standard"
            itemValue="standard"
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
          </SelectItem>
          <SelectItem
            {...selectState}
            aria-selected={state.value === 'express' ? 'true' : 'false'}
            data-highlighted={state.highlightedValue === 'express' ? '' : null}
            data-state={state.value === 'express' ? 'checked' : 'unchecked'}
            id="gallery-select-option-express"
            itemLabel="Express"
            itemValue="express"
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
          </SelectItem>
          <SelectItem
            {...selectState}
            aria-selected={state.value === 'drone' ? 'true' : 'false'}
            data-highlighted={state.highlightedValue === 'drone' ? '' : null}
            data-state={state.value === 'drone' ? 'checked' : 'unchecked'}
            id="gallery-select-option-drone"
            itemDisabled={true}
            itemLabel="Drone"
            itemValue="drone"
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
          </SelectItem>
        </SelectContent>
        <SelectValue {...selectState} data-demo-state="select-value" />
      </Select>
    );
  },
});
