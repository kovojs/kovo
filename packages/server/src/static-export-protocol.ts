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

const STATIC_EXPORT_SERVER_ENDPOINT_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'src']);
const STATIC_EXPORT_RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);
const STATIC_EXPORT_PROTOCOL_BODY_SKIP_ELEMENTS = new Set([
  ...STATIC_EXPORT_RAW_TEXT_ELEMENTS,
  'pre',
  'template',
]);
const STATIC_EXPORT_DEFERRED_BOUNDARY_MARKER = '--kovo-boundary';

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
    const start = html.indexOf('<', offset);
    if (start === -1) {
      collectStaticExportDeferredBoundaryMarkers(html.slice(offset), deferredMarkers);
      break;
    }

    collectStaticExportDeferredBoundaryMarkers(html.slice(offset, start), deferredMarkers);

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

    for (const ref of refs) {
      const endpoint = staticExportServerEndpointRef(ref, origin);
      if (endpoint !== undefined) endpointRefs.push(endpoint);

      if (ref.name.startsWith('on:')) {
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

  return {
    clientModuleRefs,
    deferredMarkers,
    endpointRefs,
    mutationForms,
    queryScripts,
    serverOnlyMarkers: [
      ...endpointRefs.map((endpoint) => ({ endpoint, kind: 'server-endpoint' }) as const),
      ...deferredMarkers.map((deferred) => ({ deferred, kind: 'deferred-marker' }) as const),
    ],
  };
}

function collectStaticExportElementProtocol(options: {
  attrs: ReadonlyMap<string, string>;
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
    const src = refs.find((ref) => ref.name === 'src');
    if (src !== undefined) {
      collectStaticExportClientModuleRef(src, origin, 'module-script', clientModuleRefs);
    }
  }

  if (tag.name === 'link' && staticExportRelTokens(attrs.get('rel')).includes('modulepreload')) {
    const href = refs.find((ref) => ref.name === 'href');
    if (href !== undefined) {
      collectStaticExportClientModuleRef(href, origin, 'modulepreload-link', clientModuleRefs);
    }
  }

  if (tag.name === 'kovo-defer') {
    const target = attrs.get('target');
    deferredMarkers.push({
      kind: 'defer',
      ...(target === undefined ? {} : { target }),
      value: 'kovo-defer',
    });
  } else if (tag.name === 'kovo-fragment') {
    const target = attrs.get('target');
    deferredMarkers.push({
      kind: 'fragment',
      ...(target === undefined ? {} : { target }),
      value: 'kovo-fragment',
    });
  }

  const queryScript = staticExportQueryScript(tag.name, attrs);
  if (queryScript !== undefined) queryScripts.push(queryScript);

  const mutationForm = staticExportMutationForm(tag.name, attrs, refs, origin);
  if (mutationForm !== undefined) mutationForms.push(mutationForm);
}

function collectStaticExportDeferredBoundaryMarkers(
  text: string,
  markers: StaticExportDeferredMarker[],
): void {
  if (!text.includes(STATIC_EXPORT_DEFERRED_BOUNDARY_MARKER)) return;
  markers.push({
    kind: 'boundary',
    value: STATIC_EXPORT_DEFERRED_BOUNDARY_MARKER,
  });
}

function staticExportQueryScript(
  tagName: string,
  attrs: ReadonlyMap<string, string>,
): StaticExportQueryScript | undefined {
  if (tagName === 'kovo-query') {
    const key = attrs.get('key');
    const name = attrs.get('name');
    return {
      ...(key === undefined ? {} : { key }),
      kind: 'kovo-query-element',
      ...(name === undefined ? {} : { name }),
    };
  }

  if (tagName !== 'script' || !attrs.has('kovo-query')) return undefined;

  const key = attrs.get('key');
  const name = attrs.get('kovo-query');
  return {
    ...(key === undefined ? {} : { key }),
    kind: 'script-attribute',
    ...(name === undefined || name === '' ? {} : { name }),
  };
}

function staticExportMutationForm(
  tagName: string,
  attrs: ReadonlyMap<string, string>,
  refs: readonly StaticExportHtmlAttributeRef[],
  origin: string,
): StaticExportMutationForm | undefined {
  if (tagName !== 'form') return undefined;

  const action = refs.find((ref) => ref.name === 'action');
  const endpoint = action === undefined ? undefined : staticExportServerEndpointRef(action, origin);
  const dataMutation = attrs.get('data-mutation');
  const streamValue = attrs.get('data-mutation-stream');
  const stream = streamValue !== undefined && streamValue.trim().toLowerCase() !== 'false';

  if (endpoint?.phase !== 'mutation' && dataMutation === undefined && !stream) {
    return undefined;
  }

  return {
    ...(action === undefined ? {} : { action: action.value }),
    ...(dataMutation === undefined ? {} : { dataMutation }),
    ...(endpoint?.phase === 'mutation' ? { endpoint } : {}),
    method: attrs.get('method')?.trim().toLowerCase() || 'get',
    stream,
  };
}

function staticExportServerEndpointRef(
  ref: StaticExportHtmlAttributeRef,
  origin: string,
): StaticExportServerEndpointRef | undefined {
  if (!STATIC_EXPORT_SERVER_ENDPOINT_ATTRIBUTES.has(ref.name)) return undefined;

  const url = staticExportUrlFromAttributeValue(ref.value, origin);
  if (url === undefined || url.origin !== new URL(origin).origin) return undefined;

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
  for (const token of ref.value.split(/\s+/)) {
    collectStaticExportClientModuleRef({ ...ref, value: token }, origin, source, refs);
  }
}

function collectStaticExportClientModuleRef(
  ref: StaticExportHtmlAttributeRef,
  origin: string,
  source: StaticExportClientModuleRefSource,
  refs: StaticExportClientModuleRef[],
): void {
  const href = staticExportClientModuleHref(ref.value, origin);
  if (href !== undefined) refs.push({ ...ref, href, source });
}

export function collectStaticExportOpeningTags(html: string): StaticExportOpeningTag[] {
  const tags: StaticExportOpeningTag[] = [];
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
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

    tags.push(tag);
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

  const name = html.slice(start + 1, offset).toLowerCase();
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
        attributes: html.slice(attributesStart, offset),
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
    if (html.startsWith('<!--', start)) {
      const commentEnd = html.indexOf('-->', start + 4);
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
  if (!STATIC_EXPORT_PROTOCOL_BODY_SKIP_ELEMENTS.has(tag.name)) return undefined;
  return readStaticExportElementBodyEnd(html, tag);
}

function readStaticExportRawTextElementEnd(
  html: string,
  tag: StaticExportOpeningTag,
): number | undefined {
  if (!STATIC_EXPORT_RAW_TEXT_ELEMENTS.has(tag.name)) return undefined;
  return readStaticExportElementBodyEnd(html, tag);
}

function readStaticExportElementBodyEnd(
  html: string,
  tag: StaticExportOpeningTag,
): number | undefined {
  const lowerHtml = html.toLowerCase();
  const closePattern = `</${tag.name}`;
  let closeStart = lowerHtml.indexOf(closePattern, tag.end);
  while (
    closeStart !== -1 &&
    !isStaticExportTagNameBoundary(lowerHtml[closeStart + closePattern.length])
  ) {
    closeStart = lowerHtml.indexOf(closePattern, closeStart + closePattern.length);
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

    const name = attributes.slice(nameStart, offset).toLowerCase();
    offset = skipStaticExportHtmlSpace(attributes, offset);
    if (attributes[offset] !== '=') {
      if (name !== '') refs.push({ name, value: '' });
      continue;
    }

    offset = skipStaticExportHtmlSpace(attributes, offset + 1);
    const read = readStaticExportHtmlAttributeValue(attributes, offset);
    offset = read.end;

    if (name !== '') {
      refs.push({
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
    const valueEnd = attributes.indexOf(quote, valueStart);
    if (valueEnd === -1) return { end: attributes.length, value: attributes.slice(valueStart) };
    return { end: valueEnd + 1, value: attributes.slice(valueStart, valueEnd) };
  }

  let end = start;
  while (
    end < attributes.length &&
    !isStaticExportHtmlSpace(attributes[end]) &&
    attributes[end] !== '>'
  ) {
    end += 1;
  }

  return { end, value: attributes.slice(start, end) };
}

function staticExportUrlFromAttributeValue(value: string, origin: string): URL | undefined {
  if (value.trim() === '') return undefined;

  try {
    return new URL(value, origin);
  } catch {
    return undefined;
  }
}

function staticExportServerEndpointPhase(pathname: string): 'mutation' | 'query' | undefined {
  if (pathname.startsWith('/_m/')) return 'mutation';
  if (pathname.startsWith('/_q/')) return 'query';
  return undefined;
}

export function staticExportAttributeMap(
  refs: readonly StaticExportHtmlAttributeRef[],
): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const ref of refs) {
    if (!attrs.has(ref.name)) attrs.set(ref.name, ref.value);
  }
  return attrs;
}

function isStaticExportModuleScript(attrs: ReadonlyMap<string, string>): boolean {
  return attrs.get('type')?.trim().toLowerCase() === 'module';
}

export function staticExportRelTokens(value: string | undefined): string[] {
  return (value ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

export function staticExportClientModuleHref(value: string, origin: string): string | undefined {
  if (value.trim() === '') return undefined;

  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return undefined;
  }

  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/c/')) {
    return undefined;
  }

  // SPEC §4.3 permits full module URLs. Static export must still publish the
  // same-origin /c/ file that a static host serves by path.
  return value.startsWith('/c/') ? value : `${url.pathname}${url.search}${url.hash}`;
}

function decodeHtmlAttributeText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (entity: string, hex: string) =>
      decodeHtmlNumericEntity(entity, Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (entity: string, decimal: string) =>
      decodeHtmlNumericEntity(entity, Number.parseInt(decimal, 10)),
    )
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&sol;/g, '/');
}

function decodeHtmlNumericEntity(entity: string, codePoint: number): string {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return entity;
  }
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
