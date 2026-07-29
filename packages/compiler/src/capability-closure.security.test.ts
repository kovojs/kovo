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
import { scanCapabilityClosureModules } from './scan/capability-closure.js';

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
          : canonicalFrameworkImplementationDigest(frameworkIdentityVariant[2][0])));
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
    const generatedEntries = generated.dependencyManifest.dependencies.flatMap(
      (dependency) => dependency.entries,
    );
    expect(
      generatedEntries.find((entry) => entry.specifier === '@kovojs/server/internal/wire'),
    ).toEqual(
      expect.objectContaining({
        importers: ['app.ts'],
        imports: expect.arrayContaining([
          expect.objectContaining({
            capabilities: ['crypto-acquisition'],
            disposition: 'framework-door',
            name: '<module>',
          }),
          expect.objectContaining({
            disposition: 'authority-free',
            name: 'assignDerivedQueryKey',
          }),
        ]),
      }),
    );
    expect(
      generatedEntries.find((entry) => entry.specifier === '@kovojs/server/internal/csrf'),
    ).toEqual(
      expect.objectContaining({
        imports: expect.arrayContaining([
          expect.objectContaining({
            capabilities: ['crypto-acquisition'],
            disposition: 'framework-door',
            name: 'renderGeneratedMutationFormFields',
          }),
        ]),
      }),
    );
    expect(generated.facts).toContainEqual(
      expect.objectContaining({ capability: 'crypto-acquisition', kind: 'door' }),
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

  // @kovo-security-classifier-corpus C13 declassification-capability-closure
  it('closes declassification policy construction and reveal doors from request-reachable modules', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { DeclassifyPolicy, trustedReveal } from '@kovojs/core/security';
          import { route } from '@kovojs/server';
          export const page = route('/closed-declassification', { render() {
            return [DeclassifyPolicy, trustedReveal];
          } });
        `,
      },
    ]);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics.every((diagnostic) => diagnostic.code === 'KV448')).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'declassification policy and reveal doors are unavailable',
    );
    expect(
      result.facts.filter(
        (fact) => fact.kind === 'closed' && fact.capability === 'declassification',
      ),
    ).toHaveLength(1);
  });

  // @kovo-security-classifier-corpus C13 declassification-capability-closure
  it('transitively closes a declassification policy imported through a reachable helper', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { publicProjectionPolicy } from './projection.js';
          export const page = route('/transitive-declassification', {
            render() { return publicProjectionPolicy; },
          });
        `,
      },
      {
        fileName: 'projection.ts',
        source: `
          import { DeclassifyPolicy } from '@kovojs/core/security';
          export const publicProjectionPolicy = DeclassifyPolicy.forTrustedReveal({
            ownerScope: 'application',
          });
        `,
      },
    ]);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'KV448', fileName: 'projection.ts' });
    expect(result.diagnostics[0]!.message).toContain('root=route:/transitive-declassification');
    expect(result.diagnostics[0]!.message).toContain('import:./projection.js@app.ts');
    expect(result.facts).toContainEqual(
      expect.objectContaining({ capability: 'declassification', kind: 'closed' }),
    );
  });

  it('does not invent an untrusted root for an unreachable declassification helper', () => {
    const result = analyze([
      {
        fileName: 'projection.ts',
        source: `
          import { DeclassifyPolicy } from '@kovojs/core/security';
          export const publicProjectionPolicy = DeclassifyPolicy.forTrustedReveal({
            ownerScope: 'application',
          });
        `,
      },
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.facts.some((fact) => fact.kind === 'root')).toBe(false);
  });

  it('closes every functional reveal door and namespace access from reachable code', () => {
    for (const source of [
      `
        import { revealSecret, revealUntrusted } from '@kovojs/core/security';
        import { route } from '@kovojs/server';
        export const page = route('/functional-declassification', {
          render() { return [revealSecret, revealUntrusted]; },
        });
      `,
      `
        import * as security from '@kovojs/core/security';
        import { route } from '@kovojs/server';
        export const page = route('/namespace-declassification', {
          render() { return security.trustedReveal; },
        });
      `,
    ]) {
      const result = analyze([{ fileName: 'app.ts', source }]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({ code: 'KV448', fileName: 'app.ts' });
      expect(result.facts).toContainEqual(
        expect.objectContaining({ capability: 'declassification', kind: 'closed' }),
      );
    }
  });

  it('closes a reveal door carried through a reachable re-export', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { reveal } from './projection.js';
          import { route } from '@kovojs/server';
          export const page = route('/reexported-declassification', {
            render() { return reveal; },
          });
        `,
      },
      {
        fileName: 'projection.ts',
        source: `export { revealSecret as reveal } from '@kovojs/core/security';`,
      },
    ]);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'KV448', fileName: 'projection.ts' });
    expect(result.diagnostics[0]!.message).toContain('import:./projection.js@app.ts');
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

  // @kovo-security-certifies C13 dependency-import-equals-closure
  it('closes runtime TypeScript import-equals authority and follows its local module edge', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import fs = require('node:fs');
          import helper = require('./helper.js');
          export const page = route('/import-equals', {
            render() { return fs.readFileSync('/etc/hosts', 'utf8') + helper.read(); },
          });
        `,
      },
      {
        fileName: 'helper.ts',
        source: `export function read() { return process.env.SECRET; }`,
      },
    ]);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448', 'KV448']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'require:./helper.js@app.ts',
    );
    expect(
      result.facts
        .filter((fact) => fact.kind === 'closed')
        .map((fact) => fact.capability)
        .sort(),
    ).toEqual(['filesystem', 'process']);
  });

  it('keeps type-only import-equals inert while closing exported and entity-name aliases', () => {
    const typeOnly = analyze([
      {
        fileName: 'types.ts',
        source: `
          import { route } from '@kovojs/server';
          import type fs = require('node:fs');
          type Stat = ReturnType<typeof fs.statSync>;
          export const page = route('/types', { render() { return null; } });
          export type { Stat };
        `,
      },
    ]);
    expect(typeOnly.diagnostics).toEqual([]);

    const exported = analyze([
      {
        fileName: 'bridge.ts',
        source: `
          import * as server from '@kovojs/server';
          export import route = server.route;
          export import fs = require('node:fs');
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { fs, route } from './bridge.js';
          export const page = route('/exported-import-equals', {
            render() { return fs.readFileSync('/etc/hosts', 'utf8'); },
          });
        `,
      },
    ]);
    expect(exported.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: '/exported-import-equals', rootKind: 'route' }),
    );
    expect(exported.facts).toContainEqual(
      expect.objectContaining({ capability: 'filesystem', kind: 'closed' }),
    );
    expect(exported.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448']);
  });

  // @kovo-security-certifies C13 dependency-import-equals-namespace-reexport-closure
  it('retains namespace identity when an external import-equals is re-exported', () => {
    const result = analyze([
      {
        fileName: 'bridge.ts',
        source: `export import server = require('@kovojs/server');`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { server } from './bridge.js';
          import fs = require('node:fs');
          export const page = server.route('/namespace-import-equals', {
            render() { return fs.readFileSync('/etc/hosts', 'utf8'); },
          });
        `,
      },
    ]);

    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: 'root',
        name: '/namespace-import-equals',
        rootKind: 'route',
      }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ capability: 'filesystem', kind: 'closed' }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448']);
  });

  it('projects re-exported local namespaces and qualified aliases to their exact members', () => {
    const localNamespace = analyze([
      {
        fileName: 'helper.ts',
        source: `
          export { route } from '@kovojs/server';
          export function read() { return process.env.SECRET; }
        `,
      },
      {
        fileName: 'bridge.ts',
        source: `export import helper = require('./helper.js');`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { helper } from './bridge.js';
          export const page = helper.route('/local-namespace', {
            render() { return helper.read(); },
          });
        `,
      },
    ]);
    expect(localNamespace.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: '/local-namespace', rootKind: 'route' }),
    );
    expect(localNamespace.facts).toContainEqual(
      expect.objectContaining({ capability: 'process', kind: 'closed' }),
    );

    const qualified = analyze([
      {
        fileName: 'bridge.ts',
        source: `export import server = require('@kovojs/server');`,
      },
      {
        fileName: 'app.ts',
        source: `
          import * as bridge from './bridge.js';
          import route = bridge.server.route;
          export const qualified = route('/qualified-namespace', { render() { return null; } });
          export const computed = bridge.server['route']('/computed-namespace', {
            render() { return null; },
          });
        `,
      },
    ]);
    expect(
      qualified.facts
        .filter((fact) => fact.kind === 'root')
        .map((fact) => fact.name)
        .sort(),
    ).toEqual(['/computed-namespace', '/qualified-namespace']);
  });

  it('projects ESM namespace re-exports to exact external and local members', () => {
    const result = analyze([
      {
        fileName: 'helper.ts',
        source: `export function read() { return process.env.SECRET; }`,
      },
      {
        fileName: 'bridge.ts',
        source: `
          export * as server from '@kovojs/server';
          export * as helper from './helper.js';
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { helper, server } from './bridge.js';
          export const page = server.route('/esm-namespace-reexport', {
            render() { return helper.read(); },
          });
        `,
      },
    ]);

    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: '/esm-namespace-reexport', rootKind: 'route' }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ capability: 'process', kind: 'closed' }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448']);
  });

  // @kovo-security-certifies C13 dependency-lexical-binding-provenance-closure
  it('keeps framework roots bound to their exact lexical identities across nested shadows', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { handler } from '@kovojs/browser';
          import { createApp, route } from '@kovojs/server';
          function localFactory() { return null; }
          function defaultShadows(
            route = localFactory,
            createApp = localFactory,
            handler = localFactory,
          ) {
            route('/default-parameter-not-root');
            createApp({});
            handler(() => {});
          }
          {
            const route = localFactory;
            route('/block-not-root');
          }
          function nestedFunction() {
            const createApp = localFactory;
            createApp({});
          }
          const immutableRoute = route;
          export const page = immutableRoute('/immutable-alias', { render() { return null; } });
          export const app = createApp({});
          export const browser = handler(() => {});
          void defaultShadows;
          void nestedFunction;
        `,
      },
    ]);

    expect(
      result.facts
        .filter((fact) => fact.kind === 'root')
        .map((fact) => `${fact.rootKind}:${fact.name}`)
        .sort(),
    ).toEqual(['application:app', 'route:/immutable-alias', 'serialized-browser-handler:browser']);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps ordinary calls in JSX attributes and children bound to exact lexical provenance', () => {
    const result = analyze([
      {
        fileName: 'queries.ts',
        source: `
          import { query } from '@kovojs/server';
          export const contactsQuery = query({ run() { return { items: [] }; } });
        `,
      },
      {
        fileName: 'mutations.ts',
        source: `
          import { mutation } from '@kovojs/server';
          export const addContact = mutation({ run() { return null; } });
        `,
      },
      {
        fileName: 'contacts.tsx',
        source: `
          import { component } from '@kovojs/core';
          import { mutationFormAttributes } from '@kovojs/server';
          import { addContact } from './mutations.js';
          import { contactsQuery } from './queries.js';

          function submittedFieldValue(value) { return typeof value === 'string' ? value : ''; }
          function renderContactCard(contact) { return contact.name; }
          const Badge = { definition: { render(options) { return options.children; } } };

          export const ContactsRegion = component({
            mutations: { addContact },
            queries: { contacts: contactsQuery },
            render: ({ contacts }, _state, slots = { submitted: {} }) => {
              const items = contacts.items;
              const submitted = submittedFieldValue(slots.submitted.name);
              return <section data-submitted={submittedFieldValue(submitted)}>
                {Badge.definition.render({ children: items.length })}
                <form {...mutationFormAttributes(addContact)}>
                  {items.map((contact) => <span>{renderContactCard(contact)}</span>)}
                </form>
              </section>;
            },
          });
        `,
      },
    ]);

    expect(
      result.facts.filter(
        (fact) =>
          fact.kind === 'root' &&
          fact.module === 'contacts.tsx' &&
          (fact.rootKind === 'mutation' || fact.rootKind === 'query'),
      ),
    ).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not charge exact intrinsic JSX names as opaque component invocations', () => {
    const intrinsicTags = Array.from({ length: 64 }, (_, index) =>
      index % 2 === 0
        ? `<div data-index={${index}}>row ${index}</div>`
        : `<X-element data-index={${index}}>row ${index}</X-element>`,
    ).join('\n');
    const files = [
      {
        fileName: 'dense-view.tsx',
        source: `
          import { route } from '@kovojs/server';

          function renderIntrinsicGrid() {
            return <section>${intrinsicTags}</section>;
          }

          export const page = route('/dense-intrinsic-grid', {
            render: renderIntrinsicGrid,
          });
        `,
      },
    ];

    const scanned = scanCapabilityClosureModules(files)[0]!;
    expect(scanned.lexicalProvenanceBudgetExhausted).toBeUndefined();

    const result = analyze(files);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: 'root',
        name: '/dense-intrinsic-grid',
        rootKind: 'route',
      }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not charge compiler-owned static style records as opaque property effects', () => {
    const styleDefinitions = Array.from(
      { length: 40 },
      (_, index) => `s${index}: { color: 'red' },`,
    ).join('\n');
    const styleReads = Array.from(
      { length: 40 },
      (_, index) => `<div style={styles.s${index}}>row ${index}</div>`,
    ).join('\n');
    const files = [
      {
        fileName: 'styled-view.tsx',
        source: `
          import { route } from '@kovojs/server';
          import * as style from '@kovojs/style';

          const styles = style.create({ ${styleDefinitions} });
          export const page = route('/styled-grid', {
            render() {
              return <section>${styleReads}</section>;
            },
          });
        `,
      },
    ];

    const scanned = scanCapabilityClosureModules(files)[0]!;
    expect(scanned.lexicalProvenanceBudgetExhausted).toBeUndefined();

    const result = analyze(files);
    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: '/styled-grid', rootKind: 'route' }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('models frozen schema chains and component declarations without widening framework roots', () => {
    const result = analyze([
      {
        fileName: 'app.tsx',
        source: `
          import { component } from '@kovojs/core';
          import {
            createApp,
            createMemoryStorage,
            createMemoryVersionedClientModuleRegistry,
            domain,
            mutation,
            publicScopedKey,
            query,
            route,
            s,
          } from '@kovojs/server';

          const records = domain('records');
          const recordsQuery = query('records', {
            access: { kind: 'public', reason: 'test fixture' },
            load() { return []; },
            reads: [records],
          });
          const save = mutation({
            csrf: false,
            csrfJustification: 'non-browser test fixture',
            input: s.object({ id: s.string().allowControlChars() }),
            handler() { return { ok: true }; },
          });
          const clientModules = createMemoryVersionedClientModuleRegistry();
          clientModules.put({
            path: '/c/page.js',
            source: 'export const page = true;',
          });
          const storage = createMemoryStorage();
          await storage.put(publicScopedKey('receipts/one.txt'), 'one');
          const Page = component({ render() { return <main />; } });
          export default createApp({
            clientModules,
            mutations: [save],
            queries: [recordsQuery],
            routes: [route('/schema-component', { page: () => <Page /> })],
          });
        `,
      },
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.facts.filter((fact) => fact.kind === 'root').map((fact) => fact.name)).toEqual(
      expect.arrayContaining(['createApp', 'records', 'save', '/schema-component']),
    );
  });

  it('keeps unreviewed memory-storage receiver methods fail closed', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { createMemoryStorage, route } from '@kovojs/server';
          const storage = createMemoryStorage();
          storage.acquireAuthority();
          export const page = route('/storage-escape', { page() { return null; } });
        `,
      },
    ]);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV448');
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'mutable or ambiguous lexical provenance',
    );
  });

  it('keeps non-intrinsic identifier spellings on the component invocation boundary', () => {
    const files = [
      ['underscore.tsx', '_Child'],
      ['dollar.tsx', '$Child'],
      ['non-ascii.tsx', 'éChild'],
      ['cjk.tsx', '中Child'],
    ].map(([fileName, componentName]) => ({
      fileName: fileName!,
      source: `
        import { route as Route } from '@kovojs/server';
        function Plain() { return null; }
        let ${componentName} = Plain;
        if (componentChoice) ${componentName} = Route;
        export const view = <${componentName} />;
      `,
    }));

    const result = analyze(files);
    expect(
      result.facts.filter((fact) => fact.kind === 'root' && fact.name === 'route'),
    ).toHaveLength(4);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV448')).toHaveLength(4);
  });

  it('keeps more than 32 opaque JSX component invocations globally fail closed', () => {
    const opaqueComponents = Array.from({ length: 40 }, (_, index) => `<Opaque${index} />`).join(
      '\n',
    );
    const files = [
      {
        fileName: 'opaque-components.tsx',
        source: `
          import { route } from '@kovojs/server';

          export const page = route('/opaque-component-budget', {
            render() {
              return <section>${opaqueComponents}</section>;
            },
          });
        `,
      },
    ];

    const scanned = scanCapabilityClosureModules(files)[0]!;
    expect(scanned.lexicalProvenanceBudgetExhausted).toBe(true);

    const result = analyze(files);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: 'closed',
        name: '/opaque-component-budget',
        rootKind: 'route',
      }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV448');
  });

  it('keeps more than 32 genuine opaque effects globally fail closed', () => {
    const opaqueReads = Array.from({ length: 40 }, (_, index) => `value.member${index};`).join(
      '\n',
    );
    const files = [
      {
        fileName: 'opaque-effects.ts',
        source: `
          import { route } from '@kovojs/server';

          function inspectOpaqueValue(value) {
            ${opaqueReads}
          }

          export const page = route('/opaque-effect-budget', {
            render() { return null; },
          });
          void inspectOpaqueValue;
        `,
      },
    ];

    const scanned = scanCapabilityClosureModules(files)[0]!;
    expect(scanned.lexicalProvenanceBudgetExhausted).toBe(true);

    const result = analyze(files);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: 'closed',
        name: '/opaque-effect-budget',
        rootKind: 'route',
      }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV448');
  });

  it('retains root assignments and spread effects nested in JSX', () => {
    const result = analyze([
      {
        fileName: 'app.tsx',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }

          let assignedFactory = localFactory;
          const assignment = <div>{assignedFactory = route}</div>;
          assignedFactory('/jsx-assignment-root', { render() { return null; } });

          let spreadFactory = localFactory;
          const spreadSource = {
            get install() { spreadFactory = route; return true; },
          };
          const spread = <div {...spreadSource} />;
          spreadFactory('/jsx-spread-root', { render() { return null; } });

          let tagFactory = localFactory;
          function LocalComponent() { return null; }
          const componentHolder = {
            get Installer() { tagFactory = route; return LocalComponent; },
          };
          const tag = <componentHolder.Installer />;
          tagFactory('/jsx-tag-getter-root', { render() { return null; } });

          let invokedFactory = localFactory;
          function Installer() { invokedFactory = route; return null; }
          const invoked = <Installer data-reset={(invokedFactory = localFactory)} />;
          invokedFactory('/jsx-component-invocation-root', { render() { return null; } });
          void assignment;
          void invoked;
          void spread;
          void tag;
        `,
      },
    ]);

    for (const name of [
      '/jsx-assignment-root',
      '/jsx-component-invocation-root',
      '/jsx-spread-root',
      '/jsx-tag-getter-root',
    ]) {
      expect(result.facts).toContainEqual(
        expect.objectContaining({ kind: 'root', name, rootKind: 'route' }),
      );
      expect(result.facts).toContainEqual(
        expect.objectContaining({
          kind: 'closed',
          name,
          reason: expect.stringContaining('mutable or ambiguous lexical provenance'),
          rootKind: 'route',
        }),
      );
    }
    expect(
      result.facts
        .filter((fact) => fact.kind === 'closed')
        .map((fact) => `${fact.rootKind}:${fact.name}`),
    ).toEqual([
      'route:/jsx-assignment-root',
      'route:/jsx-component-invocation-root',
      'route:/jsx-spread-root',
      'route:/jsx-tag-getter-root',
      'route:route',
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'KV448',
      'KV448',
      'KV448',
      'KV448',
      'KV448',
    ]);
  });

  it('recognizes var, catch, class, and destructured parameter bindings as local shadows', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }
          function varShadow() {
            route('/hoisted-var-not-root');
            if (globalThis.choice) {
              var route = localFactory;
            }
          }
          function destructuredParameter({ route } = { route: localFactory }) {
            route('/parameter-not-root');
          }
          try {
            throw { route: localFactory };
          } catch ({ route }) {
            route('/catch-not-root');
          }
          {
            class route {}
            route('/class-not-root');
          }
          export const page = route('/lexical-root', { render() { return null; } });
          void varShadow;
          void destructuredParameter;
        `,
      },
    ]);

    expect(result.facts.filter((fact) => fact.kind === 'root').map((fact) => fact.name)).toEqual([
      '/lexical-root',
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('resolves mutable aliases at each call position and closes every reaching root candidate', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }
          let make = route;
          export const before = make('/before-later-write', { render() { return null; } });
          make = localFactory;
          export const after = make('/after-later-write', { render() { return null; } });

          let direct;
          direct = route;
          export const directPage = direct('/direct-assignment', { render() { return null; } });

          let conditional = localFactory;
          if (globalThis.choice) conditional = route;
          export const conditionalPage = conditional('/conditional-assignment', {
            render() { return null; },
          });

          let branch;
          if (globalThis.choice) branch = route;
          else branch = localFactory;
          export const branchPage = branch('/branch-join', { render() { return null; } });
        `,
      },
    ]);

    const roots = result.facts
      .filter((fact) => fact.kind === 'root')
      .map((fact) => fact.name)
      .sort();
    expect(roots).toEqual([
      '/before-later-write',
      '/branch-join',
      '/conditional-assignment',
      '/direct-assignment',
    ]);
    expect(roots).not.toContain('/after-later-write');
    for (const name of roots) {
      expect(result.facts).toContainEqual(
        expect.objectContaining({
          kind: 'closed',
          name,
          reason: expect.stringContaining('mutable or ambiguous lexical provenance'),
          rootKind: 'route',
        }),
      );
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'KV448',
      'KV448',
      'KV448',
      'KV448',
    ]);
  });

  it('preserves immutable declaration destructuring and closes assignment destructuring', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import * as server from '@kovojs/server';
          const { route: declared } = server;
          let assigned;
          ({ route: assigned } = server);
          export const declaredPage = declared('/declared-destructuring', {
            render() { return null; },
          });
          export const assignedPage = assigned('/assigned-destructuring', {
            render() { return null; },
          });
        `,
      },
    ]);

    expect(
      result.facts
        .filter((fact) => fact.kind === 'root')
        .map((fact) => fact.name)
        .sort(),
    ).toEqual(['/assigned-destructuring', '/declared-destructuring']);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: 'closed',
        name: '/assigned-destructuring',
        reason: expect.stringContaining('mutable or ambiguous lexical provenance'),
        rootKind: 'route',
      }),
    );
    expect(result.facts).not.toContainEqual(
      expect.objectContaining({ kind: 'closed', name: '/declared-destructuring' }),
    );
  });

  it('retains callback-transfer closure when an unrelated nested callable shadows the wrapper', () => {
    const result = analyze([
      {
        fileName: 'wrapper.ts',
        source: `
          import { route } from '@kovojs/server';
          export function definePage(config) { return route('/callback-shadow', config); }
        `,
      },
      {
        fileName: 'caller.ts',
        source: `
          import { definePage } from './wrapper.js';
          function localFactory() { return null; }
          function nestedFunction() {
            const definePage = localFactory;
            definePage({ render() { return null; } });
          }
          export const page = definePage({ render() { return process.env.SECRET; } });
          void nestedFunction;
        `,
      },
    ]);

    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: '/callback-shadow', rootKind: 'route' }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ capability: 'process', kind: 'closed' }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448']);
  });

  it('retains captured root candidates written by later closures and invoked callbacks', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }
          function invoke(callback) { callback(); }

          let later = localFactory;
          export function renderLater() {
            return later('/captured-later-write', { render() { return null; } });
          }
          function installLater() { later = route; }

          let callbackFactory = localFactory;
          invoke(() => { callbackFactory = route; });
          export const callbackPage = callbackFactory('/callback-write', {
            render() { return null; },
          });
          void installLater;
        `,
      },
    ]);

    expect(
      result.facts
        .filter((fact) => fact.kind === 'root')
        .map((fact) => fact.name)
        .sort(),
    ).toEqual(['/callback-write', '/captured-later-write']);
    expect(
      result.facts
        .filter((fact) => fact.kind === 'closed')
        .map((fact) => fact.name)
        .sort(),
    ).toEqual(['/callback-write', '/captured-later-write']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448', 'KV448']);
  });

  it('retains an immutable root captured before its initializer is analyzed', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          const invoke = () => future('/forward-immutable-capture', {
            render() { return null; },
          });
          const future = route;
          invoke();
        `,
      },
    ]);

    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: 'root',
        name: '/forward-immutable-capture',
        rootKind: 'route',
      }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: 'closed',
        name: '/forward-immutable-capture',
        reason: expect.stringContaining('mutable or ambiguous lexical provenance'),
      }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448']);
  });

  it('keeps a function-valued const as a separated toNodeHandler root', () => {
    const result = analyze([
      {
        fileName: 'server.ts',
        source: `
          import '@kovojs/server/runtime-bootstrap';
          import { toNodeHandler } from '@kovojs/server';
          import { handler } from './handler.js';
          export const listener = toNodeHandler(handler);
        `,
      },
      {
        fileName: 'handler.ts',
        source: `
          import { readFileSync } from 'node:fs';
          export const handler = async () => new Response(readFileSync('/tmp/secret'));
        `,
      },
    ]);

    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', module: 'handler.ts', rootKind: 'endpoint' }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ capability: 'filesystem', kind: 'closed' }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448']);
  });

  it('joins loop, exception, switch, and logical writes while honoring definite finally writes', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }

          let loopFactory = localFactory;
          while (globalThis.choice) loopFactory = route;
          export const loopPage = loopFactory('/loop-join', { render() { return null; } });

          let tryFactory = localFactory;
          try { tryFactory = route; } catch { tryFactory = localFactory; }
          export const tryPage = tryFactory('/try-join', { render() { return null; } });

          let switchFactory = localFactory;
          switch (globalThis.choice) {
            case 'route': switchFactory = route; break;
            default: switchFactory = localFactory;
          }
          export const switchPage = switchFactory('/switch-join', {
            render() { return null; },
          });

          let logicalFactory = localFactory;
          logicalFactory ||= route;
          export const logicalPage = logicalFactory('/logical-join', {
            render() { return null; },
          });

          let finalFactory = route;
          try { void 0; } catch { finalFactory = route; }
          finally { finalFactory = localFactory; }
          export const finalPage = finalFactory('/finally-not-root', {
            render() { return null; },
          });
        `,
      },
    ]);

    const roots = result.facts
      .filter((fact) => fact.kind === 'root')
      .map((fact) => fact.name)
      .sort();
    expect(roots).toEqual(['/logical-join', '/loop-join', '/switch-join', '/try-join']);
    expect(roots).not.toContain('/finally-not-root');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'KV448',
      'KV448',
      'KV448',
      'KV448',
    ]);
  });

  it('joins exceptional catch entry and reaches a finite loop provenance fixpoint', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }

          let caughtFactory = localFactory;
          try {
            caughtFactory = route;
            throw new Error('transfer');
          } catch {
            caughtFactory('/caught-transfer', { render() { return null; } });
          }

          let first = localFactory;
          let second = localFactory;
          while (globalThis.choice) {
            first = second;
            second = route;
          }
          first('/loop-fixpoint', { render() { return null; } });
        `,
      },
    ]);

    expect(
      result.facts
        .filter((fact) => fact.kind === 'root')
        .map((fact) => fact.name)
        .sort(),
    ).toEqual(['/caught-transfer', '/loop-fixpoint']);
    expect(
      result.facts
        .filter((fact) => fact.kind === 'closed')
        .map((fact) => fact.name)
        .sort(),
    ).toEqual(['/caught-transfer', '/loop-fixpoint']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448', 'KV448']);
  });

  it('evaluates do bodies before conditions and repeats while and for condition effects', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }

          let doFactory = route;
          do {
            doFactory('/do-before-condition', { render() { return null; } });
          } while ((doFactory = localFactory, false));

          let whileFactory = localFactory;
          let whileSource = localFactory;
          while ((whileFactory = whileSource, globalThis.choice)) {
            whileSource = route;
          }
          whileFactory('/repeated-while-condition', { render() { return null; } });

          let forFactory = localFactory;
          let forSource = localFactory;
          for (; (forFactory = forSource, globalThis.choice);) {
            forSource = route;
          }
          forFactory('/repeated-for-condition', { render() { return null; } });
        `,
      },
    ]);

    expect(
      result.facts
        .filter((fact) => fact.kind === 'root')
        .map((fact) => fact.name)
        .sort(),
    ).toEqual(['/do-before-condition', '/repeated-for-condition', '/repeated-while-condition']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'KV448',
      'KV448',
      'KV448',
    ]);
  });

  it('widens every call and closes when the loop reanalysis budget is exhausted', () => {
    const aliases = Array.from({ length: 64 }, (_, index) => `let factory${index} = localFactory;`);
    const transfers = Array.from(
      { length: 63 },
      (_, index) => `factory${index} = factory${index + 1};`,
    );
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }
          ${aliases.join('\n')}
          while (globalThis.choice) {
            ${transfers.join('\n')}
            factory63 = route;
          }
          factory0('/budget-widening', { render() { return null; } });
        `,
      },
    ]);

    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: '/budget-widening', rootKind: 'route' }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: 'closed',
        name: '/budget-widening',
        reason: expect.stringContaining('mutable or ambiguous lexical provenance'),
      }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV448']);
  });

  it('retains writes performed by invoked named functions, nested calls, and methods', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }

          let namedFactory = localFactory;
          function installNamed() { namedFactory = route; }
          installNamed();
          namedFactory('/named-function-write', { render() { return null; } });

          let nestedFactory = localFactory;
          function installOuter() { installInner(); }
          function installInner() { nestedFactory = route; }
          installOuter();
          nestedFactory('/nested-function-write', { render() { return null; } });

          let methodFactory = localFactory;
          const installer = { install() { methodFactory = route; } };
          installer.install();
          methodFactory('/method-write', { render() { return null; } });
        `,
      },
    ]);

    expect(result.facts.filter((fact) => fact.kind === 'root').map((fact) => fact.name)).toEqual(
      expect.arrayContaining(['/method-write', '/named-function-write', '/nested-function-write']),
    );
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV448').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('enrolls conditional, comma, invocation-adapter, and computed callees', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }
          (globalThis.choice ? route : localFactory)('/conditional-callee', {
            render() { return null; },
          });
          (0, route)('/comma-callee', { render() { return null; } });
          route.call(null, '/call-adapter', { render() { return null; } });
          route.apply(null, ['/apply-adapter', { render() { return null; } }]);
          const holder = { route };
          holder[globalThis.key]('/computed-callee', { render() { return null; } });
        `,
      },
    ]);

    const rootNames = result.facts.filter((fact) => fact.kind === 'root').map((fact) => fact.name);
    expect(rootNames).toEqual(
      expect.arrayContaining(['/comma-callee', '/computed-callee', '/conditional-callee']),
    );
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV448').length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('widens unknown callees from the transitive relative root-supply closure', () => {
    const result = analyze([
      {
        fileName: 'bridge.ts',
        source: `
          import { route } from '@kovojs/server';
          export function get() { return route; }
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { get } from './bridge.js';
          get()('/indirect-root', { render() { return null; } });
        `,
      },
    ]);

    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: '/indirect-root', rootKind: 'route' }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'closed', name: '/indirect-root' }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV448');
  });

  it('tracks class-expression methods and class static blocks without losing shadows', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }
          const Example = class {
            method() {
              route('/class-expression-root', { render() { return null; } });
            }
            static {
              const route = localFactory;
              route('/class-expression-static-shadow');
            }
          };
          class Declared {
            static {
              route('/class-declaration-static-root', { render() { return null; } });
            }
          }
          void Example;
          void Declared;
        `,
      },
    ]);

    const roots = result.facts
      .filter((fact) => fact.kind === 'root')
      .map((fact) => fact.name)
      .sort();
    expect(roots).toEqual(['/class-declaration-static-root', '/class-expression-root']);
    expect(roots).not.toContain('/class-expression-static-shadow');
  });

  it('fails closed at the flat abstract-work and per-value candidate budgets', () => {
    const padding = Array.from({ length: 9_000 }, (_, index) => `const pad${index} = ${index};`);
    const alternatives = Array.from(
      { length: 40 },
      (_, index) => `function local${index}() {}\nif (choice${index}) factory = local${index};`,
    );
    const result = analyze([
      {
        fileName: 'candidate-cap.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() {}
          let factory = localFactory;
          ${alternatives.join('\n')}
          if (routeChoice) {} else factory = route;
          factory('/candidate-cap', { render() { return null; } });
        `,
      },
      {
        fileName: 'flat-work.ts',
        source: `
          import { route } from '@kovojs/server';
          ${padding.join('\n')}
          (0, route)('/flat-work-budget', { render() { return null; } });
        `,
      },
    ]);

    expect(result.facts.filter((fact) => fact.kind === 'root').map((fact) => fact.name)).toEqual(
      expect.arrayContaining(['/candidate-cap', '/flat-work-budget']),
    );
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV448').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('closes computed and reflective global authority acquisition', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          const key = 'crypto';
          const direct = globalThis[key];
          const g = globalThis;
          const alias = g[key];
          const reflected = Reflect.get(globalThis, key);
          const folded = globalThis['pro' + 'cess'];
          const { [key]: destructured } = globalThis;
          const { [key]: aliasDestructured } = g;
          function opaque(value) { return value; }
          const escaped = opaque(g);
          export const page = route('/computed-global', {
            render() {
              return [direct, alias, reflected, folded, destructured, aliasDestructured, escaped];
            },
          });
        `,
      },
    ]);

    for (const capability of [
      'crypto-acquisition',
      'database-driver',
      'declassification',
      'digest',
      'dynamic-loader',
      'filesystem',
      'network',
      'process',
      'vm',
      'worker',
    ]) {
      expect(result.facts).toContainEqual(
        expect.objectContaining({ capability, kind: 'closed', name: '/computed-global' }),
      );
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV448');
  });

  it('enrolls constructors, tagged templates, accessors, and implicit invocation effects', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { queue, route } from '@kovojs/server';
          import { mutate } from './mutator.js';
          function localFactory() { return null; }

          new route('/new-root', { render() { return null; } });
          new (globalThis.choice ? route : localFactory)('/conditional-new', {
            render() { return null; },
          });
          route\`/tagged-root\`;

          let constructedFactory = localFactory;
          function Installer() { constructedFactory = route; }
          new Installer();
          constructedFactory('/constructor-write', { render() { return null; } });

          let getterFactory = localFactory;
          const accessors = {
            get install() { getterFactory = route; return 0; },
            get factory() { return route; },
          };
          accessors.install;
          getterFactory('/getter-write', { render() { return null; } });
          accessors.factory('/getter-return', { render() { return null; } });

          let callbackFactory = localFactory;
          function invoke(callback) { callback(); }
          function installCallback() { callbackFactory = route; }
          invoke(installCallback);
          callbackFactory('/callback-substitution-fallback', { render() { return null; } });

          function functionLocalFallback() {
            let functionLocalFactory = localFactory;
            function installLocal() { functionLocalFactory = route; }
            opaqueCallback(installLocal);
            functionLocalFactory('/function-local-callback-fallback', {
              render() { return null; },
            });
          }
          functionLocalFallback();

          function functionLocalContainerFallback() {
            const callbackHolder = { factory: localFactory };
            function installHolder() { callbackHolder.factory = route; }
            opaqueCallback(installHolder);
            callbackHolder.factory('/function-local-callback-container', {
              render() { return null; },
            });
          }
          functionLocalContainerFallback();

          function supplier() { return route; }
          async function awaitFactory() {
            (await supplier())('/await-result-fallback', { render() { return null; } });
          }
          opaqueIdentity(route)('/opaque-result-fallback', { render() { return null; } });

          let frameworkCallbackFactory = localFactory;
          function installFrameworkCallback() { frameworkCallbackFactory = route; }
          queue(installFrameworkCallback);
          frameworkCallbackFactory('/unreviewed-framework-call-effects', {
            render() { return null; },
          });

          let coercionFactory = localFactory;
          const coercer = { valueOf() { coercionFactory = route; return 1; } };
          void +coercer;
          coercionFactory('/coercion-fallback', { render() { return null; } });

          let destructuredFactory = localFactory;
          const destructuredSource = {
            get value() { destructuredFactory = route; return 1; },
          };
          const { [globalThis.key]: ignored } = destructuredSource;
          destructuredFactory('/computed-destructuring-fallback', {
            render() { return null; },
          });

          let iterationFactory = localFactory;
          const iterable = {
            *[Symbol.iterator]() { iterationFactory = route; yield 1; },
          };
          [...iterable];
          iterationFactory('/iterator-fallback', { render() { return null; } });

          const holder = { factory: localFactory };
          mutate(holder);
          holder.factory('/relative-object-mutation', { render() { return null; } });

          const plain = { factory: localFactory };
          plain.factory('/plain-data-not-root');
        `,
      },
      {
        fileName: 'mutator.ts',
        source: `
          import { route } from '@kovojs/server';
          export function mutate(value) { value.factory = route; }
        `,
      },
    ]);

    const roots = result.facts.filter((fact) => fact.kind === 'root').map((fact) => fact.name);
    expect(roots).toEqual(
      expect.arrayContaining([
        '/callback-substitution-fallback',
        '/coercion-fallback',
        '/computed-destructuring-fallback',
        '/conditional-new',
        '/constructor-write',
        '/getter-return',
        '/getter-write',
        '/function-local-callback-fallback',
        '/function-local-callback-container',
        '/iterator-fallback',
        '/new-root',
        '/opaque-result-fallback',
        '/relative-object-mutation',
        '/tagged-root',
        '/unreviewed-framework-call-effects',
        '/await-result-fallback',
      ]),
    );
    expect(roots).not.toContain('/plain-data-not-root');
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV448').length,
    ).toBeGreaterThanOrEqual(6);
  });

  it('keeps ordinary relative data arguments out of opaque fluent root provenance', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { mutation } from '@kovojs/server';
          import { account } from './schema.js';
          export const update = mutation({
            handler(_input, request) {
              return request.db.update(account).set({ active: true });
            },
          });
        `,
      },
      {
        fileName: 'schema.ts',
        source: `export const account = { id: 'account' };`,
      },
    ]);

    expect(result.facts.filter((fact) => fact.kind === 'root').map((fact) => fact.name)).toEqual([
      'update',
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('fails closed for class accessors while keeping plain class data precise', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          function localFactory() { return null; }
          let installed = localFactory;
          class Accessors {
            static get install() { installed = route; return 0; }
            static get factory() { return route; }
            get instanceFactory() { return route; }
          }
          Accessors.install;
          installed('/class-getter-write', { render() { return null; } });
          Accessors.factory('/class-static-getter', { render() { return null; } });
          const instance = new Accessors();
          instance.instanceFactory('/class-instance-getter', { render() { return null; } });

          class Plain { static factory = localFactory; }
          Plain.factory('/plain-class-data-not-root');
        `,
      },
    ]);

    const roots = result.facts.filter((fact) => fact.kind === 'root').map((fact) => fact.name);
    expect(roots).toEqual(
      expect.arrayContaining([
        '/class-getter-write',
        '/class-instance-getter',
        '/class-static-getter',
      ]),
    );
    expect(roots).not.toContain('/plain-class-data-not-root');
  });

  it('enrolls decorator and JSX component invocation without treating ordinary components as roots', () => {
    const result = analyze([
      {
        fileName: 'decorator.ts',
        source: `
          import { route as Route } from '@kovojs/server';
          function Plain() { return null; }
          @Route
          class Decorated {}
          let MutableDecorator = Plain;
          if (decoratorChoice) MutableDecorator = Route;
          @MutableDecorator
          class MutableDecorated {}
        `,
      },
      {
        fileName: 'view.tsx',
        source: `
          import { route as Route } from '@kovojs/server';
          function Plain() { return null; }
          let MutableComponent = Plain;
          if (componentChoice) MutableComponent = Route;
          export const view = <><Route /><Plain /><MutableComponent /></>;
        `,
      },
      {
        fileName: 'unsupported-view.tsx',
        source: `
          import { route } from '@kovojs/server';
          export const view = <svg:Route />;
        `,
      },
    ]);

    const roots = result.facts.filter((fact) => fact.kind === 'root');
    expect(roots.filter((fact) => fact.name === 'route')).toHaveLength(4);
    expect(roots.some((fact) => fact.name === 'Plain')).toBe(false);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV448')).toHaveLength(2);
  });

  it('uses the catch block lexical scope for bindings without an outer declaration', () => {
    const result = analyze([
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          try { throw new Error('transfer'); }
          catch {
            const caughtFactory = route;
            caughtFactory('/catch-block-root', { render() { return null; } });
          }
        `,
      },
    ]);

    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: 'root', name: '/catch-block-root', rootKind: 'route' }),
    );
    expect(result.diagnostics).toEqual([]);
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
          exports: [
            { capabilities: [], disposition: 'pure', name: '<module>' },
            { capabilities: [], disposition: 'pure', name: 'parse' },
          ],
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
          exports: [
            { capabilities: [], disposition: 'pure', name: '<module>' },
            { capabilities: [], disposition: 'pure', name: 'parse' },
          ],
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
          imports: [
            { capabilities: [], disposition: 'pure', name: '<module>' },
            { capabilities: [], disposition: 'pure', name: 'parse' },
          ],
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

  it('rejects wholly request-closed framework tools without depending on their bytes', () => {
    const result = analyze(
      [
        {
          fileName: 'app.ts',
          source: `
            import { verifyCertificate } from '@kovojs/verify';
            import { route } from '@kovojs/server';
            export const page = route('/tool-import', { render() { return verifyCertificate; } });
          `,
        },
      ],
      {
        packages: [
          resolved('@kovojs/server'),
          resolved('@kovojs/verify', {
            implementationDigest: null,
          }),
        ],
      },
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'compiler-owned @kovojs/verify is unconditionally request-closed',
    );
    expect(result.diagnostics[0]!.message).not.toContain('implementation digest');
  });

  it('rejects the wholly request-closed CLI without depending on bundled certificate bytes', () => {
    const result = analyze(
      [
        {
          fileName: 'app.ts',
          source: `
            import { KOVO_DIAGNOSTIC_VERSION } from '@kovojs/cli';
            import { route } from '@kovojs/server';
            export const page = route('/tool-import', {
              render() { return KOVO_DIAGNOSTIC_VERSION; },
            });
          `,
        },
      ],
      {
        packages: [
          resolved('@kovojs/server'),
          resolved('@kovojs/cli', {
            implementationDigest: null,
          }),
        ],
      },
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'compiler-owned @kovojs/cli is unconditionally request-closed',
    );
    expect(result.diagnostics[0]!.message).not.toContain('implementation digest');
  });

  // @kovo-security-certifies C13 request-closed-package-identity-before-digest-omission
  it.each([
    ['@kovojs/cli', 'KOVO_DIAGNOSTIC_VERSION'],
    ['@kovojs/verify', 'verifyCertificate'],
  ] as const)(
    'requires reviewed installed identity before applying %s digest-free request closure',
    (packageName, importedName) => {
      const files = [
        {
          fileName: 'app.ts',
          source: `
            import { ${importedName} } from '${packageName}';
            import { route } from '@kovojs/server';
            export const page = route('/tool-identity', { render() { return ${importedName}; } });
          `,
        },
      ];
      const reviewed = resolved(packageName, { implementationDigest: null });
      const cases: readonly [ResolvedCapabilityPackage | undefined, string][] = [
        [undefined, 'could not be resolved to one exact installed manifest'],
        [{ ...reviewed, packageName: 'shadow-package' }, 'package resolution'],
        [{ ...reviewed, packageVersion: '999.0.0-unreviewed' }, 'posture covers'],
        [
          { ...reviewed, manifestFingerprint: 'sha256:unreviewed-manifest' },
          'does not cover installed manifest fingerprint',
        ],
      ];

      for (const [fact, expectedReason] of cases) {
        const result = analyze(files, {
          packages: [resolved('@kovojs/server'), ...(fact === undefined ? [] : [fact])],
        });
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]!.message).toContain(expectedReason);
        expect(result.diagnostics[0]!.message).not.toContain(
          `${packageName} is unconditionally request-closed`,
        );
      }
    },
  );

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

    const wildcardOnly = analyze(files, {
      packages,
      packageSummaries: [
        {
          ...summary,
          entries: [
            {
              ...summary.entries[0]!,
              exports: [{ capabilities: [], disposition: 'pure', name: '*' }],
            },
          ],
        },
      ],
    });
    expect(wildcardOnly.diagnostics[0]!.message).toContain('does not classify export <module>');

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
            { capabilities: [], disposition: 'pure', name: '<module>' },
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

  it('does not let a runtime import-equals precede custom-adapter bootstrap', () => {
    const result = analyze([
      {
        fileName: 'server.ts',
        source: `
          import fs = require('node:fs');
          import '@kovojs/server/runtime-bootstrap';
          import { createServer } from 'node:http';
          import { toNodeHandler } from '@kovojs/server';
          import { handler } from './handler.js';
          fs.statSync('.');
          createServer(toNodeHandler(handler)).listen(3000);
        `,
      },
      {
        fileName: 'handler.ts',
        source: `export const handler = async () => new Response('ok');`,
      },
    ]);

    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
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

  // @kovo-security-certifies C13 zero-public-analyzer-name-closure
  it('closes the exact zero-public compiler package before missing or mismatched identity facts', () => {
    const packageFact: ResolvedCapabilityPackage = {
      conditions: [],
      exportStatus: 'unresolved',
      implementationDigest: `kovo-source-tree-sha256:${'0'.repeat(64)}`,
      manifestFingerprint: 'sha256:unreviewed-compiler-manifest',
      packageName: '@kovojs/compiler',
      packageVersion: '999.0.0-unreviewed',
      specifier: '@kovojs/compiler/internal',
    };
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
    const files = [
      {
        fileName: 'app.ts',
        source: `
          import { route } from '@kovojs/server';
          import { compile } from '@kovojs/compiler/internal';
          export const page = route('/compiler', { render() { return compile; } });
        `,
      },
    ];
    for (const compilerFacts of [[], [packageFact]] as const) {
      const result = analyze(files, {
        packages: [resolved('@kovojs/server'), ...compilerFacts],
        packageSummaries: [summary],
      });
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.code).toBe('KV448');
      expect(result.diagnostics[0]!.message).toContain(
        'compiler-owned @kovojs/compiler is unconditionally request-closed because it exposes no app-public runtime subpaths',
      );
      expect(result.diagnostics[0]!.message).not.toContain('implementation digest');
      expect(result.diagnostics[0]!.message).not.toContain('manifest fingerprint');
    }

    const nearName = analyze(
      [
        {
          fileName: 'app.ts',
          source: `
            import { route } from '@kovojs/server';
            import { compile } from '@kovojs/compiler-evil/internal';
            export const page = route('/compiler-near-name', { render() { return compile; } });
          `,
        },
      ],
      {
        packages: [
          resolved('@kovojs/server'),
          {
            ...packageFact,
            packageName: '@kovojs/compiler-evil',
            specifier: '@kovojs/compiler-evil/internal',
          },
        ],
      },
    );
    expect(nearName.diagnostics[0]!.message).not.toContain(
      '@kovojs/compiler-evil is unconditionally request-closed',
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
