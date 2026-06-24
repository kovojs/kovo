import { escapeAttribute, escapeHtml, escapeScriptJson } from './html.js';
import { renderStylesheetLinks, type StylesheetAsset } from './hints.js';

/**
 * The discriminator key for the canonical wire codec's tagged forms (SPEC §4.1
 * JsonValue boundary). A query/transform result column may infer a non-JSON
 * runtime type — `bigint` (Drizzle `bigint`/`numeric` arrives as a JS `bigint`)
 * or `Date` (SPEC §10.2:1018 `timestamp`/`date` columns) — that `JSON.stringify`
 * cannot serialize losslessly: a `bigint` THROWS (taking out the whole `/_q`
 * read and the §9.4:895 private-cache posture — bugs-part4 L3/L4), and a `Date`
 * silently degrades to an ISO string while the inferred type stays `Date`, so
 * `.getTime()` etc. break on the client (bugs-part4 L5).
 *
 * The codec normalizes these at the single `JSON.stringify` encode seam shared by
 * every query-value emitter (`renderQueryWireHtml`, `renderQueryScript`, and the
 * document bootstrap script in `document-core.ts`) into a tagged object the
 * browser reviver (`packages/browser/src/json.ts`) reconstructs. The literal
 * value MUST stay in sync with `KOVO_WIRE_TAG` in `packages/browser/src/json.ts`.
 */
export const KOVO_WIRE_TAG = '$kovo' as const;

/**
 * Recursively normalize a value into a `JSON.stringify`-safe shape at the wire
 * encode seam (SPEC §4.1). `bigint` → `{ [$kovo]: 'bigint', value: '<digits>' }`;
 * `Date` → `{ [$kovo]: 'date', value: '<ISO>' }`. Plain objects/arrays are walked;
 * scalars pass through. This guarantees `JSON.stringify(jsonSafeWireValue(v))`
 * never throws on a `bigint` and never silently loses a `Date`'s type, and the
 * matching reviver round-trips both back to `bigint`/`Date` on the client.
 */
export function jsonSafeWireValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { [KOVO_WIRE_TAG]: 'bigint', value: value.toString() };
  }
  if (value instanceof Date) {
    // An invalid Date has no ISO form; emit null so stringify never throws.
    const iso = Number.isNaN(value.getTime()) ? null : value.toISOString();
    return { [KOVO_WIRE_TAG]: 'date', value: iso };
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafeWireValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = jsonSafeWireValue(item);
    }
    return out;
  }
  return value;
}

/**
 * `JSON.stringify` at the wire encode seam, after normalizing unserializable
 * values (bigint/Date) into the canonical tagged codec (SPEC §4.1). Every
 * query-value emitter routes through here so a `bigint` column never throws
 * (bugs-part4 L3/L4) and a `Date` column round-trips as a `Date` (bugs-part4 L5).
 */
export function stringifyWireValue(value: unknown): string {
  return JSON.stringify(jsonSafeWireValue(value));
}

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
  version?: number | string | undefined;
}

export interface FragmentWireRenderOptions {
  errorBoundary?: string | undefined;
  html: string;
  mode?: 'append' | 'replace' | undefined;
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
  errorId?: string | undefined;
  reason?: string | undefined;
}

export function renderQueryWireHtml(options: QueryWireRenderOptions): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;
  const versionAttribute =
    options.version === undefined ? '' : ` version="${escapeAttribute(String(options.version))}"`;
  // Boolean attribute: presence alone signals delta mode; no value is emitted (SPEC §9.1.1).
  const deltaAttribute = options.delta === true ? ' delta' : '';

  return `<kovo-query name="${escapeAttribute(options.name)}"${keyAttribute}${versionAttribute}${deltaAttribute}>${escapeHtml(stringifyWireValue(options.value))}</kovo-query>`;
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
  const versionAttribute =
    options.version === undefined ? '' : ` version="${escapeAttribute(String(options.version))}"`;

  return `<script type="application/json" kovo-query="${escapeAttribute(options.name)}"${keyAttribute}${versionAttribute}>${escapeScriptJson(stringifyWireValue(options.value))}</script>`;
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

export function renderTextWireHtml(options: TextWireRenderOptions): string {
  const modeAttribute =
    options.mode === undefined || options.mode === 'append' ? '' : ' mode="checkpoint"';

  return `<kovo-text target="${escapeAttribute(options.target)}"${modeAttribute}>${escapeHtml(options.text)}</kovo-text>`;
}

export function renderDoneWireHtml(options: DoneWireRenderOptions = {}): string {
  const errorAttribute =
    options.errorId === undefined ? '' : ` error-id="${escapeAttribute(options.errorId)}"`;
  const reasonAttribute =
    options.reason === undefined ? '' : ` reason="${escapeAttribute(options.reason)}"`;

  return `<kovo-done${reasonAttribute}${errorAttribute}></kovo-done>`;
}
