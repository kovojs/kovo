import { describe, expect, it } from 'vitest';

import { checkAuthProviderPin, providerGateCommand } from './check-auth-provider-pin.mjs';

const integrity =
  'sha512-B5s6+lPsDWp8rGLRnvNyr5h9tftG9zLRjNrlkEJdYRhcuhPhJiw9b8o6ibgxEFpSAdUqoDaP5/FLqfu8QsXIVg==';

function rootPackage({ check = true, command = true } = {}) {
  return JSON.stringify({
    scripts: {
      check: check
        ? 'pnpm run check:imports && pnpm run check:auth-provider-pin && pnpm run check:tcb-boundary'
        : 'pnpm run check:imports && pnpm run check:tcb-boundary',
      ...(command
        ? {
            'check:auth-provider-pin': providerGateCommand,
          }
        : {}),
    },
  });
}

function providerPackage({ implementation = '1.6.22', peer } = {}) {
  return JSON.stringify({
    dependencies: { 'better-auth': implementation },
    ...(peer === undefined ? {} : { peerDependencies: { 'better-auth': peer } }),
  });
}

function tcbManifest({ pinnedVersion = '1.6.22' } = {}) {
  return `# Test TCB

\`\`\`json tcb-manifest
${JSON.stringify({
  budgets: { entryMaxLines: 1, totalTcbMaxLines: 1 },
  entries: [],
  schema: 'kovo.security.tcb/v1',
  trustedDependencySurfaces: [
    {
      dependency: 'better-auth',
      guarantee: 'test',
      id: 'dep.better-auth.test-one',
      integrity,
      packageJson: 'packages/better-auth/package.json',
      pinnedVersion,
      reviewTrigger: 'test',
      surface: 'test one',
    },
    {
      dependency: 'better-auth',
      guarantee: 'test',
      id: 'dep.better-auth.test-two',
      integrity,
      packageJson: 'packages/better-auth/package.json',
      pinnedVersion,
      reviewTrigger: 'test',
      surface: 'test two',
    },
  ],
})}
\`\`\`
`;
}

function lockfile({ version = '1.6.22' } = {}) {
  return `lockfileVersion: '9.0'

packages:

  better-auth@${version}:
    resolution: {integrity: ${integrity}}

snapshots:
`;
}

function run(overrides = {}) {
  const files = {
    'package.json': rootPackage(),
    'packages/better-auth/package.json': providerPackage(),
    'pnpm-lock.yaml': lockfile(),
    'security/TCB.md': tcbManifest(),
    ...overrides,
  };
  return checkAuthProviderPin({
    exists: (file) => Object.hasOwn(files, file),
    readText: (file) => files[file] ?? '',
  });
}

describe('Better Auth provider pin gate (C13 anchor)', () => {
  it('accepts one exact provider version across the adapter dependency, TCB, and lockfile', () => {
    expect(run()).toEqual({
      findings: [],
      ok: true,
      summary: 'OK better-auth provider exact-pinned to 1.6.22 across 2 TCB surfaces',
    });
  });

  it('kills widened, missing, and peer-owned provider declarations', () => {
    expect(
      run({
        'packages/better-auth/package.json': providerPackage({ implementation: '^1.6.0' }),
      }).findings,
    ).toEqual(expect.arrayContaining([expect.stringContaining('dependencies.better-auth')]));
    expect(
      run({
        'packages/better-auth/package.json': JSON.stringify({ dependencies: {} }),
      }).findings,
    ).toEqual(expect.arrayContaining([expect.stringContaining('dependencies.better-auth')]));
    expect(
      run({
        'packages/better-auth/package.json': providerPackage({ peer: '1.6.22' }),
      }).findings,
    ).toEqual(expect.arrayContaining([expect.stringContaining('peerDependencies.better-auth')]));
  });

  it('kills TCB disagreement and a lockfile that lacks the exact subject', () => {
    expect(run({ 'security/TCB.md': tcbManifest({ pinnedVersion: '1.6.23' }) }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('1.6.23')]),
    );
    expect(run({ 'pnpm-lock.yaml': lockfile({ version: '1.6.23' }) }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('better-auth@1.6.22')]),
    );
  });

  it('kills removal of either the named gate or its root check-chain enrollment', () => {
    expect(run({ 'package.json': rootPackage({ command: false }) }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('scripts.check:auth-provider-pin')]),
    );
    expect(run({ 'package.json': rootPackage({ check: false }) }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('root scripts.check')]),
    );
  });
});
