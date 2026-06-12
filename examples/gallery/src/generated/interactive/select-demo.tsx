// @jiso-ir - lowered from examples/gallery/src/interactive/select-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  selectItemAttributes,
  selectRootAttributes,
  selectTriggerAttributes,
  selectValueAttributes,
  selectValueText,
  type SelectItem,
} from '@jiso/headless-ui/primitives';

export interface GallerySelectDemoState {
  value: string;
}

const shippingOptions: readonly SelectItem[] = Object.freeze([
  { label: 'Standard', value: 'standard' },
  { label: 'Express', value: 'express' },
  { disabled: true, label: 'Drone', value: 'drone' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GallerySelectDemo = component('gallery-select-demo', {
  state: () => ({ value: 'standard' }),
  render: (_queries: Record<string, never>, state: GallerySelectDemoState) => {
    const selectState = {
      items: shippingOptions,
      name: 'gallery-shipping-speed',
      open: false,
      required: true,
      value: state.value,
    };

    return (
      <section
        {...selectRootAttributes({ ...selectState, id: 'gallery-select-root' })}
        class="grid gap-2"
        data-gallery-interactive="select"
        fw-c="gallery-select-demo"
        fw-state='{"value":"standard"}'
      >
        <label id="gallery-select-label" for="gallery-select-control">
          Shipping speed
        </label>
        <select
          {...selectTriggerAttributes({
            ...selectState,
            id: 'gallery-select-control',
            labelledBy: 'gallery-select-label',
          })}
          id="gallery-select-control"
          on:change="/c/examples/gallery/src/generated/interactive/select-demo.client.js?v=ec6579eb#GallerySelectDemo$select_change"
        >
          {shippingOptions.map((item) => (
            <option
              {...selectItemAttributes({
                ...selectState,
                itemDisabled: item.disabled === true,
                itemLabel: item.label ?? item.value,
                itemValue: item.value,
              })}
            >
              {item.label ?? item.value}
            </option>
          ))}
        </select>
        <output {...selectValueAttributes(selectState)} data-demo-state="select-value">
          {selectValueText(selectState)}
        </output>
      </section>
    );
  },
});
