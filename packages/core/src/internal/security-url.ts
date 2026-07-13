import { hasUnsafeUrlScheme } from '@kovojs/core/internal/sink-policy';
import { securityStringCharCodeAt } from '#security-witness-intrinsics';

export {
  hasUnsafeUrlScheme,
  isUrlAttributeName,
  SAFE_URL_SCHEMES,
  URL_ATTRIBUTE_NAMES,
} from '@kovojs/core/internal/sink-policy';

/**
 * @internal Render-safe URL sink adapter shared by framework UI packages.
 *
 * SPEC.md §4.8 keeps the URL scheme policy in `sink-policy.ts`; this adapter owns
 * the UI/headless fallback shape so the sink-policy module does not expose a
 * generic trust/bless-style render escape hatch.
 */
export function safeUrl(value: string | null | undefined, fallback = '#'): string {
  if (typeof value !== 'string') return fallback;
  if (!hasVisibleUrlCharacter(value)) return fallback;
  return hasUnsafeUrlScheme(value) ? fallback : value;
}

function hasVisibleUrlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code > 0x20 && (code < 0x7f || code > 0x9f)) return true;
  }
  return false;
}
