import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const requireFromRunner = createRequire(import.meta.url);
const runtimeBootstrapUrl = pathToFileURL(
  requireFromRunner.resolve('@kovojs/server/runtime-bootstrap'),
).href;
const workerUrl = new URL('./static-export-worker.ts', import.meta.url).href;

export interface StaticExportSuccess {
  artifacts: readonly string[];
  clientModules: readonly string[];
  diagnostics: readonly unknown[];
  renders: number;
  status: 'ok';
}

export interface StaticExportRejection {
  code?: string;
  diagnostics: readonly {
    code?: string;
    message?: string;
    routePath?: string;
  }[];
  status: 'rejected';
}

export type StaticExportCaseResult = StaticExportSuccess | StaticExportRejection;
export type StaticExportCase = 'l0-l1' | 'rejects-dynamic';

/** Run a direct static-export proof in a pristine, bootstrap-first framework-owned child. */
export function runStaticExportCase(
  testCase: StaticExportCase,
  outDir: string,
): StaticExportCaseResult {
  const childSource = `
const { existsSync } = require('node:fs');
const { registerHooks } = require('node:module');

// Workspace packages expose TypeScript source. Install only the framework-owned relative-edge
// resolver before lockdown; no authored package or test module is evaluated at this point.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

void (async () => {
  // SPEC §6.6 rule 6: generated/framework runners establish this transition before importing
  // the worker, server barrel, or authored fixture graph.
  await import(${JSON.stringify(runtimeBootstrapUrl)});
  const worker = await import(${JSON.stringify(workerUrl)});
  const result = await worker.runStaticExportCaseInLockedChild(
    ${JSON.stringify(testCase)},
    ${JSON.stringify(outDir)},
  );
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
`;
  const child = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--input-type=commonjs',
      '--eval',
      childSource,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    },
  );

  if (child.error !== undefined) throw child.error;
  if (child.status !== 0) {
    throw new Error(
      `Bootstrap-first static export worker failed (${String(child.status)}): ${child.stderr.trim()}`,
    );
  }

  return JSON.parse(child.stdout) as StaticExportCaseResult;
}
