import { describe, expect, it } from 'vitest';

import {
  avatarFallbackAttributes as exportedAvatarFallbackAttributes,
  avatarImageAttributes as exportedAvatarImageAttributes,
  avatarImageState as exportedAvatarImageState,
  avatarRootAttributes as exportedAvatarRootAttributes,
} from './avatar.js';
import {
  avatarFallbackAttributes,
  avatarImageAttributes,
  avatarImageState,
  avatarRootAttributes,
} from './avatar.js';

describe('headless-ui avatar primitive', () => {
  it('builds semantic root attributes without introducing wrapper behavior', () => {
    expect(avatarRootAttributes()).toEqual({
      'data-state': 'error',
    });

    expect(avatarRootAttributes({ label: 'Ada Lovelace', src: '/ada.png' })).toEqual({
      'aria-label': 'Ada Lovelace',
      'data-state': 'loading',
      role: 'img',
    });
  });

  it('builds native image attributes and defaults to async decoding', () => {
    expect(
      avatarImageAttributes({
        alt: 'Ada Lovelace',
        loading: 'lazy',
        referrerPolicy: 'no-referrer',
        sizes: '48px',
        src: '/ada.png',
        srcSet: '/ada@2x.png 2x',
      }),
    ).toEqual({
      alt: 'Ada Lovelace',
      'data-state': 'loading',
      decoding: 'async',
      hidden: false,
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
      sizes: '48px',
      src: '/ada.png',
      srcset: '/ada@2x.png 2x',
    });
  });

  it('keeps fallback visible until the image is loaded', () => {
    expect(avatarFallbackAttributes({ delayMs: 300, src: '/ada.png' })).toEqual({
      'data-delay': '300',
      'data-state': 'loading',
      hidden: false,
    });

    expect(avatarFallbackAttributes({ src: '/ada.png', status: 'loaded' })).toEqual({
      'data-state': 'loaded',
      hidden: true,
    });
  });

  it('falls back when the image has no usable source or reports an error', () => {
    expect(avatarImageState({ src: '' })).toEqual({
      fallbackHidden: false,
      imageHidden: true,
      status: 'error',
    });

    expect(avatarImageAttributes({ alt: '', src: '/broken.png', status: 'error' })).toEqual({
      alt: '',
      'data-state': 'error',
      decoding: 'async',
      hidden: true,
      src: '/broken.png',
    });
  });

  it('normalizes explicit loaded state into image-visible attributes', () => {
    expect(avatarImageState({ src: '/ada.png', status: 'loaded' })).toEqual({
      fallbackHidden: true,
      imageHidden: false,
      src: '/ada.png',
      status: 'loaded',
    });
  });

  it('never shows the image and fallback together (loaded hides fallback, error hides image)', () => {
    // Loaded: photo visible, initials fallback removed so they do not coexist.
    const loadedImage = avatarImageAttributes({ alt: 'Grace', src: '/g.svg', status: 'loaded' });
    const loadedFallback = avatarFallbackAttributes({ src: '/g.svg', status: 'loaded' });
    expect(loadedImage.hidden).toBe(false);
    expect(loadedFallback.hidden).toBe(true);

    // Error: image hidden so the broken-image glyph never paints over initials.
    const errorImage = avatarImageAttributes({ alt: '', src: '/x.svg', status: 'error' });
    const errorFallback = avatarFallbackAttributes({ src: '/x.svg', status: 'error' });
    expect(errorImage.hidden).toBe(true);
    expect(errorFallback.hidden).toBe(false);
  });

  it('returns frozen records', () => {
    expect(Object.isFrozen(avatarImageState({ src: '/ada.png' }))).toBe(true);
    expect(Object.isFrozen(avatarRootAttributes({ src: '/ada.png' }))).toBe(true);
    expect(Object.isFrozen(avatarImageAttributes({ alt: 'Ada', src: '/ada.png' }))).toBe(true);
    expect(Object.isFrozen(avatarFallbackAttributes({ src: '/ada.png' }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedAvatarFallbackAttributes).toBe(avatarFallbackAttributes);
    expect(exportedAvatarImageAttributes).toBe(avatarImageAttributes);
    expect(exportedAvatarImageState).toBe(avatarImageState);
    expect(exportedAvatarRootAttributes).toBe(avatarRootAttributes);
  });
});
