import { escapeAttribute, escapeHtml, escapeScriptJson } from './html.js';
import { renderStylesheetLinks, type StylesheetAsset } from './hints.js';

export interface QueryWireRenderOptions {
  /**
   * When true, the `value` is a `QueryDelta` envelope rather than a full query
   * value. Emits the boolean `delta` attribute on the wire chunk so the client
   * applies it through the update plan instead of replacing the held value whole
   * (SPEC §9.1.1).
   */
  delta?: boolean | undefined;
  key?: string | undefined;
  name: string;
  value: unknown;
  version?: number | string | undefined;
}

/** Options for `renderQueryScript`: the query `name`, its `value`, and optional instance `key`. */
export interface QueryScriptRenderOptions {
  key?: string | undefined;
  name: string;
  value: unknown;
}

export interface FragmentWireRenderOptions {
  errorBoundary?: string | undefined;
  html: string;
  mode?: 'append' | 'replace' | undefined;
  priority?: number | string | undefined;
  stylesheets?: readonly (string | StylesheetAsset)[] | undefined;
  target: string;
}

export function renderQueryWireHtml(options: QueryWireRenderOptions): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;
  const versionAttribute =
    options.version === undefined ? '' : ` version="${escapeAttribute(String(options.version))}"`;
  // Boolean attribute: presence alone signals delta mode; no value is emitted (SPEC §9.1.1).
  const deltaAttribute = options.delta === true ? ' delta' : '';

  return `<kovo-query name="${escapeAttribute(options.name)}"${keyAttribute}${versionAttribute}${deltaAttribute}>${escapeHtml(JSON.stringify(options.value))}</kovo-query>`;
}

/**
 * Serialize a query's initial value into the inline `<script type="application/json"
 * kovo-query>` tag the runtime hydrates from on first paint. Emit one per query a
 * page reads so the client store starts populated without a round-trip (SPEC §9.4).
 *
 * @param options - The query `name`, its `value`, and optional instance `key`.
 * @returns The query-script HTML string.
 * @example
 * import { renderQueryScript } from '@kovojs/server';
 *
 * const html: string = renderQueryScript({ name: 'cart', value: { count: 2 } });
 */
export function renderQueryScript(options: QueryScriptRenderOptions): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;

  return `<script type="application/json" kovo-query="${escapeAttribute(options.name)}"${keyAttribute}>${escapeScriptJson(JSON.stringify(options.value))}</script>`;
}

export function renderFragmentWireHtml(options: FragmentWireRenderOptions): string {
  const modeAttribute = options.mode === 'append' ? ' mode="append"' : '';
  const priorityAttribute =
    options.priority === undefined
      ? ''
      : ` priority="${escapeAttribute(String(options.priority))}"`;
  const errorBoundaryAttribute =
    options.errorBoundary === undefined
      ? ''
      : ` error-boundary="${escapeAttribute(options.errorBoundary)}"`;

  const html = `${renderStylesheetLinks(options.stylesheets ?? [])}${options.html}`;

  return `<kovo-fragment target="${escapeAttribute(options.target)}"${modeAttribute}${priorityAttribute}${errorBoundaryAttribute}>${html}</kovo-fragment>`;
}
