import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const viteEntry = resolve(
  dirname(require.resolve('vitest/package.json')),
  '../vite/dist/node/index.js',
);
const { createServer } = await import(pathToFileURL(viteEntry).href);

const server = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'silent',
  root: repoRoot,
  server: { middlewareMode: true },
});

try {
  const { compilerPerfCorpora } = await server.ssrLoadModule('/tests/compiler-perf-corpora.ts');
  const { compileComponentModule } = await server.ssrLoadModule('/packages/compiler/src/index.ts');
  const signatures = [];

  for (const corpus of compilerPerfCorpora()) {
    for (const file of corpus.files) {
      const result = compileComponentModule({
        fileName: file.fileName,
        ...(file.registryFacts === undefined ? {} : { registryFacts: file.registryFacts }),
        source: file.source,
      });
      const diagnostics = result.diagnostics.map(
        (diagnostic) => `${diagnostic.code} ${diagnostic.fileName}: ${diagnostic.message}`,
      );
      if (diagnostics.length > 0) {
        throw new Error(`compiler diagnostics in ${file.fileName}: ${diagnostics.join('; ')}`);
      }

      signatures.push({
        clientExports: result.clientExports,
        componentGraphFacts: result.componentGraphFacts,
        corpus: corpus.name,
        cssAssets: result.cssAssets,
        fileName: file.fileName,
        files: result.files,
        handlerExports: result.handlerExports,
        outputContextFacts: result.outputContextFacts,
        platformSubstitutions: result.platformSubstitutions,
        queryUpdatePlans: result.queryUpdatePlans,
        registryFacts: file.registryFacts ?? null,
        renderEquivalenceChecks: result.renderEquivalenceChecks,
        updateCoverage: result.updateCoverage,
        viewTransitions: result.viewTransitions,
      });
    }
  }

  process.stdout.write(`${JSON.stringify({ fileCount: signatures.length, signatures })}\n`);
} finally {
  await server.close();
}
