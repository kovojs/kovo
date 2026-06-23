import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { kovoCheck, kovoExplain, main } from './index.js';
import {
  frameworkSourceSinkInventory,
  scanSourceSinkDrift,
  sourceSinkRedCorpus,
  sourceSinkRuntimeEvidence,
  sourcesSinksArtifactPath,
  sourcesSinksArtifactVersion,
} from './sources-sinks.js';

describe('source/sink inventory', () => {
  it('accounts for the initial required sink families', () => {
    const sinks = new Set(frameworkSourceSinkInventory().map((entry) => entry.sink));

    expect([...sinks].sort()).toEqual([
      'auth.data-access',
      'css.style.output',
      'dynamic.import.process',
      'file.storage.static-export',
      'html.dom.output',
      'http.header.cookie',
      'ingress.endpoint.webhook',
      'sql.executable',
      'transport.query.live.broadcast',
      'url.navigation.selector',
    ]);
  });

  it('accounts for the required source taxonomy tokens', () => {
    const searchableInventory = frameworkSourceSinkInventory()
      .map((entry) =>
        [
          entry.source,
          entry.trust,
          entry.schema,
          entry.firstParser,
          entry.consumers.join('|'),
        ].join('|'),
      )
      .join('\n');

    expect(searchableInventory).toContain('route().params');
    expect(searchableInventory).toContain('route().search');
    expect(searchableInventory).toContain('GET-form-url-state');
    expect(searchableInventory).toContain('/_q/search-args');
    expect(searchableInventory).toContain('mutation-form-input');
    expect(searchableInventory).toContain('FormData');
    expect(searchableInventory).toContain('file-upload-metadata');
    expect(searchableInventory).toContain('file-upload-bytes');
    expect(searchableInventory).toContain('request.headers');
    expect(searchableInventory).toContain('cookies');
    expect(searchableInventory).toContain('raw-request-bodies');
    expect(searchableInventory).toContain('endpoint-webhook-bodies');
    expect(searchableInventory).toContain('webhook-provider-headers-signatures');
    expect(searchableInventory).toContain('req.session');
    expect(searchableInventory).toContain('req.db-records');
    expect(searchableInventory).toContain('streamed-model-output');
    expect(searchableInventory).toContain('compiler-read-app-source');
    expect(searchableInventory).toContain('Kovo-Targets');
    expect(searchableInventory).toContain('Kovo-Live-Targets');
    expect(searchableInventory).toContain('fragment-targets');
    expect(searchableInventory).toContain('data-stream-text');
    expect(searchableInventory).toContain('URL-fragments-hashes');
    expect(searchableInventory).toContain('static-export-route-paths-assets-manifests');
    expect(searchableInventory).toContain('app-config-env-values');
  });

  it('accounts for the required sink taxonomy tokens', () => {
    const searchableInventory = frameworkSourceSinkInventory()
      .map((entry) =>
        [
          entry.sink,
          entry.context,
          entry.schema,
          entry.runtimeGuard,
          entry.guard,
          entry.escapeHatch,
          entry.consumers.join('|'),
        ].join('|'),
      )
      .join('\n');

    expect(searchableInventory).toContain('JSX-text');
    expect(searchableInventory).toContain('attribute-values');
    expect(searchableInventory).toContain('rawHtml');
    expect(searchableInventory).toContain('trustedHtml');
    expect(searchableInventory).toContain('fragment-HTML');
    expect(searchableInventory).toContain('morph-innerHTML-insertAdjacentHTML');
    expect(searchableInventory).toContain('script-json-island');
    expect(searchableInventory).toContain('kovo-query');
    expect(searchableInventory).toContain('kovo-text');
    expect(searchableInventory).toContain('srcdoc');
    expect(searchableInventory).toContain('event-handler-attributes');
    expect(searchableInventory).toContain('live-property-writes');
    expect(searchableInventory).toContain('template-stamps');
    expect(searchableInventory).toContain('rich-text-registry');
    expect(searchableInventory).toContain('href');
    expect(searchableInventory).toContain('formaction');
    expect(searchableInventory).toContain('meta-url-content');
    expect(searchableInventory).toContain('redirect-Location');
    expect(searchableInventory).toContain('auth-next');
    expect(searchableInventory).toContain('route-normalization-redirects');
    expect(searchableInventory).toContain('enhanced-navigation-fetch-targets');
    expect(searchableInventory).toContain('dynamic-import-handler-refs');
    expect(searchableInventory).toContain('immutable-c-v-client-module-URLs');
    expect(searchableInventory).toContain('querySelector');
    expect(searchableInventory).toContain('hash-scrolling');
    expect(searchableInventory).toContain('static-export-reserved-refs');
    expect(searchableInventory).toContain('style-attribute');
    expect(searchableInventory).toContain('style-text');
    expect(searchableInventory).toContain('raw-CSS');
    expect(searchableInventory).toContain('StyleX-extraction');
    expect(searchableInventory).toContain('CSS-custom-properties');
    expect(searchableInventory).toContain('url()-inside-CSS');
    expect(searchableInventory).toContain('view-transition-name');
    expect(searchableInventory).toContain('runtime-style-property-writers');
    expect(searchableInventory).toContain('generated-keyframe-theme-output');
    expect(searchableInventory).toContain('mutation-response-header-channel');
    expect(searchableInventory).toContain('route-outcome-headers');
    expect(searchableInventory).toContain('Set-Cookie');
    expect(searchableInventory).toContain('Content-Type');
    expect(searchableInventory).toContain('Content-Disposition');
    expect(searchableInventory).toContain('Retry-After');
    expect(searchableInventory).toContain('Node-Bun-Workers-header-conversion');
    expect(searchableInventory).toContain('endpoint-raw-Response');
    expect(searchableInventory).toContain('webhook-responses');
    expect(searchableInventory).toContain('/_q-typed-reads');
    expect(searchableInventory).toContain('SSE-live-query-pushes');
    expect(searchableInventory).toContain('BroadcastChannel-rebroadcast');
    expect(searchableInventory).toContain('HMR-dev-refresh-endpoints');
    expect(searchableInventory).toContain('mutation-defer-streams');
    expect(searchableInventory).toContain('Kovo-Changes');
    expect(searchableInventory).toContain('fragment-target-selection');
    expect(searchableInventory).toContain('upload-schema-storage');
    expect(searchableInventory).toContain('storage-keys-metadata');
    expect(searchableInventory).toContain('filesystem-S3-adapters');
    expect(searchableInventory).toContain('respond.file');
    expect(searchableInventory).toContain('respond.stream');
    expect(searchableInventory).toContain('static-export-output-paths');
    expect(searchableInventory).toContain('Vite-manifest-asset-copies');
    expect(searchableInventory).toContain('compiler-persistent-cache-refs');
    expect(searchableInventory).toContain('generated-graph-output-files');
    expect(searchableInventory).toContain('content-disposition-filename');
    expect(searchableInventory).toContain('owner-annotated-table-reads-writes');
    expect(searchableInventory).toContain('guard-refinement-results');
    expect(searchableInventory).toContain('session-provider-cookies');
    expect(searchableInventory).toContain('unauthenticated-redirects');
    expect(searchableInventory).toContain('CSRF-exempt-mutations-endpoints');
    expect(searchableInventory).toContain('webhook-verify-none');
    expect(searchableInventory).toContain('replay-stores');
    expect(searchableInventory).toContain('rate-limit-keys');
    expect(searchableInventory).toContain('query-cacheability');
    expect(searchableInventory).toContain('import()');
    expect(searchableInventory).toContain('compiler-dev-HMR-module-loading');
    expect(searchableInventory).toContain('build-preset-runtime-API-compatibility');
    expect(searchableInventory).toContain('new Function');
    expect(searchableInventory).toContain('eval');
    expect(searchableInventory).toContain('vm');
    expect(searchableInventory).toContain('child_process');
    expect(searchableInventory).toContain('shell-commands-in-scripts');
    expect(searchableInventory).toContain('adapter-asset-fetch-fallbacks');
  });

  it('accounts for the Phase 2 red corpus payload families', () => {
    const corpus = sourceSinkRedCorpus();
    const corpusByFamily = new Map(corpus.map((entry) => [entry.family, entry]));
    const requiredFamilies = [
      'dynamic.import.process',
      'file.storage.static-export',
      'html.dom.output',
      'http.header.cookie',
      'ingress.endpoint.webhook',
      'transport.query.live.broadcast',
      'url.navigation.selector',
    ];

    expect([...corpusByFamily.keys()].sort()).toEqual(requiredFamilies);
    for (const family of requiredFamilies) {
      const entry = corpusByFamily.get(family);
      expect(entry?.payloads.length).toBeGreaterThanOrEqual(8);
      expect(entry?.negativeTestEvidence.length).toBeGreaterThanOrEqual(1);
      expect(entry?.positiveTestEvidence.length).toBeGreaterThanOrEqual(1);
    }

    const searchableCorpus = corpus
      .map((entry) =>
        [
          entry.family,
          entry.payloads.join('|'),
          entry.expected,
          entry.negativeTestEvidence.join('|'),
          entry.positiveTestEvidence.join('|'),
        ].join('|'),
      )
      .join('\n');

    expect(searchableCorpus).toContain('<script>');
    expect(searchableCorpus).toContain('<img onerror>');
    expect(searchableCorpus).toContain('javascript:');
    expect(searchableCorpus).toContain('protocol-relative //host');
    expect(searchableCorpus).toContain('CR/LF/NUL/DEL/control chars');
    expect(searchableCorpus).toContain('webhook signature over prettified body');
    expect(searchableCorpus).toContain('cross-principal BroadcastChannel envelope');
    expect(searchableCorpus).toContain('hostile Kovo-Targets');
    expect(searchableCorpus).toContain('traversal in params/filenames/storage keys');
    expect(searchableCorpus).toContain('Vite manifest path escapes');
    expect(searchableCorpus).toContain('request-derived import URL');
    expect(searchableCorpus).toContain('request-path child_process');
  });

  it('accounts for runtime chokepoints, parity pairs, and fail-closed shapes', () => {
    const runtime = sourceSinkRuntimeEvidence();

    expect(runtime.runtimeChokepoints.map((entry) => entry.chokepoint).sort()).toEqual([
      'CSRF/replay lifecycle',
      'DB handle guard',
      'browser update plan',
      'client module registry',
      'endpoint/webhook dispatcher',
      'fragment/morph apply',
      'header/cookie builder',
      'query endpoint',
      'request shell',
      'route/mutation/query response builders',
      'server renderer',
      'static export writer',
      'storage adapter',
    ]);
    expect(runtime.parityPairs.map((entry) => entry.pair).sort()).toEqual([
      'modular vs inline loader selector escaping',
      'query endpoint vs BroadcastChannel/live transports',
      'route redirects vs mutation redirects/auth next',
      'server URL attributes vs browser bound attributes',
      'server text/JSON vs browser query/fragment apply',
    ]);
    expect(runtime.failClosedCases.map((entry) => entry.shape).sort()).toEqual([
      'CSRF mismatch',
      'bad headers/cookies',
      'body too large',
      'cross-principal broadcast',
      'disallowed storage path',
      'selector construction failure',
      'stale build token',
      'unbranded raw SQL',
      'unsafe URL scheme',
    ]);

    for (const entry of runtime.runtimeChokepoints) {
      expect(entry.guard).not.toBe('');
      expect(entry.testEvidence.length).toBeGreaterThanOrEqual(1);
    }
    for (const entry of runtime.parityPairs) {
      expect(entry.claim).not.toBe('');
      expect(entry.testEvidence.length).toBeGreaterThanOrEqual(1);
    }
    for (const entry of runtime.failClosedCases) {
      expect(entry.guard).not.toBe('');
      expect(entry.testEvidence.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('prints stable explain text with the required Phase 1 fields', () => {
    expect(kovoExplain({}, { sourcesSinks: true })).toMatchObject({
      exitCode: 0,
      output: expect.stringContaining('kovo-explain/v1\nSOURCES-SINKS'),
    });
    expect(kovoExplain({}, { sourcesSinks: true }).output).toContain(
      'ITEM source=server-render|client-query|client-state|template-stamp|data-stream-text|streamed-model-output|compiler-read-app-source|db-user-text sink=html.dom.output context=html.text+attribute+url+script-json+style+srcdoc trust=untrusted-unless-branded firstParser=tsx-lowered-output-context consumers=server-renderer|browser-output-helpers|compiler-output-context-facts guard=contextual-encoding+url-scheme-allowlist:http|https|mailto|tel|ftp',
    );
    expect(kovoExplain({}, { sourcesSinks: true }).output).toContain(
      'diagnostic=KV236 escapeHatch=trustedHtml|trustedUrl specAnchor=SPEC.md#4.8;SPEC.md#5.2 testEvidence=packages/compiler/src/output-context-security.test.ts,packages/browser/src/security-output.test.ts',
    );
  });

  it('prints source ownership columns in explain output', () => {
    const result = kovoExplain({}, { sourcesSinks: true });

    expect(result.output).toContain(' firstParser=');
    expect(result.output).toContain(' consumers=');
    expect(result.output).toContain(' diagnostic=');
    expect(result.output).toContain(' escapeHatch=');
    expect(result.output).toContain('CORPUS family=html.dom.output');
    expect(result.output).toContain(' negative=');
    expect(result.output).toContain(' positive=');
    expect(result.output).toContain('CHOKEPOINT name=server renderer');
    expect(result.output).toContain(
      'PARITY pair=server URL attributes vs browser bound attributes',
    );
    expect(result.output).toContain('FAIL-CLOSED shape=unsafe URL scheme');
  });

  it('writes deterministic JSON from the check command', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-sources-sinks-'));
    const previous = process.cwd();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      process.chdir(root);

      expect(main(['check', 'sources-sinks'])).toBe(0);

      const artifact = JSON.parse(
        readFileSync(join(root, sourcesSinksArtifactPath), 'utf8'),
      ) as Record<string, unknown>;
      expect(artifact.version).toBe(sourcesSinksArtifactVersion);
      expect(artifact.generatedBy).toBe('kovo sources-sinks inventory');
      expect(artifact.redCorpus).toEqual(expect.any(Array));
      expect(artifact.runtimeEvidence).toEqual(expect.any(Object));
      expect(artifact.driftScan).toMatchObject({
        status: 'accounted',
        totalFiles: 0,
        totalHits: 0,
        unregistered: 0,
      });
      const entries = artifact.entries as unknown[];
      expect(entries.length).toBe(frameworkSourceSinkInventory().length);
      expect(entries[0]).toMatchObject({
        consumers: expect.any(Array),
        context: expect.any(String),
        diagnostic: expect.any(String),
        escapeHatch: expect.any(String),
        firstParser: expect.any(String),
        guard: expect.any(String),
        runtimeGuard: expect.any(String),
        schema: expect.any(String),
        sink: 'html.dom.output',
        source: expect.any(String),
        specAnchor: expect.any(String),
        testEvidence: expect.any(Array),
        trust: expect.any(String),
      });
      expect(stdout).toHaveBeenCalledWith(
        expect.stringContaining(
          'DRIFT-SCAN roots=packages|examples|site|tests files=0 hits=0 findings=0 unregistered=0 status=accounted',
        ),
      );
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      process.chdir(previous);
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('scans registered dangerous sink tokens by owner', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-sources-sinks-drift-'));
    try {
      mkdirSync(join(root, 'packages', 'app'), { recursive: true });
      writeFileSync(
        join(root, 'packages', 'app', 'route.tsx'),
        [
          'element.innerHTML = value;',
          'element.innerHTML = other;',
          'const headers = new Headers();',
          'return respond.file(path);',
        ].join('\n'),
      );

      expect(scanSourceSinkDrift(root)).toMatchObject({
        findings: [
          {
            count: 1,
            file: 'packages/app/route.tsx',
            owner: 'file.storage.static-export',
            token: 'respond.file',
          },
          {
            count: 2,
            file: 'packages/app/route.tsx',
            owner: 'html.dom.output',
            token: 'innerHTML',
          },
          {
            count: 1,
            file: 'packages/app/route.tsx',
            owner: 'http.header.cookie',
            token: 'Headers',
          },
        ],
        status: 'accounted',
        totalFiles: 1,
        totalHits: 4,
        unregistered: 0,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('exposes the same inventory through kovo check', () => {
    expect(kovoCheck({}, { family: 'sources-sinks' })).toMatchObject({
      exitCode: 0,
      output: expect.stringContaining('CHECK families=10 entries=10 drift-tokens=17'),
    });
  });
});
