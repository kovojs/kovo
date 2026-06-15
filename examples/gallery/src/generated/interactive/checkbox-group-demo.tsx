// @jiso-ir - lowered from examples/gallery/src/interactive/checkbox-group-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryCheckboxGroupDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.value || 'none',
);

import { component } from '@jiso/core';
import {
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupLabelAttributes,
  checkboxGroupRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/checkbox-group.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[orientation=horizontal]:flex data-[orientation=horizontal]:flex-wrap data-[orientation=horizontal]:items-center data-[invalid]:text-red-950';
const ITEM_CLASS =
  'inline-flex items-center gap-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const CONTROL_CLASS =
  'h-4 w-4 rounded border border-neutral-300 text-neutral-950 accent-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';
const LABEL_CLASS = 'select-none leading-none data-[disabled]:cursor-not-allowed';

export interface GalleryCheckboxGroupDemoState {
  activeValue: string;
  value: string;
}

const checkboxItems = Object.freeze([{ value: 'updates' }, { value: 'billing' }]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryCheckboxGroupDemo = component('gallery-checkbox-group-demo', {
  state: () => ({ activeValue: 'updates', value: 'updates' }),
  render: (_queries: Record<string, never>, state: GalleryCheckboxGroupDemoState) => {
    const selectedValues =
      state.value === 'updates,billing'
        ? ['updates', 'billing']
        : state.value === ''
          ? []
          : [state.value];
    const groupState = {
      activeValue: state.activeValue,
      form: 'gallery-checkbox-group-form',
      items: checkboxItems,
      name: 'gallery-notifications',
      value: selectedValues,
    };
    const updatesState = { ...groupState, itemValue: 'updates' };
    const billingState = { ...groupState, itemValue: 'billing' };

    return (
      <section
        {...checkboxGroupRootAttributes({
          ...groupState,
          labelledBy: 'gallery-checkbox-group-label',
        })}
        class={ROOT_CLASS}
        data-gallery-interactive="checkbox-group"
        on:keydown="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=8e8ca5ed#GalleryCheckboxGroupDemo$section_keydown"
        fw-c="gallery-checkbox-group-demo"
        fw-state='{"activeValue":"updates","value":"updates"}'
      >
        <form id="gallery-checkbox-group-form" data-gallery-form="checkbox-group" />
        <h3 id="gallery-checkbox-group-label" class="text-sm font-medium">
          Notifications
        </h3>
        <div {...checkboxGroupItemAttributes(updatesState)} class={ITEM_CLASS}>
          <input
            {...checkboxGroupControlAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
            class={CONTROL_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=8e8ca5ed#GalleryCheckboxGroupDemo$input_click"
          />
          <label
            {...checkboxGroupLabelAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
            class={LABEL_CLASS}
          >
            Product updates
          </label>
        </div>
        <div {...checkboxGroupItemAttributes(billingState)} class={ITEM_CLASS}>
          <input
            {...checkboxGroupControlAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
            class={CONTROL_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=8e8ca5ed#GalleryCheckboxGroupDemo$input_click_2"
          />
          <label
            {...checkboxGroupLabelAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
            class={LABEL_CLASS}
          >
            Billing notices
          </label>
        </div>
        <output
          class="text-xs text-neutral-500"
          data-demo-state="checkbox-group-value"
          data-bind="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=8e8ca5ed#GalleryCheckboxGroupDemo$output_text_derive"
        >
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
