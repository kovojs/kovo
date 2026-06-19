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
export const GalleryDialogDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@kovojs/ui/dialog';

const TITLE_CLASS = 'text-base font-semibold';
const DESCRIPTION_CLASS = 'text-sm text-neutral-600';

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
        data-bind:open="/c/__v/591c8301/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$Dialog_open_derive"
        kovo-state='{"open":false}'
      >
        <DialogTrigger
          contentId={contentId}
          on:click="/c/__v/591c8301/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogTrigger_click"
          open={state.open}
          data-bind:open="/c/__v/591c8301/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogTrigger_open_derive"
        >
          Review cart
        </DialogTrigger>
        <DialogContent
          contentId={contentId}
          descriptionId={descriptionId}
          on:cancel="/c/__v/591c8301/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogContent_cancel"
          titleId={titleId}
          open={state.open}
          data-bind:open="/c/__v/591c8301/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogContent_open_derive"
        >
          <h2 class={TITLE_CLASS} id={titleId}>
            Cart review
          </h2>
          <p class={DESCRIPTION_CLASS} id={descriptionId}>
            Confirm the current cart before checkout.
          </p>
          <DialogClose
            contentId={contentId}
            on:click="/c/__v/591c8301/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogClose_click"
            open={state.open}
            data-bind:open="/c/__v/591c8301/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$DialogClose_open_derive"
          >
            Close review
          </DialogClose>
        </DialogContent>
        <output
          data-demo-state="open"
          data-bind="/c/__v/591c8301/examples/gallery/src/generated/interactive/dialog-demo.client.js#GalleryDialogDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </Dialog>
    );
  },
});
GalleryDialogDemo.name = 'generated/interactive/dialog-demo/gallery-dialog-demo';
