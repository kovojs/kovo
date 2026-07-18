import { createPostgresAppRuntimeDb } from '@kovojs/server';
import { csrfToken } from '@kovojs/server/internal/csrf';
import { usePostgresSystemDb } from '@kovojs/server/internal/postgres-capability';
import { useSqliteSystemDb } from '@kovojs/server/internal/sqlite-capability';
import { createSqliteAppRuntime } from '@kovojs/server/sqlite';
import { kovo } from '../../drizzle/src/index.js';
import { runMutation } from '../../server/src/mutation.js';
import { sql } from '../../server/node_modules/drizzle-orm/index.js';
import {
  bigint as pgBigint,
  boolean,
  integer as pgInteger,
  pgTable,
  text as pgText,
  timestamp,
} from '../../server/node_modules/drizzle-orm/pg-core/index.js';
import {
  integer,
  sqliteTable,
  text as sqliteText,
} from '../../server/node_modules/drizzle-orm/sqlite-core/index.js';
import { betterAuthCsrfFromEnvironment } from './environment.js';
import { betterAuthPostgresSecret, createBetterAuthPostgresBindings } from './postgres.js';
import { betterAuthSqliteSecret, createBetterAuthSqliteBindings } from './sqlite.js';

const postgresUser = pgTable(
  'user',
  {
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    email: pgText('email').notNull().unique(),
    emailVerified: boolean('emailVerified').notNull().default(false),
    id: pgText('id').primaryKey(),
    image: pgText('image'),
    name: pgText('name').notNull(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  },
  kovo({ domain: 'auth', key: 'id', owner: (table) => table.id }),
);
const postgresSession = pgTable(
  'session',
  {
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    expiresAt: timestamp('expiresAt').notNull(),
    id: pgText('id').primaryKey(),
    ipAddress: pgText('ipAddress'),
    token: pgText('token').notNull().unique(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
    userAgent: pgText('userAgent'),
    userId: pgText('userId')
      .notNull()
      .references(() => postgresUser.id, { onDelete: 'cascade' }),
  },
  kovo({ domain: 'auth', key: 'userId', owner: 'userId', secret: ['token'] }),
);
const postgresAccount = pgTable(
  'account',
  {
    accessToken: pgText('accessToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
    accountId: pgText('accountId').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    id: pgText('id').primaryKey(),
    idToken: pgText('idToken'),
    password: pgText('password'),
    providerId: pgText('providerId').notNull(),
    refreshToken: pgText('refreshToken'),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
    scope: pgText('scope'),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
    userId: pgText('userId')
      .notNull()
      .references(() => postgresUser.id, { onDelete: 'cascade' }),
  },
  kovo({
    domain: 'auth',
    key: 'userId',
    owner: 'userId',
    secret: ['password', 'accessToken', 'refreshToken', 'idToken'],
  }),
);
const postgresVerification = pgTable('verification', {
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  expiresAt: timestamp('expiresAt').notNull(),
  id: pgText('id').primaryKey(),
  identifier: pgText('identifier').notNull(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  value: pgText('value').notNull(),
});
const postgresRateLimit = pgTable(
  'rateLimit',
  {
    count: pgInteger('count').notNull(),
    id: pgText('id').primaryKey(),
    key: pgText('key').notNull().unique(),
    lastRequest: pgBigint('lastRequest', { mode: 'number' }).notNull(),
  },
  kovo({
    authzPolicy: sql`false`,
    domain: 'auth-rate-limit',
    key: 'id',
    secret: true,
  }),
);
const postgresSchema = {
  account: postgresAccount,
  rateLimit: postgresRateLimit,
  session: postgresSession,
  user: postgresUser,
  verification: postgresVerification,
};

const sqliteUser = sqliteTable('user', {
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  email: sqliteText('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  id: sqliteText('id').primaryKey(),
  image: sqliteText('image'),
  name: sqliteText('name').notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});
const sqliteSession = sqliteTable('session', {
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  id: sqliteText('id').primaryKey(),
  ipAddress: sqliteText('ipAddress'),
  token: sqliteText('token').notNull().unique(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  userAgent: sqliteText('userAgent'),
  userId: sqliteText('userId')
    .notNull()
    .references(() => sqliteUser.id, { onDelete: 'cascade' }),
});
const sqliteAccount = sqliteTable('account', {
  accessToken: sqliteText('accessToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
  accountId: sqliteText('accountId').notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  id: sqliteText('id').primaryKey(),
  idToken: sqliteText('idToken'),
  password: sqliteText('password'),
  providerId: sqliteText('providerId').notNull(),
  refreshToken: sqliteText('refreshToken'),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
  scope: sqliteText('scope'),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  userId: sqliteText('userId')
    .notNull()
    .references(() => sqliteUser.id, { onDelete: 'cascade' }),
});
const sqliteVerification = sqliteTable('verification', {
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  id: sqliteText('id').primaryKey(),
  identifier: sqliteText('identifier').notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  value: sqliteText('value').notNull(),
});
const sqliteRateLimit = sqliteTable(
  'rateLimit',
  {
    count: integer('count').notNull(),
    id: sqliteText('id').primaryKey(),
    key: sqliteText('key').notNull().unique(),
    lastRequest: integer('lastRequest').notNull(),
  },
  kovo({ exempt: true }),
);
const sqliteSchema = {
  account: sqliteAccount,
  rateLimit: sqliteRateLimit,
  session: sqliteSession,
  user: sqliteUser,
  verification: sqliteVerification,
};

const postgresSecret = 'Kovo-Postgres-Intrinsic-Boundary-Secret-0a1B2c3D4e5F';
const postgresPassword = 'Kovo-Postgres-Intrinsic-Password-0a1B2c3D4e5F';
const sqliteSecret = 'Kovo-Sqlite-Intrinsic-Boundary-Secret-0a1B2c3D4e5F';
const sqlitePassword = 'Kovo-Sqlite-Intrinsic-Password-0a1B2c3D4e5F';
const invalidSignature = `${'A'.repeat(43)}=`;

type IntrinsicNormalizationForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD';

const NativeSet = globalThis.Set;
const NativeTextEncoder = globalThis.TextEncoder;
const nativeAtob = globalThis.atob;
const nativeBtoa = globalThis.btoa;
const nativeStringNormalize = Reflect.get(globalThis.String.prototype, 'normalize') as (
  this: string,
  form?: IntrinsicNormalizationForm,
) => string;
const nativeTextEncoderEncode = Reflect.get(NativeTextEncoder.prototype, 'encode') as (
  this: TextEncoder,
  input?: string,
) => NodeJS.NonSharedUint8Array;
const nativeSubtle = globalThis.crypto.subtle;
const nativeSubtlePrototype = Object.getPrototypeOf(nativeSubtle) as SubtleCrypto;
const nativeSubtleDigest = Reflect.get(nativeSubtle, 'digest') as SubtleCrypto['digest'];
const nativeSubtleImportKey = Reflect.get(nativeSubtle, 'importKey') as SubtleCrypto['importKey'];
const nativeSubtleSign = Reflect.get(nativeSubtle, 'sign') as SubtleCrypto['sign'];
const nativeSubtleVerify = Reflect.get(nativeSubtle, 'verify') as SubtleCrypto['verify'];

interface IntrinsicExerciseResult {
  attempts: readonly boolean[];
  captures: readonly string[];
  environmentCsrfTokenMinted: boolean;
  postgres: {
    passwordIsArgon2id: boolean;
    sessionProbe: unknown;
    signInSucceeded: boolean;
  };
  sqlite: {
    passwordIsArgon2id: boolean;
    sessionProbe: unknown;
    signInSucceeded: boolean;
  };
}

/** Loaded only after the child has imported the supported runner bootstrap. */
export async function exerciseLockedBetterAuthIntrinsics(
  postgresDataDir: string,
): Promise<IntrinsicExerciseResult> {
  const captures: string[] = [];
  const capture = (kind: string, value: unknown): void => {
    if (typeof value === 'string') {
      captures.push(`${kind}:${value}`);
      return;
    }
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      captures.push(
        `${kind}:${Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('utf8')}`,
      );
      return;
    }
    if (value instanceof ArrayBuffer) {
      captures.push(`${kind}:${Buffer.from(value).toString('utf8')}`);
    }
  };
  class HostileSet<Value> extends NativeSet<Value> {
    constructor(values?: readonly Value[] | null) {
      capture('Set', values);
      super(values);
    }
  }
  class HostileTextEncoder extends NativeTextEncoder {
    override encode(input?: string): NodeJS.NonSharedUint8Array {
      capture('TextEncoder', input);
      return Reflect.apply(nativeTextEncoderEncode, this, [input]);
    }
  }
  const hostileEncode = function (this: TextEncoder, input?: string): NodeJS.NonSharedUint8Array {
    capture('TextEncoder.prototype.encode', input);
    return Reflect.apply(nativeTextEncoderEncode, this, [input]);
  };
  const hostileImportKey = async function (
    this: SubtleCrypto,
    ...args: Parameters<SubtleCrypto['importKey']>
  ): Promise<CryptoKey> {
    capture('SubtleCrypto.importKey', args[1]);
    return Reflect.apply(nativeSubtleImportKey, nativeSubtle, args) as Promise<CryptoKey>;
  };
  const hostileSign = async function (
    this: SubtleCrypto,
    ...args: Parameters<SubtleCrypto['sign']>
  ): Promise<ArrayBuffer> {
    capture('SubtleCrypto.sign.data', args[2]);
    return Reflect.apply(nativeSubtleSign, nativeSubtle, args) as Promise<ArrayBuffer>;
  };
  const hostileVerify = async function (
    this: SubtleCrypto,
    ...args: Parameters<SubtleCrypto['verify']>
  ): Promise<boolean> {
    capture('SubtleCrypto.verify.signature', args[2]);
    capture('SubtleCrypto.verify.data', args[3]);
    return Reflect.apply(nativeSubtleVerify, nativeSubtle, args) as Promise<boolean>;
  };
  const hostileDigest = async function (
    this: SubtleCrypto,
    ...args: Parameters<SubtleCrypto['digest']>
  ): Promise<ArrayBuffer> {
    capture('SubtleCrypto.digest.data', args[1]);
    return Reflect.apply(nativeSubtleDigest, nativeSubtle, args) as Promise<ArrayBuffer>;
  };

  const attempts = [
    Reflect.set(globalThis, 'Set', HostileSet),
    Reflect.set(globalThis, 'TextEncoder', HostileTextEncoder),
    Reflect.set(NativeTextEncoder.prototype, 'encode', hostileEncode),
    Reflect.set(globalThis, 'SubtleCrypto', class HostileSubtleCrypto {}),
    Reflect.set(nativeSubtlePrototype, 'importKey', hostileImportKey),
    Reflect.set(nativeSubtlePrototype, 'sign', hostileSign),
    Reflect.set(nativeSubtlePrototype, 'verify', hostileVerify),
    Reflect.set(nativeSubtlePrototype, 'digest', hostileDigest),
    Reflect.set(nativeSubtle, 'importKey', hostileImportKey),
    Reflect.set(nativeSubtle, 'sign', hostileSign),
    Reflect.set(nativeSubtle, 'verify', hostileVerify),
    Reflect.set(nativeSubtle, 'digest', hostileDigest),
    Reflect.set(globalThis, 'atob', (value: string) => {
      capture('atob', value);
      return nativeAtob(value);
    }),
    Reflect.set(globalThis, 'btoa', (value: string) => {
      capture('btoa', value);
      return nativeBtoa(value);
    }),
    Reflect.set(
      globalThis.String.prototype,
      'normalize',
      function (this: string, form?: IntrinsicNormalizationForm) {
        capture('String.prototype.normalize', this);
        return Reflect.apply(nativeStringNormalize, this, [form]);
      },
    ),
  ];

  const postgres = await exercisePostgres(postgresDataDir);
  const sqlite = await exerciseSqlite();
  const environmentCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf' });
  const environmentCsrfToken = csrfToken(
    { authCsrfId: 'intrinsic-environment-session' },
    environmentCsrf,
    { audience: 'auth/sign-in' },
  );
  return {
    attempts,
    captures,
    environmentCsrfTokenMinted: /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(environmentCsrfToken),
    postgres,
    sqlite,
  };
}

async function exercisePostgres(dataDir: string): Promise<IntrinsicExerciseResult['postgres']> {
  const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema: postgresSchema });
  try {
    await runtime.ready;
    const systemDb = runtime.systemDb({
      operation: 'write',
      reason: 'Prove Better Auth Postgres bootstrap-first intrinsic isolation',
      surface: 'packages/better-auth/src/intrinsic-boundary.security-fixture.ts#postgres',
    });
    const csrf = {
      field: 'csrf',
      secret: 'Kovo-Postgres-Intrinsic-Csrf-Secret-0a1B2c3D4e5F',
      sessionId: () => 'postgres-pre-auth-session',
    };
    const bindings = createBetterAuthPostgresBindings({
      baseURL: 'http://localhost:5173',
      csrf,
      developmentSeed: {
        email: 'postgres-intrinsic@example.test',
        name: 'Postgres Intrinsic User',
        password: postgresPassword,
      },
      mapSession: ({ session, user }) => ({ id: session.id, user: { id: user.id } }),
      schema: postgresSchema,
      secret: betterAuthPostgresSecret(postgresSecret),
      signInAccess: { kind: 'public', reason: 'intrinsic-boundary Postgres sign-in' },
      signOutAccess: { kind: 'public', reason: 'intrinsic-boundary Postgres sign-out' },
      systemDb,
    });
    await bindings.seedDemoUser();
    const accounts = await usePostgresSystemDb(systemDb, (db) =>
      db.select({ password: postgresAccount.password }).from(postgresAccount),
    );
    const request = new Request('http://localhost:5173/_m/auth/sign-in', {
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
    });
    const token = csrfToken(request, csrf, { audience: 'auth/sign-in' });
    const signIn = await runMutation(
      bindings.signIn,
      {
        csrf: token,
        email: 'postgres-intrinsic@example.test',
        password: postgresPassword,
      },
      request,
      { clientIp: () => '127.0.0.1' },
    );
    const sessionProbe = await bindings.sessionProvider({
      headers: new Headers({
        cookie: `better-auth.session_token=not-a-session.${invalidSignature}`,
      }),
      url: 'http://localhost:5173/intrinsic-session-probe',
    });
    return {
      passwordIsArgon2id:
        typeof accounts[0]?.password === 'string' &&
        accounts[0].password.startsWith('$argon2id$v=19$'),
      sessionProbe,
      signInSucceeded: signIn.ok === true && signIn.value.status === 'signed-in',
    };
  } finally {
    await runtime.close();
  }
}

async function exerciseSqlite(): Promise<IntrinsicExerciseResult['sqlite']> {
  const runtime = createSqliteAppRuntime({ tables: Object.values(sqliteSchema) });
  try {
    const systemDb = runtime.systemDb({
      operation: 'write',
      reason: 'Prove Better Auth SQLite bootstrap-first intrinsic isolation',
      surface: 'packages/better-auth/src/intrinsic-boundary.security-fixture.ts#sqlite',
    });
    const csrf = {
      field: 'csrf',
      secret: 'Kovo-Sqlite-Intrinsic-Csrf-Secret-0a1B2c3D4e5F',
      sessionId: () => 'sqlite-pre-auth-session',
    };
    const bindings = createBetterAuthSqliteBindings({
      baseURL: 'http://localhost:5173',
      csrf,
      developmentSeed: {
        email: 'sqlite-intrinsic@example.test',
        name: 'SQLite Intrinsic User',
        password: sqlitePassword,
      },
      mapSession: ({ session, user }) => ({ id: session.id, user: { id: user.id } }),
      schema: sqliteSchema,
      secret: betterAuthSqliteSecret(sqliteSecret),
      signInAccess: { kind: 'public', reason: 'intrinsic-boundary SQLite sign-in' },
      signOutAccess: { kind: 'public', reason: 'intrinsic-boundary SQLite sign-out' },
      systemDb,
    });
    await bindings.seedDemoUser();
    const accounts = useSqliteSystemDb(systemDb, (db) =>
      db.select({ password: sqliteAccount.password }).from(sqliteAccount).all(),
    );
    const request = new Request('http://localhost:5173/_m/auth/sign-in', {
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
    });
    const token = csrfToken(request, csrf, { audience: 'auth/sign-in' });
    const signIn = await runMutation(
      bindings.signIn,
      { csrf: token, email: 'sqlite-intrinsic@example.test', password: sqlitePassword },
      request,
      { clientIp: () => '127.0.0.1' },
    );
    const sessionProbe = await bindings.sessionProvider({
      headers: new Headers({
        cookie: `better-auth.session_token=not-a-session.${invalidSignature}`,
      }),
      url: 'http://localhost:5173/intrinsic-session-probe',
    });
    return {
      passwordIsArgon2id:
        typeof accounts[0]?.password === 'string' &&
        accounts[0].password.startsWith('$argon2id$v=19$'),
      sessionProbe,
      signInSucceeded: signIn.ok === true && signIn.value.status === 'signed-in',
    };
  } finally {
    runtime.close();
  }
}
