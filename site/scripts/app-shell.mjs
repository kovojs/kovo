import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultDistDir = path.join(siteRoot, 'dist');
const defaultPublicDir = path.join(siteRoot, 'public');
const defaultServerModulePath = path.join(repoRoot, 'dist/server/src/index.mjs');
const defaultServerAppShellModulePath = path.join(
  repoRoot,
  'dist/server/src/api/app-shell/index.mjs',
);
const defaultServerAppShellClientModulesPath = path.join(
  repoRoot,
  'dist/server/src/api/app-shell/client-modules.mjs',
);
const defaultServerAppShellCorePath = path.join(repoRoot, 'dist/server/src/api/app-shell/core.mjs');
const routeManifestFile = '.jiso-site-routes.json';

const textEncoder = new TextEncoder();

export async function createSiteDistApp({
  distDir = defaultDistDir,
  publicDir = defaultPublicDir,
  server,
} = {}) {
  const serverApi = server ?? (await loadDefaultServerApi());
  const clientModules = serverApi.createMemoryVersionedClientModuleRegistry();
  const moduleHrefs = registerPublicClientModules(clientModules, publicDir);

  return serverApi.createApp({
    clientModules,
    document: { lang: 'en' },
    routes: siteDocumentRoutes(distDir, moduleHrefs, serverApi),
  });
}

async function loadDefaultServerApi() {
  const [serverApi, clientModulesApi, coreApi] = await Promise.all([
    import(pathToFileURL(defaultServerModulePath).href),
    loadAppShellSubpath(
      defaultServerAppShellClientModulesPath,
      '@jiso/server/app-shell/client-modules',
    ),
    loadAppShellSubpath(defaultServerAppShellCorePath, '@jiso/server/app-shell/core'),
  ]);
  return { ...serverApi, ...clientModulesApi, ...coreApi };
}

async function loadAppShellSubpath(builtModulePath, packageSubpath) {
  if (existsSync(builtModulePath)) {
    return await import(pathToFileURL(builtModulePath).href);
  }

  if (existsSync(defaultServerAppShellModulePath)) {
    throw new Error(`site app shell: missing built server subpath ${builtModulePath}`);
  }

  return await import(packageSubpath);
}

export function siteDocumentRoutes(distDir = defaultDistDir, moduleHrefs = new Map(), server) {
  return siteDocumentRouteEntries(distDir).map(({ file, routePath }) => {
    return server.route(routePath, {
      meta: { title: routePath === '/' ? 'Jiso' : `Jiso ${routePath}` },
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

function rewriteClientModuleHrefs(html, moduleHrefs) {
  let rewritten = html;
  for (const [pathName, href] of moduleHrefs) {
    rewritten = rewritten.replaceAll(pathName, href);
  }
  return rewritten;
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
  process.env.JISO_SITE_APP_SHELL_DEFAULT !== 'off' &&
  existsSync(defaultDistDir) &&
  existsSync(defaultServerModulePath)
    ? await createSiteDistApp()
    : undefined;

export default app;
