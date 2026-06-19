import { toNodeHandler } from '@kovojs/server';

// Serve the COMPILER-LOWERED route (generated/interactive-app.kovo-route): the
// lowered components carry the static `kovo-fragment-target` region wrappers the
// inline loader morphs against. The source `./interactive-app.js` route renders
// the same UI but the runtime `component()` wrapper does not emit those region
// attributes into the full GET document, so enhance morphs would have no target.
import { buildSoInteractiveApp } from './interactive-app.generated-fixtures.js';

// SPEC.md §9.1/§9.5: the Stack Overflow example app shell. It builds the FULLY
// INTERACTIVE multi-page Kovo app (a ranked question list with upvote + ask
// forms, and per-question detail with upvote + answer forms) over a seeded
// PGlite database, and serves it as a regular Node server (scripts/serve.mjs →
// soNodeHandler). The native `enhance` server-action forms POST to the mutation
// endpoints; the inline loader morphs the re-rendered fragment wire.

const interactive = await buildSoInteractiveApp();

export const soApp = interactive.app;
export const soDb = interactive.db;

// The Node handler over the interactive app (db attached so mutations work), used
// by scripts/serve.mjs and the Vite dev plugin.
export const soNodeHandler = toNodeHandler(interactive.handler);

export default soApp;
