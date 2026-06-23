import { describe, expect, it } from 'vitest';

import {
  acceptsEnhancedNavigationDocument,
  enhancedNavigationDocumentAcceptHeader,
  enhancedNavigationDocumentMimeType,
} from './internal/document-protocol.js';

describe('document protocol', () => {
  it('defines the enhanced-navigation document accept header from the media type', () => {
    // SPEC.md §4.4: enhanced navigation negotiates a document variant that omits bootstrap bytes.
    expect(enhancedNavigationDocumentAcceptHeader).toBe(
      `${enhancedNavigationDocumentMimeType}, text/html`,
    );
  });

  it('matches enhanced-navigation document accept entries with parameters', () => {
    expect(acceptsEnhancedNavigationDocument(enhancedNavigationDocumentAcceptHeader)).toBe(true);
    expect(
      acceptsEnhancedNavigationDocument(`text/html, ${enhancedNavigationDocumentMimeType};q=0.9`),
    ).toBe(true);
    expect(acceptsEnhancedNavigationDocument('text/html')).toBe(false);
    expect(acceptsEnhancedNavigationDocument(null)).toBe(false);
  });
});
