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

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/select.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const TRIGGER_CLASS =
  'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-400 data-[placeholder]:text-neutral-500';
const ITEM_CLASS = 'text-neutral-950 data-[state=checked]:font-medium disabled:text-neutral-400';
const VALUE_CLASS = 'text-sm text-neutral-700 data-[placeholder]:text-neutral-500';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

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
        class={ROOT_CLASS}
        data-gallery-interactive="select"
      >
        <form id="gallery-select-form" data-gallery-form="select" />
        <label id="gallery-select-label" for="gallery-select-control" class={LABEL_CLASS}>
          Shipping speed
        </label>
        <select
          {...selectTriggerAttributes({
            ...selectState,
            id: 'gallery-select-control',
            labelledBy: 'gallery-select-label',
          })}
          id="gallery-select-control"
          class={TRIGGER_CLASS}
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
              class={ITEM_CLASS}
            >
              {item.label ?? item.value}
            </option>
          ))}
        </select>
        <output
          {...selectValueAttributes(selectState)}
          class={VALUE_CLASS}
          data-demo-state="select-value"
        >
          {selectValueText(selectState)}
        </output>
      </section>
    );
  },
});
