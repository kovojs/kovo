import { createMemoryVersionedClientModuleRegistry, defineKovo, stylesheet } from '@kovojs/server';

import { createCrmDb, FALLBACK_CRM_DEMO_SESSION_ID, type CrmDb } from './db.js';
import { seedCrmDemo } from './demo-data.js';
import { CRM_DEMO_USER_ID } from './model.js';
import { crmTheme } from './theme.js';

const CRM_DEMO_SESSION_HEADER = 'x-kovo-demo-sid';
const EXAMPLE_ONLY_CRM_CSRF_SECRET = 'crm-reference-demo-csrf-secret-0123456789';
const crmDatabases = new Map<string, Promise<CrmDb>>();

function demoSessionId(request: Request): string {
  return request.headers.get(CRM_DEMO_SESSION_HEADER) ?? FALLBACK_CRM_DEMO_SESSION_ID;
}

function crmSessionProvider(request: Request) {
  return {
    id: demoSessionId(request),
    user: { id: CRM_DEMO_USER_ID, roles: ['sales'] as const },
  };
}

function crmDatabaseProvider(request: Request): Promise<CrmDb> {
  return crmDatabaseForSession(demoSessionId(request));
}

function crmDatabaseForSession(sessionId: string): Promise<CrmDb> {
  const existing = crmDatabases.get(sessionId);
  if (existing) return existing;

  const created = createSeededCrmDemoDb();
  crmDatabases.set(sessionId, created);
  return created;
}

async function createSeededCrmDemoDb(): Promise<CrmDb> {
  const db = await createCrmDb();
  await seedCrmDemo(db);
  return db;
}

/** Replace one demo session's database without rebuilding the closed app graph. */
export async function resetCrmDatabase(sessionId = FALLBACK_CRM_DEMO_SESSION_ID): Promise<CrmDb> {
  const created = createSeededCrmDemoDb();
  crmDatabases.set(sessionId, created);
  return created;
}

/** Release an evicted public-demo session's ephemeral database. */
export function releaseCrmDatabase(sessionId: string): void {
  crmDatabases.delete(sessionId);
}

function deploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}

/**
 * The CRM's one app-scoped authoring contract. Auth, DB, CSRF, and client-module context is
 * declared once; query/mutation/route modules import this immutable receiver and infer their
 * request context from it.
 */
export const app = defineKovo({
  appId: '0e3f07cd-cc4b-4f10-85bb-9eaaf6f73338',
  auth: crmSessionProvider,
  clientModules: createMemoryVersionedClientModuleRegistry(),
  csrf: {
    field: 'csrf',
    secret: deploymentSecret('KOVO_CRM_CSRF_SECRET', EXAMPLE_ONLY_CRM_CSRF_SECRET),
    sessionId(request) {
      return request.session?.id;
    },
  },
  db: crmDatabaseProvider,
  document: { lang: 'en-US' },
});

export const crmStylesheets = [
  stylesheet('./styles.css', {
    theme: crmTheme,
  }),
] as const;
