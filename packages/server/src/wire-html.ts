import type { QueryDelta, QueryListDelta } from '@kovojs/core/internal/query-delta';
import { stringifyWireValue as stringifyKovoWireValue } from '@kovojs/core/internal/wire-json';

import { escapeAttribute, escapeHtml, escapeScriptJson } from './html.js';
import { renderStylesheetLinks, type StylesheetAsset } from './hints.js';

export {
  KOVO_WIRE_TAG,
  jsonSafeWireValue,
  stringifyWireValue,
} from '@kovojs/core/internal/wire-json';

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

/**
 * Options for `renderQueryScript`: the query `name`, its `value`, and optional instance `key`.
 * @internal
 */
export interface QueryScriptRenderOptions {
  key?: string | undefined;
  name: string;
  value: unknown;
}

export interface FragmentWireRenderOptions {
  errorBoundary?: string | undefined;
  html: string;
  /**
   * Patch mode for the `<kovo-fragment>` chunk (SPEC §9.3). `'append'` adds the
   * rows to the END of the target (pagination "load more", streams); `'prepend'`
   * inserts them at the START (chat "load older") with a framework scroll-anchor
   * guarantee on the browser apply side; `'replace'` (default) DOM-morphs the
   * target whole. `'append'`/`'prepend'` keyed rows dedupe by `kovo-key` (§13.2).
   */
  mode?: 'append' | 'prepend' | 'replace' | undefined;
  priority?: number | string | undefined;
  stylesheets?: readonly (string | StylesheetAsset)[] | undefined;
  target: string;
}

export interface TextWireRenderOptions {
  mode?: 'append' | 'checkpoint' | undefined;
  target: string;
  text: string;
}

export interface DoneWireRenderOptions {
  reason?: string | undefined;
}

export function renderQueryWireHtml(options: QueryWireRenderOptions): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;
  const versionAttribute =
    options.version === undefined ? '' : ` version="${escapeAttribute(String(options.version))}"`;
  // Boolean attribute: presence alone signals delta mode; no value is emitted (SPEC §9.1.1).
  const deltaAttribute = options.delta === true ? ' delta' : '';

  return `<kovo-query name="${escapeAttribute(options.name)}"${keyAttribute}${versionAttribute}${deltaAttribute}>${escapeHtml(stringifyKovoWireValue(options.value))}</kovo-query>`;
}

/**
 * Options for {@link renderQueryPageWireHtml}: the read-side pagination page
 * emitter (SPEC §9.1.1/§9.3). Identifies the held query instance (`name`/`key`),
 * the keyed collection `path` and its `keyField` (the row `kovo-key`, §4.8), the
 * page `rows`, and whether the page `prepend`s (load-older) instead of appends.
 * @internal
 */
export interface QueryPageWireRenderOptions {
  key?: string | undefined;
  keyField: string;
  /** When true, new rows land at the FRONT of the held list (load-older); default appends. */
  mode?: 'append' | 'prepend' | undefined;
  name: string;
  path: string;
  /** Key values whose rows this page drops from the held list (rare; usually empty). */
  removed?: readonly string[] | undefined;
  rows: readonly unknown[];
}

/**
 * Render one read-side pagination page as a keyed-delta `<kovo-query … delta>`
 * chunk so the page ACCUMULATES into the SAME held query instance instead of
 * replacing it (SPEC §9.1.1, §9.3). A "load more" / "load older" fetch ships ONLY
 * the new page's keyed rows under `lists.<path>.upsert` (matched/deduped by
 * `keyField` per §13.2); the client merges them into its held collection via the
 * delta deep-merge, so prior rows are never re-shipped or duplicated. `mode:
 * 'prepend'` flags the list delta so new rows insert at the FRONT of the held
 * array (the data-side companion to the §9.3 `mode="prepend"` DOM patch).
 *
 * @internal Exported for in-repo consumers and compiler-emitted pagination code,
 * not app authors. Pairs with the §9.3 `<kovo-fragment mode="append|prepend">`
 * DOM patch: this updates the held query truth; the fragment updates the DOM.
 */
export function renderQueryPageWireHtml(options: QueryPageWireRenderOptions): string {
  const listDelta: QueryListDelta = {
    key: options.keyField,
    ...(options.rows.length > 0
      ? { upsert: options.rows as NonNullable<QueryListDelta['upsert']> }
      : {}),
    ...(options.removed && options.removed.length > 0 ? { remove: options.removed } : {}),
    ...(options.mode === 'prepend' ? { prepend: true } : {}),
  };
  const delta: QueryDelta = { lists: { [options.path]: listDelta } };

  return renderQueryWireHtml({
    delta: true,
    ...(options.key === undefined ? {} : { key: options.key }),
    name: options.name,
    value: delta,
  });
}

/**
 * Serialize a query's initial value into the inline `<script type="application/json"
 * kovo-query>` tag the runtime hydrates from on first paint. Emit one per query a
 * page reads so the client store starts populated without a round-trip (SPEC §9.4).
 *
 * @param options - The query `name`, its `value`, and optional instance `key`.
 * @returns The query-script HTML string.
 * @internal
 * @example
 * import { renderQueryScript } from '@kovojs/server/internal/html';
 *
 * const html: string = renderQueryScript({ name: 'cart', value: { count: 2 } });
 */
export function renderQueryScript(options: QueryScriptRenderOptions): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;

  return `<script type="application/json" kovo-query="${escapeAttribute(options.name)}"${keyAttribute}>${escapeScriptJson(stringifyKovoWireValue(options.value))}</script>`;
}

export function renderFragmentWireHtml(options: FragmentWireRenderOptions): string {
  // SPEC §9.3: only the explicit append/prepend vocabularies emit a `mode`
  // attribute; the default (replace) is the bare element the browser DOM-morphs.
  const modeAttribute =
    options.mode === 'append' || options.mode === 'prepend' ? ` mode="${options.mode}"` : '';
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

export function renderTextWireHtml(options: TextWireRenderOptions): string {
  const modeAttribute =
    options.mode === undefined || options.mode === 'append' ? '' : ' mode="checkpoint"';

  return `<kovo-text target="${escapeAttribute(options.target)}"${modeAttribute}>${escapeHtml(options.text)}</kovo-text>`;
}

export function renderDoneWireHtml(options: DoneWireRenderOptions = {}): string {
  const reasonAttribute =
    options.reason === undefined ? '' : ` reason="${escapeAttribute(options.reason)}"`;

  return `<kovo-done${reasonAttribute}></kovo-done>`;
}
