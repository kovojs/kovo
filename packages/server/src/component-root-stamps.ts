import type { Component } from '@kovojs/core';

import { isKovoComponentDescriptor } from './component-authority.js';
import { escapeAttribute } from './html.js';
import {
  createLiveTargetAttestationWithAuthority,
  type LiveTargetAttestationAuthority,
} from './live-target-app-identity.js';
import type { QueryDefinition } from './query.js';
import {
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityArraySort,
  securityCreateRegExp,
  securityEncodeURIComponent,
  securityJsonStringify,
  securityObjectKeys,
  securityRegExpExec,
  securityRegExpReplace,
  securityRegExpReplaceMatches,
  securityString,
  securityStringIncludes,
  securityStringReplaceAll,
  securityStringSlice,
  securityStringSplit,
  securityStringStartsWith,
  securityStringTrim,
} from './response-security-intrinsics.js';
import {
  createWitnessSet,
  createWitnessWeakSet,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakSetAdd,
  witnessWeakSetDelete,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

type StampComponent = Component<any>;

const rootOpeningPattern = securityCreateRegExp('^<([A-Za-z][A-Za-z0-9:-]*)([^>]*)>');
const tokenSeparatorPattern = securityCreateRegExp('[\\s,]+', 'g');
const regexpSyntaxPattern = securityCreateRegExp('[.*+?^${}()|[\\]\\\\]', 'g');
const attributeNamePattern = securityCreateRegExp('^[A-Za-z][A-Za-z0-9:-]*$');
const emptyStampProps = witnessFreeze(witnessCreateNullRecord<unknown>());

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
  if (!isKovoComponentDescriptor(component)) {
    throw new TypeError('assignDerivedComponentName() requires a component() descriptor.');
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('assignDerivedComponentName() requires a non-empty component name.');
  }

  const descriptor = ownDataDescriptor(component, 'name', 'Component descriptor', true);
  const currentName = descriptor?.value;
  if (typeof currentName === 'string' && currentName.length > 0 && currentName !== name) {
    throw new TypeError(
      `Cannot assign derived component name "${name}" to component already named "${currentName}".`,
    );
  }
  witnessDefineProperty(component, 'name', {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    value: name,
    writable: descriptor?.writable ?? true,
  });
  return component;
}

export interface ComponentRootStampOptions<Request = unknown> {
  attestationAuthority?: LiveTargetAttestationAuthority;
  component: StampComponent;
  componentName?: string;
  html: string;
  jsxKey?: unknown;
  props: Record<string, unknown>;
  request: Request;
  target?: string;
}

interface SnapshottedComponentRootStampOptions<Request> {
  readonly attestationAuthority: LiveTargetAttestationAuthority | undefined;
  readonly component: StampComponent;
  readonly componentName: string | undefined;
  readonly html: string;
  readonly jsxKey: unknown;
  readonly props: Readonly<Record<string, unknown>>;
  readonly request: Request;
  readonly target: string | undefined;
}

interface ComponentRootStampMetadata {
  readonly componentName: string;
  readonly deps: readonly string[];
  readonly domName: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly staleDeps: readonly string[];
  readonly target: string;
}

/** A descriptor-snapshotted opening tag consumed by post-render framework stampers. @internal */
export interface HtmlOpeningTagSnapshot {
  readonly attrs: string;
  readonly length: number;
  readonly tagName: string;
}

/** @internal Preserve SPEC §9.1 live-target identity on query-backed component roots. */
export function stampKovoComponentRoot<Request = unknown>(
  options: ComponentRootStampOptions<Request>,
): string {
  const snapshot = snapshotComponentRootStampOptions(options);
  const metadata = componentRootStampMetadata(snapshot);
  if (metadata === null) return snapshot.html;

  const opening = snapshotHtmlOpeningTag(snapshot.html);
  if (opening === undefined) return snapshot.html;

  let attrs = opening.attrs;
  if (htmlAttributeValue(attrs, 'kovo-c') === undefined) {
    attrs = setOrAppendHtmlAttribute(attrs, 'kovo-c', metadata.domName);
  }
  attrs = setOrAppendHtmlAttribute(
    attrs,
    'kovo-deps',
    joinHtmlAttributeTokens(
      mergeHtmlAttributeTokens(
        htmlAttributeValue(attrs, 'kovo-deps'),
        metadata.deps,
        metadata.staleDeps,
      ),
    ),
  );
  attrs = setOrAppendHtmlAttribute(attrs, 'kovo-fragment-target', metadata.target);
  attrs = setOrAppendHtmlAttribute(attrs, 'kovo-live-component', metadata.componentName);
  attrs = setOrAppendHtmlAttribute(
    attrs,
    'kovo-live-token',
    createLiveTargetAttestationWithAuthority(
      requiredStampAuthority(snapshot.attestationAuthority),
      {
        component: metadata.componentName,
        props: metadata.props ?? emptyStampProps,
        target: metadata.target,
      },
      snapshot.request,
    ),
  );
  if (metadata.props !== undefined) {
    const serializedProps = securityJsonStringify(metadata.props);
    if (serializedProps === undefined) {
      throw new TypeError('Component stamp props must be JSON serializable.');
    }
    attrs = setOrAppendHtmlAttribute(attrs, 'kovo-props', serializedProps);
  }

  return replaceHtmlOpeningTag(snapshot.html, opening, attrs);
}

function snapshotComponentRootStampOptions<Request>(
  options: ComponentRootStampOptions<Request>,
): SnapshottedComponentRootStampOptions<Request> {
  if (!isObjectLike(options)) {
    throw new TypeError('Component root stamp options must be an object.');
  }
  const component = ownDataValue(options, 'component', 'Component root stamp options');
  if (!isKovoComponentDescriptor(component)) {
    throw new TypeError('Component root stamps require a component() descriptor.');
  }
  const html = ownDataValue(options, 'html', 'Component root stamp options');
  if (typeof html !== 'string') {
    throw new TypeError('Component root stamp html must be a string.');
  }
  const props = ownDataValue(options, 'props', 'Component root stamp options');
  if (!isRecord(props)) {
    throw new TypeError('Component root stamp props must be an object record.');
  }
  const componentName = optionalOwnDataValue(
    options,
    'componentName',
    'Component root stamp options',
  );
  if (componentName !== undefined && typeof componentName !== 'string') {
    throw new TypeError('Component root stamp componentName must be a string.');
  }
  const target = optionalOwnDataValue(options, 'target', 'Component root stamp options');
  if (target !== undefined && typeof target !== 'string') {
    throw new TypeError('Component root stamp target must be a string.');
  }
  return witnessFreeze({
    attestationAuthority: optionalOwnDataValue(
      options,
      'attestationAuthority',
      'Component root stamp options',
    ) as LiveTargetAttestationAuthority | undefined,
    component,
    componentName,
    html,
    jsxKey: optionalOwnDataValue(options, 'jsxKey', 'Component root stamp options'),
    props: snapshotOwnRecord(props, 'Component root stamp props'),
    request: ownDataValue(options, 'request', 'Component root stamp options') as Request,
    target,
  });
}

function requiredStampAuthority(
  authority: LiveTargetAttestationAuthority | undefined,
): LiveTargetAttestationAuthority {
  if (authority === undefined) {
    throw new TypeError('Live-target component stamping requires a closed-app authority.');
  }
  return authority;
}

function componentRootStampMetadata<Request>(
  options: SnapshottedComponentRootStampOptions<Request>,
): ComponentRootStampMetadata | null {
  const definition = ownDataValue(options.component, 'definition', 'Component descriptor');
  if (!isRecord(definition)) {
    throw new TypeError('Component descriptor definition must be an object record.');
  }
  const disableServerRefresh = optionalOwnDataValue(
    definition,
    'disableServerRefresh',
    'Component definition',
  );
  if (disableServerRefresh !== undefined && typeof disableServerRefresh !== 'boolean') {
    throw new TypeError('Component disableServerRefresh metadata must be boolean.');
  }
  if (disableServerRefresh === true) return null;

  const authoredName = optionalOwnDataValue(options.component, 'name', 'Component descriptor');
  const componentName = options.componentName ?? authoredName;
  if (typeof componentName !== 'string' || componentName.length === 0) return null;

  const queryBindings = optionalOwnDataValue(definition, 'queries', 'Component definition');
  if (!isRecord(queryBindings)) return null;

  const deps: string[] = [];
  const staleDeps: string[] = [];
  const queryNames = securityObjectKeys(queryBindings);
  for (let index = 0; index < queryNames.length; index += 1) {
    const name = denseArrayDataValue(queryNames, index, 'Component query names');
    const binding = ownDataValue(queryBindings, name, 'Component query bindings');
    const queryKey = componentQueryKey(binding);
    if (queryKey === undefined) continue;
    securityArrayPush(deps, queryKey);
    if (queryKey !== name) securityArrayPush(staleDeps, name);
  }
  if (deps.length === 0) return null;

  const componentNameParts = securityStringSplit(componentName, '/');
  let domName: string | undefined;
  for (let index = 0; index < componentNameParts.length; index += 1) {
    const part = denseArrayDataValue(componentNameParts, index, 'Component name segments');
    if (part !== '') domName = part;
  }
  if (domName === undefined) return null;

  const propKeys = componentPropKeys(definition);
  const stampedProps = snapshotStampedProps(propKeys, options.props);
  const target =
    options.target ?? componentFragmentTarget(domName, options.props, stampedProps, options.jsxKey);

  return witnessFreeze({
    componentName,
    deps: witnessFreeze(deps),
    domName,
    ...(stampedProps === undefined ? {} : { props: stampedProps }),
    staleDeps: witnessFreeze(staleDeps),
    target,
  });
}

function componentFragmentTarget(
  domName: string,
  props: Readonly<Record<string, unknown>>,
  stampedProps: Readonly<Record<string, unknown>> | undefined,
  jsxKey?: unknown,
): string {
  const key = componentAuthoredKey(props, jsxKey);
  if (key !== undefined) {
    // SPEC.md §4.8/§13.2: authored `key` lowers to the shared runtime identity used by
    // inferred fragment-target instance suffixes.
    return `${domName}:${attributeText(key)}`;
  }

  const suffix =
    stampedProps === undefined ? undefined : componentPropsInstanceSuffix(stampedProps);
  return suffix === undefined ? domName : `${domName}:${suffix}`;
}

function componentAuthoredKey(props: Readonly<Record<string, unknown>>, jsxKey?: unknown): unknown {
  const kovoKey = optionalOwnDataValue(props, 'kovo-key', 'Component root stamp props');
  const key = kovoKey ?? optionalOwnDataValue(props, 'key', 'Component root stamp props') ?? jsxKey;
  return key === false || key === null || key === undefined ? undefined : key;
}

function componentPropsInstanceSuffix(
  props: Readonly<Record<string, unknown>>,
): string | undefined {
  const keys = securityObjectKeys(props);
  let visibleCount = 0;
  let singleValue: unknown;
  for (let index = 0; index < keys.length; index += 1) {
    const key = denseArrayDataValue(keys, index, 'Stamped prop keys');
    const value = ownDataValue(props, key, 'Stamped props');
    if (value === undefined) continue;
    visibleCount += 1;
    singleValue = value;
  }
  if (visibleCount === 0) return undefined;

  if (
    visibleCount === 1 &&
    (typeof singleValue === 'string' ||
      typeof singleValue === 'number' ||
      typeof singleValue === 'bigint' ||
      typeof singleValue === 'boolean')
  ) {
    return attributeText(singleValue);
  }

  const serialized = stableJsonStringify(props);
  return serialized === undefined || serialized === '{}'
    ? undefined
    : securityEncodeURIComponent(serialized);
}

function stableJsonStringify(value: unknown): string | undefined {
  const seen = createWitnessWeakSet<object>();
  const normalized = stableJsonValue(value, seen);
  return normalized === undefined ? undefined : securityJsonStringify(normalized);
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
  if (!isObjectLike(value)) return undefined;
  if (witnessWeakSetHas(seen, value)) return undefined;
  witnessWeakSetAdd(seen, value);

  try {
    if (securityArrayIsArray(value)) {
      const length = denseArrayLength(value, 'Component prop array');
      const normalized: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const item = denseArrayDataValue(value, index, 'Component prop array');
        securityArrayPush(normalized, stableJsonValue(item, seen) ?? null);
      }
      shadowInheritedToJson(normalized);
      return witnessFreeze(normalized);
    }

    const keys = securityObjectKeys(value);
    securityArraySort(keys, compareStampKeys);
    const normalized = witnessCreateNullRecord<unknown>();
    for (let index = 0; index < keys.length; index += 1) {
      const key = denseArrayDataValue(keys, index, 'Component prop object keys');
      const entryValue = ownDataValue(value, key, 'Component prop object');
      const normalizedValue = stableJsonValue(entryValue, seen);
      if (normalizedValue === undefined) continue;
      witnessDefineProperty(normalized, key, {
        configurable: false,
        enumerable: true,
        value: normalizedValue,
        writable: false,
      });
    }
    return witnessFreeze(normalized);
  } finally {
    witnessWeakSetDelete(seen, value);
  }
}

function compareStampKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function shadowInheritedToJson(value: unknown[]): void {
  witnessDefineProperty(value, 'toJSON', {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
}

function componentPropKeys(definition: Readonly<Record<string, unknown>>): string[] {
  const propDefinitions = optionalOwnDataValue(definition, 'props', 'Component definition');
  if (!isRecord(propDefinitions)) return [];
  return snapshotDenseStrings(securityObjectKeys(propDefinitions), 'Component prop metadata keys');
}

function snapshotStampedProps(
  propKeys: readonly string[],
  props: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  if (propKeys.length === 0) return undefined;
  const stamped = witnessCreateNullRecord<unknown>();
  for (let index = 0; index < propKeys.length; index += 1) {
    const key = denseArrayDataValue(propKeys, index, 'Component prop metadata keys');
    const rawValue = optionalOwnDataValue(props, key, 'Component root stamp props');
    const value = stableJsonValue(rawValue, createWitnessWeakSet<object>());
    if (value === undefined) continue;
    witnessDefineProperty(stamped, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return witnessFreeze(stamped);
}

function componentQueryKey(binding: unknown): string | undefined {
  if (isQueryDefinition(binding)) {
    return ownDataValue(binding, 'key', 'Component query definition') as string;
  }
  if (!isRecord(binding)) return undefined;
  const args = optionalOwnDataValue(binding, 'args', 'Component query args binding');
  const query = optionalOwnDataValue(binding, 'query', 'Component query args binding');
  if (typeof args !== 'function' || !isQueryDefinition(query)) return undefined;
  return ownDataValue(query, 'key', 'Component query definition') as string;
}

function isQueryDefinition(value: unknown): value is QueryDefinition {
  if (!isRecord(value)) return false;
  const key = optionalOwnDataValue(value, 'key', 'Component query definition');
  if (typeof key !== 'string') return false;
  const reads = optionalOwnDataValue(value, 'reads', 'Component query definition');
  return reads === undefined || securityArrayIsArray(reads);
}

/** @internal Snapshot the first tag without dispatching through mutable RegExp methods. */
export function snapshotHtmlOpeningTag(html: string): HtmlOpeningTagSnapshot | undefined {
  if (typeof html !== 'string') throw new TypeError('Stamped HTML must be a string.');
  const opening = securityRegExpExec(rootOpeningPattern, html);
  if (opening === null) return undefined;
  const matched = regexpMatchDataValue(opening, 0, 'Root opening tag');
  const tagName = regexpMatchDataValue(opening, 1, 'Root opening tag');
  const attrs = regexpMatchDataValue(opening, 2, 'Root opening tag');
  if (matched === undefined || tagName === undefined) return undefined;
  return witnessFreeze({ attrs: attrs ?? '', length: matched.length, tagName });
}

/** @internal Replace only the snapshotted first tag and preserve the rendered body byte-for-byte. */
export function replaceHtmlOpeningTag(
  html: string,
  opening: HtmlOpeningTagSnapshot,
  attrs: string,
): string {
  if (typeof html !== 'string' || typeof attrs !== 'string') {
    throw new TypeError('Stamped HTML opening values must be strings.');
  }
  const tagName = ownDataValue(opening, 'tagName', 'HTML opening tag snapshot');
  const length = ownDataValue(opening, 'length', 'HTML opening tag snapshot');
  if (
    typeof tagName !== 'string' ||
    typeof length !== 'number' ||
    length < 0 ||
    length > html.length ||
    length % 1 !== 0
  ) {
    throw new TypeError('HTML opening tag snapshot must contain exact tagName and length data.');
  }
  return `<${tagName}${attrs}>${securityStringSlice(html, length)}`;
}

/** @internal Read a visible HTML attribute through the pinned stamp parser. */
export function htmlAttributeValue(attrs: string, name: string): string | undefined {
  const match = securityRegExpExec(attributePattern(name), attrs);
  if (match === null) return undefined;
  return unescapeAttribute(
    regexpMatchDataValue(match, 1, `Attribute ${name}`) ??
      regexpMatchDataValue(match, 2, `Attribute ${name}`) ??
      regexpMatchDataValue(match, 3, `Attribute ${name}`) ??
      '',
  );
}

/** @internal Set one framework-owned root attribute without mutable String.replace dispatch. */
export function setOrAppendHtmlAttribute(attrs: string, name: string, value: string): string {
  if (typeof attrs !== 'string' || typeof value !== 'string') {
    throw new TypeError('Stamped HTML attributes and values must be strings.');
  }
  const rendered = `${name}="${escapeAttribute(value)}"`;
  const match = securityRegExpExec(attributePattern(name), attrs);
  if (match === null) return `${attrs} ${rendered}`;

  const matched = regexpMatchDataValue(match, 0, `Attribute ${name}`);
  const matchIndex = ownDataValue(match, 'index', `Attribute ${name} match`);
  if (matched === undefined || typeof matchIndex !== 'number' || matchIndex < 0) {
    throw new TypeError(`Attribute ${name} match was not stable.`);
  }
  const prefix = securityStringStartsWith(matched, ' ') ? ' ' : '';
  return (
    securityStringSlice(attrs, 0, matchIndex) +
    prefix +
    rendered +
    securityStringSlice(attrs, matchIndex + matched.length)
  );
}

/** @internal Merge dependency tokens with descriptor-snapshotted collection operations. */
export function mergeHtmlAttributeTokens(
  existing: string | undefined,
  additions: readonly string[],
  staleDeps: readonly string[] = [],
): string[] {
  const stale = createWitnessSet<string>();
  const staleSnapshot = snapshotDenseStrings(staleDeps, 'Stale dependency tokens');
  for (let index = 0; index < staleSnapshot.length; index += 1) {
    witnessSetAdd(stale, denseArrayDataValue(staleSnapshot, index, 'Stale dependency tokens'));
  }

  const merged: string[] = [];
  const seen = createWitnessSet<string>();
  const normalizedExisting = securityRegExpReplace(existing ?? '', tokenSeparatorPattern, ' ');
  const existingTokens = securityStringSplit(normalizedExisting, ' ');
  for (let index = 0; index < existingTokens.length; index += 1) {
    const token = securityStringTrim(
      denseArrayDataValue(existingTokens, index, 'Existing dependency tokens'),
    );
    if (
      token.length === 0 ||
      witnessSetHas(stale, token) ||
      witnessSetHas(seen, token) ||
      securityStringIncludes(token, '\0')
    ) {
      continue;
    }
    witnessSetAdd(seen, token);
    securityArrayPush(merged, token);
  }

  const additionSnapshot = snapshotDenseStrings(additions, 'Dependency tokens');
  for (let index = 0; index < additionSnapshot.length; index += 1) {
    const token = denseArrayDataValue(additionSnapshot, index, 'Dependency tokens');
    if (token.length === 0 || witnessSetHas(seen, token) || securityStringIncludes(token, '\0')) {
      continue;
    }
    witnessSetAdd(seen, token);
    securityArrayPush(merged, token);
  }
  return merged;
}

/** @internal Join a private token snapshot without mutable Array.join dispatch. */
export function joinHtmlAttributeTokens(tokens: readonly string[]): string {
  return securityArrayJoin(snapshotDenseStrings(tokens, 'HTML attribute tokens'), ' ');
}

function attributePattern(name: string): RegExp {
  if (securityRegExpExec(attributeNamePattern, name) === null) {
    throw new TypeError(`Invalid framework stamp attribute name ${securityJsonStringify(name)}.`);
  }
  return securityCreateRegExp(
    `(?:^|\\s)${escapeRegExp(name)}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` +
      '`' +
      `]+)))?(?=\\s|$|/|>)`,
    'i',
  );
}

function escapeRegExp(value: string): string {
  return securityRegExpReplaceMatches(value, regexpSyntaxPattern, (match) => {
    const syntax = regexpMatchDataValue(match, 0, 'RegExp syntax escape');
    if (syntax === undefined) throw new TypeError('RegExp syntax match was not stable.');
    return `\\${syntax}`;
  });
}

function unescapeAttribute(value: string): string {
  return securityStringReplaceAll(
    securityStringReplaceAll(
      securityStringReplaceAll(
        securityStringReplaceAll(
          securityStringReplaceAll(securityStringReplaceAll(value, '&quot;', '"'), '&#39;', "'"),
          '&apos;',
          "'",
        ),
        '&gt;',
        '>',
      ),
      '&lt;',
      '<',
    ),
    '&amp;',
    '&',
  );
}

function attributeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return securityString(value);
  const normalized = stableJsonValue(value, createWitnessWeakSet<object>());
  if (normalized === undefined) {
    throw new TypeError('Component authored keys must be JSON-serializable scalar data.');
  }
  return securityJsonStringify(normalized) ?? '';
}

function snapshotOwnRecord(
  value: Record<string, unknown>,
  label: string,
): Readonly<Record<string, unknown>> {
  const snapshot = witnessCreateNullRecord<unknown>();
  const keys = securityObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = denseArrayDataValue(keys, index, `${label} keys`);
    witnessDefineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: ownDataValue(value, key, label),
      writable: false,
    });
  }
  return witnessFreeze(snapshot);
}

function snapshotDenseStrings(value: readonly unknown[], label: string): string[] {
  if (!securityArrayIsArray(value)) throw new TypeError(`${label} must be an array.`);
  const length = denseArrayLength(value, label);
  const snapshot: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = denseArrayDataValue(value, index, label);
    if (typeof entry !== 'string') throw new TypeError(`${label} must contain only strings.`);
    securityArrayPush(snapshot, entry);
  }
  return snapshot;
}

function denseArrayLength(value: readonly unknown[], label: string): number {
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'number' ||
    descriptor.value < 0 ||
    descriptor.value % 1 !== 0
  ) {
    throw new TypeError(`${label} must expose a stable dense length.`);
  }
  return descriptor.value;
}

function denseArrayDataValue<Value>(value: readonly Value[], index: number, label: string): Value {
  const descriptor = witnessGetOwnPropertyDescriptor(value, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label} must expose stable own data entries.`);
  }
  return descriptor.value as Value;
}

function regexpMatchDataValue(
  match: RegExpExecArray,
  index: number,
  label: string,
): string | undefined {
  const descriptor = witnessGetOwnPropertyDescriptor(match, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label} must expose stable own data captures.`);
  }
  if (descriptor.value !== undefined && typeof descriptor.value !== 'string') {
    throw new TypeError(`${label} capture must be a string.`);
  }
  return descriptor.value as string | undefined;
}

function ownDataDescriptor(
  value: unknown,
  property: PropertyKey,
  label: string,
  optional = false,
): PropertyDescriptor | undefined {
  if (!isObjectLike(value)) throw new TypeError(`${label} must be an object.`);
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) {
    if (optional) return undefined;
    throw new TypeError(`${label}.${String(property)} must be an own data property.`);
  }
  if (!('value' in descriptor)) {
    throw new TypeError(`${label}.${String(property)} must be an own data property.`);
  }
  return descriptor;
}

function ownDataValue(value: unknown, property: PropertyKey, label: string): unknown {
  return ownDataDescriptor(value, property, label)!.value;
}

function optionalOwnDataValue(value: unknown, property: PropertyKey, label: string): unknown {
  return ownDataDescriptor(value, property, label, true)?.value;
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObjectLike(value) && !securityArrayIsArray(value);
}
