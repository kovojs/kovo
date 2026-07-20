// @kovo-security-classifier-corpus capability-closure
import { describe, expect, it } from 'vitest';

import {
  analyzeCapabilityClosure,
  collectCapabilityPackageRequests,
  compilerGeneratedCapabilityDependencies,
  packageCapabilitySummarySchema,
  type CapabilityClosureSourceFile,
  type PackageCapabilitySummary,
  type ResolvedCapabilityPackage,
} from './security/capability-closure.js';
import { frameworkExportPosturePackages } from './security/framework-public-runtime-export-posture.generated.js';
import { canonicalFrameworkImplementationDigest } from './security/framework-implementation-digest.js';

const FRAMEWORK_VERSION = '0.2.0';

function resolved(
  specifier: string,
  options: {
    conditions?: readonly string[];
    fingerprint?: string;
    implementationDigest?: string | null;
    packageVersion?: string;
  } = {},
): ResolvedCapabilityPackage {
  const parts = specifier.split('/');
  const packageName = specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
  const subpath = specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
  const frameworkPackage = frameworkExportPosturePackages.find(
    ([candidate]) => candidate === packageName,
  );
  const frameworkVariant = frameworkPackage?.[2].find(([, subpaths]) =>
    subpaths.some(([candidate]) => candidate === subpath),
  );
  const frameworkIdentityVariant = frameworkVariant ?? frameworkPackage?.[2][0];
  const frameworkConditions = frameworkVariant?.[1].find(
    ([candidate]) => candidate === subpath,
  )?.[1];
  const implementationDigest =
    options.implementationDigest === null
      ? undefined
      : (options.implementationDigest ??
        (frameworkIdentityVariant?.[2][0] === undefined
          ? undefined
          : canonicalFrameworkImplementationDigest(packageName, frameworkIdentityVariant[2][0])));
  return {
    conditions: options.conditions ?? frameworkConditions ?? ['default', 'import'],
    exportStatus: 'resolved',
    ...(implementationDigest === undefined ? {} : { implementationDigest }),
    manifestFingerprint:
      options.fingerprint ?? frameworkIdentityVariant?.[0] ?? `manifest:${packageName}`,
    packageName,
    packageVersion:
      options.packageVersion ?? (packageName.startsWith('@kovojs/') ? FRAMEWORK_VERSION : '1.0.0'),
    specifier,
  };
}

function packagesFor(files: readonly CapabilityClosureSourceFile[]): ResolvedCapabilityPackage[] {
  return collectCapabilityPackageRequests(files).map(({ importer, specifier }) => ({
    ...resolved(specifier),
    ...(importer === undefined ? {} : { importer }),
  }));
}

function analyze(
  files: readonly CapabilityClosureSourceFile[],
  options: {
    packages?: readonly ResolvedCapabilityPackage[];
    packageSummaries?: readonly PackageCapabilitySummary[];
  } = {},
) {
  return analyzeCapabilityClosure({
    files,
    packages: options.packages ?? packagesFor(files),
    packageSummaries: options.packageSummaries ?? [],
  });
}

describe('SPEC §6.6 capability-closed module graph', () => {
  // @kovo-security-certifies C13 compiler-generated-wire-abi-provenance
  it('admits only exact compiler-generated wire ABI edges while authored and unknown variants stay closed', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { query, route } from '@kovojs/server';
          export const lookup = query({ run() { return 'safe'; } });
          export const page = route('/lookup', { render() { return lookup; } });
        `,
      },
    ];
    const compilerDependencies = compilerGeneratedCapabilityDependencies({
      authoredSource: files[0]!.source,
      fileName: files[0]!.fileName,
      loweredSource: `
        import { query, route } from '@kovojs/server';
        import { derive, kovoStyleProperty } from '@kovojs/browser/internal/output';
        import { renderGeneratedMutationFormFields } from '@kovojs/server/internal/csrf';
        import { escapeText, kovoSafeJsxSpread } from '@kovojs/server/internal/escape';
        import { defineCompiledRoutePage } from '@kovojs/server/internal/route';
        import { assignDerivedQueryKey as __kovoAssignDerivedQueryKey } from '@kovojs/server/internal/wire';
        export const lookup = __kovoAssignDerivedQueryKey(query({ run() { return 'safe'; } }), 'lookup');
        export const page = route('/lookup', { render() { return lookup; } });
      `,
    });
    expect(compilerDependencies).toEqual([
      {
        importer: 'app.ts',
        importedNames: ['derive', 'kovoStyleProperty'],
        kind: 'generated-internal-abi',
        site: 'app.ts:compiler-lowered',
        specifier: '@kovojs/browser/internal/output',
      },
      {
        importer: 'app.ts',
        importedNames: ['renderGeneratedMutationFormFields'],
        kind: 'generated-internal-abi',
        site: 'app.ts:compiler-lowered',
        specifier: '@kovojs/server/internal/csrf',
      },
      {
        importer: 'app.ts',
        importedNames: ['escapeText', 'kovoSafeJsxSpread'],
        kind: 'generated-internal-abi',
        site: 'app.ts:compiler-lowered',
        specifier: '@kovojs/server/internal/escape',
      },
      {
        importer: 'app.ts',
        importedNames: ['defineCompiledRoutePage'],
        kind: 'generated-internal-abi',
        site: 'app.ts:compiler-lowered',
        specifier: '@kovojs/server/internal/route',
      },
      {
        importer: 'app.ts',
        importedNames: ['assignDerivedQueryKey'],
        kind: 'generated-internal-abi',
        site: 'app.ts:compiler-lowered',
        specifier: '@kovojs/server/internal/wire',
      },
    ]);
    const packageRequests = collectCapabilityPackageRequests(files, compilerDependencies);
    const generated = analyzeCapabilityClosure({
      compilerDependencies,
      files,
      packages: packageRequests.map(({ importer, specifier }) => ({
        ...resolved(specifier),
        ...(importer === undefined ? {} : { importer }),
      })),
    });
    expect(generated.diagnostics).toEqual([]);
    expect(
      generated.dependencyManifest.dependencies
        .flatMap((dependency) => dependency.entries)
        .find((entry) => entry.specifier === '@kovojs/server/internal/wire'),
    ).toEqual(
      expect.objectContaining({
        importers: ['app.ts'],
        imports: expect.arrayContaining([
          expect.objectContaining({
            disposition: 'authority-free',
            name: 'assignDerivedQueryKey',
          }),
        ]),
      }),
    );

    const authored = [
      {
        fileName: 'app.ts',
        source: `
          import { assignDerivedQueryKey } from '@kovojs/server/internal/wire';
          import { route } from '@kovojs/server';
          export const page = route('/forged', { render() { return assignDerivedQueryKey; } });
        `,
      },
    ];
    const authoredResult = analyze(authored);
    expect(authoredResult.diagnostics[0]?.message).toContain(
      'does not classify public subpath ./internal/wire',
    );

    const unknownDependencies = compilerGeneratedCapabilityDependencies({
      authoredSource: files[0]!.source,
      fileName: files[0]!.fileName,
      loweredSource: `
        import { query, route } from '@kovojs/server';
        import { surpriseWireEscape } from '@kovojs/server/internal/wire';
        export const page = route('/unknown', { render() { return surpriseWireEscape; } });
      `,
    });
    const unknownRequests = collectCapabilityPackageRequests(files, unknownDependencies);
    const unknownResult = analyzeCapabilityClosure({
      compilerDependencies: unknownDependencies,
      files,
      packages: unknownRequests.map(({ importer, specifier }) => ({
        ...resolved(specifier),
        ...(importer === undefined ? {} : { importer }),
      })),
    });
    expect(unknownResult.diagnostics[0]?.message).toContain(
      'outside the exact compiler-generated @kovojs/server/internal/wire ABI vocabulary',
    );
  });

  it('retains package edges from malformed or rootless modules in the pre-evaluation loader census', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { trustedHtml } from '@kovojs/browser';
          export default { render: trustedHtml };
        `,
      },
    ];
    const result = analyze(files);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.dependencyManifest.dependencies.find(
        (dependency) => dependency.packageName === '@kovojs/browser',
      ),
    ).toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            importers: ['app.ts'],
            rootKinds: [],
            specifier: '@kovojs/browser',
          }),
        ],
        verdict: 'open',
      }),
    );
  });

  it('derives only the exact compiler-owned JSX runtime edges into the loader manifest', () => {
    const files = [
      {
        fileName: 'app.tsx',
        source: `
          import { route } from '@kovojs/server';
          export const page = route('/jsx', { render() { return <main>safe</main>; } });
        `,
      },
    ];
    const result = analyze(files);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.dependencyManifest.dependencies.flatMap((dependency) => dependency.entries),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specifier: '@kovojs/server/jsx-dev-runtime' }),
        expect.objectContaining({ specifier: '@kovojs/server/jsx-runtime' }),
      ]),
    );
    expect(
      result.dependencyManifest.dependencies
        .flatMap((dependency) => dependency.entries)
        .filter((entry) => entry.specifier.includes('jsx-'))
        .flatMap((entry) => entry.imports)
        .every((entry) => entry.disposition === 'authority-free'),
    ).toBe(true);

    const authoredRuntimeImport = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { jsxDEV } from '@kovojs/server/jsx-dev-runtime';
          import { route } from '@kovojs/server';
          export const page = route('/forged-jsx', { render() { return jsxDEV; } });
        `,
      },
    ]);
    expect(authoredRuntimeImport.diagnostics[0]?.message).toContain(
      'does not classify public subpath ./jsx-dev-runtime',
    );
  });

  it('censuses every shipping untrusted-data root kind, including application and browser callbacks', () => {
    const files = [
      {
        fileName: 'roots.tsx',
        source: `
          import { component } from '@kovojs/core';
          import { createApp, endpoint, layout, mutation, query, route, task, webhook } from '@kovojs/server';
          import { handler } from '@kovojs/browser';
          export const app = createApp({});
          export const page = route('/page', { access: {}, render() { return null; } });
          export const chrome = layout({ render() { return null; } });
          export const save = mutation('save', { handler() {} });
          export const read = query('read', { load() { return null; } });
          export const api = endpoint('/api', { handler() {} });
          export const hook = webhook('/hook', { handler() {} });
          export const durable = task('durable', { run() {} });
          export const scheduled = task('scheduled', { cron: '* * * * *', run() {} });
          export const direct = handler(() => {});
          export const Button = component({ render() { return <button onClick={() => {}}>go</button>; } });
        `,
      },
    ];
    const result = analyze(files);
    const kinds = result.facts
      .filter((fact) => fact.kind === 'root')
      .map((fact) => fact.rootKind)
      .sort();
    expect(kinds).toEqual([
      'application',
      'durable-task',
      'endpoint',
      'layout',
      'mutation',
      'query',
      'route',
      'scheduled-task',
      'serialized-browser-handler',
      'serialized-browser-handler',
      'webhook',
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.facts
        .filter((fact) => fact.kind === 'door' && fact.capability === 'network')
        .map((fact) => fact.rootKind)
        .sort(),
    ).toEqual(['durable-task', 'scheduled-task', 'webhook']);
  });

  it('closes the deferred fabricated agent-tool export without instantiating a ghost root', () => {
    const result = analyze([
      {
        fileName: 'agent-tool.ts',
        source: `
          import { agentTool, route } from '@kovojs/server';
          export const page = route('/agent-tool', { render() { return agentTool; } });
        `,
      },
    ]);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe('KV448');
    expect(result.diagnostics[0]!.message).toContain('does not classify runtime export agentTool');
    expect(result.facts).not.toContainEqual(
      expect.objectContaining({ kind: 'root', rootKind: 'agent-tool-callback' }),
    );
  });

  it('roots createApp lifecycle modules and closes their raw authority', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { createApp } from '@kovojs/server';
          import { onError, sessionProvider } from './lifecycle.js';
          export const app = createApp({ onError, sessionProvider });
        `,
      },
      {
        fileName: 'lifecycle.ts',
        source: `
          import { readFileSync } from 'node:fs';
          export const sessionProvider = { load() { return readFileSync('/ambient-session'); } };
          export function onError() { return readFileSync('/ambient-error'); }
        `,
      },
    ];
    const result = analyze(files);

    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: 'app', rootKind: 'application' }),
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'KV448', fileName: 'lifecycle.ts' });
    expect(result.diagnostics[0]!.message).toContain('root=application:app');
    expect(result.diagnostics[0]!.message).toContain('raw filesystem authority');
    expect(result.diagnostics[0]!.message).toContain('import:./lifecycle.js@app.ts');
  });

  it('closes raw authority through wrappers, re-exports, literal dynamic import, and require', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from './route-kit.js';
          import('./dynamic.js');
          require('./required.js');
          export const page = route('/closed', { render() { return null; } });
        `,
      },
      {
        fileName: 'route-kit.ts',
        source: `export { route } from './wrapped.js';`,
      },
      {
        fileName: 'wrapped.ts',
        source: `
          import { route as frameworkRoute } from '@kovojs/server';
          export const route = frameworkRoute;
        `,
      },
      {
        fileName: 'dynamic.ts',
        source: `export { readFileSync } from 'node:fs';`,
      },
      {
        fileName: 'required.ts',
        source: `import { request } from 'node:http'; export { request };`,
      },
    ];
    const result = analyze(files);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448', 'KV448']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'dynamic-import:./dynamic.js@app.ts',
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'require:./required.js@app.ts',
    );
    expect(
      result.facts
        .filter((fact) => fact.kind === 'closed')
        .map((fact) => fact.capability)
        .sort(),
    ).toEqual(['filesystem', 'network']);
  });

  it('follows callbacks and object containers transferred into an imported local wrapper', () => {
    const files = [
      {
        fileName: 'wrapper.ts',
        source: `
          import { route } from '@kovojs/server';
          export function definePage(config) { return route('/callback', config); }
        `,
      },
      {
        fileName: 'caller.ts',
        source: `
          import { definePage } from './wrapper.js';
          import { render } from './callback.js';
          export const page = definePage({ render });
        `,
      },
      {
        fileName: 'callback.ts',
        source: `export function render() { return process.env.SECRET; }`,
      },
    ];
    const result = analyze(files);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'callback-transfer:definePage(caller.ts callback/container)@wrapper.ts',
    );
    expect(result.diagnostics[0]!.message).toContain('global process@callback.ts');
  });

  it('follows callback parameters through nested local wrapper factories', () => {
    const files = [
      {
        fileName: 'inner.ts',
        source: `
          import { route } from '@kovojs/server';
          export function inner(config) { return route('/nested', config); }
        `,
      },
      {
        fileName: 'outer.ts',
        source: `
          import { inner } from './inner.js';
          export function outer(config) { return inner(config); }
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { outer } from './outer.js';
          export const page = outer({ render() { return process.env.SECRET; } });
        `,
      },
    ];
    const result = analyze(files);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'callback-transfer:inner(outer.ts callback/container)@inner.ts',
    );
    expect(result.diagnostics[0]!.message).toContain(
      'callback-transfer:outer(app.ts callback/container)@outer.ts',
    );
  });

  it('resolves root factories through namespace aliases', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import * as server from '@kovojs/server';
          const kovo = server;
          export const page = kovo.route('/aliased', { render() { return null; } });
        `,
      },
    ];
    const result = analyze(files);
    expect(result.diagnostics).toEqual([]);
    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: '/aliased', rootKind: 'route' }),
    );
  });

  it('fails closed for non-literal dynamic loading and conditional arms with an unresolved target', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          const selected = Math.random() ? './safe.js' : './missing.js';
          import(selected);
          export const page = route('/dynamic', { render() { return null; } });
        `,
      },
    ];
    const result = analyze(files);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'dynamic-import target is not a compile-visible string literal',
    );
  });

  it('keeps shadowed globals and require open while closing global aliases and raw worker/VM globals', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { endpoint } from '@kovojs/server';
          function harmless(fetch, process, globalThis, require, RTCPeerConnection) {
            const localPlatform = globalThis;
            require('./not-a-module.js');
            return fetch(process) ?? globalThis.fetch ?? localPlatform.fetch ?? RTCPeerConnection;
          }
          const platform = globalThis;
          const rawFetch = platform['fetch'];
          const worker = new Worker('./job.js');
          const evaluate = Function('return 1');
          export const api = endpoint('/globals', { handler() { return harmless(1, 2); } });
        `,
      },
    ];
    const result = analyze(files);
    expect(
      result.facts
        .filter((fact) => fact.kind === 'closed')
        .map((fact) => fact.capability)
        .sort(),
    ).toEqual(['network', 'vm', 'worker']);
  });

  it('closes platform loaders, Web execution, service workers, and Cloudflare sockets', () => {
    const files = [
      {
        fileName: 'platform.ts',
        source: `
          import { route } from '@kovojs/server';
          import { connect } from 'cloudflare:sockets';
          import { WASI } from 'node:wasi';
          const load = require;
          const wasm = WebAssembly;
          const realm = new ShadowRealm();
          const transport = new WebTransport('https://transport.example');
          const serviceWorker = navigator.serviceWorker;
          export const page = route('/platform', { render() {
            return [connect, WASI, load, wasm, realm, transport, serviceWorker];
          } });
        `,
      },
    ];
    const result = analyze(files);
    expect(
      result.facts
        .filter((fact) => fact.kind === 'closed')
        .map((fact) => fact.capability)
        .sort(),
    ).toEqual(['dynamic-loader', 'network', 'network', 'vm', 'vm', 'vm', 'worker']);
  });

  it('closes WebRTC peer networking as raw browser network authority', () => {
    const result = analyze([
      {
        fileName: 'webrtc.ts',
        source: `
          import { handler } from '@kovojs/browser';
          const platform = globalThis;
          const GlobalPeer = globalThis['RTCPeerConnection'];
          const AliasPeer = platform.RTCPeerConnection;
          export const connect = handler(() => {
            const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:peer.example' }] });
            const globalPeer = new GlobalPeer();
            const aliasPeer = new AliasPeer();
            return [
              peer.createDataChannel('direct'),
              globalPeer.createDataChannel('global-member'),
              aliasPeer.createDataChannel('namespace-alias'),
            ];
          });
        `,
      },
    ]);

    expect(result.facts).toContainEqual(
      expect.objectContaining({
        capability: 'network',
        kind: 'closed',
        reason: expect.stringContaining('global RTCPeerConnection'),
      }),
    );
    expect(
      result.facts.filter(
        (fact) => fact.kind === 'closed' && fact.reason.includes('RTCPeerConnection'),
      ),
    ).toHaveLength(3);
    expect(result.diagnostics).toHaveLength(3);
  });

  it('closes builtin subpaths but ignores type-only authority imports', () => {
    const closed = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { type Stats } from 'node:fs';
          import { readFile } from 'node:fs/promises';
          export const page = route('/files', { render() { return readFile; } });
        `,
      },
    ]);
    expect(closed.diagnostics).toHaveLength(1);
    expect(closed.facts).toContainEqual(
      expect.objectContaining({ capability: 'filesystem', kind: 'closed' }),
    );

    const typeOnly = analyze([
      {
        fileName: 'types.ts',
        source: `
          import { route } from '@kovojs/server';
          import { type Stats } from 'node:fs';
          export const page = route('/types', { render() { return null; } });
        `,
      },
    ]);
    expect(typeOnly.diagnostics).toEqual([]);
  });

  it('accepts exact least-authority package summaries and rejects absent, stale, conditional, and contradictory summaries', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { parse } from 'safe-parser';
          export const page = route('/package', { render() { return parse('ok'); } });
        `,
      },
    ];
    const packageFact = resolved('safe-parser', {
      conditions: ['browser', 'default', 'import'],
      fingerprint: 'sha256:package-v1',
      packageVersion: '1.2.3',
    });
    const summary: PackageCapabilitySummary = {
      entries: [
        {
          conditions: ['browser', 'default', 'import'],
          exports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
          subpath: '.',
        },
      ],
      manifestFingerprint: 'sha256:package-v1',
      packageName: 'safe-parser',
      packageVersion: '1.2.3',
      schema: packageCapabilitySummarySchema,
      source: 'kovo.capabilities.json',
      summaryVersion: 'safe-parser-review/1',
    };
    const packageFacts = [resolved('@kovojs/server'), packageFact];

    expect(
      analyze(files, { packages: packageFacts, packageSummaries: [summary] }).diagnostics,
    ).toEqual([]);

    const absent = analyze(files, { packages: packageFacts });
    expect(absent.diagnostics[0]!.message).toContain(
      'has no reviewed exact-version capability summary',
    );

    const stale = analyze(files, {
      packages: packageFacts,
      packageSummaries: [{ ...summary, packageVersion: '1.2.2' }],
    });
    expect(stale.diagnostics[0]!.message).toContain(
      'summary covers 1.2.2, installed package is 1.2.3',
    );

    const conditional = analyze(files, {
      packages: packageFacts,
      packageSummaries: [
        { ...summary, entries: [{ ...summary.entries[0]!, conditions: ['default', 'import'] }] },
      ],
    });
    expect(conditional.diagnostics[0]!.message).toContain(
      'do not cover installed conditional exports',
    );

    const contradictory = analyze(files, {
      packages: packageFacts,
      packageSummaries: [summary, { ...summary, summaryVersion: 'safe-parser-review/2' }],
    });
    expect(contradictory.diagnostics[0]!.message).toContain('2 contradictory summaries');
  });

  it('derives the loader manifest from the exact L1 package verdict and reachable roots', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { parse } from 'safe-parser';
          export const page = route('/package', { render() { return parse('ok'); } });
        `,
      },
    ];
    const packageFact = resolved('safe-parser', {
      conditions: ['default', 'import'],
      fingerprint: 'sha256:package-v1',
      packageVersion: '1.2.3',
    });
    const summary: PackageCapabilitySummary = {
      entries: [
        {
          conditions: packageFact.conditions,
          exports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
          subpath: '.',
        },
      ],
      manifestFingerprint: packageFact.manifestFingerprint,
      packageName: packageFact.packageName,
      packageVersion: packageFact.packageVersion,
      schema: packageCapabilitySummarySchema,
      source: 'kovo.capabilities.json',
      summaryVersion: 'safe-parser-review/1',
    };
    const result = analyze(files, {
      packages: [resolved('@kovojs/server'), packageFact],
      packageSummaries: [summary],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.dependencyManifest).toMatchObject({
      schema: 'kovo-app-dependency-capabilities/v1',
    });
    expect(
      result.dependencyManifest.dependencies.find(
        (dependency) => dependency.packageName === 'safe-parser',
      ),
    ).toEqual({
      entries: [
        {
          conditions: ['default', 'import'],
          importers: ['app.ts'],
          imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
          rootKinds: ['route'],
          sites: ['app.ts:3:33'],
          specifier: 'safe-parser',
        },
      ],
      manifestFingerprint: 'sha256:package-v1',
      packageName: 'safe-parser',
      packageVersion: '1.2.3',
      summaryVersion: 'safe-parser-review/1',
      verdict: 'open',
    });
  });

  it('binds first-party verdicts to exact installed source or packed implementation identity', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          export const page = route('/identity', { render() { return null; } });
        `,
      },
    ];
    const reviewed = resolved('@kovojs/server');
    expect(analyze(files, { packages: [reviewed] }).diagnostics).toEqual([]);

    const drifted = analyze(files, {
      packages: [
        {
          ...reviewed,
          implementationDigest: `kovo-source-tree-sha256:${'0'.repeat(64)}`,
        },
      ],
    });
    expect(drifted.diagnostics).toHaveLength(1);
    expect(drifted.diagnostics[0]!.message).toContain(
      'installed implementation digest does not match',
    );

    const missing = analyze(files, {
      packages: [resolved('@kovojs/server', { implementationDigest: null })],
    });
    expect(missing.diagnostics).toHaveLength(1);
    expect(missing.diagnostics[0]!.message).toContain(
      'no compiler-derived installed implementation digest',
    );
  });

  it('requires package summaries to classify side-effect module initialization explicitly', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import 'safe-parser';
          export const page = route('/side-effect', { render() { return null; } });
        `,
      },
    ];
    const packageFact = resolved('safe-parser');
    const baseSummary: PackageCapabilitySummary = {
      entries: [
        {
          conditions: packageFact.conditions,
          exports: [],
          subpath: '.',
        },
      ],
      manifestFingerprint: packageFact.manifestFingerprint,
      packageName: packageFact.packageName,
      packageVersion: packageFact.packageVersion,
      schema: packageCapabilitySummarySchema,
      source: 'kovo.capabilities.json',
      summaryVersion: 'safe-parser/side-effects-1',
    };
    const packages = [resolved('@kovojs/server'), packageFact];

    const omitted = analyze(files, { packages, packageSummaries: [baseSummary] });
    expect(omitted.diagnostics[0]!.message).toContain('does not classify export <module>');

    const reviewed = analyze(files, {
      packages,
      packageSummaries: [
        {
          ...baseSummary,
          entries: [
            {
              ...baseSummary.entries[0]!,
              exports: [{ capabilities: [], disposition: 'pure', name: '<module>' }],
            },
          ],
        },
      ],
    });
    expect(reviewed.diagnostics).toEqual([]);
  });

  // @kovo-security-certifies C13 dependency-module-initializer-verdict
  it('requires every named package import to consume an explicit module initializer verdict', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { parse } from 'safe-parser';
          export const page = route('/initializer', { render() { return parse('ok'); } });
        `,
      },
    ];
    const packageFact = resolved('safe-parser');
    const summary: PackageCapabilitySummary = {
      entries: [
        {
          conditions: packageFact.conditions,
          exports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
          subpath: '.',
        },
      ],
      manifestFingerprint: packageFact.manifestFingerprint,
      packageName: packageFact.packageName,
      packageVersion: packageFact.packageVersion,
      schema: packageCapabilitySummarySchema,
      source: 'kovo.capabilities.json',
      summaryVersion: 'safe-parser/initializer-1',
    };
    const packages = [resolved('@kovojs/server'), packageFact];

    const omitted = analyze(files, { packages, packageSummaries: [summary] });
    expect(omitted.diagnostics[0]!.message).toContain('does not classify export <module>');

    const raw = analyze(files, {
      packages,
      packageSummaries: [
        {
          ...summary,
          entries: [
            {
              ...summary.entries[0]!,
              exports: [
                { capabilities: ['network'], disposition: 'raw', name: '<module>' },
                ...summary.entries[0]!.exports,
              ],
            },
          ],
        },
      ],
    });
    expect(raw.diagnostics[0]!.message).toContain(
      'package safe-parser export <module> exposes raw network authority',
    );

    const pure = analyze(files, {
      packages,
      packageSummaries: [
        {
          ...summary,
          entries: [
            {
              ...summary.entries[0]!,
              exports: [
                { capabilities: [], disposition: 'pure', name: '<module>' },
                ...summary.entries[0]!.exports,
              ],
            },
          ],
        },
      ],
    });
    expect(pure.diagnostics).toEqual([]);
    expect(
      pure.dependencyManifest.dependencies
        .find((dependency) => dependency.packageName === 'safe-parser')
        ?.entries[0]?.imports.map((permission) => permission.name),
    ).toEqual(['<module>', 'parse']);
  });

  it('rejects raw authority and forged framework-door disposition in third-party summaries', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { connect, read } from 'mixed-package';
          export const page = route('/mixed', { render() { return read(connect); } });
        `,
      },
    ];
    const packageFact = resolved('mixed-package');
    const summary: PackageCapabilitySummary = {
      entries: [
        {
          conditions: packageFact.conditions,
          exports: [
            { capabilities: ['network'], disposition: 'raw', name: 'connect' },
            { capabilities: ['filesystem'], disposition: 'framework-door', name: 'read' },
          ],
          subpath: '.',
        },
      ],
      manifestFingerprint: packageFact.manifestFingerprint,
      packageName: packageFact.packageName,
      packageVersion: packageFact.packageVersion,
      schema: packageCapabilitySummarySchema,
      source: 'kovo.capabilities.json',
      summaryVersion: 'mixed/1',
    };
    const result = analyze(files, {
      packages: [resolved('@kovojs/server'), packageFact],
      packageSummaries: [summary],
    });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'exposes raw network authority',
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'only the compiler-owned Kovo registry',
    );
  });

  it('keeps supported framework network, filesystem, process, and database doors open and explain-visible', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import {
            createPostgresAppRuntimeDb,
            createS3CompatibleStorage,
            rootedFiles,
            route,
            runCommand,
          } from '@kovojs/server';
          export const page = route('/doors', { render() {
            return [createPostgresAppRuntimeDb, createS3CompatibleStorage, rootedFiles, runCommand];
          } });
        `,
      },
    ];
    const result = analyze(files);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.facts
        .filter((fact) => fact.kind === 'door')
        .map((fact) => fact.capability)
        .sort(),
    ).toEqual([
      'crypto-acquisition',
      'database-driver',
      'digest',
      'filesystem',
      'network',
      'process',
    ]);
    expect(result.facts.some((fact) => fact.kind === 'summary' && fact.status === 'valid')).toBe(
      true,
    );
  });

  it('keeps reviewed purpose-minimal crypto exports open and explain-visible', () => {
    const exportsByPackage = {
      '@kovojs/core': ['createFileSystemStorage', 'hmacSignature', 'standardWebhooks'],
      '@kovojs/server': [
        'createConfidentialAtRestCipher',
        'createFileSystemStorage',
        'createStorageDownloadEndpoint',
        'decryptAtRest',
        'encryptAtRest',
        'hashPassword',
        'hmacSignature',
        'mintCsrfField',
        'mintCsrfToken',
        'renderRouteHtml',
        'rewrapAtRest',
        'standardWebhooks',
        'verifyCredential',
        'verifyPassword',
      ],
    } as const;

    for (const [packageName, exportNames] of Object.entries(exportsByPackage)) {
      for (const exportName of exportNames) {
        const result = analyze([
          {
            fileName: 'app.ts',
            source: `
              import { route } from '@kovojs/server';
              import { ${exportName} as cryptoDoor } from '${packageName}';
              export const page = route('/crypto-door', { render() { return cryptoDoor; } });
            `,
          },
        ]);
        expect(result.diagnostics, `${packageName}#${exportName}`).toEqual([]);
        expect(result.facts, `${packageName}#${exportName}`).toContainEqual(
          expect.objectContaining({
            capability: 'crypto-acquisition',
            kind: 'door',
            reason: expect.stringContaining(`through ${exportName}`),
          }),
        );
      }
    }
  });

  it('request-closes public testing and Vite tooling subpaths', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { createPostgresTestRuntime } from '@kovojs/server/testing';
          import { kovo } from '@kovojs/server/vite';
          export const page = route('/tooling-doors', { render() {
            return [createPostgresTestRuntime, kovo];
          } });
        `,
      },
    ];
    const result = analyze(files);
    expect(result.diagnostics).toHaveLength(6);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'testing is tooling/bootstrap authority',
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'vite is tooling/bootstrap authority',
    );
    expect(
      result.facts
        .filter((fact) => fact.kind === 'closed')
        .map((fact) => fact.capability)
        .sort(),
    ).toEqual([
      'database-driver',
      'dynamic-loader',
      'filesystem',
      'filesystem',
      'process',
      'process',
    ]);
  });

  it('fails closed for absent first-party named/default exports while retaining exact module posture', () => {
    const named = analyze([
      {
        fileName: 'named.ts',
        source: `
          import { route, unreviewedRuntimeExport } from '@kovojs/server';
          export const page = route('/named', { render() { return unreviewedRuntimeExport; } });
        `,
      },
    ]);
    expect(named.diagnostics).toHaveLength(1);
    expect(named.diagnostics[0]!.message).toContain(
      'does not classify runtime export unreviewedRuntimeExport',
    );

    const defaultImport = analyze([
      {
        fileName: 'default.ts',
        source: `
          import serverDefault, { route } from '@kovojs/server';
          export const page = route('/default', { render() { return serverDefault; } });
        `,
      },
    ]);
    expect(defaultImport.diagnostics).toHaveLength(1);
    expect(defaultImport.diagnostics[0]!.message).toContain(
      'does not classify runtime export default',
    );

    const moduleInit = analyze([
      {
        fileName: 'module.ts',
        source: `
          import '@kovojs/server';
          import { route } from '@kovojs/server';
          export const page = route('/module', { render() { return null; } });
        `,
      },
    ]);
    expect(moduleInit.diagnostics).toEqual([]);
    expect(moduleInit.facts).toContainEqual(
      expect.objectContaining({ capability: 'process', kind: 'door' }),
    );
    expect(moduleInit.facts).toContainEqual(
      expect.objectContaining({ capability: 'crypto-acquisition', kind: 'door' }),
    );
  });

  it('expands exact namespace and literal dynamic imports without wildcard authorization', () => {
    const result = analyze([
      {
        fileName: 'namespace.ts',
        source: `
          import * as server from '@kovojs/server';
          import('@kovojs/server');
          export const page = server.route('/namespace', { render() { return null; } });
        `,
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.facts
        .filter((fact) => fact.kind === 'door')
        .map((fact) => fact.capability)
        .sort(),
    ).toEqual([
      'crypto-acquisition',
      'crypto-acquisition',
      'database-driver',
      'database-driver',
      'digest',
      'digest',
      'filesystem',
      'filesystem',
      'network',
      'network',
      'process',
      'process',
    ]);
  });

  it('request-closes arbitrary browser fetch from a serialized handler', () => {
    const result = analyze([
      {
        fileName: 'browser.ts',
        source: `
          import { handler } from '@kovojs/browser';
          import { defaultEnhancedFetch } from '@kovojs/browser/client';
          export const submit = handler((url) => defaultEnhancedFetch(url, {
            headers: {}, keepalive: false, method: 'POST'
          }));
        `,
      },
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        capability: 'network',
        kind: 'closed',
        rootKind: 'serialized-browser-handler',
      }),
    );
    expect(result.diagnostics[0]!.message).toContain(
      'browser bootstrap captures arbitrary-URL platform fetch authority',
    );
  });

  it('treats toNodeHandler as an exact low-level request root', () => {
    const result = analyze([
      {
        fileName: 'node-entry.ts',
        source: `
          import { readFileSync } from 'node:fs';
          import { toNodeHandler } from '@kovojs/server';
          const raw = async () => new Response(readFileSync('/tmp/secret'));
          export const listener = toNodeHandler(raw);
        `,
      },
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: 'listener', rootKind: 'endpoint' }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ capability: 'filesystem', kind: 'closed' }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ capability: 'network', kind: 'door' }),
    );
  });

  it('accepts the documented bootstrap-first separated custom Node adapter', () => {
    const result = analyze([
      {
        fileName: 'server.ts',
        source: `
          import '@kovojs/server/runtime-bootstrap';
          import { createServer } from 'node:http';
          import { toNodeHandler } from '@kovojs/server';
          import { handler } from './handler.js';
          createServer(toNodeHandler(handler)).listen(3000);
        `,
      },
      {
        fileName: 'handler.ts',
        source: `
          import { createRequestHandler } from '@kovojs/server';
          import { app } from './app.js';
          export const handler = createRequestHandler(app);
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { createApp } from '@kovojs/server';
          export const app = createApp({});
        `,
      },
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        capability: 'process',
        kind: 'door',
        module: 'server.ts',
      }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', module: 'handler.ts', rootKind: 'endpoint' }),
    );
  });

  it('rejects a custom adapter that loads its handler before runtime bootstrap', () => {
    const result = analyze([
      {
        fileName: 'server.ts',
        source: `
          import { handler } from './handler.js';
          import '@kovojs/server/runtime-bootstrap';
          import { createServer } from 'node:http';
          import { toNodeHandler } from '@kovojs/server';
          createServer(toNodeHandler(handler)).listen(3000);
        `,
      },
      {
        fileName: 'handler.ts',
        source: `export const handler = async () => new Response('ok');`,
      },
    ]);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'must import @kovojs/server/runtime-bootstrap as its exact literal first side-effect import',
    );
  });

  it('rejects runtime bootstrap in an inline toNodeHandler module', () => {
    const result = analyze([
      {
        fileName: 'server.ts',
        source: `
          import '@kovojs/server/runtime-bootstrap';
          import { toNodeHandler } from '@kovojs/server';
          const handler = async () => new Response('ok');
          export const listener = toNodeHandler(handler);
        `,
      },
    ]);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'only as the exact literal first side-effect import in a separated custom adapter entry',
    );
  });

  it('rejects runtime bootstrap imported by the request handler instead of its adapter entry', () => {
    const result = analyze([
      {
        fileName: 'server.ts',
        source: `
          import '@kovojs/server/runtime-bootstrap';
          import { createServer } from 'node:http';
          import { toNodeHandler } from '@kovojs/server';
          import { handler } from './handler.js';
          createServer(toNodeHandler(handler)).listen(3000);
        `,
      },
      {
        fileName: 'handler.ts',
        source: `
          import '@kovojs/server/runtime-bootstrap';
          export const handler = async () => new Response('ok');
        `,
      },
    ]);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'only as the exact literal first side-effect import in a separated custom adapter entry',
    );
  });

  it('keeps zero-public first-party packages compiler-owned instead of accepting project summaries', () => {
    const compilerPackage = frameworkExportPosturePackages.find(
      ([packageName]) => packageName === '@kovojs/compiler',
    )!;
    const packageFact = resolved('@kovojs/compiler/internal', {
      conditions: ['default'],
      fingerprint: compilerPackage[2][0]![0],
      implementationDigest: canonicalFrameworkImplementationDigest(
        '@kovojs/compiler',
        compilerPackage[2][0]![2][0]!,
      )!,
    });
    const summary: PackageCapabilitySummary = {
      entries: [
        {
          conditions: packageFact.conditions,
          exports: [{ capabilities: [], disposition: 'pure', name: 'compile' }],
          subpath: './internal',
        },
      ],
      manifestFingerprint: packageFact.manifestFingerprint,
      packageName: packageFact.packageName,
      packageVersion: packageFact.packageVersion,
      schema: packageCapabilitySummarySchema,
      source: 'kovo.capabilities.json',
      summaryVersion: 'forged-first-party/1',
    };
    const result = analyze(
      [
        {
          fileName: 'app.ts',
          source: `
            import { route } from '@kovojs/server';
            import { compile } from '@kovojs/compiler/internal';
            export const page = route('/compiler', { render() { return compile; } });
          `,
        },
      ],
      {
        packages: [resolved('@kovojs/server'), packageFact],
        packageSummaries: [summary],
      },
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'compiler-owned @kovojs/compiler posture does not classify public subpath ./internal',
    );
  });

  it('preserves raw driver closure while allowing reviewed Drizzle schema/query construction', () => {
    const safeFiles = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { eq } from 'drizzle-orm';
          import { pgTable } from 'drizzle-orm/pg-core';
          export const page = route('/safe-db', { render() { return [eq, pgTable]; } });
        `,
      },
    ];
    const safePackages = [
      resolved('@kovojs/server'),
      resolved('drizzle-orm', { packageVersion: '1.0.0-rc.4' }),
      resolved('drizzle-orm/pg-core', { packageVersion: '1.0.0-rc.4' }),
    ];
    expect(analyze(safeFiles, { packages: safePackages }).diagnostics).toEqual([]);

    const rawFiles = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { drizzle } from 'drizzle-orm/pglite';
          export const page = route('/raw-db', { render() { return drizzle; } });
        `,
      },
    ];
    const raw = analyze(rawFiles, {
      packages: [
        resolved('@kovojs/server'),
        resolved('drizzle-orm/pglite', { packageVersion: '1.0.0-rc.4' }),
      ],
    });
    expect(raw.diagnostics).toHaveLength(1);
    expect(raw.diagnostics[0]!.message).toContain('raw database-driver authority');
  });

  // @kovo-security-classifier-corpus C13 crypto-acquisition-vs-digest-capability
  it('classifies exact named non-keyed digests separately from secret crypto acquisition', () => {
    const digest = analyze([
      {
        fileName: 'digest.ts',
        source: `
          import { route } from '@kovojs/server';
          import { createHash } from 'node:crypto';
          export const page = route('/digest', { render() { return createHash('sha256'); } });
        `,
      },
    ]);
    expect(digest.diagnostics).toHaveLength(1);
    expect(digest.facts).toContainEqual(
      expect.objectContaining({ capability: 'digest', kind: 'closed' }),
    );

    for (const source of [
      `import { createHmac } from 'node:crypto'; export const value = createHmac;`,
      `import * as crypto from 'node:crypto'; export const value = crypto;`,
      `import argon2 from '@node-rs/argon2'; export const value = argon2;`,
      `export const value = globalThis.crypto.subtle;`,
      `const platform = globalThis; export const value = platform.crypto;`,
      `function pick(platform = globalThis) { return platform.crypto; } export const value = pick;`,
    ]) {
      const result = analyze([
        {
          fileName: 'crypto.ts',
          source: `
            import { route } from '@kovojs/server';
            ${source}
            export const page = route('/crypto', { render() { return value; } });
          `,
        },
      ]);
      expect(result.diagnostics).not.toEqual([]);
      expect(result.facts).toContainEqual(
        expect.objectContaining({ capability: 'crypto-acquisition', kind: 'closed' }),
      );
    }
  });

  it('does not turn type-only Node crypto imports into runtime authority', () => {
    const result = analyze([
      {
        fileName: 'types.ts',
        source: `
          import { route } from '@kovojs/server';
          import type { KeyObject } from 'node:crypto';
          export const page = route('/types', { render() { return null; } });
        `,
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });
});
