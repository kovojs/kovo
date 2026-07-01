import { hasUnsafeUrlScheme } from '@kovojs/core/internal/sink-policy';

export {
  hasUnsafeUrlScheme,
  isUrlAttributeName,
  SAFE_URL_SCHEMES,
  URL_ATTRIBUTE_NAMES,
} from '@kovojs/core/internal/sink-policy';

// eslint-disable-next-line no-control-regex
const urlBlankPattern = /[\u0000-\u0020\u007f-\u009f]+/g;

/**
 * @internal Render-safe URL sink adapter shared by framework UI packages.
 *
 * SPEC.md §4.8 keeps the URL scheme policy in `sink-policy.ts`; this adapter owns
 * the UI/headless fallback shape so the sink-policy module does not expose a
 * generic trust/bless-style render escape hatch.
 */
export function safeUrl(value: string | null | undefined, fallback = '#'): string {
  if (value === undefined || value === null) return fallback;
  if (value.replace(urlBlankPattern, '') === '') return fallback;
  return hasUnsafeUrlScheme(value) ? fallback : value;
}
