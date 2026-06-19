// @kovojs-ir - lowered from examples/gallery/src/interactive/checkbox-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryCheckboxDemo$Checkbox_checked_derive = derive(['state'], (state: any) =>
  state.checked ? '' : null,
);
export const GalleryCheckboxDemo$output_text_derive = derive(['state'], (state: any) =>
  String(state.checked),
);

import { component } from '@kovojs/core';
import { type CheckboxCheckedState } from '@kovojs/headless-ui/checkbox';
import { Checkbox } from '@kovojs/ui/checkbox';

export interface GalleryCheckboxDemoState {
  checked: CheckboxCheckedState;
}

// SPEC.md section 5.2: this source is the authored gallery component; generated
// IR and client modules are checked in only as compiler outputs.
export const GalleryCheckboxDemo = component({
  state: () => ({ checked: 'indeterminate' }),
  render: (_queries: Record<string, never>, state: GalleryCheckboxDemoState) => (
    <Checkbox
      data-gallery-interactive="checkbox"
      name="gallery-email-summary"
      on:click="/c/__v/e384cb9b/examples/gallery/src/generated/interactive/checkbox-demo.client.js#GalleryCheckboxDemo$Checkbox_click"
      value="enabled"
      checked={state.checked}
      data-bind:checked="/c/__v/e384cb9b/examples/gallery/src/generated/interactive/checkbox-demo.client.js#GalleryCheckboxDemo$Checkbox_checked_derive"
      kovo-state='{"checked":"indeterminate"}'
    >
      <span style="user-select:none;line-height:1">Email summary</span>
      <output
        style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
        data-demo-state="checked"
        data-bind="/c/__v/e384cb9b/examples/gallery/src/generated/interactive/checkbox-demo.client.js#GalleryCheckboxDemo$output_text_derive"
      >
        {String(state.checked)}
      </output>
    </Checkbox>
  ),
});
GalleryCheckboxDemo.name = 'generated/interactive/checkbox-demo/gallery-checkbox-demo';
