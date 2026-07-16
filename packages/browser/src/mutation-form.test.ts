import { describe, expect, it, vi } from 'vitest';

import {
  closestEnhancedMutationForm,
  fallbackEnhancedMutationSubmit,
  isEligibleEnhancedMutationForm,
  isEnhancedForm,
  updateUploadProgressElements,
} from './mutation-form.js';
import { FakeElement, FakeFormElement } from './runtime-test-fakes.js';

describe('enhanced mutation form helpers', () => {
  it('resolves only declared enhanced mutation forms from the shared selector', () => {
    const enhanced = new FakeElement({ 'data-mutation': 'cart/add' });
    const plain = new FakeElement();

    // SPEC.md §9.1/§9.2: enhanced interception is opt-in; native form fallback
    // must remain available for forms without the enhancement attributes.
    expect(closestEnhancedMutationForm(enhanced)).toBe(enhanced);
    expect(closestEnhancedMutationForm(plain)).toBeNull();
    expect(isEnhancedForm(new FakeElement({ enhance: '' }))).toBe(true);
    expect(isEnhancedForm(new FakeElement({ 'data-enhance': '' }))).toBe(true);
    expect(isEnhancedForm(plain)).toBe(false);
  });

  it('allows enhanced interception only for same-origin /_m/ POST forms', () => {
    const previousLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: new URL('https://shop.example.test/cart'),
    });
    try {
      expect(
        isEligibleEnhancedMutationForm(
          new FakeFormElement(
            { 'data-mutation': 'cart/add' },
            { action: '/_m/cart/add', method: 'post' },
          ),
        ),
      ).toBe(true);
      expect(
        isEligibleEnhancedMutationForm(
          new FakeFormElement({ 'data-mutation': 'cart/add' }, { action: '/cart', method: 'post' }),
        ),
      ).toBe(false);
      expect(
        isEligibleEnhancedMutationForm(
          new FakeFormElement({ enhance: '' }, { action: '/_m/cart/add', method: 'post' }),
        ),
      ).toBe(false);
      expect(
        isEligibleEnhancedMutationForm(
          new FakeFormElement(
            { 'data-mutation': 'cart/add' },
            { action: '/_m/cart/other', method: 'post' },
          ),
        ),
      ).toBe(false);
      expect(
        isEligibleEnhancedMutationForm(
          new FakeFormElement(
            { 'data-mutation': 'cart/add' },
            { action: '/_m/cart/add', method: 'get' },
          ),
        ),
      ).toBe(false);
      expect(
        isEligibleEnhancedMutationForm(
          new FakeFormElement(
            { 'data-mutation': 'cart/add' },
            { action: 'https://evil.example/_m/cart/add', method: 'post' },
          ),
        ),
      ).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: previousLocation,
      });
    }
  });

  it('derives submitter action and method overrides before interception', () => {
    const previousLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: new URL('https://shop.example.test/cart#private-client-state'),
    });
    const form = new FakeFormElement(
      { 'data-mutation': 'cart/add' },
      { action: '/_m/cart/add', method: 'post' },
    );
    try {
      expect(
        isEligibleEnhancedMutationForm(
          form,
          new FakeElement({ formaction: '/checkout', name: 'intent', value: 'checkout' }),
        ),
      ).toBe(false);
      expect(isEligibleEnhancedMutationForm(form, new FakeElement({ formmethod: 'get' }))).toBe(
        false,
      );
      expect(
        isEligibleEnhancedMutationForm(
          form,
          new FakeElement({ formaction: '/_m/cart/add', formmethod: 'post' }),
        ),
      ).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: previousLocation,
      });
    }
  });

  it('keeps cross-origin and non-mutation actions ineligible under late URL and string poisoning', () => {
    // SPEC §6.6/§9.1: eligibility is the credential-bearing form-data egress choke.
    // Authored browser code must not be able to turn an external action (or an ordinary
    // same-origin POST) into an enhanced mutation by replacing URL/String controls after boot.
    const origin = Object.getOwnPropertyDescriptor(URL.prototype, 'origin');
    const originalStartsWith = String.prototype.startsWith;
    const originalToUpperCase = String.prototype.toUpperCase;
    if (!origin?.get) throw new Error('URL.origin getter unavailable');

    try {
      Object.defineProperty(URL.prototype, 'origin', {
        ...origin,
        get() {
          return 'https://shop.example.test';
        },
      });
      String.prototype.startsWith = () => true;
      String.prototype.toUpperCase = () => 'POST';

      expect(
        isEligibleEnhancedMutationForm(
          new FakeFormElement(
            { 'data-mutation': 'cart/add' },
            { action: 'https://evil.example/_m/steal', method: 'get' },
          ),
        ),
      ).toBe(false);
      expect(
        isEligibleEnhancedMutationForm(
          new FakeFormElement(
            { 'data-mutation': 'cart/add' },
            { action: '/checkout', method: 'post' },
          ),
        ),
      ).toBe(false);
    } finally {
      Object.defineProperty(URL.prototype, 'origin', origin);
      String.prototype.startsWith = originalStartsWith;
      String.prototype.toUpperCase = originalToUpperCase;
    }
  });

  it('falls back through requestSubmit with the original submitter or visible form errors', () => {
    const requestSubmit = vi.fn();
    const nativeForm = new FakeFormElement(
      { 'data-mutation': 'cart/add' },
      { action: '/_m/cart/add' },
    );
    Object.assign(nativeForm, { requestSubmit });

    const submitter = new FakeElement({ formaction: '/checkout', formmethod: 'post' });
    fallbackEnhancedMutationSubmit(nativeForm, submitter);
    expect(requestSubmit).toHaveBeenCalledWith(submitter);

    let inheritedRequestSubmitReads = 0;
    const inheritedSubmitForm = new FakeFormElement(
      { 'data-mutation': 'cart/add' },
      { action: '/_m/cart/add' },
    );
    Object.setPrototypeOf(
      inheritedSubmitForm,
      Object.create(FakeFormElement.prototype, {
        requestSubmit: {
          configurable: true,
          get() {
            inheritedRequestSubmitReads += 1;
            return requestSubmit;
          },
        },
      }),
    );
    fallbackEnhancedMutationSubmit(inheritedSubmitForm);
    expect(inheritedRequestSubmitReads).toBe(0);
    expect(inheritedSubmitForm.getAttribute('data-error-code')).toBe('NETWORK_ERROR');

    const syntheticForm = Object.assign(new FakeElement({ 'data-mutation': 'cart/add' }), {
      action: '/_m/cart/add',
    });
    fallbackEnhancedMutationSubmit(syntheticForm);
    expect(syntheticForm.getAttribute('data-error-code')).toBe('NETWORK_ERROR');
    expect(syntheticForm.getAttribute('kovo-error')).toBe('');
  });

  it('stamps upload progress without preserving stale indeterminate values', () => {
    const form = new FakeFormElement({ 'data-mutation': 'cart/add' }, { action: '/_m/cart/add' });
    const progress = new FakeElement({ value: '0' });
    form.progressElements.push(progress);

    updateUploadProgressElements(form, { loaded: 4, total: 8 });
    expect(progress.getAttribute('max')).toBe('100');
    expect(progress.getAttribute('value')).toBe('50');

    updateUploadProgressElements(form, { loaded: 4 });
    expect(progress.getAttribute('max')).toBe('100');
    expect(progress.getAttribute('value')).toBeNull();
  });
});
