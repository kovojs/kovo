import { createMemoryVersionedClientModuleRegistry, defineKovo } from '@kovojs/server';
import { eq } from 'drizzle-orm';

import { createSoDb, type SoDb } from './db.js';
import { seedSoDemo } from './demo-data.js';
import { questions } from './schema.js';

const SO_DEMO_SESSION_HEADER = 'x-kovo-demo-sid';
const SO_DEMO_SESSION_COOKIE = 'kovo_demo_sid';
const EXAMPLE_ONLY_SO_CSRF_SECRET = 'stackoverflow-reference-demo-csrf-secret';
export const FALLBACK_SO_DEMO_SESSION_ID = 'demo-session';

interface SoDatabaseState {
  db: SoDb;
  ensureSession(sessionId: string): Promise<void>;
}

let databaseState: Promise<SoDatabaseState> | undefined;

function soDemoSessionProvider(request: Request) {
  const id =
    request.headers.get(SO_DEMO_SESSION_HEADER) ??
    readCookie(request.headers.get('cookie'), SO_DEMO_SESSION_COOKIE) ??
    FALLBACK_SO_DEMO_SESSION_ID;
  return { id, user: { id: 'demo-viewer', roles: ['member'] as const } };
}

async function soDatabaseProvider(request: Request & { session?: { id?: string } | null }) {
  const state = await currentSoDatabaseState();
  const sessionId = request.session?.id ?? FALLBACK_SO_DEMO_SESSION_ID;
  await state.ensureSession(sessionId);
  return state.db;
}

function currentSoDatabaseState(): Promise<SoDatabaseState> {
  databaseState ??= createSoDatabaseState();
  return databaseState;
}

async function createSoDatabaseState(database?: SoDb): Promise<SoDatabaseState> {
  const db = database ?? (await createSoDb());
  const ensureSession = createSoDemoSessionSeeder(db);
  return { db, ensureSession };
}

/** Replace the test/development database without rebuilding the closed app graph. */
export async function resetSoDatabase(database?: SoDb): Promise<SoDb> {
  const next = createSoDatabaseState(database);
  databaseState = next;
  const state = await next;
  await state.ensureSession(FALLBACK_SO_DEMO_SESSION_ID);
  return state.db;
}

function createSoDemoSessionSeeder(db: SoDb): (sessionId: string) => Promise<void> {
  const seeded = new Set<string>();
  const pending = new Map<string, Promise<void>>();

  return async function ensureSoDemoSession(sessionId: string): Promise<void> {
    if (seeded.has(sessionId)) return;
    const inFlight = pending.get(sessionId);
    if (inFlight) return inFlight;

    const seed = (async () => {
      const [existing] = await db
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.sessionId, sessionId))
        .limit(1);
      if (!existing) {
        await seedSoDemo(db, sessionId);
      }
      seeded.add(sessionId);
    })().finally(() => {
      pending.delete(sessionId);
    });

    pending.set(sessionId, seed);
    return seed;
  };
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1 || part.slice(0, eqIndex).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eqIndex + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function deploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}

/** KovOverflow's one app-scoped authoring contract (SPEC §6.2.1/§9.5). */
export const app = defineKovo({
  appId: '1eeb2490-f12b-4af7-b1ca-2023f2c621e8',
  auth: soDemoSessionProvider,
  clientModules: createMemoryVersionedClientModuleRegistry(),
  csrf: {
    field: 'csrf',
    secret: deploymentSecret('KOVO_STACKOVERFLOW_CSRF_SECRET', EXAMPLE_ONLY_SO_CSRF_SECRET),
    sessionId(request) {
      return request.session?.id;
    },
  },
  db: soDatabaseProvider,
  document: { lang: 'en-US' },
});
