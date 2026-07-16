import { describe, expect, it, vi } from 'vitest';

import {
  createQueryStore,
  installKovoLoader,
  type EnhancedMutationFetchOptions,
} from './client.js';
import {
  FakeElement,
  FakeFormElement,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
  FakeRoot,
} from './runtime-test-fakes.js';

// SPEC.md §4.4: enhanced-form submit interception and upload-progress reflection
// stay in the always-loaded loader path; split from the failure and broadcast
// seams in the sibling loader-enhanced-mutation-*.test.ts files.
describe('loader enhanced mutation submits', () => {
  it('intercepts enhanced form submits through the loader bridge', async () => {
    // SPEC.md §4.4: enhanced-form query/fragment effects stay in the always-loaded path.
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const pendingForm = new FakePendingElement({ 'kovo-deps': 'order' });
    const pendingRoot = new FakePendingRoot([pendingForm]);
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const uploadProgress = vi.fn();
    const formData = new FormData();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'cart/add',
        'kovo-deps': 'order',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    const progressElement = new FakeElement({ 'kovo-upload-progress': '', max: '100', value: '0' });
    form.progressElements = [progressElement];
    mutationRoot.deps = [{ deps: 'cart', id: 'cart-badge', token: 'tok_cart' }];
    mutationRoot.targets.set('cart-badge', new FakeMorphTarget());
    formData.set('productId', 'p1');
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get(name: string) {
          if (name.toLowerCase() === 'content-type') {
            return 'text/vnd.kovo.fragment+html';
          }
          return name === 'Kovo-Changes' ? '[{"domain":"cart","input":{"productId":"p1"}}]' : null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 512, total: 1024 });
        expect(pendingForm.attributes).toMatchObject({
          'aria-busy': 'true',
          'kovo-pending': '',
        });
        return [
          '<kovo-query name="cart">{"count":1}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>',
        ].join('\n');
      },
      url: 'http://localhost/_m/cart/add',
    }));

    installKovoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        idem: () => 'idem_loader',
        onUploadProgress: uploadProgress,
        pendingRoot,
        root: mutationRoot,
        store,
      },
      importModule,
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault,
      target: form,
      type: 'submit',
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(importModule).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Current-Url': 'http://localhost/',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_loader',
        'Kovo-Live-Targets': 'cart-badge#cart-badge@tok_cart:{}',
        'Kovo-Targets': 'cart-badge=cart',
      },
      keepalive: true,
      method: 'POST',
      onUploadProgress: expect.any(Function),
    });
    expect(uploadProgress).toHaveBeenCalledWith({ loaded: 512, total: 1024 }, form);
    expect(progressElement.getAttribute('value')).toBe('50');
    expect(progressElement.getAttribute('max')).toBe('100');
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(mutationRoot.targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(pendingForm.attributes).not.toHaveProperty('kovo-pending');
    expect(pendingForm.attributes).not.toHaveProperty('aria-busy');
  });

  it('includes the clicked submitter when constructing default enhanced form data', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'cart/add',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    const submitter = new FakeElement({ name: 'intent', value: 'preview' });
    const constructedArgs: unknown[][] = [];
    const originalFormData = globalThis.FormData;
    const formData = { kind: 'submitter-aware-form-data' };
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name.toLowerCase() === 'content-type' ? 'text/vnd.kovo.fragment+html' : null;
        },
      },
      async text() {
        return '';
      },
      url: 'http://localhost/_m/cart/add',
    }));

    try {
      globalThis.FormData = function FormData(...args: unknown[]) {
        constructedArgs.push(args);
        return formData;
      } as unknown as typeof FormData;

      installKovoLoader({
        enhancedMutations: {
          fetch,
          root: mutationRoot,
          store,
        },
        importModule: vi.fn(),
        root: loaderRoot,
      });

      await loaderRoot.listeners.get('submit')?.({
        preventDefault,
        submitter,
        target: form,
        type: 'submit',
      });

      expect(constructedArgs).toEqual([[form, submitter]]);
      expect(fetch).toHaveBeenCalledWith(
        '/_m/cart/add',
        expect.objectContaining({ body: formData }),
      );
    } finally {
      globalThis.FormData = originalFormData;
    }
  });

  it.each([
    ['a non-mutation formaction', { formaction: '/checkout' }],
    ['a cross-origin formaction', { formaction: 'https://attacker.test/_m/cart/add' }],
    ['a non-POST formmethod', { formmethod: 'get' }],
  ])(
    'leaves typed mutation submitters with %s to native submission',
    async (_label, attributes) => {
      const loaderRoot = new FakeRoot();
      const fetch = vi.fn();
      const preventDefault = vi.fn();
      const form = new FakeFormElement(
        {
          enhance: '',
          'data-mutation': 'cart/add',
        },
        {
          action: '/_m/cart/add',
          method: 'post',
        },
      );
      const submitter = new FakeElement(attributes);

      installKovoLoader({
        enhancedMutations: {
          fetch,
          root: new FakeMorphRoot(),
          store: createQueryStore(),
        },
        importModule: vi.fn(),
        root: loaderRoot,
      });

      await loaderRoot.listeners.get('submit')?.({
        preventDefault,
        submitter,
        target: form,
        type: 'submit',
      });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('preserves the original submitter when enhanced transport falls back to native submission', async () => {
    const loaderRoot = new FakeRoot();
    const fetchError = new Error('offline');
    const fetch = vi.fn(async () => {
      throw fetchError;
    });
    const preventDefault = vi.fn();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'cart/add',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    const submitter = new FakeElement({ name: 'intent', value: 'preview' });
    const requestSubmit = vi.fn();
    Object.defineProperty(form, 'requestSubmit', {
      configurable: true,
      value: requestSubmit,
      writable: true,
    });

    installKovoLoader({
      enhancedMutations: {
        fetch,
        formData: () => new FormData(),
        root: new FakeMorphRoot(),
        store: createQueryStore(),
      },
      importModule: vi.fn(),
      onError: vi.fn(),
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault,
      submitter,
      target: form,
      type: 'submit',
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(requestSubmit).toHaveBeenCalledWith(submitter);
  });

  it('renders upload progress as indeterminate when total bytes are unknown', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const formData = new FormData();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'cart/add',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    const progressElement = new FakeElement({ 'kovo-upload-progress': '', max: '100', value: '0' });
    form.progressElements = [progressElement];
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get(name: string) {
          return name.toLowerCase() === 'content-type' ? 'text/vnd.kovo.fragment+html' : null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 512 });
        return '<kovo-query name="cart">{"count":1}</kovo-query>';
      },
      url: 'http://localhost/_m/cart/add',
    }));

    installKovoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        root: mutationRoot,
        store,
      },
      importModule,
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault,
      target: form,
      type: 'submit',
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(progressElement.getAttribute('value')).toBeNull();
    expect(progressElement.getAttribute('max')).toBe('100');
    expect(store.get('cart')).toEqual({ count: 1 });
  });
});
