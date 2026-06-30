import { describe, expect, it } from 'vitest';

import {
  ACCESSIBLE_SEMANTIC_ATTRIBUTES,
  BEHAVIORAL_SEMANTIC_ATTRIBUTES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTES,
  KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES,
  SEMANTIC_ATTRIBUTE_MANIFEST,
  isGeneratedOnlySemanticAttribute,
} from '../packages/core/src/internal/semantic-attributes.js';
import { KOVO_SEMANTIC_ATTRS } from '../packages/test/src/integration/semantic-snapshot.js';

describe('semantic attribute manifest', () => {
  it('exports non-empty generated-only, semantic-snapshot, behavioral, and accessible categories', () => {
    expect(SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.attributes.length).toBeGreaterThan(0);
    expect(SEMANTIC_ATTRIBUTE_MANIFEST.semanticSnapshot.length).toBeGreaterThan(0);
    expect(SEMANTIC_ATTRIBUTE_MANIFEST.behavioral.length).toBeGreaterThan(0);
    expect(SEMANTIC_ATTRIBUTE_MANIFEST.accessible.length).toBeGreaterThan(0);
  });

  it('semantic snapshot exports are sourced from the manifest', () => {
    expect(Array.isArray(KOVO_SEMANTIC_ATTRS)).toBe(true);
    expect(KOVO_SEMANTIC_ATTRS.length).toBeGreaterThan(0);
    expect(KOVO_SEMANTIC_ATTRS).toEqual([...KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES]);
  });

  it('classifies compiler-generated list binding stamps as generated-only', () => {
    expect(GENERATED_ONLY_SEMANTIC_ATTRIBUTES).toContain('data-bind-list');
    expect(KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES).toContain('data-bind-list');
    expect(isGeneratedOnlySemanticAttribute('data-bind-list')).toBe(true);
  });

  it('keeps intended app-visible snapshot attributes out of generated-only drift checks', () => {
    expect(KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES).toContain('kovo-query');
    expect(ACCESSIBLE_SEMANTIC_ATTRIBUTES).toContain('aria-label');
    expect(BEHAVIORAL_SEMANTIC_ATTRIBUTES).toContain('href');
    expect(isGeneratedOnlySemanticAttribute('kovo-query')).toBe(false);
    expect(isGeneratedOnlySemanticAttribute('aria-label')).toBe(false);
    expect(isGeneratedOnlySemanticAttribute('href')).toBe(false);
  });

  it('classifies generated attribute prefixes without source scraping', () => {
    expect(isGeneratedOnlySemanticAttribute('data-bind:value')).toBe(true);
    expect(isGeneratedOnlySemanticAttribute('data-bind-prop:checked')).toBe(true);
    expect(isGeneratedOnlySemanticAttribute('data-p-id')).toBe(true);
    expect(isGeneratedOnlySemanticAttribute('on:click')).toBe(true);
  });
});
