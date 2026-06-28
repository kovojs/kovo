import type { Component, ComponentDefinitionInput } from '@kovojs/core';

import type { CsrfValidationOptions } from './csrf.js';
import { escapeAttribute } from './html.js';
import { createLiveTargetAttestation } from './mutation-wire.js';
import type { QueryDefinition } from './query.js';

type StampComponent = Component<ComponentDefinitionInput>;

/**
 * @internal Compiler-emitted/generated ABI for SPEC §4.1/§4.8 source-derived component identity.
 *
 * Runtime-only `component({ ... })` cannot know the source module path or binding. Generated
 * modules call this before rendering so SSR refresh stamps and live-target tokens carry the same
 * stable identity as fully compiled component modules.
 */
export function assignDerivedComponentName<ComponentType extends StampComponent>(
  component: ComponentType,
  name: string,
): ComponentType {
  if (!name) {
    throw new TypeError('assignDerivedComponentName() requires a non-empty component name.');
  }
  if (typeof component.name === 'string' && component.name.length > 0 && component.name !== name) {
    throw new TypeError(
      `Cannot assign derived component name "${name}" to component already named "${component.name}".`,
    );
  }
  component.name = name;
  return component;
}

export interface ComponentRootStampOptions<Request = unknown> {
  component: StampComponent;
  componentName?: string;
  csrf?: CsrfValidationOptions<Request>;
  html: string;
  jsxKey?: unknown;
  props: Record<string, unknown>;
  request: Request;
  target?: string;
}

/** @internal Preserve SPEC §9.1 live-target identity on query-backed component roots. */
export function stampKovoComponentRoot<Request = unknown>(
  options: ComponentRootStampOptions<Request>,
): string {
  const metadata = componentRootStampMetadata(options);
  if (!metadata) return options.html;

  const opening = /^<([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/.exec(options.html);
  if (!opening) return options.html;

  const tagName = opening[1];
  if (tagName === undefined) return options.html;
  let attrs = opening[2] ?? '';
  if (attributeValue(attrs, 'kovo-c') === undefined) {
    attrs = setOrAppendAttribute(attrs, 'kovo-c', metadata.domName);
  }
  attrs = setOrAppendAttribute(
    attrs,
    'kovo-deps',
    mergeAttributeTokens(
      attributeValue(attrs, 'kovo-deps'),
      metadata.deps,
      metadata.staleDeps,
    ).join(' '),
  );
  attrs = setOrAppendAttribute(attrs, 'kovo-fragment-target', metadata.target);
  attrs = setOrAppendAttribute(attrs, 'kovo-live-component', metadata.componentName);
  attrs = setOrAppendAttribute(
    attrs,
    'kovo-live-token',
    createLiveTargetAttestation(
      { component: metadata.componentName, props: metadata.props ?? {}, target: metadata.target },
      {
        ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
        request: options.request,
      },
    ),
  );
  if (metadata.props !== undefined) {
    attrs = setOrAppendAttribute(attrs, 'kovo-props', JSON.stringify(metadata.props));
  }

  return `<${tagName}${attrs}>${options.html.slice(opening[0].length)}`;
}

function componentRootStampMetadata<Request>(options: ComponentRootStampOptions<Request>): {
  componentName: string;
  deps: string[];
  domName: string;
  props?: Record<string, unknown>;
  staleDeps: string[];
  target: string;
} | null {
  if (options.component.definition.disableServerRefresh) return null;

  const componentName = options.componentName ?? options.component.name;
  if (typeof componentName !== 'string' || componentName.length === 0) return null;
  if (!isRecord(options.component.definition.queries)) return null;

  const deps: string[] = [];
  const staleDeps: string[] = [];
  for (const [name, binding] of Object.entries(options.component.definition.queries)) {
    const query = componentQueryDefinition(binding);
    if (!query) continue;
    deps.push(query.key);
    if (query.key !== name) staleDeps.push(name);
  }
  if (deps.length === 0) return null;

  const domName = componentName.split('/').filter(Boolean).at(-1);
  if (!domName) return null;

  const propKeys = componentPropKeys(options.component);
  const stampedProps =
    propKeys.length === 0
      ? undefined
      : Object.fromEntries(propKeys.map((key) => [key, options.props[key]]));
  const target =
    options.target ?? componentFragmentTarget(domName, options.props, stampedProps, options.jsxKey);

  return {
    componentName,
    deps,
    domName,
    ...(stampedProps === undefined ? {} : { props: stampedProps }),
    staleDeps,
    target,
  };
}

function componentFragmentTarget(
  domName: string,
  props: Record<string, unknown>,
  stampedProps: Record<string, unknown> | undefined,
  jsxKey?: unknown,
): string {
  const key = componentAuthoredKey(props, jsxKey);
  if (key !== undefined) {
    // SPEC.md §4.8/§13.2: authored `key` lowers to the shared runtime identity
    // used by inferred fragment-target instance suffixes.
    return `${domName}:${attributeText(key)}`;
  }

  const suffix =
    stampedProps === undefined ? undefined : componentPropsInstanceSuffix(stampedProps);
  return suffix === undefined ? domName : `${domName}:${suffix}`;
}

function componentAuthoredKey(props: Record<string, unknown>, jsxKey?: unknown): unknown {
  const key = props['kovo-key'] ?? props.key ?? jsxKey;
  return key === false || key === null || key === undefined ? undefined : key;
}

function componentPropsInstanceSuffix(props: Record<string, unknown>): string | undefined {
  const entries = Object.entries(props).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return undefined;

  if (entries.length === 1) {
    const [, value] = entries[0]!;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean'
    ) {
      return attributeText(value);
    }
  }

  const serialized = stableJsonStringify(props);
  return serialized === undefined || serialized === '{}'
    ? undefined
    : encodeURIComponent(serialized);
}

function stableJsonStringify(value: unknown): string | undefined {
  const seen = new WeakSet<object>();
  const normalized = stableJsonValue(value, seen);
  return normalized === undefined ? undefined : JSON.stringify(normalized);
}

function stableJsonValue(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item, seen) ?? null);
  }
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entryValue]) => [key, stableJsonValue(entryValue, seen)] as const)
    .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  seen.delete(value);
  return Object.fromEntries(entries);
}

function componentPropKeys(component: StampComponent): string[] {
  const propDefinitions = (component.definition as { props?: unknown }).props;
  if (!isRecord(propDefinitions)) return [];
  return Object.keys(propDefinitions);
}

function componentQueryDefinition(binding: unknown): QueryDefinition | undefined {
  if (isQueryDefinition(binding)) return binding;
  if (isQueryArgsBinding(binding)) return binding.query;
  return undefined;
}

function isQueryDefinition(value: unknown): value is QueryDefinition {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    (value.reads === undefined || Array.isArray(value.reads))
  );
}

function isQueryArgsBinding(
  value: unknown,
): value is { args: (props: Record<string, unknown>) => unknown; query: QueryDefinition } {
  return isRecord(value) && typeof value.args === 'function' && isQueryDefinition(value.query);
}

function mergeAttributeTokens(
  existing: string | undefined,
  additions: readonly string[],
  staleDeps: readonly string[] = [],
): string[] {
  const stale = new Set(staleDeps);
  return [
    ...new Set([
      ...(existing ?? '')
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter(
          // SPEC §4.1/§10.2: source-derived query keys are the browser-visible dependency tokens.
          // Discard stale local component query property names and fail-closed sentinels that can
          // appear in direct TSX tests before compiler lowering has canonicalized root stamps.
          (token) => token.length > 0 && !stale.has(token) && !token.includes('\0'),
        ),
      ...additions,
    ]),
  ];
}

function attributeValue(attrs: string, name: string): string | undefined {
  const match = attributePattern(name).exec(attrs);
  return match ? unescapeAttribute(match[1] ?? match[2] ?? match[3] ?? '') : undefined;
}

function setOrAppendAttribute(attrs: string, name: string, value: string): string {
  const rendered = `${name}="${escapeAttribute(value)}"`;
  const pattern = attributePattern(name);
  if (pattern.test(attrs)) {
    return attrs.replace(pattern, (match) => `${match.startsWith(' ') ? ' ' : ''}${rendered}`);
  }
  return `${attrs} ${rendered}`;
}

function attributePattern(name: string): RegExp {
  return new RegExp(
    `(?:^|\\s)${escapeRegExp(name)}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` +
      '`' +
      `]+)))?(?=\\s|$|/|>)`,
    'i',
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function attributeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();

  return JSON.stringify(value) ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
