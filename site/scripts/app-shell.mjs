import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultDistDir = path.join(siteRoot, 'dist');
const defaultPublicDir = path.join(siteRoot, 'public');
const defaultServerModulePath = path.join(repoRoot, 'dist/server/src/index.mjs');

const textEncoder = new TextEncoder();

export async function createSiteDistApp({
  distDir = defaultDistDir,
  publicDir = defaultPublicDir,
  server,
} = {}) {
  const serverApi = server ?? (await import(pathToFileURL(defaultServerModulePath).href));
  const clientModules = serverApi.createMemoryVersionedClientModuleRegistry();
  const moduleHrefs = registerPublicClientModules(clientModules, publicDir);

  return serverApi.createApp({
    clientModules,
    document: { lang: 'en' },
    routes: siteDocumentRoutes(distDir, moduleHrefs, serverApi),
  });
}

export function siteDocumentRoutes(distDir = defaultDistDir, moduleHrefs = new Map(), server) {
  return findHtmlIndexFiles(distDir).map((file) => {
    const routePath = routePathForIndexFile(distDir, file);

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
        walk(fullPath);
        continue;
      }

      if (entry.name === 'index.html') found.push(fullPath);
    }
  }

  walk(root);
  return found;
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

function contentHash(source) {
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

export const app =
  existsSync(defaultDistDir) && existsSync(defaultServerModulePath)
    ? await createSiteDistApp()
    : undefined;

export default app;
