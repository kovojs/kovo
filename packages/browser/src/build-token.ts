import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

const buildTokenSecurity = createBrowserNavigationSecurityControls();

/**
 * Read the render-plan version token from the page's `<meta name="kovo-build">`.
 * Returns undefined in non-DOM environments (tests, SSR) or when the tag is absent
 * (SPEC §9.1.1).
 */
export function readPageBuildToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const meta = buildTokenSecurity.queryOne(document, 'meta[name="kovo-build"]');
  if (!meta) return undefined;
  const content = buildTokenSecurity.readAttribute(meta, 'content');
  return content ?? undefined;
}
