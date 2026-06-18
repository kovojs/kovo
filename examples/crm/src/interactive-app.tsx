/** @jsxImportSource @kovojs/server */
import { layout, renderComponentMutationFailure, route, s } from '@kovojs/server';
import { createApp, createRequestHandler } from '@kovojs/server/app-shell/core';
import type { RequestHandler } from '@kovojs/server/app-shell/core';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/app-shell/client-modules';

import { ContactsRegion } from './components/contacts.js';
import { DealDetailRegion } from './components/deal-detail.js';
import { PipelineRegion } from './components/pipeline.js';
import { CrmShell } from './components/chrome.js';
import { createCrmDb, type CrmDb } from './db.js';
import { seedCrmDemo } from './demo-data.js';
import { addContact, closeDeal, createDeal, moveDeal, type CrmRequest } from './mutations.js';
import { contactListQuery } from './queries.js';

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

const PipelineLayout = layout({
  render: (_queries, _state, { children }) => <CrmShell active="pipeline">{children}</CrmShell>,
});

const ContactsLayout = layout({
  render: (_queries, _state, { children }) => <CrmShell active="contacts">{children}</CrmShell>,
});

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
  // deals created at runtime are immediately viewable. SPEC.md §9.5 route JSX
  // composition lets the component query declarations load the deal, contact,
  // and timeline from PGlite by `params.id`.
  const dealDetailRoute = route('/deals/:id', {
    meta: { description: 'CRM deal detail.', title: 'Deal · Atlas CRM' },
    params: s.object({ id: s.string() }),
    staticPaths: crmStaticDealPaths,
    page({ params }: { params: { id: string } }) {
      return <DealDetailRegion dealId={params.id} />;
    },
    layout: PipelineLayout,
    stylesheets: crmStylesheets,
  });

  const app = createApp({
    clientModules: createMemoryVersionedClientModuleRegistry(),
    db: () => database,
    document: { lang: 'en-US' },
    mutations: [addContact, createDeal, moveDeal, closeDeal],
    mutationResponses: {
      [addContact.key]: ({ request }) => ({
        failureTarget: 'contacts-region',
        renderFailureFragment: async (failure) =>
          renderComponentMutationFailure(
            ContactsRegion,
            {
              contactList: await contactListQuery.load(undefined, {
                request: request as CrmRequest,
              }),
            },
            failure,
            {
              formName: 'addContact',
              slots: { request: request as CrmRequest },
            },
          ),
      }),
    },
    routes: [
      route('/', {
        meta: {
          description: 'Sales pipeline by stage with open deals.',
          title: 'Pipeline · Atlas CRM',
        },
        page() {
          return <PipelineRegion />;
        },
        layout: PipelineLayout,
        stylesheets: crmStylesheets,
      }),
      route('/contacts', {
        meta: { description: 'The CRM contact book.', title: 'Contacts · Atlas CRM' },
        page() {
          return <ContactsRegion />;
        },
        layout: ContactsLayout,
        stylesheets: crmStylesheets,
      }),
      dealDetailRoute,
    ],
    sessionProvider: () => demoSession,
  });

  const handler: RequestHandler = createRequestHandler(app);

  return { app, db: database, handler };
}
