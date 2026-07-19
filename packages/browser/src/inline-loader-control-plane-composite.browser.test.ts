import { afterEach, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// @kovo-security-certifies C13 dynamic-control-plane-high-impact-composites
it('prevents dynamic bindings from minting mutation authority or deferred stylesheet activation', async () => {
  const rafCallbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'preload';
  stylesheet.as = 'style';
  stylesheet.href = '/private.css';
  stylesheet.setAttribute('data-bind:data-kovo-deferred-style', 'state.promote');
  stylesheet.setAttribute('data-kovo-module-allowlist', '/c/control.client.js');
  stylesheet.setAttribute('kovo-state', '{"promote":true}');
  stylesheet.setAttribute('on:click', '/c/control.client.js#commit');
  stylesheet.addEventListener('click', (event) => event.preventDefault());
  document.head.append(stylesheet);

  const form = document.createElement('form');
  form.action = '/_m/account/delete';
  form.method = 'post';
  form.setAttribute('data-bind:data-mutation', 'state.mutation');
  form.setAttribute('data-kovo-module-allowlist', '/c/control.client.js');
  form.setAttribute('kovo-state', '{"mutation":"account/delete"}');
  form.setAttribute('on:click', '/c/control.client.js#commit');
  document.body.append(form);

  const commit = vi.fn();
  installInlineKovoLoader(async () => ({ commit }));

  stylesheet.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
  expect(stylesheet.getAttribute('data-kovo-deferred-style')).toBeNull();
  expect(form.getAttribute('data-mutation')).toBeNull();

  let submitPrevented: boolean | undefined;
  form.addEventListener(
    'submit',
    (event) => {
      // Snapshot Kovo's capture-phase verdict, then cancel only the fixture's native navigation.
      // Firefox performs the synthetic form default action and would navigate the test page away.
      submitPrevented = event.defaultPrevented;
      event.preventDefault();
    },
    { once: true },
  );
  const submit = new SubmitEvent('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(submit);
  expect(submitPrevented).toBe(false);
  expect(fetch).not.toHaveBeenCalled();

  for (let frame = 0; frame < 2; frame += 1) {
    const pending = rafCallbacks.splice(0);
    for (const callback of pending) callback(performance.now());
  }
  expect(stylesheet.rel).toBe('preload');
  expect(stylesheet.getAttribute('data-kovo-deferred-style')).toBeNull();
});
