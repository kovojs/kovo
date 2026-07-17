import type { IncomingMessage } from 'node:http';

import {
  requestCreateUrl,
  requestIsRequest,
  requestUrl,
  requestUrlSnapshot,
} from './request-body-intrinsics.js';
import {
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

const nativeStringLastIndexOf = String.prototype.lastIndexOf;
const nativeStringSlice = String.prototype.slice;
const nativeStringTrim = String.prototype.trim;

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
  // SPEC §9.5: use only the closest trusted proxy's rightmost list member. Invalid/empty terminal
  // values reject instead of falling through to peer-controlled pseudo-header or socket posture.
  const forwardedProto = options.trustedProxy
    ? rightmostHeaderListValue(request.headers['x-forwarded-proto'])
    : undefined;
  // SPEC §9.5 / RFC 9113 §8.3.1: `:scheme` is peer-supplied request-target control data, not
  // proof that this hop is encrypted. Treat it like other proxy-carried scheme metadata and
  // accept it only when the operator explicitly opts into trusted-proxy posture.
  const pseudoScheme = options.trustedProxy
    ? firstHeaderValue(pseudoHeaders[':scheme'])
    : undefined;
  const scheme =
    forwardedProto ??
    pseudoScheme ??
    ((request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  return scheme === 'https' ? 'https' : 'http';
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!witnessIsArray(value)) return value;
  const first = witnessGetOwnPropertyDescriptor(value, 0);
  if (first === undefined) return undefined;
  if (!('value' in first) || typeof first.value !== 'string') {
    throw new TypeError('Trusted request scheme headers must contain stable own strings.');
  }
  return first.value;
}

function rightmostHeaderListValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  let list = value;
  if (witnessIsArray(value)) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, value.length - 1);
    if (
      value.length === 0 ||
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError('Trusted request scheme headers must end in an own string.');
    }
    list = descriptor.value;
  }
  const comma = witnessReflectApply<number>(nativeStringLastIndexOf, list, [',']);
  const candidate = witnessReflectApply<string>(nativeStringSlice, list, [comma + 1]);
  const scheme = witnessReflectApply<string>(nativeStringTrim, candidate, []);
  if (scheme !== 'http' && scheme !== 'https') {
    throw new TypeError('Trusted request scheme headers must end in http or https.');
  }
  return scheme;
}
