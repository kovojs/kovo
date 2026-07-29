import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Avatar, AvatarFallback, AvatarImage } from './avatar.js';

describe('@kovojs/ui Avatar StyleX styles', () => {
  it('matches avatar image states with StyleX output', () => {
    const loading = { src: '/avatars/ada.png', status: 'loading' as const };
    const loaded = { src: '/avatars/grace.png', status: 'loaded' as const };
    const error = { src: '/avatars/missing.png', status: 'error' as const };

    expect({
      error: renderUiComponent(Avatar, {
        ...error,
        children:
          renderUiComponent(AvatarImage, { ...error, alt: '' }) +
          renderUiComponent(AvatarFallback, { ...error, children: '?' }),
        label: 'Fallback avatar',
      }),
      loaded: renderUiComponent(Avatar, {
        ...loaded,
        children:
          renderUiComponent(AvatarImage, { ...loaded, alt: 'Grace Hopper' }) +
          renderUiComponent(AvatarFallback, { ...loaded, children: 'GH' }),
        label: 'Grace Hopper avatar',
      }),
      loading: renderUiComponent(Avatar, {
        ...loading,
        children:
          renderUiComponent(AvatarImage, {
            ...loading,
            alt: 'Ada Lovelace',
            decoding: 'async',
            loading: 'lazy',
          }) + renderUiComponent(AvatarFallback, { ...loading, children: 'AL', delayMs: 250 }),
        label: 'Ada Lovelace avatar',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
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
    });

    expect(
      renderUiComponent(Avatar, {
        children:
          renderUiComponent(AvatarImage, {
            alt: 'Custom avatar',
            src: '/avatars/custom.png',
            status: 'loading',
            styles: { image: overrides.image },
          }) +
          renderUiComponent(AvatarFallback, {
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
});
