import { route } from '@kovojs/server';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/app-shell/client-modules';
import { createApp, createRequestHandler } from '@kovojs/server/app-shell/core';
import { toNodeHandler } from '@kovojs/server/app-shell/node';
import { asc, eq } from 'drizzle-orm';

import { renderContactsPage } from './components/contacts.js';
import { renderDealDetailPage } from './components/deal-detail.js';
import { renderPipelinePage } from './components/pipeline.js';
import { createCrmDb, type CrmDb } from './db.js';
import { seedCrmDemo } from './demo-data.js';
import {
  contactListQuery,
  openDealsQuery,
  pipelineByStageQuery,
  type ContactRow,
} from './queries.js';
import { activities, contacts, deals } from './schema.js';

// SPEC.md §9.5: the CRM example's public, read-only static-export shell. It
// replays a real multi-page Kovo app — pipeline dashboard, contact book, and a
// per-deal detail page — over the seeded PGlite database. The mutation +
// derived/custom-optimism story (createDeal, moveDeal, closeDeal …) lives in
// mutations.ts and generated/optimistic/; this shell renders the read side so
// the example is browsable in the docs without a running server.

const crmStylesheets = ['/assets/tailwind.css'] as const;
const clientModules = createMemoryVersionedClientModuleRegistry();

async function loadContact(db: CrmDb, id: string): Promise<ContactRow | undefined> {
  const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        ownerId: row.ownerId,
        dealCount: row.dealCount,
      }
    : undefined;
}

export async function createCrmStaticExportShell(): Promise<{
  app: ReturnType<typeof createApp>;
  db: CrmDb;
}> {
  const db = await createCrmDb();
  await seedCrmDemo(db);

  const allDeals = await db.select().from(deals).orderBy(asc(deals.id));

  const dealRoutes = allDeals.map((deal) =>
    route(`/deals/${deal.id}`, {
      meta: {
        description: `CRM deal ${deal.id} detail.`,
        title: `Deal ${deal.id.toUpperCase()} · Atlas CRM`,
      },
      async page() {
        const contact = await loadContact(db, deal.contactId);
        const timeline = await db
          .select()
          .from(activities)
          .where(eq(activities.dealId, deal.id))
          .orderBy(asc(activities.id));
        return renderDealDetailPage({
          activities: timeline,
          contact,
          deal: {
            id: deal.id,
            contactId: deal.contactId,
            stage: deal.stage,
            amount: deal.amount,
            ownerId: deal.ownerId,
          },
        });
      },
      stylesheets: crmStylesheets,
    }),
  );

  const app = createApp({
    clientModules,
    document: { lang: 'en-US' },
    routes: [
      route('/', {
        meta: {
          description: 'Sales pipeline by stage with open deals.',
          title: 'Pipeline · Atlas CRM',
        },
        async page() {
          const [{ buckets }, openDeals, { items: contactItems }] = await Promise.all([
            pipelineByStageQuery.load(undefined, db),
            openDealsQuery.load(undefined, db).then((result) => result.items),
            contactListQuery.load(undefined, db),
          ]);
          return renderPipelinePage({ buckets, contacts: contactItems, openDeals });
        },
        stylesheets: crmStylesheets,
      }),
      route('/contacts', {
        meta: { description: 'The CRM contact book.', title: 'Contacts · Atlas CRM' },
        async page() {
          const { items } = await contactListQuery.load(undefined, db);
          return renderContactsPage({ contacts: items });
        },
        stylesheets: crmStylesheets,
      }),
      ...dealRoutes,
    ],
  });

  return { app, db };
}

const staticShell = await createCrmStaticExportShell();

export const crmStaticExportApp = staticShell.app;
export const crmStaticExportDb = staticShell.db;

// A node handler over the same read-only app, so `pnpm start` / the dev server
// can serve the multi-page UI live (dealList anchors the deal domain import).
export const crmNodeHandler = toNodeHandler(createRequestHandler(crmStaticExportApp));

export default crmStaticExportApp;
