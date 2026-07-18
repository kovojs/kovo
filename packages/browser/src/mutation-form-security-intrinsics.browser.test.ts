import { afterEach, expect, it, vi } from 'vitest';

import { fetchEnhancedMutation } from './mutation-fetch.js';
import {
  fallbackEnhancedMutationSubmit,
  readEligibleEnhancedMutationTransport,
} from './mutation-form.js';

const initialBody = document.body.innerHTML;
const initialHead = document.head.innerHTML;
const initialUrl = location.href;

afterEach(() => {
  document.body.innerHTML = initialBody;
  document.head.innerHTML = initialHead;
  history.replaceState({}, '', initialUrl);
  vi.restoreAllMocks();
});

it('matches native submitter action resolution through the document base URL', () => {
  history.replaceState({}, '', '/cart');
  const base = document.createElement('base');
  base.href = '/safe/';
  document.head.prepend(base);
  const form = document.createElement('form');
  form.setAttribute('data-mutation', 'delete');
  form.action = '/_m/delete';
  form.method = 'post';
  const submitter = document.createElement('button');
  submitter.setAttribute('formaction', '_m/delete');
  submitter.setAttribute('formmethod', 'post');
  form.append(submitter);
  document.body.append(form);

  expect(new URL(submitter.formAction).pathname).toBe('/safe/_m/delete');
  expect(readEligibleEnhancedMutationTransport(form, submitter)).toBeUndefined();
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
  form.action = '/_m/modular-runtime';
  form.method = 'post';
  form.target = sink.name;
  const marker = document.createElement('input');
  marker.name = 'kovo-c210';
  marker.value = 'modular-runtime';
  form.append(marker);
  document.body.append(form);

  const descriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'requestSubmit');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new Error('native modular form requestSubmit unavailable');
  }
  const poisonedRequestSubmit = vi.fn();
  Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
    ...descriptor,
    value: poisonedRequestSubmit,
  });
  try {
    fallbackEnhancedMutationSubmit(form);

    await vi.waitFor(() => {
      let navigated = false;
      try {
        navigated = sink.contentWindow?.location.pathname === '/_m/modular-runtime';
      } catch {
        navigated = true;
      }
      expect(navigated).toBe(true);
    });
    expect(poisonedRequestSubmit).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', descriptor);
  }
});

it('refreshes modular idempotency truth through the boot-pinned FormData setter', async () => {
  const formData = new FormData();
  const setDescriptor = Object.getOwnPropertyDescriptor(FormData.prototype, 'set');
  const getDescriptor = Object.getOwnPropertyDescriptor(FormData.prototype, 'get');
  if (
    !setDescriptor ||
    !('value' in setDescriptor) ||
    typeof setDescriptor.value !== 'function' ||
    !getDescriptor ||
    !('value' in getDescriptor) ||
    typeof getDescriptor.value !== 'function'
  ) {
    throw new Error('native FormData controls unavailable');
  }
  const renderedIdem = 'v1_1750000000000_000102030405060708090a0b0c0d0e0f';
  Reflect.apply(setDescriptor.value, formData, ['Kovo-Idem', renderedIdem]);
  let poisonedSetCalls = 0;
  Object.defineProperty(FormData.prototype, 'set', {
    ...setDescriptor,
    value() {
      poisonedSetCalls += 1;
    },
  });
  try {
    const fetch = vi.fn(
      async (_url: string, options: { body: unknown; headers: Record<string, string> }) => {
        expect(Reflect.apply(getDescriptor.value, options.body, ['Kovo-Idem'])).toBe(
          options.headers['Kovo-Idem'],
        );
        return {
          headers: new Headers({ 'Content-Type': 'text/vnd.kovo.fragment+html' }),
          ok: true,
          status: 204,
          async text() {
            return '';
          },
          url: new URL('/_m/comment/post', location.href).href,
        };
      },
    );

    const fetched = await fetchEnhancedMutation({
      fetch,
      form: { action: '/_m/comment/post', getAttribute: () => null, method: 'post' },
      formData,
      root: document.createElement('main'),
    });

    expect(fetched.idem).not.toBe(renderedIdem);
    expect(fetched.idem).toMatch(/^v1_1750000000000_[0-9a-f]{32}$/u);
    expect(Reflect.apply(getDescriptor.value, formData, ['Kovo-Idem'])).toBe(fetched.idem);
    expect(poisonedSetCalls).toBe(0);
  } finally {
    Object.defineProperty(FormData.prototype, 'set', setDescriptor);
  }
});
