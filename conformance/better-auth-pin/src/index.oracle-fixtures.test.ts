import { getAuthTables } from 'better-auth';
import { describe, expect, it } from 'vitest';

import {
  betterAuthCredentialMutationDeclaredTableTouches,
  generateBetterAuthSchemaSource,
} from '@kovojs/better-auth/internal';

import { crossPackageOracleFixture } from '../../../packages/conformance-fixtures/src/oracle-fixtures.js';
import { createRealAuth } from './real-auth-fixtures.js';

describe('Better Auth pinned conformance', () => {
  it('pins the shared cross-package oracle Better Auth schema and declared touch expectations', () => {
    const fixture = crossPackageOracleFixture();
    const { auth } = createRealAuth();
    const tables = getAuthTables(auth.options);
    const generated = generateBetterAuthSchemaSource(tables);

    expect(
      betterAuthCredentialMutationDeclaredTableTouches.signInEmail.map((touch) => touch.table),
    ).toEqual(fixture.betterAuth.credentialTouches.signInEmail);
    expect(
      betterAuthCredentialMutationDeclaredTableTouches.signOut.map((touch) => touch.table),
    ).toEqual(fixture.betterAuth.credentialTouches.signOut);
    expect(
      betterAuthCredentialMutationDeclaredTableTouches.signUpEmail
        .map((touch) => touch.table)
        .sort(),
    ).toEqual([...fixture.betterAuth.credentialTouches.signUpEmail].sort());

    for (const snippet of fixture.betterAuth.generatedSchemaSourceSnippets) {
      expect(generated.source).toContain(snippet);
    }
    expect(generated.skippedTables).toEqual([]);
  });
});
