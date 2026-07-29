import { describe, expect, it } from 'vitest';

import {
  assertPackedBetterAuthDeclarations,
  assertPackedBetterAuthManifest,
  packedBetterAuthConsumerManifest,
  packedBetterAuthDeclarationExports,
} from './check-packed-better-auth-consumer.mjs';

function declaration(names) {
  return `export { ${names.map((name) => `type ${name}`).join(', ')} };\n`;
}

describe('packed Better Auth consumer proof', () => {
  it('accepts only the reviewed human/generated topology', () => {
    expect(() =>
      assertPackedBetterAuthManifest({
        dependencies: { '@kovojs/server': '0.2.0' },
        exports: {
          '.': { default: './dist/index.mjs', types: './dist/index.d.mts' },
          './generated': {
            default: './dist/generated.mjs',
            types: './dist/generated.d.mts',
          },
          './generated/postgres': {
            default: './dist/generated-postgres.mjs',
            types: './dist/generated-postgres.d.mts',
          },
          './generated/sqlite': {
            default: './dist/generated-sqlite.mjs',
            types: './dist/generated-sqlite.d.mts',
          },
        },
        name: '@kovojs/better-auth',
        peerDependencies: { 'better-auth': '1.6.17' },
        version: '0.2.0',
      }),
    ).not.toThrow();
    expect(packedBetterAuthDeclarationExports('export { type A, value };\n')).toEqual([
      'A',
      'value',
    ]);
  });

  it('rejects a duplicate generated constructor on the human root', () => {
    expect(() =>
      assertPackedBetterAuthDeclarations({
        neutral: declaration([
          'BetterAuthBindings',
          'BetterAuthBindingsOptions',
          'BetterAuthDevelopmentSeed',
          'BetterAuthEnvironmentBindingsOptions',
          'BetterAuthGeneratedCredentialResult',
          'BetterAuthGeneratedPasswordResetMutation',
          'BetterAuthGeneratedRequest',
          'BetterAuthGeneratedSignInMutation',
          'BetterAuthGeneratedSignOutMutation',
        ]),
        postgres: declaration([
          'BetterAuthPostgresBindings',
          'BetterAuthPostgresBindingsOptions',
          'BetterAuthPostgresEnvironmentBindingsOptions',
          'BetterAuthPostgresSecret',
          'betterAuthPostgresSecret',
          'createBetterAuthPostgresBindings',
          'createBetterAuthPostgresBindingsFromEnvironment',
        ]),
        root: 'export { createBetterAuthPostgresBindings };\n',
        sqlite: declaration([
          'BetterAuthSqliteBindings',
          'BetterAuthSqliteBindingsOptions',
          'BetterAuthSqliteDevelopmentSeed',
          'BetterAuthSqliteEnvironmentBindingsOptions',
          'BetterAuthSqliteSecret',
          'betterAuthSqliteSecret',
          'createBetterAuthSqliteBindings',
          'createBetterAuthSqliteBindingsFromEnvironment',
        ]),
      }),
    ).toThrow('human root');
  });

  it('pins all packed Kovo packages while installing the reviewed direct peer', () => {
    const result = packedBetterAuthConsumerManifest(
      [
        {
          manifest: { peerDependencies: { 'better-auth': '1.6.17' } },
          name: '@kovojs/better-auth',
          tarball: '.release/better-auth.tgz',
        },
        {
          manifest: {
            devDependencies: {
              '@types/better-sqlite3': '^7.6.13',
              '@types/pg': '^8.15.6',
            },
            peerDependencies: {
              'better-sqlite3': '12.11.1',
              pg: '8.18.0',
              optional: '1.0.0',
            },
            peerDependenciesMeta: {
              'better-sqlite3': { optional: true },
              optional: { optional: true },
            },
          },
          name: '@kovojs/server',
          tarball: '.release/server.tgz',
        },
      ],
      'pnpm@10.12.1',
      '25.9.2',
    );
    expect(result.dependencies).toMatchObject({
      '@kovojs/better-auth': expect.stringMatching(/^file:/u),
      '@kovojs/server': expect.stringMatching(/^file:/u),
      '@types/node': '25.9.2',
      '@types/better-sqlite3': '^7.6.13',
      '@types/pg': '^8.15.6',
      'better-auth': '1.6.17',
      'better-sqlite3': '12.11.1',
      pg: '8.18.0',
    });
    expect(result.dependencies).not.toHaveProperty('optional');
    expect(result.pnpm.onlyBuiltDependencies).toEqual(['better-sqlite3']);
  });
});
