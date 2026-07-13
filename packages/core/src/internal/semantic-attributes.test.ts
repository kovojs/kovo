import { describe, expect, it } from 'vitest';

import {
  ACCESSIBLE_SEMANTIC_ATTRIBUTES,
  BEHAVIORAL_SEMANTIC_ATTRIBUTES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES,
  isGeneratedOnlySemanticAttribute,
  KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES,
  SEMANTIC_ATTRIBUTE_MANIFEST,
} from './semantic-attributes.js';

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
});
