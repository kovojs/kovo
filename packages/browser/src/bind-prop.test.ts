import { describe, expect, it } from 'vitest';

import { applyBindProp, canonicalBindProp } from './bind-prop.js';

describe('data-bind-prop allowlist + coercion (SPEC §4.8)', () => {
  it('resolves the canonical cased property for allowlisted suffixes', () => {
    expect(canonicalBindProp('checked')).toBe('checked');
    expect(canonicalBindProp('indeterminate')).toBe('indeterminate');
    expect(canonicalBindProp('selected')).toBe('selected');
    expect(canonicalBindProp('open')).toBe('open');
    expect(canonicalBindProp('value')).toBe('value');
    // HTML lowercases attribute names: data-bind-prop:scrollTop → :scrolltop.
    expect(canonicalBindProp('scrolltop')).toBe('scrollTop');
    expect(canonicalBindProp('scrollleft')).toBe('scrollLeft');
    // Also accepts the canonical cased form directly.
    expect(canonicalBindProp('scrollTop')).toBe('scrollTop');
  });

  it('rejects non-allowlisted and unsafe-sink properties (KV236 wall)', () => {
    expect(canonicalBindProp('innerHTML')).toBeNull();
    expect(canonicalBindProp('outerHTML')).toBeNull();
    expect(canonicalBindProp('srcdoc')).toBeNull();
    expect(canonicalBindProp('onclick')).toBeNull();
    expect(canonicalBindProp('textContent')).toBeNull();
    expect(canonicalBindProp('className')).toBeNull();
  });

  it('coerces boolean-presence values to a boolean property', () => {
    const el: { checked?: boolean } = { checked: false };
    applyBindProp(el, 'checked', '');
    expect(el.checked).toBe(true);
    applyBindProp(el, 'checked', null);
    expect(el.checked).toBe(false);
    applyBindProp(el, 'checked', true);
    expect(el.checked).toBe(true);
    applyBindProp(el, 'checked', false);
    expect(el.checked).toBe(false);
  });

  it('coerces number properties for scroll positions', () => {
    const el: { scrollTop?: number } = { scrollTop: 0 };
    applyBindProp(el, 'scrolltop', '120');
    expect(el.scrollTop).toBe(120);
    applyBindProp(el, 'scrolltop', null);
    expect(el.scrollTop).toBe(0);
  });

  it('coerces value to a string property', () => {
    const el: { value?: string } = { value: '' };
    applyBindProp(el, 'value', 42);
    expect(el.value).toBe('42');
    applyBindProp(el, 'value', null);
    expect(el.value).toBe('');
  });

  it('skips value writes on <progress> (null = indeterminate, not .value="")', () => {
    const el: { value?: string; localName?: string } = { value: '50', localName: 'progress' };
    applyBindProp(el, 'value', null);
    // The companion data-bind:value attribute owns progress; the prop write must
    // not force it determinate by setting .value = ''.
    expect(el.value).toBe('50');
    // Non-progress value writes still apply.
    const input: { value?: string; localName?: string } = { value: '50', localName: 'input' };
    applyBindProp(input, 'value', null);
    expect(input.value).toBe('');
  });

  it('is a no-op for elements that do not own the property', () => {
    const el: Record<string, unknown> = {};
    applyBindProp(el, 'checked', '');
    expect(el.checked).toBeUndefined();
  });

  it('ignores non-allowlisted props even when the element exposes them', () => {
    const el: Record<string, unknown> = { innerHTML: 'safe' };
    applyBindProp(el, 'innerHTML', '<script>alert(1)</script>');
    expect(el.innerHTML).toBe('safe');
  });
});
