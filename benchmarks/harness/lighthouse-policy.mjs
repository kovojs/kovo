export const LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA = 'kovo-lighthouse-browser-identity/v1';
export const LIGHTHOUSE_SAMPLE_FAILURE_SCHEMA = 'kovo-lighthouse-sample-failure/v1';
export const LIGHTHOUSE_TIMEOUT_POLICY_SCHEMA = 'kovo-lighthouse-timeout-policy/v1';

export const LIGHTHOUSE_METRIC_KEYS = Object.freeze([
  'bytes',
  'fcpMs',
  'lcpMs',
  'performanceScore',
  'speedIndexMs',
  'tbtMs',
  'ttiMs',
]);

export const LIGHTHOUSE_AUDIT_IDS = Object.freeze({
  bytes: 'total-byte-weight',
  fcpMs: 'first-contentful-paint',
  lcpMs: 'largest-contentful-paint',
  speedIndexMs: 'speed-index',
  tbtMs: 'total-blocking-time',
  ttiMs: 'interactive',
});

// Lighthouse 13.4.0 defaults. We pass these values explicitly so an installed-package default
// change cannot silently change the instrument's collection window.
export const LIGHTHOUSE_MAX_WAIT_FOR_FCP_MS = 30_000;
export const LIGHTHOUSE_MAX_WAIT_FOR_LOAD_MS = 45_000;
export const LIGHTHOUSE_CELLS_PER_APP = 4;

// `maxWaitForLoad` only bounds navigation gathering. Audit computation, result serialization, and
// termination still need finite room of their own. One additional minute is deliberately larger
// than the navigation ceiling, while remaining small enough to surface a wedged invocation in CI.
export const LIGHTHOUSE_SUPERVISOR_HEADROOM_MS = 60_000;
export const LIGHTHOUSE_INVOCATION_TIMEOUT_MS =
  LIGHTHOUSE_MAX_WAIT_FOR_LOAD_MS + LIGHTHOUSE_SUPERVISOR_HEADROOM_MS;

export function lighthouseTimeoutPolicy() {
  return {
    cellsPerApp: LIGHTHOUSE_CELLS_PER_APP,
    invocationTimeoutMs: LIGHTHOUSE_INVOCATION_TIMEOUT_MS,
    maxWaitForFcpMs: LIGHTHOUSE_MAX_WAIT_FOR_FCP_MS,
    maxWaitForLoadMs: LIGHTHOUSE_MAX_WAIT_FOR_LOAD_MS,
    schema: LIGHTHOUSE_TIMEOUT_POLICY_SCHEMA,
    supervisorHeadroomMs: LIGHTHOUSE_SUPERVISOR_HEADROOM_MS,
  };
}

export function lighthouseInvocationPhaseMaximumMs(repeats) {
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 100) {
    throw new TypeError('Lighthouse repeat count must be an integer from 1 through 100.');
  }
  return LIGHTHOUSE_CELLS_PER_APP * repeats * LIGHTHOUSE_INVOCATION_TIMEOUT_MS;
}

export function lighthouseTimeoutPolicyFindings(value) {
  const expected = lighthouseTimeoutPolicy();
  return exactKeys(value, Object.keys(expected)) &&
    Object.entries(expected).every(([name, expectedValue]) => value[name] === expectedValue)
    ? []
    : ['Lighthouse timeout policy is absent or differs from the pinned policy'];
}

export function lighthouseBrowserIdentityFindings(value) {
  const executable = value?.executable;
  const findings = [];
  if (
    !exactKeys(value, ['executable', 'provider', 'schema', 'version']) ||
    !exactKeys(executable, ['basename', 'bytes', 'pathSha256'])
  ) {
    findings.push('browser identity field census is not exact');
  }
  if (value?.schema !== LIGHTHOUSE_BROWSER_IDENTITY_SCHEMA) {
    findings.push('browser identity schema mismatch');
  }
  if (value?.provider !== 'playwright.chromium') {
    findings.push('browser identity provider is not Playwright Chromium');
  }
  if (!boundedLabel(value?.version, 128) || !/^\d+\.\d+\.\d+\.\d+$/u.test(value.version)) {
    findings.push('browser version is absent or malformed');
  }
  if (
    !boundedLabel(executable?.basename, 256) ||
    !Number.isSafeInteger(executable?.bytes) ||
    executable.bytes <= 0 ||
    !validSha256(executable?.pathSha256)
  ) {
    findings.push('browser executable identity is absent or malformed');
  }
  return findings;
}

export function lighthouseSampleFailureFindings(value) {
  const findings = [];
  if (!exactKeys(value, ['message', 'metric', 'sampleIndex', 'schema', 'scope'])) {
    findings.push('sample failure field census is not exact');
  }
  if (value?.schema !== LIGHTHOUSE_SAMPLE_FAILURE_SCHEMA) {
    findings.push('sample failure schema mismatch');
  }
  if (!['invocation', 'metric'].includes(value?.scope)) {
    findings.push('sample failure scope is invalid');
  }
  if (!Number.isSafeInteger(value?.sampleIndex) || value.sampleIndex < 0) {
    findings.push('sample failure index is invalid');
  }
  if (!boundedLabel(value?.message, 512)) {
    findings.push('sample failure message is absent or unbounded');
  }
  if (
    value?.scope === 'metric'
      ? !LIGHTHOUSE_METRIC_KEYS.includes(value?.metric)
      : value?.metric !== null
  ) {
    findings.push('sample failure metric attribution is invalid');
  }
  return findings;
}

function boundedLabel(value, maximum) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\r\n\0]/u.test(value)
  );
}

function validSha256(value) {
  return /^sha256:[0-9a-f]{64}$/u.test(value ?? '');
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}
