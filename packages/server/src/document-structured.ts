import { hasUnsafeUrlScheme } from '@kovojs/core/internal/security-url';
import type { TrustedHtml } from '@kovojs/browser';
import { kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';

import {
  cspHashAttribute,
  cspSha256,
  mergeCspInlineMetadata,
  type CspInlineMetadata,
} from './csp.js';
import {
  escapeAttribute,
  escapeHtml,
  isRenderedHtml,
  renderHtmlValue,
  safeUrlAttribute,
} from './html.js';
import {
  createWitnessSet,
  createWitnessWeakSet,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessObjectKeys,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

const documentConfigSentinel: unique symbol = Symbol('kovo.document.config');
const documentNodeSentinel: unique symbol = Symbol('kovo.document.node');
const documentConfigProofs = createWitnessWeakSet<object>();
const documentNodeProofs = createWitnessWeakSet<object>();
const invalidAttributeNamePattern = new RegExp(String.raw`[\s"'=<>/\u0000-\u001f\u007f]`, 'u');
const linkAttributeNames = witnessSetOf([
  'as',
  'crossorigin',
  'fetchpriority',
  'href',
  'imagesizes',
  'imagesrcset',
  'integrity',
  'media',
  'referrerpolicy',
  'rel',
  'type',
]);

type DocumentPlacement = 'head' | 'body-start' | 'body-end' | 'html-attrs' | 'body-attrs';

/** Attribute value accepted by structured document shell attribute primitives. */
export type DocumentShellAttributeValue = boolean | number | string | undefined;

/** Constrained shell attributes collected from `HtmlAttrs` and `BodyAttrs` (SPEC.md §9.5). */
export type DocumentShellAttributes = Record<string, DocumentShellAttributeValue>;

interface DocumentNode {
  readonly [documentNodeSentinel]: true;
  readonly attrs?: DocumentShellAttributes;
  readonly csp?: CspInlineMetadata;
  readonly html?: string;
  readonly placement: DocumentPlacement;
}

/** Request-independent context for structured document declarations (SPEC.md §9.5). */
export interface DocumentAuthoringContext {
  readonly environment?: 'build' | 'dev' | 'production' | 'test';
}

/** Structured document facts consumed by framework-owned document assembly (SPEC.md §9.5). */
export interface DocumentConfig {
  readonly [documentConfigSentinel]: true;
  readonly bodyAttrs: DocumentShellAttributes;
  readonly bodyEnd: readonly string[];
  readonly bodyStart: readonly string[];
  readonly csp: CspInlineMetadata;
  readonly head: readonly string[];
  readonly htmlAttrs: DocumentShellAttributes;
  readonly lang?: string;
}

/** Structured document declaration accepted by `createApp({ document })` (SPEC.md §9.5). */
export type DocumentDeclaration =
  | DocumentConfig
  | ((context: DocumentAuthoringContext) => DocumentConfig);

/** TSX declaration boundary for app-owned document contributions (SPEC.md §9.5). */
export function Document(props: {
  children?: unknown;
  lang?: string;
  title?: string;
}): DocumentConfig {
  const nodes = collectDocumentNodes(props.children);
  const htmlAttrs: DocumentShellAttributes = {};
  const bodyAttrs: DocumentShellAttributes = {};
  const head: string[] = [];
  const bodyStart: string[] = [];
  const bodyEnd: string[] = [];
  const cspEntries: CspInlineMetadata[] = [];

  if (props.title !== undefined) {
    head.push(`<title>${escapeHtml(props.title)}</title>`);
  }

  for (const node of nodes) {
    if (node.csp !== undefined) cspEntries.push(node.csp);
    if (node.placement === 'head' && node.html !== undefined) head.push(node.html);
    if (node.placement === 'body-start' && node.html !== undefined) bodyStart.push(node.html);
    if (node.placement === 'body-end' && node.html !== undefined) bodyEnd.push(node.html);
    if (node.placement === 'html-attrs' && node.attrs !== undefined) {
      Object.assign(htmlAttrs, node.attrs);
    }
    if (node.placement === 'body-attrs' && node.attrs !== undefined) {
      Object.assign(bodyAttrs, node.attrs);
    }
  }

  if (props.lang !== undefined) {
    htmlAttrs.lang = props.lang;
  }

  return documentConfig({
    [documentConfigSentinel]: true,
    bodyAttrs,
    bodyEnd,
    bodyStart,
    csp: mergeCspInlineMetadata(...cspEntries),
    head,
    htmlAttrs,
    ...(props.lang === undefined ? {} : { lang: props.lang }),
  });
}

/** Document head contribution container (SPEC.md §9.5). */
export function Head(props: { children?: unknown }): unknown {
  const rendered = renderHeadChildren(props.children);
  return documentNode('head', rendered.html, rendered.csp);
}

/** Contribution placed immediately after the framework-owned `<body>` opener. */
export function BodyStart(props: { children?: unknown }): unknown {
  const rendered = renderDocumentChildren(props.children);
  return documentNode('body-start', rendered.html, rendered.csp);
}

/** Contribution placed before the framework-owned `</body>` closer, including deferred streams. */
export function BodyEnd(props: { children?: unknown }): unknown {
  const rendered = renderDocumentChildren(props.children);
  return documentNode('body-end', rendered.html, rendered.csp);
}

/** Constrained attributes for the framework-owned `<html>` element. */
export function HtmlAttrs(props: DocumentShellAttributes & { children?: never }): unknown {
  return documentAttrs('html-attrs', filterShellAttrs(props, 'html'));
}

/** Constrained attributes for the framework-owned `<body>` element. */
export function BodyAttrs(props: DocumentShellAttributes & { children?: never }): unknown {
  return documentAttrs('body-attrs', filterShellAttrs(props, 'body'));
}

/** Structured `<meta>` document primitive. */
export function Meta(props: {
  charset?: string;
  content?: string;
  name?: string;
  property?: string;
}): unknown {
  const attrs = renderAttributes('meta', {
    charset: props.charset,
    content: props.content,
    name: props.name,
    property: props.property,
  });
  return documentNode('head', `<meta${attrs}>`);
}

/** Structured `<link>` document primitive with URL-scheme enforcement (SPEC.md §4.8). */
export function Link(props: {
  as?: string;
  crossorigin?: boolean | string;
  fetchpriority?: string;
  href: string;
  imagesizes?: string;
  imagesrcset?: string;
  integrity?: string;
  media?: string;
  referrerpolicy?: string;
  rel: string;
  type?: string;
}): unknown {
  assertSafeUrl(props.href, '<Link href>');
  return documentNode('head', `<link${renderAttributes('link', filterLinkAttrs(props))}>`);
}

/** StylesheetLink link primitive. */
export function StylesheetLink(props: { href: string; media?: string }): unknown {
  return Link({
    rel: 'stylesheet',
    href: props.href,
    ...(props.media === undefined ? {} : { media: props.media }),
  });
}

/** Font preload primitive with secure defaults. */
export function FontPreload(props: {
  crossorigin?: boolean | string;
  href: string;
  type?: string;
}): unknown {
  return Link({
    rel: 'preload',
    href: props.href,
    as: 'font',
    type: props.type ?? 'font/woff2',
    crossorigin: props.crossorigin ?? true,
  });
}

/** Module preload primitive. */
export function ModulePreload(props: { href: string; integrity?: string }): unknown {
  return Link({
    rel: 'modulepreload',
    href: props.href,
    ...(props.integrity === undefined ? {} : { integrity: props.integrity }),
  });
}

/** Inline script primitive that enrolls the emitted source in document CSP. */
export function InlineScript(props: {
  children?: string | readonly string[] | TrustedHtml;
  id: string;
  run: 'afterInteractive' | 'beforePaint';
}): unknown {
  if (props.id.trim() === '') {
    throw new TypeError('InlineScript requires a stable non-empty id (SPEC.md §9.5, KV424).');
  }
  const source = escapeScriptElementText(sourceText(props.children, 'InlineScript'));
  const hash = cspSha256(source);
  return documentNode(
    'head',
    `<script id="${escapeAttribute(props.id)}" data-kovo-run="${escapeAttribute(
      props.run,
    )}" ${cspHashAttribute(hash)}>${source}</script>`,
    { scripts: [hash], styles: [] },
  );
}

/** Inline style primitive that enrolls the emitted source in document CSP. */
export function InlineStyle(props: {
  children?: string | readonly string[] | TrustedHtml;
  id: string;
  source: string;
}): unknown {
  if (props.id.trim() === '') {
    throw new TypeError('InlineStyle requires a stable non-empty id (SPEC.md §9.5, KV424).');
  }
  if (props.source.trim() === '') {
    throw new TypeError('InlineStyle requires source metadata (SPEC.md §9.5, KV424).');
  }
  const source = escapeStyleElementText(sourceText(props.children, 'InlineStyle'));
  const hash = cspSha256(source);
  return documentNode(
    'head',
    `<style id="${escapeAttribute(props.id)}" data-kovo-style-source="${escapeAttribute(
      props.source,
    )}" ${cspHashAttribute(hash)}>${source}</style>`,
    { scripts: [], styles: [hash] },
  );
}

export function isDocumentConfig(value: unknown): value is DocumentConfig {
  return (
    typeof value === 'object' && value !== null && witnessWeakSetHas(documentConfigProofs, value)
  );
}

/**
 * Reconstruct a genuine structured document through immutable own-data snapshots.
 *
 * SPEC §6.6/§9.5: `createApp()` closes request-time security topology. A genuine WeakSet witness
 * proves which constructor created a document, but it must not authorize later bytes read from
 * mutable public arrays/records. Rebuild every nested value once so request code cannot mutate a
 * previously validated document shell after app assembly.
 *
 * @internal
 */
export function snapshotDocumentConfig(value: DocumentConfig): DocumentConfig {
  if (!isDocumentConfig(value)) {
    throw new TypeError(
      'Structured document snapshots require a genuine Document(...) config (SPEC §9.5).',
    );
  }
  const lang = ownDataValue(value, 'lang', 'document.lang');
  if (lang !== undefined && typeof lang !== 'string') {
    throw new TypeError('Structured document lang must be a string (SPEC §9.5).');
  }
  return sealDocumentConfig({
    [documentConfigSentinel]: true,
    bodyAttrs: snapshotDocumentShellAttributes(
      ownDataValue(value, 'bodyAttrs', 'document.bodyAttrs'),
      'document.bodyAttrs',
    ),
    bodyEnd: snapshotDocumentStringArray(
      ownDataValue(value, 'bodyEnd', 'document.bodyEnd'),
      'document.bodyEnd',
    ),
    bodyStart: snapshotDocumentStringArray(
      ownDataValue(value, 'bodyStart', 'document.bodyStart'),
      'document.bodyStart',
    ),
    csp: snapshotCspInlineMetadata(ownDataValue(value, 'csp', 'document.csp')),
    head: snapshotDocumentStringArray(
      ownDataValue(value, 'head', 'document.head'),
      'document.head',
    ),
    htmlAttrs: snapshotDocumentShellAttributes(
      ownDataValue(value, 'htmlAttrs', 'document.htmlAttrs'),
      'document.htmlAttrs',
    ),
    ...(lang === undefined ? {} : { lang }),
  });
}

/** @internal */
export function resolveDocumentDeclaration(
  value: DocumentDeclaration | undefined,
): DocumentConfig | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'function' ? value({}) : value;
}

/** @internal */
export function renderShellAttributes(attributes: DocumentShellAttributes): string {
  return Object.entries(attributes)
    .filter(
      (entry): entry is [string, Exclude<DocumentShellAttributeValue, undefined>] =>
        entry[1] !== undefined,
    )
    .map(([name, value]) => {
      assertValidAttributeName(name, 'document shell attribute');
      if (value === true) return ` ${name}`;
      if (value === false) return '';
      return ` ${name}="${escapeAttribute(String(value))}"`;
    })
    .join('');
}

function documentConfig(config: DocumentConfig): DocumentConfig {
  return sealDocumentConfig(config);
}

function markDocumentNode(node: DocumentNode): DocumentNode {
  const sealed = witnessFreeze({
    ...node,
    ...(node.attrs === undefined
      ? {}
      : { attrs: snapshotDocumentShellAttributes(node.attrs, 'document node attrs') }),
    ...(node.csp === undefined ? {} : { csp: snapshotCspInlineMetadata(node.csp) }),
  }) as DocumentNode;
  witnessWeakSetAdd(documentNodeProofs, sealed);
  return sealed;
}

function sealDocumentConfig(config: DocumentConfig): DocumentConfig {
  const sealed = witnessFreeze({
    ...config,
    bodyAttrs: snapshotDocumentShellAttributes(config.bodyAttrs, 'document.bodyAttrs'),
    bodyEnd: snapshotDocumentStringArray(config.bodyEnd, 'document.bodyEnd'),
    bodyStart: snapshotDocumentStringArray(config.bodyStart, 'document.bodyStart'),
    csp: snapshotCspInlineMetadata(config.csp),
    head: snapshotDocumentStringArray(config.head, 'document.head'),
    htmlAttrs: snapshotDocumentShellAttributes(config.htmlAttrs, 'document.htmlAttrs'),
  }) as DocumentConfig;
  witnessWeakSetAdd(documentConfigProofs, sealed);
  return sealed;
}

function snapshotDocumentStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be a dense array of strings (SPEC §9.5).`);
  }
  const snapshot: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(`${label} must contain stable own string values (SPEC §9.5).`);
    }
    snapshot.push(descriptor.value);
  }
  return witnessFreeze(snapshot);
}

function snapshotDocumentShellAttributes(value: unknown, label: string): DocumentShellAttributes {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain own-data attribute record (SPEC §9.5).`);
  }
  const snapshot: DocumentShellAttributes = {};
  for (const key of witnessObjectKeys(value)) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label}.${key} must be a stable own data property (SPEC §9.5).`);
    }
    const attribute = descriptor.value;
    if (
      attribute !== undefined &&
      typeof attribute !== 'boolean' &&
      typeof attribute !== 'number' &&
      typeof attribute !== 'string'
    ) {
      throw new TypeError(`${label}.${key} has an unsupported attribute value (SPEC §9.5).`);
    }
    snapshot[key] = attribute;
  }
  return witnessFreeze(snapshot);
}

function snapshotCspInlineMetadata(value: unknown): CspInlineMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Structured document CSP metadata must be an own-data record (SPEC §9.5).');
  }
  const scripts = snapshotDocumentStringArray(
    ownDataValue(value, 'scripts', 'document.csp.scripts'),
    'document.csp.scripts',
  );
  const styles = snapshotDocumentStringArray(
    ownDataValue(value, 'styles', 'document.csp.styles'),
    'document.csp.styles',
  );
  const styleAttributes = ownDataValue(value, 'styleAttributes', 'document.csp.styleAttributes');
  return witnessFreeze({
    scripts,
    styles,
    ...(styleAttributes === undefined
      ? {}
      : {
          styleAttributes: snapshotDocumentStringArray(
            styleAttributes,
            'document.csp.styleAttributes',
          ),
        }),
  });
}

function ownDataValue(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${label} must be a stable own data property (SPEC §9.5).`);
  }
  return descriptor.value;
}

function documentNode(
  placement: DocumentPlacement,
  html: string,
  csp?: CspInlineMetadata,
): DocumentNode {
  return markDocumentNode({
    [documentNodeSentinel]: true,
    placement,
    ...(html === '' ? {} : { html }),
    ...(csp === undefined ? {} : { csp }),
  });
}

function documentAttrs(placement: DocumentPlacement, attrs: DocumentShellAttributes): DocumentNode {
  return markDocumentNode({
    [documentNodeSentinel]: true,
    attrs,
    placement,
  });
}

/** @internal */
export function isStructuredDocumentNode(value: unknown): value is object {
  return isDocumentNode(value);
}

function collectDocumentNodes(value: unknown): DocumentNode[] {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(collectDocumentNodes);
  if (isDocumentNode(value)) return [value];
  if (isRenderedHtml(value) || typeof value === 'string') {
    throw new TypeError(
      '<Document> only accepts structured document primitives such as <Head>, <BodyStart>, and <BodyEnd> (SPEC.md §9.5, KV424).',
    );
  }
  throw new TypeError(
    '<Document> received an unsupported child. Use structured document primitives (SPEC.md §9.5, KV424).',
  );
}

function isDocumentNode(value: unknown): value is DocumentNode {
  return (
    typeof value === 'object' && value !== null && witnessWeakSetHas(documentNodeProofs, value)
  );
}

function renderDocumentChildren(value: unknown): { csp: CspInlineMetadata; html: string } {
  if (value === null || value === undefined || value === false) {
    return { csp: mergeCspInlineMetadata(), html: '' };
  }
  if (Array.isArray(value)) {
    const rendered = value.map(renderDocumentChildren);
    return {
      csp: mergeCspInlineMetadata(...rendered.map((child) => child.csp)),
      html: rendered.map((child) => child.html).join(''),
    };
  }
  if (isDocumentNode(value)) {
    if (
      value.placement !== 'head' &&
      value.placement !== 'body-start' &&
      value.placement !== 'body-end'
    ) {
      throw new TypeError(
        'Shell attribute primitives must be direct <Document> children (SPEC.md §9.5, KV424).',
      );
    }
    return { csp: value.csp ?? mergeCspInlineMetadata(), html: value.html ?? '' };
  }
  return { csp: mergeCspInlineMetadata(), html: renderHtmlValue(value) };
}

function renderHeadChildren(value: unknown): { csp: CspInlineMetadata; html: string } {
  if (value === null || value === undefined || value === false) {
    return { csp: mergeCspInlineMetadata(), html: '' };
  }
  if (Array.isArray(value)) {
    const rendered = value.map(renderHeadChildren);
    return {
      csp: mergeCspInlineMetadata(...rendered.map((child) => child.csp)),
      html: rendered.map((child) => child.html).join(''),
    };
  }
  if (!isDocumentNode(value) || value.placement !== 'head') {
    throw new TypeError(
      '<Head> only accepts structured head primitives such as <Meta>, <Link>, <FontPreload>, <InlineScript>, and <InlineStyle> (SPEC.md §9.5, KV424).',
    );
  }
  return { csp: value.csp ?? mergeCspInlineMetadata(), html: value.html ?? '' };
}

function renderAttributes(tag: string, attributes: Record<string, unknown>): string {
  return Object.entries(attributes)
    .filter((entry): entry is [string, Exclude<unknown, undefined | false | null>] => {
      const [name, value] = entry;
      return name !== 'children' && value !== undefined && value !== false && value !== null;
    })
    .map(([name, value]) => {
      assertValidAttributeName(name, `<${tag}> attribute`);
      if (value === true) return ` ${name}`;
      return ` ${name}="${safeUrlAttribute(name, String(value))}"`;
    })
    .join('');
}

function filterShellAttrs(
  props: DocumentShellAttributes & { children?: never },
  element: 'body' | 'html',
): DocumentShellAttributes {
  const allowed =
    element === 'html' ? witnessSetOf(['class', 'dir', 'lang']) : witnessSetOf(['class']);
  const attrs: DocumentShellAttributes = {};
  for (const [name, value] of Object.entries(props)) {
    if (name === 'children' || value === undefined || value === false) continue;
    assertValidAttributeName(name, `<${element}> attribute`);
    if (!witnessSetHas(allowed, name) && !name.startsWith('data-')) {
      throw new TypeError(
        `<${element}> attribute "${name}" is not supported by structured document attributes (SPEC.md §9.5, KV424).`,
      );
    }
    attrs[name] = value;
  }
  return attrs;
}

function filterLinkAttrs(attributes: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (!witnessSetHas(linkAttributeNames, name)) continue;
    attrs[name] = value;
  }
  return attrs;
}

function assertValidAttributeName(name: string, sink: string): void {
  if (name !== '' && !invalidAttributeNamePattern.test(name)) return;
  throw new TypeError(
    `${sink} name "${name}" is not a valid HTML attribute token (SPEC.md §9.5, KV424).`,
  );
}

function assertSafeUrl(value: string, sink: string): void {
  if (!hasUnsafeUrlScheme(value)) return;
  throw new TypeError(`${sink} received an unsafe URL scheme (SPEC.md §4.8, KV236).`);
}

function witnessSetOf<Value>(values: readonly Value[]): Set<Value> {
  const set = createWitnessSet<Value>();
  for (const value of values) witnessSetAdd(set, value);
  return set;
}

function sourceText(
  value: string | readonly string[] | TrustedHtml | undefined,
  name: string,
): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => sourceText(item, name)).join('');
  const trusted = kovoTrustedHtmlContent(value);
  if (trusted !== '') return trusted;
  if (typeof value === 'string') return value;
  throw new TypeError(`${name} children must be source text (SPEC.md §9.5, KV424).`);
}

function escapeScriptElementText(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script');
}

function escapeStyleElementText(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style');
}
