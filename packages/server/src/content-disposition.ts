/**
 * Boot-pinned string operations used by the shared Content-Disposition serializer.
 *
 * The serializer factory is intentionally self-contained: `build.ts` embeds this exact reviewed
 * function into the generated Node static server, while `response.ts` supplies its captured
 * response-security intrinsics. Keeping one algorithm prevents the emitted artifact from drifting
 * away from the authored runtime at the header sink (SPEC §6.6/§9.1).
 *
 * @internal
 */
export interface ContentDispositionStringOperations {
  charCodeAt(value: string, index: number): number;
  encodeURIComponent(value: string): string;
  slice(value: string, start: number, end?: number): string;
  trim(value: string): string;
}

/** @internal Create the runtime/generated Content-Disposition filename serializer. */
export function createContentDispositionWithFilename(
  operations: ContentDispositionStringOperations,
): (disposition: 'attachment' | 'inline', filename: string) => string {
  const charCodeAt = operations.charCodeAt;
  const encodeURIComponentValue = operations.encodeURIComponent;
  const slice = operations.slice;
  const trim = operations.trim;

  return function contentDispositionWithFilename(
    disposition: 'attachment' | 'inline',
    filename: string,
  ): string {
    let normalized = '';
    let normalizedInputLength = 0;
    let previousWasSeparator = false;
    // Preserve the authored-runtime limit before separator collapsing. Tracking the intermediate
    // UTF-16 length separately keeps long slash runs bounded without changing the 255-unit edge.
    for (let index = 0; index < filename.length && normalizedInputLength < 255; index += 1) {
      const code = charCodeAt(filename, index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = index + 1 < filename.length ? charCodeAt(filename, index + 1) : undefined;
        if (next !== undefined && next >= 0xdc00 && next <= 0xdfff) {
          if (normalizedInputLength + 2 > 255) break;
          normalized += slice(filename, index, index + 2);
          normalizedInputLength += 2;
          index += 1;
        } else {
          normalized += '\ufffd';
          normalizedInputLength += 1;
        }
        previousWasSeparator = false;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        normalized += '\ufffd';
        normalizedInputLength += 1;
        previousWasSeparator = false;
        continue;
      }
      if (code === 0x2f || code === 0x5c) {
        if (!previousWasSeparator) normalized += '_';
        normalizedInputLength += 1;
        previousWasSeparator = true;
        continue;
      }
      previousWasSeparator = false;
      normalized += code <= 0x1f || code === 0x7f ? '_' : slice(filename, index, index + 1);
      normalizedInputLength += 1;
    }
    normalized = trim(normalized);
    if (normalized.length === 0) normalized = 'download';

    let asciiFallback = '';
    for (let index = 0; index < normalized.length; index += 1) {
      const code = charCodeAt(normalized, index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = index + 1 < normalized.length ? charCodeAt(normalized, index + 1) : undefined;
        if (next !== undefined && next >= 0xdc00 && next <= 0xdfff) index += 1;
        asciiFallback += '_';
        continue;
      }
      asciiFallback += code >= 0x20 && code <= 0x7e ? slice(normalized, index, index + 1) : '_';
    }
    if (asciiFallback.length === 0) asciiFallback = 'download';

    let escapedFallback = '';
    for (let index = 0; index < asciiFallback.length; index += 1) {
      const code = charCodeAt(asciiFallback, index);
      if (code === 0x22) escapedFallback += '\\"';
      else if (code === 0x5c) escapedFallback += '\\\\';
      else escapedFallback += slice(asciiFallback, index, index + 1);
    }
    const fallbackParameter = `${disposition}; filename="${escapedFallback}"`;
    if (asciiFallback === normalized) return fallbackParameter;

    // RFC 5987 / RFC 8187: retain normalized UTF-8 in filename*. encodeURIComponent leaves
    // ['()*] unescaped even though they are not attr-char, so close those residues explicitly.
    const encoded = encodeURIComponentValue(normalized);
    let extended = '';
    for (let index = 0; index < encoded.length; index += 1) {
      const code = charCodeAt(encoded, index);
      if (code === 0x27) extended += '%27';
      else if (code === 0x28) extended += '%28';
      else if (code === 0x29) extended += '%29';
      else if (code === 0x2a) extended += '%2A';
      else extended += slice(encoded, index, index + 1);
    }
    return `${fallbackParameter}; filename*=UTF-8''${extended}`;
  };
}
