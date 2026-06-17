/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  normalizeToastDuration,
  toastActionAttributes,
  toastActionClick as _toastActionClick,
  toastAnimationEnd as _toastAnimationEnd,
  toastCloseAttributes,
  toastCloseClick as _toastCloseClick,
  toastDescriptionAttributes,
  toastEscapeKeyDown as _toastEscapeKeyDown,
  toastRootAttributes,
  toastTitleAttributes,
  toastViewportAttributes,
  toastViewportKeyDown as _toastViewportKeyDown,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/toast.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const VIEWPORT_CLASS =
  'fixed z-50 grid w-full max-w-sm gap-2 p-4 outline-none data-[placement=top-start]:left-0 data-[placement=top-start]:top-0 data-[placement=top-end]:right-0 data-[placement=top-end]:top-0 data-[placement=bottom-start]:bottom-0 data-[placement=bottom-start]:left-0 data-[placement=bottom-end]:bottom-0 data-[placement=bottom-end]:right-0 data-[placement=top-center]:left-1/2 data-[placement=top-center]:top-0 data-[placement=bottom-center]:bottom-0 data-[placement=bottom-center]:left-1/2 data-[disabled]:opacity-50';
const TOAST_CLASS =
  'grid gap-2 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-950 shadow-lg data-[state=closed]:hidden data-[variant=success]:border-emerald-200 data-[variant=success]:bg-emerald-50 data-[variant=info]:border-sky-200 data-[variant=info]:bg-sky-50 data-[disabled]:opacity-50';
const TIMER_CLASS =
  '[animation:gallery-toast-auto-dismiss_5000ms_linear] hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] data-[state=closed]:[animation:none]';
const TRIGGER_CLASS =
  'inline-flex h-9 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950';
const TITLE_CLASS = 'font-medium text-neutral-950';
const DESCRIPTION_CLASS = 'text-neutral-700';
const ACTION_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';
const CLOSE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';

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
      <section
        {...toastViewportAttributes({
          id: 'gallery-toast-viewport',
          label: 'Gallery notifications',
        })}
        class={VIEWPORT_CLASS}
        data-gallery-interactive="toast"
        data-toast-duration-ms={durationMs}
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
        <div
          {...toastRootAttributes(previousToastState)}
          class={TOAST_CLASS}
          data-state={state.previousOpen ? 'open' : 'closed'}
          hidden={!state.previousOpen}
        >
          <strong
            {...toastTitleAttributes({ id: 'gallery-toast-previous-title' })}
            class={TITLE_CLASS}
          >
            Previous save
          </strong>
          <p
            {...toastDescriptionAttributes({ id: 'gallery-toast-previous-description' })}
            class={DESCRIPTION_CLASS}
          >
            {'Gallery settings update #' + state.previousCount}
          </p>
          <button
            {...toastCloseAttributes(previousToastState)}
            class={CLOSE_CLASS}
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
          </button>
        </div>
        <div
          {...toastRootAttributes(activeToastState)}
          class={TOAST_CLASS + ' ' + TIMER_CLASS}
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
        >
          <strong {...toastTitleAttributes({ id: 'gallery-toast-title' })} class={TITLE_CLASS}>
            Saved
          </strong>
          <p
            {...toastDescriptionAttributes({ id: 'gallery-toast-description' })}
            class={DESCRIPTION_CLASS}
          >
            {'Gallery settings update #' + state.activeCount}
          </p>
          <button
            {...toastActionAttributes({ ...activeToastState, actionValue: 'undo' })}
            class={ACTION_CLASS}
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
          </button>
          <button
            {...toastActionAttributes({
              ...activeToastState,
              actionValue: 'keep-open',
              dismissOnAction: false,
            })}
            class={ACTION_CLASS}
            data-toast-cancel-dismiss=""
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
          </button>
          <button
            {...toastCloseAttributes(activeToastState)}
            class={CLOSE_CLASS}
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
          </button>
          <button
            {...toastActionAttributes({
              ...activeToastState,
              actionValue: 'blocked',
              disabled: true,
              dismissOnAction: false,
            })}
            class={ACTION_CLASS}
            data-toast-disabled-action=""
            onClick={() => {
              _toastActionClick(Object(event), {
                disabled: true,
                id: 'gallery-toast',
                open: state.activeOpen,
              });
            }}
          >
            Blocked
          </button>
        </div>
        <output data-demo-state="toast-open">
          {state.activeOpen ? 'open' : state.previousOpen ? 'stacked' : 'empty'}
        </output>
        <output data-demo-state="toast-count">{state.activeCount}</output>
      </section>
    );
  },
});
