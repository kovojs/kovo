import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  formatPublishedModuleIdentityReport,
  probePublishedModuleIdentity,
} from './certificate-module-identity-probe.mjs';

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('published module identity kill gate', () => {
  it('recovers exact relative, re-export, dynamic-literal, and cross-package ESM edges', () => {
    const fixture = createFixture({
      '@kovojs/better-auth': {
        exports: { '.': './dist/index.mjs' },
        files: {
          'dist/chunk.mjs': 'export const chunk = true;',
          'dist/index.mjs': [
            "import '@kovojs/server';",
            "export { shared } from './shared.mjs';",
            "export const load = () => import('./chunk.mjs');",
          ].join('\n'),
          'dist/shared.mjs': 'export const shared = true;',
        },
      },
      '@kovojs/core': {
        exports: { './internal/security': './dist/internal/security.mjs' },
        files: {
          'dist/internal/security.mjs': 'export const security = true;',
        },
      },
      '@kovojs/server': {
        exports: { '.': { default: './dist/index.mjs' } },
        files: {
          'dist/index.mjs': [
            "import { createRequire } from 'node:module';",
            "import { security } from '@kovojs/core/internal/security';",
            "import './shared.mjs';",
            "export { shared } from './shared.mjs';",
          ].join('\n'),
          'dist/shared.mjs': 'export const shared = true;',
        },
      },
    });

    const report = probePublishedModuleIdentity(fixture);

    expect(report.recoveredModuleCount).toBe(5);
    expect(report.resolvedEdges).toEqual([
      ['@kovojs/better-auth/dist/index.mjs', '@kovojs/better-auth/dist/chunk.mjs'],
      ['@kovojs/better-auth/dist/index.mjs', '@kovojs/better-auth/dist/shared.mjs'],
      ['@kovojs/better-auth/dist/index.mjs', '@kovojs/server/dist/index.mjs'],
      ['@kovojs/server/dist/index.mjs', '@kovojs/core/dist/internal/security.mjs'],
      ['@kovojs/server/dist/index.mjs', '@kovojs/server/dist/shared.mjs'],
    ]);
    expect(report.externalImports).toEqual([['@kovojs/server/dist/index.mjs', 'node:module']]);
    expect(report.externalImportBindings).toEqual([
      {
        importedNames: ['createRequire'],
        module: '@kovojs/server/dist/index.mjs',
        specifier: 'node:module',
      },
    ]);
    expect(report.opaqueModules).toEqual([
      {
        module: '@kovojs/server/dist/index.mjs',
        reason:
          'imports Node module-loader authority; runtime-selected dependency loads require lexical authority coverage',
      },
    ]);
    expect(report.resolutionPackageCount).toBe(3);
    expect(formatPublishedModuleIdentityReport(report)).toContain(
      'PASS (all discovered in-scope ESM edges resolved)',
    );
  });

  it('rejects any missing or extra dist module outside the exact packed file list', () => {
    const missing = createFixture({
      '@kovojs/better-auth': emptyPackage(),
      '@kovojs/server': {
        exports: { '.': './dist/index.mjs' },
        files: { 'dist/index.mjs': 'export {};' },
        snapshotFiles: ['dist/index.mjs', 'dist/missing.mjs', 'package.json'],
      },
    });
    expect(() => probePublishedModuleIdentity(missing)).toThrow(
      /packed module is missing.*missing\.mjs/su,
    );

    const extra = createFixture({
      '@kovojs/better-auth': emptyPackage(),
      '@kovojs/server': {
        exports: { '.': './dist/index.mjs' },
        files: {
          'dist/extra.mjs': 'export {};',
          'dist/index.mjs': 'export {};',
        },
        snapshotFiles: ['dist/index.mjs', 'package.json'],
      },
    });
    expect(() => probePublishedModuleIdentity(extra)).toThrow(
      /absent from the exact packed file list.*extra\.mjs/su,
    );
  });

  it('fails closed on malformed, computed, CommonJS, and unresolved module edges', () => {
    const fixture = createFixture({
      '@kovojs/better-auth': emptyPackage(),
      '@kovojs/server': {
        exports: { '.': './dist/index.mjs' },
        files: {
          'dist/index.mjs': [
            "import './missing.mjs';",
            'import(name);',
            "require('hidden');",
            'export {',
          ].join('\n'),
        },
      },
    });

    let message = '';
    try {
      probePublishedModuleIdentity(fixture);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('parse failure');
    expect(message).toContain('computed dynamic import');
    expect(message).toContain('CommonJS require');
    expect(message).toContain('does not resolve in the exact packed file list');
  });

  it('rejects unresolved first-party subpaths and non-canonical specifiers', () => {
    const fixture = createFixture({
      '@kovojs/better-auth': {
        exports: { '.': './dist/index.mjs' },
        files: {
          'dist/index.mjs': [
            "import '@kovojs/server/not-exported';",
            "import '@kovojs/core/definitely-not-exported';",
            "import './chunk.mjs?mutable';",
          ].join('\n'),
        },
      },
      '@kovojs/server': emptyPackage(),
    });

    let message = '';
    try {
      probePublishedModuleIdentity(fixture);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('names no packed Kovo package');
    expect(message).toContain('no exact published dist target');
    expect(message).toContain('non-canonical module specifier');
  });

  it('rejects duplicate, non-canonical, and symlink module identities', () => {
    const fixture = createFixture({
      '@kovojs/better-auth': emptyPackage(),
      '@kovojs/server': {
        exports: { '.': './dist/index.mjs' },
        files: { 'dist/index.mjs': 'export {};' },
        snapshotFiles: [
          'dist/index.mjs',
          'dist/index.mjs',
          'dist/../dist/index.mjs',
          'package.json',
        ],
      },
    });
    expect(() => probePublishedModuleIdentity(fixture)).toThrow(
      /duplicate packed path[\s\S]*not canonical/u,
    );

    const linked = createFixture({
      '@kovojs/better-auth': emptyPackage(),
      '@kovojs/server': {
        exports: { '.': './dist/index.mjs' },
        files: {},
        snapshotFiles: ['dist/index.mjs', 'package.json'],
      },
    });
    const server = linked.packageConfigs.find((entry) => entry.name === '@kovojs/server');
    const outside = path.join(server.rootDir, 'outside-dist');
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'index.mjs'), 'export {};', 'utf8');
    symlinkSync(outside, path.join(server.rootDir, 'dist'), 'dir');
    expect(() => probePublishedModuleIdentity(linked)).toThrow(
      /ancestry must not contain a symlink/u,
    );
  });

  it('reports namespace, default, dynamic, and bare Node module-loader acquisitions as opaque', () => {
    const fixture = createFixture({
      '@kovojs/better-auth': emptyPackage(),
      '@kovojs/server': {
        exports: { '.': './dist/index.mjs' },
        files: {
          'dist/bare.mjs': "import 'module';",
          'dist/default.mjs': "import Module from 'node:module';",
          'dist/dynamic.mjs': "export const loader = import('node:module');",
          'dist/index.mjs': "import * as Module from 'node:module';",
        },
      },
    });

    const report = probePublishedModuleIdentity(fixture);
    expect(report.opaqueModules.map((entry) => entry.module)).toEqual([
      '@kovojs/server/dist/bare.mjs',
      '@kovojs/server/dist/default.mjs',
      '@kovojs/server/dist/dynamic.mjs',
      '@kovojs/server/dist/index.mjs',
    ]);
  });

  it('preserves exact crypto import bindings for capability classification', () => {
    const fixture = createFixture({
      '@kovojs/better-auth': emptyPackage(),
      '@kovojs/server': {
        exports: { '.': './dist/index.mjs' },
        files: {
          'dist/acquire.mjs': "import * as crypto from 'node:crypto';",
          'dist/digest.mjs': "import { createHash as hashBytes } from 'node:crypto';",
          'dist/index.mjs': 'export {};',
        },
      },
    });

    expect(probePublishedModuleIdentity(fixture).externalImportBindings).toEqual([
      {
        importedNames: ['*'],
        module: '@kovojs/server/dist/acquire.mjs',
        specifier: 'node:crypto',
      },
      {
        importedNames: ['createHash'],
        module: '@kovojs/server/dist/digest.mjs',
        specifier: 'node:crypto',
      },
    ]);
  });

  it('does not mistake generated source text inside template literals for live imports', () => {
    const fixture = createFixture({
      '@kovojs/better-auth': emptyPackage(),
      '@kovojs/server': {
        exports: { '.': './dist/index.mjs' },
        files: {
          'dist/index.mjs': "export const generated = `const x = import('./generated-only.mjs')`;",
        },
      },
    });

    expect(probePublishedModuleIdentity(fixture).resolvedEdges).toEqual([]);
  });
});

function emptyPackage() {
  return {
    exports: { '.': './dist/index.mjs' },
    files: { 'dist/index.mjs': 'export {};' },
  };
}

function createFixture(packageDefinitions) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-module-identity-'));
  temporaryRoots.push(root);
  const snapshot = { packages: {} };
  const packageConfigs = [];
  for (const [name, definition] of Object.entries(packageDefinitions)) {
    const directory = name.split('/').at(-1);
    const rootDir = path.join(root, directory);
    mkdirSync(rootDir, { recursive: true });
    for (const [relativePath, source] of Object.entries(definition.files)) {
      const target = path.join(rootDir, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source, 'utf8');
    }
    snapshot.packages[name] = definition.snapshotFiles ?? [
      ...Object.keys(definition.files).sort(),
      'package.json',
    ];
    packageConfigs.push({
      name,
      publishExports: definition.exports,
      rootDir,
    });
  }
  return {
    packageConfigs,
    packageNames: ['@kovojs/better-auth', '@kovojs/server'],
    snapshot,
  };
}
