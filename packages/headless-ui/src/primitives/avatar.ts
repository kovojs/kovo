import { type PrimitiveDataAttributes } from '../lib/index.js';

/**
 * Public type used by the Avatar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AvatarImageStatus } from '@kovojs/headless-ui/avatar';
 *
 * const value: AvatarImageStatus = {} as AvatarImageStatus;
 * ```
 */
export type AvatarImageStatus = 'error' | 'loaded' | 'loading';

/**
 * State snapshot consumed by the Avatar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AvatarState } from '@kovojs/headless-ui/avatar';
 *
 * const value: AvatarState = {} as AvatarState;
 * ```
 */
export interface AvatarState {
  src?: string;
  status?: AvatarImageStatus;
}

/**
 * State snapshot consumed by the Avatar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AvatarComputedState } from '@kovojs/headless-ui/avatar';
 *
 * const value: AvatarComputedState = {} as AvatarComputedState;
 * ```
 */
export interface AvatarComputedState {
  fallbackHidden: boolean;
  imageHidden: boolean;
  src?: string;
  status: AvatarImageStatus;
}

/**
 * Options accepted by the Avatar primitive avatar root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AvatarRootAttributeOptions } from '@kovojs/headless-ui/avatar';
 *
 * const value: AvatarRootAttributeOptions = {} as AvatarRootAttributeOptions;
 * ```
 */
export interface AvatarRootAttributeOptions extends AvatarState {
  label?: string;
}

/**
 * Options accepted by the Avatar primitive avatar image attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AvatarImageAttributeOptions } from '@kovojs/headless-ui/avatar';
 *
 * const value: AvatarImageAttributeOptions = {} as AvatarImageAttributeOptions;
 * ```
 */
export interface AvatarImageAttributeOptions extends AvatarState {
  alt: string;
  decoding?: 'async' | 'auto' | 'sync';
  loading?: 'eager' | 'lazy';
  referrerPolicy?: string;
  sizes?: string;
  srcSet?: string;
}

/**
 * Options accepted by the Avatar primitive avatar fallback attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AvatarFallbackAttributeOptions } from '@kovojs/headless-ui/avatar';
 *
 * const value: AvatarFallbackAttributeOptions = {} as AvatarFallbackAttributeOptions;
 * ```
 */
export interface AvatarFallbackAttributeOptions extends AvatarState {
  delayMs?: number;
}

/**
 * Serializable attribute record returned by Avatar primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AvatarPrimitiveAttributes } from '@kovojs/headless-ui/avatar';
 *
 * const value: AvatarPrimitiveAttributes = {} as AvatarPrimitiveAttributes;
 * ```
 */
export type AvatarPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Computes avatar image state for the Avatar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { avatarImageState } from '@kovojs/headless-ui/avatar';
 *
 * const input = {} as Parameters<typeof avatarImageState>[0];
 * const result = avatarImageState(input);
 * ```
 */
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

/**
 * Builds the avatar root attributes record for the Avatar primitive.
 *
 * Emits `aria-label`, `data-state`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { avatarRootAttributes } from '@kovojs/headless-ui/avatar';
 *
 * const input = {} as Parameters<typeof avatarRootAttributes>[0];
 * const result = avatarRootAttributes(input);
 * ```
 */
export function avatarRootAttributes(
  options: AvatarRootAttributeOptions = {},
): AvatarPrimitiveAttributes {
  const state = avatarImageState(options);

  return Object.freeze({
    'data-state': state.status,
    ...(options.label === undefined ? {} : { 'aria-label': options.label, role: 'img' }),
  });
}

/**
 * Builds the avatar image attributes record for the Avatar primitive.
 *
 * Emits `data-state`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { avatarImageAttributes } from '@kovojs/headless-ui/avatar';
 *
 * const input = {} as Parameters<typeof avatarImageAttributes>[0];
 * const result = avatarImageAttributes(input);
 * ```
 */
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

/**
 * Builds the avatar fallback attributes record for the Avatar primitive.
 *
 * Emits `data-delay`, `data-state`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { avatarFallbackAttributes } from '@kovojs/headless-ui/avatar';
 *
 * const input = {} as Parameters<typeof avatarFallbackAttributes>[0];
 * const result = avatarFallbackAttributes(input);
 * ```
 */
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

/**
 * Result returned by the Avatar primitive avatar image status.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AvatarImageStatusResult } from '@kovojs/headless-ui/avatar';
 *
 * const value: AvatarImageStatusResult = {} as AvatarImageStatusResult;
 * ```
 */
export interface AvatarImageStatusResult {
  changed: boolean;
  status: AvatarImageStatus;
}

/**
 * Event shape consumed by the Avatar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AvatarImageEvent } from '@kovojs/headless-ui/avatar';
 *
 * const value: AvatarImageEvent = {} as AvatarImageEvent;
 * ```
 */
export type AvatarImageEvent = Event;

/**
 * Computes avatar image load for the Avatar primitive.
 *
 * @example
 * ```ts
 * import { avatarImageLoad } from '@kovojs/headless-ui/avatar';
 *
 * const input = {} as Parameters<typeof avatarImageLoad>[0];
 * const state = {} as Parameters<typeof avatarImageLoad>[1];
 * const result = avatarImageLoad(input, state);
 * ```
 *
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
 * Computes avatar image error for the Avatar primitive.
 *
 * @example
 * ```ts
 * import { avatarImageError } from '@kovojs/headless-ui/avatar';
 *
 * const input = {} as Parameters<typeof avatarImageError>[0];
 * const state = {} as Parameters<typeof avatarImageError>[1];
 * const result = avatarImageError(input, state);
 * ```
 *
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
