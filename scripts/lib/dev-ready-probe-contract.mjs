import { createConnection, createServer } from 'node:net';
import { performance } from 'node:perf_hooks';

/**
 * The packed process can take substantially longer to acquire its listener on a contended CI
 * runner than the product is allowed to take on the ratified G2 runner. This ceiling exists only
 * to let the probe reach the socket-bind observation; it is not a startup-performance budget.
 */
export const DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS = 120_000;

/**
 * KF-DEVEX-002 observes the reporter after the socket is listening. Keep this behavioral contract
 * independent from both the infrastructure ceiling above and the separately ratified G2 budgets.
 */
export const DEV_READY_POST_BIND_BUDGET_MS = 5_000;

/**
 * The register's outer process deadline must leave cleanup headroom after listener acquisition.
 */
export const DEV_READY_PROBE_PROCESS_TIMEOUT_MS = 180_000;

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
  if (options.signal?.aborted) return false;
  return await new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };
    const onAbort = () => finish(false);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(DEV_READY_TCP_ATTEMPT_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
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
 * Observe listener acquisition and the first complete seven-line report concurrently. Sequential
 * observation can accidentally accept a report that was already buffered before the harness first
 * proved the socket bound. Both timestamps come from one monotonic clock; ready-before-bind is a
 * contract failure, and the report budget begins at the listener observation rather than at a later
 * caller-controlled timestamp. A TCP poll proves bind only within its final refusal-to-success
 * interval, so a report inside that interval is ordered at zero post-bind delay; a report preceding
 * the final observed refusal is definitively ready-before-bind and is rejected.
 */
export async function waitForKovoDevReadiness(options) {
  const now = options.monotonicNow ?? (() => performance.now());
  const startedAt = options.startedAt ?? now();
  const listenerTimeoutMs =
    options.listenerTimeoutMs ?? DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS;
  const reportTimeoutMs = options.reportTimeoutMs ?? DEV_READY_POST_BIND_BUDGET_MS;
  const observations = { listener: null, report: null };
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

  try {
    const [listener, report] = await Promise.all([
      observeKovoDevTcpListener(context),
      observeFirstKovoDevReadyReport(context),
    ]);
    assertReadyReportAfterListener(context, listener, report);
    assertReadyReportWithinBudget(context, listener, report);
    return {
      ...report.value,
      listenerElapsedMs: elapsedMilliseconds(startedAt, listener.observedAt),
      listenerObservedAt: listener.observedAt,
      observedAfterMs: elapsedMilliseconds(listener.observedAt, report.observedAt),
      readyReportObservedAt: report.observedAt,
    };
  } finally {
    abortController.abort(new Error(`${options.label} readiness observation settled.`));
  }
}

/** Identify the one semantic timeout that a known-failure probe records as an observation. */
export function isKovoDevReadyReportTimeout(error) {
  return error instanceof Error && error.name === DEV_READY_REPORT_TIMEOUT_CODE;
}

async function observeKovoDevTcpListener(context) {
  const deadline = context.startedAt + context.listenerTimeoutMs;
  let lastNotListeningObservedAt = null;
  for (;;) {
    throwIfObservationAborted(context.signal);
    assertObservedDevProcessRunning(context, 'TCP listener', context.startedAt, context.now);
    const connected = await kovoDevLoopbackTcpConnects(context.port, context.host, {
      signal: context.signal,
    });
    throwIfObservationAborted(context.signal);
    const observedAt = context.now();
    if (connected) {
      const listener = { lastNotListeningObservedAt, observedAt };
      context.observations.listener = listener;
      assertReadyReportAfterListener(context, listener, context.observations.report);
      if (observedAt <= deadline) return listener;
      throw listenerTimeoutError(context, observedAt);
    }
    lastNotListeningObservedAt = observedAt;
    assertObservedDevProcessRunning(context, 'TCP listener', context.startedAt, context.now);
    if (observedAt >= deadline) {
      if (context.observations.report !== null) {
        throw readyBeforeListenerError(context, context.observations.report, null);
      }
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
    const output = context.readOutput();
    const value = parseKovoDevReadyReport(output.stdout, context.expected);
    const observedAt = context.now();
    if (value !== null) {
      const report = { observedAt, value };
      context.observations.report = report;
      assertReadyReportAfterListener(context, context.observations.listener, report);
      assertReadyReportWithinBudget(context, context.observations.listener, report);
      return report;
    }

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
    await delay(
      Math.min(DEV_READY_POLL_INTERVAL_MS, Math.max(0, deadline - observedAt)),
      context.signal,
    );
  }
}

function assertReadyReportAfterListener(context, listener, report) {
  if (
    listener === null ||
    report === null ||
    listener.lastNotListeningObservedAt === null ||
    report.observedAt >= listener.lastNotListeningObservedAt
  ) {
    return;
  }
  throw readyBeforeListenerError(context, report, listener);
}

function assertReadyReportWithinBudget(context, listener, report) {
  if (
    listener === null ||
    report === null ||
    report.observedAt - listener.observedAt <= context.reportTimeoutMs
  ) {
    return;
  }
  throw readyReportTimeoutError(context, report.observedAt);
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
  const elapsedMs =
    listener === null
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
