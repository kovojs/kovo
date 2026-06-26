/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  scrollAreaCornerAttributes,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaThumbAttributes,
  scrollAreaViewportAttributes,
  type ScrollAreaOrientation,
  type ScrollAreaScrollPosition,
  type ScrollAreaScrollbars,
} from '@kovojs/headless-ui/scroll-area';
import * as style from '@kovojs/style';

import type { TextDirection } from './navigation-types.js';
import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the scroll area components.
 *
 * @example
 * import type { ScrollAreaStyleOverrides } from "@kovojs/ui/scroll-area";
 * const styles: ScrollAreaStyleOverrides = {};
 */
export interface ScrollAreaStyleOverrides {
  corner?: style.StyleInput;
  root?: style.StyleInput;
  scrollbar?: style.StyleInput;
  thumb?: style.StyleInput;
  viewport?: style.StyleInput;
}

/**
 * Shared state props for the scroll area component family.
 *
 * @example
 * import type { ScrollAreaStateProps } from "@kovojs/ui/scroll-area";
 * const state: ScrollAreaStateProps = {};
 */
export interface ScrollAreaStateProps {
  disabled?: boolean;
  dir?: TextDirection;
  scrollbars?: ScrollAreaScrollbars;
}

/**
 * Props for the scroll area component.
 *
 * @example
 * import type { ScrollAreaProps } from "@kovojs/ui/scroll-area";
 * const props: ScrollAreaProps = { children: 'Content' };
 */
export interface ScrollAreaProps extends ScrollAreaStateProps {
  children?: string;
  id?: string;
  styles?: ScrollAreaStyleOverrides;
}

/**
 * Props for the scroll area viewport component.
 *
 * @example
 * import type { ScrollAreaViewportProps } from "@kovojs/ui/scroll-area";
 * const props: ScrollAreaViewportProps = { children: 'Content' };
 */
export interface ScrollAreaViewportProps extends ScrollAreaStateProps {
  children?: string;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  scrollX?: ScrollAreaScrollPosition;
  scrollY?: ScrollAreaScrollPosition;
  styles?: ScrollAreaStyleOverrides;
}

/**
 * Props for the scroll area scrollbar component.
 *
 * @example
 * import type { ScrollAreaScrollbarProps } from "@kovojs/ui/scroll-area";
 * const props: ScrollAreaScrollbarProps = { children: 'Content' };
 */
export interface ScrollAreaScrollbarProps extends ScrollAreaStateProps {
  children?: string;
  forceMount?: boolean;
  id?: string;
  orientation?: ScrollAreaOrientation;
  scrollPosition?: ScrollAreaScrollPosition;
  styles?: ScrollAreaStyleOverrides;
  visible?: boolean;
}

/**
 * Props for the scroll area thumb component.
 *
 * @example
 * import type { ScrollAreaThumbProps } from "@kovojs/ui/scroll-area";
 * const props: ScrollAreaThumbProps = { children: 'Content' };
 */
export interface ScrollAreaThumbProps extends ScrollAreaScrollbarProps {}

/**
 * Props for the scroll area corner component.
 *
 * @example
 * import type { ScrollAreaCornerProps } from "@kovojs/ui/scroll-area";
 * const props: ScrollAreaCornerProps = {};
 */
export interface ScrollAreaCornerProps extends ScrollAreaStateProps {
  forceMount?: boolean;
  id?: string;
  styles?: ScrollAreaStyleOverrides;
  visible?: boolean;
}

/**
 * Style definitions used by the scroll area components.
 *
 * @example
 * import { scrollAreaStyles } from "@kovojs/ui/scroll-area";
 * const styles = scrollAreaStyles;
 */
export const scrollAreaStyles = style.create({
  corner: {
    backgroundColor: uiTheme.color.backgroundSubtleHigh,
    bottom: 0,
    height: 10,
    position: 'absolute',
    right: 0,
    width: 10,
    '[data-state=hidden]': {
      display: 'none',
    },
  },
  // No outer card chrome (border/radius removed); the viewport owns the
  // scrollable surface and padding. Root only positions the overlay scrollbars.
  root: {
    backgroundColor: uiTheme.color.background,
    color: uiTheme.color.foreground,
    fontSize: 14,
    overflow: 'hidden',
    position: 'relative',
    '[data-disabled]': {
      opacity: 0.5,
    },
  },
  // Transparent track so only the thumb reads against the content.
  scrollbar: {
    backgroundColor: 'transparent',
    display: 'flex',
    padding: 2,
    position: 'absolute',
    touchAction: 'none',
    transitionProperty: 'background-color, opacity',
    userSelect: 'none',
    '[data-orientation=horizontal]': {
      bottom: 0,
      height: 10,
      left: 0,
      right: 0,
    },
    '[data-orientation=vertical]': {
      bottom: 0,
      right: 0,
      top: 0,
      width: 10,
    },
    '[data-state=hidden]': {
      opacity: 0,
    },
  },
  // shadcn-weight thumb: a subtle rounded bar (border token) that darkens on
  // hover/drag, with a fade transition tied to the scrollbar visibility state.
  thumb: {
    backgroundColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.full,
    flex: 1,
    position: 'relative',
    transitionDuration: '120ms',
    transitionProperty: 'background-color, opacity',
    '[data-dragging]': {
      backgroundColor: uiTheme.color.foregroundMuted,
    },
    '[data-orientation=horizontal]': {
      minWidth: 32,
    },
    '[data-orientation=vertical]': {
      minHeight: 32,
    },
    '[data-state=hidden]': {
      opacity: 0,
    },
    ':hover': {
      backgroundColor: uiTheme.color.borderStrong,
    },
  },
  viewport: {
    maxHeight: 224,
    outlineStyle: 'none',
    overflow: 'auto',
    padding: 16,
    scrollbarWidth: 'none',
    '[data-disabled]': {
      cursor: 'not-allowed',
    },
    ':focus-visible': {
      boxShadow: uiTheme.shadow.focusRingInset,
    },
    '::-webkit-scrollbar': {
      display: 'none',
    },
  },
});

/**
 * Renders the styled scroll area primitive.
 *
 * @example
 * import { ScrollArea } from "@kovojs/ui/scroll-area";
 * const component = ScrollArea;
 */
export const ScrollArea = component({
  render(props: ScrollAreaProps) {
    const attrs = scrollAreaRootAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
    });
    const styleAttrs = style.attrs(scrollAreaStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props, { style: true })}
        data-disabled={attrs['data-disabled']}
        data-scrollbars={attrs['data-scrollbars']}
        dir={attrs.dir}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled scroll area viewport primitive.
 *
 * @example
 * import { ScrollAreaViewport } from "@kovojs/ui/scroll-area";
 * const component = ScrollAreaViewport;
 */
export const ScrollAreaViewport = component({
  render(props: ScrollAreaViewportProps) {
    const attrs = scrollAreaViewportAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.scrollX === undefined ? {} : { scrollX: props.scrollX }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
      ...(props.scrollY === undefined ? {} : { scrollY: props.scrollY }),
    });
    const styleAttrs = style.attrs(scrollAreaStyles.viewport, props.styles?.viewport);

    return (
      // { style: true } forwards a consumer's inline style (e.g. the demo's
      // max-height:72px) so it can override the StyleX maxHeight default; without
      // it the inline style is dropped and the viewport keeps the 224px default,
      // leaving almost nothing to scroll (T7 / scroll-area V8).
      <div
        {...styleAttrs}
        {...passThroughProps(props, { style: true })}
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        data-disabled={attrs['data-disabled']}
        data-scroll-x={attrs['data-scroll-x']}
        data-scroll-y={attrs['data-scroll-y']}
        data-scrollbars={attrs['data-scrollbars']}
        id={attrs.id}
        role={attrs.role}
        tabIndex={attrs.tabIndex}
      >
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled scroll area scrollbar primitive.
 *
 * @example
 * import { ScrollAreaScrollbar } from "@kovojs/ui/scroll-area";
 * const component = ScrollAreaScrollbar;
 */
export const ScrollAreaScrollbar = component({
  render(props: ScrollAreaScrollbarProps) {
    const attrs = scrollAreaScrollbarAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.forceMount === undefined ? {} : { forceMount: props.forceMount }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.scrollPosition === undefined ? {} : { scrollPosition: props.scrollPosition }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });
    const styleAttrs = style.attrs(scrollAreaStyles.scrollbar, props.styles?.scrollbar);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-hidden={attrs['aria-hidden']}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        data-scroll-position={attrs['data-scroll-position']}
        data-scrollbars={attrs['data-scrollbars']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled scroll area thumb primitive.
 *
 * @example
 * import { ScrollAreaThumb } from "@kovojs/ui/scroll-area";
 * const component = ScrollAreaThumb;
 */
export const ScrollAreaThumb = component({
  render(props: ScrollAreaThumbProps) {
    const attrs = scrollAreaThumbAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.forceMount === undefined ? {} : { forceMount: props.forceMount }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.scrollPosition === undefined ? {} : { scrollPosition: props.scrollPosition }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });
    const styleAttrs = style.attrs(scrollAreaStyles.thumb, props.styles?.thumb);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-hidden={attrs['aria-hidden']}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        data-scroll-position={attrs['data-scroll-position']}
        data-scrollbars={attrs['data-scrollbars']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
      />
    );
  },
});

/**
 * Renders the styled scroll area corner primitive.
 *
 * @example
 * import { ScrollAreaCorner } from "@kovojs/ui/scroll-area";
 * const component = ScrollAreaCorner;
 */
export const ScrollAreaCorner = component({
  render(props: ScrollAreaCornerProps) {
    const attrs = scrollAreaCornerAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.forceMount === undefined ? {} : { forceMount: props.forceMount }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });
    const styleAttrs = style.attrs(scrollAreaStyles.corner, props.styles?.corner);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-hidden={attrs['aria-hidden']}
        data-disabled={attrs['data-disabled']}
        data-scrollbars={attrs['data-scrollbars']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
      />
    );
  },
});
