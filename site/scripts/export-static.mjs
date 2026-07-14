import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildWithSecurityLockedVite,
  createSecurityLockedViteServer,
  securityLockedViteRuntime,
} from '../../scripts/lib/secure-vite-runtime.mjs';

import { runContentPipeline } from './content-pipeline.mjs';
import { writeScriptArtifacts } from '../../scripts/output-staging.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

// SPEC §9.5: the docs site's static export uses the command facade for route
// replay, /c/ client modules, and Vite manifest assets. This script only owns
// site-specific content generation and extra static files.

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const cssDistDir = path.join(siteRoot, 'dist-css');
const publicDir = path.join(siteRoot, 'public');
const defaultDistDir = path.join(siteRoot, 'dist');
const uiStylesheetPath = path.join(cssDistDir, 'assets/kovo-ui.css');

// The global served stylesheet carries site-global CSS, theme tokens, and the
// extracted app atoms. The gallery's @kovojs/ui atoms are copied separately to
// /assets/kovo-ui.css so docs/landing routes do not pay for package component
// CSS they never render.
const SITE_CSS_MIN_BYTES = 5_000;
const SITE_CSS_REQUIRED_ATOMS = ['kv-button-', 'kv-switch-', 'kv-dialog-'];
const SITE_APP_CSS_REQUIRED_ATOMS = [
  'kv-style-bg-',
  'kv-style-fg-',
  'kv-style-d-',
  'kv-style-pad-',
  'kv-style-font-',
];
const STAGED_STATIC_EXPORT_PUBLIC_ASSETS = [
  {
    content: 'Staged during site export; overwritten by site/src/aux.ts.\n',
    path: 'llms.txt',
  },
  {
    // The Avatar gallery intentionally renders its error-state fixture with
    // this URL. The bytes are deliberately not a decodable PNG, preserving the
    // browser error path while avoiding a static-host 404.
    content: 'invalid image payload for the Avatar error-state fixture\n',
    path: 'avatars/missing.png',
  },
];

function findUndefinedCustomProperties(css) {
  const defined = new Set([...css.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]));
  return [...referenced]
    .filter((property) => !defined.has(property))
    .sort((left, right) => left.localeCompare(right));
}

function stylesheetClassSelectors(css) {
  return new Set([...css.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map((match) => match[1]));
}

function htmlClassNames(html) {
  const classes = new Set();
  for (const match of html.matchAll(/\bclass="([^"]*)"/g)) {
    for (const className of match[1].split(/\s+/)) {
      if (className) classes.add(className);
    }
  }
  return classes;
}

export function assertExportedAppStyleClassCoverage(artifacts, css, stylesheetPath) {
  const selectors = stylesheetClassSelectors(css);
  const missing = [];
  for (const artifact of artifacts) {
    const missingForArtifact = [...htmlClassNames(artifact.body)]
      .filter((className) => className.startsWith('kv-style-') && !selectors.has(className))
      .sort((left, right) => left.localeCompare(right));
    if (missingForArtifact.length === 0) continue;
    missing.push(
      `${artifact.path}: ${missingForArtifact.slice(0, 12).join(', ')}${
        missingForArtifact.length > 12 ? ` (+${missingForArtifact.length - 12} more)` : ''
      }`,
    );
  }
  if (missing.length === 0) return;

  throw new Error(
    `site export: exported HTML uses app style classes that are missing from ${stylesheetPath}. ` +
      `This would ship the site unstyled. Missing selectors: ${missing.slice(0, 8).join('; ')}`,
  );
}

// Pure content guard for the served stylesheet: throw a clear, actionable error
// if it is short or missing site app atoms. Exported for resilience tests.
export function assertServedStylesheetContent(css, stylesheetPath) {
  const problems = [];
  if (css.length < SITE_CSS_MIN_BYTES) {
    problems.push(`is only ${css.length} bytes (expected > ${SITE_CSS_MIN_BYTES})`);
  }
  const missingAtoms = SITE_APP_CSS_REQUIRED_ATOMS.filter((atom) => !css.includes(atom));
  if (missingAtoms.length > 0) {
    problems.push(`is missing site app atoms (${missingAtoms.join(', ')})`);
  }
  const undefinedCustomProperties = findUndefinedCustomProperties(css);
  if (undefinedCustomProperties.length > 0) {
    problems.push(
      `references undefined CSS custom properties (${undefinedCustomProperties.join(', ')})`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `site export: the served stylesheet ${stylesheetPath} ${problems.join(' and ')}. ` +
        `The docs shell would render without its app CSS. Check that app CSS extraction ran.`,
    );
  }
}

export function assertServedUiStylesheetContent(css, stylesheetPath) {
  const missingAtoms = SITE_CSS_REQUIRED_ATOMS.filter((atom) => !css.includes(atom));
  if (missingAtoms.length === 0) return;

  throw new Error(
    `site export: the gallery stylesheet ${stylesheetPath} is missing required component atoms ` +
      `(${missingAtoms.join(', ')}). The gallery would render unstyled. This usually means ` +
      `@kovojs/ui's component CSS was not extracted — check that site/node_modules/@kovojs/{ui,headless-ui} ` +
      `are valid workspace symlinks (run \`pnpm install\` at the repo root).`,
  );
}

export function assertExtractedComponentCss(componentCss) {
  const missingAtoms = SITE_CSS_REQUIRED_ATOMS.filter((atom) => !componentCss.includes(atom));
  if (missingAtoms.length > 0) {
    throw new Error(
      `site export: extracted @kovojs/ui component CSS is empty or missing required atoms ` +
        `(${missingAtoms.join(', ')}); it would ship the gallery unstyled. ` +
        `Got ${componentCss.length} bytes from \`kovo compile package-css\`. ` +
        `Check that site/node_modules/@kovojs/{ui,headless-ui} are valid workspace symlinks ` +
        `(run \`pnpm install\` at the repo root).`,
    );
  }
}

export async function buildSiteUiCss(outPath = uiStylesheetPath) {
  const missingDepHint = (dep, cause) =>
    new Error(
      `site export: cannot resolve "${dep}". The gallery's component CSS (kv-button-/kv-switch-/` +
        `kv-dialog- atoms) comes from this package; without it the site ships an unstyled gallery. ` +
        `This usually means the workspace symlink site/node_modules/${dep} is missing. ` +
        `Run \`pnpm install\` (or \`corepack pnpm install\`) at the repo root to restore it.` +
        (cause ? `\nUnderlying error: ${cause}` : ''),
    );

  try {
    import.meta.resolve('@kovojs/ui');
  } catch (error) {
    throw missingDepHint('@kovojs/ui', error?.message ?? error);
  }

  const { siteThemeCss } = await import('../src/theme.js');
  const tempRoot = mkdtempSync(path.resolve(tmpdir(), 'kovo-site-ui-css-'));
  const componentCssPath = path.resolve(tempRoot, 'kovo-ui-components.css');

  try {
    let output;
    try {
      output = execFileSync(
        'kovo',
        [
          'compile',
          'package-css',
          '@kovojs/ui',
          '--entry',
          path.resolve(siteRoot, 'src/app.tsx'),
          '--out',
          componentCssPath,
        ],
        { cwd: siteRoot, encoding: 'utf8' },
      );
    } catch (error) {
      throw new Error(
        'site export: `kovo compile package-css @kovojs/ui` failed; the gallery component CSS ' +
          '(kv-button-/kv-switch-/kv-dialog- atoms) could not be extracted. Ensure the workspace ' +
          'symlinks site/node_modules/@kovojs/{ui,cli} exist (run `pnpm install` at the repo root).' +
          `\nUnderlying error: ${error?.stderr || error?.message || error}`,
      );
    }

    const warnedFiles = [...output.matchAll(/^WARN package-css file=("[^"]+")/gm)].map((match) =>
      JSON.parse(match[1]),
    );
    for (const fileName of warnedFiles) {
      console.warn(`site export: ${fileName}: package component CSS extraction warning`);
    }

    const componentCss = readFileSync(componentCssPath, 'utf8');
    assertExtractedComponentCss(componentCss);

    const banner =
      '/* GENERATED during site export - do not edit.\n' +
      '   @kovojs/ui design tokens + component StyleX CSS (SPEC §6.1.1, §13.1). */\n';
    const css = `${banner}\n${siteThemeCss}\n\n${componentCss}\n`;

    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, css);
    return { css, outPath };
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

export async function stageStaticExportReferencedPublicAssets(rootDir = cssDistDir) {
  await writeScriptArtifacts(rootDir, STAGED_STATIC_EXPORT_PUBLIC_ASSETS);
}

// Resolve the bundled stylesheet from the Vite manifest.
function builtStylesheetPath() {
  const manifestPath = path.join(cssDistDir, '.vite/manifest.json');
  let stylesheetRelPath;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    stylesheetRelPath = manifest['src/styles.css']?.file;
  } catch (error) {
    throw new Error(
      `site export: could not read the CSS build manifest at ${manifestPath}; ` +
        `the bundled /assets/site.css cannot be verified. Did the secure Vite build run?` +
        `\nUnderlying error: ${error?.message ?? error}`,
    );
  }
  if (!stylesheetRelPath) {
    throw new Error(
      `site export: CSS build manifest at ${manifestPath} has no "src/styles.css" entry; ` +
        `the bundled /assets/site.css cannot be located.`,
    );
  }

  return path.join(cssDistDir, stylesheetRelPath);
}

function assertServedStylesheet() {
  const stylesheetPath = builtStylesheetPath();
  let css;
  try {
    css = readFileSync(stylesheetPath, 'utf8');
  } catch (error) {
    throw new Error(
      `site export: bundled stylesheet ${stylesheetPath} is missing; the secure Vite build did not ` +
        `produce the served /assets/site.css.\nUnderlying error: ${error?.message ?? error}`,
    );
  }

  assertServedStylesheetContent(css, stylesheetPath);
  assertServedUiStylesheetContent(readFileSync(uiStylesheetPath, 'utf8'), uiStylesheetPath);
}

export function assertExtractedSiteAppCss(css) {
  const missingAtoms = SITE_APP_CSS_REQUIRED_ATOMS.filter((atom) => !css.includes(atom));
  if (missingAtoms.length === 0) return;

  throw new Error(
    `site export: extracted site app CSS is missing required atoms (${missingAtoms.join(', ')}). ` +
      `The docs shell would render unstyled. Ensure site/src components use static style.create(...) ` +
      `values that the compiler can extract.`,
  );
}

async function appendSiteAppCssToBuiltStylesheet() {
  const appStyleEntryPaths = [
    path.join(siteRoot, 'src/app.tsx'),
    // Component pages fold static gallery fixture HTML from examples/gallery into
    // the site document; extract those authored style.create(...) atoms too.
    path.resolve(siteRoot, '../examples/gallery/src/demo-fixtures.tsx'),
  ];
  const { extractAppComponentCss } = await import('@kovojs/compiler');
  const results = appStyleEntryPaths.map((fileName) =>
    extractAppComponentCss({
      fileName,
      packagePrefixDiscoveryRoot: path.dirname(fileName),
      source: readFileSync(fileName, 'utf8'),
    }),
  );
  const diagnostics = results.flatMap((result) => result.diagnostics);
  const css = results
    .map((result) => result.css)
    .filter((chunk) => typeof chunk === 'string' && chunk.length > 0)
    .join('\n\n');
  if (!css) {
    throw new Error(
      'site export: no site app CSS was extracted; the docs shell would render unstyled.',
    );
  }
  if (diagnostics.length > 0) {
    throw new Error(
      `site export: site app CSS extraction warnings:\n${diagnostics
        .map((diagnostic) => `- ${diagnostic.fileName}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }

  assertExtractedSiteAppCss(css);
  const stylesheetPath = builtStylesheetPath();
  const currentCss = readFileSync(stylesheetPath, 'utf8');
  writeFileSync(stylesheetPath, `${currentCss.trimEnd()}\n\n${css.trim()}\n`);
}

export async function exportSiteStaticApp({
  createViteServer = createSecurityLockedViteServer,
  outDir = defaultDistDir,
  skipPipeline = false,
} = {}) {
  // The CLI command module imports Vite. Establish the compiler/server realm
  // lock before even evaluating that trusted runner graph (SPEC §6.6 rule 6).
  await securityLockedViteRuntime();
  const { runExportCommandStructured } =
    await import('../../packages/cli/src/commands/build-export.js');
  if (!skipPipeline) await runContentPipeline();
  // The export owns the whole static-host directory; clear stale routes/assets
  // so removed pages cannot linger (the W9 link gate would otherwise pass on
  // orphaned files). dist-css holds the Vite manifest and is left untouched.
  await rm(outDir, { force: true, recursive: true });
  await buildWithSecurityLockedVite({ root: siteRoot });
  await appendSiteAppCssToBuiltStylesheet();
  await buildSiteUiCss();
  // Fail loudly if the bundled stylesheet is short or missing app atoms,
  // rather than shipping an unstyled docs shell (SPEC §6.1.1, §13.1).
  assertServedStylesheet();
  await stageStaticExportReferencedPublicAssets();

  const manifestFile = path.join(cssDistDir, '.vite/manifest.json');
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: siteRoot,
    server: { hmr: false, middlewareMode: true, watch: null, ws: false },
  });
  let auxModule;
  let examplesModule;
  let staticExportResult;
  try {
    const [loadedAuxModule, loadedExamplesModule] = await Promise.all([
      viteServer.ssrLoadModule('/src/aux.ts'),
      viteServer.ssrLoadModule('/src/examples.ts'),
    ]);
    auxModule = loadedAuxModule;
    examplesModule = loadedExamplesModule;
    await auxModule.stageMarkdownMirrorPublicAssets(cssDistDir);
    const exportResult = await runExportCommandStructured({
      appModulePath: '/src/app.tsx',
      distDir: cssDistDir,
      manifestFile,
      outDir,
      root: siteRoot,
      vite: true,
    });
    if ('error' in exportResult) {
      throw new Error(exportResult.error || 'kovo export failed');
    }
    if (exportResult.exitCode !== 0) {
      throw new Error(exportResult.output || 'kovo export failed');
    }
    staticExportResult = exportResult.staticExport;
  } finally {
    await viteServer.close();
  }

  const stylesheetPath = builtStylesheetPath();
  assertExportedAppStyleClassCoverage(
    staticExportResult.artifacts,
    readFileSync(stylesheetPath, 'utf8'),
    stylesheetPath,
  );

  // public/ (fonts + the gallery runtime shim) is verbatim static hosting,
  // outside the manifest; copy it alongside the replayed documents.
  await cp(publicDir, outDir, { recursive: true });
  await mkdir(path.join(outDir, 'assets'), { recursive: true });
  await cp(uiStylesheetPath, path.join(outDir, 'assets/kovo-ui.css'));

  // Agent/static-host surface (search index, llms.txt, raw .md mirrors, 404)
  // and the embedded example apps the iframes point at.
  await auxModule.emitAuxOutputs(outDir);
  await examplesModule.exportExampleApps(outDir);

  return staticExportResult;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await exportSiteStaticApp(parseCliOptions(process.argv.slice(2)));

    for (const diagnostic of result.diagnostics) {
      process.stderr.write(`${formatStaticExportDiagnostic(diagnostic, 'WARN')}\n`);
      process.exitCode = 1;
    }

    process.stdout.write(
      [
        'site-export/v1',
        `html=${result.artifacts.length}`,
        `client-modules=${result.clientModules.length}`,
        `assets=${result.assets.length}`,
        `manifest-html=${result.artifacts.length}`,
        `diagnostics=${result.diagnostics.length}`,
        '',
      ].join('\n'),
    );
  } catch (error) {
    if (!isStaticExportDiagnosticError(error)) throw error;
    process.stderr.write(
      ['site-export/v1', ...formatStaticExportDiagnostics(error.diagnostics, 'ERROR'), ''].join(
        '\n',
      ),
    );
    process.exitCode = 1;
  }
}

function parseCliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out') {
      const outDir = args[index + 1];
      if (!outDir) throw new Error('Missing value for site export option --out.');
      options.outDir = path.resolve(process.cwd(), outDir);
      index += 1;
      continue;
    }
    if (arg === '--skip-pipeline') {
      options.skipPipeline = true;
      continue;
    }
    throw new Error(`Unknown site export option '${arg}'.`);
  }
  return options;
}

function isStaticExportDiagnosticError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    Array.isArray(error.diagnostics) &&
    error.diagnostics.every(isStaticExportDiagnostic)
  );
}

function isStaticExportDiagnostic(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.routePath === 'string'
  );
}

function formatStaticExportDiagnostics(diagnostics, severity) {
  return diagnostics.map((diagnostic) => formatStaticExportDiagnostic(diagnostic, severity));
}

function formatStaticExportDiagnostic(diagnostic, severity) {
  return `${severity} ${diagnostic.code} route=${diagnostic.routePath} ${stableText(
    diagnostic.message,
  )}`;
}

function stableText(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}
