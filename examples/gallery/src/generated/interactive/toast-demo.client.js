// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  toastActionClick as _toastActionClick,
  toastAnimationEnd as _toastAnimationEnd,
  toastCloseClick as _toastCloseClick,
  toastEscapeKeyDown as _toastEscapeKeyDown,
  toastViewportKeyDown as _toastViewportKeyDown,
} from '@kovojs/headless-ui/toast';

export const GalleryToastDemo$ToastViewport_keydown = handler((event, ctx) => {
  if (_toastViewportKeyDown(Object(event))) return;

  if (ctx.state.activeOpen) {
    const result = _toastEscapeKeyDown(Object(event), {
      id: 'gallery-toast',
      open: ctx.state.activeOpen,
    });
    if (!result?.changed) return;
    ctx.state.activeOpen = result.open;
    return;
  }

  const previousResult = _toastEscapeKeyDown(Object(event), {
    id: 'gallery-toast-previous',
    open: ctx.state.previousOpen,
  });
  if (!previousResult?.changed) return;
  ctx.state.previousOpen = previousResult.open;
});
export const GalleryToastDemo$button_click = handler((_event, ctx) => {
  if (ctx.state.activeOpen) {
    ctx.state.previousOpen = true;
    ctx.state.previousCount = ctx.state.activeCount;
  }
  ctx.state.activeCount = ctx.state.activeCount + 1;
  ctx.state.activeOpen = true;
});
export const GalleryToastDemo$ToastClose_click = handler((event, ctx) => {
  const result = _toastCloseClick(Object(event), {
    id: 'gallery-toast-previous',
    open: ctx.state.previousOpen,
  });
  if (!result?.changed) return;
  ctx.state.previousOpen = result.open;
});
export const GalleryToastDemo$Toast_animationend = handler((event, ctx) => {
  const result = _toastAnimationEnd(
    Object(event),
    { id: 'gallery-toast', open: ctx.state.activeOpen },
    'gallery-toast-auto-dismiss',
  );
  if (!result?.changed) return;
  ctx.state.activeOpen = result.open;
});
export const GalleryToastDemo$ToastAction_click = handler((event, ctx) => {
  const result = _toastActionClick(Object(event), {
    id: 'gallery-toast',
    open: ctx.state.activeOpen,
  });
  if (!result?.changed) return;
  ctx.state.activeOpen = result.open;
});
export const GalleryToastDemo$ToastAction_click_2 = handler((event, ctx) => {
  const result = _toastActionClick(
    Object(event),
    { id: 'gallery-toast', open: ctx.state.activeOpen },
    { dismissOnAction: false },
  );
  if (result?.changed) ctx.state.activeOpen = result.open;
});
export const GalleryToastDemo$ToastClose_click_2 = handler((event, ctx) => {
  const result = _toastCloseClick(Object(event), {
    id: 'gallery-toast',
    open: ctx.state.activeOpen,
  });
  if (!result?.changed) return;
  ctx.state.activeOpen = result.open;
});
export const GalleryToastDemo$ToastAction_click_3 = handler((event, ctx) => {
  _toastActionClick(Object(event), {
    disabled: true,
    id: 'gallery-toast',
    open: ctx.state.activeOpen,
  });
});

export const GalleryToastDemo$Toast_data_state_derive = derive(['state'], (state) =>
  state.previousOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$Toast_hidden_derive = derive(['state'], (state) =>
  !state.previousOpen ? '' : null,
);
export const GalleryToastDemo$ToastClose_data_state_derive = derive(['state'], (state) =>
  state.previousOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$Toast_data_state_derive_2 = derive(['state'], (state) =>
  state.activeOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$Toast_hidden_derive_2 = derive(['state'], (state) =>
  !state.activeOpen ? '' : null,
);
export const GalleryToastDemo$ToastClose_data_state_derive_2 = derive(['state'], (state) =>
  state.activeOpen ? 'open' : 'closed',
);
export const GalleryToastDemo$output_text_derive = derive(['state'], (state) =>
  state.activeOpen ? 'open' : state.previousOpen ? 'stacked' : 'empty',
);
