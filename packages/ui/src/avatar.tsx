/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  avatarFallbackAttributes,
  avatarImageAttributes,
  avatarRootAttributes,
  cn,
  defineVariants,
  type AvatarImageStatus,
  type ClassValue,
} from '@kovojs/headless-ui';

export interface AvatarStateProps {
  src?: string;
  status?: AvatarImageStatus;
}

export interface AvatarProps extends AvatarStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  label?: string;
}

export interface AvatarImageProps extends AvatarStateProps {
  alt: string;
  class?: ClassValue;
  decoding?: 'async' | 'auto' | 'sync';
  loading?: 'eager' | 'lazy';
  referrerPolicy?: string;
  sizes?: string;
  srcSet?: string;
}

export interface AvatarFallbackProps extends AvatarStateProps {
  children?: string;
  class?: ClassValue;
  delayMs?: number;
}

export const avatarClassNames = defineVariants({
  base: 'relative inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-neutral-100 text-sm font-medium text-neutral-700',
  variants: {},
});

export const avatarImageClassNames = defineVariants({
  base: 'aspect-square h-full w-full object-cover data-[state=error]:hidden',
  variants: {},
});

export const avatarFallbackClassNames = defineVariants({
  base: 'flex h-full w-full items-center justify-center rounded-full bg-neutral-100 data-[state=loaded]:hidden',
  variants: {},
});

export const avatarClasses = avatarClassNames.classes;
export const avatarImageClasses = avatarImageClassNames.classes;
export const avatarFallbackClasses = avatarFallbackClassNames.classes;

export const Avatar = component('avatar', {
  render(props: AvatarProps) {
    const attrs = avatarRootAttributes({
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.src === undefined ? {} : { src: props.src }),
      ...(props.status === undefined ? {} : { status: props.status }),
    });

    return (
      <span
        aria-label={attrs['aria-label']}
        class={cn(avatarClassNames(), props.class)}
        data-state={attrs['data-state']}
        id={props.id}
        role={attrs.role}
      >
        {props.children}
      </span>
    );
  },
});

export const AvatarImage = component('avatar-image', {
  render(props: AvatarImageProps) {
    const attrs = avatarImageAttributes({
      alt: props.alt,
      ...(props.decoding === undefined ? {} : { decoding: props.decoding }),
      ...(props.loading === undefined ? {} : { loading: props.loading }),
      ...(props.referrerPolicy === undefined ? {} : { referrerPolicy: props.referrerPolicy }),
      ...(props.sizes === undefined ? {} : { sizes: props.sizes }),
      ...(props.src === undefined ? {} : { src: props.src }),
      ...(props.srcSet === undefined ? {} : { srcSet: props.srcSet }),
      ...(props.status === undefined ? {} : { status: props.status }),
    });

    return (
      <img
        alt={attrs.alt}
        class={cn(avatarImageClassNames(), props.class)}
        data-state={attrs['data-state']}
        decoding={attrs.decoding}
        hidden={attrs.hidden}
        loading={attrs.loading}
        referrerpolicy={attrs.referrerpolicy}
        sizes={attrs.sizes}
        src={attrs.src}
        srcset={attrs.srcset}
      />
    );
  },
});

export const AvatarFallback = component('avatar-fallback', {
  render(props: AvatarFallbackProps) {
    const attrs = avatarFallbackAttributes({
      ...(props.delayMs === undefined ? {} : { delayMs: props.delayMs }),
      ...(props.src === undefined ? {} : { src: props.src }),
      ...(props.status === undefined ? {} : { status: props.status }),
    });

    return (
      <span
        class={cn(avatarFallbackClassNames(), props.class)}
        data-delay={attrs['data-delay']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
      >
        {props.children}
      </span>
    );
  },
});
