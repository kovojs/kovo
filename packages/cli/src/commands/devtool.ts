/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';

import type { KovoApp } from '@kovojs/server/internal/build';
import type { Plugin, ViteDevServer } from 'vite-plus';

import { buildBundle, renderPage } from '../../../devtool/src/index.js';
import { Devtool$init } from '../../../devtool/src/client/devtool-pz.client.js';
import {
  buildArrayIsArray,
  buildObjectKeys,
  buildOwnDataValue,
  buildSecurityArrayAppend,
} from './build-security-intrinsics.js';

const NativeAbortController = globalThis.AbortController;
const NativeConsole = globalThis.console;
const NativeFunction = globalThis.Function;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeSet = globalThis.Set;
const nativeFunctionToString = NativeFunction.prototype.toString;
const nativeConsoleError = NativeConsole.error;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeReflectApply = NativeReflect.apply;
const nativeReflectGet = NativeReflect.get;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringSlice = globalThis.String.prototype.slice;

const DEVTOOL_PATH = '/__kovo';
const DEVTOOL_CLIENT_PATH = '/__kovo/client.js';
const DEVTOOL_APP_ID = 'app';
const MAX_DEVTOOL_QUERY_LENGTH = 512;
const MAX_DEVTOOL_REGISTRY_ENTRIES = 50_000;

// Function source is an operational bundling bridge for the private dev-only island, never
// framework identity or security provenance. Assign it to a stable client-local name because a
// production packer may rename the original binding.
const DEVTOOL_CLIENT_SOURCE =
  `const kovoDevtoolInit = ${nativeReflectApply(nativeFunctionToString, Devtool$init, [])};\n` +
  `kovoDevtoolInit(undefined, { signal: new AbortController().signal });\n`;

/*
 * The reusable renderer normally receives the package's full stylesheet from createDevtoolApp().
 * `kovo dev` bundles the renderer into the CLI, so this compact mount-owned sheet keeps the packed
 * CLI self-contained without publishing the private devtool package or reading repository files at
 * runtime. The graph model, renderer, source slices, and pan/zoom island remain the single
 * @kovojs/devtool implementations.
 */
const DEVTOOL_STYLES = `
:root{--bg:#060606;--panel:#0c0c0c;--panel-2:#101010;--panel-3:#161616;--edge:#242424;--edge-soft:#191919;--ink:#f2f2f2;--dim:#a1a1aa;--faint:#60606a;--teal:#2dd4bf;--green:#4ade80;--red:#ff6b6b;--sky:#7cc5ff;--amber:#fbbf24;--purple:#c792ea;--mutation:var(--amber);--domain:var(--green);--query:var(--sky);--component:var(--purple);--page:var(--teal);--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:dark}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);overflow:hidden}.app{display:grid;grid-template-rows:54px 1fr;height:100vh}.topbar{align-items:center;background:var(--bg);border-bottom:1px solid var(--edge);display:flex;gap:20px;padding:0 18px;z-index:10}.brand{align-items:center;display:flex;gap:9px}.brand-mark{background:var(--teal);border-radius:1px;height:12px;transform:rotate(45deg);width:12px}.brand-name{font-size:15px;font-weight:750}.brand-sub{border-left:1px solid var(--edge);color:var(--dim);font:11px var(--mono);letter-spacing:.12em;margin-left:1px;padding-left:11px;text-transform:uppercase}.spacer{flex:1}.apps{align-items:center;display:flex;gap:4px}.app-tab{border:1px solid transparent;border-radius:3px;color:var(--dim);display:inline-flex;flex-direction:column;padding:5px 11px;text-decoration:none}.app-tab b{font-size:12.5px}.app-tab small{color:var(--faint);font:9.5px var(--mono)}.app-tab[aria-current=true]{background:var(--panel);border-color:var(--edge)}.app-tab[aria-current=true] b{color:var(--teal)}
.search{align-items:center;background:var(--panel);border:1px solid var(--edge);border-radius:3px;display:flex;gap:8px;height:34px;padding:0 9px;position:relative;width:min(420px,38vw)}.search:focus-within{border-color:var(--teal)}.search svg{color:var(--faint);height:14px;width:14px}.search input{background:none;border:0;color:var(--ink);flex:1;font:13px var(--sans);min-width:0;outline:0}.search input::placeholder{color:var(--faint)}.search kbd,.chip{background:var(--panel-3);border:1px solid var(--edge);border-radius:3px;color:var(--dim);font:10px var(--mono);padding:2px 7px}.results{background:var(--panel);border:1px solid var(--edge);box-shadow:0 24px 60px #000a;left:0;position:absolute;right:0;top:41px;z-index:20}.results-head{border-bottom:1px solid var(--edge-soft);color:var(--faint);display:flex;font:10px var(--mono);justify-content:space-between;padding:7px 12px;text-transform:uppercase}.result{align-items:center;border-bottom:1px solid var(--edge-soft);color:var(--ink);display:flex;gap:10px;padding:9px 12px;text-decoration:none}.result:hover{background:var(--panel-2)}.result .dot{height:7px;width:7px}.result .matched{color:var(--teal);font:10px var(--mono)}.result .score{color:var(--faint);font:11px var(--mono);margin-left:auto}
.stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,400px);min-height:0}.canvas-wrap{align-items:safe center;display:flex;justify-content:safe center;overflow:auto;position:relative}.canvas,.pz{position:relative}.pz{height:100%;width:100%}.lane-headers{left:0;pointer-events:none;position:absolute;top:0;width:100%;z-index:5}.lane-head{position:absolute;text-align:center;transform:translateX(-50%)}.lane-head .glyph{font-size:11px}.lane-head .name{display:block;font:600 10px var(--mono);letter-spacing:.14em;margin-top:3px;text-transform:uppercase}.lane-head .blurb{color:var(--faint);display:block;font:9px var(--mono)}.edges{inset:0;overflow:visible;pointer-events:none;position:absolute}.edges path{fill:none;stroke-width:1.5px}.edges path.dim{stroke-opacity:.06!important}.edges path.active,.edges path.hov{stroke-opacity:.95!important;stroke-width:2px}
.node{background:var(--panel);border:1px solid var(--edge);border-radius:3px;color:var(--ink);display:flex;flex-direction:column;gap:3px;justify-content:center;overflow:hidden;padding:8px 12px 8px 13px;position:absolute;text-decoration:none;transition:.15s}.node:before{background:var(--accent);bottom:0;content:"";left:0;position:absolute;top:0;width:2px}.node .label{align-items:center;display:flex;font-size:13px;font-weight:650;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.node .glyph{color:var(--accent);font-size:10px}.node .sub{color:var(--dim);font:10px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.node:hover,.node.sel,.node.hov{background:var(--panel-2);border-color:var(--accent)}.node.sel{box-shadow:inset 0 0 0 1px var(--accent)}.node.dim{opacity:.22}.node.hit{border-color:var(--teal)}.node--mutation{--accent:var(--mutation)}.node--domain{--accent:var(--domain)}.node--query{--accent:var(--query)}.node--component{--accent:var(--component)}.node--page{--accent:var(--page)}
.inspector{background:var(--panel);border-left:1px solid var(--edge);overflow-y:auto}.insp-head{background:var(--panel);border-bottom:1px solid var(--edge);padding:18px 20px 14px;position:sticky;top:0;z-index:2}.insp-kind{color:var(--accent,var(--dim));font:600 10px var(--mono);letter-spacing:.14em;text-transform:uppercase}.insp-title{font-size:19px;font-weight:750;margin:7px 0 3px;word-break:break-word}.insp-meta{color:var(--faint);font:11px var(--mono)}.insp-body{padding:4px 20px 40px}.section{border-bottom:1px solid var(--edge-soft);padding:16px 0 4px}.section>h3{align-items:center;color:var(--faint);display:flex;font:600 10px var(--mono);gap:8px;letter-spacing:.14em;margin:0 0 11px;text-transform:uppercase}.flowrow{align-items:center;background:var(--panel-2);border:1px solid var(--edge-soft);border-radius:3px;color:var(--ink);display:flex;gap:9px;margin-bottom:6px;padding:9px 11px;text-decoration:none}.flowrow:hover{border-color:var(--accent)}.flowrow .dot{background:var(--accent);height:8px;width:8px}.flowrow .name{font-size:13px;font-weight:650}.flowrow .right{align-items:center;display:flex;gap:5px;margin-left:auto}.chip--domain{color:var(--green)}.badge{border:1px solid var(--edge);border-radius:3px;font:10px var(--mono);padding:2px 8px}.badge--derived{color:var(--green)}.badge--hand-written{color:var(--sky)}.badge--await-fragment{color:var(--amber)}.badge--punted{color:var(--red)}.badge--none{color:var(--faint)}.kv{display:flex;flex-wrap:wrap;gap:6px}
.code{background:#000;border:1px solid var(--edge);margin-top:4px}.code-head{align-items:center;border-bottom:1px solid var(--edge);color:var(--faint);display:flex;font:10.5px var(--mono);gap:8px;padding:8px 12px}.code-head .lines{margin-left:auto}.code-head .lang{color:var(--teal)}pre.src{font:12px/1.7 var(--mono);margin:0;overflow-x:auto;padding:12px 0}pre.src .ln{display:grid;grid-template-columns:40px 1fr}pre.src .gut{border-right:1px solid var(--edge-soft);color:var(--faint);padding-right:12px;text-align:right}pre.src .cd{color:#d6d6d6;padding-left:14px;white-space:pre}pre.src .ln.anchor{background:#2dd4bf14}.t-key{color:#ff7b72}.t-str{color:#a5d6ff}.t-com{color:#8b949e}.t-num{color:#79c0ff}.t-fn{color:#d2a8ff}.t-type{color:#ffa657}.t-tag{color:#7ee787}
.touch{align-items:center;background:var(--panel-2);border:1px solid var(--edge-soft);display:flex;font:10.5px var(--mono);gap:8px;margin-bottom:6px;padding:7px 10px}.touch .via{color:var(--amber)}.touch .site{color:var(--faint);margin-left:auto}.hint,.legend,.zoom{background:var(--panel);border:1px solid var(--edge);bottom:16px;position:absolute;z-index:6}.hint{bottom:20px;color:var(--dim);font:11px var(--mono);left:50%;padding:7px 15px;transform:translateX(-50%)}.legend{display:flex;gap:14px;left:16px;padding:7px 13px}.legend .k{align-items:center;color:var(--dim);display:flex;font:10px var(--mono);gap:6px}.legend .sw{height:8px;width:8px}.zoom{display:flex;gap:6px;right:16px}.zoom button{background:var(--panel);border:0;border-left:1px solid var(--edge);color:var(--dim);cursor:pointer;font-size:15px;height:30px;width:30px}.zoom button:first-child{border-left:0}.zoom button:hover{color:var(--teal)}
@media(max-width:900px){.stage{grid-template-columns:1fr}.inspector{border-left:0;border-top:1px solid var(--edge);max-height:42vh}.search{width:min(360px,50vw)}.apps{display:none}}
`;

export interface KovoDevtoolPluginOptions {
  appShellModuleId: string;
  appModuleId: string;
  appModulePath: string;
  debug: boolean;
  securityProfileModuleId: string;
  serverBuildModuleId: string;
}

/** @internal Framework-owned, Vite-dev-only mount for the reusable Kovo dataflow renderer. */
export function createKovoDevtoolPlugin(options: KovoDevtoolPluginOptions): Plugin {
  let cachedBundle: Promise<ReturnType<typeof buildBundle>> | undefined;
  const loadBundle = (
    server: Pick<ViteDevServer, 'ssrLoadModule'>,
  ): Promise<ReturnType<typeof buildBundle>> => {
    if (cachedBundle !== undefined) return cachedBundle;
    const pending = buildKovoDevtoolBundle(server, options);
    cachedBundle = pending;
    void pending.catch(() => {
      if (cachedBundle === pending) cachedBundle = undefined;
    });
    return pending;
  };

  return {
    enforce: 'pre',
    name: 'kovo-devtool',
    configureServer(server) {
      // Source slicing recursively indexes the app tree. Build it once, then invalidate alongside
      // Vite's own watcher instead of repeating synchronous filesystem work on every page refresh.
      server.watcher.on('all', () => {
        cachedBundle = undefined;
      });
      server.middlewares.use((request, response, next) => {
        const path = requestPath(request);
        if (path === undefined) {
          writeTextResponse(response, 400, 'Malformed devtool request URL.');
          return;
        }
        if (path === DEVTOOL_CLIENT_PATH) {
          dispatchDevtoolClient(request, response);
          return;
        }
        if (path !== DEVTOOL_PATH && path !== `${DEVTOOL_PATH}/`) {
          next();
          return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.setHeader('Allow', 'GET, HEAD');
          writeTextResponse(response, 405, 'Method Not Allowed');
          return;
        }
        if (request.method === 'HEAD') {
          writeHtmlResponse(response, 200, '');
          return;
        }

        void renderDevtoolDocument(() => loadBundle(server), request)
          .then((document) => writeHtmlResponse(response, 200, document))
          .catch((error: unknown) => {
            if (response.headersSent || response.writableEnded) {
              next(error);
              return;
            }
            if (options.debug) {
              nativeReflectApply(nativeConsoleError, NativeConsole, ['[kovo devtool]', error]);
            }
            writeTextResponse(
              response,
              503,
              'Kovo devtool is unavailable. Re-run kovo dev --debug for details.',
            );
          });
      });
    },
  };
}

async function renderDevtoolDocument(
  loadBundle: () => Promise<ReturnType<typeof buildBundle>>,
  request: IncomingMessage,
): Promise<string> {
  const bundle = await loadBundle();
  const url = new URL(request.url ?? DEVTOOL_PATH, 'http://kovo.invalid');
  const q = boundedQueryValue(url, 'q');
  const sel = boundedQueryValue(url, 'sel');
  const body = renderPage({
    app: DEVTOOL_APP_ID,
    bundle,
    manifest: [
      {
        blurb: 'Live runtime-registry view',
        id: DEVTOOL_APP_ID,
        label: bundle.label,
      },
    ],
    pzHref: DEVTOOL_CLIENT_PATH,
    ...(q === undefined ? {} : { q }),
    ...(sel === undefined ? {} : { sel }),
  });
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Kovo Dataflow Devtool</title>' +
    `<style>${DEVTOOL_STYLES}</style></head><body>${body}` +
    `<script type="module" src="${DEVTOOL_CLIENT_PATH}"></script></body></html>`
  );
}

async function buildKovoDevtoolBundle(
  server: Pick<ViteDevServer, 'ssrLoadModule'>,
  options: KovoDevtoolPluginOptions,
): Promise<ReturnType<typeof buildBundle>> {
  const app = await loadKovoDevtoolApp(server, options);
  const graph = projectKovoDevtoolGraph(app);
  return buildBundle({
    app: DEVTOOL_APP_ID,
    blurb: 'Live runtime-registry view',
    graph,
    label: options.appModuleId,
    limitations: [
      'This view contains closed runtime declarations and live bindings, not the compiler proof graph.',
      'Compiler-only guards, inferred schema fields, derivations, provenance, and unresolved facts are omitted.',
      'Input fields list only explicit file fields. Use kovo explain for authoritative source and proof facts.',
    ],
    provenance: 'live closed app.assemble() runtime registry',
    srcRoot: dirname(options.appModulePath),
    view: 'runtime-registry',
  });
}

async function loadKovoDevtoolApp(
  server: Pick<ViteDevServer, 'ssrLoadModule'>,
  options: KovoDevtoolPluginOptions,
): Promise<KovoApp> {
  // Resolve the public opaque token only through the private build adapter loaded in this exact
  // live SSR realm. Structural inspection and a public isKovoApp assertion would expose the
  // aggregate that SPEC §6.2.1/§9.5 deliberately keeps behind module-private identity.
  const serverBuildModule = await server.ssrLoadModule(options.serverBuildModuleId);
  const resolveKovoAppToken = serverBuildModule.resolveKovoAppToken;
  if (typeof resolveKovoAppToken !== 'function') {
    throw new TypeError('@kovojs/server/internal/build must export resolveKovoAppToken.');
  }
  const appShellModule = await server.ssrLoadModule(options.appShellModuleId);
  const runWithGeneratedLiveTargetRegistry = appShellModule.runWithGeneratedLiveTargetRegistry;
  if (typeof runWithGeneratedLiveTargetRegistry !== 'function') {
    throw new TypeError(
      '@kovojs/server/internal/app-shell-vite must export runWithGeneratedLiveTargetRegistry.',
    );
  }
  // Startup readiness inspects database posture before the first HTTP request. That inspection
  // must own the same compiler-emitted renderer registration scope as request dispatch; otherwise
  // Vite caches an app aggregate with no live-target inventory and every enhanced mutation falls
  // back to an empty fragment response (SPEC §9.1/§9.5).
  const appModule = await nativeReflectApply(runWithGeneratedLiveTargetRegistry, undefined, [
    () => server.ssrLoadModule(options.appModuleId),
  ]);
  if (
    ((typeof appModule !== 'object' || appModule === null) && typeof appModule !== 'function') ||
    buildArrayIsArray(appModule)
  ) {
    throw new TypeError('Kovo devtool app module must be an object.');
  }
  // Vite exposes SSR module bindings through accessor-backed module namespaces. Read the trusted
  // module binding through the boot-captured intrinsic; the stricter authored-data helper below is
  // intentionally reserved for app-owned registry records.
  const app = nativeReflectApply(nativeReflectGet, NativeReflect, [appModule, 'default']);
  try {
    return nativeReflectApply(resolveKovoAppToken, undefined, [
      app,
      'Kovo devtool app module default export',
    ]) as KovoApp;
  } catch {
    throw new TypeError(
      'Kovo devtool requires the app module to default-export the exact opaque KovoApp returned by app.assemble().',
    );
  }
}

/**
 * @internal Read the readiness posture through the same live SSR realm that minted the app and its
 * provider token. A package inventory cannot prove which configured driver is active.
 */
export async function inspectKovoDevDatabasePosture(
  server: Pick<ViteDevServer, 'ssrLoadModule'>,
  options: KovoDevtoolPluginOptions,
): Promise<string> {
  const app = await loadKovoDevtoolApp(server, options);
  const profileModule = await server.ssrLoadModule(options.securityProfileModuleId);
  const projectPosture = profileModule.kovoDevDatabasePosture;
  if (typeof projectPosture !== 'function') {
    throw new TypeError(
      '@kovojs/server/internal/vite-security-profile must export kovoDevDatabasePosture.',
    );
  }
  const posture = nativeReflectApply(projectPosture, undefined, [app]);
  if (typeof posture !== 'string' || posture.length === 0 || posture.length > 256) {
    throw new TypeError('Kovo dev database posture must be a bounded non-empty string.');
  }
  return posture;
}

/** @internal Runtime-only projection. Bundle limitations prevent this view claiming proof parity. */
export function projectKovoDevtoolGraph(app: KovoApp): Record<string, unknown> {
  assertDevtoolRegistryBudget(app);

  const queries: Record<string, unknown>[] = [];
  for (let index = 0; index < app.queries.length; index += 1) {
    const query = app.queries[index]!;
    buildSecurityArrayAppend(
      queries,
      freezeDevtoolValue({
        domains: devtoolDomainKeys(ownDevtoolData(query, 'reads')),
        query: query.key,
      }),
      'CLI Kovo devtool query projection',
    );
  }

  const mutations: Record<string, unknown>[] = [];
  const optimistic: Record<string, unknown>[] = [];
  const touchGraph = nullDevtoolRecord();
  for (let index = 0; index < app.mutations.length; index += 1) {
    const mutation = app.mutations[index]!;
    const touches = devtoolMutationTouches(ownDevtoolData(mutation, 'registry'));
    const writes = devtoolTouchDomains(touches ?? freezeDevtoolValue([]));
    const inputFields = devtoolStringArray(ownDevtoolData(mutation, 'fileFields'), 'file field');
    devtoolMutationOptimisticFacts(mutation, optimistic);
    buildSecurityArrayAppend(
      mutations,
      freezeDevtoolValue({
        ...(inputFields === undefined ? {} : { inputFields }),
        invalidates: writes,
        key: mutation.key,
        writes,
      }),
      'CLI Kovo devtool mutation projection',
    );
    if (touches !== undefined) {
      defineDevtoolData(touchGraph, mutation.key, freezeDevtoolValue({ touches }));
    }
  }

  const components: Record<string, unknown>[] = [];
  for (let index = 0; index < app.liveTargetRenderers.length; index += 1) {
    const renderer = app.liveTargetRenderers[index]!;
    const component = renderer.component;
    const exportName = devtoolLeafName(component);
    const mutationForms: Record<string, unknown>[] = [];
    for (let mutationIndex = 0; mutationIndex < renderer.mutationKeys.length; mutationIndex += 1) {
      buildSecurityArrayAppend(
        mutationForms,
        freezeDevtoolValue({
          mutation: renderer.mutationKeys[mutationIndex]!,
        }),
        'CLI Kovo devtool component mutation projection',
      );
    }
    buildSecurityArrayAppend(
      components,
      freezeDevtoolValue({
        domName: exportName,
        exportName,
        fragments: freezeDevtoolValue([component]),
        mutationForms: freezeDevtoolValue(mutationForms),
        name: component,
        queries: devtoolRendererQueryKeys(renderer),
      }),
      'CLI Kovo devtool component projection',
    );
  }

  const pages: Record<string, unknown>[] = [];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index]!;
    const metadata = ownDevtoolData(ownDevtoolData(route, 'page'), 'kovoRoutePage');
    buildSecurityArrayAppend(
      pages,
      freezeDevtoolValue({
        layouts: devtoolRouteLayouts(metadata),
        navigationSegments: devtoolRouteNavigationSegments(metadata),
        route: route.path,
      }),
      'CLI Kovo devtool page projection',
    );
  }

  return freezeDevtoolValue({
    components: freezeDevtoolValue(components),
    mutations: freezeDevtoolValue(mutations),
    optimistic: freezeDevtoolValue(optimistic),
    pages: freezeDevtoolValue(pages),
    queries: freezeDevtoolValue(queries),
    touchGraph: freezeDevtoolValue(touchGraph),
  }) as Record<string, unknown>;
}

function assertDevtoolRegistryBudget(app: KovoApp): void {
  if (app.liveTargetRenderers.length > MAX_DEVTOOL_REGISTRY_ENTRIES) {
    throw new TypeError('Kovo devtool component registry exceeds its entry budget.');
  }
  if (app.mutations.length > MAX_DEVTOOL_REGISTRY_ENTRIES) {
    throw new TypeError('Kovo devtool mutation registry exceeds its entry budget.');
  }
  if (app.queries.length > MAX_DEVTOOL_REGISTRY_ENTRIES) {
    throw new TypeError('Kovo devtool query registry exceeds its entry budget.');
  }
  if (app.routes.length > MAX_DEVTOOL_REGISTRY_ENTRIES) {
    throw new TypeError('Kovo devtool route registry exceeds its entry budget.');
  }
}

function ownDevtoolData(value: unknown, key: PropertyKey): unknown {
  if (
    ((typeof value !== 'object' || value === null) && typeof value !== 'function') ||
    buildArrayIsArray(value)
  ) {
    return undefined;
  }
  return buildOwnDataValue(value, key, 'Kovo devtool registry carrier');
}

function devtoolDomainKeys(value: unknown): readonly string[] {
  if (!buildArrayIsArray(value)) return freezeDevtoolValue([]);
  assertDevtoolCollectionBudget(value, 'query read');
  const domains: string[] = [];
  const seen = new NativeSet<string>();
  for (let index = 0; index < value.length; index += 1) {
    appendUniqueDevtoolText(domains, seen, ownDevtoolData(value[index], 'key'));
  }
  return freezeDevtoolValue(domains);
}

function devtoolMutationTouches(registry: unknown): readonly Record<string, unknown>[] | undefined {
  const inferred = ownDevtoolData(registry, 'inferredTouches');
  if (buildArrayIsArray(inferred) && inferred.length > 0) {
    assertDevtoolCollectionBudget(inferred, 'inferred touch');
    const result: Record<string, unknown>[] = [];
    for (let index = 0; index < inferred.length; index += 1) {
      const touch = inferred[index];
      const domain = ownDevtoolData(touch, 'domain');
      const keys = ownDevtoolData(touch, 'keys');
      const via = ownDevtoolData(touch, 'via');
      if (typeof domain !== 'string' || (keys !== null && typeof keys !== 'string')) continue;
      buildSecurityArrayAppend(
        result,
        freezeDevtoolValue({
          domain,
          keys,
          site: '',
          via: typeof via === 'string' ? via : 'compiler registry',
        }),
        'CLI Kovo devtool inferred touch projection',
      );
    }
    return freezeDevtoolValue(result);
  }

  const declared = ownDevtoolData(registry, 'touches');
  if (!buildArrayIsArray(declared)) return undefined;
  assertDevtoolCollectionBudget(declared, 'declared touch');
  const result: Record<string, unknown>[] = [];
  for (let index = 0; index < declared.length; index += 1) {
    const domain = ownDevtoolData(declared[index], 'key');
    if (typeof domain !== 'string') continue;
    buildSecurityArrayAppend(
      result,
      freezeDevtoolValue({ domain, keys: null, site: '', via: 'declared touch' }),
      'CLI Kovo devtool declared touch projection',
    );
  }
  return freezeDevtoolValue(result);
}

function devtoolStringArray(value: unknown, label: string): readonly string[] | undefined {
  if (!buildArrayIsArray(value)) return undefined;
  assertDevtoolCollectionBudget(value, label);
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry === 'string') {
      buildSecurityArrayAppend(result, entry, `CLI Kovo devtool ${label} projection`);
    }
  }
  return freezeDevtoolValue(result);
}

function devtoolMutationOptimisticFacts(
  mutation: KovoApp['mutations'][number],
  target: Record<string, unknown>[],
): void {
  const map = ownDevtoolData(mutation, 'optimistic');
  if (
    ((typeof map !== 'object' || map === null) && typeof map !== 'function') ||
    buildArrayIsArray(map)
  ) {
    return;
  }
  const queryNames = buildObjectKeys(map);
  assertDevtoolCollectionBudget(queryNames, 'optimistic');
  for (let index = 0; index < queryNames.length; index += 1) {
    const query = queryNames[index]!;
    const entry = ownDevtoolData(map, query);
    const status =
      entry === 'await-fragment'
        ? 'await-fragment'
        : typeof entry === 'function' ||
            (typeof entry === 'object' && entry !== null && !buildArrayIsArray(entry))
          ? 'hand-written'
          : undefined;
    if (status === undefined) continue;
    buildSecurityArrayAppend(
      target,
      freezeDevtoolValue({ mutation: mutation.key, query, status }),
      'CLI Kovo devtool optimistic projection',
    );
  }
}

function devtoolTouchDomains(touches: readonly Record<string, unknown>[]): readonly string[] {
  const domains: string[] = [];
  const seen = new NativeSet<string>();
  for (let index = 0; index < touches.length; index += 1) {
    appendUniqueDevtoolText(domains, seen, ownDevtoolData(touches[index], 'domain'));
  }
  return freezeDevtoolValue(domains);
}

function devtoolRendererQueryKeys(
  renderer: KovoApp['liveTargetRenderers'][number],
): readonly string[] {
  const keys: string[] = [];
  const seen = new NativeSet<string>();
  for (let index = 0; index < (renderer.queries?.length ?? 0); index += 1) {
    appendUniqueDevtoolText(keys, seen, renderer.queries![index]);
  }
  for (let index = 0; index < (renderer.queryDefinitions?.length ?? 0); index += 1) {
    appendUniqueDevtoolText(keys, seen, renderer.queryDefinitions![index]?.key);
  }
  return freezeDevtoolValue(keys);
}

function appendUniqueDevtoolText(target: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== 'string' || nativeReflectApply(nativeSetHas, seen, [value]) === true) {
    return;
  }
  nativeReflectApply(nativeSetAdd, seen, [value]);
  buildSecurityArrayAppend(target, value, 'CLI Kovo devtool text projection');
}

function devtoolLeafName(value: string): string {
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '/' || character === '\\' || character === '#') start = index + 1;
  }
  return nativeReflectApply(nativeStringSlice, value, [start]) as string;
}

function devtoolRouteLayouts(metadata: unknown): readonly string[] {
  const layouts = ownDevtoolData(metadata, 'layouts');
  if (!buildArrayIsArray(layouts)) return freezeDevtoolValue([]);
  assertDevtoolCollectionBudget(layouts, 'route layout');
  const names: string[] = [];
  for (let index = 0; index < layouts.length; index += 1) {
    const name = ownDevtoolData(layouts[index], 'localName');
    if (typeof name === 'string') {
      buildSecurityArrayAppend(names, name, 'CLI Kovo devtool route layout projection');
    }
  }
  return freezeDevtoolValue(names);
}

function devtoolRouteNavigationSegments(metadata: unknown): readonly Record<string, unknown>[] {
  const segments = ownDevtoolData(metadata, 'navigationSegments');
  if (!buildArrayIsArray(segments)) return freezeDevtoolValue([]);
  assertDevtoolCollectionBudget(segments, 'route navigation');
  const result: Record<string, unknown>[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const componentValues = ownDevtoolData(segments[index], 'components');
    const components: string[] = [];
    if (buildArrayIsArray(componentValues)) {
      assertDevtoolCollectionBudget(componentValues, 'route component');
      for (let componentIndex = 0; componentIndex < componentValues.length; componentIndex += 1) {
        const component = componentValues[componentIndex];
        if (typeof component === 'string') {
          buildSecurityArrayAppend(
            components,
            component,
            'CLI Kovo devtool route component projection',
          );
        }
      }
    }
    buildSecurityArrayAppend(
      result,
      freezeDevtoolValue({ components: freezeDevtoolValue(components) }),
      'CLI Kovo devtool route navigation projection',
    );
  }
  return freezeDevtoolValue(result);
}

function assertDevtoolCollectionBudget(value: readonly unknown[], label: string): void {
  if (value.length > MAX_DEVTOOL_REGISTRY_ENTRIES) {
    throw new TypeError(`Kovo devtool ${label} registry exceeds its entry budget.`);
  }
}

function nullDevtoolRecord(): Record<PropertyKey, unknown> {
  return nativeReflectApply(nativeObjectCreate, NativeObject, [null]) as Record<
    PropertyKey,
    unknown
  >;
}

function defineDevtoolData(target: object, key: PropertyKey, value: unknown): void {
  nativeReflectApply(nativeObjectDefineProperty, NativeObject, [
    target,
    key,
    {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    },
  ]);
}

function freezeDevtoolValue<Value>(value: Value): Readonly<Value> {
  return nativeReflectApply(nativeObjectFreeze, NativeObject, [value]) as Readonly<Value>;
}

function requestPath(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? '/', 'http://kovo.invalid').pathname;
  } catch {
    return undefined;
  }
}

function boundedQueryValue(url: URL, name: 'q' | 'sel'): string | undefined {
  const value = url.searchParams.get(name);
  if (value === null || value === '') return undefined;
  if (value.length > MAX_DEVTOOL_QUERY_LENGTH) {
    throw new TypeError(
      `Devtool query parameter ${name} exceeds ${MAX_DEVTOOL_QUERY_LENGTH} bytes.`,
    );
  }
  return value;
}

function dispatchDevtoolClient(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    writeTextResponse(response, 405, 'Method Not Allowed');
    return;
  }
  response.statusCode = 200;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(request.method === 'HEAD' ? undefined : DEVTOOL_CLIENT_SOURCE);
}

function writeHtmlResponse(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; frame-ancestors 'none'; img-src 'none'; object-src 'none'; script-src 'self'; style-src 'unsafe-inline'",
  );
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(body);
}

function writeTextResponse(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(body);
}

// Exercise the captured constructor at module initialization before authored code can replace it.
if (typeof NativeAbortController !== 'function') {
  throw new TypeError('Kovo devtool requires AbortController.');
}
