import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  nodeRequestToWebRequest,
  route,
  writeWebResponseToNode,
} from '@jiso/server';
import type { IncomingMessage, ServerResponse } from 'node:http';
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
export async function starterNodeHandler(
  nodeRequest: IncomingMessage,
  nodeResponse: ServerResponse,
  next?: (error?: unknown) => void,
): Promise<void> {
  try {
    const request = nodeRequestToWebRequest(nodeRequest);
    const response = await starterRequestHandler(request);
    const writeEarlyHints = nodeResponse.writeEarlyHints;
    // SPEC.md section 9.5 uses one request shell for dev and export. The starter
    // dev middleware keeps final Link headers while suppressing optional early
    // hints so Node-version differences cannot break vp dev.
    nodeResponse.writeEarlyHints = ((_hints: unknown, callback?: () => void) => {
      callback?.();
    }) as ServerResponse['writeEarlyHints'];

    try {
      await writeWebResponseToNode(response, nodeResponse, request.method);
    } finally {
      nodeResponse.writeEarlyHints = writeEarlyHints;
    }
  } catch (error) {
    if (next) {
      next(error);
      return;
    }

    throw error;
  }
}

export default app;
