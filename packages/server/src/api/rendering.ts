// CSP-3 (bugs-part3): apps opt into the framework's own CSP by passing `document.csp`
// (the inline-script/style hashes surfaced by `renderRouteDocumentResponse` /
// `renderDeferredDocument`) to `renderContentSecurityPolicy` and setting the result as
// their `Content-Security-Policy` header. `cspSha256` lets apps hash any additional
// inline script/style they author so it can be admitted by the same policy.
export { trustedHtml, trustedUrl } from '@kovojs/browser';
export { cspSha256, renderContentSecurityPolicy } from '../csp.js';
export type { ContentSecurityPolicyOptions, CspInlineMetadata } from '../csp.js';
export { Defer } from '../deferred-region.js';
export type { DeferProps, RegionPriority, ServerRenderable } from '../deferred-region.js';
export {
  BodyAttrs,
  BodyEnd,
  BodyStart,
  Document,
  FontPreload,
  Head,
  HtmlAttrs,
  InlineScript,
  InlineStyle,
  Link,
  Meta,
  ModulePreload,
  Stylesheet,
} from '../document-structured.js';
export type {
  DocumentAuthoringContext,
  DocumentConfig,
  DocumentDeclaration,
  DocumentShellAttributes,
  DocumentShellAttributeValue,
} from '../document-structured.js';
export type {
  DeferredFragmentChunk,
  DeferredPriority,
  DeferredQueryChunk,
  DeferredStreamChunk,
} from '../deferred-stream.js';
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
export { safeRichHtml } from '../rendering/html/safe-html.js';
export type { SafeRichHtmlOptions } from '../rendering/html/safe-html.js';
// SPEC §4.10: render LLM/DB-authored rich text that embeds a closed, pre-approved set of
// components as well-formed XML. `parseComponentXml` is the trust boundary (untrusted string →
// plain AST); `renderRegistry` declares the closed set; `renderTree` renders it safely server-side.
export {
  ComponentXmlError,
  parseComponentXml,
  renderRegistry,
  renderTree,
} from '../render-tree.js';
export type {
  ComponentElementNode,
  ComponentNode,
  ComponentRegistry,
  ComponentRegistryEntry,
  ComponentRegistryInput,
  ComponentTextNode,
  RenderTreeOptions,
} from '../render-tree.js';
