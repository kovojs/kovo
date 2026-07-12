import type { IncomingMessage } from 'node:http';

import {
  requestCreateUrl,
  requestIsRequest,
  requestUrl,
  requestUrlSnapshot,
} from './request-body-intrinsics.js';

/**
 * Trusted transport scheme provenance for framework security decisions.
 *
 * The Node adapter folds trusted-proxy configuration into `Request.url` before
 * app dispatch. Downstream sinks must not reread spoofable forwarding headers;
 * a direct deployment with `x-forwarded-proto: https` still has an `http:`
 * request URL and therefore remains insecure for HSTS/cookie floors.
 *
 * @internal
 */
export type TrustedRequestScheme = 'http' | 'https';

/** @internal */
export function trustedRequestScheme(request: Request): TrustedRequestScheme {
  return requestUrlSnapshot(requestCreateUrl(requestUrl(request))).protocol === 'https:'
    ? 'https'
    : 'http';
}

/** @internal */
export function isTrustedSecureRequest(request: unknown): boolean {
  return requestIsRequest(request) && trustedRequestScheme(request) === 'https';
}

/** @internal */
export function trustedNodeRequestScheme(
  request: IncomingMessage,
  options: { trustedProxy?: boolean } = {},
): TrustedRequestScheme {
  const pseudoHeaders = request.headers as Record<string, string | string[] | undefined>;
  const forwardedProto = options.trustedProxy
    ? firstHeaderValue(request.headers['x-forwarded-proto'])
    : undefined;
  const scheme =
    forwardedProto ??
    firstHeaderValue(pseudoHeaders[':scheme']) ??
    ((request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  return scheme === 'https' ? 'https' : 'http';
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
