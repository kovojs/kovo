import {
  cspHashAttribute,
  cspSha256,
  hasCspInlineMetadata,
  mergeCspInlineMetadata,
  type CspInlineMetadata,
} from './csp.js';
import { escapeAttribute, escapeHtml, escapeScriptJson } from './html.js';

export type RoutePrefetch = 'conservative' | 'moderate' | false;

export interface RouteMeta {
  description?: string;
  image?: string;
  title?: string;
}

export interface RouteMetaFactory {
  queries: readonly string[];
  resolve(values: Record<string, unknown>): RouteMeta;
}

export type RouteMetaSource = RouteMeta | RouteMetaFactory;

export interface I18nCatalog<Messages extends Record<string, string> = Record<string, string>> {
  locale: string;
  messages: Messages;
}

export interface StylesheetAsset {
  criticalCss?: string;
  cspHash?: string;
  href: string;
  preload?: boolean;
}

export interface StylesheetManifestEntry extends StylesheetAsset {
  fragmentTargets?: readonly string[];
  sourceFileName?: string;
}

// SPEC section 13.1: page, mutation fragment, and deferred fragment renders share stylesheet delivery.
export interface PageHintOptions {
  bootstrapScript?: string;
  i18n?: I18nCatalog | readonly I18nCatalog[];
  meta?: RouteMetaSource | readonly RouteMetaSource[];
  modulepreloads?: readonly string[];
  prefetch?: RoutePrefetch;
  prerenderUrls?: readonly string[];
  stylesheets?: readonly (string | StylesheetAsset)[];
}

export interface PageHintRenderContext {
  queries?: Record<string, unknown>;
}

export interface PageHints {
  csp?: CspInlineMetadata;
  earlyHints: Record<string, string>;
  html: string;
}

interface InlineHtmlWithCsp {
  csp?: CspInlineMetadata;
  html: string;
}

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
    .map((asset) => `<link rel="stylesheet" href="${escapeAttribute(asset.href)}">`)
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
  const link = `<link rel="stylesheet" href="${escapeAttribute(asset.href)}">`;
  if (!asset.criticalCss) return { html: link };

  const cssText = escapeStyleText(asset.criticalCss);
  const hash = asset.cspHash ?? cspSha256(cssText);

  return {
    csp: { scripts: [], styles: [hash] },
    html: `<style data-kovo-critical-href="${escapeAttribute(asset.href)}" ${cspHashAttribute(hash)}>${cssText}</style>${link}`,
  };
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

function renderSpeculationRules(
  prefetch: RoutePrefetch,
  urls: readonly string[],
): InlineHtmlWithCsp {
  const prerenderUrls = dedupe(urls);
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

function renderRouteMeta(
  metaInput: PageHintOptions['meta'],
  context: PageHintRenderContext,
): string[] {
  const metas = Array.isArray(metaInput) ? metaInput : metaInput ? [metaInput] : [];
  const tags: string[] = [];

  for (const item of metas) {
    const resolved = resolveRouteMeta(item, context);

    if (resolved.title) tags.push(`<title>${escapeHtml(resolved.title)}</title>`);
    if (resolved.description) {
      tags.push(
        `<meta name="description" content="${escapeAttribute(resolved.description)}">`,
        `<meta property="og:description" content="${escapeAttribute(resolved.description)}">`,
      );
    }
    if (resolved.image) {
      tags.push(`<meta property="og:image" content="${escapeAttribute(resolved.image)}">`);
    }
  }

  return tags;
}

function resolveRouteMeta(source: RouteMetaSource, context: PageHintRenderContext): RouteMeta {
  if (!isRouteMetaFactory(source)) return source;

  const queries = context.queries ?? {};
  const values: Record<string, unknown> = {};

  for (const query of source.queries) {
    if (!Object.hasOwn(queries, query)) {
      throw new Error(`Missing query data for route meta: ${query}`);
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
