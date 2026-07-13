/** @internal */
export const enhancedNavigationDocumentMimeType = 'text/vnd.kovo.document+html';

/** @internal */
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
