import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, installKovoLoader } from './client.js';
import {
  FakeFormElement,
  FakeMorphRoot,
  FakePendingElement,
  FakePendingRoot,
  FakeRoot,
} from './runtime-test-fakes.js';

const RENDERED_IDEM = 'v1_1750000000000_000102030405060708090a0b0c0d0e0f';

function renderedFormData(): FormData {
  const formData = new FormData();
  formData.set('Kovo-Idem', RENDERED_IDEM);
  return formData;
}

// SPEC.md §4.4: failed enhanced submits clear pending state and route through the
// configured error seam (per-mutation onError or loader onError with server-truth
// recovery); split from the submit and broadcast seams in the sibling
// loader-enhanced-mutation-*.test.ts files.
describe('loader enhanced mutation failures', () => {
  it('reports enhanced loader submit failures after preventing native submit', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const pendingForm = new FakePendingElement({ 'kovo-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([pendingForm]);
    const store = createQueryStore();
    const loaderOnError = vi.fn();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const onError = vi.fn();
    const requestSubmit = vi.fn();
    const error = new Error('network down');
    const formData = renderedFormData();
    const form = Object.assign(
      new FakeFormElement(
        {
          enhance: '',
          'data-mutation': 'cart/add',
          'kovo-deps': 'cart',
        },
        {
          action: '/_m/cart/add',
          method: 'post',
        },
      ),
      { requestSubmit },
    );
    mutationRoot.deps = [{ deps: 'cart', id: 'cart-badge' }];
    const fetch = vi.fn(async () => {
      expect(pendingForm.attributes).toMatchObject({
        'aria-busy': 'true',
        'kovo-pending': '',
      });
      throw error;
    });

    installKovoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        onError,
        pendingRoot,
        root: mutationRoot,
        store,
      },
      importModule,
      onError: loaderOnError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('submit')?.({
        preventDefault,
        target: form,
        type: 'submit',
      }),
    ).resolves.toBeUndefined();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, form);
    expect(loaderOnError).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(form.getAttribute('data-error-code')).toBe('NETWORK_ERROR');
    expect(importModule).not.toHaveBeenCalled();
    expect(pendingForm.attributes).not.toHaveProperty('kovo-pending');
    expect(pendingForm.attributes).not.toHaveProperty('aria-busy');
  });

  it('reports enhanced loader submit failures through the loader error hook', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const onError = vi.fn();
    const error = new Error('network down');
    const form = new FakeFormElement(
      { enhance: '', 'data-mutation': 'cart/add' },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );

    installKovoLoader({
      enhancedMutations: {
        fetch: vi.fn(async () => {
          throw error;
        }),
        formData: renderedFormData,
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      onError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('submit')?.({
        preventDefault,
        target: form,
        type: 'submit',
      }),
    ).resolves.toBeUndefined();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, {
      event: { preventDefault, target: form, type: 'submit' },
      phase: 'enhanced-mutation',
    });
  });

  it('never replays an ambiguous failed POST under a second idempotency key', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const onError = vi.fn();
    const requestSubmit = vi.fn();
    const error = new Error('network down');
    const formData = renderedFormData();
    const attempts: Array<{ bodyIdem: FormDataEntryValue | null; headerIdem: string | undefined }> =
      [];
    const form = Object.assign(
      new FakeFormElement(
        { enhance: '', 'data-mutation': 'cart/add' },
        {
          action: '/_m/cart/add',
          method: 'post',
        },
      ),
      { requestSubmit },
    );

    installKovoLoader({
      enhancedMutations: {
        fetch: vi.fn(async (_url, init) => {
          attempts.push({
            bodyIdem: (init.body as FormData).get('Kovo-Idem'),
            headerIdem: init.headers['Kovo-Idem'],
          });
          throw error;
        }),
        formData: () => formData,
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      onError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('submit')?.({
        preventDefault,
        target: form,
        type: 'submit',
      }),
    ).resolves.toBeUndefined();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.bodyIdem).toMatch(/^v1_1750000000000_[0-9a-f]{32}$/u);
    expect(attempts[0]?.headerIdem).toBe(attempts[0]?.bodyIdem);
    expect(form.getAttribute('data-error-code')).toBe('NETWORK_ERROR');
    expect(onError).toHaveBeenCalledWith(error, {
      event: { preventDefault, target: form, type: 'submit' },
      phase: 'enhanced-mutation',
    });
  });
});
