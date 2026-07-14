export { trustedHtml, trustedUrl } from '@kovojs/browser';
export { renderRouteHtml } from '../html.js';
export { Defer } from '../deferred-region.js';
export type { DeferProps, RegionPriority, ServerRenderable } from '../deferred-region.js';
export type { CspInlineMetadata } from '../csp.js';
export type {
  AwaitableGeneratedFragmentRenderable,
  GeneratedFragmentRenderable,
  ServerFragmentRenderable,
  ServerRenderedHtml,
} from '../renderable.js';
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
  StylesheetLink,
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
  RouteMetaCallback,
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
export { ComponentXmlError, parseComponentXml, renderRegistry } from '../render-tree.js';
export { renderTree } from '../render-tree-public.js';
export type {
  ComponentElementNode,
  ComponentNode,
  ComponentRegistry,
  ComponentRegistryEntry,
  ComponentRegistryInput,
  ComponentTextNode,
  RenderTreeOptions,
} from '../render-tree.js';
