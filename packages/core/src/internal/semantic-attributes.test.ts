import { describe, expect, it } from 'vitest';

import {
  ACCESSIBLE_SEMANTIC_ATTRIBUTES,
  BEHAVIORAL_SEMANTIC_ATTRIBUTES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES,
  assertHtmlElementWireValueStable,
  assertHtmlWireValueStable,
  htmlAttributeWireValuePosture,
  htmlElementWireValueIssue,
  htmlTextWireValuePosture,
  htmlWireValueIssue,
  isGeneratedOnlySemanticAttribute,
  isHtmlWireValueStable,
  KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES,
  SEMANTIC_ATTRIBUTE_MANIFEST,
} from './semantic-attributes.js';

// @kovo-security-classifier-corpus html-wire-identity

describe('semantic attribute policy authority', () => {
  it('does not expose mutable render-equivalence classification policy', () => {
    const prefix = GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES[0]!;
    const changedPrefix = Reflect.set(GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES, 0, '');
    const changedSnapshot = Reflect.set(KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES, 0, 'data-attacker');

    try {
      expect(Object.isFrozen(SEMANTIC_ATTRIBUTE_MANIFEST)).toBe(true);
      expect(Object.isFrozen(SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly)).toBe(true);
      expect(Object.isFrozen(GENERATED_ONLY_SEMANTIC_ATTRIBUTES)).toBe(true);
      expect(Object.isFrozen(GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES)).toBe(true);
      expect(Object.isFrozen(KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES)).toBe(true);
      expect(Object.isFrozen(ACCESSIBLE_SEMANTIC_ATTRIBUTES)).toBe(true);
      expect(Object.isFrozen(BEHAVIORAL_SEMANTIC_ATTRIBUTES)).toBe(true);
      expect(changedPrefix).toBe(false);
      expect(changedSnapshot).toBe(false);
      expect(isGeneratedOnlySemanticAttribute('aria-label')).toBe(false);
    } finally {
      if (changedPrefix) Reflect.set(GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES, 0, prefix);
      if (changedSnapshot) Reflect.set(KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES, 0, 'data-bind');
    }
  });

  it('pins distinct DOM-identity and submitted-control wire boundaries', () => {
    // SPEC §13.2: LF survives HTML attribute parsing, but native form serialization rewrites it
    // to CRLF. Valid surrogate pairs survive UTF-8; lone UTF-16 code units do not.
    expect(isHtmlWireValueStable('record\n1', 'dom-identity')).toBe(true);
    expect(htmlWireValueIssue('record\n1', 'submitted-control')).toBe('line-feed');
    expect(htmlWireValueIssue('record\r1', 'dom-identity')).toBe('carriage-return');
    expect(htmlWireValueIssue('record\u00001', 'dom-identity')).toBe('nul');
    expect(htmlWireValueIssue('record\ud8001', 'dom-identity')).toBe('unpaired-surrogate');
    expect(htmlWireValueIssue('record\ud83d\ude001', 'submitted-control')).toBeUndefined();
    expect(htmlWireValueIssue('first\r\nsecond', 'multiline-content')).toBeUndefined();
    expect(htmlWireValueIssue('first\u0000second', 'multiline-content')).toBe('nul');
    expect(() =>
      assertHtmlWireValueStable('record\n1', 'submitted-control', 'input[value]'),
    ).toThrow(/KV236.*SPEC §13\.2/u);
  });

  it('classifies only authority-bearing attributes and form-derived text', () => {
    expect(htmlAttributeWireValuePosture('form', 'id')).toBe('dom-identity');
    expect(htmlAttributeWireValuePosture('input', 'name')).toBe('submitted-control');
    expect(htmlAttributeWireValuePosture('button', 'value')).toBe('submitted-control');
    expect(htmlAttributeWireValuePosture('section', 'kovo-fragment-target')).toBe('dom-identity');
    expect(htmlAttributeWireValuePosture('output', 'data-error-path')).toBe('dom-identity');
    expect(htmlAttributeWireValuePosture('kovo-query', 'settles')).toBe('dom-identity');
    expect(htmlAttributeWireValuePosture('kovo-note', 'title')).toBeUndefined();
    expect(htmlAttributeWireValuePosture('kovo-note', 'name')).toBeUndefined();
    expect(htmlAttributeWireValuePosture('p', 'title')).toBeUndefined();
    expect(htmlTextWireValuePosture('textarea', false)).toBe('multiline-content');
    expect(htmlTextWireValuePosture('option', false)).toBe('option-fallback');
    expect(htmlTextWireValuePosture('option', true)).toBeUndefined();
  });

  it('rejects only option fallback whitespace that the browser strips or collapses', () => {
    expect(isHtmlWireValueStable('United States', 'option-fallback')).toBe(true);
    for (const unstable of [
      ' United States',
      'United  States',
      'United States ',
      'United\tStates',
    ]) {
      expect(htmlWireValueIssue(unstable, 'option-fallback')).toBe('option-whitespace');
    }
  });

  it('pins the cross-attribute hidden _charset_ substitution without widening ordinary fields', () => {
    // SPEC §13.2/§6.6: HTML replaces this hidden control's submitted value with `UTF-8`.
    expect(htmlElementWireValueIssue('input', 'hidden', '_charset_')).toBe(
      'reserved-charset-hidden-control',
    );
    expect(htmlElementWireValueIssue('INPUT', 'HiDdEn', '_ChArSeT_')).toBe(
      'reserved-charset-hidden-control',
    );
    expect(htmlElementWireValueIssue('input', 'text', '_charset_')).toBeUndefined();
    expect(htmlElementWireValueIssue('input', 'hidden', 'charset')).toBeUndefined();
    expect(htmlElementWireValueIssue('kovo-input', 'hidden', '_charset_')).toBeUndefined();
    expect(() =>
      assertHtmlElementWireValueStable('input', 'hidden', '_charset_', 'test hidden control'),
    ).toThrow(/KV236.*_charset_.*SPEC §13\.2.*SPEC §6\.6/u);
  });
});
