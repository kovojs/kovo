/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  scrollAreaCornerAttributes,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaThumbAttributes,
  scrollAreaViewportAttributes,
  type ClassValue,
  type ScrollAreaOrientation,
  type ScrollAreaScrollbars,
  type TextDirection,
} from '@jiso/headless-ui';

export interface ScrollAreaStateProps {
  disabled?: boolean;
  dir?: TextDirection;
  scrollbars?: ScrollAreaScrollbars;
}

export interface ScrollAreaProps extends ScrollAreaStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface ScrollAreaViewportProps extends ScrollAreaStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface ScrollAreaScrollbarProps extends ScrollAreaStateProps {
  children?: string;
  class?: ClassValue;
  forceMount?: boolean;
  id?: string;
  orientation?: ScrollAreaOrientation;
  visible?: boolean;
}

export interface ScrollAreaCornerProps extends ScrollAreaStateProps {
  class?: ClassValue;
  forceMount?: boolean;
  id?: string;
  visible?: boolean;
}

export const scrollAreaClassNames = defineVariants({
  base: 'relative overflow-hidden rounded-md border border-neutral-200 bg-white text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const scrollAreaViewportClassNames = defineVariants({
  base: 'max-h-56 overflow-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950 data-[disabled]:cursor-not-allowed',
  variants: {},
});

export const scrollAreaScrollbarClassNames = defineVariants({
  base: 'absolute flex touch-none select-none bg-neutral-100 p-0.5 transition-colors data-[orientation=vertical]:inset-y-0 data-[orientation=vertical]:right-0 data-[orientation=vertical]:w-2.5 data-[orientation=horizontal]:inset-x-0 data-[orientation=horizontal]:bottom-0 data-[orientation=horizontal]:h-2.5 data-[state=hidden]:opacity-0',
  variants: {},
});

export const scrollAreaThumbClassNames = defineVariants({
  base: 'relative flex-1 rounded-full bg-neutral-400 data-[orientation=vertical]:min-h-8 data-[orientation=horizontal]:min-w-8 data-[state=hidden]:opacity-0',
  variants: {},
});

export const scrollAreaCornerClassNames = defineVariants({
  base: 'absolute bottom-0 right-0 h-2.5 w-2.5 bg-neutral-100 data-[state=hidden]:hidden',
  variants: {},
});

export const scrollAreaClasses = scrollAreaClassNames.classes;
export const scrollAreaViewportClasses = scrollAreaViewportClassNames.classes;
export const scrollAreaScrollbarClasses = scrollAreaScrollbarClassNames.classes;
export const scrollAreaThumbClasses = scrollAreaThumbClassNames.classes;
export const scrollAreaCornerClasses = scrollAreaCornerClassNames.classes;

export const ScrollArea = component('scroll-area', {
  render(props: ScrollAreaProps) {
    const attrs = scrollAreaRootAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
    });

    return (
      <div
        class={cn(scrollAreaClassNames(), props.class)}
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

export const ScrollAreaViewport = component('scroll-area-viewport', {
  render(props: ScrollAreaViewportProps) {
    const attrs = scrollAreaViewportAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
    });

    return (
      <div
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(scrollAreaViewportClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
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

export const ScrollAreaScrollbar = component('scroll-area-scrollbar', {
  render(props: ScrollAreaScrollbarProps) {
    const attrs = scrollAreaScrollbarAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.forceMount === undefined ? {} : { forceMount: props.forceMount }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });

    return (
      <div
        aria-hidden={attrs['aria-hidden']}
        class={cn(scrollAreaScrollbarClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
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

export const ScrollAreaThumb = component('scroll-area-thumb', {
  render(props: ScrollAreaScrollbarProps) {
    const attrs = scrollAreaThumbAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.forceMount === undefined ? {} : { forceMount: props.forceMount }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });

    return (
      <div
        aria-hidden={attrs['aria-hidden']}
        class={cn(scrollAreaThumbClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        data-scrollbars={attrs['data-scrollbars']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
      />
    );
  },
});

export const ScrollAreaCorner = component('scroll-area-corner', {
  render(props: ScrollAreaCornerProps) {
    const attrs = scrollAreaCornerAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.forceMount === undefined ? {} : { forceMount: props.forceMount }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.scrollbars === undefined ? {} : { scrollbars: props.scrollbars }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });

    return (
      <div
        aria-hidden={attrs['aria-hidden']}
        class={cn(scrollAreaCornerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-scrollbars={attrs['data-scrollbars']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
      />
    );
  },
});
