import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

import { runContentPipeline } from './content-pipeline.mjs';
import { emitSiteUiCss } from './emit-ui-css.mjs';

// SPEC §9.5: the docs site's static export uses the command facade for route
// replay, /c/ client modules, and Vite manifest assets. This script only owns
// site-specific content generation and extra static files.

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const cssDistDir = path.join(siteRoot, 'dist-css');
const publicDir = path.join(siteRoot, 'public');
const defaultDistDir = path.join(siteRoot, 'dist');

// The global served stylesheet carries site-global CSS, theme tokens, and the
// extracted app atoms. The gallery's @kovojs/ui atoms are copied separately to
// /assets/kovo-ui.css so docs/landing routes do not pay for package component
// CSS they never render.
const SITE_CSS_MIN_BYTES = 5_000;
const SITE_CSS_REQUIRED_ATOMS = ['kv-button-', 'kv-switch-', 'kv-dialog-'];
const SITE_APP_CSS_REQUIRED_ATOMS = [
  'kv-site-landing-',
  'kv-site-chrome-',
  'kv-site-docs-layout-',
  'kv-site-gallery-',
  'kv-site-search-dialog-',
];

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
      `are valid workspace symlinks (run \`pnpm install\` at the repo root) and that emit-ui-css ran.`,
  );
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
        `the bundled /assets/site.css cannot be verified. Did \`vp build\` run?` +
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
      `site export: bundled stylesheet ${stylesheetPath} is missing; \`vp build\` did not ` +
        `produce the served /assets/site.css.\nUnderlying error: ${error?.message ?? error}`,
    );
  }

  assertServedStylesheetContent(css, stylesheetPath);
  assertServedUiStylesheetContent(
    readFileSync(path.join(siteRoot, 'src/generated/kovo-ui.css'), 'utf8'),
    path.join(siteRoot, 'src/generated/kovo-ui.css'),
  );
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
  const appModulePath = path.join(siteRoot, 'src/app.tsx');
  const { extractAppComponentCss } = await import('@kovojs/compiler/package-styles');
  const result = extractAppComponentCss({
    fileName: appModulePath,
    packagePrefixDiscoveryRoot: path.dirname(appModulePath),
    source: readFileSync(appModulePath, 'utf8'),
  });
  if (!result.css) {
    throw new Error(
      'site export: no site app CSS was extracted; the docs shell would render unstyled.',
    );
  }
  if (result.diagnostics.length > 0) {
    throw new Error(
      `site export: site app CSS extraction warnings:\n${result.diagnostics
        .map((diagnostic) => `- ${diagnostic.fileName}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }

  assertExtractedSiteAppCss(result.css);
  const stylesheetPath = builtStylesheetPath();
  const currentCss = readFileSync(stylesheetPath, 'utf8');
  writeFileSync(stylesheetPath, `${currentCss.trimEnd()}\n\n${result.css.trim()}\n`);
}

export async function exportSiteStaticApp({
  createViteServer = createServer,
  outDir = defaultDistDir,
  skipPipeline = false,
} = {}) {
  if (!skipPipeline) await runContentPipeline();
  // The export owns the whole static-host directory; clear stale routes/assets
  // so removed pages cannot linger (the W9 link gate would otherwise pass on
  // orphaned files). dist-css holds the Vite manifest and is left untouched.
  await rm(outDir, { force: true, recursive: true });
  emitSiteUiCss();
  execFileSync('vp', ['build'], { cwd: siteRoot, stdio: 'inherit' });
  await appendSiteAppCssToBuiltStylesheet();
  // Fail loudly if the bundled stylesheet is short or missing app atoms,
  // rather than shipping an unstyled docs shell (SPEC §6.1.1, §13.1).
  assertServedStylesheet();

  const manifestFile = path.join(cssDistDir, '.vite/manifest.json');
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: siteRoot,
    server: { middlewareMode: true },
  });
  let exportOutput;
  let auxModule;
  let examplesModule;
  try {
    const [{ runKovoCommand }, loadedAuxModule, loadedExamplesModule] = await Promise.all([
      viteServer.ssrLoadModule('@kovojs/cli'),
      viteServer.ssrLoadModule('/src/aux.ts'),
      viteServer.ssrLoadModule('/src/examples.ts'),
    ]);
    auxModule = loadedAuxModule;
    examplesModule = loadedExamplesModule;
    const exportResult = await captureKovoCommandOutput(() =>
      runKovoCommand([
        'export',
        '/src/app.tsx',
        '--vite',
        '--root',
        siteRoot,
        '--out',
        outDir,
        '--manifest',
        manifestFile,
        '--dist',
        cssDistDir,
      ]),
    );
    if (exportResult.exitCode !== 0) {
      throw new Error(exportResult.stderr || exportResult.stdout || 'kovo export failed');
    }
    exportOutput = exportResult.stdout;
  } finally {
    await viteServer.close();
  }

  // public/ (fonts + the gallery runtime shim) is verbatim static hosting,
  // outside the manifest; copy it alongside the replayed documents.
  await cp(publicDir, outDir, { recursive: true });
  await mkdir(path.join(outDir, 'assets'), { recursive: true });
  await cp(
    path.join(siteRoot, 'src/generated/kovo-ui.css'),
    path.join(outDir, 'assets/kovo-ui.css'),
  );

  // Agent/static-host surface (search index, llms.txt, raw .md mirrors, 404)
  // and the embedded example apps the iframes point at.
  await auxModule.emitAuxOutputs(outDir);
  await examplesModule.exportExampleApps(outDir);

  return siteExportResultFromKovoOutput(exportOutput);
}

async function captureKovoCommandOutput(run) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  try {
    process.stdout.write = (chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    };
    process.stderr.write = (chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    return {
      exitCode: await run(),
      stderr: stderrChunks.join(''),
      stdout: stdoutChunks.join(''),
    };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

function siteExportResultFromKovoOutput(output) {
  const count = (prefix) => output.split(/\r?\n/).filter((line) => line.startsWith(prefix)).length;
  const diagnostics = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('WARN '))
    .map((line) => ({ code: line.split(/\s+/)[1] ?? 'KV229', message: line, routePath: 'app' }));

  const htmlCount = count('HTML ');

  return {
    artifacts: Array.from({ length: htmlCount }),
    assets: Array.from({ length: count('ASSET ') }),
    clientModules: Array.from({ length: count('CLIENT-MODULE ') }),
    diagnostics,
    manifest: { routeDocuments: Array.from({ length: htmlCount }) },
  };
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
        `manifest-html=${result.manifest?.routeDocuments.length ?? 0}`,
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
