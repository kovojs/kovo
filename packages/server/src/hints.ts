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
  earlyHints: Record<string, string>;
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

export function renderPageHints(
  options: PageHintOptions,
  context: PageHintRenderContext = {},
): PageHints {
  const modulepreloads = dedupe([
    ...(options.modulepreloads ?? []),
    ...(options.bootstrapScript ? [options.bootstrapScript] : []),
  ]);
  const stylesheets = dedupeStylesheets(options.stylesheets ?? []);
  const html = [
    ...renderRouteMeta(options.meta, context),
    ...renderI18nCatalogs(options.i18n),
    ...stylesheets.map(renderPageStylesheetHint),
    ...modulepreloads.map((href) => `<link rel="modulepreload" href="${escapeAttribute(href)}">`),
    options.bootstrapScript
      ? `<script type="module" src="${escapeAttribute(options.bootstrapScript)}"></script>`
      : '',
    renderSpeculationRules(options.prefetch ?? false, options.prerenderUrls ?? []),
  ]
    .filter(Boolean)
    .join('');

  return {
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

function renderPageStylesheetHint(asset: StylesheetAsset): string {
  const link = `<link rel="stylesheet" href="${escapeAttribute(asset.href)}">`;
  if (!asset.criticalCss) return link;

  return `<style data-jiso-critical-href="${escapeAttribute(asset.href)}">${escapeStyleText(asset.criticalCss)}</style>${link}`;
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

function renderSpeculationRules(prefetch: RoutePrefetch, urls: readonly string[]): string {
  const prerenderUrls = dedupe(urls);
  if (!prefetch || prerenderUrls.length === 0) return '';

  return `<script type="speculationrules">${escapeScriptJson(
    JSON.stringify({
      prerender: [
        {
          eagerness: prefetch,
          urls: prerenderUrls,
        },
      ],
    }),
  )}</script>`;
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

function renderI18nCatalogs(i18nInput: PageHintOptions['i18n']): string[] {
  const catalogs = Array.isArray(i18nInput) ? i18nInput : i18nInput ? [i18nInput] : [];

  return catalogs.map(
    (catalog) =>
      `<script type="application/json" fw-i18n locale="${escapeAttribute(catalog.locale)}">${escapeScriptJson(JSON.stringify(catalog.messages))}</script>`,
  );
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

function escapeScriptJson(value: string): string {
  return value.replaceAll('<', '\\u003c');
}

function escapeStyleText(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style');
}
