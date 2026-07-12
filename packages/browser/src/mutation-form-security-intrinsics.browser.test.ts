import { afterEach, expect, it, vi } from 'vitest';

import { fallbackEnhancedMutationSubmit } from './mutation-form.js';

const initialBody = document.body.innerHTML;

afterEach(() => {
  document.body.innerHTML = initialBody;
  vi.restoreAllMocks();
});

it('pins modular native submit before a late prototype replacement', async () => {
  const sink = document.createElement('iframe');
  sink.name = 'kovo-c210-modular-sink';
  sink.hidden = true;
  const initialLoad = new Promise<void>((resolve) => {
    sink.addEventListener('load', () => resolve(), { once: true });
  });
  sink.src = 'about:blank';
  document.body.append(sink);
  await initialLoad;
  const form = document.createElement('form');
  form.action = '/favicon.ico';
  form.method = 'get';
  form.target = sink.name;
  const marker = document.createElement('input');
  marker.name = 'kovo-c210';
  marker.value = 'modular-runtime';
  form.append(marker);
  document.body.append(form);

  const descriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'submit');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new Error('native modular form submit unavailable');
  }
  const poisonedSubmit = vi.fn();
  Object.defineProperty(HTMLFormElement.prototype, 'submit', {
    ...descriptor,
    value: poisonedSubmit,
  });
  try {
    fallbackEnhancedMutationSubmit(form);

    await vi.waitFor(() => {
      let navigated = false;
      try {
        navigated =
          sink.contentWindow?.location.pathname === '/favicon.ico' &&
          sink.contentWindow.location.search.includes('kovo-c210=modular-runtime');
      } catch {
        navigated = true;
      }
      expect(navigated).toBe(true);
    });
    expect(poisonedSubmit).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(HTMLFormElement.prototype, 'submit', descriptor);
  }
});
