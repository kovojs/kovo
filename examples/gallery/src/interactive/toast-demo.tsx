/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  normalizeToastDuration,
  Toast,
  ToastAction,
  toastActionClick as _toastActionClick,
  toastAnimationEnd as _toastAnimationEnd,
  ToastClose,
  toastCloseClick as _toastCloseClick,
  ToastDescription,
  toastEscapeKeyDown as _toastEscapeKeyDown,
  ToastTitle,
  ToastViewport,
  toastViewportKeyDown as _toastViewportKeyDown,
} from '@kovojs/ui/toast';

const TRIGGER_CLASS =
  'inline-flex h-9 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950';

export interface GalleryToastDemoState {
  activeCount: number;
  activeOpen: boolean;
  previousCount: number;
  previousOpen: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryToastDemo = component({
  state: () => ({ activeCount: 0, activeOpen: false, previousCount: 0, previousOpen: false }),
  render: (_queries: Record<string, never>, state: GalleryToastDemoState) => {
    const durationMs = normalizeToastDuration(5000);
    const activeToastState = {
      descriptionId: 'gallery-toast-description',
      id: 'gallery-toast',
      open: state.activeOpen,
      titleId: 'gallery-toast-title',
      variant: 'success' as const,
    };
    const previousToastState = {
      descriptionId: 'gallery-toast-previous-description',
      id: 'gallery-toast-previous',
      open: state.previousOpen,
      titleId: 'gallery-toast-previous-title',
      variant: 'info' as const,
    };

    return (
      <ToastViewport
        data-gallery-interactive="toast"
        data-toast-duration-ms={durationMs}
        id="gallery-toast-viewport"
        label="Gallery notifications"
        onKeyDown={() => {
          if (_toastViewportKeyDown(Object(event))) return;

          if (state.activeOpen) {
            const result = _toastEscapeKeyDown(Object(event), {
              id: 'gallery-toast',
              open: state.activeOpen,
            });
            if (!result?.changed) return;
            state.activeOpen = result.open;
            return;
          }

          const previousResult = _toastEscapeKeyDown(Object(event), {
            id: 'gallery-toast-previous',
            open: state.previousOpen,
          });
          if (!previousResult?.changed) return;
          state.previousOpen = previousResult.open;
        }}
      >
        <style>{'@keyframes gallery-toast-auto-dismiss{from{opacity:1}to{opacity:1}}'}</style>
        <button
          class={TRIGGER_CLASS}
          data-toast-show=""
          type="button"
          onClick={() => {
            if (state.activeOpen) {
              state.previousOpen = true;
              state.previousCount = state.activeCount;
            }
            state.activeCount = state.activeCount + 1;
            state.activeOpen = true;
          }}
        >
          Show toast
        </button>
        <Toast
          {...previousToastState}
          data-state={state.previousOpen ? 'open' : 'closed'}
          hidden={!state.previousOpen}
        >
          <ToastTitle id="gallery-toast-previous-title">Previous save</ToastTitle>
          <ToastDescription id="gallery-toast-previous-description">
            Gallery settings update.
          </ToastDescription>
          <ToastClose
            {...previousToastState}
            data-state={state.previousOpen ? 'open' : 'closed'}
            onClick={() => {
              const result = _toastCloseClick(Object(event), {
                id: 'gallery-toast-previous',
                open: state.previousOpen,
              });
              if (!result?.changed) return;
              state.previousOpen = result.open;
            }}
          >
            Dismiss
          </ToastClose>
        </Toast>
        <Toast
          {...activeToastState}
          data-state={state.activeOpen ? 'open' : 'closed'}
          hidden={!state.activeOpen}
          onAnimationEnd={() => {
            const result = _toastAnimationEnd(
              Object(event),
              { id: 'gallery-toast', open: state.activeOpen },
              'gallery-toast-auto-dismiss',
            );
            if (!result?.changed) return;
            state.activeOpen = result.open;
          }}
          style={{
            animationDuration: `${durationMs}ms`,
            animationName: 'gallery-toast-auto-dismiss',
            animationTimingFunction: 'linear',
          }}
        >
          <ToastTitle id="gallery-toast-title">Saved</ToastTitle>
          <ToastDescription id="gallery-toast-description">
            Gallery settings update.
          </ToastDescription>
          <ToastAction
            {...activeToastState}
            actionValue="undo"
            onClick={() => {
              const result = _toastActionClick(Object(event), {
                id: 'gallery-toast',
                open: state.activeOpen,
              });
              if (!result?.changed) return;
              state.activeOpen = result.open;
            }}
          >
            Undo
          </ToastAction>
          <ToastAction
            {...activeToastState}
            actionValue="keep-open"
            data-toast-cancel-dismiss=""
            dismissOnAction={false}
            onClick={() => {
              const result = _toastActionClick(
                Object(event),
                { id: 'gallery-toast', open: state.activeOpen },
                { dismissOnAction: false },
              );
              if (result?.changed) state.activeOpen = result.open;
            }}
          >
            Keep open
          </ToastAction>
          <ToastClose
            {...activeToastState}
            data-state={state.activeOpen ? 'open' : 'closed'}
            onClick={() => {
              const result = _toastCloseClick(Object(event), {
                id: 'gallery-toast',
                open: state.activeOpen,
              });
              if (!result?.changed) return;
              state.activeOpen = result.open;
            }}
          >
            Dismiss
          </ToastClose>
          <ToastAction
            {...activeToastState}
            actionValue="blocked"
            data-toast-disabled-action=""
            disabled={true}
            dismissOnAction={false}
            onClick={() => {
              _toastActionClick(Object(event), {
                disabled: true,
                id: 'gallery-toast',
                open: state.activeOpen,
              });
            }}
          >
            Blocked
          </ToastAction>
        </Toast>
        <output data-demo-state="toast-open">
          {state.activeOpen ? 'open' : state.previousOpen ? 'stacked' : 'empty'}
        </output>
        <output data-demo-state="toast-count">{state.activeCount}</output>
      </ToastViewport>
    );
  },
});
