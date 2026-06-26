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

const documentConfigBrand: unique symbol = Symbol.for('kovo.document.config') as any;
const documentNodeBrand: unique symbol = Symbol.for('kovo.document.node') as any;
const invalidAttributeNamePattern = /[\s"'=<>/\u0000-\u001f\u007f]/u;
const linkAttributeNames = new Set([
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
  readonly [documentNodeBrand]: true;
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
  readonly [documentConfigBrand]: true;
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

  return {
    [documentConfigBrand]: true,
    bodyAttrs,
    bodyEnd,
    bodyStart,
    csp: mergeCspInlineMetadata(...cspEntries),
    head,
    htmlAttrs,
    ...(props.lang === undefined ? {} : { lang: props.lang }),
  };
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

/** Stylesheet link primitive. */
export function Stylesheet(props: { href: string; media?: string }): unknown {
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
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<DocumentConfig>)[documentConfigBrand] === true
  );
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

function documentNode(
  placement: DocumentPlacement,
  html: string,
  csp?: CspInlineMetadata,
): DocumentNode {
  return {
    [documentNodeBrand]: true,
    placement,
    ...(html === '' ? {} : { html }),
    ...(csp === undefined ? {} : { csp }),
  };
}

function documentAttrs(placement: DocumentPlacement, attrs: DocumentShellAttributes): DocumentNode {
  return {
    [documentNodeBrand]: true,
    attrs,
    placement,
  };
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
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<DocumentNode>)[documentNodeBrand] === true
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
  const allowed = element === 'html' ? new Set(['class', 'dir', 'lang']) : new Set(['class']);
  const attrs: DocumentShellAttributes = {};
  for (const [name, value] of Object.entries(props)) {
    if (name === 'children' || value === undefined || value === false) continue;
    assertValidAttributeName(name, `<${element}> attribute`);
    if (!allowed.has(name) && !name.startsWith('data-')) {
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
    if (!linkAttributeNames.has(name)) continue;
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
