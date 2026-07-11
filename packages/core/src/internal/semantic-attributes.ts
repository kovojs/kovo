/**
 * @internal Generated and semantic HTML attribute policy shared by compiler gates
 * and integration snapshot serialization (SPEC.md §4.8, §5.2 rule 3).
 */
export const SEMANTIC_ATTRIBUTE_MANIFEST = {
  /**
   * Framework-emitted stamps that do not represent authored visible HTML for
   * render-equivalence. Prefix entries cover generated attribute families.
   */
  generatedOnly: {
    attributes: [
      'command',
      'commandfor',
      'data-bind',
      'data-bind-list',
      'data-derive',
      'data-derive-attr',
      'data-kovo-module-allowlist',
      'kovo-c',
      'kovo-deps',
      'kovo-fragment-target',
      'kovo-key',
      'kovo-live-component',
      'kovo-param-types',
      'kovo-props',
      'kovo-state',
      'popovertarget',
      'popovertargetaction',
    ],
    prefixes: ['data-bind:', 'data-bind-prop:', 'data-p-', 'on:'],
  },

  /**
   * Kovo attributes preserved by semantic snapshots because they describe
   * app-visible binding, identity, routing, query, state, or error-channel
   * semantics.
   */
  semanticSnapshot: [
    'data-bind',
    'data-bind-list',
    'data-derive',
    'data-derive-attr',
    'data-error-code',
    'data-error-path',
    'data-route',
    'data-row',
    'data-state',
    'kovo-c',
    'kovo-deps',
    'kovo-fragment-target',
    'kovo-key',
    'kovo-query',
    'kovo-state',
  ],

  /**
   * Accessibility and user-facing form attributes kept by semantic snapshots.
   */
  accessible: [
    'alt',
    'aria-checked',
    'aria-current',
    'aria-disabled',
    'aria-expanded',
    'aria-hidden',
    'aria-invalid',
    'aria-label',
    'aria-level',
    'aria-pressed',
    'aria-selected',
    'checked',
    'disabled',
    'name',
    'placeholder',
    'role',
    'selected',
    'type',
    'value',
  ],

  /**
   * Behavioral and navigation attributes kept by semantic snapshots because
   * they define what the element does.
   */
  behavioral: ['action', 'formaction', 'href', 'method', 'src'],
} as const;

/** @internal */
export const GENERATED_ONLY_SEMANTIC_ATTRIBUTES =
  SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.attributes;

/** @internal */
export const GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES =
  SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.prefixes;

/** @internal */
export const KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES = SEMANTIC_ATTRIBUTE_MANIFEST.semanticSnapshot;

/** @internal */
export const ACCESSIBLE_SEMANTIC_ATTRIBUTES = SEMANTIC_ATTRIBUTE_MANIFEST.accessible;

/** @internal */
export const BEHAVIORAL_SEMANTIC_ATTRIBUTES = SEMANTIC_ATTRIBUTE_MANIFEST.behavioral;

const generatedOnlyAttributeNames = new Set<string>(GENERATED_ONLY_SEMANTIC_ATTRIBUTES);

/** @internal True when a framework-emitted attribute is ignored by render-equivalence. */
export function isGeneratedOnlySemanticAttribute(name: string): boolean {
  return (
    generatedOnlyAttributeNames.has(name) ||
    GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}
