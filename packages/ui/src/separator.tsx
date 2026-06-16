/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  defineVariants,
  separatorRootAttributes,
  type ClassValue,
  type SeparatorOrientation,
} from '@kovojs/headless-ui';

export interface SeparatorProps {
  class?: ClassValue;
  decorative?: boolean;
  orientation?: SeparatorOrientation;
}

export const separatorClassNames = defineVariants({
  base: 'shrink-0 bg-neutral-200 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
  variants: {},
});

export const separatorClasses = separatorClassNames.classes;

export const Separator = component({
  render(props: SeparatorProps) {
    const attrs = separatorRootAttributes({
      ...(props.decorative === undefined ? {} : { decorative: props.decorative }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    });

    return (
      <div
        aria-orientation={attrs['aria-orientation']}
        class={cn(separatorClassNames(), props.class)}
        data-orientation={attrs['data-orientation']}
        role={attrs.role}
      />
    );
  },
});
