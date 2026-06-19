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
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_aria_checked_derive = derive(
  ['state'],
  (state: any) => String(state.value === 'updates' || state.value === 'updates,billing'),
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_checked_derive = derive(
  ['state'],
  (state: any) => (state.value === 'updates' || state.value === 'updates,billing' ? '' : null),
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_data_state_derive = derive(
  ['state'],
  (state: any) =>
    state.value === 'updates' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$CheckboxGroupLabel_data_state_derive = derive(
  ['state'],
  (state: any) =>
    state.value === 'updates' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_aria_checked_derive_2 = derive(
  ['state'],
  (state: any) => String(state.value === 'billing' || state.value === 'updates,billing'),
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_checked_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'billing' || state.value === 'updates,billing' ? '' : null),
);
export const GalleryCheckboxGroupDemo$CheckboxGroupControl_data_state_derive_2 = derive(
  ['state'],
  (state: any) =>
    state.value === 'billing' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$CheckboxGroupLabel_data_state_derive_2 = derive(
  ['state'],
  (state: any) =>
    state.value === 'billing' || state.value === 'updates,billing' ? 'checked' : 'unchecked',
);
export const GalleryCheckboxGroupDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.value || 'none',
);

import { component } from '@kovojs/core';
import {
  CheckboxGroup,
  CheckboxGroupControl,
  CheckboxGroupItem,
  CheckboxGroupLabel,
} from '@kovojs/ui/checkbox-group';

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
      <CheckboxGroup
        {...groupState}
        data-gallery-interactive="checkbox-group"
        labelledBy="gallery-checkbox-group-label"
        kovo-state='{"activeValue":"updates","value":"updates"}'
      >
        <form id="gallery-checkbox-group-form" data-gallery-form="checkbox-group" />
        <h3 id="gallery-checkbox-group-label" style="font-size:0.875rem;font-weight:500">
          Notifications
        </h3>
        <label style="display:inline-flex;align-items:center;gap:0.5rem">
          <input
            id="gallery-checkbox-group-all"
            on:click="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$input_click"
            type="checkbox"
            aria-checked={
              state.value === 'updates,billing' ? 'true' : state.value === '' ? 'false' : 'mixed'
            }
            data-bind:aria-checked="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$input_aria_checked_derive"
            checked={state.value === 'updates,billing'}
            data-bind:checked="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$input_checked_derive"
            data-state={
              state.value === 'updates,billing'
                ? 'checked'
                : state.value === ''
                  ? 'unchecked'
                  : 'indeterminate'
            }
            data-bind:data-state="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$input_data_state_derive"
            indeterminate={state.value !== '' && state.value !== 'updates,billing'}
            data-bind:indeterminate="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$input_indeterminate_derive"
          />
          <span>All notifications</span>
        </label>
        <CheckboxGroupItem {...updatesState}>
          <CheckboxGroupControl
            controlId="gallery-checkbox-group-updates"
            on:click="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupControl_click"
            tabIndex={0}
            {...updatesState}
            aria-checked={String(state.value === 'updates' || state.value === 'updates,billing')}
            data-bind:aria-checked="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupControl_aria_checked_derive"
            checked={state.value === 'updates' || state.value === 'updates,billing'}
            data-bind:checked="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupControl_checked_derive"
            data-state={
              state.value === 'updates' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            data-bind:data-state="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupControl_data_state_derive"
          />
          <CheckboxGroupLabel
            controlId="gallery-checkbox-group-updates"
            {...updatesState}
            data-state={
              state.value === 'updates' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            data-bind:data-state="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupLabel_data_state_derive"
          >
            Product updates
          </CheckboxGroupLabel>
        </CheckboxGroupItem>
        <CheckboxGroupItem {...billingState}>
          <CheckboxGroupControl
            controlId="gallery-checkbox-group-billing"
            on:click="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupControl_click_2"
            tabIndex={0}
            {...billingState}
            aria-checked={String(state.value === 'billing' || state.value === 'updates,billing')}
            data-bind:aria-checked="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupControl_aria_checked_derive_2"
            checked={state.value === 'billing' || state.value === 'updates,billing'}
            data-bind:checked="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupControl_checked_derive_2"
            data-state={
              state.value === 'billing' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            data-bind:data-state="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupControl_data_state_derive_2"
          />
          <CheckboxGroupLabel
            controlId="gallery-checkbox-group-billing"
            {...billingState}
            data-state={
              state.value === 'billing' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            data-bind:data-state="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$CheckboxGroupLabel_data_state_derive_2"
          >
            Billing notices
          </CheckboxGroupLabel>
        </CheckboxGroupItem>
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="checkbox-group-value"
          data-bind="/c/__v/43a58d8c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js#GalleryCheckboxGroupDemo$output_text_derive"
        >
          {state.value || 'none'}
        </output>
      </CheckboxGroup>
    );
  },
});
GalleryCheckboxGroupDemo.name =
  'generated/interactive/checkbox-group-demo/gallery-checkbox-group-demo';
