import type { QueryDefinition, QueryResult } from './query.js';
import type { I18nCatalog, RouteMeta, RouteMetaFactory } from './hints.js';

export function meta<const Meta extends RouteMeta>(definition: Meta): Meta {
  return definition;
}

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

export function i18n<const Messages extends Record<string, string>>(
  locale: string,
  messages: Messages,
): I18nCatalog<Messages> {
  return { locale, messages };
}

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
