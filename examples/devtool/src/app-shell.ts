import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createApp, createMemoryVersionedClientModuleRegistry, createRequestHandler, route } from '@kovojs/server';

import { renderPage } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

// Pan/zoom/hover enhancement island, registered as a versioned /c/ client module.
const clientModules = createMemoryVersionedClientModuleRegistry();
const pzHref = clientModules.put({
  path: '/c/devtool-pz.client.js',
  source: readFileSync(join(HERE, 'devtool-pz.client.js'), 'utf8'),
  version: 'pz-r1',
});

const manifest: { id: string; label: string; blurb: string }[] = JSON.parse(
  readFileSync(join(DATA, 'manifest.json'), 'utf8'),
);
const criticalCss = readFileSync(join(HERE, 'styles.css'), 'utf8');

const bundleCache = new Map<string, any>();
function loadBundle(appId: string): any {
  if (!bundleCache.has(appId)) {
    bundleCache.set(appId, JSON.parse(readFileSync(join(DATA, `${appId}.json`), 'utf8')));
  }
  return bundleCache.get(appId);
}

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string' && v.length) return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
};

export interface DevtoolRequest {
  db: Record<string, never>;
}

export const homeRoute = route('/', {
  meta: {
    description: 'Trace dataflow across a Kovo app — queries in, mutations out — with source previews.',
    title: 'Kovo Dataflow Devtools',
  },
  page(context: { search: Record<string, unknown> }) {
    const known = new Set(manifest.map((m) => m.id));
    const app = str(context.search.app) && known.has(str(context.search.app)!)
      ? str(context.search.app)!
      : manifest[0]?.id ?? 'commerce';
    const bundle = loadBundle(app);
    return renderPage({ manifest, bundle, app, sel: str(context.search.sel), q: str(context.search.q), pzHref });
  },
  modulepreloads: [pzHref],
  stylesheets: [{ href: '/src/styles.css', criticalCss }],
});

export const app = createApp({
  clientModules,
  db: () => ({}),
  document: { lang: 'en' },
  routes: [homeRoute],
});

export const requestHandler = createRequestHandler(app);
export default app;
