// @kovojs-ir - lowered from examples/gallery/src/interactive/dialog-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryDialogDemo$Dialog_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDialogDemo$DialogTrigger_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDialogDemo$DialogContent_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDialogDemo$DialogClose_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDialogDemo$Dialog_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDialogDemo$DialogContent_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDialogDemo$DialogClose_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDialogDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@kovojs/ui/dialog';

export interface GalleryDialogDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDialogDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDialogDemoState) => {
    const contentId = 'gallery-dialog-content';
    const titleId = 'gallery-dialog-title';
    const descriptionId = 'gallery-dialog-description';

    return (
      <Dialog
        data-gallery-interactive="dialog"
        open={state.open}
        data-bind:open="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$Dialog_open_derive"
        data-bind:data-state="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$Dialog_data_state_derive"
        kovo-state='{"open":false}'
      >
        <DialogTrigger
          contentId={contentId}
          on:click="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogTrigger_click"
          open={state.open}
          data-bind:open="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogTrigger_open_derive"
        >
          Review cart
        </DialogTrigger>
        <DialogContent
          contentId={contentId}
          descriptionId={descriptionId}
          on:cancel="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogContent_cancel"
          titleId={titleId}
          open={state.open}
          data-bind:open="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogContent_open_derive"
          data-bind:data-state="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogContent_data_state_derive"
        >
          <h2 style="font-size:1rem;font-weight:600" id={titleId}>
            Cart review
          </h2>
          <p style="font-size:0.875rem;color:#525252" id={descriptionId}>
            Confirm the current cart before checkout.
          </p>
          <DialogClose
            contentId={contentId}
            on:click="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogClose_click"
            open={state.open}
            data-bind:open="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogClose_open_derive"
            data-bind:data-state="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogClose_data_state_derive"
          >
            Close review
          </DialogClose>
        </DialogContent>
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="open"
          data-bind="/c/__v/ffae152d/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </Dialog>
    );
  },
});
GalleryDialogDemo.name = 'generated/interactive/dialog-demo/gallery-dialog-demo';
