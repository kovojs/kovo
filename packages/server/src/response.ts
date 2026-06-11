export type ResponseHeaderValue = string | string[];

export type ResponseHeaders = Record<string, ResponseHeaderValue>;

export interface ServerResponseBase<
  Body,
  Headers extends ResponseHeaders = ResponseHeaders,
  Status extends number = number,
> {
  body: Body;
  headers: Headers;
  status: Status;
}

export type HeaderSource =
  | Iterable<readonly [string, string]>
  | Record<string, readonly string[] | string | undefined>
  | {
      get(name: string): null | string;
    };

export function isHeaderSource(value: unknown): value is HeaderSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('get' in value || Symbol.iterator in value || Object.keys(value).length > 0)
  );
}

export function readHeader(headers: HeaderSource, name: string): string | undefined {
  if ('get' in headers && typeof headers.get === 'function') {
    return headers.get(name) ?? undefined;
  }

  const existingName = findHeaderName(headers, name);
  if (existingName === undefined || Symbol.iterator in headers) return existingName;

  const recordHeaders = headers as Record<string, readonly string[] | string | undefined>;
  const value = recordHeaders[existingName];
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : undefined;
}

export function appendResponseHeader(
  headers: ResponseHeaders,
  name: string,
  value: ResponseHeaderValue,
): void {
  const existingName = findHeaderName(headers, name);
  const targetName = existingName ?? name;
  if (name.toLowerCase() !== 'set-cookie') {
    headers[targetName] = Array.isArray(value) ? [...value] : value;
    return;
  }

  const nextValues = Array.isArray(value) ? value : [value];
  const existing = existingName === undefined ? undefined : headers[existingName];
  if (existing === undefined) {
    headers[targetName] = [...nextValues];
    return;
  }

  headers[targetName] = [...(Array.isArray(existing) ? existing : [existing]), ...nextValues];
}

export function cloneResponseHeaders<Headers extends ResponseHeaders>(headers: Headers): Headers {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : value,
    ]),
  ) as Headers;
}

function findHeaderName(headers: HeaderSource, name: string): string | undefined {
  const wanted = name.toLowerCase();
  if (Symbol.iterator in headers) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === wanted) return value;
    }

    return undefined;
  }

  return Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
}
