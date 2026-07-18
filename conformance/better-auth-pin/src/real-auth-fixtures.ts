import { betterAuth, getAuthTables, type BetterAuthPlugin } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

import { type BetterAuthCoreTable } from '@kovojs/better-auth/internal';

export type AuthDatabase = Record<BetterAuthCoreTable, Record<string, unknown>[]>;

export const authSecret = '0123456789abcdef0123456789abcdef';
export const baseURL = 'https://example.test/api/auth';
export const password = 'correct horse battery staple';

export function createRealAuth(
  options: {
    account?: Parameters<typeof betterAuth>[0]['account'];
    plugins?: Parameters<typeof betterAuth>[0]['plugins'];
    rateLimit?: Parameters<typeof betterAuth>[0]['rateLimit'];
    session?: Parameters<typeof betterAuth>[0]['session'];
    user?: Parameters<typeof betterAuth>[0]['user'];
    verification?: Parameters<typeof betterAuth>[0]['verification'];
  } = {},
) {
  const db: AuthDatabase = {
    account: [],
    session: [],
    user: [],
    verification: [],
  };
  const auth = betterAuth({
    advanced: {
      disableCSRFCheck: true,
    },
    baseURL,
    database: memoryAdapter(db),
    emailAndPassword: {
      enabled: true,
    },
    ...(options.account === undefined ? {} : { account: options.account }),
    ...(options.plugins === undefined ? {} : { plugins: options.plugins }),
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
    ...(options.session === undefined ? {} : { session: options.session }),
    secret: authSecret,
    ...(options.user === undefined ? {} : { user: options.user }),
    ...(options.verification === undefined ? {} : { verification: options.verification }),
  });

  return { auth, db };
}

export function futureWebAuthnPlugin(): BetterAuthPlugin {
  return {
    id: 'future-webauthn',
    schema: {
      webauthnChallenge: {
        fields: {
          challenge: { type: 'string' },
          expiresAt: { type: 'date' },
        },
        modelName: 'auth_webauthn_challenges',
      },
      webauthnCredential: {
        fields: {
          credentialId: { type: 'string' },
          userId: { type: 'string' },
        },
        modelName: 'auth_webauthn_credentials',
      },
    },
  };
}

export function betterAuthSchemaSourceFixture(tables: readonly string[]): string {
  return [
    "import { kovo } from '@kovojs/drizzle';",
    "import { pgTable } from 'drizzle-orm/pg-core';",
    '',
    ...[...tables].sort().map((table) => `export const ${table} = pgTable('${table}', {});`),
    '',
  ].join('\n');
}

export function importResultMessage(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'fulfilled';

  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

export function requireAuthTable(
  tables: ReturnType<typeof getAuthTables>,
  table: string,
): NonNullable<ReturnType<typeof getAuthTables>[string]> {
  const value = tables[table];

  if (!value) throw new Error(`better-auth table metadata missing: ${table}`);

  return value;
}
