export type IntegrationOwnerAxis =
  | 'a11y'
  | 'browser'
  | 'compiler'
  | 'data'
  | 'perf'
  | 'security'
  | 'server';

export type IntegrationCiTier = 'local-only' | 'required' | 'scheduled';

export interface IntegrationSpecInventoryEntry {
  axis: IntegrationOwnerAxis;
  reason: string;
  tier: IntegrationCiTier;
}

type InventoryRule = IntegrationSpecInventoryEntry & {
  match: RegExp;
};

const REQUIRED_RULES: readonly InventoryRule[] = [
  {
    axis: 'a11y',
    match: /^a11y-/,
    reason: 'terminal accessibility behavior and ARIA/user-visible error surfaces',
    tier: 'required',
  },
  {
    axis: 'security',
    match:
      /^(auth|csrf|required|endpoint|forbidden|guarded|query-read-guard|session|storage|webhook|xss|sanitized|unscoped|mutation-targets-malicious)/,
    reason: 'auth, CSRF, ownership, header, webhook, or XSS security posture',
    tier: 'required',
  },
  {
    axis: 'browser',
    match:
      /^(bfcache|broadcast|browser|client|details|dialog|enhanced|hmr|loader|morph|native|on-|popover|speculation|typed-link|view-transition)/,
    reason: 'browser runtime, navigation, HMR, morph, or progressive enhancement behavior',
    tier: 'required',
  },
  {
    axis: 'data',
    match:
      /^(concurrent|derive|exempt|idempotent|manual|multi-domain|mutation-handler|mutation-idempotency|optimistic|pg|post-commit|query|redirect|render-error|shared-query|stock|table|touch|typed-error|validation)/,
    reason: 'query, mutation, optimistic, validation, or database-backed behavior',
    tier: 'required',
  },
  {
    axis: 'compiler',
    match:
      /^(binding|children|counter|deferred|diagnostic|event|explain|fixpoint|fragment|handler|kovo-defer|late-fragment|layout|module-scope|multi-instance|nullable|opaque|patched|primitive|same-dom|scoped|stamp|static-home|structured-document|trailing-slash)/,
    reason: 'compiler lowering, emitted wiring, diagnostics, fragments, or authored TSX semantics',
    tier: 'required',
  },
  {
    axis: 'server',
    match:
      /^(asset|document|get-form|http|mutation-prg|mutation-response|not-found|respond|static-export)/,
    reason: 'server routing, document shell, static export, response, or asset behavior',
    tier: 'required',
  },
  {
    axis: 'perf',
    match: /^scale-/,
    reason: 'large-list scale smoke coverage',
    tier: 'required',
  },
  {
    axis: 'data',
    match: /^streaming-chat/,
    reason: 'streaming mutation and final-truth data flow',
    tier: 'required',
  },
];

export function integrationSpecInventoryEntry(
  specFileName: string,
): IntegrationSpecInventoryEntry | undefined {
  const name = specFileName.replace(/^.*\//, '').replace(/\.spec\.ts$/, '');
  const match = REQUIRED_RULES.find((rule) => rule.match.test(name));
  if (!match) return undefined;
  const { axis, reason, tier } = match;
  return { axis, reason, tier };
}
