import { betterAuth, getAuthTables, type BetterAuthPlugin } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { expect } from 'vitest';

import {
  type BetterAuthResponseLike,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignOutLike,
  type BetterAuthSignUpEmailLike,
} from '@kovojs/better-auth';
import {
  betterAuthCredentialMutationDeclaredTableTouches,
  betterAuthCredentialMutationTouches,
  type BetterAuthCoreTable,
  type BetterAuthTable,
} from '@kovojs/better-auth/internal';

export type AuthDatabase = Record<BetterAuthCoreTable, Record<string, unknown>[]>;

export interface AppSession {
  email: string;
  sessionId: string;
  userId: string;
}

export interface ReferenceSession {
  id: string;
  user: {
    email: string;
    id: string;
    name: string;
    roles: readonly ('admin' | 'member')[];
  };
}

export interface ReferenceRequest {
  headers: Headers;
  session?: ReferenceSession | null;
}

export interface AuthVerifierDb {
  writes: { table: BetterAuthTable; value: unknown }[];
  write(table: BetterAuthTable, value: unknown): void;
}

export interface AuthVerifierRequest {
  db: AuthVerifierDb;
  headers: Headers;
}

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

export function authTable(fields: readonly string[] = [], modelName?: string) {
  return {
    fields: Object.fromEntries(fields.map((field) => [field, {}])),
    ...(modelName === undefined ? {} : { modelName }),
  };
}

export class ObservedCredentialAuth
  implements BetterAuthSignInEmailLike, BetterAuthSignOutLike, BetterAuthSignUpEmailLike
{
  readonly api = {
    signInEmail: async (): Promise<BetterAuthResponseLike> => {
      this.db.write('session', { action: 'signInEmail' });

      return responseWithCookies(['better-auth.session_token=verified-sign-in; Path=/; HttpOnly']);
    },
    signOut: async (): Promise<BetterAuthResponseLike> => {
      this.db.write('session', { action: 'signOut' });

      return responseWithCookies(['better-auth.session_token=; Path=/; Max-Age=0; HttpOnly']);
    },
    signUpEmail: async (): Promise<BetterAuthResponseLike> => {
      this.db.write('user', { action: 'signUpEmail' });
      this.db.write('account', { action: 'signUpEmail' });
      this.db.write('session', { action: 'signUpEmail' });

      return responseWithCookies(['better-auth.session_token=verified-sign-up; Path=/; HttpOnly']);
    },
  };

  constructor(private readonly db: AuthVerifierDb) {}
}

export class ObservedPluginCredentialAuth implements BetterAuthSignInEmailLike {
  readonly api = {
    signInEmail: async (): Promise<BetterAuthResponseLike> => {
      this.db.write('session', { action: 'signInEmail' });
      this.db.write(this.pluginTable, { action: 'signInEmail' });

      return responseWithCookies([
        'better-auth.session_token=verified-plugin-sign-in; Path=/; HttpOnly',
      ]);
    },
  };

  constructor(
    private readonly db: { write(table: string, value: unknown): void },
    private readonly pluginTable = 'webauthnCredential',
  ) {}
}

export function createAuthVerifierDb(): AuthVerifierDb {
  const writes: { table: BetterAuthTable; value: unknown }[] = [];

  return {
    writes,
    write(table, value) {
      writes.push({ table, value });
    },
  };
}

export function requestHeaders(cookie?: string): Headers {
  const headers = new Headers({
    origin: 'https://example.test',
    'user-agent': 'vitest',
  });

  if (cookie) headers.set('cookie', cookie);

  return headers;
}

export function responseCookies(cookies: string[] | string | undefined): string {
  const values = typeof cookies === 'string' ? [cookies] : (cookies ?? []);

  return values.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

export function sessionCookie(response: { headers: Headers }): string {
  return responseCookies(response.headers.getSetCookie());
}

export function responseWithCookies(
  cookies: readonly string[],
  status = 204,
): BetterAuthResponseLike {
  const headers = new Headers();

  Object.defineProperty(headers, 'getSetCookie', {
    value: () => [...cookies],
  });

  return { headers, status };
}

export async function expectObservedTables(
  api: keyof typeof betterAuthCredentialMutationDeclaredTableTouches,
  db: AuthDatabase,
  run: () => Promise<void>,
): Promise<void> {
  const before = snapshotTables(db);

  await run();

  const observed = changedTables(before, snapshotTables(db));
  const declaredTables: Set<BetterAuthTable> = new Set(
    betterAuthCredentialMutationDeclaredTableTouches[api].map((touch) => touch.table),
  );

  expect(observed.filter((table) => !declaredTables.has(table))).toEqual([]);
  expect(
    [
      ...new Set(
        betterAuthCredentialMutationDeclaredTableTouches[api].map((touch) => touch.domain),
      ),
    ].sort((left, right) => left.localeCompare(right)),
  ).toEqual(
    betterAuthCredentialMutationTouches[api]
      .map((domain) => domain.key)
      .sort((left, right) => left.localeCompare(right)),
  );
}

export function snapshotTables(db: AuthDatabase): Record<BetterAuthCoreTable, string> {
  return {
    account: stableRows(db.account ?? []),
    session: stableRows(db.session ?? []),
    user: stableRows(db.user ?? []),
    verification: stableRows(db.verification ?? []),
  };
}

export function changedTables(
  before: Record<BetterAuthCoreTable, string>,
  after: Record<BetterAuthCoreTable, string>,
): BetterAuthCoreTable[] {
  return (Object.keys(before) as BetterAuthCoreTable[]).filter(
    (table) => before[table] !== after[table],
  );
}

export function stableRows(rows: readonly Record<string, unknown>[]): string {
  return JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => key !== 'id' && key !== 'token' && key !== 'password')
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    ),
  );
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
