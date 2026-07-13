import {
  securityStringStartsWith,
  securityStringToLowerCase,
} from './response-security-intrinsics.js';

/**
 * @internal Header authority retained when reconstructing a canonical document GET from a
 * framework control request. The control request's method/body/navigation headers describe the
 * mutation or HMR transport, not the source document (SPEC.md §§6.6, 9.4, 9.5.1).
 */
export function sourceDocumentHeaderIsRetained(name: string): boolean {
  const normalized = securityStringToLowerCase(name);
  if (
    normalized[0] === ':' ||
    securityStringStartsWith(normalized, 'content-') ||
    securityStringStartsWith(normalized, 'kovo-') ||
    securityStringStartsWith(normalized, 'sec-fetch-')
  ) {
    return false;
  }
  return !(
    normalized === 'accept' ||
    normalized === 'connection' ||
    normalized === 'csrf-token' ||
    normalized === 'host' ||
    normalized === 'idempotency-key' ||
    normalized === 'origin' ||
    normalized === 'referer' ||
    normalized === 'te' ||
    normalized === 'trailer' ||
    normalized === 'transfer-encoding' ||
    normalized === 'upgrade' ||
    normalized === 'x-csrf-token' ||
    normalized === 'x-http-method-override' ||
    normalized === 'x-method-override' ||
    normalized === 'x-requested-with'
  );
}
