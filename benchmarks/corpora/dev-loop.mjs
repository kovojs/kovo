#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import { collectPerformanceProvenance } from '../../scripts/lib/perf-provenance.mjs';
import { processTreeRssBytes } from '../../scripts/lib/process-tree-rss.mjs';
import { CORPUS_SCHEMA } from './generate.mjs';

export const DEV_LOOP_REPORT_SCHEMA = 'kovo-dev-loop-report/v1';

const EDIT_CLASSES = Object.freeze(['leaf', 'entry', 'data']);
const ALL_EDIT_CLASSES = Object.freeze([...EDIT_CLASSES, 'syntaxError', 'recovery']);
const GENERATED_OUTPUT_NAMES = new Set(['.kovo', '.next', 'dist']);
const IGNORED_CORPUS_NAMES = new Set([
  '.kovo-benchmark-corpus-owner.json',
  'manifest.json',
  'node_modules',
]);
const MAX_LOG_BYTES = 1024 * 1024;
const READY_TIMEOUT_MS = 120_000;
const EDIT_TIMEOUT_MS = 60_000;
const RSS_SAMPLE_INTERVAL_MS = 50;
const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Measure exactly one generated entrant. `benchmarks/compare.mjs` owns alternating K,N,N,K
 * serialization; keeping this adapter single-entrant prevents an accidental concurrent process
 * tree from contaminating either timing or RSS evidence.
 */
export async function runDevLoopBenchmark(options, dependencies = {}) {
  const normalized = normalizeOptions(options);
  const manifestEvidence = await loadCorpusManifest(normalized.manifestPath);
  const { appRoot, manifest, manifestDigest, manifestPath } = manifestEvidence;
  if (isWithin(appRoot, normalized.outPath)) {
    throw new TypeError('--out must be outside the generated corpus root.');
  }
  await verifyCorpusSources(manifestEvidence);

  const browserType = dependencies.browserType ?? chromium;
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const startedAt = new Date().toISOString();
  const source = collectPerformanceProvenance({
    lockFiles: ['pnpm-lock.yaml', 'benchmarks/nextjs/pnpm-lock.yaml'],
    repoRoot,
  });
  const command = materializeCommand(manifest.dev.command, appRoot, normalized.port);
  const versions = await collectEntrantVersions(appRoot, manifest.framework);
  const report = createReportSkeleton({
    command,
    iterations: normalized.iterations,
    manifest,
    manifestDigest,
    manifestPath,
    readyIterations: Math.max(1, Math.ceil(normalized.iterations / 2)),
    source,
    startedAt,
    versions,
    warmups: normalized.warmups,
  });
  const originalSources = await readOriginalSources(manifestEvidence);
  let browser;

  try {
    browser = await browserType.launch({ headless: true });
    report.environment.browser = { name: 'chromium', version: browser.version() };
    for (let iteration = 0; iteration < report.integrity.readyIterations; iteration += 1) {
      await cleanGeneratedOutputs(appRoot, manifest.build.outputs);
      const observation = await measureFreshReady({
        appRoot,
        browser,
        command,
        iteration,
        manifest,
        spawnProcess,
      });
      report.readySamples.push(observation);
      accumulateObservationIntegrity(report.integrity, observation, `ready[${iteration}]`);
    }

    await cleanGeneratedOutputs(appRoot, manifest.build.outputs);
    const editResult = await measureEditSession({
      appRoot,
      browser,
      command,
      iterations: normalized.iterations,
      manifest,
      originalSources,
      spawnProcess,
      warmups: normalized.warmups,
    });
    report.samples = editResult.samples;
    report.editSession = editResult.session;
    report.profile = profileEditToPaint(editResult.samples);
    if (editResult.session.rssSamples < 1 || editResult.session.peakRssBytes <= 0) {
      report.integrity.errors.push('edit session did not produce process-tree RSS evidence');
    }
    for (const observation of editResult.observations) {
      accumulateObservationIntegrity(
        report.integrity,
        observation,
        `edit.${observation.editClass}[${observation.iteration}]`,
      );
    }
  } catch (error) {
    report.integrity.errors.push(errorMessage(error));
  } finally {
    await browser?.close().catch((error) => {
      report.integrity.errors.push(`browser close: ${errorMessage(error)}`);
    });
    await restoreOriginalSources(appRoot, originalSources).catch((error) => {
      report.integrity.errors.push(`source restoration: ${errorMessage(error)}`);
    });
    await verifyCorpusSources(manifestEvidence).catch((error) => {
      report.integrity.errors.push(`post-run corpus integrity: ${errorMessage(error)}`);
    });
  }

  report.integrity.complete =
    report.integrity.errors.length === 0 &&
    report.integrity.misses === 0 &&
    report.readySamples.length === report.integrity.readyIterations &&
    report.samples.length === report.integrity.iterations;
  report.summary = summarizeReport(report);
  report.environment.loadAverageAfter = os.loadavg();
  report.finishedAt = new Date().toISOString();
  report.verdict.status = report.integrity.complete ? 'measured' : 'unproven';
  return report;
}

async function measureFreshReady({ appRoot, browser, command, iteration, manifest, spawnProcess }) {
  const started = performance.now();
  const session = startDevSession({ appRoot, command, spawnProcess });
  const rss = createProcessTreeRssSampler(session.pid);
  let context;
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    const paint = await waitForReadyPage({
      origin: command.origin,
      page,
      ready: manifest.dev.ready,
      session,
    });
    const rssEvidence = await rss.stop();
    const hasRss = rssEvidence.sampleCount > 0 && rssEvidence.peakRssBytes > 0;
    return {
      durationMs: performance.now() - started,
      error: hasRss ? null : 'fresh ready did not produce process-tree RSS evidence',
      iteration,
      paintFenceMs: paint.paintFenceMs,
      peakRssBytes: rssEvidence.peakRssBytes,
      rssSamples: rssEvidence.sampleCount,
      success: hasRss,
    };
  } catch (error) {
    const rssEvidence = await rss.stop();
    return {
      durationMs: null,
      error: errorMessage(error),
      iteration,
      paintFenceMs: null,
      peakRssBytes: rssEvidence.peakRssBytes,
      rssSamples: rssEvidence.sampleCount,
      success: false,
    };
  } finally {
    await context?.close().catch(() => undefined);
    await session.stop();
  }
}

async function measureEditSession({
  appRoot,
  browser,
  command,
  iterations,
  manifest,
  originalSources,
  spawnProcess,
  warmups,
}) {
  const session = startDevSession({ appRoot, command, spawnProcess });
  const rss = createProcessTreeRssSampler(session.pid);
  let context;
  let pageEvents = { consoleErrors: [], pageErrors: [] };
  let rssEvidence = { peakRssBytes: 0, sampleCount: 0 };
  const samples = Array.from({ length: iterations }, (_, iteration) => ({ iteration }));
  const observations = [];
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    pageEvents = collectPageErrors(page);
    await waitForReadyPage({
      origin: command.origin,
      page,
      ready: manifest.dev.ready,
      session,
    });
    await establishState(page, manifest.dev.state);

    for (const editClass of EDIT_CLASSES) {
      const classObservations = await measureRevisionEditClass({
        appRoot,
        contract: manifest.dev.edits[editClass],
        editClass,
        iterations,
        page,
        session,
        state: manifest.dev.state,
        warmups,
      });
      observations.push(...classObservations.measured);
      for (const observation of classObservations.measured) {
        assignEditSample(samples[observation.iteration], observation);
      }
    }

    const syntaxObservations = await measureSyntaxAndRecovery({
      appRoot,
      iterations,
      leafSource: originalSources.get(manifest.dev.edits.syntaxError.file),
      page,
      recovery: manifest.dev.edits.recovery,
      session,
      state: manifest.dev.state,
      syntaxError: manifest.dev.edits.syntaxError,
      warmups,
    });
    observations.push(...syntaxObservations.measured);
    for (const observation of syntaxObservations.measured) {
      assignEditSample(samples[observation.iteration], observation);
    }
  } finally {
    await context?.close().catch(() => undefined);
    await session.stop();
    rssEvidence = await rss.stop();
  }
  return {
    observations,
    samples,
    session: {
      browserConsoleErrors: pageEvents.consoleErrors,
      browserPageErrors: pageEvents.pageErrors,
      logTail: session.logTail(),
      peakRssBytes: rssEvidence.peakRssBytes,
      rssSamples: rssEvidence.sampleCount,
    },
  };
}

async function measureRevisionEditClass({
  appRoot,
  contract,
  editClass,
  iterations,
  page,
  session,
  state,
  warmups,
}) {
  const filePath = safeCorpusPath(appRoot, contract.file);
  const original = await readFile(filePath, 'utf8');
  let currentLiteral = contract.search;
  const measured = [];
  try {
    for (let index = 0; index < warmups + iterations; index += 1) {
      await establishState(page, state);
      const revision = `${editClass}-${index % 2 === 0 ? 'a' : 'b'}-${String(index)}`;
      const nextLiteral = fillRevision(contract.replacementTemplate, revision);
      const source = replaceExactlyOnce(
        await readFile(filePath, 'utf8'),
        currentLiteral,
        nextLiteral,
      );
      const observation = await applyVisibleEdit({
        editClass,
        evidence: contract.evidence,
        filePath,
        iteration: index - warmups,
        page,
        revision,
        session,
        source,
        state,
      });
      currentLiteral = nextLiteral;
      if (index >= warmups) measured.push(observation);
    }
  } finally {
    await writeFile(filePath, original);
    await waitForEvidence(page, contract.evidence, 'r0', EDIT_TIMEOUT_MS).catch(() => undefined);
  }
  return { measured };
}

async function measureSyntaxAndRecovery({
  appRoot,
  iterations,
  leafSource,
  page,
  recovery,
  session,
  state,
  syntaxError,
  warmups,
}) {
  if (typeof leafSource !== 'string')
    throw new TypeError('Syntax-error source evidence is absent.');
  const filePath = safeCorpusPath(appRoot, syntaxError.file);
  const brokenSource = replaceExactlyOnce(leafSource, syntaxError.search, syntaxError.replacement);
  const measured = [];
  for (let index = 0; index < warmups + iterations; index += 1) {
    await establishState(page, state);
    const syntax = await applySyntaxError({
      filePath,
      iteration: index - warmups,
      page,
      session,
      source: brokenSource,
      state,
    });
    const recovered = await applyRecovery({
      evidence: recovery.evidence,
      filePath,
      iteration: index - warmups,
      page,
      session,
      source: leafSource,
      state,
    });
    if (index >= warmups) measured.push(syntax, recovered);
  }
  return { measured };
}

async function applyVisibleEdit({
  editClass,
  evidence,
  filePath,
  iteration,
  page,
  revision,
  session,
  source,
  state,
}) {
  const logIndex = session.logCount();
  const started = performance.now();
  let writeMs = null;
  try {
    await writeFile(filePath, source);
    writeMs = performance.now() - started;
    const paint = await waitForEvidence(page, evidence, revision, EDIT_TIMEOUT_MS);
    const durationMs = performance.now() - started;
    const stateSurvived = await stateMatches(page, state);
    return {
      durationMs,
      editClass,
      error: null,
      iteration,
      paintFenceMs: paint.paintFenceMs,
      serverGenerationMs: session.generationDurationSince(logIndex),
      stateSurvived,
      success: stateSurvived,
      writeMs,
    };
  } catch (error) {
    return failedEditObservation({ editClass, error, iteration, writeMs });
  }
}

async function applySyntaxError({ filePath, iteration, page, session, source, state }) {
  const logIndex = session.logCount();
  const started = performance.now();
  let writeMs = null;
  try {
    await writeFile(filePath, source);
    writeMs = performance.now() - started;
    const signal = await waitForBrowserErrorOverlay(page, EDIT_TIMEOUT_MS);
    const paintFenceMs = await waitForPaint(page);
    const stateSurvived = await stateMatches(page, state);
    return {
      diagnosticSignal: signal,
      durationMs: performance.now() - started,
      editClass: 'syntaxError',
      error: null,
      iteration,
      paintFenceMs,
      serverGenerationMs: session.generationDurationSince(logIndex),
      stateSurvived,
      success: stateSurvived,
      writeMs,
    };
  } catch (error) {
    return failedEditObservation({ editClass: 'syntaxError', error, iteration, writeMs });
  }
}

async function applyRecovery({ evidence, filePath, iteration, page, session, source, state }) {
  const logIndex = session.logCount();
  const started = performance.now();
  let writeMs = null;
  try {
    await writeFile(filePath, source);
    writeMs = performance.now() - started;
    await waitForOverlayToClear(page, EDIT_TIMEOUT_MS);
    const paint = await waitForEvidence(page, evidence, 'r0', EDIT_TIMEOUT_MS);
    const stateSurvived = await stateMatches(page, state);
    return {
      durationMs: performance.now() - started,
      editClass: 'recovery',
      error: null,
      iteration,
      paintFenceMs: paint.paintFenceMs,
      serverGenerationMs: session.generationDurationSince(logIndex),
      stateSurvived,
      success: stateSurvived,
      writeMs,
    };
  } catch (error) {
    return failedEditObservation({ editClass: 'recovery', error, iteration, writeMs });
  }
}

function failedEditObservation({ editClass, error, iteration, writeMs }) {
  return {
    durationMs: null,
    editClass,
    error: errorMessage(error),
    iteration,
    paintFenceMs: null,
    serverGenerationMs: null,
    stateSurvived: false,
    success: false,
    writeMs,
  };
}

function assignEditSample(sample, observation) {
  const prefix = observation.editClass;
  sample[`${prefix}Ms`] = observation.durationMs;
  sample[`${prefix}PaintFenceMs`] = observation.paintFenceMs;
  sample[`${prefix}ServerGenerationMs`] = observation.serverGenerationMs;
  sample[`${prefix}StateSurvived`] = observation.stateSurvived;
  sample[`${prefix}WriteMs`] = observation.writeMs;
  if (observation.diagnosticSignal !== undefined) {
    sample.syntaxErrorDiagnosticSignal = observation.diagnosticSignal;
  }
}

async function waitForReadyPage({ origin, page, ready, session }) {
  const deadline = performance.now() + READY_TIMEOUT_MS;
  let lastError = 'server did not answer';
  while (performance.now() < deadline) {
    if (session.exited()) {
      throw new Error(`dev process exited before ready: ${session.logTail()}`);
    }
    try {
      const response = await page.goto(new URL(ready.path, origin).href, {
        timeout: 2_000,
        waitUntil: 'domcontentloaded',
      });
      if (response !== null && response.status() >= 400) {
        lastError = `HTTP ${String(response.status())}`;
      } else {
        const locator = page.locator(ready.selector).first();
        if ((await locator.getAttribute(ready.attribute)) === ready.expected) {
          return { paintFenceMs: await waitForPaint(page) };
        }
        lastError = `missing ready evidence ${ready.selector}`;
      }
    } catch (error) {
      lastError = errorMessage(error);
    }
    await delay(25);
  }
  throw new Error(`dev ready timed out: ${lastError}; log tail: ${session.logTail()}`);
}

async function waitForEvidence(page, evidence, revision, timeoutMs) {
  const expected = evidence.expectedTemplate.includes('{revision}')
    ? fillRevision(evidence.expectedTemplate, revision)
    : evidence.expectedTemplate;
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const locator = page.locator(evidence.selector).first();
      const actual =
        typeof evidence.attribute === 'string'
          ? await locator.getAttribute(evidence.attribute)
          : await locator.textContent();
      if (actual?.trim() === expected) {
        return { paintFenceMs: await waitForPaint(page) };
      }
    } catch {
      // Navigation can replace the execution context while an edit is landing.
    }
    await delay(10);
  }
  throw new Error(`browser did not paint ${evidence.selector}=${expected}`);
}

async function waitForBrowserErrorOverlay(page, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const signal = await browserErrorOverlaySignal(page);
      if (signal !== null) return signal;
    } catch {
      // The overlay may be mounting across a document update.
    }
    await delay(10);
  }
  throw new Error('syntax error did not produce a browser-visible error overlay');
}

async function waitForOverlayToClear(page, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      if ((await browserErrorOverlaySignal(page)) === null) return;
    } catch {
      // Navigation can transiently destroy the old overlay execution context.
    }
    await delay(10);
  }
  throw new Error('browser error overlay did not clear after source recovery');
}

async function browserErrorOverlaySignal(page) {
  return page.evaluate(() => {
    const selectors = [
      'vite-error-overlay',
      'nextjs-portal',
      '[data-nextjs-dialog-overlay]',
      '[data-next-badge-root]',
    ];
    const visibleText = (root) => {
      const text = root?.textContent ?? root?.shadowRoot?.textContent ?? '';
      return String(text).trim();
    };
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = visibleText(element);
        if (text.length > 0) return `${selector}:${text.slice(0, 160)}`;
        if (element.shadowRoot) {
          const shadowText = visibleText(element.shadowRoot);
          if (shadowText.length > 0) return `${selector}:${shadowText.slice(0, 160)}`;
        }
      }
    }
    return null;
  });
}

async function waitForPaint(page) {
  const started = performance.now();
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  return performance.now() - started;
}

async function establishState(page, state) {
  if (await stateMatches(page, state)) return;
  const locator = page.locator(state.selector).first();
  const value = (await locator[state.property]())?.trim();
  if (value !== 'Count 0' || state.setup.action !== 'click') {
    throw new Error(`could not establish benchmark state from ${String(value)}`);
  }
  await locator.click();
  if (!(await stateMatches(page, state))) {
    throw new Error('benchmark state setup did not become browser-visible');
  }
}

async function stateMatches(page, state) {
  try {
    const value = await page.locator(state.selector).first()[state.property]();
    return value?.trim() === state.value;
  } catch {
    return false;
  }
}

function collectPageErrors(page) {
  const evidence = { consoleErrors: [], pageErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') boundedPush(evidence.consoleErrors, message.text());
  });
  page.on('pageerror', (error) => boundedPush(evidence.pageErrors, errorMessage(error)));
  return evidence;
}

function startDevSession({ appRoot, command, spawnProcess }) {
  const child = spawnProcess(command.argv[0], command.argv.slice(1), {
    cwd: command.cwd,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ...command.env,
      FORCE_COLOR: '0',
      NEXT_TELEMETRY_DISABLED: '1',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error(`dev process for ${appRoot} did not expose a PID`);
  }
  let exited = false;
  let stopped = false;
  let tail = '';
  const events = [];
  let pending = '';
  const onChunk = (chunk) => {
    const text = String(chunk);
    tail = `${tail}${text}`.slice(-MAX_LOG_BYTES);
    pending += text;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? '';
    for (const line of lines) events.push({ at: performance.now(), line });
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);
  const exit = new Promise((resolve) => {
    child.once('error', (error) => {
      exited = true;
      onChunk(`\nspawn error: ${errorMessage(error)}\n`);
      resolve();
    });
    child.once('exit', () => {
      exited = true;
      resolve();
    });
  });
  return {
    generationDurationSince(index) {
      for (const event of events.slice(index)) {
        const kovo = /\[kovo dev\] edit #\d+ (?:active|failed) after (\d+)ms/u.exec(event.line);
        if (kovo) return Number(kovo[1]);
        const next = /(?:compiled|ready) in\s+(\d+(?:\.\d+)?)\s*(ms|s)/iu.exec(event.line);
        if (next) return Number(next[1]) * (next[2].toLowerCase() === 's' ? 1_000 : 1);
      }
      return null;
    },
    exited: () => exited,
    logCount: () => events.length,
    logTail: () => tail.slice(-8_192),
    pid: child.pid,
    async stop() {
      if (stopped) return exit;
      stopped = true;
      terminateProcessGroup(child.pid, 'SIGTERM');
      await Promise.race([exit, delay(3_000)]);
      if (!exited) {
        terminateProcessGroup(child.pid, 'SIGKILL');
        await Promise.race([exit, delay(2_000)]);
      }
    },
  };
}

function createProcessTreeRssSampler(rootPid) {
  let active = true;
  let inFlight = Promise.resolve();
  let peakRssBytes = 0;
  let sampleCount = 0;
  const sample = async () => {
    const output = await psSnapshot();
    const value = processTreeRssBytes(output, rootPid);
    if (value <= 0) return;
    peakRssBytes = Math.max(peakRssBytes, value);
    sampleCount += 1;
  };
  const schedule = () => {
    if (!active) return;
    inFlight = inFlight.then(sample).catch(() => undefined);
  };
  schedule();
  const timer = setInterval(schedule, RSS_SAMPLE_INTERVAL_MS);
  return {
    async stop() {
      if (active) {
        clearInterval(timer);
        schedule();
        active = false;
      }
      await inFlight;
      return { peakRssBytes, sampleCount };
    },
  };
}

function psSnapshot() {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-axo', 'pid=,ppid=,rss='],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
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

export async function loadCorpusManifest(manifestPathValue) {
  const manifestPath = path.resolve(manifestPathValue);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest?.schema !== CORPUS_SCHEMA)
    throw new TypeError('Unsupported corpus manifest schema.');
  if (!['kovo', 'nextjs'].includes(manifest.framework)) {
    throw new TypeError('Corpus manifest framework must be kovo or nextjs.');
  }
  if (![24, 216].includes(manifest.modules) || manifest.routes !== 4) {
    throw new TypeError('Corpus manifest has an unsupported workload shape.');
  }
  if (!/^[0-9a-f]{64}$/u.test(manifest.shapeDigest)) {
    throw new TypeError('Corpus manifest shapeDigest is invalid.');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(manifest.sourceDigest)) {
    throw new TypeError('Corpus manifest sourceDigest is invalid.');
  }
  validateSourceFiles(manifest.sourceFiles);
  if (sha256(JSON.stringify(manifest.sourceFiles)) !== manifest.sourceDigest) {
    throw new TypeError('Corpus manifest sourceDigest does not authenticate sourceFiles.');
  }
  validateDevContract(manifest.dev);
  if (!Array.isArray(manifest.build?.outputs)) {
    throw new TypeError('Corpus manifest build outputs are absent.');
  }
  const appRoot = path.dirname(manifestPath);
  return {
    appRoot,
    manifest,
    manifestDigest: sha256(manifestBytes),
    manifestPath,
  };
}

export async function verifyCorpusSources({ appRoot, manifest }) {
  const expectedPaths = new Set();
  const actualEvidence = [];
  for (const entry of manifest.sourceFiles) {
    expectedPaths.add(entry.file);
    const filePath = safeCorpusPath(appRoot, entry.file);
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new TypeError(`Corpus source ${entry.file} is not a regular file.`);
    }
    const bytes = await readFile(filePath);
    const observed = { bytes: bytes.byteLength, file: entry.file, sha256: sha256(bytes) };
    if (JSON.stringify(observed) !== JSON.stringify(entry)) {
      throw new TypeError(`Corpus source integrity mismatch for ${entry.file}.`);
    }
    actualEvidence.push(observed);
  }
  const unexpected = (await listCorpusSourcePaths(appRoot)).filter(
    (file) => !expectedPaths.has(file),
  );
  if (unexpected.length > 0) {
    throw new TypeError(`Corpus contains unmanifested source files: ${unexpected.join(', ')}.`);
  }
  if (sha256(JSON.stringify(actualEvidence)) !== manifest.sourceDigest) {
    throw new TypeError('Corpus sourceDigest does not match current source bytes.');
  }
}

async function listCorpusSourcePaths(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (relative === '' && IGNORED_CORPUS_NAMES.has(entry.name)) continue;
    if (relative === '' && GENERATED_OUTPUT_NAMES.has(entry.name)) continue;
    if (relative === '' && entry.name.startsWith('.kovo-build-stage-')) continue;
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await listCorpusSourcePaths(root, child)));
    else if (entry.isFile()) result.push(child);
    else if (entry.isSymbolicLink()) {
      throw new TypeError(`Unexpected corpus symlink ${child}.`);
    }
  }
  return result.sort();
}

function validateSourceFiles(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('Corpus manifest sourceFiles are absent.');
  }
  let prior = '';
  for (const entry of value) {
    const keys = Object.keys(entry ?? {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['bytes', 'file', 'sha256'])) {
      throw new TypeError('Corpus manifest sourceFiles entry has an unexpected shape.');
    }
    assertSafeRelativePath(entry.file, 'source file');
    if (entry.file <= prior)
      throw new TypeError('Corpus manifest sourceFiles must be unique/sorted.');
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new TypeError(`Corpus source byte count is invalid for ${entry.file}.`);
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(entry.sha256)) {
      throw new TypeError(`Corpus source digest is invalid for ${entry.file}.`);
    }
    prior = entry.file;
  }
}

function validateDevContract(dev) {
  if (!Array.isArray(dev?.command?.argv) || dev.command.argv.length === 0) {
    throw new TypeError('Corpus dev command is absent.');
  }
  if (
    dev.command.cwd !== '.' ||
    Object.values(dev.command.env ?? {}).some((v) => typeof v !== 'string')
  ) {
    throw new TypeError('Corpus dev command working directory or environment is invalid.');
  }
  if (!dev.command.argv.includes('localhost') || dev.command.argv.includes('127.0.0.1')) {
    throw new TypeError('Corpus dev command must bind localhost exactly.');
  }
  if (dev.command.argv.filter((part) => part === '{port}').length !== 1) {
    throw new TypeError('Corpus dev command must contain exactly one {port} token.');
  }
  for (const editClass of ALL_EDIT_CLASSES) {
    if (!dev.edits?.[editClass]) throw new TypeError(`Corpus dev edit ${editClass} is absent.`);
  }
  if (
    dev.ready?.path !== '/' ||
    typeof dev.state?.selector !== 'string' ||
    dev.state.property !== 'textContent' ||
    dev.state.setup?.action !== 'click'
  ) {
    throw new TypeError('Corpus browser readiness/state contract is invalid.');
  }
}

function materializeCommand(contract, appRoot, port) {
  const argv = contract.argv.map((part) => (part === '{port}' ? String(port) : part));
  if (argv.some((part) => typeof part !== 'string' || part.length === 0)) {
    throw new TypeError('Corpus dev command contains an invalid argv value.');
  }
  return {
    argv,
    cwd: safeCorpusPath(appRoot, contract.cwd),
    env: { ...contract.env },
    origin: `http://localhost:${String(port)}`,
  };
}

async function cleanGeneratedOutputs(appRoot, outputs) {
  for (const output of outputs) {
    assertSafeRelativePath(output.replace(/\*$/u, 'sentinel'), 'build output');
    if (output.endsWith('*')) {
      const prefix = output.slice(0, -1);
      for (const entry of await readdir(appRoot)) {
        if (entry.startsWith(prefix))
          await rm(safeCorpusPath(appRoot, entry), { force: true, recursive: true });
      }
    } else {
      await rm(safeCorpusPath(appRoot, output), { force: true, recursive: true });
    }
  }
}

async function readOriginalSources({ appRoot, manifest }) {
  return new Map(
    await Promise.all(
      manifest.sourceFiles.map(async ({ file }) => [
        file,
        await readFile(safeCorpusPath(appRoot, file), 'utf8'),
      ]),
    ),
  );
}

async function restoreOriginalSources(appRoot, sources) {
  await Promise.all(
    [...sources].map(([file, source]) => writeFile(safeCorpusPath(appRoot, file), source)),
  );
}

function createReportSkeleton({
  command,
  iterations,
  manifest,
  manifestDigest,
  manifestPath,
  readyIterations,
  source,
  startedAt,
  versions,
  warmups,
}) {
  const cpu = os.cpus()[0];
  return {
    command: { argv: command.argv, cwd: command.cwd, env: command.env },
    corpus: {
      manifestDigest,
      manifestPath,
      modules: manifest.modules,
      routes: manifest.routes,
      shapeDigest: manifest.shapeDigest,
      sourceDigest: manifest.sourceDigest,
    },
    editSession: null,
    environment: {
      arch: process.arch,
      browser: null,
      cpu: cpu ? { count: os.cpus().length, model: cpu.model, speedMhz: cpu.speed } : null,
      loadAverageAfter: null,
      loadAverageBefore: os.loadavg(),
      node: process.version,
      platform: process.platform,
      release: os.release(),
      totalMemoryBytes: os.totalmem(),
      versions,
    },
    finishedAt: null,
    framework: manifest.framework,
    integrity: {
      command: { argv: command.argv, cwd: command.cwd, origin: command.origin },
      complete: false,
      errors: [],
      iterations,
      misses: 0,
      readyIterations,
      source,
      warmups,
    },
    profile: null,
    readySamples: [],
    samples: [],
    schema: DEV_LOOP_REPORT_SCHEMA,
    source,
    startedAt,
    summary: null,
    verdict: { status: 'unproven' },
  };
}

async function collectEntrantVersions(appRoot, framework) {
  const packages =
    framework === 'kovo' ? ['@kovojs/cli', 'vite-plus'] : ['next', 'react', 'react-dom'];
  const result = {};
  for (const packageName of packages) {
    const packageJsonPath = safeCorpusPath(appRoot, `node_modules/${packageName}/package.json`);
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
      throw new TypeError(`Could not resolve ${packageName} version for the dev corpus.`);
    }
    result[packageName] = packageJson.version;
  }
  return result;
}

function accumulateObservationIntegrity(integrity, observation, label) {
  if (observation.success) return;
  integrity.misses += 1;
  integrity.errors.push(`${label}: ${observation.error ?? 'browser state did not survive'}`);
}

function summarizeReport(report) {
  const edit = {};
  for (const editClass of ALL_EDIT_CLASSES) {
    edit[editClass] = summarizeNumbers(report.samples.map((sample) => sample[`${editClass}Ms`]));
  }
  return {
    edit,
    editPeakRssBytes: report.editSession?.peakRssBytes ?? null,
    ready: summarizeNumbers(report.readySamples.map((sample) => sample.durationMs)),
    readyPeakRssBytes: summarizeNumbers(report.readySamples.map((sample) => sample.peakRssBytes)),
  };
}

export function summarizeNumbers(values) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length === 0) return { mad: null, median: null, p95: null, samples: 0 };
  const median = percentile(numbers, 50);
  return {
    mad: percentile(
      numbers.map((value) => Math.abs(value - median)),
      50,
    ),
    median,
    p95: percentile(numbers, 95),
    samples: numbers.length,
  };
}

/** Rank the directly observed, overlapping edit-to-paint spans; no unobserved phase is invented. */
export function profileEditToPaint(samples) {
  const spans = [];
  for (const editClass of ALL_EDIT_CLASSES) {
    for (const [id, suffix] of [
      ['edit-to-paint', 'Ms'],
      ['server-generation', 'ServerGenerationMs'],
      ['paint-fence', 'PaintFenceMs'],
      ['source-write', 'WriteMs'],
    ]) {
      const summary = summarizeNumbers(samples.map((sample) => sample[`${editClass}${suffix}`]));
      if (summary.median !== null) spans.push({ editClass, id, ...summary });
    }
  }
  spans.sort((left, right) => right.median - left.median);
  return {
    note: 'Observed spans overlap. Server-generation is parsed from framework-owned diagnostics; missing phases remain unattributed.',
    topFive: spans.slice(0, 5),
  };
}

function percentile(values, percentage) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((percentage / 100) * sorted.length) - 1)];
}

function normalizeOptions(options) {
  if (!options || typeof options !== 'object')
    throw new TypeError('Benchmark options are required.');
  return {
    iterations: boundedInteger(options.iterations, 1, 100, 'iterations'),
    manifestPath: path.resolve(requiredString(options.manifestPath, 'manifest')),
    outPath: path.resolve(requiredString(options.outPath, 'out')),
    port: boundedInteger(options.port, 1_024, 65_535, 'port'),
    warmups: boundedInteger(options.warmups, 0, 10, 'warmups'),
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !['--iterations', '--manifest', '--out', '--port', '--warmups'].includes(key) ||
      value === undefined
    ) {
      throw new TypeError(`Unknown or incomplete dev-loop option ${String(key)}.`);
    }
    if (Object.hasOwn(values, key)) throw new TypeError(`Duplicate dev-loop option ${key}.`);
    values[key] = value;
  }
  return normalizeOptions({
    iterations: Number(values['--iterations']),
    manifestPath: values['--manifest'],
    outPath: values['--out'],
    port: Number(values['--port']),
    warmups: Number(values['--warmups']),
  });
}

async function writeReport(outPath, report) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const temporary = `${outPath}.tmp-${String(process.pid)}`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, outPath);
}

function failureReport(error, options) {
  return {
    corpus: { manifestPath: options?.manifestPath ?? null, modules: null, shapeDigest: null },
    framework: null,
    integrity: {
      command: null,
      complete: false,
      errors: [errorMessage(error)],
      iterations: options?.iterations ?? null,
      misses: 1,
      readyIterations: null,
      source: null,
      warmups: options?.warmups ?? null,
    },
    readySamples: [],
    samples: [],
    schema: DEV_LOOP_REPORT_SCHEMA,
    source: null,
    verdict: { status: 'unproven' },
  };
}

function fillRevision(template, revision) {
  if (typeof template !== 'string' || !template.includes('{revision}')) {
    throw new TypeError('Edit replacement/evidence template must contain {revision}.');
  }
  return template.replaceAll('{revision}', revision);
}

function replaceExactlyOnce(source, search, replacement) {
  const first = source.indexOf(search);
  if (first === -1 || source.indexOf(search, first + search.length) !== -1) {
    throw new Error(`Edit sentinel must occur exactly once: ${search}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function safeCorpusPath(root, relative) {
  if (relative === '.') return root;
  assertSafeRelativePath(relative, 'corpus path');
  const resolved = path.resolve(root, relative);
  if (!isWithin(root, resolved)) throw new TypeError(`Corpus path escaped root: ${relative}.`);
  return resolved;
}

function assertSafeRelativePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError(`${label} must be a normalized relative path.`);
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required.`);
  return value;
}

function boundedPush(values, value) {
  if (values.length < 100) values.push(String(value).slice(0, 1_024));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let options;
  let report;
  try {
    options = parseArgs(process.argv.slice(2));
    report = await runDevLoopBenchmark(options);
  } catch (error) {
    report = failureReport(error, options);
  }
  const outPath =
    options?.outPath ??
    (() => {
      const index = process.argv.indexOf('--out');
      return index === -1 || !process.argv[index + 1]
        ? null
        : path.resolve(process.argv[index + 1]);
    })();
  if (outPath !== null) await writeReport(outPath, report);
  else process.stderr.write(`${JSON.stringify(report)}\n`);
  if (!report.integrity.complete) process.exitCode = 1;
}
