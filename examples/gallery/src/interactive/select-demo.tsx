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
      form: 'gallery-select-form',
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
      >
        <form id="gallery-select-form" data-gallery-form="select" />
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
          onChange={() => {
            const delegatedEvent = event;
            const target =
              delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'target');
            const nextValue =
              target === null || target === undefined
                ? state.value
                : String(Reflect['get'](Object(target), 'value'));
            const doc = Reflect['get'](globalThis, 'document');
            const select = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-select-control')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="select-value"]')
              : undefined;

            if (nextValue === 'drone' || nextValue === state.value) {
              if (select) select['value'] = state.value;
              if (delegatedEvent !== undefined) {
                Reflect['apply'](
                  Reflect['get'](delegatedEvent, 'preventDefault'),
                  delegatedEvent,
                  [],
                );
              }
              return;
            }

            state.value = nextValue === 'express' ? 'express' : 'standard';
            if (select) select['value'] = state.value;
            if (output) output['textContent'] = state.value === 'express' ? 'Express' : 'Standard';
          }}
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
