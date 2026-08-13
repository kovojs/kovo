#!/usr/bin/env node
/**
 * One-process-tree production HTTP benchmark adapter (plans/good-perf.md Phase 3).
 *
 * benchmarks/compare.mjs owns the seven-sample K,N,N,K schedule. This adapter deliberately
 * measures one framework/condition/sample: a node:http keep-alive generator validates every status,
 * header, and body while server-only CPU/RSS evidence is sampled from the launched process tree.
 * The wire contract follows SPEC §9.4 and spec/09-wire-protocol.md §§Transport compression,
 * Static validators, and Proved-document caching.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

import { readArg, readIntegerArg } from '../benchmarks/harness/args.mjs';
import { performanceHostFingerprint } from './lib/perf-host.mjs';
import { collectPerformanceProvenance } from './lib/perf-provenance.mjs';
import { measureProcessTreeWindow } from './lib/process-tree-metrics.mjs';

export const SERVER_BENCHMARK_SCHEMA = 'kovo-server-benchmark/v1';
export const SERVER_PREPARE_SCHEMA = 'kovo-server-benchmark-prepare/v1';
export const SERVER_CONCURRENCIES = Object.freeze([1, 8, 32]);
export const SERVER_ENCODINGS = Object.freeze(['identity', 'br']);
export const SERVER_MODES = Object.freeze(['HIT', '304', 'dynamic']);
export const SERVER_ROUTES = Object.freeze(['listing', 'detail']);

const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const DEFAULT_DURATION_MS = 15_000;
const DEFAULT_WARMUP_MS = 5_000;
const MAX_ERROR_EVIDENCE = 20;
const PRODUCT_SLUG = 'linen-field-jacket';
export const PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV =
  'KOVO_BENCHMARK_DISABLE_PROVED_DOCUMENT_COMPRESSION_CACHE';
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function serverConditionKey(condition) {
  validateCondition(condition);
  return `${condition.mode.toLowerCase()}-${condition.route}-${condition.encoding}-c${String(
    condition.concurrency,
  )}`;
}

export function serverConditionPath({ mode, route }) {
  const base = mode === 'dynamic' ? '/matched/runtime/dynamic' : '/matched/l0';
  return route === 'detail' ? `${base}/product/${PRODUCT_SLUG}` : base;
}

export function serverConditions(options = {}) {
  const concurrencies = uniqueDimension(
    options.concurrencies ?? SERVER_CONCURRENCIES,
    'concurrencies',
  );
  const routes = uniqueDimension(options.routes ?? SERVER_ROUTES, 'routes');
  const encodings = uniqueDimension(options.encodings ?? SERVER_ENCODINGS, 'encodings');
  const modes = uniqueDimension(options.modes ?? SERVER_MODES, 'modes');
  const output = [];
  for (const concurrency of concurrencies) {
    for (const route of routes) {
      for (const encoding of encodings) {
        for (const mode of modes) {
          const condition = { concurrency, encoding, mode, route };
          validateCondition(condition);
          output.push({
            ...condition,
            key: serverConditionKey(condition),
            path: serverConditionPath(condition),
          });
        }
      }
    }
  }
  return output;
}

function uniqueDimension(values, name) {
  if (!Array.isArray(values) || values.length === 0 || new Set(values).size !== values.length) {
    throw new TypeError(`${name} must be a non-empty list without duplicates`);
  }
  return values;
}

/** Validate one response against the primed representation without hashing on the hot path. */
export function responseFindings(response, expectation, state = {}) {
  const findings = [];
  if (response.statusCode !== expectation.statusCode) {
    findings.push(`status ${String(response.statusCode)} != ${String(expectation.statusCode)}`);
  }
  for (const [name, expected] of Object.entries(expectation.headers)) {
    const actual = headerValue(response.headers, name);
    if (actual !== expected)
      findings.push(`${name} ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
  if (!response.body.equals(expectation.body))
    findings.push('wire body differed from primed bytes');
  if (expectation.kovoPad === 'required-fresh') {
    const pad = headerValue(response.headers, 'kovo-pad');
    if (!pad) findings.push('Kovo-Pad was missing from a compressed Kovo response');
    // SPEC §9.5 deliberately permits 1..64 hex characters, so independently generated values can
    // collide (especially one-character pads). Track variation over the window; global uniqueness
    // would reject valid randomness and eventually every sufficiently long benchmark.
    else state.kovoPads?.add(pad);
  } else if (headerValue(response.headers, 'kovo-pad') !== null) {
    findings.push('Kovo-Pad was unexpected');
  }
  return findings;
}

export function dynamicCachePostureFindings({ cacheControl, framework, vary }) {
  const cacheTokens = commaSeparatedTokens(cacheControl);
  const varyTokens = commaSeparatedTokens(vary);
  return [
    ...(!cacheTokens.has('private') ? ['Cache-Control private'] : []),
    ...(!cacheTokens.has('no-store') ? ['Cache-Control no-store'] : []),
    ...(cacheTokens.has('public') ? ['absence of Cache-Control public'] : []),
    ...(framework === 'kovo' && !varyTokens.has('cookie') ? ['Vary Cookie'] : []),
  ];
}

export async function runKeepAliveWindow(options, dependencies = {}) {
  const request = dependencies.request ?? requestOnce;
  const agent = options.agent;
  const started = performance.now();
  const deadline = started + options.durationMs;
  const latenciesMs = [];
  const errors = [];
  const statusCounts = {};
  const state = { kovoPads: new Set() };
  let bytes = 0;
  let failedRequests = 0;
  let misses = 0;
  let newSockets = 0;
  let requests = 0;
  let reusedSockets = 0;

  const worker = async () => {
    while (performance.now() < deadline) {
      const requestStarted = performance.now();
      try {
        const response = await request({
          agent,
          headers: options.headers,
          origin: options.origin,
          path: options.path,
          timeoutMs: options.requestTimeoutMs ?? 10_000,
        });
        const latencyMs = performance.now() - requestStarted;
        latenciesMs.push(latencyMs);
        requests += 1;
        bytes += response.body.byteLength;
        if (response.reusedSocket) reusedSockets += 1;
        else newSockets += 1;
        statusCounts[String(response.statusCode)] =
          (statusCounts[String(response.statusCode)] ?? 0) + 1;
        const findings = responseFindings(response, options.expectation, state);
        if (findings.length > 0) {
          misses += 1;
          if (errors.length < MAX_ERROR_EVIDENCE) errors.push(findings.join('; '));
        }
      } catch (error) {
        failedRequests += 1;
        if (errors.length < MAX_ERROR_EVIDENCE) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  const durationMs = performance.now() - started;
  return {
    bytes,
    durationMs,
    errors,
    failedRequests,
    kovoPadDistinct: state.kovoPads.size,
    latenciesMs,
    misses,
    newSockets,
    requests,
    reusedSockets,
    statusCounts,
  };
}

export async function runServerBenchmark(options, dependencies = {}) {
  const framework = options.framework;
  assertMember('--framework', framework, ['kovo', 'nextjs']);
  const source = collectPerformanceProvenance({ lockFiles: LOCK_FILES, repoRoot });
  if (source.dirty && options.allowDirty !== true) {
    throw new Error(
      `server benchmark requires a clean committed worktree: ${source.dirtyPaths.join(', ')}`,
    );
  }
  const entrant = await entrantDefinition(framework, options.port);
  if (options.prepareOnly === true) {
    if (options.skipBuild !== true) await buildEntrant(entrant, dependencies);
    const sourceAfter = collectPerformanceProvenance({ lockFiles: LOCK_FILES, repoRoot });
    const artifactsPresent = entrant.artifacts.every(existsSync);
    const sourceStable = sameSourceState(source, sourceAfter);
    const complete = artifactsPresent && sourceStable;
    return {
      artifacts: entrant.artifacts.map((value) => path.relative(repoRoot, value)),
      framework,
      host: performanceHostFingerprint(),
      integrity: {
        artifactsPresent,
        complete,
        errors: [
          ...(artifactsPresent ? [] : ['production server artifact is missing']),
          ...(sourceStable ? [] : ['source provenance changed during build']),
        ],
        publishable: !source.dirty,
        sourceStable,
      },
      schema: SERVER_PREPARE_SCHEMA,
      source,
      sourceAfter,
      verdict: {
        reasons: source.dirty ? ['source provenance is dirty'] : [],
        status: complete && !source.dirty ? 'measured' : 'unproven',
      },
    };
  }

  const condition = {
    concurrency: options.concurrency,
    encoding: options.encoding,
    mode: options.mode,
    route: options.route,
  };
  validateCondition(condition);
  const durationMs = boundedInteger(
    options.durationMs ?? DEFAULT_DURATION_MS,
    25,
    60_000,
    '--duration-ms',
  );
  const warmupMs = boundedInteger(options.warmupMs ?? DEFAULT_WARMUP_MS, 25, 60_000, '--warmup-ms');
  if (options.skipBuild !== true) await buildEntrant(entrant, dependencies);
  if (!entrant.artifacts.every(existsSync))
    throw new Error('production server artifact is missing; prepare it first');
  if (await portInUse(entrant.port))
    throw new Error(`port ${String(entrant.port)} is already in use`);

  const hostSamples = [{ at: new Date().toISOString(), loadAverage: os.loadavg() }];
  const server = startEntrant(entrant, dependencies);
  let sample = null;
  let correctness = null;
  const errors = [];
  try {
    await waitForHttp(`http://localhost:${String(entrant.port)}`, server);
    const origin = `http://localhost:${String(entrant.port)}`;
    const agent = new http.Agent({
      keepAlive: true,
      maxFreeSockets: condition.concurrency,
      maxSockets: condition.concurrency,
      scheduling: 'fifo',
      timeout: 30_000,
    });
    try {
      correctness = await establishServerExpectation({
        agent,
        condition,
        framework,
        origin,
        request: dependencies.request ?? requestOnce,
      });
      // A pinned comparator may truthfully lack a requested transport representation. Preserve the
      // authenticated probe as `unsupported`, but never run an identity response through a Brotli
      // timing cell or let it masquerade as one.
      if (correctness.support.status === 'supported') {
        const requestHeaders = {
          'accept-encoding': condition.encoding,
          connection: 'keep-alive',
          ...(correctness.requestEtag === null ? {} : { 'if-none-match': correctness.requestEtag }),
        };
        const warmup = await runKeepAliveWindow(
          {
            agent,
            concurrency: condition.concurrency,
            durationMs: warmupMs,
            expectation: correctness.expectation,
            headers: requestHeaders,
            origin,
            path: correctness.path,
          },
          dependencies,
        );
        if (warmup.failedRequests > 0 || warmup.misses > 0 || warmup.requests === 0) {
          errors.push(
            `warmup failed: requests=${String(warmup.requests)} errors=${String(warmup.failedRequests)} misses=${String(warmup.misses)}`,
          );
          errors.push(...warmup.errors);
        } else {
          const measured = await measureProcessTreeWindow(
            server.child.pid,
            () =>
              runKeepAliveWindow(
                {
                  agent,
                  concurrency: condition.concurrency,
                  durationMs,
                  expectation: correctness.expectation,
                  headers: requestHeaders,
                  origin,
                  path: correctness.path,
                },
                dependencies,
              ),
            { intervalMs: options.rssIntervalMs ?? 100 },
          );
          const load = measured.value;
          const postflight = await (dependencies.request ?? requestOnce)({
            agent,
            headers: requestHeaders,
            origin,
            path: correctness.path,
            timeoutMs: 10_000,
          });
          const postflightFindings = responseFindings(postflight, correctness.expectation, {
            kovoPads: new Set(),
          });
          errors.push(...load.errors, ...postflightFindings);
          if (measured.metrics.samplingError)
            errors.push(`RSS sampling: ${String(measured.metrics.samplingError)}`);
          if (load.failedRequests > 0)
            errors.push(`${String(load.failedRequests)} transport failures`);
          if (load.misses > 0) errors.push(`${String(load.misses)} representation misses`);
          if (load.requests === 0) errors.push('measurement completed zero requests');
          if (load.reusedSockets === 0)
            errors.push('keep-alive evidence observed zero reused sockets');
          if (
            correctness.expectation.kovoPad === 'required-fresh' &&
            load.requests > 1 &&
            load.kovoPadDistinct < 2
          ) {
            errors.push('Kovo-Pad did not vary across the measured response window');
          }
          sample = summarizeLoadSample(load, measured.metrics);
        }
      }
    } finally {
      agent.destroy();
    }
    if (server.exit !== null) errors.push(server.exit);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await stopEntrant(server);
  }
  hostSamples.push({ at: new Date().toISOString(), loadAverage: os.loadavg() });
  const sourceAfter = collectPerformanceProvenance({ lockFiles: LOCK_FILES, repoRoot });
  const sourceStable = sameSourceState(source, sourceAfter);
  if (!sourceStable) errors.push('source provenance changed during sample');
  const support = correctness?.support ?? {
    reason: 'response support could not be established',
    status: 'unproven',
  };
  const misses = (sample?.misses ?? 0) + (sample?.failedRequests ?? 0);
  const complete =
    errors.length === 0 &&
    misses === 0 &&
    correctness !== null &&
    (support.status === 'unsupported' || sample !== null);
  return {
    condition: {
      ...condition,
      key: serverConditionKey(condition),
      path: serverConditionPath(condition),
    },
    correctness: correctness?.evidence ?? null,
    environment: {
      host: performanceHostFingerprint(),
      hostSamples,
      versions: entrant.versions,
    },
    framework,
    integrity: {
      complete,
      errors: [...new Set(errors)].slice(0, MAX_ERROR_EVIDENCE),
      misses,
      processTreeSerialized: true,
      publishable: !source.dirty,
      sourceStable,
      timingExcluded: support.status === 'unsupported',
    },
    policy: { durationMs, warmupMs },
    optimization: {
      provedDocumentCompressionCache:
        framework === 'kovo'
          ? process.env[PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV] === '1'
            ? 'disabled'
            : 'enabled'
          : 'not-applicable',
    },
    samples: sample === null ? [] : [sample],
    schema: SERVER_BENCHMARK_SCHEMA,
    source,
    sourceAfter,
    support,
    verdict: {
      reasons: [
        ...(source.dirty ? ['source provenance is dirty'] : []),
        ...(support.status === 'unsupported' ? [support.reason] : []),
        ...errors,
      ],
      status:
        complete && !source.dirty
          ? support.status === 'unsupported'
            ? 'unsupported'
            : 'measured'
          : 'unproven',
    },
  };
}

/** Establish exact wire evidence before any timed request. */
export async function establishServerExpectation({
  agent,
  condition,
  framework,
  origin,
  request = requestOnce,
}) {
  const pathValue = serverConditionPath(condition);
  const identity = await request({
    agent,
    headers: { 'accept-encoding': 'identity', connection: 'keep-alive' },
    origin,
    path: pathValue,
    timeoutMs: 10_000,
  });
  assertSuccessfulDocument(identity, condition);
  const identityDigest = sha256(identity.body);
  let selected = identity;
  let support = { status: 'supported' };
  if (condition.encoding === 'br') {
    selected = await request({
      agent,
      headers: { 'accept-encoding': 'br', connection: 'keep-alive' },
      origin,
      path: pathValue,
      timeoutMs: 10_000,
    });
    const observedEncoding = headerValue(selected.headers, 'content-encoding');
    if (
      framework === 'nextjs' &&
      selected.statusCode === 200 &&
      observedEncoding === null &&
      selected.body.equals(identity.body)
    ) {
      assertSuccessfulDocument(selected, condition);
      support = {
        observedContentEncoding: null,
        reason: 'requested Brotli returned the identity representation',
        requestedContentEncoding: 'br',
        status: 'unsupported',
      };
    } else if (selected.statusCode !== 200 || observedEncoding !== 'br') {
      throw new Error('Brotli prime did not return HTTP 200 with Content-Encoding: br');
    }
    if (
      support.status === 'supported' &&
      !brotliDecompressSync(selected.body).equals(identity.body)
    ) {
      throw new Error('Brotli prime decoded to the wrong representation');
    }
  }
  const identityEtag = headerValue(identity.headers, 'etag');
  if (condition.mode !== 'dynamic' && (!identityEtag || identityEtag.startsWith('W/'))) {
    throw new Error('cached condition requires a strong primed ETag');
  }
  if (
    condition.mode !== 'dynamic' &&
    framework === 'kovo' &&
    !headerValue(identity.headers, 'last-modified')
  ) {
    throw new Error('proved Kovo document omitted Last-Modified');
  }
  if (
    condition.mode !== 'dynamic' &&
    framework === 'nextjs' &&
    headerValue(identity.headers, 'x-nextjs-cache') !== 'HIT'
  ) {
    throw new Error('cached Next.js prime did not prove x-nextjs-cache: HIT');
  }
  let requestEtag = null;
  let primeRepresentation = selected;
  if (condition.mode === '304' && support.status === 'supported') {
    requestEtag = identityEtag;
    primeRepresentation = await request({
      agent,
      headers: {
        'accept-encoding': condition.encoding,
        connection: 'keep-alive',
        'if-none-match': identityEtag,
      },
      origin,
      path: pathValue,
      timeoutMs: 10_000,
    });
    if (primeRepresentation.statusCode !== 304 || primeRepresentation.body.byteLength !== 0) {
      throw new Error('conditional prime did not return an empty HTTP 304');
    }
    if (headerValue(primeRepresentation.headers, 'etag') !== identityEtag) {
      throw new Error('conditional prime changed or omitted the ETag');
    }
  }
  const cacheControl = headerValue(identity.headers, 'cache-control') ?? '';
  if (condition.mode === 'dynamic') {
    const vary = headerValue(identity.headers, 'vary') ?? '';
    const missing = dynamicCachePostureFindings({ cacheControl, framework, vary });
    if (missing.length > 0) {
      throw new Error(
        `dynamic ${framework} prime is missing required shared-cache floor (${missing.join(
          ', ',
        )}); received Cache-Control=${JSON.stringify(cacheControl)} Vary=${JSON.stringify(vary)}`,
      );
    }
  } else {
    const cacheTokens = commaSeparatedTokens(cacheControl);
    const hasSharedLifetime = [...cacheTokens].some((token) => token.startsWith('s-maxage='));
    if (
      cacheTokens.has('no-store') ||
      cacheTokens.has('private') ||
      (!cacheTokens.has('public') && !hasSharedLifetime)
    ) {
      throw new Error(`cached prime did not prove a public cache posture: ${cacheControl}`);
    }
  }
  const headers = selectedHeaders(primeRepresentation.headers);
  if (support.status === 'unsupported') {
    return {
      evidence: {
        bodyBytes: identity.body.byteLength,
        bodySha256: identityDigest,
        cacheControl,
        contentEncoding: headerValue(primeRepresentation.headers, 'content-encoding'),
        contentType: headerValue(identity.headers, 'content-type'),
        etag: identityEtag,
        exactResponseHeaders: headers,
        identityResponse: responseEvidence(identity),
        kovoPad: 'absent',
        lastModified: headerValue(identity.headers, 'last-modified'),
        requestAcceptEncoding: condition.encoding,
        requestIfNoneMatch: null,
        selectedResponse: responseEvidence(primeRepresentation),
        status: primeRepresentation.statusCode,
        wireBodyBytes: primeRepresentation.body.byteLength,
        wireBodySha256: sha256(primeRepresentation.body),
      },
      expectation: null,
      path: pathValue,
      requestEtag: null,
      support,
    };
  }
  const kovoPad =
    framework === 'kovo' && condition.encoding === 'br' && condition.mode !== '304'
      ? 'required-fresh'
      : 'absent';
  if (kovoPad === 'required-fresh' && !headerValue(primeRepresentation.headers, 'kovo-pad')) {
    throw new Error('compressed Kovo prime omitted Kovo-Pad');
  }
  if (framework === 'nextjs' && headerValue(primeRepresentation.headers, 'kovo-pad') !== null) {
    throw new Error('Next.js prime unexpectedly emitted Kovo-Pad');
  }
  const expectation = {
    body: primeRepresentation.body,
    headers,
    kovoPad,
    statusCode: condition.mode === '304' ? 304 : 200,
  };
  return {
    evidence: {
      bodyBytes: identity.body.byteLength,
      bodySha256: identityDigest,
      cacheControl,
      contentEncoding: headerValue(primeRepresentation.headers, 'content-encoding'),
      contentType: headerValue(identity.headers, 'content-type'),
      etag: identityEtag,
      lastModified: headerValue(identity.headers, 'last-modified'),
      exactResponseHeaders: headers,
      kovoPad,
      requestAcceptEncoding: condition.encoding,
      requestIfNoneMatch: requestEtag,
      status: expectation.statusCode,
      wireBodyBytes: primeRepresentation.body.byteLength,
      wireBodySha256: sha256(primeRepresentation.body),
    },
    expectation,
    path: pathValue,
    requestEtag,
    support,
  };
}

function responseEvidence(response) {
  return {
    bodyBytes: response.body.byteLength,
    bodySha256: sha256(response.body),
    contentEncoding: headerValue(response.headers, 'content-encoding'),
    exactResponseHeaders: selectedHeaders(response.headers),
    status: response.statusCode,
  };
}

function assertSuccessfulDocument(response, condition) {
  if (response.statusCode !== 200)
    throw new Error(`identity prime returned HTTP ${String(response.statusCode)}`);
  if (headerValue(response.headers, 'content-encoding') !== null) {
    throw new Error('identity prime returned a content encoding');
  }
  if (!/^text\/html(?:;|$)/iu.test(headerValue(response.headers, 'content-type') ?? '')) {
    throw new Error('identity prime did not return text/html');
  }
  const marker = `data-benchmark-destination="${condition.route}"`;
  if (!response.body.includes(Buffer.from(marker)))
    throw new Error(`identity prime omitted ${marker}`);
  if (
    !response.body.includes(Buffer.from('Field goods for everyday carry')) &&
    condition.route === 'listing'
  ) {
    throw new Error('listing prime omitted matched catalog content');
  }
  if (!response.body.includes(Buffer.from('Linen Field Jacket')) && condition.route === 'detail') {
    throw new Error('detail prime omitted matched product content');
  }
}

function summarizeLoadSample(load, processTree) {
  const sorted = [...load.latenciesMs].sort((left, right) => left - right);
  return {
    durationMs: load.durationMs,
    failedRequests: load.failedRequests,
    kovoPadDistinct: load.kovoPadDistinct,
    misses: load.misses,
    newSockets: load.newSockets,
    p50Ms: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    p99Ms: quantile(sorted, 0.99),
    peakRssBytes: processTree.peakRssBytes,
    processTreeSamples: processTree.rssSamples,
    requests: load.requests,
    requestsPerSecond: load.requests / (load.durationMs / 1_000),
    responseBytes: load.bytes,
    reusedSockets: load.reusedSockets,
    serverCpuMs: processTree.cpuMs,
    serverCpuPercent: processTree.cpuPercent,
    statusCounts: load.statusCounts,
  };
}

function requestOnce({ agent, headers, origin, path: pathValue, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      new URL(pathValue, origin),
      { agent, headers, method: 'GET' },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => {
          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            reusedSocket: request.reusedSocket === true,
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error(`request exceeded ${String(timeoutMs)}ms`)),
    );
    request.once('error', reject);
    request.end();
  });
}

async function entrantDefinition(framework, portValue) {
  const port = boundedInteger(
    portValue ?? (framework === 'kovo' ? 50_310 : 50_311),
    1_024,
    65_535,
    '--port',
  );
  const appRoot = path.join(repoRoot, 'benchmarks', framework);
  if (framework === 'kovo') {
    const version = JSON.parse(
      await readFile(path.join(repoRoot, 'packages/server/package.json'), 'utf8'),
    ).version;
    const deploymentId = `deployment:kovo-server-benchmark-${randomBytes(6).toString('hex')}`;
    return {
      appRoot,
      artifacts: [path.join(appRoot, 'dist/server/server.mjs')],
      build: ['vp', ['exec', 'pnpm', '--dir', appRoot, 'run', 'build']],
      env: {
        KOVO_ATTESTATION_DEPLOYMENT_ID: deploymentId,
        KOVO_ATTESTATION_SECRET: randomBytes(32).toString('hex'),
        NODE_ENV: 'production',
      },
      framework,
      port,
      start: [process.execPath, ['dist/server/server.mjs']],
      versions: { kovo: version },
    };
  }
  const pkg = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
  return {
    appRoot,
    artifacts: [path.join(appRoot, '.next/standalone/benchmarks/nextjs/server.js')],
    build: ['vp', ['exec', 'pnpm', '--dir', appRoot, 'run', 'build']],
    env: { NODE_ENV: 'production' },
    framework,
    port,
    start: [process.execPath, ['.next/standalone/benchmarks/nextjs/server.js']],
    versions: Object.fromEntries(
      ['next', 'react', 'react-dom'].map((name) => [name, pkg.dependencies[name]]),
    ),
  };
}

async function buildEntrant(entrant, dependencies) {
  const snapshots = [];
  if (entrant.framework === 'nextjs') {
    const generatedPath = path.join(entrant.appRoot, 'next-env.d.ts');
    snapshots.push({ body: await readFile(generatedPath), path: generatedPath });
  }
  try {
    await (dependencies.runCommand ?? runCommand)(entrant.build[0], entrant.build[1], {
      cwd: repoRoot,
      label: `${entrant.framework}:server-build`,
    });
  } finally {
    for (const snapshot of snapshots) await writeFile(snapshot.path, snapshot.body);
  }
}

function startEntrant(entrant, dependencies) {
  const child = (dependencies.spawnProcess ?? spawn)(entrant.start[0], entrant.start[1], {
    cwd: entrant.appRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ...entrant.env,
      HOST: 'localhost',
      HOSTNAME: 'localhost',
      PORT: String(entrant.port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  const append = (chunk) => {
    log.push(String(chunk));
    while (log.join('').length > 65_536) log.shift();
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const server = { child, exit: null, exited: false, log };
  child.once('error', (error) => {
    server.exit = `server spawn failed: ${error.message}`;
    server.exited = true;
  });
  child.once('exit', (code, signal) => {
    server.exit = `server exited (code ${String(code)}, signal ${String(signal)})`;
    server.exited = true;
  });
  return server;
}

async function stopEntrant(server) {
  if (!server?.child || server.exited) return;
  terminateProcessGroup(server.child.pid, 'SIGTERM');
  await Promise.race([onceExit(server.child), delay(3_000)]);
  if (!server.exited) {
    terminateProcessGroup(server.child.pid, 'SIGKILL');
    await Promise.race([onceExit(server.child), delay(2_000)]);
  }
}

async function waitForHttp(origin, server) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (server.exit) throw new Error(`${server.exit}: ${server.log.join('').slice(-4_096)}`);
    try {
      const response = await fetch(origin);
      await response.arrayBuffer();
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${String(response.status)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `server readiness exceeded 30000ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function runCommand(command, args, { cwd, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (code ${String(code)}, signal ${String(signal)})`));
    });
  });
}

function selectedHeaders(headers) {
  return Object.fromEntries(
    [
      'cache-control',
      'content-encoding',
      'content-length',
      'content-type',
      'etag',
      'last-modified',
      'transfer-encoding',
      'vary',
      'x-nextjs-cache',
      'x-nextjs-prerender',
    ].map((name) => [name, headerValue(headers, name)]),
  );
}

function headerValue(headers, name) {
  const value = headers?.[name];
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : null;
}

function commaSeparatedTokens(value) {
  return new Set(
    String(value)
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function quantile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function validateCondition(condition) {
  assertMember('--concurrency', condition.concurrency, SERVER_CONCURRENCIES);
  assertMember('--encoding', condition.encoding, SERVER_ENCODINGS);
  assertMember('--mode', condition.mode, SERVER_MODES);
  assertMember('--route', condition.route, SERVER_ROUTES);
}

function assertMember(name, value, allowed) {
  if (!allowed.includes(value)) throw new TypeError(`${name} must be one of ${allowed.join(', ')}`);
}

function boundedInteger(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${String(min)} and ${String(max)}`);
  }
  return value;
}

function sameSourceState(left, right) {
  return (
    left.commit === right.commit &&
    JSON.stringify(left.dirtyPaths) === JSON.stringify(right.dirtyPaths) &&
    JSON.stringify(left.locks) === JSON.stringify(right.locks)
  );
}

function portInUse(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(true));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, 'localhost');
  });
}

function terminateProcessGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function onceExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const framework = readArg('--framework');
  const prepareOnly = process.argv.includes('--prepare-only');
  const rawMode = readArg('--mode') ?? 'HIT';
  const mode =
    rawMode.toLowerCase() === 'hit'
      ? 'HIT'
      : rawMode.toLowerCase() === 'dynamic'
        ? 'dynamic'
        : rawMode;
  const report = await runServerBenchmark({
    allowDirty: process.argv.includes('--allow-dirty'),
    concurrency: readIntegerArg('--concurrency', { fallback: 1, max: 32 }),
    durationMs: readIntegerArg('--duration-ms', {
      fallback: DEFAULT_DURATION_MS,
      max: 60_000,
      min: 25,
    }),
    encoding: readArg('--encoding') ?? 'identity',
    framework,
    mode,
    port: readIntegerArg('--port', {
      fallback: framework === 'nextjs' ? 50_311 : 50_310,
      max: 65_535,
      min: 1_024,
    }),
    prepareOnly,
    route: readArg('--route') ?? 'listing',
    skipBuild: process.argv.includes('--skip-build'),
    warmupMs: readIntegerArg('--warmup-ms', { fallback: DEFAULT_WARMUP_MS, max: 60_000, min: 25 }),
  });
  const output = readArg('--out');
  if (!output) throw new Error('--out is required');
  await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  if (
    report.integrity.complete !== true ||
    (!['measured', 'unsupported'].includes(report.verdict?.status) &&
      !process.argv.includes('--allow-dirty'))
  ) {
    process.stderr.write(`server benchmark is unproven: ${report.integrity.errors.join('; ')}\n`);
    process.exitCode = 2;
  }
}
