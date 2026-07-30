import { gzipSync } from 'node:zlib';

export const browserDeferredAppRuntimeRawByteBudget = 520_000;
export const browserDeferredAppRuntimeGzipByteBudget = 150_000;
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
