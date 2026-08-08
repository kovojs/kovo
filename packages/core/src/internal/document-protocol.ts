/**
 * SPEC §8 (spec/07-navigation.md): the enhanced-navigation document variant is the structured
 * `kovo-document-parts/v1` JSON encoding of the full target document — never an HTML string the
 * client would have to re-parse through a string→DOM sink (plans/good-perf.md D2).
 *
 * @internal
 */
export const enhancedNavigationDocumentMimeType = 'application/vnd.kovo.document-parts+json';

/**
 * SPEC §8: the `text/html` fallback entry keeps the negotiation honest — a server that cannot
 * encode a particular document as parts answers with the canonical HTML document, which the
 * client never parses; it performs the normal full GET instead.
 *
 * @internal
 */
export const enhancedNavigationDocumentAcceptHeader = `${enhancedNavigationDocumentMimeType}, text/html`;

/** @internal */
export function acceptsEnhancedNavigationDocument(accept: string | null | undefined): boolean {
  if (accept === null || accept === undefined) return false;
  const entries = securityStringSplit(accept, ',');
  for (let index = 0; index < entries.length; index += 1) {
    const mediaType = securityStringSplit(securityStringTrim(entries[index]!), ';')[0];
    if (mediaType === enhancedNavigationDocumentMimeType) return true;
  }
  return false;
}
import { securityStringSplit, securityStringTrim } from './security-witness-intrinsics.ts';
