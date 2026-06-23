export const enhancedNavigationDocumentMimeType = 'text/vnd.kovo.document+html';
export const enhancedNavigationDocumentAcceptHeader = `${enhancedNavigationDocumentMimeType}, text/html`;

export function acceptsEnhancedNavigationDocument(accept: string | null | undefined): boolean {
  return (
    accept
      ?.split(',')
      .some(
        (entry) => entry.trim().split(';', 1)[0] === enhancedNavigationDocumentMimeType,
      ) === true
  );
}
