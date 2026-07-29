/** @jsxImportSource @kovojs/server */
import { s } from '@kovojs/server';

import { ContactsRegion } from './components/contacts.js';
import { DealDetailRegion } from './components/deal-detail.js';
import { PipelineRegion } from './components/pipeline.js';
import { CrmShell } from './components/chrome.js';
import { app, crmStylesheets, resetCrmDatabase } from './kovo.js';
import { addContact, closeDeal, createDeal, moveDeal } from './mutations.js';
import {
  activityListQuery,
  contactDealCountQuery,
  contactListQuery,
  dealListQuery,
  openDealsQuery,
  pipelineByStageQuery,
} from './queries.js';

// Interactive CRM app: pipeline, contacts, and deal detail pages backed by the
// demo database. Forms post to `/_m/*` and refresh query-backed regions.

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

// Every CRM route shows the seeded owner's pipeline/contacts, so the layouts carry
// the session-presence guard each child route inherits as its access decision (KV436,
// SPEC §10.2). The guarded mutations already require the same session.
const PipelineLayout = app.layout({
  access: [app.authenticated],
  render: (_queries, _state, { children }) => <CrmShell active="pipeline">{children}</CrmShell>,
});

const ContactsLayout = app.layout({
  access: [app.authenticated],
  render: (_queries, _state, { children }) => <CrmShell active="contacts">{children}</CrmShell>,
});

/**
 * One parameterized detail route keeps newly created deals viewable.
 */
const dealDetailRoute = app.route('/deals/:id', {
  access: [app.authenticated],
  meta: { description: 'CRM deal detail.', title: 'Deal · Atlas CRM' },
  params: s.object({ id: s.string() }),
  staticPaths: crmStaticDealPaths,
  page({ params }) {
    return <DealDetailRegion dealId={params.id} />;
  },
  layout: PipelineLayout,
  stylesheets: crmStylesheets,
});

const pipelineRoute = app.route('/', {
  access: [app.authenticated],
  meta: {
    description: 'Sales pipeline by stage with open deals.',
    title: 'Pipeline · Atlas CRM',
  },
  page() {
    return <PipelineRegion />;
  },
  layout: PipelineLayout,
  stylesheets: crmStylesheets,
});

const contactsRoute = app.route('/contacts', {
  access: [app.authenticated],
  meta: { description: 'The CRM contact book.', title: 'Contacts · Atlas CRM' },
  page() {
    return <ContactsRegion />;
  },
  layout: ContactsLayout,
  stylesheets: crmStylesheets,
});

export const crmApp = app.assemble({
  layouts: [PipelineLayout, ContactsLayout],
  mutations: [addContact, createDeal, moveDeal, closeDeal],
  queries: [
    contactListQuery,
    dealListQuery,
    contactDealCountQuery,
    openDealsQuery,
    pipelineByStageQuery,
    activityListQuery,
  ],
  routes: [pipelineRoute, contactsRoute, dealDetailRoute],
});

/**
 * Reset the direct-development/test database and return the already-closed app token.
 *
 * Public demo requests carry a dispatcher-owned session header, so their lazy databases remain
 * isolated without rebuilding declarations or assembling a second graph.
 */
export async function buildCrmInteractiveApp() {
  const db = await resetCrmDatabase();
  return { app: crmApp, db };
}
