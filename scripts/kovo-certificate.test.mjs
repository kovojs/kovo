import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  generateKovoCertificate,
  stableKovoCertificateJson,
  validateCertificateDoorPosture,
  validateCertificateLexicalAuthorityLedger,
} from './kovo-certificate.mjs';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('kovo.certificate/v1 search-side generator', () => {
  it('closes whole package trees, computes sha512 and a least post-fixpoint, and emits stable roots and doors', () => {
    const fixture = createFixture({
      '@kovojs/better-auth': {
        exports: { '.': './dist/index.mjs' },
        files: {
          'dist/index.mjs': "import 'third-party-auth'; export const auth = true;",
        },
      },
      '@kovojs/core': {
        exports: { '.': './dist/index.mjs' },
        files: { 'dist/index.mjs': "import 'node:fs'; export const core = true;" },
      },
      '@kovojs/server': {
        exports: { '.': { default: './dist/index.mjs' } },
        files: {
          'dist/index.mjs': "export { core } from '@kovojs/core';",
          'dist/unused.mjs': 'export const unused = true;',
        },
      },
    });
    const posture = {
      packages: [
        {
          packageName: '@kovojs/server',
          postureGroups: [
            {
              capabilities: [],
              disposition: 'authority-free',
              id: 'server-root',
              members: { '.': ['createApp'] },
              rootKind: 'application',
            },
            {
              capabilities: ['filesystem'],
              disposition: 'framework-door',
              id: 'server-filesystem-door',
              members: { '.': ['rootedFiles'] },
              rootKind: 'none',
            },
          ],
        },
      ],
    };

    const first = generateKovoCertificate({
      ...fixture,
      internalDoorPosture: emptyInternalDoorPosture(),
      posture,
      seedPackageNames: ['@kovojs/better-auth', '@kovojs/server'],
    });
    const second = generateKovoCertificate({
      ...fixture,
      internalDoorPosture: emptyInternalDoorPosture(),
      posture,
      seedPackageNames: ['@kovojs/better-auth', '@kovojs/server'],
    });

    expect(stableKovoCertificateJson(first)).toBe(stableKovoCertificateJson(second));
    expect(first).toMatchObject({
      domain: [
        'database-driver',
        'dynamic-loader',
        'filesystem',
        'network',
        'process',
        'vm',
        'worker',
      ],
      doors: [
        {
          escapeId: 'filesystem',
          module: '@kovojs/server/dist/index.mjs',
        },
      ],
      edges: [['@kovojs/server/dist/index.mjs', '@kovojs/core/dist/index.mjs']],
      roots: [{ module: '@kovojs/server/dist/index.mjs', rootKind: 'application' }],
      schema: 'kovo.certificate/v1',
    });
    expect(first.opaque).toEqual([
      {
        module: '@kovojs/better-auth/dist/index.mjs',
        reason:
          'imports external module "third-party-auth" outside the seven-kind lexical capability domain',
      },
    ]);
    expect(first.artifacts.map((entry) => entry.path)).toEqual([
      '@kovojs/better-auth/dist/index.mjs',
      '@kovojs/core/dist/index.mjs',
      '@kovojs/server/dist/index.mjs',
      '@kovojs/server/dist/unused.mjs',
    ]);
    expect(first.cap).toEqual({
      '@kovojs/better-auth/dist/index.mjs': [],
      '@kovojs/core/dist/index.mjs': ['filesystem'],
      '@kovojs/server/dist/index.mjs': ['filesystem'],
      '@kovojs/server/dist/unused.mjs': [],
    });
    expect(first.artifacts[0].sha512).toBe(
      `sha512-${createHash('sha512').update("import 'third-party-auth'; export const auth = true;").digest('base64')}`,
    );
  });

  it('lifts exact reviewed internal doors into each reachable root summary', () => {
    const source = 'export const reviewedDoor = true;\n';
    const fixture = createFixture({
      '@kovojs/server': {
        exports: { '.': './dist/index.mjs' },
        files: {
          'dist/door.mjs': "import 'node:vm'; export const reviewedDoor = true;",
          'dist/door.mjs.map': JSON.stringify({ sources: ['../src/door.ts'], version: 3 }),
          'dist/index.mjs': "export { reviewedDoor } from './door.mjs';",
          'src/door.ts': source,
        },
      },
    });
    const posture = {
      packages: [
        {
          packageName: '@kovojs/server',
          postureGroups: [
            {
              capabilities: [],
              disposition: 'authority-free',
              id: 'server-root',
              members: { '.': ['createApp'] },
              rootKind: 'application',
            },
          ],
        },
      ],
    };
    const internalDoorPosture = {
      doors: [
        {
          capabilities: ['vm'],
          id: 'reviewed-vm-door',
          packageName: '@kovojs/server',
          source: 'src/door.ts',
          sourceSha512: sha512(source),
        },
      ],
      schema: 'kovo.certificate-door-posture/v1',
    };

    expect(
      generateKovoCertificate({
        ...fixture,
        internalDoorPosture,
        posture,
        seedPackageNames: ['@kovojs/server'],
      }).doors,
    ).toEqual([
      {
        escapeId: 'vm',
        module: '@kovojs/server/dist/door.mjs',
        site: 'certificate-internal-door:reviewed-vm-door:src/door.ts',
      },
      {
        escapeId: 'vm',
        module: '@kovojs/server/dist/index.mjs',
        site: 'certificate-door-summary:@kovojs/server/dist/door.mjs:certificate-internal-door:reviewed-vm-door:src/door.ts',
      },
    ]);
  });

  it('fails closed on reviewed internal-door source or schema drift', () => {
    const valid = {
      doors: [
        {
          capabilities: ['dynamic-loader', 'filesystem', 'vm'],
          id: 'sql-parser-authority',
          packageName: '@kovojs/server',
          source: 'src/sql-parser-authority.ts',
          sourceSha512: `sha512-${Buffer.alloc(64).toString('base64')}`,
        },
      ],
      schema: 'kovo.certificate-door-posture/v1',
    };
    expect(validateCertificateDoorPosture(valid)).toEqual([]);
    expect(
      validateCertificateDoorPosture({
        ...valid,
        doors: [{ ...valid.doors[0], capabilities: ['vm', 'filesystem'] }],
      }),
    ).not.toEqual([]);
    expect(
      validateCertificateDoorPosture({
        ...valid,
        doors: [{ ...valid.doors[0], source: '../outside.ts' }],
      }),
    ).not.toEqual([]);
  });

  it('requires the seven lexical authority routes and their exact modeled or §4.6 disposition', () => {
    const valid = {
      schema: 'kovo.certificate-lexical-authority/v1',
      routes: [
        ['re-exported-bindings', 'modeled'],
        ['computed-dynamic-import', 'modeled'],
        ['eval', 'plan-3-4.6'],
        ['new-function', 'plan-3-4.6'],
        ['host-globals', 'plan-3-4.6'],
        ['native-addons', 'modeled-and-plan-3-4.6'],
        ['wasm', 'modeled-and-plan-3-4.6'],
      ].map(([route, status]) => ({ evidence: 'reviewed evidence', route, status })),
    };
    expect(validateCertificateLexicalAuthorityLedger(valid)).toEqual([]);
    expect(
      validateCertificateLexicalAuthorityLedger({
        ...valid,
        routes: valid.routes.filter((row) => row.route !== 'host-globals'),
      }),
    ).not.toEqual([]);
  });
});

function createFixture(definitions) {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-certificate-generator-'));
  roots.push(root);
  const packageConfigs = [];
  const snapshot = { packages: {} };
  for (const [name, definition] of Object.entries(definitions)) {
    const rootDir = path.join(root, name.split('/').at(-1));
    mkdirSync(rootDir, { recursive: true });
    for (const [relativePath, source] of Object.entries(definition.files)) {
      const target = path.join(rootDir, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source, 'utf8');
    }
    packageConfigs.push({ name, publishExports: definition.exports, rootDir });
    snapshot.packages[name] = [...Object.keys(definition.files).sort(), 'package.json'];
  }
  return { packageConfigs, snapshot };
}

function emptyInternalDoorPosture() {
  return { doors: [], schema: 'kovo.certificate-door-posture/v1' };
}

function sha512(value) {
  return `sha512-${createHash('sha512').update(value).digest('base64')}`;
}
