import {
  cspHashAttribute,
  cspSha256,
  hasCspInlineMetadata,
  mergeCspInlineMetadata,
  type CspInlineMetadata,
} from './csp.js';
import { escapeAttribute, escapeHtml, escapeScriptJson, safeUrlValue } from './html.js';

/**
 * Per-route Speculation Rules eagerness (SPEC §8). `'conservative'` and `'moderate'`
 * opt into prefetch/prerender; `false` (the default) emits nothing. `'moderate'` is
 * compile-gated on guarded/session-dependent routes (KV419).
 */
export type RoutePrefetch = 'conservative' | 'moderate' | false;

/** Resolved document `<head>` metadata (title, description, OG image) for a route. */
export interface RouteMeta {
  description?: string;
  image?: string;
  title?: string;
}

/**
 * Query-dependent route metadata source: names the `queries` it reads and `resolve`s
 * those values into a `RouteMeta` at render time.
 */
export interface RouteMetaFactory {
  queries: readonly string[];
  resolve(values: Record<string, unknown>): RouteMeta;
}

/** A route's `meta`: either a static {@link RouteMeta} or a query-driven {@link RouteMetaFactory}. */
export type RouteMetaSource = RouteMeta | RouteMetaFactory;

/**
 * A localization message catalog inlined into the document for a locale. Serialized
 * into a `kovo-i18n` JSON script tag by the page-hint renderer.
 */
export interface I18nCatalog<Messages extends Record<string, string> = Record<string, string>> {
  locale: string;
  messages: Messages;
}

/**
 * A resolved stylesheet asset for route/page hints (SPEC §13.1): the linked `href`,
 * optional inlined `criticalCss` with its `cspHash`, and whether to `preload` it via
 * Early Hints. Produced by {@link stylesheet} and accepted in {@link PageHintOptions}.
 */
export interface StylesheetAsset {
  criticalCss?: string;
  cspHash?: string;
  /** When criticalCss exists, defer the full stylesheet by default; set false to block. */
  deferFull?: boolean;
  href: string;
  preload?: boolean;
}

/** Theme CSS accepted by {@link stylesheet}; usually a Kovo theme object from `@kovojs/style`. */
export type StylesheetTheme = string | { readonly css: string };

/** Options for declaring an authored stylesheet asset (SPEC.md §13.1). */
export interface StylesheetDeclarationOptions {
  /** Critical CSS to inline before the linked stylesheet identity. */
  criticalCss?: string | readonly string[];
  /**
   * How theme CSS prepended to critical CSS should be inlined. The default
   * (`'used'`) keeps only custom properties reachable from `criticalCss`
   * `var(...)` references; `'all'` keeps the full theme block.
   */
  criticalCssTheme?: 'all' | 'used';
  /** Optional CSP hash for the inlined critical CSS. */
  cspHash?: string;
  /** When criticalCss exists, defer the full stylesheet by default; set false to block. */
  deferFull?: boolean;
  /** Public stylesheet href; local sources derive `/assets/<file>` when omitted. */
  href?: string;
  /** Whether Early Hints should preload the linked stylesheet. */
  preload?: boolean;
  /** Theme CSS to prepend to `criticalCss`. */
  theme?: StylesheetTheme;
}

/** @internal */
export interface StylesheetManifestEntry extends StylesheetAsset {
  fragmentTargets?: readonly string[];
  sourceFileName?: string;
}

/**
 * Inputs for rendering a route's document hints: stylesheets and critical CSS (SPEC §13.1),
 * `<head>` `meta`, i18n catalogs, module preloads, bootstrap script, and Speculation Rules
 * prefetch/prerender (SPEC §8). Page, mutation-fragment, and deferred-fragment renders share
 * this stylesheet-delivery shape.
 */
// SPEC section 13.1: page, mutation fragment, and deferred fragment renders share stylesheet delivery.
export interface PageHintOptions {
  bootstrapScript?: string;
  i18n?: I18nCatalog | readonly I18nCatalog[];
  meta?: RouteMetaSource | readonly RouteMetaSource[];
  modulepreloads?: readonly string[];
  prefetch?: RoutePrefetch;
  /**
   * Named justification that suppresses KV419 on a guarded `prefetch:'moderate'` route.
   *
   * SPEC §8:756 allows guarded moderate prefetch when the author supplies an explicit
   * rationale (e.g. `"route is idempotent and safe for credentialed prerender"`).
   * A non-empty string silences the diagnostic; an absent or empty string is ignored.
   */
  prefetchJustification?: string;
  prerenderUrls?: readonly string[];
  stylesheets?: readonly (string | StylesheetAsset)[];
}

/** @internal */
export interface PageHintRenderContext {
  queries?: Record<string, unknown>;
}

/** @internal */
export interface PageHints {
  csp?: CspInlineMetadata;
  earlyHints: Record<string, string>;
  html: string;
}

interface InlineHtmlWithCsp {
  csp?: CspInlineMetadata;
  html: string;
}

/** @internal */
export function stylesheetsForTargets(
  manifest: readonly StylesheetManifestEntry[],
  targets?: readonly string[],
): StylesheetAsset[] {
  if (!targets) return dedupeStylesheets(manifest);

  const wanted = new Set(targets);
  return dedupeStylesheets(
    manifest.filter((asset) => asset.fragmentTargets?.some((target) => wanted.has(target))),
  );
}

/**
 * Declare a local or external stylesheet for route/page hints.
 *
 * Local paths derive `/assets/<file>` unless `options.href` overrides it; external
 * and root-relative hrefs are preserved.
 */
export function stylesheet(source: string, options?: StylesheetDeclarationOptions): StylesheetAsset;
/** Declare a theme-only or fully configured stylesheet asset for route/page hints. */
export function stylesheet(options: StylesheetDeclarationOptions): StylesheetAsset;
export function stylesheet(
  sourceOrOptions: string | StylesheetDeclarationOptions,
  maybeOptions: StylesheetDeclarationOptions = {},
): StylesheetAsset {
  const source = typeof sourceOrOptions === 'string' ? sourceOrOptions : undefined;
  const options = typeof sourceOrOptions === 'string' ? maybeOptions : sourceOrOptions;
  const criticalCss = resolveStylesheetCriticalCss(options);
  const href = options.href ?? (source ? stylesheetHrefForSource(source) : '/assets/styles.css');

  return {
    ...(criticalCss ? { criticalCss } : {}),
    ...(options.cspHash === undefined ? {} : { cspHash: options.cspHash }),
    ...(options.deferFull === undefined ? {} : { deferFull: options.deferFull }),
    href,
    ...(options.preload === undefined ? {} : { preload: options.preload }),
  };
}

/**
 * Render framework document hints, preload tags, and speculation metadata.
 *
 * @internal
 */
export function renderPageHints(
  options: PageHintOptions,
  context: PageHintRenderContext = {},
): PageHints {
  const modulepreloads = dedupe([
    ...(options.modulepreloads ?? []),
    ...(options.bootstrapScript ? [options.bootstrapScript] : []),
  ]);
  const stylesheets = dedupeStylesheets(options.stylesheets ?? []);
  const stylesheetHints = stylesheets.map(renderPageStylesheetHint);
  const i18nCatalogs = renderI18nCatalogs(options.i18n);
  const speculationRules = renderSpeculationRules(
    options.prefetch ?? false,
    options.prerenderUrls ?? [],
  );
  const csp = mergeCspInlineMetadata(
    ...stylesheetHints.map((hint) => hint.csp),
    ...i18nCatalogs.map((catalog) => catalog.csp),
    speculationRules.csp,
  );
  const html = [
    ...renderRouteMeta(options.meta, context),
    ...i18nCatalogs.map((catalog) => catalog.html),
    ...stylesheetHints.map((hint) => hint.html),
    ...modulepreloads.map((href) => `<link rel="modulepreload" href="${escapeAttribute(href)}">`),
    options.bootstrapScript
      ? `<script type="module" src="${escapeAttribute(options.bootstrapScript)}"></script>`
      : '',
    speculationRules.html,
  ]
    .filter(Boolean)
    .join('');

  return {
    ...(hasCspInlineMetadata(csp) ? { csp } : {}),
    earlyHints: renderEarlyHints(stylesheets, modulepreloads),
    html,
  };
}

export function renderStylesheetLinks(stylesheets: readonly (string | StylesheetAsset)[]): string {
  return dedupeStylesheets(stylesheets)
    .map((asset) => renderStylesheetLink(asset.href))
    .join('');
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function dedupeStylesheets(values: readonly (string | StylesheetAsset)[]): StylesheetAsset[] {
  const seen = new Map<string, number>();
  const assets: StylesheetAsset[] = [];

  for (const value of values) {
    const asset = typeof value === 'string' ? { href: value, preload: true } : value;
    if (!asset.href) continue;

    const existingIndex = seen.get(asset.href);
    if (existingIndex !== undefined) {
      const existing = assets[existingIndex];
      if (existing && !existing.criticalCss && asset.criticalCss) {
        assets[existingIndex] = { ...existing, criticalCss: asset.criticalCss };
      }
      continue;
    }

    seen.set(asset.href, assets.length);
    assets.push(asset);
  }

  return assets;
}

function renderPageStylesheetHint(asset: StylesheetAsset): InlineHtmlWithCsp {
  const link = renderStylesheetLink(asset.href);
  if (!asset.criticalCss) return { html: link };

  const cssText = escapeStyleText(asset.criticalCss);
  const hash = asset.cspHash ?? cspSha256(cssText);
  const fullStylesheet =
    asset.deferFull === false
      ? link
      : `${renderDeferredStylesheetLink(asset.href)}<noscript>${link}</noscript>`;

  return {
    csp: { scripts: [], styles: [hash] },
    html: `<style data-kovo-critical-href="${escapeAttribute(asset.href)}" ${cspHashAttribute(hash)}>${cssText}</style>${fullStylesheet}`,
  };
}

function renderStylesheetLink(href: string): string {
  return `<link rel="stylesheet" href="${escapeAttribute(href)}">`;
}

function renderDeferredStylesheetLink(href: string): string {
  return `<link rel="preload" as="style" href="${escapeAttribute(href)}" data-kovo-deferred-style>`;
}

function renderEarlyHints(
  stylesheets: readonly StylesheetAsset[],
  modulepreloads: readonly string[],
): Record<string, string> {
  const links = [
    ...stylesheets
      .filter((asset) => asset.preload !== false)
      .map((asset) => `<${formatLinkHeaderTarget(asset.href)}>; rel=preload; as=style`),
    ...modulepreloads.map((href) => `<${formatLinkHeaderTarget(href)}>; rel=modulepreload`),
  ];

  return links.length > 0 ? { Link: links.join(', ') } : {};
}

function formatLinkHeaderTarget(href: string): string {
  return encodeURI(href).replace(
    /[<>,]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function stylesheetHrefForSource(source: string): string {
  if (isExternalStylesheetSource(source) || source.startsWith('/')) return source;

  const cleanSource = source.split(/[?#]/, 1)[0] ?? source;
  const suffix = source.slice(cleanSource.length);
  const fileName = cleanSource.split('/').filter(Boolean).at(-1);
  return `/assets/${fileName || 'styles.css'}${suffix}`;
}

function isExternalStylesheetSource(source: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(source) || source.startsWith('//');
}

function resolveStylesheetCriticalCss(options: StylesheetDeclarationOptions): string | undefined {
  const themeCss = stylesheetThemeCss(options.theme);
  const criticalParts = (
    Array.isArray(options.criticalCss) ? options.criticalCss : [options.criticalCss]
  ).filter((part): part is string => typeof part === 'string' && part.length > 0);
  const criticalCss = criticalParts.join('\n');
  const prunedThemeCss =
    themeCss === undefined ||
    criticalCss === '' ||
    options.criticalCssTheme === 'all' ||
    options.cspHash !== undefined
      ? themeCss
      : (pruneCriticalThemeCss(themeCss, criticalCss) ?? themeCss);
  const parts = [prunedThemeCss, ...criticalParts].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );

  return parts.length > 0 ? parts.join('\n') : undefined;
}

function stylesheetThemeCss(theme: StylesheetTheme | undefined): string | undefined {
  if (typeof theme === 'string') return theme;
  return typeof theme?.css === 'string' ? theme.css : undefined;
}

interface CriticalCssBlock {
  declarations: CriticalCssDeclaration[];
  selector: string;
}

interface CriticalCssDeclaration {
  property: string;
  raw: string;
  value: string;
}

function pruneCriticalThemeCss(themeCss: string, criticalCss: string): string | undefined {
  const blocks = parseCriticalCssBlocks(stripCssComments(themeCss));
  if (!blocks) return undefined;

  const declarationsByProperty = new Map<string, CriticalCssDeclaration[]>();
  for (const block of blocks) {
    for (const declaration of block.declarations) {
      if (!declaration.property.startsWith('--')) continue;
      const declarations = declarationsByProperty.get(declaration.property) ?? [];
      declarations.push(declaration);
      declarationsByProperty.set(declaration.property, declarations);
    }
  }

  const needed = transitiveCriticalCssVariables(criticalCss, declarationsByProperty);
  const rendered = blocks
    .map((block) => {
      const declarations = block.declarations.filter(
        (declaration) => !declaration.property.startsWith('--') || needed.has(declaration.property),
      );
      return declarations.length === 0
        ? ''
        : `${block.selector} {\n${declarations.map((declaration) => `  ${declaration.raw}`).join('\n')}\n}`;
    })
    .filter(Boolean);

  return rendered.join('\n\n');
}

function transitiveCriticalCssVariables(
  criticalCss: string,
  declarationsByProperty: ReadonlyMap<string, readonly CriticalCssDeclaration[]>,
): Set<string> {
  const needed = new Set(collectCssVariableReferences(criticalCss));
  const queue = [...needed];

  for (let index = 0; index < queue.length; index += 1) {
    const property = queue[index]!;
    for (const declaration of declarationsByProperty.get(property) ?? []) {
      for (const reference of collectCssVariableReferences(declaration.value)) {
        if (needed.has(reference)) continue;
        needed.add(reference);
        queue.push(reference);
      }
    }
  }

  return needed;
}

function collectCssVariableReferences(css: string): string[] {
  return [...css.matchAll(/var\(\s*(--[-_a-zA-Z0-9]+)/g)].map((match) => match[1]!);
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseCriticalCssBlocks(css: string): CriticalCssBlock[] | undefined {
  const blocks: CriticalCssBlock[] = [];
  let offset = 0;

  while (offset < css.length) {
    const open = css.indexOf('{', offset);
    if (open === -1) {
      return css.slice(offset).trim() === '' ? blocks : undefined;
    }

    const selector = css.slice(offset, open).trim();
    if (!selector) return undefined;
    const close = findMatchingCriticalCssBlockClose(css, open);
    if (close === undefined) return undefined;
    const body = css.slice(open + 1, close);
    if (body.includes('{') || body.includes('}')) return undefined;
    const declarations = parseCriticalCssDeclarations(body);
    if (!declarations) return undefined;
    blocks.push({ declarations, selector });
    offset = close + 1;
  }

  return blocks;
}

function findMatchingCriticalCssBlockClose(css: string, open: number): number | undefined {
  let quote: '"' | "'" | undefined;
  let parenDepth = 0;

  for (let index = open + 1; index < css.length; index += 1) {
    const char = css[index];
    if (quote !== undefined) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (char === '}' && parenDepth === 0) return index;
  }

  return undefined;
}

function parseCriticalCssDeclarations(body: string): CriticalCssDeclaration[] | undefined {
  const declarations: CriticalCssDeclaration[] = [];
  for (const rawDeclaration of splitCriticalCssDeclarations(body)) {
    const raw = rawDeclaration.trim();
    if (!raw) continue;
    const colon = findCriticalCssDeclarationColon(raw);
    if (colon === undefined) return undefined;
    const property = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (!property || !value) return undefined;
    declarations.push({ property, raw: `${property}: ${value};`, value });
  }
  return declarations;
}

function splitCriticalCssDeclarations(body: string): string[] {
  const declarations: string[] = [];
  let start = 0;
  let quote: '"' | "'" | undefined;
  let parenDepth = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote !== undefined) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (char !== ';' || parenDepth !== 0) continue;
    declarations.push(body.slice(start, index));
    start = index + 1;
  }

  declarations.push(body.slice(start));
  return declarations;
}

function findCriticalCssDeclarationColon(declaration: string): number | undefined {
  let quote: '"' | "'" | undefined;
  let parenDepth = 0;

  for (let index = 0; index < declaration.length; index += 1) {
    const char = declaration[index];
    if (quote !== undefined) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (char === ':' && parenDepth === 0) return index;
  }

  return undefined;
}

function renderSpeculationRules(
  prefetch: RoutePrefetch,
  urls: readonly string[],
): InlineHtmlWithCsp {
  // L2-early-hints-1 (bugs-part3): a speculation rule with `prefetch:'conservative'`
  // prerenders/prefetches the listed URLs with the user's credentials, and KV419 only
  // gates `moderate` (SPEC §8:763). An off-origin URL here is a credentialed
  // cross-origin prerender. Filter to SAME-ORIGIN targets only: a single-leading-slash
  // absolute path (`/path`) — rejecting `//host` and `/\host` (protocol-relative /
  // authority-forming) and any value carrying a scheme. `SAFE_URL_SCHEMES` alone would
  // not block cross-origin https, so an explicit same-origin path check is required.
  const prerenderUrls = dedupe(urls).filter(isSameOriginPrerenderUrl);
  if (!prefetch || prerenderUrls.length === 0) return { html: '' };

  const scriptText = escapeScriptJson(
    JSON.stringify({
      prerender: [
        {
          eagerness: prefetch,
          urls: prerenderUrls,
        },
      ],
    }),
  );
  const hash = cspSha256(scriptText);

  return {
    csp: { scripts: [hash], styles: [] },
    html: `<script type="speculationrules" ${cspHashAttribute(hash)}>${scriptText}</script>`,
  };
}

/**
 * L2-early-hints-1 (bugs-part3): accept only same-origin prerender targets — a
 * root-relative path with exactly one leading slash. Rejects protocol-relative
 * (`//host`), authority-forming (`/\host`), and any scheme-bearing absolute URL
 * (`https://evil/…`, `data:…`), which would prerender off-origin with the user's
 * credentials (SPEC §8:763; mirrors the same-origin `next` rule at §6.5:731).
 */
function isSameOriginPrerenderUrl(url: string): boolean {
  if (!url.startsWith('/')) return false;
  // Reject protocol-relative `//host` and backslash-authority `/\host`.
  if (url.startsWith('//') || url.startsWith('/\\')) return false;
  // Reject any backslash anywhere (a browser may normalize `\` to `/`, turning
  // `/x\evil` into an authority).
  if (url.includes('\\')) return false;
  // Reject any ASCII control char or whitespace (<= 0x20) and DEL (0x7f) that could
  // smuggle a second leading slash after browser normalization or break the path.
  for (let index = 0; index < url.length; index += 1) {
    const code = url.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

function renderRouteMeta(
  metaInput: PageHintOptions['meta'],
  context: PageHintRenderContext,
): string[] {
  const metas = Array.isArray(metaInput) ? metaInput : metaInput ? [metaInput] : [];
  const tags: string[] = [];

  for (const item of metas) {
    // F2 (bugs-part3 L2-early-hints-2): head meta is best-effort enrichment, not a
    // load-bearing render step. A meta-derive failure (absent query, a `derive`
    // callback throwing on a data gap such as a not-found product) must drop only the
    // affected tags, never 500 the whole document. `resolveRouteMeta` already returns
    // `undefined` for an absent-query factory; this catch also contains a throwing
    // `resolve`.
    let resolved: RouteMeta | undefined;
    try {
      resolved = resolveRouteMeta(item, context);
    } catch {
      resolved = undefined;
    }
    if (!resolved) continue;

    if (resolved.title) tags.push(`<title>${escapeHtml(resolved.title)}</title>`);
    if (resolved.description) {
      tags.push(
        `<meta name="description" content="${escapeAttribute(resolved.description)}">`,
        `<meta property="og:description" content="${escapeAttribute(resolved.description)}">`,
      );
    }
    if (resolved.image) {
      // part-4 L-i18n-meta-1: og:image is a URL sink — scheme-check before escaping so a
      // metaFromQuery-derived javascript:/data:/off-origin URL cannot bypass the §4.8 allowlist.
      tags.push(
        `<meta property="og:image" content="${escapeAttribute(safeUrlValue(resolved.image))}">`,
      );
    }
  }

  return tags;
}

/**
 * Resolve one route-meta source. A static {@link RouteMeta} is returned as-is. A
 * {@link RouteMetaFactory} returns `undefined` (skip — emit no tags) when any of its
 * declared queries is absent from the render context, instead of throwing
 * (F2 / bugs-part3 L2-early-hints-2): the document head path threads rendered queries
 * in only when they exist, so a routine data gap must omit the derived tags rather
 * than hard-500 the page.
 */
function resolveRouteMeta(
  source: RouteMetaSource,
  context: PageHintRenderContext,
): RouteMeta | undefined {
  if (!isRouteMetaFactory(source)) return source;

  const queries = context.queries ?? {};
  const values: Record<string, unknown> = {};

  for (const query of source.queries) {
    if (!Object.hasOwn(queries, query)) {
      return undefined;
    }
    values[query] = queries[query];
  }

  return source.resolve(values);
}

function isRouteMetaFactory(source: RouteMetaSource): source is RouteMetaFactory {
  return typeof (source as RouteMetaFactory).resolve === 'function';
}

function renderI18nCatalogs(i18nInput: PageHintOptions['i18n']): InlineHtmlWithCsp[] {
  const catalogs = Array.isArray(i18nInput) ? i18nInput : i18nInput ? [i18nInput] : [];

  return catalogs.map((catalog) => {
    const scriptText = escapeScriptJson(JSON.stringify(catalog.messages));
    const hash = cspSha256(scriptText);

    return {
      csp: { scripts: [hash], styles: [] },
      html: `<script type="application/json" kovo-i18n locale="${escapeAttribute(catalog.locale)}" ${cspHashAttribute(hash)}>${scriptText}</script>`,
    };
  });
}

function escapeStyleText(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style');
}
