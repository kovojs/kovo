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

export interface ScrollAreaStyleOverrides {
  corner?: style.StyleInput;
  root?: style.StyleInput;
  scrollbar?: style.StyleInput;
  thumb?: style.StyleInput;
  viewport?: style.StyleInput;
}

export interface ScrollAreaStateProps {
  disabled?: boolean;
  dir?: TextDirection;
  scrollbars?: ScrollAreaScrollbars;
}

export interface ScrollAreaProps extends ScrollAreaStateProps {
  children?: string;
  id?: string;
  styles?: ScrollAreaStyleOverrides;
}

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

export interface ScrollAreaScrollbarProps extends ScrollAreaStateProps {
  children?: string;
  forceMount?: boolean;
  id?: string;
  orientation?: ScrollAreaOrientation;
  scrollPosition?: ScrollAreaScrollPosition;
  styles?: ScrollAreaStyleOverrides;
  visible?: boolean;
}

export interface ScrollAreaThumbProps extends ScrollAreaScrollbarProps {}

export interface ScrollAreaCornerProps extends ScrollAreaStateProps {
  forceMount?: boolean;
  id?: string;
  styles?: ScrollAreaStyleOverrides;
  visible?: boolean;
}

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
  root: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foreground,
    fontSize: 14,
    overflow: 'hidden',
    position: 'relative',
    '[data-disabled]': {
      opacity: 0.5,
    },
  },
  scrollbar: {
    backgroundColor: uiTheme.color.backgroundSubtleHigh,
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
  thumb: {
    backgroundColor: uiTheme.color.borderStrong,
    borderRadius: uiTheme.radius.full,
    flex: 1,
    position: 'relative',
    '[data-orientation=horizontal]': {
      minWidth: 32,
    },
    '[data-orientation=vertical]': {
      minHeight: 32,
    },
    '[data-state=hidden]': {
      opacity: 0,
    },
  },
  viewport: {
    maxHeight: 224,
    outlineStyle: 'none',
    overflow: 'auto',
    padding: 16,
    '[data-disabled]': {
      cursor: 'not-allowed',
    },
    ':focus-visible': {
      boxShadow: uiTheme.shadow.focusRingInset,
    },
  },
});

export const scrollAreaClasses = [style.attrs(scrollAreaStyles.root).class ?? ''] as const;
export const scrollAreaViewportClasses = [
  style.attrs(scrollAreaStyles.viewport).class ?? '',
] as const;
export const scrollAreaScrollbarClasses = [
  style.attrs(scrollAreaStyles.scrollbar).class ?? '',
] as const;
export const scrollAreaThumbClasses = [style.attrs(scrollAreaStyles.thumb).class ?? ''] as const;
export const scrollAreaCornerClasses = [style.attrs(scrollAreaStyles.corner).class ?? ''] as const;

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
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
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
