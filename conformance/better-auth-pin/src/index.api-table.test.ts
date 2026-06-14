import { getAuthTables } from 'better-auth';
import { admin, organization } from 'better-auth/plugins';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  betterAuthSchemaBridge,
  validateBetterAuthSchemaBridge,
  type BetterAuthLike,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignOutLike,
  type BetterAuthSignUpEmailLike,
} from '../../../packages/better-auth/src/index.js';

import { createRealAuth, requireAuthTable } from './real-auth-fixtures.js';

describe('Better Auth pinned conformance', () => {
  it('pins the real better-auth server API shape consumed by the adapter', () => {
    const { auth } = createRealAuth();

    expect(typeof auth.api.getSession).toBe('function');
    expect(typeof auth.api.signInEmail).toBe('function');
    expect(typeof auth.api.signOut).toBe('function');
    expect(typeof auth.api.signUpEmail).toBe('function');
    expect(typeof auth.handler).toBe('function');

    expectTypeOf(auth).toMatchTypeOf<BetterAuthLike<unknown, unknown>>();
    expectTypeOf(auth).toMatchTypeOf<BetterAuthSignInEmailLike>();
    expectTypeOf(auth).toMatchTypeOf<BetterAuthSignOutLike>();
    expectTypeOf(auth).toMatchTypeOf<BetterAuthSignUpEmailLike>();
  });

  it('pins Better Auth table metadata used by the schema bridge', () => {
    const { auth } = createRealAuth();
    const tables = getAuthTables(auth.options);
    const userTable = requireAuthTable(tables, 'user');
    const sessionTable = requireAuthTable(tables, 'session');
    const accountTable = requireAuthTable(tables, 'account');
    const verificationTable = requireAuthTable(tables, 'verification');

    expect(
      Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.order])),
    ).toEqual({
      account: 3,
      session: 2,
      user: 1,
      verification: 4,
    });
    expect(Object.keys(userTable.fields).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerified',
      'image',
      'name',
      'updatedAt',
    ]);
    expect(Object.keys(sessionTable.fields).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'ipAddress',
      'token',
      'updatedAt',
      'userAgent',
      'userId',
    ]);
    expect(Object.keys(accountTable.fields).sort()).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'accountId',
      'createdAt',
      'idToken',
      'password',
      'providerId',
      'refreshToken',
      'refreshTokenExpiresAt',
      'scope',
      'updatedAt',
      'userId',
    ]);
    expect(Object.keys(verificationTable.fields).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'identifier',
      'updatedAt',
      'value',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.user).toEqual({ domain: 'user', key: 'id' });
    expect(betterAuthSchemaBridge.verification).toEqual({
      exempt: true,
      rationale: 'Better Auth email/token verification bookkeeping is not an app read surface.',
    });
  });

  it('pins blessed plugin table metadata used by the schema bridge', () => {
    const { auth } = createRealAuth({
      plugins: [
        admin(),
        organization({
          dynamicAccessControl: { enabled: true },
          teams: { enabled: true },
        }),
      ],
    });
    const tables = getAuthTables(auth.options);

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'invitation',
      'member',
      'organization',
      'organizationRole',
      'session',
      'team',
      'teamMember',
      'user',
      'verification',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'user').fields).sort()).toEqual([
      'banExpires',
      'banReason',
      'banned',
      'createdAt',
      'email',
      'emailVerified',
      'image',
      'name',
      'role',
      'updatedAt',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'session').fields).sort()).toEqual([
      'activeOrganizationId',
      'activeTeamId',
      'createdAt',
      'expiresAt',
      'impersonatedBy',
      'ipAddress',
      'token',
      'updatedAt',
      'userAgent',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'organization').fields).sort()).toEqual([
      'createdAt',
      'logo',
      'metadata',
      'name',
      'slug',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'member').fields).sort()).toEqual([
      'createdAt',
      'organizationId',
      'role',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'invitation').fields).sort()).toEqual([
      'createdAt',
      'email',
      'expiresAt',
      'inviterId',
      'organizationId',
      'role',
      'status',
      'teamId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'team').fields).sort()).toEqual([
      'createdAt',
      'name',
      'organizationId',
      'updatedAt',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'teamMember').fields).sort()).toEqual([
      'createdAt',
      'teamId',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'organizationRole').fields).sort()).toEqual([
      'createdAt',
      'organizationId',
      'permission',
      'role',
      'updatedAt',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.organization).toEqual({ domain: 'organization', key: 'id' });
    expect(betterAuthSchemaBridge.member).toEqual({
      domain: 'organization',
      key: 'organizationId',
    });
    expect(betterAuthSchemaBridge.teamMember).toEqual({
      domain: 'organization',
      key: 'teamId',
    });
  });
});
