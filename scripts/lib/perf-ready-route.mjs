/** Exact additive evidence emitted after the generated corpus root route answers successfully. */
export function validReadyRouteProbe(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'attempts,path,status,transientFailures' &&
    Number.isSafeInteger(value.attempts) &&
    value.attempts >= 1 &&
    Number.isSafeInteger(value.transientFailures) &&
    value.transientFailures === value.attempts - 1 &&
    Number.isSafeInteger(value.status) &&
    value.status >= 200 &&
    value.status < 300 &&
    value.path === '/'
  );
}
