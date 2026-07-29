// App factory + vite mount plugin. createDevtoolApp builds a self-contained Kovo
// app over a set of prebuilt bundles: it inlines the stylesheet and the two web
// fonts (base64) and registers the pan/zoom island as a /c/ client module, so a
// host needs to serve nothing but the handler. Mount it at '/' (own server) or
// under a prefix via devtoolMountPlugin. The host entry must install
// @kovojs/server/runtime-bootstrap before importing this app factory.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { defineKovo } from '@kovojs/server';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/client-modules';
import { createRequestHandler } from '@kovojs/server/custom-adapters';
import { toNodeHandler } from '@kovojs/server/node';

import { renderPage } from './render.mjs';
import { renderStyleElement } from './output-security.mjs';
import {
  createRuntimeFrameStore,
  RUNTIME_FRAME_STREAM_PATH,
  runtimeFrameSseResponse,
} from './runtime-frames.mjs';

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
 * @param {{ bundles: any[], base?: string, mode?: 'development'|'production', runtimeFrames?: ReturnType<typeof createRuntimeFrameStore> }} options — bundles from buildBundle().
 * @returns {{ app, requestHandler, nodeHandler, manifest, base, runtimeFrames?: ReturnType<typeof createRuntimeFrameStore> }}
 */
export function createDevtoolApp({
  bundles,
  base = process.env.KOVO_DEVTOOL_BASE ?? '',
  mode = process.env.NODE_ENV === 'development' ? 'development' : 'production',
  runtimeFrames,
}) {
  if (!bundles?.length) throw new Error('createDevtoolApp: at least one bundle is required.');
  if (mode !== 'development' && mode !== 'production') {
    throw new Error('createDevtoolApp: mode must be development or production.');
  }
  if (process.env.NODE_ENV === 'production' && mode === 'development') {
    throw new Error('createDevtoolApp: live runtime capture is unavailable in production.');
  }
  const css = fontFaceCss() + readFileSync(join(HERE, 'styles.css'), 'utf8');
  const styleElement = renderStyleElement(css);

  const clientModules = createMemoryVersionedClientModuleRegistry();
  const pzHref = clientModules.put({
    path: '/c/devtool-pz.client.js',
    source: readFileSync(join(HERE, 'client', 'devtool-pz.client.js'), 'utf8'),
  });
  const liveFrames =
    mode === 'development' ? (runtimeFrames ?? createRuntimeFrameStore()) : undefined;
  const runtimeHref =
    liveFrames === undefined
      ? undefined
      : clientModules.put({
          path: '/c/devtool-runtime.client.js',
          source: readFileSync(join(HERE, 'client', 'devtool-runtime.client.js'), 'utf8'),
        });

  const byApp = new Map(bundles.map((b) => [b.app, b]));
  const manifest = bundles.map((b) => ({ id: b.app, label: b.label, blurb: b.blurb ?? '' }));

  const devtoolApp = defineKovo({
    clientModules,
    db: () => ({}),
    document: { lang: 'en' },
  });
  const homeRoute = devtoolApp.route('/', {
    access: devtoolApp.publicAccess('local development graph inspection'),
    meta: {
      description:
        'Trace dataflow across a Kovo app — queries in, mutations out — with source previews.',
      title: 'Kovo Dataflow Devtools',
    },
    page(context) {
      const wanted = str(context.search.app);
      const app = wanted && byApp.has(wanted) ? wanted : manifest[0].id;
      return (
        styleElement +
        renderPage({
          manifest,
          bundle: byApp.get(app),
          app,
          sel: str(context.search.sel),
          q: str(context.search.q),
          pzHref: base + pzHref,
          runtime:
            liveFrames === undefined
              ? undefined
              : {
                  frames: liveFrames.recent({ app, limit: Math.min(8, liveFrames.limit) }),
                  href: base + RUNTIME_FRAME_STREAM_PATH,
                  moduleHref: base + runtimeHref,
                },
        })
      );
    },
  });

  const app = devtoolApp.assemble({
    routes: [homeRoute],
  });
  const appRequestHandler = createRequestHandler(app);
  const requestHandler = (request) => {
    if (liveFrames !== undefined) {
      const url = new URL(request.url);
      if (url.pathname === RUNTIME_FRAME_STREAM_PATH) {
        const wanted = url.searchParams.get('app') ?? manifest[0].id;
        if (!byApp.has(wanted)) {
          return Promise.resolve(
            new Response('Unknown devtool app.\n', {
              headers: { 'Cache-Control': 'no-store' },
              status: 404,
            }),
          );
        }
        return Promise.resolve(
          runtimeFrameSseResponse({ app: wanted, request, store: liveFrames }),
        );
      }
    }
    return appRequestHandler(request);
  };
  return {
    app,
    base,
    manifest,
    nodeHandler: toNodeHandler(requestHandler),
    requestHandler,
    runtimeFrames: liveFrames,
  };
}
