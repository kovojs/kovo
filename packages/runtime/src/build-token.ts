/**
 * Read the render-plan version token from the page's `<meta name="kovo-build">`.
 * Returns undefined in non-DOM environments (tests, SSR) or when the tag is absent
 * (SPEC §9.1.1).
 * @internal
 */
export function readPageBuildToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const meta = document.querySelector('meta[name="kovo-build"]');
  if (!meta) return undefined;
  const content = meta.getAttribute('content');
  return content ?? undefined;
}
