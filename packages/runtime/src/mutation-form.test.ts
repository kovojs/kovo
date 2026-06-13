import { describe, expect, it, vi } from 'vitest';

import {
  closestEnhancedMutationForm,
  enhancedMutationFormSelector,
  fallbackEnhancedMutationSubmit,
  isEnhancedForm,
  updateUploadProgressElements,
} from './mutation-form.js';

class FakeElement {
  action = '/_m/cart/add';
  readonly children: FakeElement[] = [];

  constructor(private readonly attrs: Record<string, string | null> = {}) {}

  closest(selector: string): FakeElement | null {
    return selector === enhancedMutationFormSelector ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  querySelectorAll(selector: string): Iterable<FakeElement> {
    return selector === '[fw-upload-progress]' ? this.children : [];
  }

  removeAttribute(name: string): void {
    delete this.attrs[name];
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
}

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

  it('falls back to native submit or visible form error attributes', () => {
    const submit = vi.fn();
    const nativeForm = new FakeElement({ 'data-mutation': 'cart/add' });
    Object.assign(nativeForm, { submit });

    fallbackEnhancedMutationSubmit(nativeForm);
    expect(submit).toHaveBeenCalledTimes(1);

    const syntheticForm = new FakeElement({ 'data-mutation': 'cart/add' });
    fallbackEnhancedMutationSubmit(syntheticForm);
    expect(syntheticForm.getAttribute('data-error-code')).toBe('NETWORK_ERROR');
    expect(syntheticForm.getAttribute('fw-error')).toBe('');
  });

  it('stamps upload progress without preserving stale indeterminate values', () => {
    const form = new FakeElement({ 'data-mutation': 'cart/add' });
    const progress = new FakeElement({ value: '0' });
    form.children.push(progress);

    updateUploadProgressElements(form, { loaded: 4, total: 8 });
    expect(progress.getAttribute('max')).toBe('100');
    expect(progress.getAttribute('value')).toBe('50');

    updateUploadProgressElements(form, { loaded: 4 });
    expect(progress.getAttribute('max')).toBe('100');
    expect(progress.getAttribute('value')).toBeNull();
  });
});
