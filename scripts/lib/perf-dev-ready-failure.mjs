export const DEV_READY_PROFILER_CAPTURE_SUBSTAGES = Object.freeze([
  'none',
  'inspector-profiler-stop',
  'inspector-take-precise-coverage',
  'inspector-stop-precise-coverage',
  'cpu-validation',
  'coverage-validation',
  'exact-call-evidence',
  'attribution-capture',
  'cpu-serialization',
  'coverage-serialization',
  'artifact-write',
  'session-close',
  'unknown',
]);

const DEV_READY_PROFILER_CAPTURE_SUBSTAGE_SET = new Set(
  DEV_READY_PROFILER_CAPTURE_SUBSTAGES,
);
const DEV_READY_PROFILER_CAPTURE_FAILURES = new WeakMap();

export function normalizedDevReadyProfilerCaptureSubstage(substage) {
  return DEV_READY_PROFILER_CAPTURE_SUBSTAGE_SET.has(substage) ? substage : 'unknown';
}

export function createDevReadyProfilerCaptureFailure(substage, cause) {
  const failure = Object.freeze({});
  DEV_READY_PROFILER_CAPTURE_FAILURES.set(
    failure,
    Object.freeze({
      cause,
      substage: normalizedDevReadyProfilerCaptureSubstage(substage),
    }),
  );
  return failure;
}

export function devReadyProfilerCaptureFailure(error, fallbackSubstage = 'unknown') {
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
    const failure = DEV_READY_PROFILER_CAPTURE_FAILURES.get(error);
    if (failure !== undefined) return failure;
  }
  return Object.freeze({
    cause: error,
    substage: normalizedDevReadyProfilerCaptureSubstage(fallbackSubstage),
  });
}
