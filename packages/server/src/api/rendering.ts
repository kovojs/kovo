// CSP-3 (bugs-part3): apps opt into the framework's own CSP by passing `document.csp`
// (the inline-script/style hashes surfaced by `renderRouteDocumentResponse` /
// `renderDeferredDocument`) to `renderContentSecurityPolicy` and setting the result as
// their `Content-Security-Policy` header. `cspSha256` lets apps hash any additional
// inline script/style they author so it can be admitted by the same policy.
export { cspSha256, renderContentSecurityPolicy } from '../csp.js';
export type { ContentSecurityPolicyOptions, CspInlineMetadata } from '../csp.js';
export type { DocumentParts, DocumentTemplate, DocumentTemplateContext } from '../document-core.js';
export { stylesheet } from '../hints.js';
export type {
  I18nCatalog,
  PageHintOptions,
  RouteMeta,
  RouteMetaFactory,
  RouteMetaSource,
  RoutePrefetch,
  StylesheetAsset,
  StylesheetDeclarationOptions,
  StylesheetTheme,
} from '../hints.js';
export { i18n, meta, metaFromQuery, t } from '../meta.js';
