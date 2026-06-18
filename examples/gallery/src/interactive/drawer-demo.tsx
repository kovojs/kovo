/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  dialogCancel as _dialogCancel,
  dialogCloseAttributes,
  dialogCloseClick as _dialogCloseClick,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerClick as _dialogTriggerClick,
  dialogTriggerAttributes,
} from '@kovojs/headless-ui/dialog';
import {
  drawerTriggerClasses,
  drawerContentClasses,
  drawerHandleClasses,
  drawerHeaderClasses,
  drawerTitleClasses,
  drawerDescriptionClasses,
  drawerCloseClasses,
} from '@kovojs/ui/drawer';

// CONTENT_CLASS is drawerContentClassNames base + the `bottom` side variant.
const TRIGGER_CLASS = drawerTriggerClasses.join(' ');
const CONTENT_CLASS = drawerContentClasses.join(' ');
const HANDLE_CLASS = drawerHandleClasses.join(' ');
const HEADER_CLASS = drawerHeaderClasses.join(' ');
const TITLE_CLASS = drawerTitleClasses.join(' ');
const DESCRIPTION_CLASS = drawerDescriptionClasses.join(' ');
const CLOSE_CLASS = drawerCloseClasses.join(' ');

export interface GalleryDrawerDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDrawerDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDrawerDemoState) => {
    const contentId = 'gallery-interactive-drawer-content';
    const titleId = 'gallery-interactive-drawer-title';
    const descriptionId = 'gallery-interactive-drawer-description';

    return (
      <section
        {...dialogRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="drawer"
        data-side="bottom"
        data-state={state.open ? 'open' : 'closed'}
      >
        <button
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          aria-expanded={state.open ? 'true' : 'false'}
          data-state={state.open ? 'open' : 'closed'}
          onClick={() => {
            const result = _dialogTriggerClick(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          Open drawer
        </button>
        <dialog
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          class={CONTENT_CLASS}
          data-side="bottom"
          data-state={state.open ? 'open' : 'closed'}
          open={state.open}
          onCancel={() => {
            const result = _dialogCancel(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          <div aria-hidden="true" class={HANDLE_CLASS} />
          <header class={HEADER_CLASS}>
            <h2 class={TITLE_CLASS} id={titleId}>
              Mobile actions
            </h2>
            <p class={DESCRIPTION_CLASS} id={descriptionId}>
              Directional sheet drawer; Vaul drag, snap, and background-scale gestures are not
              modeled.
            </p>
          </header>
          <button
            {...dialogCloseAttributes({ contentId, open: state.open })}
            class={CLOSE_CLASS}
            data-state={state.open ? 'open' : 'closed'}
            onClick={() => {
              const result = _dialogCloseClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
            }}
          >
            Close drawer
          </button>
        </dialog>
        <output data-demo-state="drawer-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
