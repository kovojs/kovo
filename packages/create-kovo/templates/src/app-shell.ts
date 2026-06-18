import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  layout,
  route,
} from '@kovojs/server';
import { App, starterAppStyleCss } from './app.js';

const clientModules = createMemoryVersionedClientModuleRegistry();
const starterStylesheetHref = process.env.KOVO_STARTER_STYLESHEET_HREF ?? '/src/styles.css';

export interface StarterDb {
  cartCount: number;
}

export interface StarterSession {
  user: {
    id: string;
    roles: readonly string[];
  };
}

export interface StarterRequest {
  db: StarterDb;
  session?: StarterSession | null;
}

export const starterDb: StarterDb = { cartCount: 0 };

export function starterSessionProvider(): StarterSession {
  return { user: { id: 'starter-user', roles: ['member'] } };
}

export const starterClientModuleHref = clientModules.put({
  path: '/c/starter.client.js',
  source: [
    'export function Starter$announce(event, ctx) {',
    '  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : event.target;',
    '  const root = target instanceof HTMLElement ? target.closest(\'[kovo-c="app-root"]\') : null;',
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

export const starterLayout = layout<StarterRequest>({
  render: (_queries, _state, { children, request }) =>
    `<div data-session="${request.session?.user.id ?? 'guest'}">${children}</div>`,
});

export const homeRoute = route('/', {
  layout: starterLayout,
  meta: {
    description: 'A routed Kovo starter served through the app shell.',
    title: 'Kovo Starter',
  },
  modulepreloads: [starterClientModuleHref],
  page(_context, request: StarterRequest) {
    return App.definition.render({ cartCount: request.db.cartCount });
  },
  stylesheets: [{ href: starterStylesheetHref, criticalCss: starterAppStyleCss }],
});

export const app = createApp({
  clientModules,
  db: () => starterDb,
  document: { lang: 'en' },
  routes: [homeRoute],
});

export const dynamicApp = createApp({
  clientModules,
  db: () => starterDb,
  document: { lang: 'en' },
  routes: [homeRoute],
  sessionProvider: starterSessionProvider,
});

export const starterRequestHandler = createRequestHandler(app);
export default app;
