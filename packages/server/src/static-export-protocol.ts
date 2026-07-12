export interface StaticExportHtmlAttributeRef {
  name: string;
  value: string;
}

export interface StaticExportOpeningTag {
  attributes: string;
  end: number;
  name: string;
  start: number;
}

export interface StaticExportServerEndpointRef extends StaticExportHtmlAttributeRef {
  path: string;
  phase: 'mutation' | 'query';
}

export type StaticExportClientModuleRefSource =
  | 'event-handler'
  | 'module-script'
  | 'modulepreload-link';

export interface StaticExportClientModuleRef extends StaticExportHtmlAttributeRef {
  href: string;
  source: StaticExportClientModuleRefSource;
}

export type StaticExportDeferredMarkerKind = 'boundary' | 'defer' | 'fragment';

export interface StaticExportDeferredMarker {
  kind: StaticExportDeferredMarkerKind;
  target?: string;
  value: string;
}

export type StaticExportQueryScriptKind = 'kovo-query-element' | 'script-attribute';

export interface StaticExportQueryScript {
  key?: string;
  kind: StaticExportQueryScriptKind;
  name?: string;
}

export interface StaticExportMutationForm {
  action?: string;
  dataMutation?: string;
  endpoint?: StaticExportServerEndpointRef;
  method: string;
  stream: boolean;
}

export type StaticExportServerOnlyProtocolMarker =
  | {
      endpoint: StaticExportServerEndpointRef;
      kind: 'server-endpoint';
    }
  | {
      deferred: StaticExportDeferredMarker;
      kind: 'deferred-marker';
    };

export interface StaticExportDocumentProtocol {
  clientModuleRefs: readonly StaticExportClientModuleRef[];
  deferredMarkers: readonly StaticExportDeferredMarker[];
  endpointRefs: readonly StaticExportServerEndpointRef[];
  mutationForms: readonly StaticExportMutationForm[];
  queryScripts: readonly StaticExportQueryScript[];
  serverOnlyMarkers: readonly StaticExportServerOnlyProtocolMarker[];
}

const STATIC_EXPORT_SERVER_ENDPOINT_ATTRIBUTES = securityStringSet([
  'action',
  'formaction',
  'href',
  'src',
]);
const STATIC_EXPORT_RAW_TEXT_ELEMENTS = securityStringSet(['script', 'style', 'textarea', 'title']);
const STATIC_EXPORT_PROTOCOL_BODY_SKIP_ELEMENTS = securityStringSet([
  'script',
  'style',
  'textarea',
  'title',
  'pre',
  'template',
]);
const STATIC_EXPORT_DEFERRED_BOUNDARY_MARKER = '--kovo-boundary';

function securityStringSet(values: readonly string[]): Set<string> {
  const set = createSecuritySet<string>();
  for (let index = 0; index < values.length; index += 1) securitySetAdd(set, values[index]!);
  return set;
}

export function scanStaticExportDocumentProtocol(
  html: string,
  origin: string,
): StaticExportDocumentProtocol {
  const clientModuleRefs: StaticExportClientModuleRef[] = [];
  const deferredMarkers: StaticExportDeferredMarker[] = [];
  const endpointRefs: StaticExportServerEndpointRef[] = [];
  const mutationForms: StaticExportMutationForm[] = [];
  const queryScripts: StaticExportQueryScript[] = [];

  let offset = 0;
  while (offset < html.length) {
    const start = securityStringIndexOf(html, '<', offset);
    if (start === -1) {
      collectStaticExportDeferredBoundaryMarkers(
        securityStringSlice(html, offset),
        deferredMarkers,
      );
      break;
    }

    collectStaticExportDeferredBoundaryMarkers(
      securityStringSlice(html, offset, start),
      deferredMarkers,
    );

    const skippedMarkupEnd = readStaticExportSkippedMarkupEnd(html, start);
    if (skippedMarkupEnd !== undefined) {
      offset = skippedMarkupEnd;
      continue;
    }

    const tag = readStaticExportOpeningTag(html, start);
    if (tag === undefined) {
      offset = start + 1;
      continue;
    }

    const refs = readStaticExportHtmlAttributeRefs(tag.attributes);
    const attrs = staticExportAttributeMap(refs);

    for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
      const ref = refs[refIndex]!;
      const endpoint = staticExportServerEndpointRef(ref, origin);
      if (endpoint !== undefined) securityArrayPush(endpointRefs, endpoint);

      if (securityStringStartsWith(ref.name, 'on:')) {
        collectStaticExportClientModuleRefsFromTokens(
          ref,
          origin,
          'event-handler',
          clientModuleRefs,
        );
      }
    }

    collectStaticExportElementProtocol({
      attrs,
      clientModuleRefs,
      deferredMarkers,
      mutationForms,
      origin,
      queryScripts,
      refs,
      tag,
    });

    offset = readStaticExportProtocolElementBodyEnd(html, tag) ?? tag.end;
  }

  const serverOnlyMarkers: StaticExportServerOnlyProtocolMarker[] = [];
  for (let index = 0; index < endpointRefs.length; index += 1) {
    securityArrayPush(serverOnlyMarkers, {
      endpoint: endpointRefs[index]!,
      kind: 'server-endpoint',
    });
  }
  for (let index = 0; index < deferredMarkers.length; index += 1) {
    securityArrayPush(serverOnlyMarkers, {
      deferred: deferredMarkers[index]!,
      kind: 'deferred-marker',
    });
  }

  return {
    clientModuleRefs,
    deferredMarkers,
    endpointRefs,
    mutationForms,
    queryScripts,
    serverOnlyMarkers,
  };
}

function collectStaticExportElementProtocol(options: {
  attrs: Map<string, string>;
  clientModuleRefs: StaticExportClientModuleRef[];
  deferredMarkers: StaticExportDeferredMarker[];
  mutationForms: StaticExportMutationForm[];
  origin: string;
  queryScripts: StaticExportQueryScript[];
  refs: readonly StaticExportHtmlAttributeRef[];
  tag: StaticExportOpeningTag;
}): void {
  const {
    attrs,
    clientModuleRefs,
    deferredMarkers,
    mutationForms,
    origin,
    queryScripts,
    refs,
    tag,
  } = options;

  if (tag.name === 'script' && isStaticExportModuleScript(attrs)) {
    const src = staticExportAttributeRef(refs, 'src');
    if (src !== undefined) {
      collectStaticExportClientModuleRef(src, origin, 'module-script', clientModuleRefs);
    }
  }

  if (
    tag.name === 'link' &&
    stringArrayContains(staticExportRelTokens(securityMapGet(attrs, 'rel')), 'modulepreload')
  ) {
    const href = staticExportAttributeRef(refs, 'href');
    if (href !== undefined) {
      collectStaticExportClientModuleRef(href, origin, 'modulepreload-link', clientModuleRefs);
    }
  }

  if (tag.name === 'kovo-defer') {
    const target = securityMapGet(attrs, 'target');
    securityArrayPush(deferredMarkers, {
      kind: 'defer',
      ...(target === undefined ? {} : { target }),
      value: 'kovo-defer',
    });
  } else if (tag.name === 'kovo-fragment') {
    const target = securityMapGet(attrs, 'target');
    securityArrayPush(deferredMarkers, {
      kind: 'fragment',
      ...(target === undefined ? {} : { target }),
      value: 'kovo-fragment',
    });
  }

  const queryScript = staticExportQueryScript(tag.name, attrs);
  if (queryScript !== undefined) securityArrayPush(queryScripts, queryScript);

  const mutationForm = staticExportMutationForm(tag.name, attrs, refs, origin);
  if (mutationForm !== undefined) securityArrayPush(mutationForms, mutationForm);
}

function collectStaticExportDeferredBoundaryMarkers(
  text: string,
  markers: StaticExportDeferredMarker[],
): void {
  if (!securityStringIncludes(text, STATIC_EXPORT_DEFERRED_BOUNDARY_MARKER)) return;
  securityArrayPush(markers, {
    kind: 'boundary',
    value: STATIC_EXPORT_DEFERRED_BOUNDARY_MARKER,
  });
}

function staticExportQueryScript(
  tagName: string,
  attrs: Map<string, string>,
): StaticExportQueryScript | undefined {
  if (tagName === 'kovo-query') {
    const key = securityMapGet(attrs, 'key');
    const name = securityMapGet(attrs, 'name');
    return {
      ...(key === undefined ? {} : { key }),
      kind: 'kovo-query-element',
      ...(name === undefined ? {} : { name }),
    };
  }

  if (tagName !== 'script' || !securityMapHas(attrs, 'kovo-query')) return undefined;

  const key = securityMapGet(attrs, 'key');
  const name = securityMapGet(attrs, 'kovo-query');
  return {
    ...(key === undefined ? {} : { key }),
    kind: 'script-attribute',
    ...(name === undefined || name === '' ? {} : { name }),
  };
}

function staticExportMutationForm(
  tagName: string,
  attrs: Map<string, string>,
  refs: readonly StaticExportHtmlAttributeRef[],
  origin: string,
): StaticExportMutationForm | undefined {
  if (tagName !== 'form') return undefined;

  const action = staticExportAttributeRef(refs, 'action');
  const endpoint = action === undefined ? undefined : staticExportServerEndpointRef(action, origin);
  const dataMutation = securityMapGet(attrs, 'data-mutation');
  const streamValue = securityMapGet(attrs, 'data-mutation-stream');
  const stream =
    streamValue !== undefined &&
    securityStringToLowerCase(securityStringTrim(streamValue)) !== 'false';

  if (endpoint?.phase !== 'mutation' && dataMutation === undefined && !stream) {
    return undefined;
  }

  return {
    ...(action === undefined ? {} : { action: action.value }),
    ...(dataMutation === undefined ? {} : { dataMutation }),
    ...(endpoint?.phase === 'mutation' ? { endpoint } : {}),
    method:
      securityStringToLowerCase(securityStringTrim(securityMapGet(attrs, 'method') ?? '')) || 'get',
    stream,
  };
}

function staticExportServerEndpointRef(
  ref: StaticExportHtmlAttributeRef,
  origin: string,
): StaticExportServerEndpointRef | undefined {
  if (!securitySetHas(STATIC_EXPORT_SERVER_ENDPOINT_ATTRIBUTES, ref.name)) return undefined;

  const url = staticExportUrlFromAttributeValue(ref.value, origin);
  if (url === undefined || url.origin !== securityUrlSnapshot(origin).origin) return undefined;

  const phase = staticExportServerEndpointPhase(url.pathname);
  if (phase === undefined) return undefined;

  return { ...ref, path: url.pathname, phase };
}

function collectStaticExportClientModuleRefsFromTokens(
  ref: StaticExportHtmlAttributeRef,
  origin: string,
  source: StaticExportClientModuleRefSource,
  refs: StaticExportClientModuleRef[],
): void {
  const normalizedTokens = staticExportWhitespaceTokens(ref.value);
  // Handler ref tokens use HTML whitespace, so reuse the scanner's pinned tokenizer rather than
  // live RegExp/String splitting.
  for (let index = 0; index < normalizedTokens.length; index += 1) {
    collectStaticExportClientModuleRef(
      { ...ref, value: normalizedTokens[index]! },
      origin,
      source,
      refs,
    );
  }
}

function collectStaticExportClientModuleRef(
  ref: StaticExportHtmlAttributeRef,
  origin: string,
  source: StaticExportClientModuleRefSource,
  refs: StaticExportClientModuleRef[],
): void {
  const href = staticExportClientModuleHref(ref.value, origin);
  if (href !== undefined) securityArrayPush(refs, { ...ref, href, source });
}

export function collectStaticExportOpeningTags(html: string): StaticExportOpeningTag[] {
  const tags: StaticExportOpeningTag[] = [];
  let offset = 0;

  while (offset < html.length) {
    const start = securityStringIndexOf(html, '<', offset);
    if (start === -1) break;

    const skippedMarkupEnd = readStaticExportSkippedMarkupEnd(html, start);
    if (skippedMarkupEnd !== undefined) {
      offset = skippedMarkupEnd;
      continue;
    }

    const tag = readStaticExportOpeningTag(html, start);
    if (tag === undefined) {
      offset = start + 1;
      continue;
    }

    securityArrayPush(tags, tag);
    offset = readStaticExportRawTextElementEnd(html, tag) ?? tag.end;
  }

  return tags;
}

function readStaticExportOpeningTag(
  html: string,
  start: number,
): StaticExportOpeningTag | undefined {
  const afterOpen = html[start + 1];
  if (afterOpen === undefined || afterOpen === '/' || afterOpen === '!' || afterOpen === '?') {
    return undefined;
  }

  let offset = start + 1;
  while (offset < html.length && !isStaticExportHtmlSpace(html[offset]) && html[offset] !== '>') {
    offset += 1;
  }

  const name = securityStringToLowerCase(securityStringSlice(html, start + 1, offset));
  const attributesStart = offset;
  let quote: '"' | "'" | undefined;
  while (offset < html.length) {
    const char = html[offset];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return {
        attributes: securityStringSlice(html, attributesStart, offset),
        end: offset + 1,
        name,
        start,
      };
    }

    offset += 1;
  }

  return undefined;
}

function readStaticExportSkippedMarkupEnd(html: string, start: number): number | undefined {
  const afterOpen = html[start + 1];
  if (afterOpen === undefined) return undefined;

  if (afterOpen === '!') {
    if (securityStringStartsWith(html, '<!--', start)) {
      const commentEnd = securityStringIndexOf(html, '-->', start + 4);
      return commentEnd === -1 ? html.length : commentEnd + 3;
    }

    return readStaticExportMarkupDeclarationEnd(html, start + 2);
  }

  if (afterOpen === '?' || afterOpen === '/') {
    return readStaticExportMarkupDeclarationEnd(html, start + 2);
  }

  return undefined;
}

function readStaticExportMarkupDeclarationEnd(html: string, offset: number): number {
  let quote: '"' | "'" | undefined;

  while (offset < html.length) {
    const char = html[offset];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return offset + 1;
    }

    offset += 1;
  }

  return html.length;
}

function readStaticExportProtocolElementBodyEnd(
  html: string,
  tag: StaticExportOpeningTag,
): number | undefined {
  if (!securitySetHas(STATIC_EXPORT_PROTOCOL_BODY_SKIP_ELEMENTS, tag.name)) return undefined;
  return readStaticExportElementBodyEnd(html, tag);
}

function readStaticExportRawTextElementEnd(
  html: string,
  tag: StaticExportOpeningTag,
): number | undefined {
  if (!securitySetHas(STATIC_EXPORT_RAW_TEXT_ELEMENTS, tag.name)) return undefined;
  return readStaticExportElementBodyEnd(html, tag);
}

function readStaticExportElementBodyEnd(
  html: string,
  tag: StaticExportOpeningTag,
): number | undefined {
  const lowerHtml = securityStringToLowerCase(html);
  const closePattern = `</${tag.name}`;
  let closeStart = securityStringIndexOf(lowerHtml, closePattern, tag.end);
  while (
    closeStart !== -1 &&
    !isStaticExportTagNameBoundary(lowerHtml[closeStart + closePattern.length])
  ) {
    closeStart = securityStringIndexOf(lowerHtml, closePattern, closeStart + closePattern.length);
  }
  if (closeStart === -1) return html.length;

  return readStaticExportMarkupDeclarationEnd(html, closeStart + closePattern.length);
}

function isStaticExportTagNameBoundary(char: string | undefined): boolean {
  return char === undefined || char === '>' || char === '/' || isStaticExportHtmlSpace(char);
}

export function readStaticExportHtmlAttributeRefs(
  attributes: string,
): StaticExportHtmlAttributeRef[] {
  const refs: StaticExportHtmlAttributeRef[] = [];
  let offset = 0;

  while (offset < attributes.length) {
    offset = skipStaticExportHtmlSpace(attributes, offset);
    if (offset >= attributes.length || attributes[offset] === '/') break;

    const nameStart = offset;
    while (
      offset < attributes.length &&
      !isStaticExportHtmlSpace(attributes[offset]) &&
      attributes[offset] !== '=' &&
      attributes[offset] !== '/'
    ) {
      offset += 1;
    }

    const name = securityStringToLowerCase(securityStringSlice(attributes, nameStart, offset));
    offset = skipStaticExportHtmlSpace(attributes, offset);
    if (attributes[offset] !== '=') {
      if (name !== '') securityArrayPush(refs, { name, value: '' });
      continue;
    }

    offset = skipStaticExportHtmlSpace(attributes, offset + 1);
    const read = readStaticExportHtmlAttributeValue(attributes, offset);
    offset = read.end;

    if (name !== '') {
      securityArrayPush(refs, {
        name,
        value: decodeHtmlAttributeText(read.value),
      });
    }
  }

  return refs;
}

function readStaticExportHtmlAttributeValue(
  attributes: string,
  start: number,
): { end: number; value: string } {
  const quote = attributes[start];
  if (quote === '"' || quote === "'") {
    const valueStart = start + 1;
    const valueEnd = securityStringIndexOf(attributes, quote, valueStart);
    if (valueEnd === -1) {
      return { end: attributes.length, value: securityStringSlice(attributes, valueStart) };
    }
    return {
      end: valueEnd + 1,
      value: securityStringSlice(attributes, valueStart, valueEnd),
    };
  }

  let end = start;
  while (
    end < attributes.length &&
    !isStaticExportHtmlSpace(attributes[end]) &&
    attributes[end] !== '>'
  ) {
    end += 1;
  }

  return { end, value: securityStringSlice(attributes, start, end) };
}

function staticExportUrlFromAttributeValue(
  value: string,
  origin: string,
): SecurityUrlSnapshot | undefined {
  if (securityStringTrim(value) === '') return undefined;

  try {
    return securityUrlSnapshot(value, origin);
  } catch {
    return undefined;
  }
}

function staticExportServerEndpointPhase(pathname: string): 'mutation' | 'query' | undefined {
  if (securityStringStartsWith(pathname, '/_m/')) return 'mutation';
  if (securityStringStartsWith(pathname, '/_q/')) return 'query';
  return undefined;
}

export function staticExportAttributeMap(
  refs: readonly StaticExportHtmlAttributeRef[],
): Map<string, string> {
  const attrs = createSecurityMap<string, string>();
  const pinnedRefs = snapshotBuildArray(refs, 'static-export HTML attribute refs');
  for (let index = 0; index < pinnedRefs.length; index += 1) {
    const ref = pinnedRefs[index]!;
    if (!securityMapHas(attrs, ref.name)) securityMapSet(attrs, ref.name, ref.value);
  }
  return attrs;
}

function isStaticExportModuleScript(attrs: Map<string, string>): boolean {
  const type = securityMapGet(attrs, 'type');
  return type !== undefined && securityStringToLowerCase(securityStringTrim(type)) === 'module';
}

export function staticExportRelTokens(value: string | undefined): string[] {
  return staticExportWhitespaceTokens(securityStringToLowerCase(value ?? ''));
}

function staticExportWhitespaceTokens(source: string): string[] {
  const tokens: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    offset = skipStaticExportHtmlSpace(source, offset);
    if (offset >= source.length) break;
    const start = offset;
    while (offset < source.length && !isStaticExportHtmlSpace(source[offset])) offset += 1;
    securityArrayPush(tokens, securityStringSlice(source, start, offset));
  }
  return tokens;
}

export function staticExportClientModuleHref(value: string, origin: string): string | undefined {
  if (securityStringTrim(value) === '') return undefined;

  let url: SecurityUrlSnapshot;
  try {
    url = securityUrlSnapshot(value, origin);
  } catch {
    return undefined;
  }

  if (
    url.origin !== securityUrlSnapshot(origin).origin ||
    !securityStringStartsWith(url.pathname, '/c/')
  ) {
    return undefined;
  }

  // SPEC §4.3 permits full module URLs. Static export must still publish the
  // same-origin /c/ file that a static host serves by path.
  return securityStringStartsWith(value, '/c/') ? value : `${url.pathname}${url.search}${url.hash}`;
}

function decodeHtmlAttributeText(value: string): string {
  let decoded = securityRegExpReplaceMatches(value, /&#x([0-9a-fA-F]+);/gu, (match) =>
    decodeHtmlNumericEntity(match[0], securityNumberParseInt(match[1] ?? '', 16)),
  );
  decoded = securityRegExpReplaceMatches(decoded, /&#([0-9]+);/gu, (match) =>
    decodeHtmlNumericEntity(match[0], securityNumberParseInt(match[1] ?? '', 10)),
  );
  decoded = securityRegExpReplace(decoded, /&amp;/gu, '&');
  decoded = securityRegExpReplace(decoded, /&quot;/gu, '"');
  decoded = securityRegExpReplace(decoded, /&apos;/gu, "'");
  decoded = securityRegExpReplace(decoded, /&#39;/gu, "'");
  decoded = securityRegExpReplace(decoded, /&lt;/gu, '<');
  decoded = securityRegExpReplace(decoded, /&gt;/gu, '>');
  decoded = securityRegExpReplace(decoded, /&sol;/gu, '/');
  return decoded;
}

function decodeHtmlNumericEntity(entity: string, codePoint: number): string {
  try {
    return securityStringFromCodePoint(codePoint);
  } catch {
    return entity;
  }
}

function staticExportAttributeRef(
  refs: readonly StaticExportHtmlAttributeRef[],
  name: string,
): StaticExportHtmlAttributeRef | undefined {
  const pinned = snapshotBuildArray(refs, 'static-export HTML attribute refs');
  for (let index = 0; index < pinned.length; index += 1) {
    if (pinned[index]!.name === name) return pinned[index]!;
  }
  return undefined;
}

function stringArrayContains(values: readonly string[], expected: string): boolean {
  const pinned = snapshotBuildArray(values, 'static-export protocol tokens');
  for (let index = 0; index < pinned.length; index += 1) {
    if (pinned[index] === expected) return true;
  }
  return false;
}

function skipStaticExportHtmlSpace(source: string, offset: number): number {
  while (offset < source.length && isStaticExportHtmlSpace(source[offset])) {
    offset += 1;
  }

  return offset;
}

function isStaticExportHtmlSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';
}
import { snapshotBuildArray } from './build-security-intrinsics.js';
import {
  createSecurityMap,
  createSecuritySet,
  securityArrayPush,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityNumberParseInt,
  securityRegExpReplace,
  securityRegExpReplaceMatches,
  securitySetAdd,
  securitySetHas,
  securityStringFromCodePoint,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringSlice,
  securityStringStartsWith,
  securityStringToLowerCase,
  securityStringTrim,
  securityUrlSnapshot,
  type SecurityUrlSnapshot,
} from './response-security-intrinsics.js';
