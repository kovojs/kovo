import { route, s } from '@kovojs/server';
import { createApp, createRequestHandler } from '@kovojs/server/app-shell/core';
import type { RequestHandler } from '@kovojs/server/app-shell/core';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/app-shell/client-modules';
import { asc, eq } from 'drizzle-orm';

import { renderContactsPage } from './generated/contacts.js';
import { renderDealDetailPage } from './generated/deal-detail.js';
// Types only — the persisted-row shapes the detail page loads carry the
// presentational title/company columns the rowset queries omit (SPEC.md §10.5).
import type { DetailContact } from './components/deal-detail.js';
import { liveTargetRenderers } from './generated/live-targets.js';
import { renderPipelinePage } from './generated/pipeline.js';
import { createCrmDb, type CrmDb } from './db.js';
import { seedCrmDemo } from './demo-data.js';
import { addContact, closeDeal, createDeal, moveDeal } from './mutations.js';
import { contactListQuery, crmQueries, openDealsQuery, pipelineByStageQuery } from './queries.js';
import { activities, contacts, deals } from './schema.js';

// SPEC.md §9.1/§9.5: the CRM example as a FULLY INTERACTIVE Kovo app. It
// registers the addContact / createDeal / moveDeal / closeDeal mutations and
// lets generated live-target renderers refresh visible query-backed regions from
// server truth. The native `enhance` forms POST to `/_m/*`; served by the Node
// server (scripts/serve.mjs), the inline loader morphs the re-rendered region.
// The mutations carry a `guards.authed` guard, so the request gets a demo session
// below.

const crmStylesheets = ['/assets/styles.css'] as const;
const crmStaticDealPaths = [
  '/deals/d1',
  '/deals/d2',
  '/deals/d3',
  '/deals/d4',
  '/deals/d5',
  '/deals/d6',
  '/deals/d7',
  '/deals/d8',
  '/deals/d9',
  '/deals/d10',
] as const;

// The demo viewer attached to every request so the mutations' `guards.authed`
// guard (SPEC.md §6.5) passes. This is a no-auth public demo; the session is a
// fixed stand-in for a logged-in sales rep (owner `u1`, the demo seed owner).
const demoSession = { id: 'demo-session', user: { id: 'u1', roles: ['sales'] as const } };

async function loadContact(db: CrmDb, id: string): Promise<DetailContact | undefined> {
  const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        ownerId: row.ownerId,
        dealCount: row.dealCount,
        company: row.company,
        title: row.title,
      }
    : undefined;
}

export interface CrmInteractiveApp {
  app: ReturnType<typeof createApp>;
  db: CrmDb;
  handler: RequestHandler;
}

export interface BuildCrmInteractiveAppOptions {
  db?: CrmDb;
}

/**
 * Build the interactive CRM app over a (seeded) PGlite database. Pass an existing
 * `db` to share state with an already-rendered shell; otherwise a fresh seeded
 * database is created. The returned handler is what the Node server
 * (scripts/serve.mjs) serves — mutations round-trip natively over PGlite.
 */
export async function buildCrmInteractiveApp(
  options: BuildCrmInteractiveAppOptions = {},
): Promise<CrmInteractiveApp> {
  let db = options.db;
  if (!db) {
    db = await createCrmDb();
    await seedCrmDemo(db);
  }
  const database = db;

  // SPEC.md §5.1: one parameterized detail route (not a route per seeded deal), so
  // deals created at runtime are immediately viewable. The page loads the deal +
  // contact + timeline from PGlite by `params.id`.
  const dealDetailRoute = route('/deals/:id', {
    meta: { description: 'CRM deal detail.', title: 'Deal · Atlas CRM' },
    params: s.object({ id: s.string() }),
    staticPaths: crmStaticDealPaths,
    async page({ params }: { params: { id: string } }) {
      const [row] = await database.select().from(deals).where(eq(deals.id, params.id)).limit(1);
      if (!row) {
        return renderDealDetailPage({
          activities: [],
          contact: undefined,
          deal: {
            id: params.id,
            contactId: 'unknown',
            stage: 'lost',
            amount: 0,
            ownerId: 'system',
            title: 'Unknown deal',
          },
        });
      }
      const contact = await loadContact(database, row.contactId);
      const timeline = await database
        .select()
        .from(activities)
        .where(eq(activities.dealId, row.id))
        .orderBy(asc(activities.id));
      return renderDealDetailPage({
        activities: timeline,
        contact,
        deal: {
          id: row.id,
          contactId: row.contactId,
          stage: row.stage,
          amount: row.amount,
          ownerId: row.ownerId,
          title: row.title,
        },
      });
    },
    stylesheets: crmStylesheets,
  });

  const app = createApp({
    clientModules: createMemoryVersionedClientModuleRegistry(),
    document: { lang: 'en-US' },
    liveTargetRenderers,
    mutations: [addContact, createDeal, moveDeal, closeDeal],
    queries: crmQueries,
    routes: [
      route('/', {
        meta: {
          description: 'Sales pipeline by stage with open deals.',
          title: 'Pipeline · Atlas CRM',
        },
        async page() {
          const [{ buckets }, openDeals, { items: contactItems }] = await Promise.all([
            pipelineByStageQuery.load(undefined, database),
            openDealsQuery.load(undefined, database).then((result) => result.items),
            contactListQuery.load(undefined, database),
          ]);
          return renderPipelinePage({ buckets, contacts: contactItems, openDeals });
        },
        stylesheets: crmStylesheets,
      }),
      route('/contacts', {
        meta: { description: 'The CRM contact book.', title: 'Contacts · Atlas CRM' },
        async page() {
          const { items } = await contactListQuery.load(undefined, database);
          return renderContactsPage({ contacts: items });
        },
        stylesheets: crmStylesheets,
      }),
      dealDetailRoute,
    ],
  });

  const baseHandler = createRequestHandler(app);
  const handler: RequestHandler = (request) => {
    // SPEC.md §11.5: the mutation/query handlers read the Drizzle db off the
    // request; the mutations' `guards.authed` guard reads `request.session`.
    // Attach both before dispatch (mirrors the commerce shell).
    Object.defineProperty(request, 'db', { configurable: true, value: database });
    Object.defineProperty(request, 'session', { configurable: true, value: demoSession });
    return baseHandler(request);
  };

  return { app, db: database, handler };
}
