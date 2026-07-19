/**
 * @internal Pure-data generated and semantic HTML attribute policy.
 *
 * Keep this module dependency-free so build-time generators can consume the same denominator as
 * runtime/compiler gates without evaluating the security-intrinsic bootstrap.
 */
export const SEMANTIC_ATTRIBUTE_MANIFEST = {
  generatedOnly: {
    attributes: [
      'command',
      'commandfor',
      'data-bind',
      'data-bind-list',
      'data-derive',
      'data-derive-attr',
      'data-kovo-module-allowlist',
      'data-stream-renderer',
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
  behavioral: ['action', 'formaction', 'href', 'method', 'src'],
} as const;

/** @internal Exact framework-emitted attribute names. */
export const GENERATED_ONLY_SEMANTIC_ATTRIBUTES =
  SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.attributes;

/** @internal Framework-emitted attribute-name prefixes. */
export const GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES =
  SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.prefixes;
