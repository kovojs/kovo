import { escapeAttribute, escapeHtml, escapeScriptJson } from './html.js';
import { renderStylesheetLinks, type StylesheetAsset } from './hints.js';

export interface QueryWireRenderOptions {
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

  return `<fw-query name="${escapeAttribute(options.name)}"${keyAttribute}${versionAttribute}>${escapeHtml(JSON.stringify(options.value))}</fw-query>`;
}

/**
 * Serialize a query's initial value into the inline `<script type="application/json"
 * fw-query>` tag the runtime hydrates from on first paint. Emit one per query a
 * page reads so the client store starts populated without a round-trip (SPEC §9.4).
 *
 * @param options - The query `name`, its `value`, and optional instance `key`.
 * @returns The query-script HTML string.
 * @example
 * import { renderQueryScript } from '@jiso/server';
 *
 * const html: string = renderQueryScript({ name: 'cart', value: { count: 2 } });
 */
export function renderQueryScript(options: QueryScriptRenderOptions): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;

  return `<script type="application/json" fw-query="${escapeAttribute(options.name)}"${keyAttribute}>${escapeScriptJson(JSON.stringify(options.value))}</script>`;
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

  return `<fw-fragment target="${escapeAttribute(options.target)}"${modeAttribute}${priorityAttribute}${errorBoundaryAttribute}>${html}</fw-fragment>`;
}
