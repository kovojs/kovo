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
    ports.some((port, index) => declaredPorts[index] !== port) ||
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
      const check = handoff?.check;
      if (
        handoff?.schema !== DEV_SESSION_HANDOFF_SCHEMA ||
        handoff?.complete !== true ||
        handoff?.available !== true ||
        handoff?.error !== null ||
        handoff?.socketEvidence !== null ||
        handoff?.attribution?.from !== expectedFrom ||
        handoff?.attribution?.to !== targets[index] ||
        (index === 0
          ? handoff?.attribution?.priorMarkerSha256 !== null
          : typeof handoff?.attribution?.priorMarkerSha256 !== 'string' ||
            !DIGEST_PATTERN.test(handoff.attribution.priorMarkerSha256)) ||
        !exactLocalhostOrigin(handoff?.origin, ports[index]) ||
        check?.sequence !== 1 ||
        !finiteNonNegative(check?.durationMs) ||
        !validIsoTimestamp(check?.checkedAt) ||
        check?.probeError !== null ||
        !validLocalhostHandoffAddresses(check?.addresses)
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
      !exactLocalhostOrigin(lifecycle?.origin, ports[index])
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
    !exactLocalhostOrigin(editLifecycle?.origin, ports.at(-1))
  ) {
    findings.push('edit-session dev lifecycle is incomplete');
  }
  return findings;
}

function exactLocalhostOrigin(value, expectedPort) {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      url.protocol === 'http:' &&
      url.hostname === 'localhost' &&
      Number(url.port) === expectedPort
    );
  } catch {
    return false;
  }
}

function validLocalhostHandoffAddresses(value) {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [ipv4, ipv6] = value;
  if (
    !exactAddressKeys(ipv4) ||
    ipv4.address !== '127.0.0.1' ||
    ipv4.family !== 4 ||
    ipv4.supported !== true ||
    ipv4.available !== true ||
    ipv4.errorCode !== null ||
    !exactAddressKeys(ipv6) ||
    ipv6.address !== '::1' ||
    ipv6.family !== 6 ||
    ipv6.available !== true
  ) {
    return false;
  }
  return ipv6.supported === true
    ? ipv6.errorCode === null
    : ipv6.supported === false && ['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(ipv6.errorCode);
}

function exactAddressKeys(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'address,available,errorCode,family,supported'
  );
}

function validIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
