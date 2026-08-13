#!/usr/bin/env node
/**
 * Current-split versus unsplit route CSS counterfactual for plans/good-perf.md Phase 3.
 *
 * This is a byte/correctness study, not a timing benchmark. It bundles the current compiler CSS
 * implementation directly from source, feeds it a committed matched listing/detail fixture, and
 * compares the emitted base/route chunks with one globally cached unsplit asset made from the same
 * CSS inputs. Brotli-11 static-asset bytes are the primary network decision representation;
 * identity bytes are also reported so duplicated source CSS cannot hide behind codec effects.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

import { build as esbuild } from 'esbuild';

import { readArg } from '../benchmarks/harness/args.mjs';
import { canonicalJson, performanceHostFingerprint } from './lib/perf-host.mjs';
import { collectPerformanceProvenance } from './lib/perf-provenance.mjs';

export const ROUTE_CSS_FIXTURE_SCHEMA = 'kovo-route-css-workload/v1';
export const ROUTE_CSS_REPORT_SCHEMA = 'kovo-route-css-counterfactual/v1';

const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const DEFAULT_FIXTURE = fileURLToPath(
  new URL('./fixtures/perf-route-css/workload.json', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export async function loadRouteCssFixture(fixturePath = DEFAULT_FIXTURE) {
  const absolutePath = confinedRepoPath(fixturePath, 'route CSS fixture');
  const fixtureRoot = path.dirname(absolutePath);
  const text = await readFile(absolutePath, 'utf8');
  const value = JSON.parse(text);
  if (value?.schema !== ROUTE_CSS_FIXTURE_SCHEMA) {
    throw new TypeError(`route CSS fixture schema must be ${ROUTE_CSS_FIXTURE_SCHEMA}`);
  }
  const name = requiredString(value.name, 'fixture.name');
  const rawAssets = nonEmptyArray(value.assets, 'fixture.assets');
  const rawRoutes = nonEmptyArray(value.routes, 'fixture.routes');
  const rawSessions = nonEmptyArray(value.sessions, 'fixture.sessions');
  if (rawRoutes.length < 2)
    throw new TypeError('route CSS fixture must declare at least two routes');

  const assetIds = new Set();
  const sourceFileNames = new Set();
  const assets = [];
  for (const [index, rawAsset] of rawAssets.entries()) {
    const label = `fixture.assets[${String(index)}]`;
    const id = uniqueString(rawAsset?.id, `${label}.id`, assetIds);
    const sourceFileName = uniqueString(
      rawAsset?.sourceFileName,
      `${label}.sourceFileName`,
      sourceFileNames,
    );
    const file = requiredString(rawAsset?.file, `${label}.file`);
    const filePath = confinedChildPath(fixtureRoot, file, `${label}.file`);
    const rawCss = await readFile(filePath, 'utf8');
    const css = rawCss.trim();
    const marker = requiredString(rawAsset?.marker, `${label}.marker`);
    if (css.length === 0) throw new TypeError(`${label}.file must contain non-empty CSS`);
    if (!css.includes(marker)) throw new TypeError(`${label}.file omitted marker ${marker}`);
    assets.push({
      className: requiredString(rawAsset?.className, `${label}.className`),
      componentName: requiredString(rawAsset?.componentName, `${label}.componentName`),
      css,
      file: portableRelativePath(repoRoot, filePath),
      fileDigest: sha256(rawCss),
      id,
      marker,
      sourceFileName,
    });
  }

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const routeIds = new Set();
  const routePaths = new Set();
  const routes = rawRoutes.map((rawRoute, index) => {
    const label = `fixture.routes[${String(index)}]`;
    const id = uniqueString(rawRoute?.id, `${label}.id`, routeIds);
    const routePath = uniqueString(rawRoute?.path, `${label}.path`, routePaths);
    if (!routePath.startsWith('/')) throw new TypeError(`${label}.path must be root-relative`);
    const assetRefs = uniqueStringList(rawRoute?.assets, `${label}.assets`);
    const requiredMarkers = uniqueStringList(rawRoute?.requiredMarkers, `${label}.requiredMarkers`);
    for (const assetId of assetRefs) {
      if (!assetsById.has(assetId)) throw new TypeError(`${label}.assets references ${assetId}`);
    }
    const expectedMarkers = assetRefs.map((assetId) => assetsById.get(assetId).marker).sort();
    if (!sameStringSet(requiredMarkers, expectedMarkers)) {
      throw new TypeError(`${label}.requiredMarkers must exactly match its asset markers`);
    }
    return { assetIds: assetRefs, id, path: routePath, requiredMarkers };
  });
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
    return { id, routeIds: routeRefs };
  });

  const manifestDigest = sha256(text);
  const assetDigests = Object.fromEntries(assets.map((asset) => [asset.file, asset.fileDigest]));
  const identity = {
    assetDigests,
    fixtureDigest: sha256(canonicalJson({ assetDigests, manifestDigest })),
    fixturePath: portableRelativePath(repoRoot, absolutePath),
    manifestDigest,
    name,
    schema: value.schema,
  };
  return { assets, identity, routes, sessions };
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
  const unsplitCss = compiler.dedupeCss(fixture.assets.map((asset) => asset.css));
  const unsplit = {
    href: `/assets/perf-route-css/unsplit-${bareSha256(unsplitCss)}.css`,
    ...representationBytes([unsplitCss]),
  };
  const allMarkers = fixture.assets.map((asset) => asset.marker);
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
    const deliveredCss = chunks.map((chunk) => chunk.css).join('\n');
    for (const marker of route.requiredMarkers) {
      if (!deliveredCss.includes(marker))
        errors.push(`${route.id} omitted required marker ${marker}`);
    }
    for (const marker of allMarkers) {
      if (!route.requiredMarkers.includes(marker) && deliveredCss.includes(marker)) {
        errors.push(`${route.id} shipped unreachable marker ${marker}`);
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
  const thresholdMet = errors.length === 0 && routeThresholdMet && !totalSessionBrotliRegression;
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
        totalSessionBrotliRegressionAllowed: false,
      },
      totalSessionBrotliRegression,
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
  const errors = [
    ...measurement.correctness.errors,
    ...(sourceStable ? [] : ['source provenance changed during route CSS measurement']),
    ...(source.dirty && options.allowDirty !== true
      ? [`source provenance is dirty: ${source.dirtyPaths.join(', ')}`]
      : []),
  ];
  const workloadFacts = {
    codec: measurement.codec,
    compilerBundleDigest: bundled.identity.bundleDigest,
    compilerInputDigest: bundled.identity.inputDigest,
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
      reasons: errors,
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
  if (report?.schema !== ROUTE_CSS_REPORT_SCHEMA) findings.push('schema is not route CSS v1');
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
  const assetDigests = report?.fixture?.assetDigests;
  if (
    !assetDigests ||
    typeof assetDigests !== 'object' ||
    Array.isArray(assetDigests) ||
    Object.keys(assetDigests).length === 0 ||
    Object.values(assetDigests).some((digest) => !isSha256(digest))
  ) {
    findings.push('fixture asset digests are missing');
  }
  if (!isSha256(report?.fixture?.manifestDigest))
    findings.push('fixture manifest digest is missing');
  if (!isSha256(report?.fixture?.fixtureDigest)) {
    findings.push('fixture digest is missing');
  } else if (
    report.fixture.fixtureDigest !==
    sha256(
      canonicalJson({
        assetDigests: report.fixture.assetDigests,
        manifestDigest: report.fixture.manifestDigest,
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
  const thresholdMet = correctnessComplete && routeThresholdMet && !totalSessionBrotliRegression;
  if (report?.decision?.routeThresholdMet !== routeThresholdMet) {
    findings.push('route threshold decision does not match measurements');
  }
  if (report?.decision?.totalSessionBrotliRegression !== totalSessionBrotliRegression) {
    findings.push('session regression decision does not match measurements');
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

function confinedRepoPath(value, label) {
  const resolved = path.resolve(value);
  const relative = path.relative(repoRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError(`${label} must stay inside the repository`);
  }
  return resolved;
}

function confinedChildPath(root, value, label) {
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError(`${label} must stay inside the fixture directory`);
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
