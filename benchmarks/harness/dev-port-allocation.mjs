import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const DEFAULT_DEV_PORT_BASE = 20_000;
export const DEV_EPHEMERAL_PORT_RANGE_SCHEMA = 'kovo-host-ephemeral-port-ranges/v1';
export const DEV_PORT_ALLOCATION_POSTURE = 'unique-exact-port-outside-host-ephemeral/v2';
export const DEV_PORT_ALLOCATION_SCHEMA = 'kovo-dev-port-allocation/v1';
const DEV_EPHEMERAL_PORT_RANGE_SCOPE = 'tcp-loopback-v4-v6/v1';

const LINUX_EPHEMERAL_RANGE_PATH = '/proc/sys/net/ipv4/ip_local_port_range';
const DARWIN_EPHEMERAL_RANGE_KEYS = Object.freeze([
  'net.inet.ip.portrange.first',
  'net.inet.ip.portrange.last',
  'net.inet.ip.portrange.hifirst',
  'net.inet.ip.portrange.hilast',
  'net.inet.ip.portrange.lowfirst',
  'net.inet.ip.portrange.lowlast',
]);
const MAX_EPHEMERAL_RANGE_EVIDENCE_BYTES = 4_096;

// Linux deliberately exposes this TCP/UDP auto-bind range below `net.ipv4`; the kernel also uses
// it for IPv6. The authenticated scope is therefore both loopback families, matching the harness's
// dual-stack availability probes (Linux Landlock ABI documentation states the IPv6 sharing
// explicitly: https://docs.kernel.org/userspace-api/landlock.html#network-support-tcp).

/**
 * Read and authenticate the host's kernel-owned TCP ephemeral ranges. Performance measurements
 * support Linux and macOS only: an unknown platform or unreadable kernel posture stays unproven.
 */
export async function inspectHostEphemeralPortRanges(dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  try {
    if (platform === 'linux') {
      const bytes = await boundedBytes(
        await (dependencies.readLinuxRange ?? readFile)(LINUX_EPHEMERAL_RANGE_PATH),
        LINUX_EPHEMERAL_RANGE_PATH,
      );
      const values = integerTokens(bytes, LINUX_EPHEMERAL_RANGE_PATH);
      if (values.length !== 2 || values[0] > values[1]) {
        throw new TypeError('Linux ephemeral port range must contain one ascending pair.');
      }
      return validateHostEphemeralPortRangeEvidence({
        complete: true,
        error: null,
        platform,
        probe: probeEvidence('procfs', LINUX_EPHEMERAL_RANGE_PATH, bytes),
        ranges: [{ label: 'default', maximum: values[1], minimum: values[0] }],
        schema: DEV_EPHEMERAL_PORT_RANGE_SCHEMA,
        scope: DEV_EPHEMERAL_PORT_RANGE_SCOPE,
      });
    }

    if (platform === 'darwin') {
      const bytes = await boundedBytes(
        await (dependencies.readDarwinRanges ?? readDarwinEphemeralRanges)(),
        'darwin ephemeral port sysctls',
      );
      const values = integerTokens(bytes, 'darwin ephemeral port sysctls');
      if (values.length !== DARWIN_EPHEMERAL_RANGE_KEYS.length) {
        throw new TypeError('macOS ephemeral port sysctls returned an incomplete value census.');
      }
      const ranges = [];
      for (let index = 0; index < values.length; index += 2) {
        ranges.push({
          label: index === 0 ? 'default' : index === 2 ? 'high' : 'low',
          maximum: Math.max(values[index], values[index + 1]),
          minimum: Math.min(values[index], values[index + 1]),
        });
      }
      return validateHostEphemeralPortRangeEvidence({
        complete: true,
        error: null,
        platform,
        probe: probeEvidence('sysctl', DARWIN_EPHEMERAL_RANGE_KEYS.join(','), bytes),
        ranges,
        schema: DEV_EPHEMERAL_PORT_RANGE_SCHEMA,
        scope: DEV_EPHEMERAL_PORT_RANGE_SCOPE,
      });
    }

    throw new TypeError(`unsupported performance host platform ${boundedMessage(platform)}`);
  } catch (error) {
    return validateHostEphemeralPortRangeEvidence({
      complete: false,
      error: boundedMessage(errorMessage(error)),
      platform: boundedMessage(platform),
      probe: null,
      ranges: [],
      schema: DEV_EPHEMERAL_PORT_RANGE_SCHEMA,
      scope: DEV_EPHEMERAL_PORT_RANGE_SCOPE,
    });
  }
}

/** Build exact server/Inspector allocation evidence and reject every kernel-range overlap. */
export async function inspectDevPortAllocation(options, dependencies = {}) {
  const basePort = boundedPort(options?.basePort, 'dev port base');
  const ports = exactPortList(options?.ports, 'dev session ports');
  const inspectorPorts = exactPortList(options?.inspectorPorts ?? [], 'dev Inspector ports');
  const allPorts = [...ports, ...inspectorPorts];
  const errors = [];
  if (new Set(allPorts).size !== allPorts.length) {
    errors.push('dev server and Inspector ports are not globally unique');
  }
  if (ports.length === 0 || ports[0] !== basePort) {
    errors.push('dev port base does not equal the first exact session port');
  }
  const host = await (dependencies.inspectHostRanges ?? inspectHostEphemeralPortRanges)(
    dependencies.hostDependencies ?? {},
  );
  const validatedHost = validateHostEphemeralPortRangeEvidence(host);
  if (!validatedHost.complete) {
    errors.push(`host ephemeral port range is unproven: ${validatedHost.error}`);
  }
  const overlaps = [];
  for (const [kind, values] of [
    ['dev-session', ports],
    ['inspector', inspectorPorts],
  ]) {
    for (const port of values) {
      for (const range of validatedHost.ranges) {
        if (port < range.minimum || port > range.maximum) continue;
        overlaps.push({ kind, label: range.label, port });
      }
    }
  }
  if (overlaps.length > 0) {
    errors.push(
      `allocated ports overlap host ephemeral ranges: ${overlaps
        .map(({ kind, label, port }) => `${kind}:${String(port)}@${label}`)
        .join(', ')}`,
    );
  }
  return validateDevPortAllocationEvidence({
    basePort,
    complete: errors.length === 0,
    errors,
    hostEphemeral: validatedHost,
    inspectorPorts,
    overlaps,
    ports,
    posture: DEV_PORT_ALLOCATION_POSTURE,
    schema: DEV_PORT_ALLOCATION_SCHEMA,
  });
}

export function validateHostEphemeralPortRangeEvidence(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.schema !== DEV_EPHEMERAL_PORT_RANGE_SCHEMA ||
    typeof value.complete !== 'boolean' ||
    !boundedString(value.platform) ||
    !Array.isArray(value.ranges) ||
    value.scope !== DEV_EPHEMERAL_PORT_RANGE_SCOPE
  ) {
    throw new TypeError('host ephemeral port range evidence is malformed');
  }
  const error = value.error;
  if (
    (value.complete && error !== null) ||
    (!value.complete && !boundedString(error)) ||
    (value.complete && value.ranges.length === 0) ||
    (!value.complete && value.ranges.length !== 0)
  ) {
    throw new TypeError('host ephemeral port range completeness is contradictory');
  }
  let probe = null;
  if (value.probe !== null) {
    if (
      value.probe === undefined ||
      typeof value.probe !== 'object' ||
      !['procfs', 'sysctl'].includes(value.probe.kind) ||
      !boundedString(value.probe.locator) ||
      !Number.isSafeInteger(value.probe.bytes) ||
      value.probe.bytes < 1 ||
      value.probe.bytes > MAX_EPHEMERAL_RANGE_EVIDENCE_BYTES ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.probe.sha256 ?? '')
    ) {
      throw new TypeError('host ephemeral port range probe evidence is malformed');
    }
    probe = { ...value.probe };
  }
  if (value.complete !== (probe !== null)) {
    throw new TypeError('host ephemeral port range probe custody is incomplete');
  }
  const labels = new Set();
  const ranges = value.ranges.map((range) => {
    if (
      range === null ||
      typeof range !== 'object' ||
      !boundedString(range.label) ||
      labels.has(range.label) ||
      !Number.isSafeInteger(range.minimum) ||
      !Number.isSafeInteger(range.maximum) ||
      range.minimum < 1 ||
      range.maximum > 65_535 ||
      range.minimum > range.maximum
    ) {
      throw new TypeError('host ephemeral port range is malformed');
    }
    labels.add(range.label);
    return { label: range.label, maximum: range.maximum, minimum: range.minimum };
  });
  if (
    value.complete &&
    value.platform === 'linux' &&
    (probe?.kind !== 'procfs' ||
      probe.locator !== LINUX_EPHEMERAL_RANGE_PATH ||
      ranges.length !== 1 ||
      ranges[0].label !== 'default')
  ) {
    throw new TypeError(
      'Linux ephemeral range evidence does not bind its dual-stack kernel source',
    );
  }
  if (
    value.complete &&
    value.platform === 'darwin' &&
    (probe?.kind !== 'sysctl' ||
      probe.locator !== DARWIN_EPHEMERAL_RANGE_KEYS.join(',') ||
      ranges.length !== 3 ||
      ranges[0].label !== 'default' ||
      ranges[1].label !== 'high' ||
      ranges[2].label !== 'low')
  ) {
    throw new TypeError('macOS ephemeral range evidence does not bind its kernel sources');
  }
  if (value.complete && value.platform !== 'linux' && value.platform !== 'darwin') {
    throw new TypeError('complete ephemeral range evidence uses an unsupported platform');
  }
  return {
    complete: value.complete,
    error,
    platform: value.platform,
    probe,
    ranges,
    schema: DEV_EPHEMERAL_PORT_RANGE_SCHEMA,
    scope: DEV_EPHEMERAL_PORT_RANGE_SCOPE,
  };
}

export function validateDevPortAllocationEvidence(value, expected = {}) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.schema !== DEV_PORT_ALLOCATION_SCHEMA ||
    value.posture !== DEV_PORT_ALLOCATION_POSTURE ||
    typeof value.complete !== 'boolean' ||
    !Array.isArray(value.errors) ||
    !Array.isArray(value.overlaps)
  ) {
    throw new TypeError('dev port allocation evidence is malformed');
  }
  const basePort = boundedPort(value.basePort, 'dev port allocation base');
  const ports = exactPortList(value.ports, 'dev port allocation sessions');
  const inspectorPorts = exactPortList(value.inspectorPorts, 'dev port allocation Inspector ports');
  const hostEphemeral = validateHostEphemeralPortRangeEvidence(value.hostEphemeral);
  const errors = value.errors.map((error) => {
    if (!boundedString(error)) throw new TypeError('dev port allocation error is malformed');
    return error;
  });
  const overlaps = value.overlaps.map((overlap) => {
    if (
      overlap === null ||
      typeof overlap !== 'object' ||
      !['dev-session', 'inspector'].includes(overlap.kind) ||
      !boundedString(overlap.label) ||
      !Number.isSafeInteger(overlap.port) ||
      !hostEphemeral.ranges.some(
        (range) =>
          range.label === overlap.label &&
          overlap.port >= range.minimum &&
          overlap.port <= range.maximum,
      ) ||
      !(overlap.kind === 'dev-session' ? ports : inspectorPorts).includes(overlap.port)
    ) {
      throw new TypeError('dev port allocation overlap evidence is malformed');
    }
    return { kind: overlap.kind, label: overlap.label, port: overlap.port };
  });
  const globallyUnique =
    new Set([...ports, ...inspectorPorts]).size === ports.length + inspectorPorts.length;
  const derivedBaseMatches = ports.length > 0 && basePort === ports[0];
  const complete =
    hostEphemeral.complete &&
    globallyUnique &&
    derivedBaseMatches &&
    overlaps.length === 0 &&
    errors.length === 0;
  if (value.complete !== complete) {
    throw new TypeError('dev port allocation completeness disagrees with its evidence');
  }
  if (expected.basePort !== undefined && basePort !== expected.basePort) {
    throw new TypeError('dev port allocation base differs from its expected value');
  }
  if (expected.ports !== undefined && !sameNumbers(ports, expected.ports)) {
    throw new TypeError('dev port allocation sessions differ from their expected values');
  }
  if (
    expected.inspectorPorts !== undefined &&
    !sameNumbers(inspectorPorts, expected.inspectorPorts)
  ) {
    throw new TypeError('dev port allocation Inspector ports differ from their expected values');
  }
  return {
    basePort,
    complete,
    errors,
    hostEphemeral,
    inspectorPorts,
    overlaps,
    ports,
    posture: DEV_PORT_ALLOCATION_POSTURE,
    schema: DEV_PORT_ALLOCATION_SCHEMA,
  };
}

function readDarwinEphemeralRanges() {
  return new Promise((resolve, reject) => {
    execFile(
      'sysctl',
      ['-n', ...DARWIN_EPHEMERAL_RANGE_KEYS],
      { encoding: null, maxBuffer: MAX_EPHEMERAL_RANGE_EVIDENCE_BYTES },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

async function boundedBytes(value, label) {
  const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(await value);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_EPHEMERAL_RANGE_EVIDENCE_BYTES) {
    throw new TypeError(`${label} is empty or exceeds its evidence bound.`);
  }
  return bytes;
}

function integerTokens(bytes, label) {
  const text = bytes.toString('utf8');
  if (!/^\s*\d+(?:\s+\d+)*\s*$/u.test(text)) {
    throw new TypeError(`${label} contains non-integer range evidence.`);
  }
  return text
    .trim()
    .split(/\s+/u)
    .map((value) => boundedKernelPort(Number(value), label));
}

function probeEvidence(kind, locator, bytes) {
  return {
    bytes: bytes.byteLength,
    kind,
    locator,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function exactPortList(value, label) {
  if (!Array.isArray(value) || value.length > 1_024) {
    throw new TypeError(`${label} must be a bounded array.`);
  }
  return value.map((port) => boundedPort(port, label));
}

function boundedPort(value, label) {
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 65_535) {
    throw new TypeError(`${label} must contain ports from 1024 through 65535.`);
  }
  return value;
}

function boundedKernelPort(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new TypeError(`${label} must contain ports from 1 through 65535.`);
  }
  return value;
}

function sameNumbers(left, right) {
  return (
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function boundedString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_048;
}

function boundedMessage(value) {
  return String(value).slice(0, 2_048) || 'unknown';
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
