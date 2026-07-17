import { betterAuthUrlProtocol } from './intrinsics.js';

/**
 * Pin Better Auth's fixed binding to browser-enforced host-only credential cookies on HTTPS.
 *
 * Better Auth's `useSecureCookies` switch couples `Secure` to the weaker `__Secure-` name prefix.
 * A sibling subdomain can plant that name with `Domain=.example.com`; when it predates the app's
 * host cookie, the browser sends it first and Better Auth authenticates the attacker session. Keep
 * the upstream prefix switch off and state the HTTPS attributes explicitly so the dependency mints
 * the exact `__Host-…` name that it also reads (SPEC §6.5/§6.6).
 */
export function betterAuthFixedCookieSecurity(baseURL: string) {
  if (betterAuthUrlProtocol(baseURL) !== 'https:') {
    return { useSecureCookies: false } as const;
  }

  return {
    cookiePrefix: '__Host-better-auth',
    defaultCookieAttributes: {
      httpOnly: true,
      path: '/',
      sameSite: 'lax' as const,
      secure: true,
    },
    // Better Auth otherwise prepends `__Secure-` to the configured prefix. Secure transport is
    // still mandatory above; this disables only that dependency-owned name transformation.
    useSecureCookies: false,
  } as const;
}
