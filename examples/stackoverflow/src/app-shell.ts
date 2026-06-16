import { toNodeHandler } from '@kovojs/server/app-shell/node';

import { buildSoInteractiveApp } from './interactive-app.js';

// SPEC.md §9.5: the Stack Overflow example's public static-export shell. It
// replays the FULLY INTERACTIVE multi-page Kovo app (a ranked question list with
// upvote forms + per-question detail) over a seeded PGlite database, and wires an
// `on:load` host that boots the in-browser backend (browser-backend.ts). So the
// shipped static export is not a read-only snapshot: clicking upvote runs the
// real voteUp mutation against an in-browser PGlite and morphs the fragment —
// the postQuestion / postAnswer / voteUp + DERIVED-optimism story, live, with no
// server. The same app serves `pnpm start` / the dev server via soNodeHandler.

// Stable URL of the Vite-bundled in-browser backend (see vite.config.ts
// entryFileNames). The page wraps its body in `on:load="<href>#installBackend"`.
const BACKEND_MODULE_HREF = '/assets/browser-backend.js';

const interactive = await buildSoInteractiveApp({ backendModuleHref: BACKEND_MODULE_HREF });

export const soStaticExportApp = interactive.app;
export const soStaticExportDb = interactive.db;

// A node handler over the same interactive app (the db-attaching handler, so
// mutations work), for `pnpm start` / the dev server.
export const soNodeHandler = toNodeHandler(interactive.handler);

export default soStaticExportApp;
