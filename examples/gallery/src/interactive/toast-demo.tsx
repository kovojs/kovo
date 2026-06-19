/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  normalizeToastDuration,
  toastActionClick as _toastActionClick,
  toastAnimationEnd as _toastAnimationEnd,
  toastCloseClick as _toastCloseClick,
  toastEscapeKeyDown as _toastEscapeKeyDown,
  toastViewportKeyDown as _toastViewportKeyDown,
} from '@kovojs/headless-ui/toast';
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
} from '@kovojs/ui/toast';


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
          style="display:inline-flex;width:fit-content;height:2.25rem;align-items:center;justify-content:center;border-radius:0.375rem;border:1px solid #d4d4d4;background:#fff;padding:0 0.75rem;font-size:0.875rem;font-weight:500;color:#0a0a0a;box-shadow:0 1px 2px 0 rgba(0,0,0,0.05)"
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
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="toast-open"
        >
          {state.activeOpen ? 'open' : state.previousOpen ? 'stacked' : 'empty'}
        </output>
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="toast-count"
        >
          {state.activeCount}
        </output>
      </ToastViewport>
    );
  },
});
