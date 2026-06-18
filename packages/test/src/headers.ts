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

/** Options for {@link enhancedMutationHeaders}; targets follow the mutation wire protocol in SPEC.md §9.1. */
export interface EnhancedMutationHeaderOptions {
  formTarget?: string;
  liveTargets?: readonly string[] | string;
  targets?: readonly string[] | string;
}

/** Build the enhanced-mutation request headers used by app scenario tests (SPEC.md §9.1). */
export function enhancedMutationHeaders(
  options: EnhancedMutationHeaderOptions = {},
): Record<string, string> {
  return {
    'Kovo-Fragment': 'true',
    ...(options.formTarget === undefined ? {} : { 'Kovo-Form-Target': options.formTarget }),
    'Kovo-Live-Targets': headerList(options.liveTargets),
    'Kovo-Targets': headerList(options.targets),
  };
}

function isHeaders(source: HeaderSource): source is Headers {
  return typeof (source as Headers | undefined)?.get === 'function';
}

function headerList(value: readonly string[] | string | undefined): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : value.join('; ');
}
