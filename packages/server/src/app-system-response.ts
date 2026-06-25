import { mergeVaryHeader } from './document-core.js';
import type { ResponseHeaders, ResponseHeaderValue } from './response.js';

export type AppSystemResponseSurface = 'mutation' | 'query' | 'other';

interface AppSystemResponseInit {
  buildToken?: string | undefined;
  headers?: HeadersInit | undefined;
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
  return new Response(body, {
    headers: appSystemResponseHeaders(init.headers, {
      buildToken: init.buildToken,
      hasBody: body !== null,
      surface: init.surface,
    }),
    status: init.status,
  });
}

function appSystemResponseHeaders(
  initHeaders: HeadersInit | undefined,
  options: {
    buildToken?: string | undefined;
    hasBody: boolean;
    surface: AppSystemResponseSurface;
  },
): Headers {
  let headers = headersInitToRecord(initHeaders);

  if (options.surface === 'mutation' || options.surface === 'query') {
    setHeader(headers, 'Cache-Control', 'private, no-store');
    headers = mergeVaryHeader(headers, 'Cookie');
    if (options.buildToken) setHeader(headers, 'Kovo-Build', options.buildToken);
  }

  if (options.hasBody && readHeader(headers, 'Content-Type') !== undefined) {
    setHeader(headers, 'X-Content-Type-Options', 'nosniff');
  }

  return recordToHeaders(headers);
}

function headersInitToRecord(initHeaders: HeadersInit | undefined): ResponseHeaders {
  const headers = new Headers(initHeaders);
  const record: ResponseHeaders = {};
  headers.forEach((value, name) => {
    record[name] = value;
  });
  return record;
}

function recordToHeaders(headers: ResponseHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) result.append(name, entry);
    } else {
      result.set(name, value);
    }
  }
  return result;
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
