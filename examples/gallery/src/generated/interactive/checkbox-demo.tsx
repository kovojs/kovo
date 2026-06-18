// @kovojs-ir - lowered from examples/gallery/src/interactive/checkbox-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

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
import { type CheckboxCheckedState } from '@kovojs/headless-ui/checkbox';
import { checkboxClasses, checkboxInputClasses } from '@kovojs/ui/checkbox';

const ROOT_CLASS = checkboxClasses.join(' ');
const INPUT_CLASS = checkboxInputClasses.join(' ');

export interface GalleryCheckboxDemoState {
  checked: CheckboxCheckedState;
}

// SPEC.md section 5.2: this source is the authored gallery component; generated
// IR and client modules are checked in only as compiler outputs.
export const GalleryCheckboxDemo = component({
  state: () => ({ checked: 'indeterminate' }),
  render: (_queries: Record<string, never>, state: GalleryCheckboxDemoState) => (
    <label
      class={ROOT_CLASS}
      data-gallery-interactive="checkbox"
      kovo-c="gallery-checkbox-demo"
      kovo-state='{"checked":"indeterminate"}'
    >
      <input
        class={INPUT_CLASS}
        name="gallery-email-summary"
        on:click="/c/__v/68a3efc0/examples/gallery/src/generated/interactive/checkbox-demo.client.js#GalleryCheckboxDemo$input_click"
        type="checkbox"
        value="enabled"
        aria-checked={state.checked === 'indeterminate' ? 'mixed' : String(state.checked)}
        data-bind:aria-checked="/c/__v/68a3efc0/examples/gallery/src/generated/interactive/checkbox-demo.client.js#GalleryCheckboxDemo$input_aria_checked_derive"
        checked={state.checked === true}
        data-bind:checked="/c/__v/68a3efc0/examples/gallery/src/generated/interactive/checkbox-demo.client.js#GalleryCheckboxDemo$input_checked_derive"
        data-state={
          state.checked === 'indeterminate'
            ? 'indeterminate'
            : state.checked
              ? 'checked'
              : 'unchecked'
        }
        data-bind:data-state="/c/__v/68a3efc0/examples/gallery/src/generated/interactive/checkbox-demo.client.js#GalleryCheckboxDemo$input_data_state_derive"
        indeterminate={state.checked === 'indeterminate'}
        data-bind:indeterminate="/c/__v/68a3efc0/examples/gallery/src/generated/interactive/checkbox-demo.client.js#GalleryCheckboxDemo$input_indeterminate_derive"
      />
      <span class="select-none leading-none">Email summary</span>
      <output
        class="text-xs text-neutral-500"
        data-demo-state="checked"
        data-bind="/c/__v/68a3efc0/examples/gallery/src/generated/interactive/checkbox-demo.client.js#GalleryCheckboxDemo$output_text_derive"
      >
        {String(state.checked)}
      </output>
    </label>
  ),
});
GalleryCheckboxDemo.name = 'generated/interactive/checkbox-demo/gallery-checkbox-demo';
