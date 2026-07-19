/**
 * @internal Pure-data generated and semantic HTML attribute policy.
 *
 * Keep this module dependency-free so build-time generators can consume the same denominator as
 * runtime/compiler gates without evaluating the security-intrinsic bootstrap.
 */
const generatedOnlyAttributes = [
  'command',
  'commandfor',
  'data-bind',
  'data-bind-list',
  'data-derive',
  'data-derive-attr',
  'data-enhance',
  'data-key',
  'data-kovo-critical-href',
  'data-kovo-csp-hash',
  'data-kovo-deferred-style', // fixed high-impact denominator witness
  'data-kovo-module-allowlist',
  'data-kovo-native-fallback',
  'data-kovo-region-priority',
  'data-kovo-run',
  'data-kovo-stream',
  'data-kovo-style-source',
  'data-mutation', // fixed high-impact denominator witness
  'data-mutation-stream',
  'data-plan',
  'data-stream',
  'data-stream-renderer',
  'data-stream-state',
  'data-stream-text',
  'enhance',
  'kovo-c',
  'kovo-deps',
  'kovo-error',
  'kovo-fragment-target',
  'kovo-i18n',
  'kovo-key',
  'kovo-live-component',
  'kovo-live-token',
  'kovo-nav-components',
  'kovo-nav-kind',
  'kovo-nav-name',
  'kovo-nav-queries',
  'kovo-nav-segment',
  'kovo-param-types',
  'kovo-pending',
  'kovo-props',
  'kovo-query',
  'kovo-stamp',
  'kovo-state',
  'popovertarget',
  'popovertargetaction',
] as const;

const generatedOnlyPrefixes = ['data-bind:', 'data-bind-prop:', 'data-p-', 'on:'] as const;

// Browser-native command/popover attributes and the typed `enhance` JSX flag are intentionally
// absent: dynamic values cannot retarget them, but authored literal/typed forms remain valid.
const compilerOwnedResidualAttributes = [
  'data-bind',
  'data-bind-list',
  'data-derive',
  'data-derive-attr',
  'data-enhance',
  'data-key',
  'data-kovo-critical-href',
  'data-kovo-csp-hash',
  'data-kovo-deferred-style',
  'data-kovo-module-allowlist',
  'data-kovo-native-fallback',
  'data-kovo-region-priority',
  'data-kovo-run',
  'data-kovo-stream',
  'data-kovo-style-source',
  'data-mutation',
  'data-mutation-stream',
  'data-plan',
  'data-stream',
  'data-stream-renderer',
  'data-stream-state',
  'data-stream-text',
  'kovo-c',
  'kovo-deps',
  'kovo-error',
  'kovo-fragment-target',
  'kovo-i18n',
  'kovo-key',
  'kovo-live-component',
  'kovo-live-token',
  'kovo-nav-components',
  'kovo-nav-kind',
  'kovo-nav-name',
  'kovo-nav-queries',
  'kovo-nav-segment',
  'kovo-param-types',
  'kovo-pending',
  'kovo-props',
  'kovo-query',
  'kovo-stamp',
  'kovo-state',
] as const;

export const SEMANTIC_ATTRIBUTE_MANIFEST = {
  generatedOnly: {
    attributes: generatedOnlyAttributes,
    prefixes: generatedOnlyPrefixes,
  },
  compilerOwnedResidual: {
    attributes: compilerOwnedResidualAttributes,
    prefixes: generatedOnlyPrefixes,
  },
  /**
   * Names stripped from caller-owned JSX/rich-HTML records. This is deliberately broader than
   * `generatedOnly`: `data-state` is a valid typed JSX/dynamic-binding output, but an opaque CMS
   * record must not mint it alongside Kovo routing metadata.
   */
  controlPlane: {
    attributes: [...generatedOnlyAttributes, 'data-state', 'mutation', 'stream', 'streamtext'],
    prefixes: [...generatedOnlyPrefixes, 'data-kovo-', 'data-stream-', 'kovo-'],
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

/** @internal Residual lowered-IR names forbidden in app-authored TSX. */
export const COMPILER_OWNED_RESIDUAL_ATTRIBUTES =
  SEMANTIC_ATTRIBUTE_MANIFEST.compilerOwnedResidual.attributes;

/** @internal Residual lowered-IR prefixes forbidden in app-authored TSX. */
export const COMPILER_OWNED_RESIDUAL_ATTRIBUTE_PREFIXES =
  SEMANTIC_ATTRIBUTE_MANIFEST.compilerOwnedResidual.prefixes;

/** @internal Exact names stripped from untrusted control-plane carriers. */
export const KOVO_CONTROL_PLANE_ATTRIBUTES = SEMANTIC_ATTRIBUTE_MANIFEST.controlPlane.attributes;

/** @internal Namespace prefixes stripped from untrusted control-plane carriers. */
export const KOVO_CONTROL_PLANE_ATTRIBUTE_PREFIXES =
  SEMANTIC_ATTRIBUTE_MANIFEST.controlPlane.prefixes;
