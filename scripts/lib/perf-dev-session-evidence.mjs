import { DEV_PORT_ALLOCATION_POSTURE } from '../../benchmarks/corpora/generate.mjs';
import { validReadyRouteProbe } from './perf-ready-route.mjs';

export const DEV_SESSION_HANDOFF_SCHEMA = 'kovo-dev-session-handoff/v1';
export const DEV_SESSION_STOP_SCHEMA = 'kovo-dev-session-stop/v3';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/**
 * Validate the process-to-process port handoff evidence shared by decision, comparison, and budget
 * gates. Each dev process owns a distinct exact port, so a late rebind by the prior process cannot
 * collide with its successor. The immediate bind fence still rejects unrelated pre-existing
 * listeners without trying to kill them.
 */
export function devSessionHandoffFindings(report, options) {
  const findings = [];
  const basePort = options?.basePort;
  const readyIterations = options?.readyIterations;
  if (
    !Number.isSafeInteger(basePort) ||
    basePort < 1_024 ||
    !Number.isSafeInteger(readyIterations) ||
    readyIterations < 1 ||
    readyIterations > 100 ||
    basePort + readyIterations > 65_535
  ) {
    return ['expected dev session port range is invalid'];
  }
  const targets = [
    ...Array.from({ length: readyIterations }, (_, index) => `ready[${String(index)}]`),
    'edit-session',
  ];
  const ports = targets.map((_, index) => basePort + index);
  const allocation = report?.integrity?.portAllocation;
  const declaredPorts = Array.isArray(allocation?.ports) ? allocation.ports : null;
  if (
    allocation?.posture !== DEV_PORT_ALLOCATION_POSTURE ||
    allocation?.basePort !== basePort ||
    declaredPorts === null ||
    declaredPorts.length !== ports.length ||
    declaredPorts.some((port, index) => port !== ports[index]) ||
    new Set(declaredPorts).size !== ports.length
  ) {
    findings.push('unique per-session dev port allocation is incomplete');
  }
  const handoffs = report?.integrity?.handoffs;
  if (!Array.isArray(handoffs) || handoffs.length !== targets.length) {
    findings.push('pre-spawn dev handoff count is incomplete');
  } else {
    for (const [index, handoff] of handoffs.entries()) {
      const expectedFrom = index === 0 ? null : targets[index - 1];
      const addresses = handoff?.check?.addresses;
      const supported = Array.isArray(addresses)
        ? addresses.filter((address) => address?.supported === true)
        : [];
      if (
        handoff?.schema !== DEV_SESSION_HANDOFF_SCHEMA ||
        handoff?.complete !== true ||
        handoff?.available !== true ||
        handoff?.error !== null ||
        handoff?.attribution?.from !== expectedFrom ||
        handoff?.attribution?.to !== targets[index] ||
        (index === 0
          ? handoff?.attribution?.priorMarkerSha256 !== null
          : !DIGEST_PATTERN.test(handoff?.attribution?.priorMarkerSha256 ?? '')) ||
        originPort(handoff?.origin) !== ports[index] ||
        handoff?.check?.sequence !== 1 ||
        !finiteNonNegative(handoff?.check?.durationMs) ||
        handoff?.check?.probeError !== null ||
        supported.length < 1 ||
        supported.some((address) => address.available !== true || address.errorCode !== null)
      ) {
        findings.push(`pre-spawn dev handoff ${targets[index]} is incomplete`);
      }
    }
  }
  for (let index = 0; index < readyIterations; index += 1) {
    const readySample = report?.readySamples?.[index];
    const lifecycle = readySample?.lifecycle;
    if (
      readySample?.browserContextClosed !== true ||
      !validReadyRouteProbe(readySample?.readinessProbe)
    ) {
      findings.push(`ready[${String(index)}] dev readiness/browser-context evidence is incomplete`);
    }
    if (
      lifecycle?.schema !== DEV_SESSION_STOP_SCHEMA ||
      lifecycle?.complete !== true ||
      originPort(lifecycle?.origin) !== ports[index]
    ) {
      findings.push(`ready[${String(index)}] dev lifecycle is incomplete`);
    }
  }
  const editSession = report?.editSession;
  const editLifecycle = editSession?.lifecycle;
  if (
    editSession?.browserContextClosed !== true ||
    !validReadyRouteProbe(editSession?.readinessProbe)
  ) {
    findings.push('edit-session dev readiness/browser-context evidence is incomplete');
  }
  if (
    editLifecycle?.schema !== DEV_SESSION_STOP_SCHEMA ||
    editLifecycle?.complete !== true ||
    originPort(editLifecycle?.origin) !== ports.at(-1)
  ) {
    findings.push('edit-session dev lifecycle is incomplete');
  }
  return findings;
}

function originPort(value) {
  try {
    const port = Number(new URL(value).port);
    return Number.isSafeInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
