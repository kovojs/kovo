import { SAFE_URL_SCHEMES, URL_ATTRIBUTE_NAMES } from './security-url.js';

/** @internal */
export interface SourceSinkInventoryEntry {
  consumers: readonly string[];
  context: string;
  diagnostic: string;
  escapeHatch: string;
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

const sourceSinkInventory: readonly SourceSinkInventoryEntry[] = [
  {
    consumers: ['server-renderer', 'browser-output-helpers', 'compiler-output-context-facts'],
    context: 'html.text+attribute+url+script-json+style+srcdoc',
    diagnostic: 'KV236',
    escapeHatch: 'trustedHtml|trustedUrl',
    firstParser: 'tsx-lowered-output-context',
    guard: `contextual-encoding+url-scheme-allowlist:${SAFE_URL_SCHEMES.join('|')}`,
    runtimeGuard: 'server-renderer+browser-output-helpers-drop-unsafe-url-attrs',
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
      'live-property-writes',
      'template-stamps',
      'rich-text-registry',
    ].join('|'),
    sink: 'html.dom.output',
    source:
      'server-render|client-query|client-state|template-stamp|data-stream-text|streamed-model-output|compiler-read-app-source|db-user-text',
    specAnchor: 'SPEC.md#4.8;SPEC.md#5.2',
    testEvidence: [existingEvidence.outputContext, existingEvidence.browserOutput],
    trust: 'untrusted-unless-branded',
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
    consumers: ['response-builder', 'cookie-builder', 'adapter-header-conversion'],
    context: 'http.headers.cookies.redirects',
    diagnostic: 'KV415',
    escapeHatch: 'endpoint-raw-response',
    firstParser: 'respond-builder+cookie-serializer',
    guard: 'typed-header-allowlist+typed-cookie-builder',
    runtimeGuard: 'reject-cr-lf-nul-controls+structural-cookie-serialization',
    schema:
      'mutation-response-header-channel|route-outcome-headers|Set-Cookie|Content-Type|Cache-Control|Vary|ETag|Last-Modified|Content-Disposition|Location|Retry-After|Kovo-*|Node-Bun-Workers-header-conversion',
    sink: 'http.header.cookie',
    source:
      'mutation-response-channel|route-outcome|session-provider|request.headers|cookies|redirect-target|app-config-env-values',
    specAnchor: 'SPEC.md#9.1;SPEC.md#11.3',
    testEvidence: [existingEvidence.cookie, existingEvidence.response],
    trust: 'transport-metadata',
  },
  {
    consumers: ['endpoint-dispatcher', 'webhook-verifier', 'csrf-gate', 'replay-store'],
    context: 'endpoint.webhook.raw-request',
    diagnostic: 'KV418|KV422',
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
      'safe-content-disposition+reserved-dynamic-endpoint-refusal+storage-key-validation',
    schema:
      'FileSchema|StoredFile|upload-schema-storage|storage-keys-metadata|filesystem-S3-adapters|respond.file|respond.stream|static-export-output-paths|Vite-manifest-asset-copies|compiler-persistent-cache-refs|generated-graph-output-files|static-export-route-paths-assets-manifests|storage-key|content-disposition-filename',
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
    consumers: ['drizzle-source-sink-plan', 'query-shape-observer'],
    context: 'sql.executable-text',
    diagnostic: 'KV406|KV410',
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
