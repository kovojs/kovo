import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runVerifiedBuild, SOURCE_PATH } from './workload.mjs';

export function benchmarkQueryPlanBootstrapInput(evidence, options = {}) {
  const readSource = options.readSource ?? ((fileName) => readFileSync(fileName, 'utf8'));
  const compileComponent = options.compileComponent;
  if (typeof compileComponent !== 'function') {
    throw new TypeError('packed browser build requires the public compiler source-fact entrypoint');
  }
  const source = readSource(SOURCE_PATH);
  const compiled = compileComponent({
    fileName: evidence?.queryPlanComponent?.sourceFile ?? SOURCE_PATH,
    source,
    sourceProvenance: 'app',
  });
  const metadata = compiled?.queryPlanBootstrapMetadata;
  if (typeof metadata?.componentName !== 'string' || metadata.componentName.length === 0) {
    throw new TypeError('packed browser compiler facts require an exact componentName');
  }
  if (
    typeof metadata.exportName !== 'string' ||
    !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(metadata.exportName)
  ) {
    throw new TypeError('packed browser compiler facts require an exact query-plan exportName');
  }
  const builtFacts = evidence?.queryPlanComponent;
  if (
    typeof builtFacts?.componentName !== 'string' ||
    !Array.isArray(builtFacts.queryNames) ||
    builtFacts.queryNames.some(
      (queryName) => typeof queryName !== 'string' || queryName.length === 0,
    )
  ) {
    throw new TypeError('packed browser build evidence requires exact owner/query graph facts');
  }
  const rawQueryNames = metadata.queryNames;
  if (
    rawQueryNames !== undefined &&
    (typeof rawQueryNames !== 'object' || rawQueryNames === null || Array.isArray(rawQueryNames))
  ) {
    throw new TypeError('packed browser compiler facts require an exact queryNames map');
  }
  let queryNames = rawQueryNames ?? {};
  let queryEntries = Object.entries(queryNames);
  if (queryEntries.length === 0) {
    const localQueryNames = Array.isArray(compiled.queryUpdatePlans)
      ? [
          ...new Set(
            compiled.queryUpdatePlans
              .map((plan) => plan?.query)
              .filter((name) => name !== undefined),
          ),
        ]
      : [];
    if (
      localQueryNames.length !== 1 ||
      typeof localQueryNames[0] !== 'string' ||
      localQueryNames[0].length === 0 ||
      builtFacts.queryNames.length !== 1
    ) {
      throw new TypeError(
        'packed browser compiler facts require one exact local/runtime query mapping',
      );
    }
    queryNames = { [localQueryNames[0]]: builtFacts.queryNames[0] };
    queryEntries = Object.entries(queryNames);
  }
  if (
    queryEntries.some(
      ([localName, runtimeName]) =>
        localName.length === 0 || typeof runtimeName !== 'string' || runtimeName.length === 0,
    )
  ) {
    throw new TypeError('packed browser compiler facts require non-empty queryNames mappings');
  }
  const compiledQueryNames = queryEntries.map(([, runtimeName]) => runtimeName).sort();
  const builtQueryNames = [...builtFacts.queryNames].sort();
  if (
    metadata.componentName !== builtFacts.componentName ||
    compiledQueryNames.length !== builtQueryNames.length ||
    compiledQueryNames.some((queryName, index) => queryName !== builtQueryNames[index])
  ) {
    throw new Error('packed browser compiler facts diverged from the built app graph');
  }
  if (typeof evidence.clientFile !== 'string' || evidence.clientFile.length === 0) {
    throw new TypeError('packed browser build evidence requires an exact client module file');
  }
  return {
    ...(metadata.clockExportName === undefined
      ? {}
      : { clockExportName: metadata.clockExportName }),
    componentName: metadata.componentName,
    exportName: metadata.exportName,
    importPath: `../${evidence.clientFile}`,
    queryNames,
  };
}

export async function buildBenchmarkBrowserBundle(options = {}) {
  const compiler =
    options.compileComponent === undefined || options.emitBootstrap === undefined
      ? await import('@kovojs/compiler')
      : null;
  const compileComponent = options.compileComponent ?? compiler.compileComponentModule;
  const runBuild = options.runBuild ?? runVerifiedBuild;
  const emitBootstrap = options.emitBootstrap ?? compiler.emitQueryPlanBootstrapModule;
  const outputRoot = options.outputRoot ?? 'dist/.kovo/client';
  const evidence = runBuild();
  const input = benchmarkQueryPlanBootstrapInput(evidence, { ...options, compileComponent });
  const bootstrap = emitBootstrap([input]);
  if (bootstrap.fileName !== 'generated/app.client.js') {
    throw new Error('compiler returned a non-canonical Kovo app bootstrap path');
  }
  if (
    !bootstrap.source.includes(input.exportName) ||
    !bootstrap.source.includes(evidence.clientFile) ||
    !bootstrap.source.includes(input.componentName)
  ) {
    throw new Error('compiler-generated Kovo app bootstrap is not bound to exact source facts');
  }

  const output = path.join(outputRoot, bootstrap.fileName);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, bootstrap.source);
  if (readFileSync(output, 'utf8') !== bootstrap.source) {
    throw new Error('compiler-generated Kovo app bootstrap was not written byte-for-byte');
  }
  return { bootstrap, evidence, input, output };
}

const invokedPath =
  process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  await buildBenchmarkBrowserBundle();
}
