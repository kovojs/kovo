// Phase 7: Kovo emits its own document CSP by default from framework-generated
// inline-script/style hashes. `renderContentSecurityPolicy` and `cspSha256` remain
// public for custom renderers that need to inspect or extend compatible hash metadata.
export { cspSha256, renderContentSecurityPolicy } from '../csp.js';
export type {
  ContentSecurityPolicyOptions,
  CspInlineMetadata,
  DocumentContentSecurityPolicyAllowlist,
  DocumentContentSecurityPolicyOptions,
} from '../csp.js';
export { Defer } from '../deferred-region.js';
export type { DeferProps, RegionPriority, ServerRenderable } from '../deferred-region.js';
export type {
  DeferredFragmentChunk,
  DeferredPriority,
  DeferredQueryChunk,
  DeferredStreamChunk,
} from '../deferred-stream.js';
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
