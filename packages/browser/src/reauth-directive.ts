const FALLBACK_REAUTH_LOCATION = '/';

/**
 * SPEC §6.5: a `Kovo-Reauth` browser navigation target must remain a
 * same-origin, single-leading-slash path. Treat the response header as an
 * untrusted sink even though framework servers already sanitize it.
 *
 * @internal
 */
export function sanitizeReauthDirective(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (isSafeRootRelativePath(value) && isSafeRootRelativePath(decoded)) return value;
  } catch {}

  return FALLBACK_REAUTH_LOCATION;
}

function isSafeRootRelativePath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return false;
  return isSafeDecodedPath(value);
}

function isSafeDecodedPath(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || value[index] === '\\') return false;
  }
  return true;
}
