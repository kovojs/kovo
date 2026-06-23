import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve workspace TS sources behind local `.js` specifiers when this script
// imports the example theme from source, matching the demo serve path.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const scriptDir = dirname(fileURLToPath(import.meta.url));
const soRoot = resolve(scriptDir, '..');
const appEntry = resolve(soRoot, 'src/app-shell.ts');
const distDir = process.env.KOVO_SO_CSS_DIST
  ? resolve(process.env.KOVO_SO_CSS_DIST)
  : resolve(soRoot, 'dist');
const stylesPath = resolve(distDir, 'assets/styles.css');
const manifestPath = resolve(distDir, 'stackoverflow-css-manifest.json');
const { extractAppComponentCss, extractAppRouteCssTargets } =
  await import('@kovojs/compiler/package-styles');
const { collectCssAssetManifest, cssRouteDeliveryGate } = await import('@kovojs/compiler/internal');
const { soTheme } = await import('../src/theme.ts');

const stackOverflowRouteCssSourceFileNames = {
  '/': [
    'components/chrome.css',
    'components/question-list.css',
    'components/question-card.css',
    'components/right-rail.css',
  ],
  '/questions/:id': [
    'components/chrome.css',
    'components/question-detail.css',
    'components/right-rail.css',
  ],
  '/questions/tagged/:tag': [
    'components/chrome.css',
    'components/tagged-questions.css',
    'components/question-card.css',
  ],
  '/tags': ['components/chrome.css', 'components/tags-page.css'],
  '/users': ['components/chrome.css', 'components/users-page.css'],
  '/users/:id': ['components/chrome.css', 'components/user-profile.css'],
};

const appCss = extractAppComponentCss({
  fileName: appEntry,
  packagePrefixDiscoveryRoot: soRoot,
  source: readFileSync(appEntry, 'utf8'),
});
const routeCssTargets = stackOverflowRouteCssTargets(
  extractAppRouteCssTargets({
    fileName: appEntry,
    packagePrefixDiscoveryRoot: soRoot,
    source: readFileSync(appEntry, 'utf8'),
  }).routeTargets,
);

if (appCss.diagnostics.length > 0) {
  const details = appCss.diagnostics
    .map((diagnostic) => `${diagnostic.fileName}: ${diagnostic.message}`)
    .join('\n');
  throw new Error(`Stack Overflow demo CSS extraction failed:\n${details}`);
}

const baseCss = readFileSync(stylesPath, 'utf8').trim();
const splitManifest =
  appCss.cssAssets.length === 0
    ? undefined
    : collectCssAssetManifest(
        { cssAssets: appCss.cssAssets },
        { split: { baseSourceFileNames: ['components/chrome.css'], routes: routeCssTargets } },
      );

if (splitManifest?.chunks) {
  const diagnostics = routeCssTargets.flatMap(
    (routeTarget) => cssRouteDeliveryGate(splitManifest, routeTarget).diagnostics,
  );
  if (diagnostics.length > 0) {
    const details = diagnostics
      .slice(0, 10)
      .map(
        (diagnostic) =>
          `${diagnostic.route} links ${diagnostic.href} atom ${diagnostic.className} ` +
          `from ${diagnostic.source}`,
      )
      .join('\n');
    throw new Error(`Stack Overflow demo CSS overship gate failed:\n${details}`);
  }
}

const appCssText = `${[baseCss, soTheme.css]
  .filter(Boolean)
  .map((chunk) => chunk.trim())
  .join('\n')}\n`;
const hash = createHash('sha256').update(appCssText).digest('hex').slice(0, 12);
const hashedHref = `/assets/styles.${hash}.css`;
const hashedStylesPath = resolve(distDir, `.${hashedHref}`);
const splitChunks = splitManifest?.chunks;
const app = manifestAssets(splitChunks?.base);
const routes = manifestAssetsByKey(splitChunks?.routes);
const fragments = manifestAssetsByKey(splitChunks?.fragments);

writeFileSync(stylesPath, appCssText);
writeFileSync(hashedStylesPath, appCssText);
for (const asset of [
  ...(splitChunks?.base ?? []),
  ...Object.values(splitChunks?.routes ?? {}).flat(),
  ...Object.values(splitChunks?.fragments ?? {}).flat(),
]) {
  writeStylesheetAsset(distDir, asset);
}
writeFileSync(
  manifestPath,
  `${JSON.stringify({ app, fragments, href: hashedHref, routes, version: 2 }, null, 2)}\n`,
  'utf8',
);

console.log(
  `materialize-demo-css: wrote ${hashedStylesPath} and ${routeCssTargets.length} route CSS split targets (${appCss.sourceFiles.length} source files scanned).`,
);

function stackOverflowRouteCssTargets(extractedTargets) {
  const byRoute = new Map(extractedTargets.map((target) => [target.route, target]));
  const merged = Object.entries(stackOverflowRouteCssSourceFileNames).map(
    ([route, sourceFileNames]) => ({
      ...byRoute.get(route),
      route,
      sourceFileNames: uniqueSorted([
        ...(byRoute.get(route)?.sourceFileNames ?? []),
        ...sourceFileNames,
      ]),
    }),
  );
  const explicitRoutes = new Set(merged.map((target) => target.route));
  return [...merged, ...extractedTargets.filter((target) => !explicitRoutes.has(target.route))];
}

function manifestAssetsByKey(groups = {}) {
  return Object.fromEntries(
    Object.entries(groups).map(([key, assets]) => [key, manifestAssets(assets)]),
  );
}

function manifestAssets(assets = []) {
  return assets.flatMap((asset) =>
    asset.criticalCss ? [{ criticalCss: asset.criticalCss, href: asset.href }] : [],
  );
}

function writeStylesheetAsset(root, asset) {
  if (!asset.criticalCss) return;
  const filePath = resolve(root, `.${asset.href}`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${asset.criticalCss.trim()}\n`, 'utf8');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
