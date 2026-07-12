import { mergeVaryHeader } from './document-core.js';
import { wireEmitter } from '@kovojs/core/internal/security-markers';
import { blessRedirectResponse, cloneResponseHeaders, readHeader } from './response.js';
import type { ResponseHeaders, ResponseHeaderValue, WebResponseBody } from './response.js';
import { finalizeServerResponse } from './response-posture.js';
import {
  createSecurityHeaders,
  createSecurityNullRecord,
  securityArrayIsArray,
  securityHeadersForEach,
  securityIsHeaders,
  securityIsMap,
  securityNumberIsInteger,
  securityObjectKeys,
  securityStringToLowerCase,
} from './response-security-intrinsics.js';
import { witnessGetOwnPropertyDescriptor, witnessObjectIs } from './security-witness-intrinsics.js';

export type AppSystemResponseSurface = 'mutation' | 'query' | 'other';

interface AppSystemResponseInit {
  buildToken?: string | undefined;
  headers?: HeadersInit | ResponseHeaders | undefined;
  method?: string | undefined;
  status: number;
  surface: AppSystemResponseSurface;
}

/**
 * Framework-owned pre-dispatch/system responses for reserved mutation/query
 * endpoints inherit the same private cache posture as dispatched `/_m`/`/_q`
 * responses (SPEC.md §9.1.1 and §9.4).
 *
 * @internal
 */
export const appSystemResponse = wireEmitter(
  'server.wire.system-response',
  function (body: WebResponseBody | null, init: AppSystemResponseInit): Response {
    const status = stableSystemInitValue(init, 'status');
    const surface = stableSystemInitValue(init, 'surface');
    const method = stableSystemInitValue(init, 'method');
    const buildToken = stableSystemInitValue(init, 'buildToken');
    const initialHeaders = stableSystemInitValue(init, 'headers');
    if (typeof status !== 'number' || !securityNumberIsInteger(status)) {
      throw new TypeError('Kovo system response status must be an integer.');
    }
    if (surface !== 'mutation' && surface !== 'query' && surface !== 'other') {
      throw new TypeError('Kovo system response surface is invalid.');
    }
    if (method !== undefined && typeof method !== 'string') {
      throw new TypeError('Kovo system response method must be a string.');
    }
    if (buildToken !== undefined && typeof buildToken !== 'string') {
      throw new TypeError('Kovo system response build token must be a string.');
    }
    const response = {
      body,
      headers: appSystemResponseHeaders(initialHeaders, {
        buildToken,
        hasBody: body !== null,
        surface,
      }),
      status,
    };
    if (
      response.status >= 300 &&
      response.status < 400 &&
      readHeader(response.headers, 'Location')
    ) {
      blessRedirectResponse(response);
    }
    return finalizeServerResponse(response, { method: method ?? 'GET' });
  },
);

function appSystemResponseHeaders(
  initHeaders: unknown,
  options: {
    buildToken?: string | undefined;
    hasBody: boolean;
    surface: AppSystemResponseSurface;
  },
): ResponseHeaders {
  let headers = headersInitToRecord(initHeaders);

  if (options.surface === 'mutation' || options.surface === 'query') {
    setHeader(headers, 'Cache-Control', 'private, no-store');
    headers = mergeVaryHeader(headers, 'Cookie');
    if (options.buildToken) setHeader(headers, 'Kovo-Build', options.buildToken);
  }

  if (options.hasBody && readHeader(headers, 'Content-Type') !== undefined) {
    setHeader(headers, 'X-Content-Type-Options', 'nosniff');
  }

  return headers;
}

function headersInitToRecord(initHeaders: unknown): ResponseHeaders {
  if (isHeaderRecord(initHeaders)) return cloneResponseHeaders(initHeaders);

  if (
    initHeaders !== undefined &&
    !securityIsHeaders(initHeaders) &&
    !securityIsMap(initHeaders) &&
    !securityArrayIsArray(initHeaders)
  ) {
    throw new TypeError('Kovo system response headers must be a header record or HeadersInit.');
  }
  const headers = createSecurityHeaders(initHeaders);
  const record: ResponseHeaders = createSecurityNullRecord<ResponseHeaderValue>();
  securityHeadersForEach(headers, (value, name) => {
    record[name] = value;
  });
  return record;
}

function isHeaderRecord(value: unknown): value is ResponseHeaders {
  return (
    typeof value === 'object' &&
    value !== null &&
    !securityIsHeaders(value) &&
    !securityIsMap(value) &&
    !securityArrayIsArray(value)
  );
}

function setHeader(headers: ResponseHeaders, name: string, value: ResponseHeaderValue): void {
  const existingName = headerName(headers, name);
  if (existingName !== undefined && existingName !== name) delete headers[existingName];
  headers[name] = value;
}

function headerName(headers: ResponseHeaders, name: string): string | undefined {
  const normalized = securityStringToLowerCase(name);
  const names = securityObjectKeys(headers);
  for (let index = 0; index < names.length; index += 1) {
    const candidate = names[index]!;
    if (securityStringToLowerCase(candidate) === normalized) return candidate;
  }
  return undefined;
}

function stableSystemInitValue(init: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(init, property);
  const after = witnessGetOwnPropertyDescriptor(init, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`Kovo system response ${String(property)} must be stable.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || after === undefined || !('value' in after)) {
    throw new TypeError(`Kovo system response ${String(property)} must be an own data property.`);
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`Kovo system response ${String(property)} changed during validation.`);
  }
  return before.value;
}
