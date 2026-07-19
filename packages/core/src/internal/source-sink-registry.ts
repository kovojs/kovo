import {
  freezeSecurityValue,
  securityGetOwnPropertyDescriptor,
  securityObjectKeys,
  securityOwnArrayEntry,
} from '#security-witness-intrinsics';

import { SAFE_URL_SCHEMES, URL_ATTRIBUTE_NAMES } from './security-url.js';
import type { SecurityOperationKind } from './security-operation-ir.js';
import {
  ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES,
  SAFE_IFRAME_SANDBOX_TOKENS,
} from './sink-policy.js';

/** @internal Canonical finite browser-control proof carried by the HTML C9 row. */
export interface FiniteBrowserControlSinkProof {
  readonly controlTuples: typeof ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES;
  readonly iframeSandboxTokens: typeof SAFE_IFRAME_SANDBOX_TOKENS;
}

/** @internal */
export interface SourceSinkInventoryEntry {
  consumers: readonly string[];
  context: string;
  diagnostic: string;
  escapeHatch: string;
  /** Present only when this sink owns the canonical finite browser-control denominator. */
  finiteBrowserControlProof?: FiniteBrowserControlSinkProof;
  firstParser: string;
  guard: string;
  runtimeGuard: string;
  schema: string;
  sink: string;
  source: string;
  specAnchor: string;
  testEvidence: readonly string[];
  trust: string;
}

/** @internal */
export interface DangerousSinkToken {
  owner: string;
  token: string;
}

/** @internal */
export interface SourceSinkCorpusEntry {
  expected: string;
  family: string;
  negativeTestEvidence: readonly string[];
  payloads: readonly string[];
  positiveTestEvidence: readonly string[];
}

/** @internal */
export interface SourceSinkFailClosedCase {
  guard: string;
  shape: string;
  testEvidence: readonly string[];
}

/** @internal */
export interface SourceSinkParityPair {
  claim: string;
  pair: string;
  testEvidence: readonly string[];
}

/** @internal */
export interface SourceSinkRuntimeChokepoint {
  chokepoint: string;
  guard: string;
  testEvidence: readonly string[];
}

/** @internal */
export interface SourceSinkRuntimeEvidence {
  failClosedCases: readonly SourceSinkFailClosedCase[];
  parityPairs: readonly SourceSinkParityPair[];
  runtimeChokepoints: readonly SourceSinkRuntimeChokepoint[];
}

/** @internal DEC-E boundary-crossing mechanism taxonomy for C9 sink inventory. */
export type BoundaryCrossingMechanism = 'reconstruct' | 'box' | 'own';

/** @internal C9 owner-provenance posture for app-addressable stateful keys. */
export type BoundaryKeyScoping =
  | 'database-principal-policy'
  | 'runtime-opaque-scoped-key'
  | 'not-stateful-keyed';

/** @internal Canonical proof-surface row for C9 boundary-crossing sinks. */
export interface BoundaryCrossingSinkInventoryEntry {
  /** Complete source/sink census families discharged by this reviewed boundary row. */
  censusFamilies: readonly SourceSinkInventoryEntry['sink'][];
  hostileValueEvidence: readonly string[];
  /** Mandatory classification of how this door isolates app-addressable persisted state. */
  keyScoping: BoundaryKeyScoping;
  mechanism: BoundaryCrossingMechanism;
  mechanismDetail: string;
  /** Stable team/module ownership for gaps and incident follow-up. */
  owner: string;
  /** Finite compiler-owned effects whose real sink is discharged by this row. */
  operationKinds: readonly SecurityOperationKind[];
  proofEvidence: readonly string[];
  /** Root command that fails when this row or its cited proof drifts. */
  proofGate: string;
  sink: string;
  soleDoor: string;
  specAnchor: string;
}

function freezeRegistryAuthority<T extends object>(value: T, depth = 0): T {
  if (depth > 8) throw new TypeError('Kovo source/sink registry nesting is invalid.');
  const keys = securityObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = securityOwnArrayEntry(keys, index);
    if (!key.ok) throw new TypeError('Kovo source/sink registry keys must be dense.');
    const descriptor = securityGetOwnPropertyDescriptor(value, key.value);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Kovo source/sink registry entries must be own data properties.');
    }
    if (typeof descriptor.value === 'object' && descriptor.value !== null) {
      freezeRegistryAuthority(descriptor.value, depth + 1);
    }
  }
  return freezeSecurityValue(value);
}

const existingEvidence = {
  browserOutput: 'packages/browser/src/security-output.test.ts',
  browserSelector: 'packages/browser/src/inline-loader-fragment-target.test.ts',
  cookie: 'packages/server/src/cookies.test.ts',
  endpoint: 'packages/server/src/endpoint.test.ts',
  outputContext: 'packages/compiler/src/output-context-security.test.ts',
  query: 'packages/browser/src/broadcast-replay.test.ts',
  response: 'packages/server/src/response.test.ts',
  route: 'packages/server/src/match.test.ts',
  staticExport: 'packages/server/src/static-export-output.test.ts',
  storage: 'packages/core/src/storage.test.ts',
} as const;

/**
 * SPEC.md §4.8, §9.1, and §11.4 make these framework-owned source/sink facts
 * auditable. This registry lives in core-internal code so compiler, server,
 * browser, and CLI checks can consume the same facts.
 *
 * @internal
 */
export function frameworkSourceSinkInventory(): readonly SourceSinkInventoryEntry[] {
  return sourceSinkInventory;
}

/** @internal */
export function dangerousSinkTokens(): readonly DangerousSinkToken[] {
  return driftTokens;
}

/** @internal */
export function sourceSinkRedCorpus(): readonly SourceSinkCorpusEntry[] {
  return redCorpus;
}

/** @internal */
export function sourceSinkRuntimeEvidence(): SourceSinkRuntimeEvidence {
  return runtimeEvidence;
}

/** @internal */
export function boundaryCrossingSinkInventory(): readonly BoundaryCrossingSinkInventoryEntry[] {
  return boundaryCrossingInventory;
}

const sourceSinkInventory: readonly SourceSinkInventoryEntry[] = [
  {
    consumers: ['server-renderer', 'browser-output-helpers', 'compiler-output-context-facts'],
    context: 'html.text+attribute+url+script-json+style+srcdoc',
    diagnostic: 'KV236',
    escapeHatch: 'trustedHtml|trustedUrl',
    finiteBrowserControlProof: {
      controlTuples: ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES,
      iframeSandboxTokens: SAFE_IFRAME_SANDBOX_TOKENS,
    },
    firstParser: 'tsx-lowered-output-context',
    guard: `contextual-encoding+url-scheme-allowlist:${SAFE_URL_SCHEMES.join('|')}`,
    runtimeGuard:
      'server-renderer+browser-output-helpers-drop-unsafe-url-attrs+server-meta-refresh-first-attribute-pair+canonical-finite-browser-control-tuples+finite-iframe-sandbox-token-policy',
    schema: [
      `compiler-output-context-facts:urlAttrs=${URL_ATTRIBUTE_NAMES.join('|')}`,
      'JSX-text',
      'attribute-values',
      'rawHtml',
      'trustedHtml',
      'fragment-HTML',
      'morph-innerHTML-insertAdjacentHTML',
      'script-json-island',
      'kovo-query',
      'kovo-text',
      'srcdoc',
      'event-handler-attributes',
      'meta-refresh-first-http-equiv-pair',
      'live-property-writes',
      'template-stamps',
      'rich-text-registry',
    ].join('|'),
    sink: 'html.dom.output',
    source:
      'server-render|client-query|client-state|template-stamp|data-stream-text|streamed-model-output|compiler-read-app-source|db-user-text',
    specAnchor: 'SPEC.md#4.8;SPEC.md#5.2',
    testEvidence: [
      existingEvidence.outputContext,
      existingEvidence.browserOutput,
      'packages/core/src/sink-policy.test.ts',
      'packages/compiler/src/pair-dependent-runtime-sinks.security.test.ts',
      'packages/browser/src/inline-loader-security.test.ts',
      'packages/browser/src/response-fragment-apply.browser.test.ts',
      'packages/server/src/jsx-runtime.test.ts',
      'tests/integration/specs/meta-refresh-sink.spec.ts',
    ],
    trust: 'untrusted-unless-branded',
  },
  {
    consumers: ['structured-document-primitives', 'document-assembly'],
    context: 'document.head.body-start.body-end.script.style.link.attrs',
    diagnostic: 'KV236|KV424',
    escapeHatch: 'InlineScript|InlineStyle|trustedHtml|trustedUrl',
    firstParser: 'structured-document-primitives',
    guard: `typed-document-primitives+url-scheme-allowlist:${SAFE_URL_SCHEMES.join('|')}`,
    runtimeGuard: 'server-document-assembly-csp-enrollment',
    schema:
      'Document|Head|BodyStart|BodyEnd|HtmlAttrs|BodyAttrs|Meta|Link|StylesheetLink|FontPreload|ModulePreload|InlineScript|InlineStyle',
    sink: 'document.shell.output',
    source:
      'app-document-TSX|inline-script-source|inline-style-source|font-preload-url|modulepreload-url|body-end-ui',
    specAnchor: 'SPEC.md#4.8;SPEC.md#5.2;SPEC.md#9.5',
    testEvidence: ['packages/server/src/document.test.ts'],
    trust: 'structured-author-contribution',
  },
  {
    consumers: ['route-matcher', 'mutation-redirects', 'inline-loader', 'client-module-loader'],
    context: 'url.navigation.redirect.module.selector',
    diagnostic: 'KV220|KV236|KV228',
    escapeHatch: 'trustedUrl|external-route-opt-out|compiler-owned-handler-ref',
    firstParser: 'route-registry+url-parser+fragment-target-registry',
    guard: 'route-registry+safeSameOrigin+normalizePathname+selector-escape',
    runtimeGuard: 'sanitizeNext+route-matcher+fragment-target-escape+versioned-client-modules',
    schema:
      'route().params|route().search|GET-form-url-state|URL-fragments-hashes|href|src|action|formaction|poster|ping|xlink:href|meta-url-content|redirect-Location|auth-next|route-normalization-redirects|enhanced-navigation-fetch-targets|dynamic-import-handler-refs|immutable-c-v-client-module-URLs|querySelector|hash-scrolling|static-export-reserved-refs|handler-ref-registry|safe-url-schemes',
    sink: 'url.navigation.selector',
    source:
      'route().params|route().search|GET-form-url-state|auth.next|fragment-targets|URL-fragments-hashes|handler-refs',
    specAnchor: 'SPEC.md#4.7;SPEC.md#4.8;SPEC.md#6.2;SPEC.md#9.5',
    testEvidence: [existingEvidence.route, existingEvidence.browserSelector],
    trust: 'cross-trust-url-state',
  },
  {
    consumers: ['server-renderer', 'stylex-extractor', 'browser-style-writer'],
    context: 'css.style.attribute.text.theme.keyframe',
    diagnostic: 'KV236|KV424',
    escapeHatch: 'trustedCss-not-public|compiler-owned-stylex-output',
    firstParser: 'compiler-style-context+StyleX-extractor',
    guard: 'style-context-encoding+no-raw-style-escape-hatch',
    runtimeGuard: 'browser-style-property-writer+unsafe-url-attr-drop',
    schema:
      'style-attribute|style-text|raw-CSS|style-props|StyleX-extraction|CSS-custom-properties|url()-inside-CSS|view-transition-name|runtime-style-property-writers|theme-config|generated-keyframe-theme-output|keyframe-input',
    sink: 'css.style.output',
    source:
      'style-props|StyleX-extraction|CSS-custom-properties|theme-config|generated-keyframes|compiler-read-app-source',
    specAnchor: 'SPEC.md#4.8;SPEC.md#5.2',
    testEvidence: [existingEvidence.outputContext, existingEvidence.browserOutput],
    trust: 'author-trusted-style-shape-user-text-untrusted',
  },
  {
    consumers: [
      'response-builder',
      'configured-error-shell-builder',
      'cookie-builder',
      'raw-endpoint-finalizer',
      'static-export-header-sink',
      'adapter-header-conversion',
      'generated-node-vercel-adapters',
    ],
    context: 'http.headers.cookies.redirects',
    diagnostic: 'KV415',
    escapeHatch: 'endpoint-raw-response-body-only(no-transport-header-authority)',
    firstParser:
      'respond-builder+configured-error-shell-builder+cookie-serializer+app-response-header-classifier+response-transport-header-classifier',
    guard:
      'direct-app-header-allowlist+dedicated-field-options+typed-cookie-builder+transport-owned-header-deny-set',
    runtimeGuard:
      'reject-unknown-direct-app-names+reject-cr-lf-nul-controls+content-disposition-bidi-neutralization+reject-framing-hop-by-hop+structural-cookie-serialization+browser-state-private-no-store-floor+static-export-browser-state-rejection+adapter-browser-state-private-no-store-floor',
    schema:
      'mutation-response-header-channel|route-outcome-direct-headers(Cache-Control,Last-Modified,Vary)|configured-error-shell-direct-headers(Cache-Control,Last-Modified,Vary)|raw-endpoint-Response|static-export-headers|Set-Cookie|Clear-Site-Data|Content-Type|ETag|Content-Disposition|Location|Retry-After|Kovo-*|Content-Length|Connection|Keep-Alive|Proxy-Connection|TE|Trailer|Transfer-Encoding|Upgrade|Proxy-Authenticate|Proxy-Authorization|HTTP2-Settings|Node-Bun-Workers-header-conversion',
    sink: 'http.header.cookie',
    source:
      'mutation-response-channel|route-outcome|configured-error-shell|raw-endpoint-response|static-export-config|session-provider|request.headers|cookies|redirect-target|app-config-env-values',
    specAnchor: 'SPEC.md#9.1;SPEC.md#11.3',
    testEvidence: [
      existingEvidence.cookie,
      existingEvidence.response,
      'packages/server/src/response-posture.test.ts',
      'packages/server/src/app-dispatch.test.ts',
      'packages/server/src/node.test.ts',
      'packages/server/src/build.test.ts',
      'packages/server/src/static-export-headers.test.ts',
      'packages/server/src/static-export-response.test.ts',
    ],
    trust: 'transport-metadata',
  },
  {
    consumers: ['endpoint-dispatcher', 'webhook-verifier', 'csrf-gate', 'replay-store'],
    context: 'endpoint.webhook.raw-request',
    diagnostic: 'KV418|KV423',
    escapeHatch: 'endpoint({csrf:false,reason})|webhook({verify:none,reason})',
    firstParser: 'endpoint-dispatcher-raw-request+webhook-verify-before-parse',
    guard: 'csrf-or-machine-verifier+raw-bytes-before-parse',
    runtimeGuard: 'dispatcher-endpoint-auth+webhook-verify+replay-store',
    schema:
      'endpoint-raw-Response|webhook-responses|/_q-typed-reads|SSE-live-query-pushes|BroadcastChannel-rebroadcast|HMR-dev-refresh-endpoints|mutation-defer-streams|Kovo-Changes|fragment-target-selection|endpoint-method+path+body-posture|webhook-input+provider-headers-signatures+idempotency',
    sink: 'ingress.endpoint.webhook',
    source:
      'request.headers|cookies|raw-request-bodies|endpoint-webhook-bodies|webhook-provider-headers-signatures|FormData|mutation-form-input',
    specAnchor: 'SPEC.md#9.1;SPEC.md#11.4',
    testEvidence: [existingEvidence.endpoint],
    trust: 'browser-authority-or-machine-authority',
  },
  {
    consumers: ['query-endpoint', 'browser-broadcast', 'live-query-sse', 'fragment-targets'],
    context: 'query.live.cache.broadcast.fragment',
    diagnostic: 'KV311|KV416',
    escapeHatch: 'renderOnce|await-fragment|disableServerRefresh',
    firstParser: 'typed-query-read-endpoint+browser-live-envelope-parser',
    guard: 'guard-recheck+private-cache+principal-fingerprint+build-token',
    runtimeGuard: 'typed-read-endpoint+BroadcastChannel-principal-discard+SSE-guard-recheck',
    schema:
      '/_q/search-args+query-shape+fragment-target-registry+Kovo-Targets+Kovo-Live-Targets+render-plan-token',
    sink: 'transport.query.live.broadcast',
    source:
      '/_q/search-args|Kovo-Targets|Kovo-Live-Targets|fragment-targets|data-stream-text|BroadcastChannel|SSE|req.session',
    specAnchor: 'SPEC.md#4.9;SPEC.md#9.3;SPEC.md#9.4',
    testEvidence: [existingEvidence.query],
    trust: 'session-scoped-private-data',
  },
  {
    consumers: ['storage-adapter', 'respond-file-stream', 'static-export-writer'],
    context: 'file.storage.path.static-export',
    diagnostic: 'KV424',
    escapeHatch: 'respond.file|respond.stream|storage-adapter',
    firstParser: 'FileSchema+storage-key-parser+static-export-route-graph',
    guard: 'path-containment+attachment-nosniff+static-export-reference-check',
    runtimeGuard:
      'safe-content-disposition+upload-and-wire-bidi-filename-neutralization+reserved-dynamic-endpoint-refusal+storage-key-validation',
    schema:
      'FileSchema|StoredFile|upload-schema-storage|storage-keys-metadata|filesystem-S3-adapters|respond.file|respond.stream|static-export-output-paths|Vite-manifest-asset-copies|generated-graph-output-files|static-export-route-paths-assets-manifests|storage-key|content-disposition-filename',
    sink: 'file.storage.static-export',
    source:
      'file-upload-metadata|file-upload-bytes|static-export-route-paths-assets-manifests|route-paths|asset-manifest|storage-key|app-config-env-values',
    specAnchor: 'SPEC.md#9.5;SPEC.md#11.4',
    testEvidence: [existingEvidence.storage, existingEvidence.staticExport],
    trust: 'filesystem-and-object-storage-boundary',
  },
  {
    consumers: ['guard-chain', 'query-cache', 'session-provider', 'drizzle-observed-shapes'],
    context: 'auth.idor.session.owner-scope',
    diagnostic: 'KV414',
    escapeHatch: 'public-read-justification',
    firstParser: 'request-shell-session-provider+guard-refinement',
    guard: 'authed+owns()+owner-table-scope',
    runtimeGuard: 'guard-refinement+runtime-observed-read-write-cross-check',
    schema:
      'req.session|owner-annotated-table-reads-writes|guard-refinement-results|session-provider-cookies|unauthenticated-redirects|CSRF-exempt-mutations-endpoints|webhook-verify-none|replay-stores|rate-limit-keys|query-cacheability|owner:domain|guard-chain|scope-audit',
    sink: 'auth.data-access',
    source: 'req.session|req.db-records|route-params|query-args',
    specAnchor: 'SPEC.md#6.2;SPEC.md#10.3;SPEC.md#11.2',
    testEvidence: ['packages/cli/src/index.kovo-explain.test.ts'],
    trust: 'principal-derived',
  },
  {
    consumers: [
      'better-auth-fixed-binding-constructors',
      'better-auth-routed-credential-handlers',
      'better-auth-session-provider',
      'better-auth-password-hash-verify',
      'better-auth-mount-adapter',
      'better-auth-rate-limit-storage',
      'better-auth-cookie-forwarders',
    ],
    context: 'auth.credential.secret.non-egress',
    diagnostic: 'KV439',
    escapeHatch: 'none',
    firstParser: 'fixed-binding-option-validation+credential-consumer-contract-census',
    guard: 'exact-runtime-consumer-registry+complete-M2-path-census+same-consumer-one-shot-results',
    runtimeGuard:
      'runBetterAuthCredentialConsumer{Async}+consumeBetterAuthCredentialResult+result-shape-validation+provider-error-redaction',
    schema:
      'signing-secret|submitted-password|stored-password-hash|request-cookie|session-token|session-record|Set-Cookie|dependency-result',
    sink: 'auth.credential.non-egress',
    source:
      'operator-signing-material|credential-form-input|Better-Auth-systemDb|request-headers|Better-Auth-handler/API/results',
    specAnchor: 'spec/06-type-system.md §6.6; spec/10-data-plane.md §10.3',
    testEvidence: [
      'packages/better-auth/src/internal.trusted-plaintext.test.ts',
      'packages/better-auth/src/index.credential-mutations.test.ts',
      'packages/better-auth/src/index.session.test.ts',
    ],
    trust: 'secret-or-credential-bearing-framework-owned-boundary',
  },
  {
    consumers: ['drizzle-source-sink-plan', 'query-shape-observer'],
    context: 'sql.executable-text',
    diagnostic: 'KV406|KV410|KV422',
    escapeHatch: 'sql<T>+reads|raw-sql-tables+touches',
    firstParser: 'static-drizzle-extractor+runtime-statement-parser',
    guard: 'static-drizzle-analysis+runtime-statement-parser',
    runtimeGuard: 'observed-subset-static-or-declared',
    schema: 'projection-schema+reads-set+tables-allowlist',
    sink: 'sql.executable',
    source:
      'mutation-form-input|FormData|req.search|req.params|request.headers|cookies|raw-sql-helpers',
    specAnchor: 'SPEC.md#10.2;SPEC.md#11.2;plans/sql-injection.md',
    testEvidence: ['packages/drizzle/src/index.query-shapes.test.ts'],
    trust: 'untrusted-query-input',
  },
  {
    consumers: ['client-module-loader', 'dev-hmr-loader', 'build-preset-checks'],
    context: 'dynamic-code.process',
    diagnostic: 'KV424',
    escapeHatch: 'compiler-owned-versioned-handler-import',
    firstParser: 'compiler-handler-registry+dev-server-module-resolver',
    guard: 'closed-handler-registry+request-path-deny-audit',
    runtimeGuard: 'loader-imports-only-declared-/c/__v-refs',
    schema:
      'import()|compiler-dev-HMR-module-loading|build-preset-runtime-API-compatibility|new Function|eval|vm|child_process|shell-commands-in-scripts|adapter-asset-fetch-fallbacks|HandlerModules+ComponentRegistry+build-preset-capabilities',
    sink: 'dynamic.import.process',
    source:
      'handler-ref|dev-hmr-url|build-tooling|request-derived-string|compiler-read-app-source|app-config-env-values',
    specAnchor: 'SPEC.md#4.7;SPEC.md#6.1;plans/sources-sinks.md#Phase-1',
    testEvidence: ['packages/browser/src/handlers.test.ts'],
    trust: 'framework-owned-generated-code',
  },
  {
    consumers: [
      'framework-egress-client',
      'redirect-following-transport',
      'durable-task-runtime',
      'webhook-agent-tool-runtime',
    ],
    context: 'network.egress.dns.dial.redirect',
    diagnostic: 'KV424',
    escapeHatch: 'declared-egress-origin-with-reviewed-private-network-posture',
    firstParser: 'declared-origin-parser+framework-egress-request-constructor',
    guard:
      'declared-origin-allowlist+per-hop-origin-check+dns-resolution+private-network-classification+selected-ip-pin',
    runtimeGuard:
      'framework-egress-choke-rejects-undeclared-origin-before-dns-and-classifies-every-selected-dial-address',
    schema:
      'ctx.fetch|framework-egress|declared-http-origin|redirect-hop|dns-answer|selected-dial-address|proxy-posture|private-network-posture|metadata-capability|database-endpoint|task-webhook-agent-tool-egress',
    sink: 'network.egress',
    source:
      'request-derived-url|task-payload-url|webhook-payload-url|agent-tool-argument|redirect-location|dns-answer|app-config-env-values',
    specAnchor: 'spec/06-type-system.md#6.6;spec/10-data-plane.md#10.3',
    testEvidence: [
      'packages/server/src/egress-property-oracle.test.ts',
      'packages/server/src/egress.test.ts',
      'packages/server/src/egress-redirect.test.ts',
      'packages/server/src/egress-undici.test.ts',
      'packages/server/src/task-runner.test.ts',
      'packages/server/src/webhook.test.ts',
    ],
    trust: 'remote-and-configuration-derived-network-authority',
  },
] as const;

const driftTokens: readonly DangerousSinkToken[] = [
  { owner: 'html.dom.output', token: 'innerHTML' },
  { owner: 'html.dom.output', token: 'outerHTML' },
  { owner: 'html.dom.output', token: 'insertAdjacentHTML' },
  { owner: 'html.dom.output', token: 'setAttribute(' },
  { owner: 'http.header.cookie', token: 'new Response' },
  { owner: 'http.header.cookie', token: 'Headers' },
  { owner: 'http.header.cookie', token: 'Location' },
  { owner: 'http.header.cookie', token: 'Set-Cookie' },
  { owner: 'file.storage.static-export', token: 'respond.file' },
  { owner: 'file.storage.static-export', token: 'respond.stream' },
  { owner: 'url.navigation.selector', token: 'querySelector(' },
  { owner: 'dynamic.import.process', token: 'import(' },
  { owner: 'dynamic.import.process', token: 'new Function' },
  { owner: 'dynamic.import.process', token: 'eval(' },
  { owner: 'dynamic.import.process', token: 'child_process' },
  { owner: 'file.storage.static-export', token: 'path.resolve' },
  { owner: 'file.storage.static-export', token: 'fs.' },
] as const;

const redCorpus: readonly SourceSinkCorpusEntry[] = [
  {
    expected:
      'default text/JSON contexts encode; unsafe raw contexts require trustedHtml/trustedUrl and surface in explain output',
    family: 'html.dom.output',
    negativeTestEvidence: [
      'packages/compiler/src/output-context-security.test.ts',
      'packages/compiler/src/pair-dependent-runtime-sinks.security.test.ts',
      'packages/browser/src/mutation-response-dom.browser.test.ts',
      'packages/browser/src/inline-loader-security.test.ts',
      'packages/browser/src/response-fragment-apply.browser.test.ts',
      'packages/core/src/sink-policy.test.ts',
      'packages/server/src/jsx-runtime.test.ts',
      'tests/integration/specs/meta-refresh-sink.spec.ts',
    ],
    payloads: [
      '<script>',
      '<img onerror>',
      '</script><script>',
      'malformed entities',
      'raw JSON breakout',
      'srcdoc',
      'event attributes',
      'ASCII-case duplicate meta refresh navigation',
      'exact 66-tuple element-context browser-control denominator',
      'disabled geolocation, attribution, browsing-topics, shared-storage, payment, and CSP nonce capabilities',
      'reviewed style activation, fullscreen, form browsing-context, and HTML/SVG credential-mode controls',
      'iframe source without a reviewed sandbox',
      'iframe sandbox unknown token',
      'iframe sandbox allow-scripts plus allow-same-origin isolation lift',
      'SVG payload',
      'nested fragment payload',
      'streamed model text',
      'registry rich-text XML',
      'template-stamp/list update',
    ],
    positiveTestEvidence: [
      'packages/compiler/src/output-context-security.test.ts',
      'packages/compiler/src/pair-dependent-runtime-sinks.security.test.ts',
      'packages/core/src/sink-policy.test.ts',
      'packages/server/src/jsx-runtime.test.ts',
    ],
  },
  {
    expected:
      'URL sinks neutralize/deny unless branded; redirects stay same-origin single-leading-slash; selectors escape or fail closed; stale modules recover by build-skew policy',
    family: 'url.navigation.selector',
    negativeTestEvidence: [
      'packages/core/src/security-url.test.ts',
      'packages/compiler/src/output-context-security.test.ts',
      'packages/browser/src/inline-loader-response-apply.browser.test.ts',
    ],
    payloads: [
      'javascript:',
      'data:',
      'mixed-case scheme',
      'control-character scheme',
      'protocol-relative //host',
      'backslash authority /\\host',
      'dot segments',
      'hash/id selector breakout',
      'malformed CSS selector',
      'hostile next',
      'route params in targets',
      'stale /c/__v module URL',
    ],
    positiveTestEvidence: [
      'packages/server/src/match.test.ts',
      'packages/browser/src/inline-loader-navigation.browser.test.ts',
      'packages/browser/src/inline-loader-build.test.ts',
    ],
  },
  {
    expected:
      'typed builders reject or encode controls; KV415 covers app-authored channels; private/query/session/browser-state responses keep no-store and Vary: Cookie',
    family: 'http.header.cookie',
    negativeTestEvidence: [
      'packages/server/src/cookies.test.ts',
      'packages/server/src/response-app-headers.test.ts',
      'packages/server/src/response.test.ts',
      'packages/server/src/response-posture.test.ts',
      'packages/server/src/app-dispatch.test.ts',
    ],
    payloads: [
      'CR/LF/NUL/DEL/control chars',
      'multi-cookie injection',
      'semicolon cookie value',
      'quoted filename breakout',
      'Unicode bidi filename spoofing',
      'bad header names',
      'reserved Kovo-* writes',
      'unknown structured app header names',
      'proxy deployment-control headers',
      'private cache override',
      'raw Set-Cookie forwarding',
      'public cache policy with Set-Cookie or Clear-Site-Data',
    ],
    positiveTestEvidence: [
      'packages/server/src/cookies.test.ts',
      'packages/server/src/app-dispatch.test.ts',
      'tests/integration/specs/query-args-search.spec.ts',
      'tests/integration/specs/mutation-response-headers.spec.ts',
    ],
  },
  {
    expected:
      'browser authority requires CSRF; machine endpoints require verifier/justification; raw bytes verify before parse; duplicates replay without handler re-execution',
    family: 'ingress.endpoint.webhook',
    negativeTestEvidence: [
      'packages/server/src/endpoint.test.ts',
      'packages/server/src/webhook.test.ts',
      'conformance/webhook-spike/src/index.test.ts',
    ],
    payloads: [
      'missing/wrong CSRF',
      'CSRF-exempt mutation with session read',
      'raw endpoint with ambient cookie reliance',
      'webhook signature over prettified body',
      'stale timestamp',
      'rotated signatures',
      'verify: none',
      'duplicate event id',
      'malformed body',
      'provider retry',
    ],
    positiveTestEvidence: [
      'tests/integration/specs/endpoint-raw-request.spec.ts',
      'tests/integration/specs/webhook-hmac.spec.ts',
      'tests/integration/specs/webhook-idempotency.spec.ts',
    ],
  },
  {
    expected:
      'guard re-check, private cache posture, cross-principal discard, token mismatch refetch/reload, target spoofing authorization, and target caps hold',
    family: 'transport.query.live.broadcast',
    negativeTestEvidence: [
      'packages/browser/src/broadcast-replay.test.ts',
      'packages/browser/src/mutation-fetch.test.ts',
      'tests/integration/specs/mutation-targets-malicious.spec.ts',
    ],
    payloads: [
      'guarded query through /_q',
      'unauthenticated read',
      'cross-principal BroadcastChannel envelope',
      'session switch',
      'live push after guard revocation',
      'stale build token',
      'delta without base',
      'hostile Kovo-Targets',
      'excessive live-target descriptors',
    ],
    positiveTestEvidence: [
      'tests/integration/specs/query-args-search.spec.ts',
      'packages/browser/src/loader-enhanced-mutation-broadcast.test.ts',
      'tests/integration/specs/hmr-dev-client.spec.ts',
    ],
  },
  {
    expected:
      'containment and output path checks reject; downloads default attachment plus nosniff; MIME trust limits are documented; static export fails for dynamic/reserved references',
    family: 'file.storage.static-export',
    negativeTestEvidence: [
      'packages/core/src/storage.test.ts',
      'packages/server/src/content-disposition.test.ts',
      'packages/server/src/upload-sniff.test.ts',
      'packages/server/src/response.test.ts',
      'packages/server/src/build.test.ts',
      'packages/server/src/static-export-route-guards.test.ts',
      'packages/server/src/static-export-output.test.ts',
    ],
    payloads: [
      'traversal in params/filenames/storage keys',
      'dot segments',
      'backslashes',
      'absolute paths',
      'symlinks',
      'unsafe MIME/SVG/HTML inline',
      'content-disposition injection',
      'oversized uploads',
      'metadata control chars',
      'Unicode bidi filename spoofing',
      'Vite manifest path escapes',
      'cache ref tampering',
      'reserved dynamic endpoint references',
    ],
    positiveTestEvidence: [
      'tests/integration/specs/respond-file.spec.ts',
      'tests/integration/specs/respond-stream.spec.ts',
      'tests/integration/specs/storage-download-route.spec.ts',
    ],
  },
  {
    expected:
      'app request path cannot reach dynamic code/process sinks except compiler-owned versioned handler imports; build/deploy checks fail unsupported or unregistered execution surfaces',
    family: 'dynamic.import.process',
    negativeTestEvidence: [
      'packages/browser/src/handlers.test.ts',
      'packages/compiler/src/conformance-compat.test.ts',
      'packages/cli/src/index.kovo-build.test.ts',
    ],
    payloads: [
      'request-derived import URL',
      'request-derived export name',
      'app-authored handler ref outside compiler registry',
      'dev HMR URL influence',
      'unsupported Node API build preset',
      'request-path new Function',
      'request-path eval',
      'request-path child_process',
    ],
    positiveTestEvidence: [
      'packages/browser/src/inline-loader-delegated.test.ts',
      'packages/compiler/src/compile-component.test.ts',
      'tests/integration/specs/client-module-versioning.spec.ts',
    ],
  },
  {
    expected:
      'an undeclared origin is rejected before DNS or dial; every redirect and selected address is independently origin-checked, classified, and pinned before transport use',
    family: 'network.egress',
    negativeTestEvidence: [
      'packages/server/src/egress-property-oracle.test.ts',
      'packages/server/src/egress.test.ts',
      'packages/server/src/egress-redirect.test.ts',
      'packages/server/src/egress-undici.test.ts',
      'packages/server/src/task-runner.test.ts',
    ],
    payloads: [
      'undeclared origin',
      'mixed-case or trailing-dot host',
      'alternate numeric IP spelling',
      'loopback and private address',
      'cloud metadata address',
      'DNS answer rotation',
      'DNS rebinding between validation and dial',
      'redirect to undeclared origin',
      'redirect to private selected address',
      'proxy-selected destination mismatch',
    ],
    positiveTestEvidence: [
      'packages/server/src/egress-property-oracle.test.ts',
      'packages/server/src/egress.test.ts',
      'packages/server/src/egress-redirect.test.ts',
      'packages/server/src/egress-undici.test.ts',
      'packages/server/src/task-runner.test.ts',
      'packages/server/src/webhook.test.ts',
    ],
  },
] as const;

const runtimeEvidence: SourceSinkRuntimeEvidence = {
  failClosedCases: [
    {
      guard: 'unsafe URL scheme rejection/drop',
      shape: 'unsafe URL scheme',
      testEvidence: [
        'packages/core/src/security-url.test.ts',
        'packages/compiler/src/output-context-security.test.ts',
        'packages/browser/src/security-output.test.ts',
      ],
    },
    {
      guard: 'typed header/cookie validation',
      shape: 'bad headers/cookies',
      testEvidence: ['packages/server/src/cookies.test.ts', 'packages/server/src/response.test.ts'],
    },
    {
      guard: 'CSS.escape selector construction and invalid-target fallback',
      shape: 'selector construction failure',
      testEvidence: [
        'packages/browser/src/inline-loader-response-apply.browser.test.ts',
        'packages/browser/src/fragment-targets.test.ts',
      ],
    },
    {
      guard: 'request shell CSRF gate',
      shape: 'CSRF mismatch',
      testEvidence: [
        'packages/server/src/csrf.test.ts',
        'tests/integration/specs/csrf-required.spec.ts',
      ],
    },
    {
      guard: 'pre-dispatch load shedding',
      shape: 'body too large',
      testEvidence: ['packages/server/src/app-load-shed.test.ts'],
    },
    {
      guard: 'principal fingerprint discard',
      shape: 'cross-principal broadcast',
      testEvidence: ['packages/browser/src/broadcast-replay.test.ts'],
    },
    {
      guard: 'build token mismatch refetch/reload',
      shape: 'stale build token',
      testEvidence: [
        'packages/browser/src/inline-loader-enhanced-submit.test.ts',
        'tests/integration/specs/hmr-dev-client.spec.ts',
      ],
    },
    {
      guard: 'path containment and storage key validation',
      shape: 'disallowed storage path',
      testEvidence: [
        'packages/core/src/storage.test.ts',
        'packages/server/src/static-export-output.test.ts',
      ],
    },
    {
      guard: 'SQL source/sink runtime observed-subset cross-check',
      shape: 'unbranded raw SQL',
      testEvidence: ['packages/drizzle/src/index.query-shapes.test.ts'],
    },
  ],
  parityPairs: [
    {
      claim: 'server URL attributes and browser bound attributes share unsafe URL rules',
      pair: 'server URL attributes vs browser bound attributes',
      testEvidence: [
        'packages/compiler/src/output-context-security.test.ts',
        'packages/browser/src/security-output.test.ts',
      ],
    },
    {
      claim: 'server text/JSON output and browser query/fragment apply preserve escaped text',
      pair: 'server text/JSON vs browser query/fragment apply',
      testEvidence: [
        'packages/server/src/jsx-runtime.test.ts',
        'packages/browser/src/mutation-response-dom.browser.test.ts',
        'packages/browser/src/wire-parser.test.ts',
      ],
    },
    {
      claim: 'inline and modular loaders use the same selector escaping',
      pair: 'modular vs inline loader selector escaping',
      testEvidence: [
        'packages/browser/src/inline-loader-build.test.ts',
        'packages/browser/src/inline-loader-response-apply-extract.test.ts',
      ],
    },
    {
      claim: 'route redirects, mutation redirects, and auth next normalize same-origin targets',
      pair: 'route redirects vs mutation redirects/auth next',
      testEvidence: [
        'packages/server/src/match.test.ts',
        'packages/server/src/mutation.test.ts',
        'conformance/better-auth-pin/src/index.session-credentials.test.ts',
      ],
    },
    {
      claim: 'query endpoint and BroadcastChannel/live transports preserve guard/cache posture',
      pair: 'query endpoint vs BroadcastChannel/live transports',
      testEvidence: [
        'tests/integration/specs/query-args-search.spec.ts',
        'packages/browser/src/broadcast-replay.test.ts',
        'packages/browser/src/loader-enhanced-mutation-broadcast.test.ts',
      ],
    },
  ],
  runtimeChokepoints: [
    {
      chokepoint: 'server renderer',
      guard: 'contextual HTML/attribute/script/style encoding',
      testEvidence: ['packages/server/src/jsx-runtime.test.ts'],
    },
    {
      chokepoint: 'browser update plan',
      guard: 'compiled update plans use generated selectors and contextual writers',
      testEvidence: ['packages/compiler/src/query-update-plans.test.ts'],
    },
    {
      chokepoint: 'fragment/morph apply',
      guard: 'fragment target resolution and morphing preserve escaped server truth',
      testEvidence: ['packages/browser/src/mutation-response-dom.browser.test.ts'],
    },
    {
      chokepoint: 'route/mutation/query response builders',
      guard: 'typed status/header/cache/query response protocol',
      testEvidence: [
        'packages/server/src/response.test.ts',
        'packages/server/src/mutation.test.ts',
        'packages/server/src/query.test.ts',
      ],
    },
    {
      chokepoint: 'header/cookie builder',
      guard: 'control character rejection and structural cookie serialization',
      testEvidence: ['packages/server/src/cookies.test.ts', 'packages/server/src/response.test.ts'],
    },
    {
      chokepoint: 'request shell',
      guard: 'session, guard, rate-limit, and ownership request channels',
      testEvidence: ['packages/server/src/guards.test.ts'],
    },
    {
      chokepoint: 'CSRF/replay lifecycle',
      guard: 'token validation and idempotency replay store',
      testEvidence: [
        'packages/server/src/csrf.test.ts',
        'packages/server/src/replay.test.ts',
        'tests/integration/specs/webhook-idempotency.spec.ts',
      ],
    },
    {
      chokepoint: 'query endpoint',
      guard: 'private no-store cache and guard re-check',
      testEvidence: [
        'packages/server/src/query.test.ts',
        'tests/integration/specs/query-args-search.spec.ts',
      ],
    },
    {
      chokepoint: 'endpoint/webhook dispatcher',
      guard: 'auth-before-handler and raw-byte verify-before-parse',
      testEvidence: [
        'packages/server/src/endpoint.test.ts',
        'packages/server/src/webhook.test.ts',
        'tests/integration/specs/endpoint-raw-request.spec.ts',
      ],
    },
    {
      chokepoint: 'storage adapter',
      guard: 'schema-bound stored files and storage key validation',
      testEvidence: ['packages/core/src/storage.test.ts'],
    },
    {
      chokepoint: 'static export writer',
      guard: 'reserved dynamic endpoint refusal and output path containment',
      testEvidence: [
        'packages/server/src/static-export-output.test.ts',
        'packages/server/src/static-export-route-guards.test.ts',
      ],
    },
    {
      chokepoint: 'client module registry',
      guard: 'versioned handler module imports only from declared registry',
      testEvidence: [
        'packages/browser/src/handlers.test.ts',
        'tests/integration/specs/client-module-versioning.spec.ts',
      ],
    },
    {
      chokepoint: 'DB handle guard',
      guard: 'observed query/write set must be static or declared',
      testEvidence: ['packages/drizzle/src/index.query-shapes.test.ts'],
    },
  ],
};

const boundaryCrossingInventory: readonly BoundaryCrossingSinkInventoryEntry[] = [
  {
    censusFamilies: ['sql.executable'],
    hostileValueEvidence: ['packages/server/src/managed-db.test.ts'],
    keyScoping: 'database-principal-policy',
    mechanism: 'reconstruct',
    mechanismDetail:
      'The managed SQL boundary snapshots every accepted statement carrier into one immutable statement artifact before validation, classification, instrumentation, and driver execution.',
    operationKinds: [
      'server.database.read',
      'server.database.trusted-sql',
      'server.database.write',
    ],
    owner: '@kovojs/server/managed-db',
    proofEvidence: [
      'packages/server/src/managed-db.test.ts',
      'packages/core/src/internal/security-markers.test.ts',
    ],
    proofGate: 'pnpm run check:single-choke',
    sink: 'db driver statement',
    soleDoor: 'managed SQL statement snapshot + enforceManagedSql/managedDb engine policy',
    specAnchor: 'spec/10-data-plane.md §10.3; spec/11-verification.md §11.2',
  },
  {
    censusFamilies: ['transport.query.live.broadcast'],
    hostileValueEvidence: [
      'packages/server/src/wire-html.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'reconstruct',
    mechanismDetail:
      'Framework wire helpers reconstruct fragment/query/error bodies from normalized values and escaped text instead of forwarding caller-owned body strings through privileged response paths.',
    operationKinds: ['server.response.outcome', 'server.response.raw'],
    owner: '@kovojs/server/wire-output',
    proofEvidence: [
      'packages/server/src/wire-html.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    ],
    proofGate: 'pnpm run check:wire-output-boundary',
    sink: 'http response body',
    soleDoor: 'emit-to-wire render helpers and typed error/body envelopes',
    specAnchor: 'spec/09-wire-protocol.md §9.1; spec/11-verification.md §11.4',
  },
  {
    censusFamilies: ['http.header.cookie'],
    hostileValueEvidence: [
      'packages/server/src/response-app-headers.test.ts',
      'packages/server/src/response.test.ts',
      'packages/server/src/app-document.test.ts',
      'packages/server/src/response-posture.test.ts',
      'packages/server/src/node.test.ts',
      'packages/server/src/build.test.ts',
      'packages/server/src/static-export-headers.test.ts',
      'packages/server/src/static-export-response.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'own',
    mechanismDetail:
      'Direct app inputs pass an exact metadata allowlist before framework fields are assembled; static export rejects durable browser-state instructions, while typed, raw, live-adapter, and generated-adapter finalization own the browser-state private/no-store floor and the transport-owned framing/hop-by-hop deny set before transport mutation.',
    operationKinds: ['server.response.header'],
    owner: '@kovojs/server/response-finalization',
    proofEvidence: [
      'packages/server/src/response-app-headers.test.ts',
      'packages/server/src/response.test.ts',
      'packages/server/src/app-document.test.ts',
      'packages/server/src/response-posture.test.ts',
      'packages/server/src/node.test.ts',
      'packages/server/src/build.test.ts',
      'packages/server/src/static-export-headers.test.ts',
      'packages/server/src/static-export-response.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts',
    ],
    proofGate: 'pnpm run check:wire-output-boundary',
    sink: 'http response headers',
    soleDoor:
      'respond/error-shell app-header classifiers, then finalizeResponseHeaders/finalizeRawResponseHeaders, static browser-state rejection, and live/generated adapter cache-floor plus transport-header sinks',
    specAnchor: 'spec/09-wire-protocol.md §9.1; spec/11-diagnostics.md KV415',
  },
  {
    censusFamilies: ['url.navigation.selector'],
    hostileValueEvidence: [
      'packages/server/src/response-posture.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'reconstruct',
    mechanismDetail:
      'Redirect targets are normalized back into same-origin path-form values before Location is emitted.',
    operationKinds: ['server.response.redirect'],
    owner: '@kovojs/server/response-posture',
    proofEvidence: [
      'packages/server/src/response-posture.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts',
    ],
    proofGate: 'pnpm run check:wire-output-boundary',
    sink: 'redirect URL',
    soleDoor: 'redirectLocationHeaderValue / sanitizeNext normalization before header finalization',
    specAnchor: 'spec/09-wire-protocol.md §9.1; spec/10-data-plane.md §10.3',
  },
  {
    censusFamilies: ['http.header.cookie'],
    hostileValueEvidence: [
      'packages/server/src/cookies.test.ts',
      'packages/server/src/anonymous-csrf-cache-security.test.tsx',
      'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts',
      'scripts/check-csrf-mint-delivery.test.mjs',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'own',
    mechanismDetail:
      'Cookie values cross through the typed serializer; first-anonymous CSRF authority additionally requires a private response-lifecycle receipt whose atomic seal/snapshot is consumed only by an authorized response finalizer.',
    operationKinds: ['server.response.cookie'],
    owner: '@kovojs/server/response-lifecycle',
    proofEvidence: [
      'packages/server/src/cookies.test.ts',
      'packages/server/src/standalone-csrf-mint-security.test.ts',
      'packages/server/src/anonymous-csrf-cache-security.test.tsx',
      'packages/server/src/build.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts',
      'security/csrf-mint-delivery.json',
    ],
    proofGate: 'pnpm run check:csrf-mint-delivery',
    sink: 'Set-Cookie',
    soleDoor:
      'typed cookie builder + serializer; anonymous CSRF response-lifecycle receipt, synchronous record, and seal/snapshot; authorized final response reconstruction',
    specAnchor: 'spec/09-wire-protocol.md §9.1; spec/11-diagnostics.md KV415',
  },
  {
    censusFamilies: ['file.storage.static-export'],
    hostileValueEvidence: [
      'packages/core/src/scoped-key.test.ts',
      'packages/core/src/storage.test.ts',
      'packages/server/src/static-export-output.test.ts',
    ],
    keyScoping: 'runtime-opaque-scoped-key',
    mechanism: 'own',
    mechanismDetail:
      'Storage object keys cross only as runtime-witnessed ScopedKey frames before adapters derive physical namespaces; file paths and static-export outputs additionally cross through framework-owned containment and reserved-reference gates.',
    operationKinds: ['server.storage.read', 'server.storage.write'],
    owner: '@kovojs/core/storage',
    proofEvidence: [
      'packages/core/src/scoped-key.test.ts',
      'packages/core/src/storage.test.ts',
      'packages/server/src/static-export-output.test.ts',
    ],
    proofGate: 'pnpm run check:filesystem-boundary',
    sink: 'blob/file write',
    soleDoor:
      'ScopedKey runtime witness + storage adapter frame namespace + static export writer containment checks',
    specAnchor: 'spec/11-verification.md §11.4; plans/sources-sinks.md Phase 2',
  },
  {
    censusFamilies: ['transport.query.live.broadcast'],
    hostileValueEvidence: [
      'packages/server/src/task-queue.test.ts',
      'packages/server/src/task-observability.test.ts',
      'packages/server/src/task-runner.test.ts',
    ],
    keyScoping: 'runtime-opaque-scoped-key',
    mechanism: 'own',
    mechanismDetail:
      'Durable-task coalescing keys cross as runtime-witnessed ScopedKey frames; args and status payloads cross process/store boundaries through framework-owned queue envelopes and redaction-aware observability views.',
    operationKinds: ['server.task.compose'],
    owner: '@kovojs/server/task-runner',
    proofEvidence: [
      'packages/server/src/task-queue.test.ts',
      'packages/server/src/task-observability.test.ts',
      'packages/server/src/task-runner.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.durable-tasks.lifecycle.test.ts',
    ],
    proofGate: 'pnpm run check:security-test-builds',
    sink: 'durable-task payload',
    soleDoor: 'ScopedKey frame + task queue envelope + observability redaction/export helpers',
    specAnchor: 'spec/09-wire-protocol.md §9.6; spec/11-verification.md §11.4',
  },
  {
    censusFamilies: ['ingress.endpoint.webhook'],
    hostileValueEvidence: [
      'packages/server/src/request-ingress-policy.test.ts',
      'packages/server/src/request-ingress-c13.test.ts',
      'packages/server/src/__bugz_remote_ingress.test.ts',
      'packages/server/src/node.test.ts',
      'packages/server/src/build.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'reconstruct',
    mechanismDetail:
      'Each adapter snapshots only its transport-owned method, authority, and scheme sources; one finite classifier rejects ambiguous or lossy values and reconstructs the Web Request method, URL authority, and app-visible Host from the same decision.',
    operationKinds: [],
    owner: '@kovojs/server/request-ingress',
    proofEvidence: [
      'packages/server/src/request-ingress-policy.ts',
      'packages/server/src/request-ingress-policy.test.ts',
      'packages/server/src/request-ingress-c13.test.ts',
      'packages/server/src/__bugz_remote_ingress.test.ts',
      'packages/server/src/node.test.ts',
      'packages/server/src/build.test.ts',
    ],
    proofGate: 'pnpm run check:security-classifier-corpus',
    sink: 'request method/authority/scheme',
    soleDoor:
      'createRequestIngressClassifier after adapter-owned source snapshot; reconstructed method, URL authority, scheme, and Host decision',
    specAnchor: 'spec/09-wire-protocol.md §9.5; spec/11-verification.md §11.4',
  },
  {
    censusFamilies: ['ingress.endpoint.webhook'],
    hostileValueEvidence: [
      'packages/server/src/webhook.test.ts',
      'tests/integration/specs/webhook-hmac.spec.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'own',
    mechanismDetail:
      'Webhook payload bytes remain framework-owned until verifier-before-parse and replay posture accept them.',
    operationKinds: [],
    owner: '@kovojs/server/webhook',
    proofEvidence: [
      'packages/server/src/webhook.test.ts',
      'tests/integration/specs/webhook-hmac.spec.ts',
    ],
    proofGate: 'pnpm run check:security-test-builds',
    sink: 'webhook payload',
    soleDoor: 'webhook verifier-before-parse + replay-scoped dispatch',
    specAnchor: 'spec/09-wire-protocol.md §9.1; spec/11-verification.md §11.4',
  },
  {
    censusFamilies: ['html.dom.output', 'document.shell.output', 'css.style.output'],
    hostileValueEvidence: [
      'packages/browser/src/security-output.test.ts',
      'packages/core/src/sink-policy.test.ts',
      'packages/compiler/src/pair-dependent-runtime-sinks.security.test.ts',
      'packages/browser/src/inline-loader-security.test.ts',
      'packages/browser/src/response-fragment-apply.browser.test.ts',
      'packages/server/src/jsx-runtime.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'reconstruct',
    mechanismDetail:
      'Renderer and browser output helpers reconstruct HTML/DOM output from contextual encoders or explicit trustedHtml/trustedUrl escapes.',
    operationKinds: [
      'browser.dialog.close',
      'browser.dialog.open',
      'browser.dom.focus',
      'browser.event.control',
      'browser.event.read',
      'browser.form.reset',
      'browser.form.submit',
      'browser.state.read',
      'browser.state.write',
      'server.output.trusted-html',
    ],
    owner: '@kovojs/compiler/output-context',
    proofEvidence: [
      'packages/browser/src/security-output.test.ts',
      'packages/core/src/internal/source-sink-registry.test.ts',
      'packages/core/src/sink-policy.test.ts',
      'packages/compiler/src/pair-dependent-runtime-sinks.security.test.ts',
      'packages/browser/src/inline-loader-security.test.ts',
      'packages/browser/src/response-fragment-apply.browser.test.ts',
      'packages/server/src/jsx-runtime.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    ],
    proofGate: 'pnpm run check:security-classifier-corpus',
    sink: 'HTML/render output',
    soleDoor: 'escaped render pipeline + explicit trusted output escape hatches',
    specAnchor: 'SPEC.md §4.8; spec/11-verification.md §11.4',
  },
  {
    censusFamilies: ['transport.query.live.broadcast'],
    hostileValueEvidence: [
      'packages/core/src/secret.test.ts',
      'packages/server/src/task-observability.test.ts',
      'packages/server/src/query-endpoint.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'box',
    mechanismDetail:
      'Secret and redacted runtime boxes refuse accidental coercion and are normalized to redacted or empty error payloads before logs, status views, or wire-visible error shells.',
    operationKinds: [],
    owner: '@kovojs/core/secret',
    proofEvidence: [
      'packages/core/src/secret.test.ts',
      'packages/server/src/task-observability.test.ts',
      'packages/server/src/query-endpoint.test.ts',
    ],
    proofGate: 'pnpm run check:tcb-boundary',
    sink: 'log/error output',
    soleDoor: 'Secret/redacted boxes plus normalized error shell emitters',
    specAnchor: 'spec/10-data-plane.md §10.3; spec/11-verification.md §11.2',
  },
  {
    censusFamilies: ['network.egress'],
    hostileValueEvidence: [
      'packages/compiler/src/capability-closure.security.test.ts',
      'packages/server/src/egress-property-oracle.test.ts',
      'packages/server/src/egress-undici.test.ts',
      'packages/server/src/task-runner.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'own',
    mechanismDetail:
      'Task and verified-webhook code receives the exact non-replaceable ctx.fetch capability. It canonicalizes a positive origin allowlist at boot, rejects every undeclared initial/redirect origin before DNS, classifies every DNS answer, and leaves selected-address pinning to the exact dial sink.',
    operationKinds: ['server.egress.request'],
    owner: '@kovojs/server/egress',
    proofEvidence: [
      'packages/compiler/src/capability-closure.security.test.ts',
      'packages/server/src/egress-property-oracle.test.ts',
      'packages/server/src/egress-undici.test.ts',
      'packages/server/src/egress.test.ts',
      'packages/server/src/task-runner.test.ts',
      'packages/server/src/webhook.test.ts',
    ],
    proofGate: 'pnpm run check:egress-boundary',
    sink: 'outbound egress request',
    soleDoor:
      'exact framework-owned ctx.fetch on task/webhook/future agent-tool contexts; exact module-private database socket witness for managed Postgres',
    specAnchor: 'spec/06-type-system.md §6.6; spec/10-data-plane.md §10.3',
  },
  {
    censusFamilies: ['auth.data-access'],
    hostileValueEvidence: [
      'packages/server/src/postgres-authz.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'own',
    mechanismDetail:
      'The served Postgres path derives one pinned principal and delegates row/column authority to the least-privilege runtime-role privilege graph, FORCE-RLS policies, and closure-audited reachable objects.',
    operationKinds: ['server.authority.scope'],
    owner: '@kovojs/server/postgres-authz',
    proofEvidence: [
      'packages/server/src/postgres-authz.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    ],
    proofGate: 'pnpm run test:authz-paranoid',
    sink: 'authorization principal/data access',
    soleDoor:
      'pinned request principal + least-privilege Postgres role/RLS/engine-closure boundary',
    specAnchor: 'spec/06-type-system.md §6.6; spec/10-data-plane.md §10.3',
  },
  {
    censusFamilies: ['auth.credential.non-egress'],
    hostileValueEvidence: [
      'packages/better-auth/src/internal.trusted-plaintext.test.ts',
      'packages/better-auth/src/index.credential-mutations.test.ts',
      'packages/better-auth/src/index.session.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'own',
    mechanismDetail:
      'The package-private gate owns every supported Better Auth secret and credential consumer, invokes captured dependency callables inside the door, admits only exact registered consumer/source identity, validates the contract result, and seals it for one opening by that same consumer.',
    operationKinds: [],
    owner: '@kovojs/better-auth/credential-gate',
    proofEvidence: [
      'packages/better-auth/src/internal/credential-runtime-gate.ts',
      'packages/better-auth/src/internal.trusted-plaintext.test.ts',
      'security/TCB.md',
    ],
    proofGate: 'pnpm run check:security-classifier-corpus',
    sink: 'Better Auth credential/non-egress',
    soleDoor:
      'runBetterAuthCredentialConsumer (package-owned reconstruction) / runBetterAuthCredentialSourceCallable{Async} (external raw sources) + consumeBetterAuthCredentialResult exact registry door',
    specAnchor: 'spec/06-type-system.md §6.6; spec/10-data-plane.md §10.3',
  },
  {
    censusFamilies: ['dynamic.import.process'],
    hostileValueEvidence: [
      'packages/browser/src/handlers.test.ts',
      'packages/compiler/src/conformance-compat.test.ts',
      'packages/compiler/src/security-operation-ir.security.test.ts',
      'packages/cli/src/index.kovo-build.test.ts',
    ],
    keyScoping: 'not-stateful-keyed',
    mechanism: 'own',
    mechanismDetail:
      'Compiler-owned versioned handler modules and reviewed build/runtime capability doors own dynamic loading and process authority. Handler-root census records and exact same-file helper-call edges keep supported roots and unresolved semantic-summary obligations visible; they do not claim a downstream runtime effect.',
    operationKinds: [
      'browser.framework.call',
      'browser.timer.cancel',
      'browser.timer.schedule',
      'server.handler.root',
      'server.helper.call',
    ],
    owner: '@kovojs/compiler/capability-closure',
    proofEvidence: [
      'packages/browser/src/handlers.test.ts',
      'packages/compiler/src/conformance-compat.test.ts',
      'packages/compiler/src/security-operation-ir.security.test.ts',
      'packages/cli/src/index.kovo-build.test.ts',
    ],
    proofGate: 'pnpm run check:sink-policy',
    sink: 'dynamic module/process execution',
    soleDoor:
      'compiler-owned immutable client-module registry plus reviewed build/runtime capability doors',
    specAnchor: 'spec/04-component-model.md §4.4; spec/06-type-system.md §6.6',
  },
] as const;

freezeRegistryAuthority(sourceSinkInventory);
freezeRegistryAuthority(driftTokens);
freezeRegistryAuthority(redCorpus);
freezeRegistryAuthority(runtimeEvidence);
freezeRegistryAuthority(boundaryCrossingInventory);
