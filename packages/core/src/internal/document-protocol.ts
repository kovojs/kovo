/** @internal */
export const enhancedNavigationDocumentMimeType = 'text/vnd.kovo.document+html';

/** @internal */
export const enhancedNavigationDocumentAcceptHeader = `${enhancedNavigationDocumentMimeType}, text/html`;

/** @internal */
export function acceptsEnhancedNavigationDocument(accept: string | null | undefined): boolean {
  return (
    accept
      ?.split(',')
      .some(
        (entry) => entry.trim().split(';', 1)[0] === enhancedNavigationDocumentMimeType,
      ) === true
  );
}
