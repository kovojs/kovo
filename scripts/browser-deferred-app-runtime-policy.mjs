import { gzipSync } from 'node:zlib';

// 2026-08-08 (plans/good-perf.md O2/D2): +10 KB for the kovo-document-parts/v1 construction
// machinery (structured document build replacing the DOMParser string→DOM sink), which lands
// twice in this versioned/cacheable artifact — once in the modular runtime and once inside the
// embedded installer string. The SPEC §4.4 always-loaded bootstrap budget is unchanged and the
// generated bootstrap SHRANK (22,819 → 22,699 identity bytes) because script replay was removed.
export const browserDeferredAppRuntimeRawByteBudget = 530_000;
// 2026-08-08 (plans/good-perf.md O2/D2): +3 KB gzip alongside the raw-budget note above.
export const browserDeferredAppRuntimeGzipByteBudget = 153_000;
export const browserDeferredAppRuntimeForbiddenFragments = Object.freeze([
  'createInlineKovoLoaderSource',
  'derive input names must be non-empty strings',
  'generatedDerive',
  'inlineKovoLoaderBootstrapInstallerSource',
  'inlineKovoLoaderInstallerSource',
  'installInlineKovoBootstrap',
  'kovoLoaderSource',
]);

export function assertBrowserDeferredAppRuntimePolicy(source) {
  if (typeof source !== 'string' || source.length === 0) {
    throw new TypeError('Browser deferred app runtime must be non-empty JavaScript source.');
  }

  const rawBytes = Buffer.byteLength(source, 'utf8');
  const gzipBytes = gzipSync(source, { level: 9, mtime: 0 }).byteLength;
  if (rawBytes > browserDeferredAppRuntimeRawByteBudget) {
    throw new Error(
      `Browser deferred app runtime exceeds its raw budget: ${rawBytes} bytes > ${browserDeferredAppRuntimeRawByteBudget} bytes.`,
    );
  }
  if (gzipBytes > browserDeferredAppRuntimeGzipByteBudget) {
    throw new Error(
      `Browser deferred app runtime exceeds its gzip budget: ${gzipBytes} bytes > ${browserDeferredAppRuntimeGzipByteBudget} bytes.`,
    );
  }

  for (const fragment of browserDeferredAppRuntimeForbiddenFragments) {
    if (source.includes(fragment)) {
      throw new Error(
        `Browser deferred app runtime retained build/source-only fragment ${JSON.stringify(fragment)}.`,
      );
    }
  }

  return Object.freeze({ gzipBytes, rawBytes });
}
