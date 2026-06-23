import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { SAFE_URL_SCHEMES, URL_ATTRIBUTE_NAMES } from '@kovojs/core/internal/security-url';

import { type KovoCheckResult } from './shared.js';

export const sourcesSinksArtifactVersion = 'kovo-sources-sinks/v1';
export const sourcesSinksArtifactPath = join('.kovo', 'sources-sinks.json');

export interface SourceSinkInventoryEntry {
  context: string;
  diagnostic: string;
  escapeHatch: string;
  guard: string;
  runtimeGuard: string;
  schema: string;
  sink: string;
  source: string;
  specAnchor: string;
  testEvidence: readonly string[];
  trust: string;
}

export interface SourceSinkInventoryArtifact {
  dangerousSinkTokens: readonly DangerousSinkToken[];
  entries: readonly SourceSinkInventoryEntry[];
  generatedBy: 'kovo sources-sinks inventory';
  version: typeof sourcesSinksArtifactVersion;
}

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
 * auditable. This first registry is intentionally static: it gives Phase 1 a
 * deterministic inventory before app-level extraction feeds rows into it.
 */
export function frameworkSourceSinkInventory(): readonly SourceSinkInventoryEntry[] {
  return sourceSinkInventory;
}

export function dangerousSinkTokens(): readonly DangerousSinkToken[] {
  return driftTokens;
}

export function sourcesSinksArtifact(): SourceSinkInventoryArtifact {
  return {
    dangerousSinkTokens: dangerousSinkTokens(),
    entries: frameworkSourceSinkInventory(),
    generatedBy: 'kovo sources-sinks inventory',
    version: sourcesSinksArtifactVersion,
  };
}

export function writeSourcesSinksArtifact(cwd = process.cwd()): string {
  const artifactPath = join(cwd, sourcesSinksArtifactPath);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(sourcesSinksArtifact(), null, 2)}\n`);
  return artifactPath;
}

export function sourcesSinksExplainResult(version: string): KovoCheckResult {
  const lines = sourcesSinksTextLines(version);
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

export function sourcesSinksCheckResult(version: string): KovoCheckResult {
  const entries = frameworkSourceSinkInventory();
  const families = new Set(entries.map((entry) => sinkFamily(entry.sink)));
  const lines = sourcesSinksTextLines(version);
  lines.push(
    `CHECK families=${families.size} entries=${entries.length} drift-tokens=${driftTokens.length}`,
  );
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

function sourcesSinksTextLines(version: string): string[] {
  const entries = frameworkSourceSinkInventory();
  const lines = [version, 'SOURCES-SINKS'];

  for (const entry of entries) {
    lines.push(sourceSinkTextLine(entry));
  }

  lines.push(
    `DRIFT-TOKENS ${driftTokens.map((token) => `${token.token}:${token.owner}`).join(',')}`,
  );
  lines.push(`ARTIFACT ${sourcesSinksArtifactPath}`);
  lines.push(`SUMMARY total=${entries.length}`);
  return lines;
}

function sourceSinkTextLine(entry: SourceSinkInventoryEntry): string {
  return [
    'ITEM',
    `source=${entry.source}`,
    `sink=${entry.sink}`,
    `context=${entry.context}`,
    `trust=${entry.trust}`,
    `guard=${entry.guard}`,
    `schema=${entry.schema}`,
    `runtimeGuard=${entry.runtimeGuard}`,
    `diagnostic=${entry.diagnostic}`,
    `escapeHatch=${entry.escapeHatch}`,
    `specAnchor=${entry.specAnchor}`,
    `testEvidence=${entry.testEvidence.join(',')}`,
  ].join(' ');
}

function sinkFamily(sink: string): string {
  return sink.split('.')[0] ?? sink;
}

const sourceSinkInventory: readonly SourceSinkInventoryEntry[] = [
  {
    context: 'html.text+attribute+url+script-json+style+srcdoc',
    diagnostic: 'KV236',
    escapeHatch: 'trustedHtml|trustedUrl',
    guard: `contextual-encoding+url-scheme-allowlist:${SAFE_URL_SCHEMES.join('|')}`,
    runtimeGuard: 'server-renderer+browser-output-helpers-drop-unsafe-url-attrs',
    schema: `compiler-output-context-facts:urlAttrs=${URL_ATTRIBUTE_NAMES.join('|')}`,
    sink: 'html.dom.output',
    source: 'server-render|client-query|client-state|template-stamp|style-extraction',
    specAnchor: 'SPEC.md#4.8;SPEC.md#5.2',
    testEvidence: [existingEvidence.outputContext, existingEvidence.browserOutput],
    trust: 'untrusted-unless-branded',
  },
  {
    context: 'url.navigation.redirect.module.selector',
    diagnostic: 'KV220|KV236|KV228',
    escapeHatch: 'trustedUrl|external-route-opt-out|compiler-owned-handler-ref',
    guard: 'route-registry+safeSameOrigin+normalizePathname+selector-escape',
    runtimeGuard: 'sanitizeNext+route-matcher+fragment-target-escape+versioned-client-modules',
    schema: 'route.params|route.search|handler-ref-registry|safe-url-schemes',
    sink: 'url.navigation.selector',
    source: 'route().params|route().search|auth.next|fragment-targets|handler-refs',
    specAnchor: 'SPEC.md#4.7;SPEC.md#4.8;SPEC.md#6.2;SPEC.md#9.5',
    testEvidence: [existingEvidence.route, existingEvidence.browserSelector],
    trust: 'cross-trust-url-state',
  },
  {
    context: 'http.headers.cookies.redirects',
    diagnostic: 'KV415',
    escapeHatch: 'endpoint-raw-response',
    guard: 'typed-header-allowlist+typed-cookie-builder',
    runtimeGuard: 'reject-cr-lf-nul-controls+structural-cookie-serialization',
    schema: 'Set-Cookie|Cache-Control|Vary|ETag|Last-Modified|Content-Disposition|Location',
    sink: 'http.header.cookie',
    source: 'mutation-response-channel|route-outcome|session-provider|redirect-target',
    specAnchor: 'SPEC.md#9.1;SPEC.md#11.3',
    testEvidence: [existingEvidence.cookie, existingEvidence.response],
    trust: 'transport-metadata',
  },
  {
    context: 'endpoint.webhook.raw-request',
    diagnostic: 'KV418',
    escapeHatch: 'endpoint({csrf:false,reason})|webhook({verify:none,reason})',
    guard: 'csrf-or-machine-verifier+raw-bytes-before-parse',
    runtimeGuard: 'dispatcher-endpoint-auth+webhook-verify+replay-store',
    schema: 'endpoint-method+path+body-posture|webhook-input+idempotency',
    sink: 'ingress.endpoint.webhook',
    source: 'request.headers|raw-body|endpoint-body|webhook-provider-signature',
    specAnchor: 'SPEC.md#9.1;SPEC.md#11.4',
    testEvidence: [existingEvidence.endpoint],
    trust: 'browser-authority-or-machine-authority',
  },
  {
    context: 'query.live.cache.broadcast.fragment',
    diagnostic: 'KV311|KV416',
    escapeHatch: 'renderOnce|await-fragment|disableServerRefresh',
    guard: 'guard-recheck+private-cache+principal-fingerprint+build-token',
    runtimeGuard: 'typed-read-endpoint+BroadcastChannel-principal-discard+SSE-guard-recheck',
    schema: 'query-args+query-shape+fragment-target-registry+render-plan-token',
    sink: 'transport.query.live.broadcast',
    source: '/_q/search-args|Kovo-Targets|Kovo-Live-Targets|BroadcastChannel|SSE',
    specAnchor: 'SPEC.md#4.9;SPEC.md#9.3;SPEC.md#9.4',
    testEvidence: [existingEvidence.query],
    trust: 'session-scoped-private-data',
  },
  {
    context: 'file.storage.path.static-export',
    diagnostic: 'KV229',
    escapeHatch: 'respond.file|respond.stream|storage-adapter',
    guard: 'path-containment+attachment-nosniff+static-export-reference-check',
    runtimeGuard:
      'safe-content-disposition+reserved-dynamic-endpoint-refusal+storage-key-validation',
    schema: 'FileSchema|StoredFile|static-export-manifest|storage-key',
    sink: 'file.storage.static-export',
    source: 'file-upload-metadata|file-upload-bytes|route-paths|asset-manifest|storage-key',
    specAnchor: 'SPEC.md#9.5;SPEC.md#11.4',
    testEvidence: [existingEvidence.storage, existingEvidence.staticExport],
    trust: 'filesystem-and-object-storage-boundary',
  },
  {
    context: 'auth.idor.session.owner-scope',
    diagnostic: 'KV414',
    escapeHatch: 'public-read-justification',
    guard: 'authed+owns()+owner-table-scope',
    runtimeGuard: 'guard-refinement+runtime-observed-read-write-cross-check',
    schema: 'req.session|owner:domain|guard-chain|scope-audit',
    sink: 'auth.data-access',
    source: 'req.session|req.db-records|route-params|query-args',
    specAnchor: 'SPEC.md#6.2;SPEC.md#10.3;SPEC.md#11.2',
    testEvidence: ['packages/cli/src/index.kovo-explain.test.ts'],
    trust: 'principal-derived',
  },
  {
    context: 'sql.executable-text',
    diagnostic: 'KV406|KV410',
    escapeHatch: 'sql<T>+reads|raw-sql-tables+touches',
    guard: 'static-drizzle-analysis+runtime-statement-parser',
    runtimeGuard: 'observed-subset-static-or-declared',
    schema: 'projection-schema+reads-set+tables-allowlist',
    sink: 'sql.executable',
    source: 'input|req.search|req.params|form-body|headers|cookies|raw-sql-helpers',
    specAnchor: 'SPEC.md#10.2;SPEC.md#11.2;plans/sql-injection.md',
    testEvidence: ['packages/drizzle/src/index.query-shapes.test.ts'],
    trust: 'untrusted-query-input',
  },
  {
    context: 'dynamic-code.process',
    diagnostic: 'unallocated-source-sink-drift',
    escapeHatch: 'compiler-owned-versioned-handler-import',
    guard: 'closed-handler-registry+request-path-deny-audit',
    runtimeGuard: 'loader-imports-only-declared-/c/__v-refs',
    schema: 'HandlerModules+ComponentRegistry+build-preset-capabilities',
    sink: 'dynamic.import.process',
    source: 'handler-ref|dev-hmr-url|build-tooling|request-derived-string',
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
