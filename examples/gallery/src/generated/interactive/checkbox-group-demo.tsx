// @kovojs-ir - lowered from examples/gallery/src/interactive/checkbox-group-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryCheckboxGroupDemo$input_aria_checked_derive = derive(['state'], (state: any) =>
  state.value === 'updates,billing' ? 'true' : state.value === '' ? 'false' : 'mixed',
);
export const GalleryCheckboxGroupDemo$input_checked_derive = derive(['state'], (state: any) =>
  state.value === 'updates,billing' ? '' : null,
);
export const GalleryCheckboxGroupDemo$input_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'updates,billing'
    ? 'checked'
    : state.value === ''
      ? 'unchecked'
      : 'indeterminate',
);
export const GalleryCheckboxGroupDemo$input_indeterminate_derive = derive(
  ['state'],
  (state: any) => state.value !== '' && state.value !== 'updates,billing',
);
export const GalleryCheckboxGroupDemo$input_aria_checked_derive_2 = derive(
  ['state'],
  (state: any) => String(state.value === 'updates' || state.value === 'updates,billing'),
);
export const GalleryCheckboxGroupDemo$input_checked_derive_2 = derive(['state'], (state: any) =>
  state.value === 'updates' || state.value === 'updates,billing' ? '' : null,
);
export const GalleryCheckboxGroupDemo$input_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'updates' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$label_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'updates' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$input_aria_checked_derive_3 = derive(
  ['state'],
  (state: any) => String(state.value === 'billing' || state.value === 'updates,billing'),
);
export const GalleryCheckboxGroupDemo$input_checked_derive_3 = derive(['state'], (state: any) =>
  state.value === 'billing' || state.value === 'updates,billing' ? '' : null,
);
export const GalleryCheckboxGroupDemo$input_data_state_derive_3 = derive(['state'], (state: any) =>
  state.value === 'billing' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$label_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'billing' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.value || 'none',
);

import { component } from '@kovojs/core';
import {
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupLabelAttributes,
  checkboxGroupRootAttributes,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/checkbox-group.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
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
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryCheckboxGroupDemo = component({
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
        kovo-c="gallery-checkbox-group-demo"
        kovo-state='{"activeValue":"updates","value":"updates"}'
      >
        <form id="gallery-checkbox-group-form" data-gallery-form="checkbox-group" />
        <h3 id="gallery-checkbox-group-label" class="text-sm font-medium">
          Notifications
        </h3>
        <label class={ITEM_CLASS}>
          <input
            class={CONTROL_CLASS}
            id="gallery-checkbox-group-all"
            on:click="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_click"
            type="checkbox"
            aria-checked={
              state.value === 'updates,billing' ? 'true' : state.value === '' ? 'false' : 'mixed'
            }
            data-bind:aria-checked="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_aria_checked_derive"
            checked={state.value === 'updates,billing'}
            data-bind:checked="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_checked_derive"
            data-state={
              state.value === 'updates,billing'
                ? 'checked'
                : state.value === ''
                  ? 'unchecked'
                  : 'indeterminate'
            }
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_data_state_derive"
            indeterminate={state.value !== '' && state.value !== 'updates,billing'}
            data-bind:indeterminate="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_indeterminate_derive"
          />
          <span class={LABEL_CLASS}>All notifications</span>
        </label>
        <div {...checkboxGroupItemAttributes(updatesState)} class={ITEM_CLASS}>
          <input
            class={CONTROL_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_click_2"
            tabIndex={0}
            {...checkboxGroupControlAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
            aria-checked={String(state.value === 'updates' || state.value === 'updates,billing')}
            data-bind:aria-checked="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_aria_checked_derive_2"
            checked={state.value === 'updates' || state.value === 'updates,billing'}
            data-bind:checked="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_checked_derive_2"
            data-state={
              state.value === 'updates' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_data_state_derive_2"
          />
          <label
            class={LABEL_CLASS}
            {...checkboxGroupLabelAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
            data-state={
              state.value === 'updates' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$label_data_state_derive"
          >
            Product updates
          </label>
        </div>
        <div {...checkboxGroupItemAttributes(billingState)} class={ITEM_CLASS}>
          <input
            class={CONTROL_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_click_3"
            tabIndex={0}
            {...checkboxGroupControlAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
            aria-checked={String(state.value === 'billing' || state.value === 'updates,billing')}
            data-bind:aria-checked="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_aria_checked_derive_3"
            checked={state.value === 'billing' || state.value === 'updates,billing'}
            data-bind:checked="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_checked_derive_3"
            data-state={
              state.value === 'billing' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$input_data_state_derive_3"
          />
          <label
            class={LABEL_CLASS}
            {...checkboxGroupLabelAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
            data-state={
              state.value === 'billing' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$label_data_state_derive_2"
          >
            Billing notices
          </label>
        </div>
        <output
          class="text-xs text-neutral-500"
          data-demo-state="checkbox-group-value"
          data-bind="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=b5406814#GalleryCheckboxGroupDemo$output_text_derive"
        >
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
GalleryCheckboxGroupDemo.name =
  'generated/interactive/checkbox-group-demo/gallery-checkbox-group-demo';
