import { toNodeHandler } from '@kovojs/server/app-shell/node';

import { buildCrmInteractiveApp } from './generated/interactive-app.kovo-route.js';

// SPEC.md §9.1/§9.5: the CRM example app shell. It builds the FULLY INTERACTIVE
// multi-page Kovo app (a pipeline dashboard with a new-deal form, a contact book
// with an add-contact form, and per-deal detail with move-stage + close-won
// actions) over a seeded PGlite database, and serves it as a regular Node server
// (scripts/serve.mjs → crmNodeHandler). The native `enhance` server-action forms
// POST to the mutation endpoints; the inline loader morphs the re-rendered
// fragment wire. No static export, no in-browser DB — just the app served the
// regular way. The mutation + derived/custom-optimism story (createDeal, moveDeal,
// closeDeal …) lives in mutations.ts and generated/optimistic/.

const interactive = await buildCrmInteractiveApp();

export const crmStaticExportApp = interactive.app;
export const crmStaticExportDb = interactive.db;

// The Node handler over the interactive app (db + demo session attached so
// mutations work), used by scripts/serve.mjs and the Vite dev plugin.
export const crmNodeHandler = toNodeHandler(interactive.handler);

export default crmStaticExportApp;
