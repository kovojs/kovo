import { witnessFreeze } from './security-witness-intrinsics.js';

/**
 * @internal Static host header policy manifest for build and export emitters (SPEC §6.6/§14).
 */
export const staticHostHeaderPolicy = witnessFreeze({
  clientModule: witnessFreeze({
    'cache-control': 'public, max-age=31536000, immutable',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  }),
  document: witnessFreeze({
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  }),
  errorDocument: witnessFreeze({
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  }),
  immutableAsset: witnessFreeze({
    'cache-control': 'public, max-age=31536000, immutable',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  }),
  revalidatingAsset: witnessFreeze({
    'cache-control': 'public, max-age=0, must-revalidate',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  }),
} satisfies Record<string, Readonly<Record<string, string>>>);

export type StaticHostHeaderPolicyKind = keyof typeof staticHostHeaderPolicy;

export const staticHostImmutableAssetPathPatternSource =
  '^/assets/(?:.*/)?[^/]*-[a-f0-9]{8,}(?:\\.[^/.]+)+$';
export const staticHostImmutableAssetPathPatternFlags = 'i';
export const staticHostImmutableAssetPathPattern = new RegExp(
  staticHostImmutableAssetPathPatternSource,
  staticHostImmutableAssetPathPatternFlags,
);

/**
 * @internal Return a mutable header bag so platform formatters can add transport-local headers.
 */
export function staticHostHeaders(kind: StaticHostHeaderPolicyKind): Record<string, string> {
  return { ...staticHostHeaderPolicy[kind] };
}
