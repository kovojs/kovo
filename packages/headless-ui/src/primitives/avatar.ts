import { type PrimitiveDataAttributes } from '../lib/index.js';

export type AvatarImageStatus = 'error' | 'loaded' | 'loading';

export interface AvatarState {
  src?: string;
  status?: AvatarImageStatus;
}

export interface AvatarComputedState {
  fallbackHidden: boolean;
  imageHidden: boolean;
  src?: string;
  status: AvatarImageStatus;
}

export interface AvatarRootAttributeOptions extends AvatarState {
  label?: string;
}

export interface AvatarImageAttributeOptions extends AvatarState {
  alt: string;
  decoding?: 'async' | 'auto' | 'sync';
  loading?: 'eager' | 'lazy';
  referrerPolicy?: string;
  sizes?: string;
  srcSet?: string;
}

export interface AvatarFallbackAttributeOptions extends AvatarState {
  delayMs?: number;
}

export type AvatarPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export function avatarImageState(options: AvatarState = {}): AvatarComputedState {
  const src = normalizeAvatarSrc(options.src);
  const status = src === undefined ? 'error' : (options.status ?? 'loading');

  return Object.freeze({
    fallbackHidden: status === 'loaded',
    imageHidden: status === 'error',
    ...(src === undefined ? {} : { src }),
    status,
  });
}

export function avatarRootAttributes(
  options: AvatarRootAttributeOptions = {},
): AvatarPrimitiveAttributes {
  const state = avatarImageState(options);

  return Object.freeze({
    'data-state': state.status,
    ...(options.label === undefined ? {} : { 'aria-label': options.label, role: 'img' }),
  });
}

export function avatarImageAttributes(
  options: AvatarImageAttributeOptions,
): AvatarPrimitiveAttributes {
  const state = avatarImageState(options);

  return Object.freeze({
    alt: options.alt,
    'data-state': state.status,
    decoding: options.decoding ?? 'async',
    hidden: state.imageHidden,
    ...(options.loading === undefined ? {} : { loading: options.loading }),
    ...(options.referrerPolicy === undefined ? {} : { referrerpolicy: options.referrerPolicy }),
    ...(options.sizes === undefined ? {} : { sizes: options.sizes }),
    ...(state.src === undefined ? {} : { src: state.src }),
    ...(options.srcSet === undefined ? {} : { srcset: options.srcSet }),
  });
}

export function avatarFallbackAttributes(
  options: AvatarFallbackAttributeOptions = {},
): AvatarPrimitiveAttributes {
  const state = avatarImageState(options);

  return Object.freeze({
    'data-state': state.status,
    hidden: state.fallbackHidden,
    ...(options.delayMs === undefined ? {} : { 'data-delay': String(options.delayMs) }),
  });
}

function normalizeAvatarSrc(src: string | undefined): string | undefined {
  return src === undefined || src === '' ? undefined : src;
}
