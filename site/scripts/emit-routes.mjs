import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

import { runContentPipeline } from './content-pipeline.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsxUrl = new URL(specifier.replace(/\.js$/, '.tsx'), context.parentURL);
      if (existsSync(tsxUrl)) return nextResolve(tsxUrl.href, context);
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(scriptDir, '..');
const kovoBin = resolve(siteRoot, 'node_modules/.bin/kovo');
const sourcePath = resolve(siteRoot, 'src/generated/app.routes.tsx');
const artifactPath = resolve(siteRoot, 'src/generated/app.kovo-route.tsx');
const sourceFileName = 'site/src/generated/app.routes.tsx';
const artifactFileName = 'site/src/generated/app.kovo-route.tsx';

export async function emitSiteRoutes({ check = false, skipPipeline = false } = {}) {
  if (!skipPipeline) await runContentPipeline();

  const routeData = await loadRouteData();
  const source = renderRouteSource(routeData);
  const compiled = compileSiteRouteSource(source);

  assert.equal(
    compiled.routePageFacts.length,
    routeData.pages.length + 1,
    `${sourceFileName} did not compile every docs-site route page`,
  );

  if (check) {
    assert.equal(
      readFileSync(sourcePath, 'utf8'),
      source,
      'generated app.routes.tsx is stale; run `pnpm --filter @kovojs/site run emit-routes`',
    );
    assert.equal(
      readFileSync(artifactPath, 'utf8'),
      compiled.artifact,
      'generated app.kovo-route.tsx is stale; run `pnpm --filter @kovojs/site run emit-routes`',
    );
  } else {
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, source);
    writeFileSync(artifactPath, compiled.artifact);
  }

  return {
    artifactPath,
    pages: routeData.pages.length + 1,
    sourcePath,
  };
}

function compileSiteRouteSource(source) {
  const root = mkdtempSync(resolve(tmpdir(), 'kovo-site-routes-'));
  try {
    const tempSourcePath = resolve(root, 'app.routes.tsx');
    const tempArtifactPath = resolve(root, 'app.kovo-route.tsx');
    const factsPath = resolve(root, 'route-facts.json');
    writeFileSync(tempSourcePath, source);

    execFileSync(
      kovoBin,
      [
        'compile',
        'route',
        tempSourcePath,
        '--out',
        tempArtifactPath,
        '--file-name',
        sourceFileName,
        '--artifact-file-name',
        artifactFileName,
        '--facts-out',
        factsPath,
      ],
      { cwd: siteRoot, stdio: ['ignore', 'pipe', 'inherit'] },
    );

    const facts = JSON.parse(readFileSync(factsPath, 'utf8'));
    assert.ok(
      Array.isArray(facts.routePageFacts),
      `${sourceFileName} produced malformed route facts`,
    );

    return {
      artifact: readFileSync(tempArtifactPath, 'utf8'),
      routePageFacts: facts.routePageFacts,
    };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

async function loadRouteData() {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'error',
    root: siteRoot,
    server: { middlewareMode: true },
  });

  try {
    const [dataModule, clientModule] = await Promise.all([
      vite.ssrLoadModule('/src/app-data.ts'),
      vite.ssrLoadModule('/src/client/modules.ts'),
    ]);
    return dataModule.buildSiteRouteData({ clientModules: clientModule.siteClientModules });
  } finally {
    await vite.close();
  }
}

function renderRouteSource(routeData) {
  const pageConstants = routeData.pages
    .map(
      (page, index) =>
        `const page${index} = pageAt(${index}, ${JSON.stringify(page.routePath)});\n`,
    )
    .join('');
  const routeEntries = routeData.pages
    .map((page, index) => renderDocsRouteEntry(page.routePath, index))
    .join('\n');

  return `/** @jsxImportSource @kovojs/server */
// Generated TSX route source for the docs site (SPEC.md section 4.5).
// Do not edit; regenerate with \`pnpm run emit-routes\`.
import {
  createApp,
  createRequestHandler,
  layout,
  route,
  toNodeHandler,
  type RouteDeclaration,
} from '@kovojs/server';

import { buildSiteRouteData, type SiteRoutePage } from '../app-data.js';
import { clientHrefs, siteClientModules } from '../client/modules.js';
import { DocsRoutePage } from '../components/docs-layout.js';
import { LandingRoutePage } from '../components/landing.js';
import { siteDocumentTemplate } from '../document-template.js';
import { siteStylesheetsForRoute } from '../route-kit.js';

type SiteRoute = RouteDeclaration<string, undefined, undefined, unknown, unknown, unknown>;

const siteRouteData = await buildSiteRouteData({ clientModules: siteClientModules });

function SiteRouteLayoutShell({ children }: { children?: unknown }): string {
  return <div data-site-route-layout>{children}</div>;
}

const SiteRouteLayout = layout({
  render: (_queries, _state, { children }) => <SiteRouteLayoutShell>{children}</SiteRouteLayoutShell>,
});

function pageAt(index: number, routePath: string): SiteRoutePage {
  const page = siteRouteData.pages[index];
  if (!page || page.routePath !== routePath) {
    throw new Error(\`docs route artifact is stale for \${routePath}; regenerate site routes\`);
  }
  return page;
}

${pageConstants}
const routes: SiteRoute[] = [
  route('/', {
    layout: SiteRouteLayout,
    meta: siteRouteData.landing.meta,
    stylesheets: siteStylesheetsForRoute('/'),
    page() {
      return (
        <LandingRoutePage
          clients={clientHrefs}
          loaderGzipBytes={siteRouteData.landing.loaderGzipBytes}
        />
      );
    },
  }) as SiteRoute,
${routeEntries}
];

export const siteStaticExportApp = createApp({
  clientModules: siteClientModules,
  document: { lang: 'en', template: siteDocumentTemplate },
  routes,
});

export const siteNodeHandler = toNodeHandler(createRequestHandler(siteStaticExportApp));

export default siteStaticExportApp;
`;
}

function renderDocsRouteEntry(routePath, index) {
  return `  route(${JSON.stringify(routePath)}, {
    layout: SiteRouteLayout,
    meta: page${index}.meta,
    ...(page${index}.modulepreloads ? { modulepreloads: page${index}.modulepreloads } : {}),
    stylesheets: siteStylesheetsForRoute(page${index}.routePath),
    page() {
      return <DocsRoutePage clients={clientHrefs} page={page${index}.body} />;
    },
  }) as SiteRoute,`;
}

function parseCliOptions(args) {
  const options = {};
  for (const arg of args) {
    if (arg === '--') continue;
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg === '--skip-pipeline') {
      options.skipPipeline = true;
      continue;
    }
    throw new Error(`Unknown site route emit option '${arg}'.`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await emitSiteRoutes(parseCliOptions(process.argv.slice(2)));
  process.stdout.write(`site-routes/v1 pages=${result.pages}\n`);
}
