import { createConnection, createServer } from 'node:net';
import { performance } from 'node:perf_hooks';

/**
 * The packed process can take substantially longer to acquire its listener on a contended CI
 * runner than the product is allowed to take on the ratified G2 runner. This ceiling exists only
 * to let the probe reach the socket-bind observation; it is not a startup-performance budget.
 */
export const DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS = 180_000;

/**
 * KF-DEVEX-002 observes the reporter after the socket is listening. Keep this behavioral contract
 * independent from both the infrastructure ceiling above and the separately ratified G2 budgets.
 */
export const DEV_READY_POST_BIND_BUDGET_MS = 5_000;

/**
 * Direct CLI readiness tests use this supervisor ceiling. Packed known-failure rows own separate
 * outer floors because their authenticated consumer install is not part of this reusable contract.
 */
export const DEV_READY_PROBE_PROCESS_TIMEOUT_MS = 240_000;

const DEV_READY_POLL_INTERVAL_MS = 25;
const DEV_READY_TCP_ATTEMPT_TIMEOUT_MS = 250;
const DEV_READY_REPORT_TIMEOUT_CODE = 'KOVO_DEV_READY_REPORT_TIMEOUT';

/** Reserve and release one non-zero loopback port for a subsequent strict-port dev launch. */
export async function reserveKovoDevLoopbackPort(host = '127.0.0.1') {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ exclusive: true, host, port: 0 }, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string' || address.port === 0) {
    server.close();
    throw new Error('Unable to reserve a non-zero loopback port for kovo dev.');
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

/** Return whether the selected loopback listener currently accepts a TCP connection. */
export async function kovoDevLoopbackTcpConnects(port, host = '127.0.0.1', options = {}) {
  return (await observeKovoDevLoopbackTcpConnection(port, host, options)) !== null;
}

/**
 * Attach this observer synchronously after spawning `kovo dev`, before yielding to the event loop.
 * The data callback owns the report clock: delayed callers receive the original delivery timestamp,
 * never a timestamp manufactured when they eventually inspect a cumulative buffer.
 */
export function createKovoDevReadyReportObserver(stdout, expected, options = {}) {
  const now = options.monotonicNow ?? (() => performance.now());
  let accumulated = '';
  let disposed = false;
  let report = null;
  const subscribers = new Set();

  const onData = (chunk) => {
    if (disposed || report !== null) return;
    const observedAt = now();
    accumulated += String(chunk);
    const value = parseKovoDevReadyReport(accumulated, expected);
    if (value === null) return;

    report = { observedAt, value };
    stdout.removeListener('data', onData);
    for (const subscriber of subscribers) subscriber(report);
    subscribers.clear();
  };

  stdout.on('data', onData);
  return {
    current: () => report,
    dispose() {
      if (disposed) return;
      disposed = true;
      stdout.removeListener('data', onData);
      subscribers.clear();
    },
    subscribe(subscriber) {
      if (report !== null) {
        subscriber(report);
        return () => undefined;
      }
      if (disposed) {
        throw new Error('Kovo dev ready report observer was already disposed.');
      }
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
}

async function observeKovoDevLoopbackTcpConnection(port, host = '127.0.0.1', options = {}) {
  if (options.signal?.aborted) return null;
  const now = options.monotonicNow ?? (() => performance.now());
  return await new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (observation) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      socket.removeAllListeners();
      socket.destroy();
      resolve(observation);
    };
    const onAbort = () => finish(null);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(DEV_READY_TCP_ATTEMPT_TIMEOUT_MS, () => finish(null));
    socket.once('connect', () => {
      const observation = { observedAt: now() };
      options.onConnect?.(observation);
      finish(observation);
    });
    socket.once('error', () => finish(null));
  });
}

/**
 * Parse only a complete framework-owned ready report for the expected app and listener. A partial
 * `Local URL` line is deliberately not readiness: G2 owns the complete structured report.
 */
export function parseKovoDevReadyReport(stdout, expected) {
  const lines = stdout.replaceAll('\r\n', '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const durationMatch = /^Kovo dev ready in (\d+)ms$/u.exec(lines[index] ?? '');
    if (durationMatch?.[1] === undefined) continue;
    const durationMs = Number(durationMatch[1]);
    const databaseLine = lines[index + 5] ?? '';
    const database = databaseLine.startsWith('  Database     ')
      ? databaseLine.slice('  Database     '.length)
      : '';
    if (
      !Number.isSafeInteger(durationMs) ||
      (lines[index + 1] ?? '') !== `  Local URL    ${expected.localUrl}` ||
      (lines[index + 2] ?? '') !== `  Network URL  ${expected.localUrl} (loopback only)` ||
      (lines[index + 3] ?? '') !== `  Mode         ${expected.mode}` ||
      (lines[index + 4] ?? '') !== `  App          ${expected.appEntry}` ||
      database.length === 0 ||
      (expected.database !== undefined && database !== expected.database) ||
      (lines[index + 6] ?? '') !== `  Devtool      ${expected.localUrl}__kovo`
    ) {
      continue;
    }
    return { appEntry: expected.appEntry, database, durationMs, localUrl: expected.localUrl };
  }
  return null;
}

/**
 * Observe listener acquisition and the first complete seven-line report concurrently. The report
 * observer timestamps delivery in the stdout callback and the listener probe timestamps success in
 * the socket connect callback. The common case is point-observed connect-before-report ordering.
 * Kovo's internal ready-report seam separately proves that its authenticated strict-port report is
 * constructed only after `listening`; when delivery falls inside the final refusal-to-immediate-
 * success interval, this observer records a zero-millisecond interval-censored result. A failed
 * immediate connection or a report before the last refusal remains a ready-before-bind failure.
 */
export async function waitForKovoDevReadiness(options) {
  if (options.reportObserver === undefined) {
    throw new Error(
      `${options.label} must attach a ready report observer before launching readiness observation.`,
    );
  }
  const now = options.monotonicNow ?? (() => performance.now());
  const startedAt = options.startedAt ?? now();
  const listenerTimeoutMs =
    options.listenerTimeoutMs ?? DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS;
  const reportTimeoutMs = options.reportTimeoutMs ?? DEV_READY_POST_BIND_BUDGET_MS;
  const observations = { lastNotListeningObservedAt: null, listener: null, report: null };
  const abortController = new AbortController();
  const context = {
    ...options,
    listenerTimeoutMs,
    now,
    observations,
    reportTimeoutMs,
    signal: abortController.signal,
    startedAt,
  };
  context.reportDelivery = subscribeToFirstReadyReport(context);

  try {
    assertReadyReportTargetsSelectedListener(context);
    const [report, listener] = await Promise.all([
      observeFirstKovoDevReadyReport(context),
      observeKovoDevTcpListener(context),
    ]);
    assertReadyReportAfterListener(context, listener, report);
    assertReadyReportWithinBudget(context, listener, report);
    const intervalCensored = report.observationKind === 'interval-censored';
    const observedAfterMs = intervalCensored
      ? 0
      : elapsedMilliseconds(listener.observedAt, report.observedAt);
    return {
      ...report.value,
      listenerElapsedMs: elapsedMilliseconds(startedAt, listener.observedAt),
      listenerObservedAt: listener.observedAt,
      observedAfterMs,
      observedAfterMsKind: report.observationKind,
      observedAfterMsUpperBound: intervalCensored
        ? elapsedMilliseconds(report.lastNotListeningObservedAt, report.observedAt)
        : observedAfterMs,
      readyReportObservedAt: report.observedAt,
    };
  } finally {
    abortController.abort(new Error(`${options.label} readiness observation settled.`));
    options.reportObserver.dispose();
  }
}

/** Identify the one semantic timeout that a known-failure probe records as an observation. */
export function isKovoDevReadyReportTimeout(error) {
  return error instanceof Error && error.name === DEV_READY_REPORT_TIMEOUT_CODE;
}

function subscribeToFirstReadyReport(context) {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => undefined;
    const finish = (delivery) => {
      if (settled) return;
      settled = true;
      context.signal.removeEventListener('abort', onAbort);
      unsubscribe();
      resolve(delivery);
    };
    const onAbort = () => finish(null);
    context.signal.addEventListener('abort', onAbort, { once: true });
    unsubscribe = context.reportObserver.subscribe((report) => {
      finish({
        lastNotListeningObservedAt: context.observations.lastNotListeningObservedAt,
        listenerAtDelivery: context.observations.listener,
        report,
      });
    });
    if (settled) unsubscribe();
  });
}

async function observeKovoDevTcpListener(context) {
  const deadline = context.startedAt + context.listenerTimeoutMs;
  for (;;) {
    throwIfObservationAborted(context.signal);
    if (context.observations.listener !== null) {
      if (context.observations.listener.observedAt <= deadline) {
        return context.observations.listener;
      }
      throw listenerTimeoutError(context, context.observations.listener.observedAt);
    }
    assertObservedDevProcessRunning(context, 'TCP listener', context.startedAt, context.now);
    const connection = await observeKovoDevLoopbackTcpConnection(context.port, context.host, {
      monotonicNow: context.now,
      onConnect: (observation) => {
        recordKovoDevListenerObservation(context, observation);
      },
      signal: context.signal,
    });
    throwIfObservationAborted(context.signal);
    if (connection !== null) {
      const listener = context.observations.listener;
      context.onTcpObservation?.({ connected: true, observedAt: listener.observedAt });
      if (listener.observedAt <= deadline) return listener;
      throw listenerTimeoutError(context, listener.observedAt);
    }
    if (context.observations.listener !== null) {
      if (context.observations.listener.observedAt <= deadline) {
        return context.observations.listener;
      }
      throw listenerTimeoutError(context, context.observations.listener.observedAt);
    }
    const observedAt = context.now();
    context.observations.lastNotListeningObservedAt = observedAt;
    context.onTcpObservation?.({ connected: false, observedAt });
    assertObservedDevProcessRunning(context, 'TCP listener', context.startedAt, context.now);
    if (observedAt >= deadline) {
      throw listenerTimeoutError(context, observedAt);
    }
    await delay(
      Math.min(DEV_READY_POLL_INTERVAL_MS, Math.max(0, deadline - observedAt)),
      context.signal,
    );
  }
}

async function observeFirstKovoDevReadyReport(context) {
  const maximumDeadline = context.startedAt + context.listenerTimeoutMs + context.reportTimeoutMs;
  for (;;) {
    throwIfObservationAborted(context.signal);
    assertObservedDevProcessRunning(
      context,
      'structured ready report',
      context.startedAt,
      context.now,
    );
    const observedAt = context.now();
    const deadline =
      context.observations.listener === null
        ? maximumDeadline
        : context.observations.listener.observedAt + context.reportTimeoutMs;
    if (observedAt >= deadline) {
      if (context.observations.listener === null) {
        throw listenerTimeoutError(context, observedAt);
      }
      throw readyReportTimeoutError(context, observedAt);
    }

    const delivery = await Promise.race([
      context.reportDelivery,
      delay(
        Math.min(DEV_READY_POLL_INTERVAL_MS, Math.max(0, deadline - observedAt)),
        context.signal,
      ).then(() => null),
    ]);
    if (delivery === null) continue;

    const { lastNotListeningObservedAt, listenerAtDelivery, report } = delivery;
    if (listenerAtDelivery !== null) {
      const exactReport = { ...report, observationKind: 'exact' };
      context.observations.report = exactReport;
      assertReadyReportAfterListener(context, listenerAtDelivery, exactReport);
      assertReadyReportWithinBudget(context, listenerAtDelivery, exactReport);
      return exactReport;
    }
    if (lastNotListeningObservedAt === null || report.observedAt < lastNotListeningObservedAt) {
      throw readyBeforeListenerError(context, report, null);
    }

    const immediateConnection = await observeKovoDevLoopbackTcpConnection(
      context.port,
      context.host,
      {
        monotonicNow: context.now,
        onConnect: (observation) => {
          recordKovoDevListenerObservation(context, observation);
        },
        signal: context.signal,
      },
    );
    throwIfObservationAborted(context.signal);
    if (immediateConnection === null) {
      throw readyBeforeListenerError(context, report, null);
    }
    const intervalReport = {
      ...report,
      lastNotListeningObservedAt,
      observationKind: 'interval-censored',
    };
    context.observations.report = intervalReport;
    assertReadyReportWithinBudget(context, context.observations.listener, intervalReport);
    return intervalReport;
  }
}

function recordKovoDevListenerObservation(context, observation) {
  if (
    context.observations.listener === null ||
    observation.observedAt < context.observations.listener.observedAt
  ) {
    context.observations.listener = { observedAt: observation.observedAt };
  }
}

function assertReadyReportAfterListener(context, listener, report) {
  if (report === null) return;
  if (report.observationKind === 'interval-censored' && listener !== null) return;
  if (listener !== null && report.observedAt >= listener.observedAt) return;
  throw readyBeforeListenerError(context, report, listener);
}

function assertReadyReportWithinBudget(context, listener, report) {
  const elapsed =
    report?.observationKind === 'interval-censored'
      ? report.observedAt - report.lastNotListeningObservedAt
      : listener === null || report === null
        ? 0
        : report.observedAt - listener.observedAt;
  if (listener === null || report === null || elapsed <= context.reportTimeoutMs) {
    return;
  }
  throw readyReportTimeoutError(context, report.observedAt);
}

function assertReadyReportTargetsSelectedListener(context) {
  const host = context.host ?? '127.0.0.1';
  const normalizedHost = host.startsWith('[') ? host : host.includes(':') ? `[${host}]` : host;
  const selectedLocalUrl = `http://${normalizedHost}:${context.port}/`;
  if (context.expected.localUrl === selectedLocalUrl) return;
  throw new Error(
    `${context.label} ready report expectation must target selected strict listener ` +
      `${selectedLocalUrl}, received ${context.expected.localUrl}.`,
  );
}

function readyBeforeListenerError(context, report, listener) {
  const readyElapsedMs = elapsedMilliseconds(context.startedAt, report.observedAt);
  const listenerElapsedMs =
    listener === null
      ? 'unobserved'
      : `${elapsedMilliseconds(context.startedAt, listener.observedAt)}ms`;
  return new Error(
    `${context.label} observed its complete structured ready report before TCP listener ` +
      `observation (ready-before-bind; ready=${readyElapsedMs}ms, listener=${listenerElapsedMs}).` +
      formatObservedDevOutput(context.readOutput()),
  );
}

function listenerTimeoutError(context, observedAt) {
  return new Error(
    `${context.label} did not acquire TCP listener ${context.host ?? '127.0.0.1'}:${context.port} ` +
      `within the ${context.listenerTimeoutMs}ms infrastructure ceiling ` +
      `(elapsed=${elapsedMilliseconds(context.startedAt, observedAt)}ms).` +
      formatObservedDevOutput(context.readOutput()),
  );
}

function readyReportTimeoutError(context, observedAt) {
  const listener = context.observations.listener;
  const report = context.observations.report;
  const elapsedMs =
    report?.observationKind === 'interval-censored'
      ? elapsedMilliseconds(report.lastNotListeningObservedAt, observedAt)
      : listener === null
        ? elapsedMilliseconds(context.startedAt, observedAt)
        : elapsedMilliseconds(listener.observedAt, observedAt);
  const error = new Error(
    `${context.label} did not emit its complete structured ready report within the ` +
      `${context.reportTimeoutMs}ms post-bind budget (elapsed=${elapsedMs}ms, ` +
      `localUrl=${context.expected.localUrl}, mode=${context.expected.mode}, ` +
      `app=${context.expected.appEntry}).` +
      formatObservedDevOutput(context.readOutput()),
  );
  error.name = DEV_READY_REPORT_TIMEOUT_CODE;
  return error;
}

function assertObservedDevProcessRunning(options, phase, startedAt, now = () => performance.now()) {
  const status = options.readStatus();
  if (status.exitCode === null && status.signalCode === null) return;
  throw new Error(
    `${options.label} exited before ${phase} (exit=${String(status.exitCode)}, ` +
      `signal=${String(status.signalCode)}, elapsed=${elapsedMilliseconds(startedAt, now())}ms).` +
      formatObservedDevOutput(options.readOutput()),
  );
}

function formatObservedDevOutput(output) {
  return `\n--- stdout ---\n${output.stdout}\n--- stderr ---\n${output.stderr}`;
}

function elapsedMilliseconds(startedAt, observedAt) {
  return Math.max(0, Math.ceil(observedAt - startedAt));
}

function throwIfObservationAborted(signal) {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Readiness observation aborted.');
}

function delay(timeoutMs, signal) {
  if (timeoutMs <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
