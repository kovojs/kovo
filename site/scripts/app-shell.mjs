import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultDistDir = path.join(siteRoot, 'dist');
const defaultPublicDir = path.join(siteRoot, 'public');
const headlessUiSourceRoot = path.join(repoRoot, 'packages/headless-ui/src');
const defaultServerAppShellClientModulesPath = path.join(
  repoRoot,
  'dist/server/src/api/app-shell/client-modules.mjs',
);
const defaultServerAppShellCorePath = path.join(repoRoot, 'dist/server/src/api/app-shell/core.mjs');
const routeManifestFile = '.kovo-site-routes.json';

const textEncoder = new TextEncoder();

export async function createSiteDistApp({
  distDir = defaultDistDir,
  publicDir = defaultPublicDir,
  server,
} = {}) {
  const serverApi = server ?? (await loadDefaultServerApi());
  assertSiteAppShellServerApi(serverApi);
  const clientModules = serverApi.createMemoryVersionedClientModuleRegistry();
  const moduleHrefs = registerPublicClientModules(clientModules, publicDir);
  const gallerySupport = registerGalleryInteractiveSupportClientModules(clientModules);
  // The folded component pages reference the gallery's compiled interactive
  // client modules (/c/examples/gallery/.../<name>.client.js?v=…). Register them
  // so the static-export replay can serve and copy them (else KV229).
  mergeModuleHrefs(moduleHrefs, gallerySupport.moduleHrefs);
  mergeModuleHrefs(
    moduleHrefs,
    registerGalleryInteractiveClientModules(clientModules, gallerySupport),
  );

  return serverApi.createApp({
    clientModules,
    document: { lang: 'en' },
    routes: siteDocumentRoutes(distDir, moduleHrefs, serverApi),
  });
}

async function loadDefaultServerApi() {
  const [clientModulesApi, coreApi] = await Promise.all([
    loadAppShellSubpath(
      defaultServerAppShellClientModulesPath,
      '@kovojs/server/app-shell/client-modules',
      ['createMemoryVersionedClientModuleRegistry'],
    ),
    loadAppShellSubpath(defaultServerAppShellCorePath, '@kovojs/server/app-shell/core', [
      'createApp',
      'route',
      'respond',
    ]),
  ]);
  return { ...clientModulesApi, ...coreApi };
}

async function loadAppShellSubpath(builtModulePath, packageSubpath, requiredExports = []) {
  if (existsSync(builtModulePath)) {
    const builtApi = await import(pathToFileURL(builtModulePath).href);
    if (requiredExports.every((name) => builtApi[name] !== undefined)) return builtApi;
  }

  return await import(packageSubpath);
}

function assertSiteAppShellServerApi(serverApi) {
  const missing = Object.entries({
    createApp: 'function',
    createMemoryVersionedClientModuleRegistry: 'function',
    respond: 'object',
    route: 'function',
  }).flatMap(([name, type]) => (typeof serverApi?.[name] === type ? [] : [name]));

  if (missing.length === 0) return;

  throw new Error(
    [
      'site app shell: server API must provide focused @kovojs/server app-shell authoring exports.',
      `Missing exports: ${missing.join(', ')}.`,
      'SPEC §9.5 docs export must replay through createApp(), route(), respond(), and the client-module registry.',
    ].join(' '),
  );
}

export function siteDocumentRoutes(distDir = defaultDistDir, moduleHrefs = new Map(), server) {
  return siteDocumentRouteEntries(distDir).map(({ file, routePath }) => {
    return server.route(routePath, {
      meta: { title: routePath === '/' ? 'Kovo' : `Kovo ${routePath}` },
      page() {
        const html = rewriteClientModuleHrefs(
          escapePreClientModuleText(readFileSync(file, 'utf8')),
          moduleHrefs,
        );

        // The site already has complete documents. Returning bytes avoids the
        // app-shell document wrapper while still replaying through SPEC section 9.5
        // Request -> Response export semantics.
        return server.respond.stream(textEncoder.encode(html), {
          contentType: 'text/html; charset=utf-8',
          disposition: 'inline',
        });
      },
    });
  });
}

export function siteDocumentRouteEntries(distDir = defaultDistDir) {
  const manifest = siteRouteManifestEntries(distDir);
  if (manifest) return manifest;

  return findHtmlIndexFiles(distDir).map((file) => ({
    file,
    routePath: routePathForIndexFile(distDir, file),
  }));
}

function registerPublicClientModules(clientModules, publicDir) {
  const clientDir = path.join(publicDir, 'c');
  const hrefs = new Map();

  if (!existsSync(clientDir)) return hrefs;

  for (const entry of sortedDirectoryEntries(clientDir)) {
    if (!entry.name.endsWith('.js')) continue;

    const sourcePath = path.join(clientDir, entry.name);
    const source = readFileSync(sourcePath, 'utf8');
    const pathName = `/c/${entry.name}`;
    const href = clientModules.put({
      path: pathName,
      source,
      version: `site-r7-${contentHash(source)}`,
    });
    hrefs.set(pathName, href);
  }

  return hrefs;
}

function registerGalleryInteractiveSupportClientModules(clientModules) {
  const moduleHrefs = new Map();
  const runtimeSource = [
    'export const derive = (inputs, run) => ({ inputs, run });',
    'export const handler = (fn) => fn;',
    '',
  ].join('\n');
  const runtimePath = '/c/examples/gallery/src/generated/kovo-runtime.client.js';
  const runtimeHref = clientModules.put({
    path: runtimePath,
    source: runtimeSource,
    version: contentHash(runtimeSource).slice(0, 8),
  });
  moduleHrefs.set(runtimePath, runtimeHref);

  for (const directory of ['lib', 'primitives']) {
    for (const entry of sortedDirectoryEntries(path.join(headlessUiSourceRoot, directory))) {
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;

      const sourcePath = path.join(headlessUiSourceRoot, directory, entry.name);
      const pathName = `/c/packages/headless-ui/src/${directory}/${entry.name.replace(
        /\.ts$/,
        '.js',
      )}`;
      const source = readFileSync(sourcePath, 'utf8');
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: entry.name,
      }).outputText;
      const href = clientModules.put({
        path: pathName,
        source: transpiled,
        version: contentHash(transpiled).slice(0, 8),
      });
      moduleHrefs.set(pathName, href);
    }
  }

  const primitivesHref = moduleHrefs.get('/c/packages/headless-ui/src/primitives/index.js');
  if (primitivesHref === undefined) {
    throw new Error('site app shell: missing gallery headless UI primitives client module.');
  }

  return { moduleHrefs, primitivesHref, runtimeHref };
}

/** Register the compiled interactive-gallery client modules with the same path
 * + version the folded component pages reference. Mirrors the version-extraction
 * in examples/gallery/src/app-shell.ts (the version lives in the generated
 * server markup's on:click href). SPEC §4.4 makes load-bearing import maps a
 * non-goal, so rewrite generated bare package imports to registered /c/ URLs. */
function registerGalleryInteractiveClientModules(clientModules, support) {
  const generatedDir = path.join(repoRoot, 'examples/gallery/src/generated/interactive');
  const hrefs = new Map();
  if (!existsSync(generatedDir)) return hrefs;

  for (const entry of sortedDirectoryEntries(generatedDir)) {
    if (!entry.name.endsWith('.client.js')) continue;

    const name = entry.name.replace(/\.client\.js$/, '');
    const source = rewriteGalleryClientImports(
      readFileSync(path.join(generatedDir, entry.name), 'utf8'),
      support,
    );
    const serverTsx = readFileSync(path.join(generatedDir, `${name}.tsx`), 'utf8');
    const pathName = `/c/examples/gallery/src/generated/interactive/${name}.client.js`;
    const href = clientModules.put({
      path: pathName,
      source,
      version: galleryInteractiveClientModuleVersion(serverTsx, pathName, name),
    });
    hrefs.set(pathName, href);
  }

  return hrefs;
}

function rewriteGalleryClientImports(source, support) {
  return source
    .replaceAll("from '@kovojs/runtime';", `from '${support.runtimeHref}';`)
    .replaceAll('from "@kovojs/headless-ui/primitives";', `from '${support.primitivesHref}';`)
    .replaceAll("from '@kovojs/headless-ui/primitives';", `from '${support.primitivesHref}';`);
}

function mergeModuleHrefs(target, source) {
  for (const [pathName, href] of source) target.set(pathName, href);
}

function galleryInteractiveClientModuleVersion(serverTsx, modulePath, name) {
  const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\?v=([0-9a-f]{8})#`, 'g');
  const versions = new Set();
  let match;
  while ((match = pattern.exec(serverTsx)) !== null) versions.add(match[1]);

  if (versions.size !== 1) {
    throw new Error(
      `site app shell: expected one generated client version for ${name}, found ${versions.size}.`,
    );
  }
  return [...versions][0];
}

function rewriteClientModuleHrefs(html, moduleHrefs) {
  return html.replace(/<[^>]+>/g, (tag) => rewriteClientModuleTagHrefs(tag, moduleHrefs));
}

function rewriteClientModuleTagHrefs(tag, moduleHrefs) {
  if (/\son:[\w:-]+="/.test(tag)) {
    return rewriteClientModuleAttribute(tag, /\son:[\w:-]+="([^"]+)"/g, moduleHrefs);
  }

  if (isModuleScriptTag(tag)) {
    return rewriteClientModuleAttribute(tag, /\ssrc="([^"]+)"/g, moduleHrefs);
  }

  if (isModulepreloadLinkTag(tag)) {
    return rewriteClientModuleAttribute(tag, /\shref="([^"]+)"/g, moduleHrefs);
  }

  return tag;
}

function rewriteClientModuleAttribute(tag, attributePattern, moduleHrefs) {
  return tag.replace(attributePattern, (attribute, value) => {
    const rewritten = rewriteClientModuleValue(value, moduleHrefs);
    return attribute.replace(value, rewritten);
  });
}

function rewriteClientModuleValue(value, moduleHrefs) {
  for (const [pathName, href] of moduleHrefs) {
    if (value === pathName || value.startsWith(`${pathName}#`)) {
      return `${href}${value.slice(pathName.length)}`;
    }
  }
  return value;
}

function isModuleScriptTag(tag) {
  return /^<script\b/i.test(tag) && /\stype="module"/i.test(tag);
}

function isModulepreloadLinkTag(tag) {
  return /^<link\b/i.test(tag) && /\srel="[^"]*\bmodulepreload\b[^"]*"/i.test(tag);
}

function escapePreClientModuleText(html) {
  return html.replace(/<pre\b[\s\S]*?<\/pre>/g, (block) => block.replaceAll('/c/', '&#47;c/'));
}

function findHtmlIndexFiles(root) {
  const found = [];

  function walk(directory) {
    for (const entry of sortedDirectoryEntries(directory)) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        walk(fullPath);
        continue;
      }

      if (entry.name === 'index.html') found.push(fullPath);
    }
  }

  walk(root);
  return found;
}

function siteRouteManifestEntries(root) {
  const manifestPath = path.join(root, routeManifestFile);
  if (!existsSync(manifestPath)) return undefined;

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest || !Array.isArray(manifest.routes)) {
    throw new Error(`site app shell: ${routeManifestFile} must contain a routes array.`);
  }

  const entries = [];
  const seen = new Set();

  for (const route of manifest.routes) {
    const routePath = normalizeManifestRoute(route);
    if (seen.has(routePath)) {
      throw new Error(`site app shell: duplicate route '${routePath}' in ${routeManifestFile}.`);
    }
    seen.add(routePath);

    const file = indexFileForRoutePath(root, routePath);
    if (!existsSync(file)) {
      throw new Error(
        `site app shell: ${routeManifestFile} declares '${routePath}' but ${path.relative(
          root,
          file,
        )} does not exist.`,
      );
    }

    entries.push({ file, routePath });
  }

  return entries;
}

function sortedDirectoryEntries(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function routePathForIndexFile(root, file) {
  const relativeDir = path.relative(root, path.dirname(file));
  if (!relativeDir) return '/';
  return `/${relativeDir.split(path.sep).join('/')}`;
}

function indexFileForRoutePath(root, routePath) {
  return path.join(root, routePath.replace(/^\//, ''), 'index.html');
}

function normalizeManifestRoute(route) {
  if (typeof route !== 'string') {
    throw new Error('site app shell: route manifest entries must be strings.');
  }
  if (!route.startsWith('/') || route.includes('?') || route.includes('#')) {
    throw new Error(
      `site app shell: route manifest entry '${route}' must be an absolute pathname without search or hash.`,
    );
  }

  const normalized = route.replace(/\/+$/, '') || '/';
  if (normalized.includes('//') || normalized.split('/').includes('..')) {
    throw new Error(`site app shell: route manifest entry '${route}' is not a safe route path.`);
  }

  return normalized;
}

function contentHash(source) {
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

export const app =
  process.env.KOVO_SITE_APP_SHELL_DEFAULT !== 'off' &&
  existsSync(defaultDistDir) &&
  existsSync(defaultServerAppShellCorePath)
    ? await createSiteDistApp()
    : undefined;

export default app;
