import { mergeVaryHeader } from './document-core.js';
import {
  blessRedirectResponse,
  isBlessedRedirectResponse,
  redirectLocationHeaderValue,
} from './response.js';
import type { ResponseHeaders, ResponseHeaderValue } from './response.js';

export type AppSystemResponseSurface = 'mutation' | 'query' | 'other';

interface AppSystemResponseInit {
  buildToken?: string | undefined;
  headers?: HeadersInit | ResponseHeaders | undefined;
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
export function appSystemResponse(body: BodyInit | null, init: AppSystemResponseInit): Response {
  const response = {
    body,
    headers: appSystemResponseHeaders(init.headers, {
      buildToken: init.buildToken,
      hasBody: body !== null,
      surface: init.surface,
    }),
    status: init.status,
  };
  if (response.status >= 300 && response.status < 400 && readHeader(response.headers, 'Location')) {
    blessRedirectResponse(response);
  }
  return new Response(body, {
    headers: recordToHeaders(
      response.headers,
      response.status,
      isBlessedRedirectResponse(response),
    ),
    status: init.status,
  });
}

function appSystemResponseHeaders(
  initHeaders: HeadersInit | ResponseHeaders | undefined,
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

function headersInitToRecord(
  initHeaders: HeadersInit | ResponseHeaders | undefined,
): ResponseHeaders {
  if (isHeaderRecord(initHeaders)) return { ...initHeaders };

  const headers = new Headers(initHeaders);
  const record: ResponseHeaders = {};
  headers.forEach((value, name) => {
    record[name] = value;
  });
  return record;
}

function recordToHeaders(
  headers: ResponseHeaders,
  status: number,
  blessedRedirect: boolean,
): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (status >= 300 && status < 400 && name.toLowerCase() === 'location') {
      result.set(name, redirectLocationHeaderValue(value, blessedRedirect));
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) result.append(name, entry);
    } else {
      result.set(name, value);
    }
  }
  return result;
}

function isHeaderRecord(
  value: HeadersInit | ResponseHeaders | undefined,
): value is ResponseHeaders {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Headers) &&
    !Array.isArray(value) &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function'
  );
}

function setHeader(headers: ResponseHeaders, name: string, value: ResponseHeaderValue): void {
  const existingName = headerName(headers, name);
  if (existingName !== undefined && existingName !== name) delete headers[existingName];
  headers[name] = value;
}

function readHeader(headers: ResponseHeaders, name: string): ResponseHeaderValue | undefined {
  const existingName = headerName(headers, name);
  return existingName === undefined ? undefined : headers[existingName];
}

function headerName(headers: ResponseHeaders, name: string): string | undefined {
  const normalized = name.toLowerCase();
  return Object.keys(headers).find((candidate) => candidate.toLowerCase() === normalized);
}
