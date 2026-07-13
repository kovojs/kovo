import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import {
  applySecurityIntrinsic,
  securityGetOwnPropertyDescriptor,
} from './security-witness-intrinsics.js';

const buildTokenSecurity =
  typeof document === 'undefined' ? undefined : createBrowserNavigationSecurityControls();

/**
 * Read the render-plan version token from the page's `<meta name="kovo-build">`.
 * Returns undefined in non-DOM environments (tests, SSR) or when the tag is absent
 * (SPEC §9.1.1).
 */
export function readPageBuildToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const meta =
    buildTokenSecurity === undefined
      ? structuralQueryBuildMeta(document)
      : buildTokenSecurity.queryOne(document, 'meta[name="kovo-build"]');
  if (!meta) return undefined;
  const content =
    buildTokenSecurity === undefined
      ? structuralReadBuildMeta(meta)
      : buildTokenSecurity.readAttribute(meta, 'content');
  return content ?? undefined;
}

function structuralQueryBuildMeta(root: object): object | null {
  const query = securityGetOwnPropertyDescriptor(root, 'querySelector');
  if (query === undefined || !('value' in query) || typeof query.value !== 'function') return null;
  const value = applySecurityIntrinsic<unknown>(query.value, root, ['meta[name="kovo-build"]']);
  return typeof value === 'object' && value !== null ? value : null;
}

function structuralReadBuildMeta(meta: object): string | null {
  const getAttribute = securityGetOwnPropertyDescriptor(meta, 'getAttribute');
  if (
    getAttribute === undefined ||
    !('value' in getAttribute) ||
    typeof getAttribute.value !== 'function'
  ) {
    return null;
  }
  const value = applySecurityIntrinsic<unknown>(getAttribute.value, meta, ['content']);
  return typeof value === 'string' ? value : null;
}
