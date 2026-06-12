// @jiso-ir - lowered from examples/gallery/src/interactive/checkbox-group-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupLabelAttributes,
  checkboxGroupRootAttributes,
} from '@jiso/headless-ui/primitives';

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
        class="grid gap-2"
        data-gallery-interactive="checkbox-group"
        on:keydown="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=d8151e65#GalleryCheckboxGroupDemo$section_keydown"
        fw-c="gallery-checkbox-group-demo"
        fw-state='{"activeValue":"updates","value":"updates"}'
      >
        <h3 id="gallery-checkbox-group-label">Notifications</h3>
        <div {...checkboxGroupItemAttributes(updatesState)} class="inline-flex items-center gap-2">
          <input
            {...checkboxGroupControlAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
            on:click="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=d8151e65#GalleryCheckboxGroupDemo$input_click"
          />
          <label
            {...checkboxGroupLabelAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
          >
            Product updates
          </label>
        </div>
        <div {...checkboxGroupItemAttributes(billingState)} class="inline-flex items-center gap-2">
          <input
            {...checkboxGroupControlAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
            on:click="/c/examples/gallery/src/generated/interactive/checkbox-group-demo.client.js?v=d8151e65#GalleryCheckboxGroupDemo$input_click_2"
          />
          <label
            {...checkboxGroupLabelAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
          >
            Billing notices
          </label>
        </div>
        <output data-demo-state="checkbox-group-value">{state.value || 'none'}</output>
      </section>
    );
  },
});
