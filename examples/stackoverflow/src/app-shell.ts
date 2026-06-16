import { toNodeHandler } from '@kovojs/server/app-shell/node';

import { buildSoInteractiveApp } from './interactive-app.js';

// SPEC.md §9.1/§9.5: the Stack Overflow example app shell. It builds the FULLY
// INTERACTIVE multi-page Kovo app (a ranked question list with upvote + ask
// forms, and per-question detail with upvote + answer forms) over a seeded
// PGlite database, and serves it as a regular Node server (scripts/serve.mjs →
// soNodeHandler). The native `enhance` server-action forms POST to the mutation
// endpoints; the inline loader morphs the re-rendered fragment wire. No static
// export, no in-browser DB — just the app served the regular way.

const interactive = await buildSoInteractiveApp();

export const soStaticExportApp = interactive.app;
export const soStaticExportDb = interactive.db;

// The Node handler over the interactive app (db attached so mutations work), used
// by scripts/serve.mjs and the Vite dev plugin.
export const soNodeHandler = toNodeHandler(interactive.handler);

export default soStaticExportApp;
