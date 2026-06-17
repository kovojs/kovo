import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  avatarClasses,
  avatarFallbackClasses,
  avatarImageClasses,
  avatarStyles,
} from './avatar.js';

describe('@kovojs/ui Avatar StyleX styles', () => {
  it('matches avatar image states with StyleX output', () => {
    const loading = { src: '/avatars/ada.png', status: 'loading' as const };
    const loaded = { src: '/avatars/grace.png', status: 'loaded' as const };
    const error = { src: '/avatars/missing.png', status: 'error' as const };

    expect({
      classes: avatarClasses,
      error: Avatar.definition.render({
        ...error,
        children:
          AvatarImage.definition.render({ ...error, alt: '' }) +
          AvatarFallback.definition.render({ ...error, children: '?' }),
        label: 'Fallback avatar',
      }),
      fallbackClasses: avatarFallbackClasses,
      imageClasses: avatarImageClasses,
      loaded: Avatar.definition.render({
        ...loaded,
        children:
          AvatarImage.definition.render({ ...loaded, alt: 'Grace Hopper' }) +
          AvatarFallback.definition.render({ ...loaded, children: 'GH' }),
        label: 'Grace Hopper avatar',
      }),
      loading: Avatar.definition.render({
        ...loading,
        children:
          AvatarImage.definition.render({
            ...loading,
            alt: 'Ada Lovelace',
            decoding: 'async',
            loading: 'lazy',
          }) + AvatarFallback.definition.render({ ...loading, children: 'AL', delayMs: 250 }),
        label: 'Ada Lovelace avatar',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        fallback: {
          backgroundColor: '#dbeafe',
        },
        image: {
          objectFit: 'contain',
        },
        root: {
          height: 48,
          width: 48,
        },
      },
      { namespace: 'appAvatar', source: 'app-avatar.tsx' },
    );

    expect(
      Avatar.definition.render({
        children:
          AvatarImage.definition.render({
            alt: 'Custom avatar',
            src: '/avatars/custom.png',
            status: 'loading',
            styles: { image: overrides.image },
          }) +
          AvatarFallback.definition.render({
            children: 'CA',
            status: 'loading',
            styles: { fallback: overrides.fallback },
          }),
        label: 'Custom avatar',
        src: '/avatars/custom.png',
        status: 'loading',
        styles: { root: overrides.root },
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      fallbackMarker: avatarStyles.fallback.$$css,
      imageMarker: avatarStyles.image.$$css,
      keys: Object.keys(avatarStyles),
      rootMarker: avatarStyles.root.$$css,
    }).toMatchSnapshot();
  });
});
