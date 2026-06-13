import { createMemoryVersionedClientModuleRegistry } from '@jiso/server/app-shell/client-modules';
import { createApp, createRequestHandler } from '@jiso/server/app-shell/core';
import { route } from '@jiso/server';
import { App } from './app.js';

const clientModules = createMemoryVersionedClientModuleRegistry();
const starterStylesheetHref = process.env.JISO_STARTER_STYLESHEET_HREF ?? '/src/styles.css';

export const starterClientModuleHref = clientModules.put({
  path: '/c/starter.client.js',
  source: [
    'export function Starter$announce(event, ctx) {',
    '  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : event.target;',
    '  const root = target instanceof HTMLElement ? target.closest(\'[fw-c="app-root"]\') : null;',
    '  const output = root ? root.querySelector("#starter-status") : null;',
    '  const state = typeof ctx.state === "object" && ctx.state !== null ? ctx.state : {};',
    '  const clicks = typeof state.clicks === "number" ? state.clicks + 1 : 1;',
    '  state.clicks = clicks;',
    '  ctx.state = state;',
    '  if (output) output.textContent = `Handled ${clicks} interaction${clicks === 1 ? "" : "s"} through /c/.`;',
    '}',
    '',
  ].join('\n'),
  version: 'starter-r7',
});

export const homeRoute = route('/', {
  meta: {
    description: 'A routed Jiso starter served through the app shell.',
    title: 'Jiso Starter',
  },
  modulepreloads: [starterClientModuleHref],
  page() {
    return App.definition.render();
  },
  stylesheets: [starterStylesheetHref],
});

export const app = createApp({
  clientModules,
  document: { lang: 'en' },
  routes: [homeRoute],
});

export const starterRequestHandler = createRequestHandler(app);
export default app;
