// @kovojs-ir - lowered from examples/gallery/src/interactive/checkbox-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

export const GalleryCheckboxDemo$input_aria_checked_derive = derive(['state'], (state: any) =>
  state.checked === 'indeterminate' ? 'mixed' : String(state.checked),
);
export const GalleryCheckboxDemo$input_checked_derive = derive(['state'], (state: any) =>
  state.checked === true ? '' : null,
);
export const GalleryCheckboxDemo$input_data_state_derive = derive(['state'], (state: any) =>
  state.checked === 'indeterminate' ? 'indeterminate' : state.checked ? 'checked' : 'unchecked',
);
export const GalleryCheckboxDemo$input_indeterminate_derive = derive(
  ['state'],
  (state: any) => state.checked === 'indeterminate',
);
export const GalleryCheckboxDemo$output_text_derive = derive(['state'], (state: any) =>
  String(state.checked),
);

import { component } from '@kovojs/core';
import {
  checkboxTriggerClick as _checkboxTriggerClick,
  type CheckboxCheckedState,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/checkbox.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'inline-flex items-center gap-2 text-sm text-neutral-950 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const INPUT_CLASS =
  'h-4 w-4 rounded border border-neutral-300 text-neutral-950 accent-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';

export interface GalleryCheckboxDemoState {
  checked: CheckboxCheckedState;
}

// SPEC.md section 5.2: this source is the authored gallery component; generated
// IR and client modules are checked in only as compiler outputs.
export const GalleryCheckboxDemo = component('gallery-checkbox-demo', {
  state: () => ({ checked: 'indeterminate' }),
  render: (_queries: Record<string, never>, state: GalleryCheckboxDemoState) => (
    <label
      class={ROOT_CLASS}
      data-gallery-interactive="checkbox"
      kovo-c="gallery-checkbox-demo"
      kovo-state='{"checked":"indeterminate"}'
    >
      <input
        aria-checked={state.checked === 'indeterminate' ? 'mixed' : String(state.checked)}
        data-bind:aria-checked="/c/examples/gallery/src/generated/interactive/checkbox-demo.client.js?v=1dbc64b5#GalleryCheckboxDemo$input_aria_checked_derive"
        checked={state.checked === true}
        data-bind:checked="/c/examples/gallery/src/generated/interactive/checkbox-demo.client.js?v=1dbc64b5#GalleryCheckboxDemo$input_checked_derive"
        class={INPUT_CLASS}
        data-state={
          state.checked === 'indeterminate'
            ? 'indeterminate'
            : state.checked
              ? 'checked'
              : 'unchecked'
        }
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/checkbox-demo.client.js?v=1dbc64b5#GalleryCheckboxDemo$input_data_state_derive"
        indeterminate={state.checked === 'indeterminate'}
        data-bind:indeterminate="/c/examples/gallery/src/generated/interactive/checkbox-demo.client.js?v=1dbc64b5#GalleryCheckboxDemo$input_indeterminate_derive"
        name="gallery-email-summary"
        on:click="/c/examples/gallery/src/generated/interactive/checkbox-demo.client.js?v=1dbc64b5#GalleryCheckboxDemo$input_click"
        type="checkbox"
        value="enabled"
      />
      <span class="select-none leading-none">Email summary</span>
      <output
        class="text-xs text-neutral-500"
        data-demo-state="checked"
        data-bind="/c/examples/gallery/src/generated/interactive/checkbox-demo.client.js?v=1dbc64b5#GalleryCheckboxDemo$output_text_derive"
      >
        {String(state.checked)}
      </output>
    </label>
  ),
});
