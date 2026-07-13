import { afterEach, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('keeps island lifetime authority private and boot-pinned', async () => {
  // SPEC §4.4/§6.6/§14.1: authored code shares the realm but cannot replace the
  // controller registry, constructor, or abort method that retires removed output.
  const root = document.createElement('main');
  root.innerHTML = [
    '<ul kovo-fragment-target="cart-list">',
    '<li kovo-c="cart-row" kovo-key="row-1" on:click="/c/cart-row.js#mount" data-kovo-module-allowlist="/c/cart-row.js">one</li>',
    '<li kovo-c="cart-row" kovo-key="row-2" on:click="/c/cart-row.js#mount" data-kovo-module-allowlist="/c/cart-row.js">two</li>',
    '</ul>',
  ].join('');
  document.body.append(root);

  let firstSignal: AbortSignal | undefined;
  let secondSignal: AbortSignal | undefined;
  installInlineKovoLoader(async () => ({
    mount(event: Event, context: { signal: AbortSignal }) {
      const key = (event.target as Element).getAttribute('kovo-key');
      if (key === 'row-1') firstSignal = context.signal;
      if (key === 'row-2') secondSignal = context.signal;
    },
  }));

  const first = root.querySelector('[kovo-key="row-1"]');
  const second = root.querySelector('[kovo-key="row-2"]');
  const controllerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AbortController');
  if (!first || !second || !controllerDescriptor) throw new Error('island fixture unavailable');
  try {
    Object.defineProperty(globalThis, 'AbortController', {
      ...controllerDescriptor,
      value: class ForgedAbortController {
        readonly signal = { aborted: false };
        abort(): void {
          this.signal.aborted = true;
        }
      },
    });
    first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    second.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(firstSignal).toBeDefined();
      expect(secondSignal).toBeDefined();
    });
  } finally {
    Object.defineProperty(globalThis, 'AbortController', controllerDescriptor);
  }

  expect(firstSignal).toBeInstanceOf(AbortSignal);
  expect(secondSignal).toBeInstanceOf(AbortSignal);
  (first as Element & { a?: unknown }).a = { abort() {} };
  const nativeAbort = AbortController.prototype.abort;
  try {
    AbortController.prototype.abort = () => undefined;
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      [
        '<kovo-fragment target="cart-list">',
        '<ul kovo-fragment-target="cart-list">',
        '<li kovo-c="cart-row" kovo-key="row-2">two fresh</li>',
        '</ul>',
        '</kovo-fragment>',
      ].join(''),
    );
  } finally {
    AbortController.prototype.abort = nativeAbort;
  }

  expect(firstSignal?.aborted).toBe(true);
  expect(secondSignal?.aborted).toBe(false);
  expect(root.querySelector('[kovo-key="row-1"]')).toBeNull();

  // SPEC §6.6/§9.3: prepend retains every existing island, so loading older rows must not
  // revoke a still-connected island's handler lifetime.
  (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
    [
      '<kovo-fragment target="cart-list" mode="prepend">',
      '<li kovo-c="cart-row" kovo-key="row-0">zero</li>',
      '</kovo-fragment>',
    ].join(''),
  );
  expect(secondSignal?.aborted).toBe(false);
  expect(root.querySelector('[kovo-key="row-2"]')).not.toBeNull();

  // Raw response text is not structural island evidence. An escaped/user-authored text node that
  // happens to spell the framework attributes cannot keep a removed island's authority alive.
  (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
    [
      '<kovo-fragment target="cart-list">',
      '<ul kovo-fragment-target="cart-list">',
      '<li>kovo-c="cart-row" kovo-key="row-2"</li>',
      '</ul>',
      '</kovo-fragment>',
    ].join(''),
  );
  expect(secondSignal?.aborted).toBe(true);
  expect(root.querySelector('[kovo-key="row-2"]')).toBeNull();
});
