export type HeaderRecord = Record<string, string | string[] | undefined>;
export type HeaderSource = Headers | HeaderRecord | undefined;

export function headerValues(source: HeaderSource, name: string): string[] {
  if (!source) return [];

  if (isHeaders(source)) {
    const normalizedName = name.toLowerCase();
    const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    if (normalizedName === 'set-cookie' && getSetCookie) return getSetCookie.call(source);

    const value = source.get(name);
    return value ? [value] : [];
  }

  const normalizedName = name.toLowerCase();
  const entry = Object.entries(source).find(([key]) => key.toLowerCase() === normalizedName);
  const value = entry?.[1];
  if (!value) return [];

  return Array.isArray(value) ? value : [value];
}

export function setCookieValues(source: HeaderSource): string[] {
  return headerValues(source, 'set-cookie');
}

export function cookiePair(setCookie: string | undefined): string {
  return setCookie?.split(';', 1)[0] ?? '';
}

export function firstSetCookiePair(source: HeaderSource): string {
  return cookiePair(setCookieValues(source)[0]);
}

function isHeaders(source: HeaderSource): source is Headers {
  return typeof (source as Headers | undefined)?.get === 'function';
}
