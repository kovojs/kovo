import type { QueryDefinition, QueryResult } from './query.js';
import type { I18nCatalog, RouteMeta, RouteMetaFactory } from './hints.js';

/**
 * Declare static document metadata (title, description, image) for a route's
 * head. Pass the result as a route's `meta` (SPEC §6.4).
 *
 * @param definition - The route metadata fields.
 * @returns The same `RouteMeta`, typed.
 * @example
 * import { meta } from '@kovojs/server';
 *
 * export const homeMeta = meta({
 *   title: 'Kovo Shop',
 *   description: 'Fresh coffee gear.',
 * });
 */
export function meta<const Meta extends RouteMeta>(definition: Meta): Meta {
  return definition;
}

/**
 * Derive route metadata from a query's loaded value, so the document head
 * reflects the same data the page rendered. Returns a deferred meta factory when
 * given just a derive function, or resolved meta when given the value directly
 * (SPEC §6.4).
 *
 * @param queryDefinition - The query whose result drives the metadata.
 * @param derive - Maps the query's value to `RouteMeta`.
 * @returns A `RouteMetaFactory` (deferred) or resolved `RouteMeta`.
 */
export function metaFromQuery<const Query extends QueryDefinition, const Meta extends RouteMeta>(
  queryDefinition: Query,
  derive: (value: QueryResult<Query>) => Meta,
): RouteMetaFactory;
export function metaFromQuery<
  const Query extends { load?: (input: never) => unknown },
  const Meta extends RouteMeta,
>(_query: Query, value: QueryResult<Query>, derive: (value: QueryResult<Query>) => Meta): Meta;
export function metaFromQuery<
  const Query extends { key?: string; load?: (input: never) => unknown },
  const Meta extends RouteMeta,
>(
  queryDefinition: Query,
  valueOrDerive: QueryResult<Query> | ((value: QueryResult<Query>) => Meta),
  maybeDerive?: (value: QueryResult<Query>) => Meta,
): Meta | RouteMetaFactory {
  if (typeof valueOrDerive === 'function') {
    const key = queryDefinition.key;
    const derive = valueOrDerive as (value: QueryResult<Query>) => Meta;
    if (!key) throw new Error('metaFromQuery requires a query key for deferred meta');

    return {
      queries: [key],
      resolve(values) {
        const value = values[key] as QueryResult<Query>;
        return derive(value);
      },
    };
  }

  if (!maybeDerive) throw new Error('metaFromQuery requires a derive function');
  return maybeDerive(valueOrDerive);
}

/**
 * Declare a typed message catalog for one locale. Look messages up with `t`,
 * which type-checks keys against this catalog. i18n stays server-rendered
 * (SPEC §13.5).
 *
 * @param locale - The catalog's locale tag (e.g. `'en'`).
 * @param messages - A map of message keys to template strings (`{name}` placeholders).
 * @returns An `I18nCatalog`.
 * @example
 * import { i18n, t } from '@kovojs/server';
 *
 * const en = i18n('en', { greeting: 'Hello, {name}!' });
 * const text: string = t(en, 'greeting', { name: 'Sam' });
 */
export function i18n<const Messages extends Record<string, string>>(
  locale: string,
  messages: Messages,
): I18nCatalog<Messages> {
  return { locale, messages };
}

/**
 * Resolve a message from an i18n catalog, substituting `{name}` placeholders.
 * The `key` is type-checked against the catalog's messages (SPEC §13.5).
 *
 * @param catalog - The catalog to read from.
 * @param key - A message key present in the catalog.
 * @param values - Placeholder substitutions.
 * @returns The resolved, substituted message string.
 */
export function t<
  Messages extends Record<string, string>,
  Key extends Extract<keyof Messages, string>,
>(catalog: I18nCatalog<Messages>, key: Key, values: Record<string, string | number> = {}): string {
  const message = catalog.messages[key];
  if (message === undefined) throw new Error(`Missing i18n message: ${key}`);

  // SPEC.md §13.5 keeps i18n server-rendered and legible; substitutions stay string-only here.
  return message.replace(/\{(?<name>[A-Za-z0-9_]+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
