import { hasUnsafeUrlScheme, isUrlAttributeName } from '@kovojs/core/internal/security-url';
import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';
import {
  assertHtmlWireValueStable,
  isKovoComponentHostControlAttribute,
  isKovoControlPlaneAttribute,
  type HtmlWireValuePosture,
} from '@kovojs/core/internal/semantic-attributes';
import {
  createFragmentHtml,
  decideRuntimeAttributeWrite,
  drainRuntimeSinkSecurityEvent,
  elementContextSecurityControl,
  fragmentHtmlContent,
  isFragmentHtml,
  runtimeSinkFamilyForAttribute,
  type RuntimeSinkSecurityEvent,
  type FragmentHtml,
} from '@kovojs/core/internal/sink-policy';
import { kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';

import { capabilityRandomBytes } from './capability-intrinsics.js';
import { createRenderedHtmlCryptoHandle } from './crypto-authority.js';
import {
  securityBufferFrom,
  securityBufferToString,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringLastIndexOf,
  securityStringSlice,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessCreateNullRecord,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessRegExpTest,
  witnessString,
  witnessStringReplaceAll,
  witnessStringStartsWith,
  witnessStringToLowerCase,
  witnessObjectKeys,
  witnessWeakMapGet,
  witnessWeakMapHas,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

/**
 * @internal HTML-coercion helper the compiler injects into emitted server modules
 * (SPEC.md §6.x rendering). Escapes `&`/`<`/`>` so interpolated app/DB strings cannot
 * inject markup. Exported only for compiler-emitted code and in-repo callers, not app
 * authors.
 */
export function escapeHtml(value: string): string {
  return witnessStringReplaceAll(
    witnessStringReplaceAll(witnessStringReplaceAll(value, '&', '&amp;'), '<', '&lt;'),
    '>',
    '&gt;',
  );
}

/**
 * @internal HTML-coercion helper the compiler injects into emitted server modules
 * (SPEC.md §6.x rendering). Escapes attribute values (`escapeHtml` plus `"`). Exported
 * only for compiler-emitted code and in-repo callers, not app authors.
 */
export function escapeAttribute(value: string): string {
  return witnessStringReplaceAll(escapeHtml(value), '"', '&quot;');
}

/**
 * @internal Validate an authority-bearing HTML/form string before escaping it for server output.
 * SPEC §13.2 requires the browser-observed identity to remain the exact server-authored string.
 */
export function escapeWireAttribute(
  value: string,
  posture: HtmlWireValuePosture,
  sink: string,
): string {
  return escapeAttribute(assertHtmlWireValueStable(value, posture, sink));
}

const coercedRenderedHtmlPrefix = '\uE000kovo-rendered-html:v2:';
const coercedRenderedHtmlSuffix = '\uE001';
const coercedRenderedHtmlSecret = capabilityRandomBytes(32);
const coercedRenderedHtmlCrypto = createRenderedHtmlCryptoHandle(coercedRenderedHtmlSecret);
const renderedHtmlValues = createWitnessWeakSet<object>();
const renderedHtmlSnapshots = createWitnessWeakMap<object, string>();
const generatedComponentControlSnapshots = createWitnessWeakMap<
  object,
  Readonly<{ name: string; value: unknown }>
>();
const maxCoercedRenderedHtmlDepth = 32;

/**
 * @internal Compiler-generated receipt for one exact control-plane component prop.
 *
 * The receipt has no structural authority: its exact name/value snapshot lives only in the
 * module-private WeakMap. App-authored imports of this compiler ABI are rejected as lowered IR
 * (SPEC §5.2 KV235); the runtime witness is the independent defense-in-depth floor.
 */
export function kovoGeneratedComponentControl(name: string, value: unknown): object {
  if (typeof name !== 'string' || !isKovoComponentHostControlAttribute(name)) {
    throw new TypeError('Compiler component-control receipts require an exact supported name.');
  }
  const isElementParam = witnessStringStartsWith(name, 'data-p-');
  const isTrustedUrlMarker = witnessStringStartsWith(name, 'data-kovo-trusted-url:');
  const scalar =
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    (isElementParam && (typeof value === 'number' || typeof value === 'boolean')) ||
    (isTrustedUrlMarker && value === true);
  if (!scalar) {
    throw new TypeError(
      'Compiler component-control receipts require a string control value, a string/number/boolean data-p-* scalar, or an exact true trusted-URL marker.',
    );
  }
  const receipt = witnessFreeze(witnessCreateNullRecord<Record<string, never>>());
  witnessWeakMapSet(generatedComponentControlSnapshots, receipt, witnessFreeze({ name, value }));
  return receipt;
}

function generatedComponentControlSnapshot(
  name: string,
  value: unknown,
): Readonly<{ name: string; value: unknown }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const snapshot = witnessWeakMapGet(generatedComponentControlSnapshots, value);
  return snapshot?.name === name ? snapshot : undefined;
}

function generatedComponentControlWireValue(
  snapshot: Readonly<{ name: string; value: unknown }>,
): unknown {
  if (
    witnessStringStartsWith(snapshot.name, 'data-p-') &&
    (typeof snapshot.value === 'number' || typeof snapshot.value === 'boolean')
  ) {
    return witnessString(snapshot.value);
  }
  return snapshot.value;
}

/** @internal Unwrap an exact compiler-generated component-control receipt for intrinsic render. */
export function kovoGeneratedComponentControlValue(name: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const snapshot = witnessWeakMapGet(generatedComponentControlSnapshots, value);
  if (snapshot === undefined) return value;
  return snapshot.name === name ? generatedComponentControlWireValue(snapshot) : undefined;
}

/** @internal framework-rendered HTML, distinct from app-authored text strings. */
export type RenderedHtml = string & {
  readonly html: string;
  [Symbol.toPrimitive](hint: string): string;
  toJSON(): string;
  toString(): string;
};

/** @internal create a branded framework-rendered HTML value. */
export function renderedHtml(html: string): RenderedHtml {
  const snapshot = witnessString(html);
  const rendered = {
    html: snapshot,
    [Symbol.toPrimitive](hint: string) {
      return hint === 'default' ? coerceRenderedHtml(snapshot) : snapshot;
    },
    toString() {
      return snapshot;
    },
    toJSON() {
      return snapshot;
    },
  };
  witnessWeakMapSet(renderedHtmlSnapshots, rendered, snapshot);
  witnessWeakSetAdd(renderedHtmlValues, rendered);
  return witnessFreeze(rendered) as unknown as RenderedHtml;
}

/** @internal true for values produced by the server JSX/runtime HTML renderer. */
export function isRenderedHtml(value: unknown): value is RenderedHtml {
  return (
    typeof value === 'object' &&
    value !== null &&
    witnessWeakSetHas(renderedHtmlValues, value) &&
    witnessWeakMapHas(renderedHtmlSnapshots, value)
  );
}

export type { FragmentHtml } from '@kovojs/core/internal/sink-policy';

/** @internal Convert framework-rendered JSX or explicit trustedHtml() into fragment wire HTML. */
export function fragmentHtml(value: RenderedHtml | object): FragmentHtml {
  if (isRenderedHtml(value)) return createFragmentHtml(renderedHtmlContent(value));
  const trusted = kovoTrustedHtmlContent(value);
  return createFragmentHtml(trusted);
}

/**
 * @internal Audited escape for compiler-generated renderers and in-repo wire fixtures.
 *
 * SPEC.md §§4.8/5.2/9.1: app-authored raw strings must not call privileged fragment sinks
 * directly. Existing generated renderers still materialize HTML as a string after compiler-owned
 * contextual escaping; this helper is the narrow conversion point while generated render return
 * types are migrated to {@link RenderedHtml}.
 */
export function generatedFragmentHtml(html: string): FragmentHtml {
  return createFragmentHtml(html);
}

/** @internal Accept an already-branded/generated/trusted value and mint fragment wire HTML. */
export function generatedFragmentHtmlValue(value: unknown): FragmentHtml {
  if (isFragmentHtml(value)) return value;
  if (isRenderedHtml(value)) return createFragmentHtml(renderedHtmlContent(value));
  if (typeof value === 'object' && value !== null) {
    const trusted = kovoTrustedHtmlContent(value);
    if (trusted !== '') return createFragmentHtml(trusted);
  }
  if (typeof value === 'string') return generatedFragmentHtml(value);
  return generatedFragmentHtml('');
}

/** @internal Unwrap server fragment HTML at the final wire emitter. */
export function renderFragmentHtmlValue(value: FragmentHtml): string {
  return fragmentHtmlContent(value);
}

/**
 * @internal Default page/component value renderer. Unwraps framework-rendered HTML
 * and escapes app-authored scalar strings as text (SPEC.md §4.5, §5.2).
 */
export function renderHtmlValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (isRenderedHtml(value)) return renderedHtmlContent(value);
  if (typeof value === 'object') {
    const trustedHtml = kovoTrustedHtmlContent(value);
    if (trustedHtml !== '') return trustedHtml;
  }
  if (typeof value === 'string') return escapeTextWithRenderedHtml(value);
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return escapeTextWithRenderedHtml(value);
  }

  return escapeTextWithRenderedHtml(JSON.stringify(value) ?? '');
}

/**
 * Render a custom `createApp({ renderRoute })` value through Kovo's framework-owned
 * HTML trust boundary (SPEC §4.5, §9.5). String route-shell HTML remains an explicit
 * app-authored shell result; non-string values are unwrapped only when Kovo minted the
 * rendered/trusted value, otherwise they are escaped as text.
 */
export function renderRouteHtml(value: unknown): string {
  if (typeof value === 'string') return value;
  return renderHtmlValue(value);
}

/** @internal escape text while preserving framework-rendered HTML coerced via `+`. */
export function escapeTextWithRenderedHtml(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (isRenderedHtml(value)) return coerceRenderedHtml(renderedHtmlContent(value));
  if (witnessIsArray(value)) {
    let rendered = '';
    for (let index = 0; index < value.length; index += 1) {
      rendered += escapeTextWithRenderedHtml(value[index]);
    }
    return rendered;
  }

  // Mirrors renderJsxChildren's scalar coercion so escaped text stays byte-identical for safe values.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return renderStringWithCoercedRenderedHtml(witnessString(value), escapeHtml);
}

/** @internal unwrap framework-rendered HTML coerced via `+`, leaving other text raw. */
export function unwrapCoercedRenderedHtml(value: string): string {
  return renderStringWithCoercedRenderedHtml(value, (text) => text);
}

function coerceRenderedHtml(html: string): string {
  // M11 / SPEC §6.6 + §9.5: a process-global Map retained the complete HTML for every default-hint
  // coercion forever. Carry the bytes in an authenticated, self-contained marker instead. The
  // per-process HMAC preserves the old non-forgeable capability property while leaving no strong
  // reference behind after the composed string becomes unreachable.
  const payload = securityBufferToString(securityBufferFrom(html, 'utf8'), 'base64url');
  const signature = coercedRenderedHtmlSignature(payload);
  return `${coercedRenderedHtmlPrefix}${payload}.${signature}${coercedRenderedHtmlSuffix}`;
}

function renderStringWithCoercedRenderedHtml(
  value: string,
  renderText: (text: string) => string,
  depth = 0,
): string {
  if (!securityStringIncludes(value, coercedRenderedHtmlPrefix)) return renderText(value);

  let html = '';
  let offset = 0;
  while (offset < value.length) {
    const markerStart = securityStringIndexOf(value, coercedRenderedHtmlPrefix, offset);
    if (markerStart === -1) {
      html += renderText(securityStringSlice(value, offset));
      break;
    }

    html += renderText(securityStringSlice(value, offset, markerStart));
    const markerEnd = securityStringIndexOf(value, coercedRenderedHtmlSuffix, markerStart);
    if (markerEnd === -1) {
      html += renderText(securityStringSlice(value, markerStart));
      break;
    }

    const marker = securityStringSlice(
      value,
      markerStart,
      markerEnd + coercedRenderedHtmlSuffix.length,
    );
    const rendered = decodeCoercedRenderedHtml(marker);
    html +=
      rendered === undefined
        ? renderText(marker)
        : depth >= maxCoercedRenderedHtmlDepth
          ? rendered
          : renderStringWithCoercedRenderedHtml(rendered, (text) => text, depth + 1);
    offset = markerEnd + coercedRenderedHtmlSuffix.length;
  }

  return html;
}

/** @internal Consume the private construction-time bytes, never the public `.html` view. */
export function renderedHtmlContent(value: RenderedHtml): string {
  return witnessWeakMapGet(renderedHtmlSnapshots, value as unknown as object) ?? '';
}

function coercedRenderedHtmlSignature(payload: string): string {
  return coercedRenderedHtmlCrypto.sign(payload).signature;
}

function decodeCoercedRenderedHtml(marker: string): string | undefined {
  const encoded = securityStringSlice(
    marker,
    coercedRenderedHtmlPrefix.length,
    marker.length - coercedRenderedHtmlSuffix.length,
  );
  const divider = securityStringLastIndexOf(encoded, '.');
  if (divider < 0) return undefined;
  const payload = securityStringSlice(encoded, 0, divider);
  const signature = securityStringSlice(encoded, divider + 1);
  if (
    !witnessRegExpTest(/^[A-Za-z0-9_-]*$/, payload) ||
    !witnessRegExpTest(/^[A-Za-z0-9_-]+$/, signature)
  ) {
    return undefined;
  }

  if (!coercedRenderedHtmlCrypto.verify(payload, signature).ok) {
    return undefined;
  }
  return securityBufferToString(securityBufferFrom(payload, 'base64url'), 'utf8');
}

/**
 * @internal Sanitize and escape a URL-bearing attribute value for server HTML output
 * (SPEC.md §4.8 + §5.2#10). For URL-bearing attribute names (href, src, action,
 * formaction, poster, background, cite, data, ping, xlink:href) this returns `'#'`
 * when the value carries an unsafe scheme, otherwise the standard `escapeAttribute`
 * result. For all other attribute names it falls through to plain `escapeAttribute`.
 * Exported only for compiler-emitted code and in-repo callers, not app authors.
 */
export function safeUrlAttribute(name: string, value: string): string {
  const decision = decideRuntimeAttributeWrite(name, value);
  drainRuntimeSinkSecurityEvent(decision.event);
  if (decision.family === 'srcset') return escapeAttribute(decision.value ?? '#');
  if (decision.action === 'neutralize' && isUrlAttributeName(name)) {
    return '#';
  }
  return escapeAttribute(value);
}

/**
 * @internal Sanitize and escape any runtime-emitted server attribute value. Unlike
 * safeUrlAttribute, this covers non-URL executable sinks (`on*`, `srcdoc`, raw HTML/property names,
 * and raw CSS text) and returns null to omit the write.
 */
export function safeRuntimeAttribute(name: string, value: string): string | null {
  const decision = decideRuntimeAttributeWrite(name, value);
  drainRuntimeSinkSecurityEvent(decision.event);
  return decision.action === 'remove' ? null : escapeAttribute(decision.value ?? value);
}

// SPEC.md §4.8 / §5.2#10: the runtime sink policy classifies an attribute *value*
// but trusts the *name* verbatim. A dynamic spread (`<div {...record}>`) can carry
// attacker-controlled keys, so the name itself must be validated before it is
// concatenated into the tag — otherwise a key like `x><img onerror=…>` breaks out
// of the element (stored XSS). Fail closed to a strict HTML/XML name-token allowlist
// that can never contain whitespace, `=`, `/`, `<`, `>`, or quotes.
const safeAttributeNamePattern = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;

/**
 * Kovo control-plane attribute namespaces. These attributes are executable or otherwise
 * load-bearing runtime metadata: handler/derive refs, handler parameters, mutation/stream
 * dispatch, query bindings, component identity, and fragment/live targeting. They may be
 * emitted by the compiler or framework primitives, but a caller-owned JSX spread must not mint
 * them (SPEC §4.7/§4.8, §5.2 rule 10, §6.6).
 */
export function isKovoControlAttributeName(name: string): boolean {
  return isKovoControlPlaneAttribute(name);
}

/**
 * @internal Compiler-injected reconstruction boundary for a dynamic intrinsic-element JSX
 * spread. Only ordinary presentation/semantic attributes and exact name-bound compiler receipts
 * cross the boundary; unbranded Kovo control-plane attributes are omitted regardless of the
 * carrier's prototype, getters, or key casing. A
 * compiler-selected reconstruction boundary additionally removes native form/submitter overrides,
 * or reconstructs the exact canonical UI-anchor projection while stripping href and the shared
 * activation/isolation denominator. The returned null-prototype snapshot also pins the values
 * consumed by the JSX renderer so a mutable caller carrier is never re-read after classification
 * (SPEC §6.6 rule 5).
 */
export function kovoSafeJsxSpread(
  value: unknown,
  reconstructionBoundary?: 'mutation-form' | 'mutation-submitter' | 'ui-anchor',
): Record<string, unknown> {
  const safe = witnessCreateNullRecord<Record<string, unknown>>();
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return safe;

  const names = witnessObjectKeys(value);
  const uiAnchorControlFacts =
    reconstructionBoundary === 'ui-anchor'
      ? uiAnchorRelationalControlFacts(value, names)
      : undefined;
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (name === undefined) continue;
    const descriptor = witnessGetOwnPropertyDescriptor(value, name);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    if (
      reconstructionBoundary === 'ui-anchor' &&
      (descriptor.value === undefined || descriptor.value === null)
    ) {
      continue;
    }
    if (isReconstructionBoundaryAttributeName(name, reconstructionBoundary)) continue;
    const receiptSnapshot =
      typeof descriptor.value === 'object' && descriptor.value !== null
        ? witnessWeakMapGet(generatedComponentControlSnapshots, descriptor.value)
        : undefined;
    if (receiptSnapshot !== undefined && receiptSnapshot.name !== name) continue;
    const control = isKovoControlAttributeName(name);
    const generatedControl = control
      ? generatedComponentControlSnapshot(name, descriptor.value)
      : undefined;
    if (control && generatedControl === undefined) continue;
    if (
      reconstructionBoundary === 'ui-anchor' &&
      control &&
      uiAnchorCaseFoldedNameCount(names, name) !== 1
    ) {
      continue;
    }
    if (
      reconstructionBoundary === 'ui-anchor' &&
      (control
        ? !isUiAnchorGeneratedControlAttributeName(name, uiAnchorControlFacts)
        : !isUiAnchorOrdinaryPassThroughAttributeName(name))
    ) {
      continue;
    }
    safe[name] =
      generatedControl === undefined
        ? descriptor.value
        : generatedComponentControlWireValue(generatedControl);
  }
  return safe;
}

function isReconstructionBoundaryAttributeName(
  name: string,
  boundary: 'mutation-form' | 'mutation-submitter' | 'ui-anchor' | undefined,
): boolean {
  if (boundary === undefined) return false;
  const lower = witnessStringToLowerCase(name);
  if (boundary === 'ui-anchor') {
    // SPEC §4.8 / §5.2 rule 10: the reviewed UI projection may not compete with the explicit href
    // or any activation/isolation control, including through differently-cased duplicate JS keys.
    // The compiler emits this boundary before JSX merging, so the browser never observes the key.
    return lower === 'href' || elementContextSecurityControl('a', lower) !== undefined;
  }
  if (boundary === 'mutation-form') {
    return lower === 'action' || lower === 'enctype' || lower === 'method';
  }
  return (
    lower === 'form' ||
    lower === 'formaction' ||
    lower === 'formenctype' ||
    lower === 'formmethod' ||
    lower === 'formnovalidate' ||
    lower === 'formtarget'
  );
}

interface UiAnchorRelationalControlFacts {
  readonly derive: boolean;
  readonly deriveAttribute: boolean;
  readonly hrefBinding: boolean;
  readonly trustedHrefMarker: boolean;
}

function uiAnchorRelationalControlFacts(
  source: object,
  names: readonly string[],
): UiAnchorRelationalControlFacts {
  const trustedHrefMarker = uiAnchorExactReceiptSnapshot(
    source,
    names,
    'data-kovo-trusted-url:href',
  );
  const hasTrustedHrefMarker = trustedHrefMarker?.value === true;
  const hrefBinding = uiAnchorExactReceiptSnapshot(source, names, 'data-bind:href');

  const derive = uiAnchorExactReceiptSnapshot(source, names, 'data-derive');
  const deriveAttribute = uiAnchorExactReceiptSnapshot(source, names, 'data-derive-attr');
  const hasAnyDeriveAttribute = uiAnchorCaseFoldedNameCount(names, 'data-derive-attr') > 0;
  const target =
    deriveAttribute !== undefined && typeof deriveAttribute.value === 'string'
      ? deriveAttribute.value
      : undefined;
  const safeOrdinaryDeriveTarget =
    target !== undefined &&
    runtimeSinkFamilyForAttribute(target) === 'attribute' &&
    elementContextSecurityControl('a', target) === undefined;
  const hrefDeriveTarget = target === 'href';
  const hasAdmittedDeriveAttribute =
    derive !== undefined &&
    deriveAttribute !== undefined &&
    (safeOrdinaryDeriveTarget || hrefDeriveTarget);
  const hasAdmittedDerive =
    derive !== undefined && (!hasAnyDeriveAttribute || hasAdmittedDeriveAttribute);
  const hasHrefBinding = hrefBinding !== undefined;

  return witnessFreeze({
    derive: hasAdmittedDerive,
    deriveAttribute: hasAdmittedDeriveAttribute,
    hrefBinding: hasHrefBinding,
    trustedHrefMarker:
      hasTrustedHrefMarker && (hasHrefBinding || (hasAdmittedDerive && hrefDeriveTarget)),
  });
}

function uiAnchorExactReceiptSnapshot(
  source: object,
  names: readonly string[],
  name: string,
): Readonly<{ name: string; value: unknown }> | undefined {
  if (uiAnchorCaseFoldedNameCount(names, name) !== 1) return undefined;
  const descriptor = witnessGetOwnPropertyDescriptor(source, name);
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  return generatedComponentControlSnapshot(name, descriptor.value);
}

function uiAnchorCaseFoldedNameCount(names: readonly string[], expected: string): number {
  const normalizedExpected = witnessStringToLowerCase(expected);
  let count = 0;
  for (let index = 0; index < names.length; index += 1) {
    const candidate = names[index];
    if (candidate !== undefined && witnessStringToLowerCase(candidate) === normalizedExpected) {
      count += 1;
    }
  }
  return count;
}

function isUiAnchorGeneratedControlAttributeName(
  name: string,
  relational: UiAnchorRelationalControlFacts | undefined,
): boolean {
  if (!isKovoComponentHostControlAttribute(name)) return false;
  if (name === 'data-derive') return relational?.derive === true;
  if (name === 'data-derive-attr') return relational?.deriveAttribute === true;
  if (name === 'data-bind:href') return relational?.hrefBinding === true;
  if (name === 'data-kovo-trusted-url:href') {
    return relational?.trustedHrefMarker === true;
  }
  if (witnessStringStartsWith(name, 'data-kovo-trusted-url:')) return false;
  // No anchor UI primitive has a SPEC-backed need for property writes. In particular tabindex is
  // an attribute binding, not one of §4.8's finite checked/indeterminate/value/scroll property
  // sinks, so data-bind-prop:* remains closed here even with a genuine receipt.
  if (!witnessStringStartsWith(name, 'data-bind:')) {
    return !witnessStringStartsWith(name, 'data-bind-prop:');
  }
  const target = witnessStringToLowerCase(securityStringSlice(name, 'data-bind:'.length));
  return (
    runtimeSinkFamilyForAttribute(target) === 'attribute' &&
    elementContextSecurityControl('a', target) === undefined
  );
}

function isUiAnchorOrdinaryPassThroughAttributeName(name: string): boolean {
  const lower = witnessStringToLowerCase(name);
  // Match the canonical helper's case-sensitive projection. Security-deny checks above remain
  // ASCII-case-insensitive so differently-cased HTML/control aliases cannot bypass them.
  if (isKovoControlAttributeName(lower)) return false;
  return (
    witnessStringStartsWith(name, 'aria-') ||
    (witnessStringStartsWith(name, 'data-') && name !== 'data-style-src') ||
    name === 'hidden' ||
    name === 'tabIndex'
  );
}

/**
 * @internal Fail-closed attribute-NAME guard for runtime server attribute writes
 * (SPEC.md §4.8 KV236). Returns true only for a safe HTML/XML name token; on mismatch
 * it omits the write (returns false) and drains a redacted KV236 sink event so the
 * blocked write is observable in dev/test, mirroring the value-side sink policy.
 */
export function safeRuntimeAttributeName(name: string): boolean {
  if (witnessRegExpTest(safeAttributeNamePattern, name)) return true;
  drainRuntimeSinkSecurityEvent(rejectedAttributeNameEvent(name));
  return false;
}

function rejectedAttributeNameEvent(name: string): RuntimeSinkSecurityEvent {
  const reason = 'attribute name is not a safe HTML name token';
  return createRegisteredDiagnostic(
    'KV236',
    {
      action: 'remove' as const,
      family: 'attribute' as const,
      reason,
      sink: 'attribute-name',
      value: {
        length: name.length,
        preview: `<redacted:${name.length}>`,
        redacted: true as const,
      },
    },
    { message: `KV236 runtime remove for attribute-name sink: ${reason}` },
  );
}

/**
 * @internal part-4 L-i18n-meta-1: scheme-check a URL-bearing VALUE that is emitted into a
 * non-URL-named attribute (e.g. `<meta property="og:image" content="…">`). Returns `'#'`
 * for an unsafe scheme (javascript:/data:/etc), otherwise the value verbatim. The caller is
 * responsible for `escapeAttribute`-ing the result. SPEC.md §4.8 + §5.2#10 URL-sink allowlist.
 */
export function safeUrlValue(value: string): string {
  return hasUnsafeUrlScheme(value) ? '#' : value;
}

/**
 * @internal HTML-coercion helper the compiler injects into emitted server modules
 * (SPEC.md §6.x rendering). SECURITY (SECURITY_FINDINGS.md C1): safe coercion for an
 * interpolated text child. Mirrors the jsx runtime's renderJsxChildren coercion
 * (null/undefined/boolean render as '', arrays flatten) and HTML-escapes scalar values
 * so app/DB strings cannot inject markup. The compiler wraps data-path text
 * interpolations in this helper during lowering so generated components are
 * safe-by-default; it is a no-op for values without HTML metacharacters. Exported only
 * for compiler-emitted code, not app authors.
 *
 * bugz.md M2 (SPEC.md §4.5/§5.2): the result is branded as {@link RenderedHtml} so the
 * compiler-injected `{escapeText(expr)}` child is escaped exactly ONCE — `renderServerRenderable`
 * (and `renderHtmlValue`/`renderComponentValue`) short-circuit on `isRenderedHtml` and pass the
 * already-escaped `.html` through instead of escaping `&`/`<`/`>` a second time (`&` → `&amp;amp;`).
 * The escaped text is materialized eagerly and any embedded coerced-rendered-html marker is
 * resolved up front (`unwrapCoercedRenderedHtml`), so the branded `.html` is a complete,
 * marker-free string. That removes the historical leak: the previous attempt branded the value
 * but left it referencing deferred markers, which the list-stamp / live-component server-render
 * boundary never resolved and shipped verbatim. `RenderedHtml` is `string & {...}`, so callers
 * that consume the value directly as text (e.g. the §4.10 render-tree text-node join) still see
 * the single-escaped string via `toString()`. The §5.2 escapeText-presence signal in the lowered
 * source is preserved because the compiler still emits the `escapeText(...)` call verbatim.
 */
export function escapeText(value: unknown): RenderedHtml {
  if (isRenderedHtml(value)) return value;
  return renderedHtml(unwrapCoercedRenderedHtml(escapeTextWithRenderedHtml(value)));
}

/**
 * @internal HTML-coercion helper the compiler injects into emitted server modules
 * (SPEC.md §6.x rendering). Escapes `<` inside JSON embedded in inline `<script>` so a
 * payload string cannot terminate the script element early. Exported only for
 * compiler-emitted code and in-repo callers, not app authors.
 */
export function escapeScriptJson(value: string): string {
  return witnessStringReplaceAll(value, '<', '\\u003c');
}
