#!/usr/bin/env node
/**
 * Current-split versus unsplit route CSS counterfactual for plans/good-perf.md Phase 3.
 *
 * This is a byte/correctness study, not a timing benchmark. It bundles the current compiler CSS
 * implementation directly from source, derives its candidate chunks from the real matched Kovo
 * stylesheet, and compares those chunks with the globally cached unsplit source asset. The fixture
 * pins the stylesheet, route registry, browser workload, and shared matched-content manifest. Any
 * drift fails closed rather than silently turning this into a synthetic benchmark. Brotli-11
 * static-asset bytes are the primary network decision representation; identity bytes are also
 * reported so duplicated source CSS cannot hide behind codec effects.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

import { build as esbuild } from 'esbuild';
import ts from 'typescript';

import { readArg } from '../benchmarks/harness/args.mjs';
import { canonicalJson, performanceHostFingerprint } from './lib/perf-host.mjs';
import { collectPerformanceProvenance } from './lib/perf-provenance.mjs';

export const ROUTE_CSS_FIXTURE_SCHEMA = 'kovo-route-css-workload/v2';
export const ROUTE_CSS_REPORT_SCHEMA = 'kovo-route-css-counterfactual/v2';
export const ROUTE_CSS_DERIVATION_ALGORITHM = 'tsx-component-css-class-ownership/v2';

const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const DEFAULT_FIXTURE = fileURLToPath(
  new URL('./fixtures/perf-route-css/workload.json', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export async function loadRouteCssFixture(fixturePath = DEFAULT_FIXTURE, dependencies = {}) {
  const read = dependencies.readFile ?? readFile;
  const absolutePath = confinedRepoPath(fixturePath, 'route CSS fixture');
  const text = await read(absolutePath, 'utf8');
  const value = JSON.parse(text);
  if (value?.schema !== ROUTE_CSS_FIXTURE_SCHEMA) {
    throw new TypeError(`route CSS fixture schema must be ${ROUTE_CSS_FIXTURE_SCHEMA}`);
  }
  const name = requiredString(value.name, 'fixture.name');
  const rawSources = nonEmptyArray(value.sources, 'fixture.sources');
  const rawPartitions = nonEmptyArray(value.partitions, 'fixture.partitions');
  const rawRoutes = nonEmptyArray(value.routes, 'fixture.routes');
  const rawSessions = nonEmptyArray(value.sessions, 'fixture.sessions');
  if (rawRoutes.length < 2)
    throw new TypeError('route CSS fixture must declare at least two routes');

  const sourceIds = new Set();
  const sourceFiles = new Set();
  const sources = [];
  for (const [index, rawSource] of rawSources.entries()) {
    const label = `fixture.sources[${String(index)}]`;
    const id = uniqueString(rawSource?.id, `${label}.id`, sourceIds);
    const file = uniqueString(rawSource?.file, `${label}.file`, sourceFiles);
    const expectedDigest = requiredSha256(rawSource?.expectedDigest, `${label}.expectedDigest`);
    const filePath = confinedRepoPath(path.join(repoRoot, file), `${label}.file`);
    const sourceText = await read(filePath, 'utf8');
    const digest = sha256(sourceText);
    if (digest !== expectedDigest) {
      throw new Error(
        `${label}.file source digest mismatch for ${file}: expected ${expectedDigest}, got ${digest}`,
      );
    }
    const evidence = (rawSource?.evidence ?? []).map((entry, evidenceIndex) => {
      const evidenceLabel = `${label}.evidence[${String(evidenceIndex)}]`;
      const evidenceText = requiredString(entry?.text, `${evidenceLabel}.text`);
      const occurrences = positiveInteger(entry?.occurrences, `${evidenceLabel}.occurrences`);
      const actualOccurrences = countOccurrences(sourceText, evidenceText);
      if (actualOccurrences !== occurrences) {
        throw new Error(
          `${evidenceLabel} expected ${String(occurrences)} occurrence(s) in ${file}, got ${String(actualOccurrences)}`,
        );
      }
      return { occurrences, text: evidenceText };
    });
    sources.push({ digest, evidence, expectedDigest, file, id, text: sourceText });
  }

  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const stylesheetSourceId = requiredString(value.stylesheetSource, 'fixture.stylesheetSource');
  const stylesheetSource = sourcesById.get(stylesheetSourceId);
  if (!stylesheetSource) {
    throw new TypeError(`fixture.stylesheetSource references ${stylesheetSourceId}`);
  }
  if (stylesheetSource.text.trim().length === 0) {
    throw new TypeError('fixture stylesheet source must contain non-empty CSS');
  }

  const partitionIds = new Set();
  const partitions = rawPartitions.map((rawPartition, index) => {
    const label = `fixture.partitions[${String(index)}]`;
    return {
      classes: uniqueStringList(rawPartition?.classes, `${label}.classes`),
      id: uniqueString(rawPartition?.id, `${label}.id`, partitionIds),
    };
  });
  if (!partitionIds.has('shared')) {
    throw new TypeError('fixture.partitions must declare the shared partition');
  }
  const routeSourceId = requiredString(value.routeSource, 'fixture.routeSource');
  const routeSource = sourcesById.get(routeSourceId);
  if (!routeSource) throw new TypeError(`fixture.routeSource references ${routeSourceId}`);
  const componentOwnership = {};
  if (
    !value.componentOwnership ||
    typeof value.componentOwnership !== 'object' ||
    Array.isArray(value.componentOwnership)
  ) {
    throw new TypeError('fixture.componentOwnership must be an object');
  }
  for (const partition of partitions) {
    componentOwnership[partition.id] = uniqueStringList(
      value.componentOwnership[partition.id],
      `fixture.componentOwnership.${partition.id}`,
    );
  }
  if (!sameStringSet(Object.keys(value.componentOwnership), [...partitionIds])) {
    throw new TypeError('fixture.componentOwnership keys must exactly match fixture partitions');
  }
  const derived = deriveCssPartitions(stylesheetSource.text, partitions, stylesheetSource.file, {
    componentOwnership,
    routeSourceFile: routeSource.file,
    routeSourceText: routeSource.text,
  });
  const assets = derived.assets;
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const routeIds = new Set();
  const routePaths = new Set();
  const routes = rawRoutes.map((rawRoute, index) => {
    const label = `fixture.routes[${String(index)}]`;
    const id = uniqueString(rawRoute?.id, `${label}.id`, routeIds);
    const routePath = uniqueString(rawRoute?.path, `${label}.path`, routePaths);
    if (!routePath.startsWith('/')) throw new TypeError(`${label}.path must be root-relative`);
    const assetRefs = uniqueStringList(rawRoute?.partitions, `${label}.partitions`);
    for (const assetId of assetRefs) {
      if (!assetsById.has(assetId)) {
        throw new TypeError(`${label}.partitions references ${assetId}`);
      }
    }
    if (!assetRefs.includes('shared')) {
      throw new TypeError(`${label}.partitions must include shared`);
    }
    if (!sameStringSet(assetRefs, ['shared', id])) {
      throw new TypeError(`${label}.partitions must contain exactly shared and ${id}`);
    }
    return { assetIds: assetRefs, id, path: routePath };
  });
  if (
    !sameStringSet(
      [...routeIds],
      [...partitionIds].filter((id) => id !== 'shared'),
    )
  ) {
    throw new TypeError('fixture route ids must exactly match its non-shared CSS partitions');
  }
  const usedAssets = new Set(routes.flatMap((route) => route.assetIds));
  for (const asset of assets) {
    if (!usedAssets.has(asset.id)) throw new TypeError(`fixture asset ${asset.id} is unreachable`);
  }

  const sessionIds = new Set();
  const sessions = rawSessions.map((rawSession, index) => {
    const label = `fixture.sessions[${String(index)}]`;
    const id = uniqueString(rawSession?.id, `${label}.id`, sessionIds);
    const routeRefs = nonEmptyStringList(rawSession?.routes, `${label}.routes`);
    if (routeRefs.length < 2)
      throw new TypeError(`${label}.routes must contain at least two visits`);
    for (const routeId of routeRefs) {
      if (!routeIds.has(routeId)) throw new TypeError(`${label}.routes references ${routeId}`);
    }
    if (!sameStringSet(routeRefs, [...routeIds])) {
      throw new TypeError(`${label}.routes must visit every matched route exactly once`);
    }
    return { id, routeIds: routeRefs };
  });

  const manifestDigest = sha256(text);
  const sourceDigests = Object.fromEntries(sources.map((source) => [source.file, source.digest]));
  const expectedSourceDigests = Object.fromEntries(
    sources.map((source) => [source.file, source.expectedDigest]),
  );
  const sourceBindingDigest = sha256(canonicalJson(sourceDigests));
  const derivationDigest = derived.identity.digest;
  const identity = {
    derivationDigest,
    expectedSourceDigests,
    fixtureDigest: sha256(canonicalJson({ derivationDigest, manifestDigest, sourceBindingDigest })),
    fixturePath: portableRelativePath(repoRoot, absolutePath),
    manifestDigest,
    name,
    schema: value.schema,
    sourceBindingDigest,
    sourceDigests,
    stylesheetPath: stylesheetSource.file,
  };
  return {
    assets,
    derivation: derived.identity,
    identity,
    routes,
    sessions,
    stylesheet: {
      css: stylesheetSource.text,
      digest: stylesheetSource.digest,
      file: stylesheetSource.file,
    },
  };
}

/**
 * Partition every byte of the pinned stylesheet using selector-class ownership. Rules referenced
 * by both routes remain shared; rules with no class selector are conservative shared CSS.
 */
export function deriveCssPartitions(stylesheet, partitions, sourceFile, routeBinding) {
  const rules = parseTopLevelCssRules(stylesheet);
  if (rules.length === 0) throw new TypeError('fixture stylesheet emitted no top-level CSS rules');
  if (rules.map((rule) => rule.css).join('') !== stylesheet) {
    throw new Error('route CSS derivation did not reconstruct the exact stylesheet bytes');
  }

  const partitionByClass = new Map();
  const declaredClasses = new Set();
  for (const partition of partitions) {
    for (const className of partition.classes) {
      if (partitionByClass.has(className)) {
        throw new TypeError(`fixture CSS class ${className} has multiple partition owners`);
      }
      partitionByClass.set(className, partition.id);
      declaredClasses.add(className);
    }
  }
  const componentFacts = deriveComponentClassOwnership(routeBinding, partitions);

  const observedClasses = new Set();
  const ruleEvidence = rules.map((rule, index) => {
    const classNames = cssRuleClassNames(rule);
    const owners = new Set();
    for (const className of classNames) {
      observedClasses.add(className);
      const owner = partitionByClass.get(className);
      if (!owner) {
        throw new Error(`stylesheet class ${className} has no declared partition owner`);
      }
      const componentOwner = componentFacts.ownerByClass.get(className) ?? 'shared';
      if (owner !== componentOwner) {
        throw new Error(
          `stylesheet class ${className} is declared ${owner} but the bound route source derives ${componentOwner}`,
        );
      }
      owners.add(componentOwner);
    }
    const owner = owners.size === 1 ? [...owners][0] : 'shared';
    return {
      classNames,
      css: rule.css,
      cssDigest: sha256(rule.css),
      index,
      owner,
      preludeDigest: sha256(rule.prelude),
    };
  });
  for (const className of declaredClasses) {
    if (!observedClasses.has(className)) {
      throw new Error(`declared partition class ${className} is absent from the stylesheet`);
    }
  }
  for (const className of componentFacts.allClasses) {
    if (!observedClasses.has(className)) {
      throw new Error(`bound route source class ${className} is absent from the stylesheet`);
    }
  }

  const assets = partitions.map((partition) => {
    const ownedRules = ruleEvidence.filter((rule) => rule.owner === partition.id);
    if (ownedRules.length === 0) {
      throw new Error(`fixture CSS partition ${partition.id} owns no rules`);
    }
    const css = ownedRules.map((rule) => rule.css).join('');
    return {
      className: `kovo-route-css-${partition.id}`,
      componentName: `matched-${partition.id}`,
      css,
      cssDigest: sha256(css),
      id: partition.id,
      ruleDigests: ownedRules.map((rule) => rule.cssDigest),
      sourceFileName: `${sourceFile.replace(/\.css$/u, '')}.${partition.id}.css`,
    };
  });
  const identityFacts = {
    algorithm: ROUTE_CSS_DERIVATION_ALGORITHM,
    assets: Object.fromEntries(
      assets.map((asset) => [
        asset.id,
        { cssDigest: asset.cssDigest, ruleDigests: asset.ruleDigests },
      ]),
    ),
    rules: ruleEvidence.map(({ classNames, cssDigest, index, owner, preludeDigest }) => ({
      classNames,
      cssDigest,
      index,
      owner,
      preludeDigest,
    })),
    sourceDigest: sha256(stylesheet),
    sourceFile,
    sourceReconstructionDigest: sha256(rules.map((rule) => rule.css).join('')),
    routeSource: componentFacts.identity,
  };
  return {
    assets,
    identity: { ...identityFacts, digest: sha256(canonicalJson(identityFacts)) },
  };
}

/** Bundle the exact current CSS splitter source and authenticate every esbuild input. */
export async function bundleCurrentCssSplitter(options = {}) {
  const build = options.build ?? esbuild;
  const entryPoint = path.join(repoRoot, 'packages/compiler/src/css.ts');
  const built = await build({
    absWorkingDir: repoRoot,
    bundle: true,
    entryPoints: [entryPoint],
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    platform: 'node',
    sourcemap: false,
    target: `node${process.versions.node.split('.')[0]}`,
    write: false,
  });
  const output = built.outputFiles?.length === 1 ? built.outputFiles[0] : undefined;
  if (!output || !built.metafile)
    throw new Error('could not bundle the current compiler CSS source');
  const inputs = {};
  for (const input of Object.keys(built.metafile.inputs).sort()) {
    const absoluteInput = path.resolve(repoRoot, input);
    if (!existsSync(absoluteInput))
      throw new Error(`compiler CSS bundle input is missing: ${input}`);
    inputs[portableRelativePath(repoRoot, absoluteInput)] = sha256(await readFile(absoluteInput));
  }
  const bytes = Buffer.from(output.contents);
  const bundleRoot = await mkdtemp(path.join(repoRoot, 'node_modules/kovo-route-css-compiler-'));
  const bundlePath = path.join(bundleRoot, 'css-splitter.mjs');
  let compiler;
  try {
    await writeFile(bundlePath, bytes);
    compiler = await import(`${pathToFileURL(bundlePath).href}?digest=${bareSha256(bytes)}`);
  } finally {
    await rm(bundleRoot, { force: true, recursive: true });
  }
  for (const name of [
    'collectCssAssetManifest',
    'cssRouteByteAccounting',
    'cssRouteDeliveryGate',
    'dedupeCss',
  ]) {
    if (typeof compiler[name] !== 'function') {
      throw new Error(`current compiler CSS bundle omitted ${name}`);
    }
  }
  return {
    compiler,
    identity: {
      bundleDigest: sha256(bytes),
      entryPoint: portableRelativePath(repoRoot, entryPoint),
      inputDigest: sha256(canonicalJson(inputs)),
      inputs,
    },
  };
}

export function measureRouteCssCounterfactual(fixture, compiler) {
  const assets = fixture.assets.map((asset) => ({
    componentName: asset.componentName,
    criticalCss: asset.css,
    fragmentTargets: [],
    href: `/assets/perf-route-css/${asset.sourceFileName}`,
    sourceFileName: asset.sourceFileName,
    styleRuleUsages: [
      {
        className: asset.className,
        moduleFileName: asset.sourceFileName.replace(/\.css$/u, '.tsx'),
        source: `${asset.sourceFileName.replace(/\.css$/u, '.tsx')}#root`,
        styleRef: 'styles.root',
      },
    ],
  }));
  const assetById = new Map(fixture.assets.map((asset) => [asset.id, asset]));
  const routeTargets = fixture.routes.map((route) => ({
    route: route.path,
    sourceFileNames: route.assetIds.map((assetId) => assetById.get(assetId).sourceFileName),
  }));
  const manifest = compiler.collectCssAssetManifest(
    { cssAssets: assets },
    { baseHref: '/assets/perf-route-css/', split: { routes: routeTargets } },
  );
  const unsplitCss = compiler.dedupeCss([fixture.stylesheet.css]);
  const unsplit = {
    href: `/assets/perf-route-css/unsplit-${bareSha256(unsplitCss)}.css`,
    sourceDigest: fixture.stylesheet.digest,
    sourceFile: fixture.stylesheet.file,
    ...representationBytes([unsplitCss]),
  };
  const errors = [];
  const chunksByHref = new Map();
  const routes = fixture.routes.map((route, index) => {
    const target = routeTargets[index];
    const delivery = compiler.cssRouteDeliveryGate(manifest, target);
    const chunks = [
      ...(manifest.chunks?.base ?? []),
      ...(manifest.chunks?.routes?.[route.path] ?? []),
    ].map((asset) => ({ css: asset.criticalCss ?? '', href: asset.href }));
    if (chunks.length === 0) errors.push(`${route.id} emitted no CSS chunks`);
    for (const chunk of chunks) {
      if (!/-[a-f0-9]{64}\.css$/u.test(chunk.href)) {
        errors.push(`${route.id} emitted a non-content-addressed CSS href: ${chunk.href}`);
      }
      const previous = chunksByHref.get(chunk.href);
      if (previous !== undefined && previous !== chunk.css) {
        errors.push(`${route.id} reused CSS href ${chunk.href} for different bytes`);
      }
      chunksByHref.set(chunk.href, chunk.css);
    }
    if (delivery.diagnostics.length > 0) {
      errors.push(
        `${route.id} emitted ${String(delivery.diagnostics.length)} overship diagnostics`,
      );
    }
    if (!sameStringSet(delivery.accounting.reachableSourceFileNames, target.sourceFileNames)) {
      errors.push(`${route.id} reachable CSS source census differs from the fixture`);
    }
    const expectedChunkCss = route.assetIds.map((assetId) =>
      compiler.dedupeCss([assetById.get(assetId).css]),
    );
    const actualChunkCss = chunks.map((chunk) => chunk.css);
    for (const [assetIndex, expectedCss] of expectedChunkCss.entries()) {
      if (!actualChunkCss.includes(expectedCss)) {
        errors.push(`${route.id} omitted derived partition ${route.assetIds[assetIndex]}`);
      }
    }
    for (const asset of fixture.assets) {
      if (route.assetIds.includes(asset.id)) continue;
      if (actualChunkCss.includes(compiler.dedupeCss([asset.css]))) {
        errors.push(`${route.id} shipped unreachable derived partition ${asset.id}`);
      }
    }
    const split = representationBytes(chunks.map((chunk) => chunk.css));
    return {
      accounting: delivery.accounting,
      chunks: chunks.map((chunk) => ({ href: chunk.href, ...representationBytes([chunk.css]) })),
      id: route.id,
      path: route.path,
      split,
      savings: savingsAgainst(split, unsplit),
      unsplit,
    };
  });
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const sessions = fixture.sessions.map((session) => {
    const hrefs = new Set();
    const css = [];
    for (const routeId of session.routeIds) {
      for (const chunk of routeById.get(routeId).chunks) {
        if (hrefs.has(chunk.href)) continue;
        hrefs.add(chunk.href);
        css.push(chunksByHref.get(chunk.href));
      }
    }
    const split = representationBytes(css);
    return {
      id: session.id,
      routeIds: session.routeIds,
      split,
      splitHrefs: [...hrefs],
      totalSessionRegression: regressionAgainst(split, unsplit),
      unsplit,
    };
  });
  const routeThresholdMet = routes.every((route) => route.savings.brotliPercent >= 10);
  const totalSessionBrotliRegression = sessions.some(
    (session) => session.split.brotliBytes > session.unsplit.brotliBytes,
  );
  const totalSessionIdentityRegression = sessions.some(
    (session) => session.split.identityBytes > session.unsplit.identityBytes,
  );
  const totalSessionByteRegression = totalSessionBrotliRegression || totalSessionIdentityRegression;
  const thresholdMet = errors.length === 0 && routeThresholdMet && !totalSessionByteRegression;
  return {
    codec: {
      byteScope: 'static-response-body',
      brotliMode: 'generic',
      brotliQuality: 11,
      primaryDecisionRepresentation: 'brotli',
      sessionCacheModel: 'immutable content-addressed URL transferred once per unique href',
    },
    correctness: { complete: errors.length === 0, errors },
    decision: {
      implementationClaim: thresholdMet
        ? 'The current splitter clears the fixture threshold: every fresh route saves at least 10% Brotli CSS and a complete session downloads no additional Brotli CSS.'
        : null,
      routeThresholdMet,
      status: thresholdMet ? 'threshold-met' : 'threshold-not-met',
      threshold: {
        minimumRouteCriticalPathBrotliSavingsPercent: 10,
        totalSessionByteRegressionAllowed: false,
      },
      totalSessionByteRegression,
      totalSessionBrotliRegression,
      totalSessionIdentityRegression,
    },
    routes,
    sessions,
    unsplit,
  };
}

export async function runRouteCssCounterfactual(options = {}, dependencies = {}) {
  const collectProvenance = dependencies.collectProvenance ?? collectPerformanceProvenance;
  const source = collectProvenance({ lockFiles: LOCK_FILES, repoRoot });
  const fixture = await loadRouteCssFixture(options.fixture ?? DEFAULT_FIXTURE);
  const bundled = dependencies.compiler
    ? { compiler: dependencies.compiler, identity: dependencies.compilerIdentity }
    : await bundleCurrentCssSplitter(dependencies);
  if (!bundled.identity) throw new TypeError('compiler identity is required');
  const measurement = measureRouteCssCounterfactual(fixture, bundled.compiler);
  const sourceAfter = collectProvenance({ lockFiles: LOCK_FILES, repoRoot });
  const sourceStable = sameSourceState(source, sourceAfter);
  const dirtyReason = source.dirty
    ? `source provenance is dirty: ${source.dirtyPaths.join(', ')}`
    : null;
  const errors = [
    ...measurement.correctness.errors,
    ...(sourceStable ? [] : ['source provenance changed during route CSS measurement']),
    ...(dirtyReason && options.allowDirty !== true ? [dirtyReason] : []),
  ];
  const workloadFacts = {
    codec: measurement.codec,
    compilerBundleDigest: bundled.identity.bundleDigest,
    compilerInputDigest: bundled.identity.inputDigest,
    derivationDigest: fixture.identity.derivationDigest,
    fixtureDigest: fixture.identity.fixtureDigest,
    routes: fixture.routes.map(({ id, path: routePath }) => ({ id, path: routePath })),
    sessions: fixture.sessions,
  };
  const complete = errors.length === 0;
  const publishable = complete && !source.dirty;
  const decision = {
    ...measurement.decision,
    implementationClaim:
      publishable && measurement.decision.status === 'threshold-met'
        ? measurement.decision.implementationClaim
        : null,
    status: complete ? measurement.decision.status : 'unproven',
  };
  return {
    compiler: bundled.identity,
    derivation: fixture.derivation,
    decision,
    environment: { host: performanceHostFingerprint() },
    fixture: fixture.identity,
    integrity: {
      complete,
      errors,
      publishable,
      sourceStable,
    },
    measurement: {
      codec: measurement.codec,
      correctness: measurement.correctness,
      routes: measurement.routes,
      sessions: measurement.sessions,
      unsplit: measurement.unsplit,
    },
    schema: ROUTE_CSS_REPORT_SCHEMA,
    source,
    sourceAfter,
    verdict: {
      reasons: [...errors, ...(dirtyReason && options.allowDirty === true ? [dirtyReason] : [])],
      status: publishable ? 'measured' : 'unproven',
    },
    workload: {
      ...workloadFacts,
      digest: sha256(canonicalJson(workloadFacts)),
    },
  };
}

export function validateRouteCssReport(report) {
  const findings = [];
  if (report?.schema !== ROUTE_CSS_REPORT_SCHEMA) {
    findings.push(`schema is not ${ROUTE_CSS_REPORT_SCHEMA}`);
  }
  if (!report?.source?.commit) findings.push('source commit is missing');
  if (!sameSourceState(report?.source, report?.sourceAfter))
    findings.push('source identity changed');
  if (report?.integrity?.sourceStable !== true) findings.push('source stability is unproven');
  if (report?.integrity?.complete !== true) findings.push('measurement integrity is incomplete');
  if (report?.measurement?.correctness?.complete !== true) {
    findings.push('route CSS correctness is incomplete');
  }
  if (!isSha256(report?.compiler?.bundleDigest)) findings.push('compiler bundle digest is missing');
  if (!isSha256(report?.compiler?.inputDigest)) {
    findings.push('compiler input digest is missing');
  } else if (
    report.compiler.inputDigest !== sha256(canonicalJson(report?.compiler?.inputs ?? {}))
  ) {
    findings.push('compiler input digest is invalid');
  }
  const sourceDigests = report?.fixture?.sourceDigests;
  if (
    !sourceDigests ||
    typeof sourceDigests !== 'object' ||
    Array.isArray(sourceDigests) ||
    Object.keys(sourceDigests).length < 4 ||
    Object.values(sourceDigests).some((digest) => !isSha256(digest))
  ) {
    findings.push('fixture source digests are missing');
  }
  const expectedSourceDigests = report?.fixture?.expectedSourceDigests;
  if (
    !expectedSourceDigests ||
    canonicalJson(expectedSourceDigests) !== canonicalJson(sourceDigests)
  ) {
    findings.push('fixture source digests differ from their authenticated expectations');
  }
  if (!isSha256(report?.fixture?.sourceBindingDigest)) {
    findings.push('fixture source binding digest is missing');
  } else if (report.fixture.sourceBindingDigest !== sha256(canonicalJson(sourceDigests ?? {}))) {
    findings.push('fixture source binding digest is invalid');
  }
  if (!isSha256(report?.fixture?.manifestDigest))
    findings.push('fixture manifest digest is missing');
  const derivation = report?.derivation;
  if (!derivation || typeof derivation !== 'object' || Array.isArray(derivation)) {
    findings.push('CSS partition derivation is missing');
  } else {
    const { digest, ...facts } = derivation;
    if (derivation.algorithm !== ROUTE_CSS_DERIVATION_ALGORITHM) {
      findings.push('CSS partition derivation algorithm is unsupported');
    }
    if (!isSha256(digest) || digest !== sha256(canonicalJson(facts))) {
      findings.push('CSS partition derivation digest is invalid');
    }
    if (
      derivation.sourceDigest !== sourceDigests?.[report?.fixture?.stylesheetPath] ||
      derivation.sourceReconstructionDigest !== derivation.sourceDigest
    ) {
      findings.push('CSS partition derivation does not reconstruct the bound stylesheet');
    }
    if (derivation.routeSource?.digest !== sourceDigests?.[derivation.routeSource?.file]) {
      findings.push('CSS partition derivation route source is not fixture-bound');
    }
  }
  if (report?.fixture?.derivationDigest !== derivation?.digest) {
    findings.push('fixture derivation digest differs from the measured derivation');
  }
  if (!isSha256(report?.fixture?.fixtureDigest)) {
    findings.push('fixture digest is missing');
  } else if (
    report.fixture.fixtureDigest !==
    sha256(
      canonicalJson({
        derivationDigest: report.fixture.derivationDigest,
        manifestDigest: report.fixture.manifestDigest,
        sourceBindingDigest: report.fixture.sourceBindingDigest,
      }),
    )
  ) {
    findings.push('fixture digest is invalid');
  }
  const workload = report?.workload;
  if (workload && typeof workload === 'object') {
    const { digest, ...facts } = workload;
    if (digest !== sha256(canonicalJson(facts))) findings.push('workload digest is invalid');
    if (
      workload.compilerBundleDigest !== report?.compiler?.bundleDigest ||
      workload.compilerInputDigest !== report?.compiler?.inputDigest ||
      workload.derivationDigest !== report?.derivation?.digest ||
      workload.fixtureDigest !== report?.fixture?.fixtureDigest ||
      canonicalJson(workload.codec) !== canonicalJson(report?.measurement?.codec)
    ) {
      findings.push('workload identity differs from measured inputs');
    }
  } else {
    findings.push('workload identity is missing');
  }
  const routes = report?.measurement?.routes;
  const sessions = report?.measurement?.sessions;
  if (
    report?.measurement?.unsplit?.sourceDigest !== report?.derivation?.sourceDigest ||
    report?.measurement?.unsplit?.sourceFile !== report?.derivation?.sourceFile
  ) {
    findings.push('unsplit CSS baseline differs from the bound stylesheet');
  }
  if (!Array.isArray(routes) || routes.length < 2) {
    findings.push('matched route measurements are missing');
  }
  if (!Array.isArray(sessions) || sessions.length === 0) {
    findings.push('session measurements are missing');
  }
  const correctnessComplete = report?.measurement?.correctness?.complete === true;
  const routeThresholdMet =
    Array.isArray(routes) &&
    routes.length >= 2 &&
    routes.every((route) => Number(route?.savings?.brotliPercent) >= 10);
  const totalSessionBrotliRegression =
    Array.isArray(sessions) &&
    sessions.some((session) => Number(session?.totalSessionRegression?.brotliBytes) > 0);
  const totalSessionIdentityRegression =
    Array.isArray(sessions) &&
    sessions.some((session) => Number(session?.totalSessionRegression?.identityBytes) > 0);
  const totalSessionByteRegression = totalSessionBrotliRegression || totalSessionIdentityRegression;
  const thresholdMet = correctnessComplete && routeThresholdMet && !totalSessionByteRegression;
  if (report?.decision?.routeThresholdMet !== routeThresholdMet) {
    findings.push('route threshold decision does not match measurements');
  }
  if (report?.decision?.totalSessionBrotliRegression !== totalSessionBrotliRegression) {
    findings.push('session regression decision does not match measurements');
  }
  if (
    report?.decision?.totalSessionIdentityRegression !== totalSessionIdentityRegression ||
    report?.decision?.totalSessionByteRegression !== totalSessionByteRegression
  ) {
    findings.push('total-session byte decision does not match measurements');
  }
  if (
    report?.decision?.threshold?.minimumRouteCriticalPathBrotliSavingsPercent !== 10 ||
    report?.decision?.threshold?.totalSessionByteRegressionAllowed !== false
  ) {
    findings.push('route CSS acceptance threshold is invalid');
  }
  const expectedStatus = report?.integrity?.complete
    ? thresholdMet
      ? 'threshold-met'
      : 'threshold-not-met'
    : 'unproven';
  if (report?.decision?.status !== expectedStatus) {
    findings.push('decision status does not match measurements');
  }
  if (
    report?.decision?.implementationClaim !== null &&
    (!thresholdMet ||
      report?.decision?.status !== 'threshold-met' ||
      report?.verdict?.status !== 'measured' ||
      report?.integrity?.publishable !== true)
  ) {
    findings.push('implementation claim is not backed by a measured threshold pass');
  }
  if (
    report?.verdict?.status === 'measured' &&
    (report?.source?.dirty !== false ||
      report?.integrity?.complete !== true ||
      report?.integrity?.publishable !== true)
  ) {
    findings.push('measured verdict is not clean and publishable');
  }
  return findings;
}

function representationBytes(cssChunks) {
  const buffers = cssChunks.map((css) => Buffer.from(css));
  return {
    brotliBytes: buffers.reduce(
      (total, bytes) =>
        total +
        brotliCompressSync(bytes, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
          },
        }).byteLength,
      0,
    ),
    identityBytes: buffers.reduce((total, bytes) => total + bytes.byteLength, 0),
  };
}

function savingsAgainst(split, unsplit) {
  return {
    brotliBytes: unsplit.brotliBytes - split.brotliBytes,
    brotliPercent: percentDelta(unsplit.brotliBytes, split.brotliBytes),
    identityBytes: unsplit.identityBytes - split.identityBytes,
    identityPercent: percentDelta(unsplit.identityBytes, split.identityBytes),
  };
}

function regressionAgainst(split, unsplit) {
  return {
    brotliBytes: split.brotliBytes - unsplit.brotliBytes,
    brotliPercent: -percentDelta(unsplit.brotliBytes, split.brotliBytes),
    identityBytes: split.identityBytes - unsplit.identityBytes,
    identityPercent: -percentDelta(unsplit.identityBytes, split.identityBytes),
  };
}

function percentDelta(baseline, candidate) {
  return baseline === 0 ? 0 : ((baseline - candidate) / baseline) * 100;
}

function deriveComponentClassOwnership(routeBinding, partitions) {
  if (
    !routeBinding ||
    typeof routeBinding.routeSourceText !== 'string' ||
    typeof routeBinding.routeSourceFile !== 'string'
  ) {
    throw new TypeError('route CSS derivation requires an authenticated TSX route source');
  }
  const source = ts.createSourceFile(
    routeBinding.routeSourceFile,
    routeBinding.routeSourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (source.parseDiagnostics.length > 0) {
    throw new TypeError(
      `bound route source did not parse as TSX: ${source.parseDiagnostics
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
        .join('; ')}`,
    );
  }

  const declarations = new Map();
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    const name = statement.name.text;
    if (declarations.has(name)) throw new TypeError(`bound route source repeats component ${name}`);
    declarations.set(name, statement);
  }

  const componentOwners = new Map();
  const ownerSetsByClass = new Map();
  const componentEvidence = {};
  for (const partition of partitions) {
    const components = routeBinding.componentOwnership?.[partition.id];
    if (!Array.isArray(components) || components.length === 0) {
      throw new TypeError(`component ownership for ${partition.id} must be non-empty`);
    }
    componentEvidence[partition.id] = [];
    for (const componentName of components) {
      const previousOwner = componentOwners.get(componentName);
      if (previousOwner) {
        throw new TypeError(
          `bound route component ${componentName} belongs to both ${previousOwner} and ${partition.id}`,
        );
      }
      componentOwners.set(componentName, partition.id);
      const declaration = declarations.get(componentName);
      if (!declaration) {
        throw new Error(`bound route source omitted component ${componentName}`);
      }
      const classes = new Set();
      const visit = (node) => {
        if (ts.isJsxAttribute(node) && node.name.text === 'class') {
          if (!node.initializer || !ts.isStringLiteral(node.initializer)) {
            throw new Error(`bound route component ${componentName} has a non-static class`);
          }
          for (const className of node.initializer.text.split(/\s+/u).filter(Boolean)) {
            if (!/^[-_a-zA-Z][-_a-zA-Z0-9]*$/u.test(className)) {
              throw new Error(
                `bound route component ${componentName} has unsupported class ${className}`,
              );
            }
            classes.add(className);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(declaration.body);
      if (classes.size === 0) {
        throw new Error(`bound route component ${componentName} has no static CSS classes`);
      }
      const sortedClasses = [...classes].sort((left, right) => left.localeCompare(right));
      componentEvidence[partition.id].push({ classes: sortedClasses, componentName });
      for (const className of sortedClasses) {
        const owners = ownerSetsByClass.get(className) ?? new Set();
        owners.add(partition.id);
        ownerSetsByClass.set(className, owners);
      }
    }
  }

  const ownerByClass = new Map();
  for (const [className, owners] of ownerSetsByClass) {
    const [onlyOwner] = owners;
    ownerByClass.set(className, owners.size === 1 && onlyOwner !== 'shared' ? onlyOwner : 'shared');
  }
  return {
    allClasses: new Set(ownerSetsByClass.keys()),
    identity: {
      components: componentEvidence,
      digest: sha256(routeBinding.routeSourceText),
      file: routeBinding.routeSourceFile,
    },
    ownerByClass,
  };
}

function parseTopLevelCssRules(source) {
  const rules = [];
  let cursor = 0;
  while (cursor < source.length) {
    const ruleStart = cursor;
    const preludeStart = skipCssTrivia(source, cursor);
    if (preludeStart === source.length) {
      if (rules.length === 0) {
        if (source.trim().length > 0) throw new TypeError('stylesheet contains no CSS rules');
      } else {
        rules[rules.length - 1].css += source.slice(ruleStart);
      }
      cursor = source.length;
      break;
    }

    const openingBrace = findCssOpeningBrace(source, preludeStart);
    const closingBrace = findCssClosingBrace(source, openingBrace);
    const prelude = source.slice(preludeStart, openingBrace).trim();
    if (prelude.length === 0) throw new TypeError('stylesheet contains an empty rule prelude');
    const end = closingBrace + 1;
    rules.push({
      body: source.slice(openingBrace + 1, closingBrace),
      css: source.slice(ruleStart, end),
      prelude,
    });
    cursor = end;
  }
  return rules;
}

function skipCssTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/u.test(source[index])) {
      index += 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) throw new TypeError('stylesheet contains an unterminated comment');
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function findCssOpeningBrace(source, start) {
  let quote = null;
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (quote !== null) {
      if (char === '\\') index += 2;
      else {
        if (char === quote) quote = null;
        index += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) throw new TypeError('stylesheet contains an unterminated comment');
      index = end + 2;
      continue;
    }
    if (char === ';') {
      throw new TypeError('route CSS derivation does not support top-level statement at-rules');
    }
    if (char === '{') return index;
    index += 1;
  }
  throw new TypeError('stylesheet contains a rule without an opening brace');
}

function findCssClosingBrace(source, openingBrace) {
  let depth = 1;
  let quote = null;
  let index = openingBrace + 1;
  while (index < source.length) {
    const char = source[index];
    if (quote !== null) {
      if (char === '\\') index += 2;
      else {
        if (char === quote) quote = null;
        index += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) throw new TypeError('stylesheet contains an unterminated comment');
      index = end + 2;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  throw new TypeError('stylesheet contains an unterminated CSS block');
}

function cssRuleClassNames(rule) {
  const selectorTexts = /^@(container|layer|media|scope|supports)\b/u.test(rule.prelude)
    ? parseTopLevelCssRules(rule.body).flatMap((nestedRule) => cssRuleSelectorTexts(nestedRule))
    : cssRuleSelectorTexts(rule);
  const classNames = new Set();
  for (const selectorText of selectorTexts) {
    for (const match of selectorText.matchAll(/\.([_a-zA-Z][-_a-zA-Z0-9]*)/gu)) {
      classNames.add(match[1]);
    }
  }
  return [...classNames].sort((left, right) => left.localeCompare(right));
}

function cssRuleSelectorTexts(rule) {
  if (/^@(container|layer|media|scope|supports)\b/u.test(rule.prelude)) {
    return parseTopLevelCssRules(rule.body).flatMap((nestedRule) =>
      cssRuleSelectorTexts(nestedRule),
    );
  }
  return rule.prelude.startsWith('@') ? [] : [rule.prelude];
}

function sameSourceState(left, right) {
  return (
    left?.commit === right?.commit &&
    JSON.stringify(left?.dirtyPaths) === JSON.stringify(right?.dirtyPaths) &&
    JSON.stringify(left?.locks) === JSON.stringify(right?.locks)
  );
}

function sameStringSet(left, right) {
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function nonEmptyArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${name} must be non-empty`);
  return value;
}

function uniqueStringList(value, name) {
  const list = nonEmptyStringList(value, name);
  if (new Set(list).size !== list.length)
    throw new TypeError(`${name} must not contain duplicates`);
  return list;
}

function nonEmptyStringList(value, name) {
  const list = nonEmptyArray(value, name);
  return list.map((entry, index) => requiredString(entry, `${name}[${String(index)}]`));
}

function uniqueString(value, name, seen) {
  const result = requiredString(value, name);
  if (seen.has(result)) throw new TypeError(`${name} must be unique`);
  seen.add(result);
  return result;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}

function requiredSha256(value, name) {
  if (!isSha256(value)) throw new TypeError(`${name} must be a sha256 digest`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function countOccurrences(value, needle) {
  let count = 0;
  let index = 0;
  while ((index = value.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function confinedRepoPath(value, label) {
  const resolved = path.resolve(value);
  const relative = path.relative(repoRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError(`${label} must stay inside the repository`);
  }
  return resolved;
}

function portableRelativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function bareSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256(value) {
  return `sha256:${bareSha256(value)}`;
}

function isSha256(value) {
  return /^sha256:[a-f0-9]{64}$/u.test(String(value ?? ''));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = readArg('--out');
  if (!output) throw new Error('--out is required');
  const report = await runRouteCssCounterfactual({
    allowDirty: process.argv.includes('--allow-dirty'),
    fixture: readArg('--fixture') ?? DEFAULT_FIXTURE,
  });
  await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  const findings = validateRouteCssReport(report);
  if (findings.length > 0 || report.verdict.status !== 'measured') {
    process.stderr.write(
      `route CSS counterfactual is unproven: ${[...findings, ...report.verdict.reasons].join('; ')}\n`,
    );
    process.exitCode = 2;
  }
}
