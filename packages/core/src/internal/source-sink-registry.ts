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

const redCorpus: readonly SourceSinkCorpusEntry[] = [
  {
    expected:
      'default text/JSON contexts encode; unsafe raw contexts require trustedHtml/trustedUrl and surface in explain output',
    family: 'html.dom.output',
    negativeTestEvidence: [
      'packages/compiler/src/output-context-security.test.ts',
      'packages/browser/src/mutation-response-dom.browser.test.ts',
    ],
    payloads: [
      '<script>',
      '<img onerror>',
      '</script><script>',
      'malformed entities',
      'raw JSON breakout',
      'srcdoc',
      'event attributes',
      'SVG payload',
      'nested fragment payload',
      'streamed model text',
      'registry rich-text XML',
      'template-stamp/list update',
    ],
    positiveTestEvidence: [
      'packages/compiler/src/output-context-security.test.ts',
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
      'typed builders reject or encode controls; KV415 covers app-authored channels; private/query/session responses keep no-store and Vary: Cookie',
    family: 'http.header.cookie',
    negativeTestEvidence: [
      'packages/server/src/cookies.test.ts',
      'packages/server/src/response.test.ts',
    ],
    payloads: [
      'CR/LF/NUL/DEL/control chars',
      'multi-cookie injection',
      'semicolon cookie value',
      'quoted filename breakout',
      'bad header names',
      'reserved Kovo-* writes',
      'private cache override',
      'raw Set-Cookie forwarding',
    ],
    positiveTestEvidence: [
      'packages/server/src/cookies.test.ts',
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
