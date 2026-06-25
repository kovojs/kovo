import {
  hasUnsafeUrlScheme,
  isUrlAttributeName,
  SAFE_URL_SCHEMES,
  URL_ATTRIBUTE_NAMES,
} from './security-url.js';

/** @internal Runtime sink family used by server render and browser update backstops. */
export type RuntimeSinkFamily =
  | 'attribute'
  | 'css-text'
  | 'event-handler'
  | 'raw-html'
  | 'srcdoc'
  | 'srcset'
  | 'url';

/** @internal Runtime fail-closed action for a dynamic sink write. */
export type RuntimeSinkAction = 'allow' | 'neutralize' | 'remove';

/** @internal Structured event for blocked runtime sink writes (SPEC.md §4.8 / KV236). */
export interface RuntimeSinkSecurityEvent {
  action: Exclude<RuntimeSinkAction, 'allow'>;
  code: 'KV236';
  family: RuntimeSinkFamily;
  message: string;
  reason: string;
  sink: string;
  value: {
    length: number;
    preview: string;
    redacted: true;
  };
}

/** @internal Runtime sink decision shared by server render and browser update paths. */
export interface RuntimeSinkDecision {
  action: RuntimeSinkAction;
  event?: RuntimeSinkSecurityEvent;
  family: RuntimeSinkFamily;
  value?: string;
}

/** @internal Attribute names whose value is a srcset candidate list, not one plain URL. */
export const SRCSET_ATTRIBUTE_NAMES = ['srcset', 'imagesrcset'] as const;

/** @internal Raw HTML attribute/property spellings that must not accept untrusted strings. */
export const RAW_HTML_SINK_NAMES = [
  'dangerouslysetinnerhtml',
  'innerhtml',
  'outerhtml',
  'inserthtml',
  'insertadjacenthtml',
] as const;

const srcsetAttributeNames = new Set<string>(SRCSET_ATTRIBUTE_NAMES);
const rawHtmlSinkNames = new Set<string>(RAW_HTML_SINK_NAMES);

/** @internal True when an attribute/property name is an event-handler sink. */
export function isEventHandlerAttributeName(name: string): boolean {
  return /^on[^:]/i.test(name);
}

/** @internal True when an attribute/property name is a srcdoc sink. */
export function isSrcdocAttributeName(name: string): boolean {
  return name.toLowerCase() === 'srcdoc';
}

/** @internal True when an attribute/property name is raw CSS text. */
export function isCssTextAttributeName(name: string): boolean {
  return name.toLowerCase() === 'style';
}

/** @internal True when an attribute/property name is raw HTML insertion. */
export function isRawHtmlSinkName(name: string): boolean {
  return rawHtmlSinkNames.has(name.toLowerCase());
}

/** @internal True when an attribute/property name is a srcset candidate-list sink. */
export function isSrcsetAttributeName(name: string): boolean {
  return srcsetAttributeNames.has(name.toLowerCase());
}

/** @internal Classify one dynamic attribute/property sink. */
export function runtimeSinkFamilyForAttribute(name: string): RuntimeSinkFamily {
  if (isEventHandlerAttributeName(name)) return 'event-handler';
  if (isSrcdocAttributeName(name)) return 'srcdoc';
  if (isRawHtmlSinkName(name)) return 'raw-html';
  if (isCssTextAttributeName(name)) return 'css-text';
  if (isSrcsetAttributeName(name)) return 'srcset';
  if (isUrlAttributeName(name)) return 'url';
  return 'attribute';
}

/**
 * @internal Decide a dynamic attribute write. Unsafe sinks return `remove`; unsafe plain URL
 * attributes return `neutralize` with `#` to preserve the existing server/browser ABI.
 */
export function decideRuntimeAttributeWrite(name: string, value: string): RuntimeSinkDecision {
  const family = runtimeSinkFamilyForAttribute(name);

  if (family === 'event-handler' || family === 'srcdoc' || family === 'raw-html') {
    return blockedDecision(name, family, value, 'runtime write would create executable markup');
  }

  if (family === 'css-text') {
    if (hasUnsafeCssText(value)) {
      return blockedDecision(
        name,
        family,
        value,
        'CSS text contains an unsafe URL or dynamic CSS function',
      );
    }
    return { action: 'allow', family, value };
  }

  if (family === 'srcset') {
    const sanitized = sanitizeRuntimeSrcset(value);
    if (sanitized === null) {
      return blockedDecision(name, family, value, 'srcset has no safe URL candidates');
    }
    if (sanitized !== value) {
      return neutralizedDecision(
        name,
        family,
        sanitized,
        value,
        'srcset unsafe URL candidates were dropped',
      );
    }
    return { action: 'allow', family, value };
  }

  if (family === 'url' && hasUnsafeUrlScheme(value)) {
    return neutralizedDecision(name, family, '#', value, 'URL scheme is not allowed');
  }

  return { action: 'allow', family, value };
}

/** @internal Sanitize a srcset candidate list by dropping unsafe URL candidates. */
export function sanitizeRuntimeSrcset(value: string): string | null {
  const safeCandidates = splitSrcsetCandidates(value).flatMap((candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return [];
    if (hasUnsafeUrlScheme(trimmed)) return [];

    const urlEnd = firstAsciiWhitespaceIndex(trimmed);
    const url = urlEnd === -1 ? trimmed : trimmed.slice(0, urlEnd);
    const descriptor = urlEnd === -1 ? '' : trimmed.slice(urlEnd).trim();
    if (hasUnsafeUrlScheme(unquoteCssUrlToken(url))) return [];

    return [descriptor ? `${url} ${descriptor}` : url];
  });

  return safeCandidates.length === 0 ? null : safeCandidates.join(', ');
}

/** @internal CSS url(...) backstop for focused property-sanitizer tests. */
export function hasUnsafeCssUrl(value: string): boolean {
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)]*?))\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (hasUnsafeUrlScheme(url)) return true;
  }
  return false;
}

/** @internal CSS text backstop for parsed server/browser fragment attributes. */
export function hasUnsafeCssText(value: string): boolean {
  return (
    hasUnsafeCssUrl(value) || /\bexpression\s*\(/i.test(value) || /-moz-binding\s*:/i.test(value)
  );
}

function splitSrcsetCandidates(value: string): string[] {
  const candidates: string[] = [];
  let quote: '"' | "'" | undefined;
  let depth = 0;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')' && depth > 0) {
      depth -= 1;
      continue;
    }
    if (char === ',' && depth === 0) {
      candidates.push(value.slice(start, index));
      start = index + 1;
    }
  }

  candidates.push(value.slice(start));
  return candidates;
}

function firstAsciiWhitespaceIndex(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20) {
      return index;
    }
  }
  return -1;
}

function unquoteCssUrlToken(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function blockedDecision(
  sink: string,
  family: RuntimeSinkFamily,
  value: string,
  reason: string,
): RuntimeSinkDecision {
  return {
    action: 'remove',
    event: runtimeSinkSecurityEvent(sink, family, value, 'remove', reason),
    family,
  };
}

function neutralizedDecision(
  sink: string,
  family: RuntimeSinkFamily,
  value: string,
  original: string,
  reason: string,
): RuntimeSinkDecision {
  return {
    action: 'neutralize',
    event: runtimeSinkSecurityEvent(sink, family, original, 'neutralize', reason),
    family,
    value,
  };
}

function runtimeSinkSecurityEvent(
  sink: string,
  family: RuntimeSinkFamily,
  value: string,
  action: Exclude<RuntimeSinkAction, 'allow'>,
  reason: string,
): RuntimeSinkSecurityEvent {
  return {
    action,
    code: 'KV236',
    family,
    message: `KV236 runtime ${action} for ${family} sink "${sink}": ${reason}`,
    reason,
    sink,
    value: {
      length: value.length,
      preview: redactedPreview(value),
      redacted: true,
    },
  };
}

function redactedPreview(value: string): string {
  return `<redacted:${value.length}>`;
}

export { SAFE_URL_SCHEMES, URL_ATTRIBUTE_NAMES };
