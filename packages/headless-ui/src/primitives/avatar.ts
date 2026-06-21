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

export interface AvatarImageStatusResult {
  changed: boolean;
  status: AvatarImageStatus;
}

export type AvatarImageEvent = Event;

/**
 * @kovoPrimitiveHandler
 *
 * Flips the avatar to `loaded` when its `<img>` fires the native `load` event.
 * `data-bind:*` can only stamp attributes, so reacting to a real image load needs
 * a client island (event → state). SPEC.md §4.6: no-ops when the author already
 * prevented the default action or the state is already resolved.
 */
export function avatarImageLoad(
  event: AvatarImageEvent,
  state: AvatarState = {},
): AvatarImageStatusResult | undefined {
  if (event.defaultPrevented) return;
  if (state.status === 'loaded') return { changed: false, status: 'loaded' };

  return { changed: true, status: 'loaded' };
}

/**
 * @kovoPrimitiveHandler
 *
 * Flips the avatar to `error` when its `<img>` fires the native `error` event, so
 * a broken image reveals the initials fallback (instead of being stuck `loading`).
 * SPEC.md §4.6: no-ops when default is prevented or the state is already `error`.
 */
export function avatarImageError(
  event: AvatarImageEvent,
  state: AvatarState = {},
): AvatarImageStatusResult | undefined {
  if (event.defaultPrevented) return;
  if (state.status === 'error') return { changed: false, status: 'error' };

  return { changed: true, status: 'error' };
}

function normalizeAvatarSrc(src: string | undefined): string | undefined {
  return src === undefined || src === '' ? undefined : src;
}
