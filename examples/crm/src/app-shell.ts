import { toNodeHandler } from '@kovojs/server/app-shell/node';

import { buildCrmInteractiveApp } from './generated/interactive-app.kovo-route.js';

// Interactive CRM app shell over a seeded PGlite database. Forms post to the
// mutation endpoints and refresh the affected page regions.

const interactive = await buildCrmInteractiveApp();

export const crmApp = interactive.app;
export const crmDb = interactive.db;

// Used by scripts/serve.mjs and the Vite dev plugin.
export const crmNodeHandler = toNodeHandler(interactive.handler);

export default crmApp;
