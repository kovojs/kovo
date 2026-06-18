import { execFileSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

import { runContentPipeline } from './content-pipeline.mjs';
import { emitSiteRoutes } from './emit-routes.mjs';

// SPEC §9.5: the docs site's static export uses the command facade for route
// replay, /c/ client modules, and Vite manifest assets. This script only owns
// site-specific content generation and extra static files.

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const cssDistDir = path.join(siteRoot, 'dist-css');
const publicDir = path.join(siteRoot, 'public');
const defaultDistDir = path.join(siteRoot, 'dist');

export async function exportSiteStaticApp({
  createViteServer = createServer,
  outDir = defaultDistDir,
  skipPipeline = false,
} = {}) {
  if (!skipPipeline) await runContentPipeline();
  await emitSiteRoutes({ skipPipeline: true });
  // The export owns the whole static-host directory; clear stale routes/assets
  // so removed pages cannot linger (the W9 link gate would otherwise pass on
  // orphaned files). dist-css holds the Vite manifest and is left untouched.
  await rm(outDir, { force: true, recursive: true });
  execFileSync('vp', ['build'], { cwd: siteRoot, stdio: 'inherit' });

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
        '/src/generated/app.kovo-route.tsx',
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

  // Agent/static-host surface (search index, llms.txt, raw .md mirrors, 404)
  // and the embedded example apps the iframes point at.
  await auxModule.emitAuxOutputs(outDir);
  await examplesModule.exportExampleApps(outDir);

  return siteExportResultFromKovoOutput(exportOutput);
}

async function captureKovoCommandOutput(run) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;

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
  const count = (prefix) =>
    output
      .split(/\r?\n/)
      .filter((line) => line.startsWith(prefix))
      .length;
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
