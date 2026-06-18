// App factory + vite mount plugin. createDevtoolApp builds a self-contained Kovo
// app over a set of prebuilt bundles: it inlines the stylesheet and the two web
// fonts (base64) and registers the pan/zoom island as a /c/ client module, so a
// host needs to serve nothing but the handler. Mount it at '/' (own server) or
// under a prefix via devtoolMountPlugin.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  route,
  toNodeHandler,
} from '@kovojs/server';

import { renderPage } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function fontFaceCss() {
  const font = (family, file, weights) => {
    const b64 = readFileSync(join(HERE, 'assets', 'fonts', file)).toString('base64');
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weights};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  };
  return (
    font('Inter', 'inter-latin-wght-normal.woff2', '100 900') +
    font('JetBrains Mono', 'jetbrains-mono-latin-wght-normal.woff2', '100 800')
  );
}

const str = (v) => {
  if (typeof v === 'string' && v.length) return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
};

/**
 * @param {{ bundles: any[], base?: string }} options — bundles from buildBundle().
 * @returns {{ app, requestHandler, nodeHandler, manifest, base }}
 */
export function createDevtoolApp({ bundles, base = process.env.KOVO_DEVTOOL_BASE ?? '' }) {
  if (!bundles?.length) throw new Error('createDevtoolApp: at least one bundle is required.');
  const css = fontFaceCss() + readFileSync(join(HERE, 'styles.css'), 'utf8');

  const clientModules = createMemoryVersionedClientModuleRegistry();
  const pzHref = clientModules.put({
    path: '/c/devtool-pz.client.js',
    source: readFileSync(join(HERE, 'client', 'devtool-pz.client.js'), 'utf8'),
    version: 'pz-r1',
  });

  const byApp = new Map(bundles.map((b) => [b.app, b]));
  const manifest = bundles.map((b) => ({ id: b.app, label: b.label, blurb: b.blurb ?? '' }));

  const homeRoute = route('/', {
    meta: {
      description:
        'Trace dataflow across a Kovo app — queries in, mutations out — with source previews.',
      title: 'Kovo Dataflow Devtools',
    },
    page(context) {
      const wanted = str(context.search.app);
      const app = wanted && byApp.has(wanted) ? wanted : manifest[0].id;
      return renderPage({
        manifest,
        bundle: byApp.get(app),
        app,
        sel: str(context.search.sel),
        q: str(context.search.q),
        pzHref: base + pzHref,
        css,
      });
    },
  });

  const app = createApp({
    clientModules,
    db: () => ({}),
    document: { lang: 'en' },
    routes: [homeRoute],
  });
  const requestHandler = createRequestHandler(app);
  return { app, requestHandler, nodeHandler: toNodeHandler(requestHandler), manifest, base };
}
