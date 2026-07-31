import { createConnection, createServer } from 'node:net';

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
export async function kovoDevLoopbackTcpConnects(port, host = '127.0.0.1') {
  return await new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };
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

/** Wait for the infrastructure-only TCP listener phase under its contended-runner ceiling. */
export async function waitForKovoDevTcpListener(options) {
  const startedAt = options.startedAt ?? Date.now();
  const timeoutMs = options.timeoutMs ?? DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS;
  const deadline = startedAt + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) break;
    assertObservedDevProcessRunning(options, 'TCP listener', startedAt);
    if (await kovoDevLoopbackTcpConnects(options.port, options.host)) {
      return { elapsedMs: Date.now() - startedAt };
    }
    assertObservedDevProcessRunning(options, 'TCP listener', startedAt);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await delay(Math.min(DEV_READY_POLL_INTERVAL_MS, remainingMs));
  }
  throw new Error(
    `${options.label} did not acquire TCP listener ${options.host ?? '127.0.0.1'}:${options.port} ` +
      `within the ${timeoutMs}ms infrastructure ceiling (elapsed=${Date.now() - startedAt}ms).` +
      formatObservedDevOutput(options.readOutput()),
  );
}

/** Wait only for the complete post-bind ready report under the five-second semantic budget. */
export async function waitForKovoDevReadyReport(options) {
  const startedAt = options.startedAt ?? Date.now();
  const timeoutMs = options.timeoutMs ?? DEV_READY_POST_BIND_BUDGET_MS;
  const deadline = startedAt + timeoutMs;
  for (;;) {
    const observedAt = Date.now();
    if (observedAt > deadline) break;
    assertObservedDevProcessRunning(options, 'structured ready report', startedAt);
    const report = parseKovoDevReadyReport(options.readOutput().stdout, options.expected);
    if (report !== null) return { ...report, observedAfterMs: observedAt - startedAt };
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await delay(Math.min(DEV_READY_POLL_INTERVAL_MS, remainingMs));
  }
  assertObservedDevProcessRunning(options, 'structured ready report', startedAt);
  throw new Error(
    `${options.label} did not emit its complete structured ready report within the ${timeoutMs}ms ` +
      `post-bind budget (elapsed=${Date.now() - startedAt}ms, localUrl=${options.expected.localUrl}, ` +
      `mode=${options.expected.mode}, app=${options.expected.appEntry}).` +
      formatObservedDevOutput(options.readOutput()),
  );
}

function assertObservedDevProcessRunning(options, phase, startedAt) {
  const status = options.readStatus();
  if (status.exitCode === null && status.signalCode === null) return;
  throw new Error(
    `${options.label} exited before ${phase} (exit=${String(status.exitCode)}, ` +
      `signal=${String(status.signalCode)}, elapsed=${Date.now() - startedAt}ms).` +
      formatObservedDevOutput(options.readOutput()),
  );
}

function formatObservedDevOutput(output) {
  return `\n--- stdout ---\n${output.stdout}\n--- stderr ---\n${output.stderr}`;
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
