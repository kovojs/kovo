/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  avatarFallbackAttributes,
  avatarImageAttributes,
  avatarRootAttributes,
  type AvatarImageStatus,
} from '@kovojs/headless-ui/avatar';
import * as style from '@kovojs/style';

export interface AvatarStyleOverrides {
  fallback?: style.StyleInput;
  image?: style.StyleInput;
  root?: style.StyleInput;
}

export interface AvatarStateProps {
  src?: string;
  status?: AvatarImageStatus;
}

export interface AvatarProps extends AvatarStateProps {
  children?: string;
  id?: string;
  label?: string;
  styles?: AvatarStyleOverrides;
}

export interface AvatarImageProps extends AvatarStateProps {
  alt: string;
  decoding?: 'async' | 'auto' | 'sync';
  loading?: 'eager' | 'lazy';
  referrerPolicy?: string;
  sizes?: string;
  styles?: AvatarStyleOverrides;
  srcSet?: string;
}

export interface AvatarFallbackProps extends AvatarStateProps {
  children?: string;
  delayMs?: number;
  styles?: AvatarStyleOverrides;
}

export const avatarStyles = style.create(
  {
    fallback: {
      alignItems: 'center',
      backgroundColor: '#f5f5f5',
      borderRadius: 9999,
      display: 'flex',
      height: '100%',
      justifyContent: 'center',
      width: '100%',
      '[data-state=loaded]': {
        display: 'none',
      },
    },
    image: {
      aspectRatio: '1 / 1',
      height: '100%',
      objectFit: 'cover',
      width: '100%',
      '[data-state=error]': {
        display: 'none',
      },
    },
    root: {
      backgroundColor: '#f5f5f5',
      borderRadius: 9999,
      color: '#404040',
      display: 'inline-flex',
      flexShrink: 0,
      fontSize: 14,
      fontWeight: 500,
      height: 40,
      overflow: 'hidden',
      position: 'relative',
      width: 40,
    },
  },
  { namespace: 'avatar', source: 'avatar.tsx' },
);

export const avatarClasses = [style.attrs(avatarStyles.root).class ?? ''] as const;
export const avatarImageClasses = [style.attrs(avatarStyles.image).class ?? ''] as const;
export const avatarFallbackClasses = [style.attrs(avatarStyles.fallback).class ?? ''] as const;

export const Avatar = component({
  render(props: AvatarProps) {
    const attrs = avatarRootAttributes({
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.src === undefined ? {} : { src: props.src }),
      ...(props.status === undefined ? {} : { status: props.status }),
    });
    const styleAttrs = style.attrs(avatarStyles.root, props.styles?.root);

    return (
      <span
        {...styleAttrs}
        aria-label={attrs['aria-label']}
        data-state={attrs['data-state']}
        id={props.id}
        role={attrs.role}
      >
        {props.children}
      </span>
    );
  },
});

export const AvatarImage = component({
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
    const styleAttrs = style.attrs(avatarStyles.image, props.styles?.image);

    return (
      <img
        alt={attrs.alt}
        {...styleAttrs}
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

export const AvatarFallback = component({
  render(props: AvatarFallbackProps) {
    const attrs = avatarFallbackAttributes({
      ...(props.delayMs === undefined ? {} : { delayMs: props.delayMs }),
      ...(props.src === undefined ? {} : { src: props.src }),
      ...(props.status === undefined ? {} : { status: props.status }),
    });
    const styleAttrs = style.attrs(avatarStyles.fallback, props.styles?.fallback);

    return (
      <span
        {...styleAttrs}
        data-delay={attrs['data-delay']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
      >
        {props.children}
      </span>
    );
  },
});
