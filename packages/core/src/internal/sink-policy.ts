import {
  freezeSecurityValue,
  securityArrayAppend,
  securityMap,
  securityMapGet,
  securityMapSet,
  securityRegExpExec,
  securityRegExpTest,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityString,
  securityStringCharCodeAt,
  securityStringSlice,
  securityStringToLowerCase,
  securityStringTrim,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetHas,
} from '#security-witness-intrinsics';
import { isGeneratedOnlySemanticAttribute } from './semantic-attributes.js';

/**
 * @internal URL sink facts for server render, browser runtime writes, and compiler
 * output-context classification (SPEC.md §4.8, §5.2 rule 10).
 */
export const URL_ATTRIBUTE_NAMES = freezeSecurityValue([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'data',
  'ping',
  'xlink:href',
] as const);

/** @internal URL schemes accepted by Kovo server/client URL sinks (SPEC.md §4.8). */
export const SAFE_URL_SCHEMES = freezeSecurityValue([
  'http',
  'https',
  'mailto',
  'tel',
  'ftp',
] as const);

/**
 * @internal SVG SMIL elements Kovo refuses to render or adopt.
 *
 * SPEC.md §4.8 / §5.2 rule 10: generic SMIL animation can transfer `values`, `from`,
 * `to`, or `by` into another element's URL/event/style attribute after ordinary per-attribute
 * output checks have completed. The target may also change over time through live bindings.
 * Kovo is in technical preview, so the framework fails closed on the animation primitive rather
 * than maintaining a browser-specific cross-attribute execution model.
 */
export const BLOCKED_SVG_SMIL_ELEMENT_NAMES = freezeSecurityValue([
  'animate',
  'animatecolor',
  'animatemotion',
  'animatetransform',
  'discard',
  'set',
] as const);

/**
 * @internal Active embedded-document elements Kovo refuses to render or adopt.
 *
 * SPEC.md §4.8 / §5.2 rule 10: unlike a modern iframe, `object`, `embed`, and obsolete
 * `frame`/`frameset` output have no reviewable sandbox boundary. A same-origin HTML resource can
 * therefore execute with the embedding document's origin and directly reach its parent. Kovo's
 * technical-preview surface disables the primitives instead of relying on CSP or obsolete parsing.
 */
export const BLOCKED_ACTIVE_EMBED_ELEMENT_NAMES = freezeSecurityValue([
  'embed',
  'frame',
  'frameset',
  'object',
] as const);

/**
 * @internal Declarative Shadow DOM controls Kovo refuses on `<template>`.
 *
 * SPEC.md §4.2: component output is light DOM. A declarative shadow root changes the DOM tree
 * during parsing and can hide executable or authority-bearing descendants from Kovo's ordinary
 * light-DOM traversal. These controls are therefore outside the authored/runtime output surface.
 */
export const BLOCKED_DECLARATIVE_SHADOW_DOM_ATTRIBUTE_NAMES = freezeSecurityValue([
  'shadowrootmode',
  'shadowrootdelegatesfocus',
  'shadowrootclonable',
  'shadowrootserializable',
] as const);

const urlAttributeNames = securitySetOf<string>(URL_ATTRIBUTE_NAMES);
const safeUrlSchemes = securitySetOf<string>(SAFE_URL_SCHEMES);
const blockedSvgSmilElementNames = securitySetOf<string>(BLOCKED_SVG_SMIL_ELEMENT_NAMES);
const blockedActiveEmbedElementNames = securitySetOf<string>(BLOCKED_ACTIVE_EMBED_ELEMENT_NAMES);
const blockedDeclarativeShadowDomAttributeNames = securitySetOf<string>(
  BLOCKED_DECLARATIVE_SHADOW_DOM_ATTRIBUTE_NAMES,
);
const urlSchemePattern = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const htmlColonReferencePattern = /&(?:#0*58(?![0-9])|#[xX]0*3[aA](?![0-9a-fA-F])|colon);?/;

/** @internal True when an HTML attribute is URL-bearing and needs scheme checks. */
export function isUrlAttributeName(name: string): boolean {
  return securitySetHas(urlAttributeNames, securityStringToLowerCase(name));
}

/** @internal True when an intrinsic element is a disabled SVG SMIL execution primitive. */
export function isBlockedSvgSmilElementName(name: string): boolean {
  return securitySetHas(blockedSvgSmilElementNames, securityStringToLowerCase(name));
}

/** @internal True when an intrinsic element is an unsandboxable active embed primitive. */
export function isBlockedActiveEmbedElementName(name: string): boolean {
  return securitySetHas(blockedActiveEmbedElementNames, securityStringToLowerCase(name));
}

/** @internal True when an attribute can opt a `<template>` into declarative Shadow DOM. */
export function isBlockedDeclarativeShadowDomAttributeName(name: string): boolean {
  return securitySetHas(blockedDeclarativeShadowDomAttributeNames, securityStringToLowerCase(name));
}

/** @internal One finite element/attribute security-control classification. */
export interface ElementContextSecurityControl {
  readonly acceptsTrustedUrl: boolean;
  readonly reason: string;
  readonly staticPolicy:
    | 'allow'
    | 'disabled'
    | 'meta-referrer-name'
    | 'referrer-policy'
    | 'rel-no-opener'
    | 'target-keyword';
}

/**
 * @internal Canonical finite denominator for browser activation, isolation, and navigation
 * controls. The compiler, modular browser runtime, fragment morph, and generated inline loader
 * all consume this manifest; adding a browser control in only one path is a security regression.
 */
export const ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES = freezeSecurityValue([
  freezeSecurityValue([
    'script',
    'src',
    true,
    'allow',
    'a dynamic script source can execute same-origin attacker-controlled JavaScript',
  ] as const),
  freezeSecurityValue([
    'script',
    'href',
    true,
    'allow',
    'a dynamic script source can execute same-origin attacker-controlled JavaScript',
  ] as const),
  freezeSecurityValue([
    'script',
    'xlink:href',
    true,
    'allow',
    'a dynamic script source can execute same-origin attacker-controlled JavaScript',
  ] as const),
  freezeSecurityValue([
    'script',
    'type',
    false,
    'allow',
    'a dynamic script type can turn an inert data block into executable JavaScript',
  ] as const),
  freezeSecurityValue([
    'script',
    'nomodule',
    false,
    'allow',
    'script nomodule posture must be fixed before parser-time execution selection',
  ] as const),
  freezeSecurityValue([
    'script',
    'integrity',
    false,
    'allow',
    'script integrity must be fixed before the parser starts the subresource request',
  ] as const),
  freezeSecurityValue([
    'script',
    'crossorigin',
    false,
    'allow',
    'script credential mode must be fixed before the parser starts the subresource request',
  ] as const),
  freezeSecurityValue([
    'script',
    'referrerpolicy',
    false,
    'referrer-policy',
    'script referrer policy must be fixed before the parser starts the subresource request',
  ] as const),
  freezeSecurityValue([
    'script',
    'charset',
    false,
    'allow',
    'script decoding posture must be fixed before fetched bytes are decoded',
  ] as const),
  freezeSecurityValue([
    'script',
    'nonce',
    false,
    'disabled',
    'script nonces are framework-owned authority; Kovo documents use hash-locked CSP',
  ] as const),
  freezeSecurityValue([
    'script',
    'language',
    false,
    'disabled',
    'the obsolete script language switch is disabled',
  ] as const),
  freezeSecurityValue([
    'link',
    'href',
    true,
    'allow',
    'a dynamic stylesheet URL can apply attacker-controlled CSS',
  ] as const),
  freezeSecurityValue([
    'link',
    'rel',
    false,
    'allow',
    'a dynamic link relationship can turn an inert resource into an active stylesheet',
  ] as const),
  freezeSecurityValue([
    'link',
    'type',
    false,
    'allow',
    'link resource type must be fixed before the parser chooses the resource destination',
  ] as const),
  freezeSecurityValue([
    'link',
    'media',
    false,
    'allow',
    'link media activation must be fixed before the resource is selected',
  ] as const),
  freezeSecurityValue([
    'link',
    'disabled',
    false,
    'allow',
    'link disabled posture must be fixed before stylesheet activation',
  ] as const),
  freezeSecurityValue([
    'link',
    'integrity',
    false,
    'allow',
    'link integrity must be fixed before the parser starts the subresource request',
  ] as const),
  freezeSecurityValue([
    'link',
    'crossorigin',
    false,
    'allow',
    'link credential mode must be fixed before the parser starts the subresource request',
  ] as const),
  freezeSecurityValue([
    'link',
    'referrerpolicy',
    false,
    'referrer-policy',
    'link referrer policy must be fixed before the parser starts the subresource request',
  ] as const),
  freezeSecurityValue([
    'link',
    'as',
    false,
    'allow',
    'link destination classification must be fixed before preload policy is selected',
  ] as const),
  freezeSecurityValue([
    'link',
    'nonce',
    false,
    'disabled',
    'link nonces are framework-owned authority; Kovo documents use hash-locked CSP',
  ] as const),
  freezeSecurityValue([
    'iframe',
    'src',
    true,
    'allow',
    'a dynamic iframe source can load same-origin attacker-controlled active content',
  ] as const),
  freezeSecurityValue([
    'iframe',
    'sandbox',
    false,
    'allow',
    'a dynamic iframe sandbox value can remove the embedded-document isolation boundary',
  ] as const),
  freezeSecurityValue([
    'iframe',
    'allow',
    false,
    'allow',
    'iframe permissions policy must be fixed before embedded content receives capabilities',
  ] as const),
  freezeSecurityValue([
    'iframe',
    'credentialless',
    false,
    'allow',
    'iframe credentialless posture must be fixed before the navigation starts',
  ] as const),
  freezeSecurityValue([
    'iframe',
    'csp',
    false,
    'allow',
    'iframe embedded CSP must be fixed before the navigation starts',
  ] as const),
  freezeSecurityValue([
    'iframe',
    'referrerpolicy',
    false,
    'referrer-policy',
    'iframe referrer policy must be fixed before the navigation starts',
  ] as const),
  freezeSecurityValue([
    'iframe',
    'name',
    false,
    'allow',
    'iframe browsing-context identity must remain compiler-reviewed',
  ] as const),
  freezeSecurityValue([
    'annotation-xml',
    'encoding',
    false,
    'allow',
    'a dynamic MathML annotation encoding can activate inert descendants as HTML',
  ] as const),
  freezeSecurityValue([
    'a',
    'target',
    false,
    'target-keyword',
    'anchor target must not mint an opener-bearing named browsing context',
  ] as const),
  freezeSecurityValue([
    'a',
    'rel',
    false,
    'rel-no-opener',
    'anchor relationship must not opt back into window.opener authority',
  ] as const),
  freezeSecurityValue([
    'a',
    'referrerpolicy',
    false,
    'referrer-policy',
    'anchor referrer policy must not weaken the document confidentiality floor',
  ] as const),
  freezeSecurityValue([
    'a',
    'ping',
    false,
    'disabled',
    'anchor ping reporting is disabled because Ping-From can disclose the source URL',
  ] as const),
  freezeSecurityValue([
    'area',
    'target',
    false,
    'target-keyword',
    'area target must not mint an opener-bearing named browsing context',
  ] as const),
  freezeSecurityValue([
    'area',
    'rel',
    false,
    'rel-no-opener',
    'area relationship must not opt back into window.opener authority',
  ] as const),
  freezeSecurityValue([
    'area',
    'referrerpolicy',
    false,
    'referrer-policy',
    'area referrer policy must not weaken the document confidentiality floor',
  ] as const),
  freezeSecurityValue([
    'area',
    'ping',
    false,
    'disabled',
    'area ping reporting is disabled because Ping-From can disclose the source URL',
  ] as const),
  freezeSecurityValue([
    'img',
    'referrerpolicy',
    false,
    'referrer-policy',
    'image referrer policy must be fixed before the request starts',
  ] as const),
  freezeSecurityValue([
    'meta',
    'name',
    false,
    'meta-referrer-name',
    'meta referrer policy is disabled because it can weaken the document response header',
  ] as const),
] as const);

/**
 * @internal Finite registry for attributes whose safety depends on their owning element.
 *
 * Compiler and runtime paths consume this same classifier so a URL-scheme-safe value cannot
 * bypass execution, isolation, or foreign-content activation review (SPEC §4.8, §5.2 rule 10).
 */
export function elementContextSecurityControl(
  elementName: string,
  attributeName: string,
): ElementContextSecurityControl | undefined {
  const tag = securityStringToLowerCase(elementName);
  const attribute = securityStringToLowerCase(attributeName);
  for (let index = 0; index < ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES.length; index += 1) {
    const control = ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES[index];
    if (control === undefined || control[0] !== tag || control[1] !== attribute) continue;
    return {
      acceptsTrustedUrl: control[2],
      staticPolicy: control[3],
      reason: control[4],
    };
  }
  return undefined;
}

/** @internal True when an element participates in the finite browser-control denominator. */
export function elementHasContextSecurityControls(elementName: string): boolean {
  const tag = securityStringToLowerCase(elementName);
  for (let index = 0; index < ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES.length; index += 1) {
    if (ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES[index]?.[0] === tag) return true;
  }
  return false;
}

/** @internal Validate a compiler/server/fragment-reviewed static control value. */
export function elementContextSecurityStaticValueIssue(
  elementName: string,
  attributeName: string,
  value: string,
): string | undefined {
  const control = elementContextSecurityControl(elementName, attributeName);
  if (control === undefined || control.staticPolicy === 'allow') return undefined;
  if (control.staticPolicy === 'disabled') return control.reason;

  const exact = securityStringToLowerCase(value);
  const normalized = securityStringToLowerCase(securityStringTrim(value));
  if (control.staticPolicy === 'meta-referrer-name') {
    return normalized === 'referrer' ? control.reason : undefined;
  }
  if (control.staticPolicy === 'referrer-policy') {
    return normalized === 'no-referrer' ||
      normalized === 'same-origin' ||
      normalized === 'strict-origin' ||
      normalized === 'strict-origin-when-cross-origin'
      ? undefined
      : `${control.reason}; allowed values are no-referrer, same-origin, strict-origin, and strict-origin-when-cross-origin`;
  }
  if (control.staticPolicy === 'target-keyword') {
    // Target keywords are not whitespace-token values. Whitespace around `_blank` creates a named
    // browsing context rather than spelling the keyword, so it must not normalize into allowlist.
    return exact === '_blank' || exact === '_self' || exact === '_parent' || exact === '_top'
      ? undefined
      : `${control.reason}; only _blank, _self, _parent, and _top are allowed`;
  }
  if (control.staticPolicy === 'rel-no-opener') {
    return asciiWhitespaceTokenListContains(normalized, 'opener') ? control.reason : undefined;
  }
  return control.reason;
}

function asciiWhitespaceTokenListContains(value: string, expected: string): boolean {
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const code = index < value.length ? securityStringCharCodeAt(value, index) : 0x20;
    const whitespace = code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
    if (!whitespace) continue;
    if (start < index && securityStringSlice(value, start, index) === expected) return true;
    start = index + 1;
  }
  return false;
}

/**
 * Returns true when the URL string carries an unsafe scheme. Strips control
 * characters before extracting the scheme so `java\nscript:` is caught.
 */
export function hasUnsafeUrlScheme(value: string): boolean {
  const normalized = normalizedUrlForSchemeCheck(value);
  if (hasHtmlColonReferenceInSchemePosition(normalized)) return true;

  const match = securityRegExpExec(urlSchemePattern, normalized);
  if (!match) return false;

  return !securitySetHas(safeUrlSchemes, securityStringToLowerCase(match[1] ?? ''));
}

/**
 * @internal Framework-owned sink witness kinds that may use the shared Blessed<Sink> substrate.
 *
 * SPEC §4.8 / §5.2 #10 and §6.6: unsafe output and execution-adjacent sinks need an explicit,
 * centrally auditable constructor monopoly. Additions here must be reviewed with their owning
 * validator/escaper; scripts/check-sink-policy-gate.mjs rejects unregistered drift.
 */
const frameworkBlessedSinkKindRegistry = [
  'browser:response-fragment-html',
  'core:route-redirect',
  'parameterized-sql',
  'rooted-file-serve',
  'server:command-exec-file',
  'server:fragment-html',
  'server:redirect-location',
  'sql-identifier',
  'sql-keyword',
  'static-sql',
  'trusted-sql',
] as const;

/** @internal Immutable facade over the statically audited sink-kind registry. */
export const FRAMEWORK_BLESSED_SINK_KINDS = freezeSecurityValue(frameworkBlessedSinkKindRegistry);

/** @internal */
export type FrameworkBlessedSinkKind = (typeof FRAMEWORK_BLESSED_SINK_KINDS)[number];

/**
 * @internal Type-only carrier for a value blessed for one framework-owned sink.
 *
 * SPEC §6.6: brands are defense-in-depth, not the proof. The enforcement witness is the
 * module-private WeakSet registry below; this optional property exists only to keep internal
 * TypeScript signatures readable.
 */
export type Blessed<Sink extends string> = {
  readonly __kovoBlessedSink?: Sink;
};

/** @internal Server-side fragment HTML accepted by privileged wire emitters. */
export interface FragmentHtml extends Blessed<'server:fragment-html'> {
  readonly html: string;
  toJSON(): string;
  toString(): string;
}

/** @internal Browser-decoded fragment HTML accepted by privileged DOM apply sinks. */
export interface RenderedFragmentHtml extends Blessed<'browser:response-fragment-html'> {
  readonly html: string;
  toJSON(): string;
  toString(): string;
}

/** @internal Runtime sink family used by server render and browser update backstops. */
export type RuntimeSinkFamily =
  | 'attribute'
  | 'css-text'
  | 'event-handler'
  | 'framework-control'
  | 'header'
  | 'raw-html'
  | 'srcdoc'
  | 'srcset'
  | 'url';

/** @internal Runtime fail-closed action for a dynamic sink write. */
export type RuntimeSinkAction = 'allow' | 'neutralize' | 'preserve' | 'remove';

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

/** @internal Test/dev sink for blocked runtime sink events (SPEC.md §4.8 / KV236). */
export type RuntimeSinkSecurityEventHandler = (event: RuntimeSinkSecurityEvent) => void;

/** @internal Runtime sink decision shared by server render and browser update paths. */
export interface RuntimeSinkDecision {
  action: RuntimeSinkAction;
  event?: RuntimeSinkSecurityEvent;
  family: RuntimeSinkFamily;
  value?: string;
}

/** @internal Provenance posture for one runtime attribute write. */
type RuntimeAttributeWritePosture = 'compiler-wire' | 'dynamic-binding';

/** @internal Runtime attribute-write context; compiler wire is preserved unless explicitly narrowed. */
interface RuntimeAttributeWriteOptions {
  /** Browser-effective element name for pair/context-dependent attributes. */
  elementName?: string;
  /** Existing meta pragma posture before the proposed write is committed. */
  effectiveHttpEquiv?: string | null;
  posture?: RuntimeAttributeWritePosture;
  /** Exact module-private TrustedUrl witness already verified by the browser package. */
  trustedUrl?: boolean;
}

/** @internal Attribute names whose value is a srcset candidate list, not one plain URL. */
export const SRCSET_ATTRIBUTE_NAMES = freezeSecurityValue(['srcset', 'imagesrcset'] as const);

/** @internal Raw HTML attribute/property spellings that must not accept untrusted strings. */
export const RAW_HTML_SINK_NAMES = freezeSecurityValue([
  'dangerouslysetinnerhtml',
  'innerhtml',
  'outerhtml',
  'inserthtml',
  'insertadjacenthtml',
] as const);

const srcsetAttributeNames = securitySetOf<string>(SRCSET_ATTRIBUTE_NAMES);
const rawHtmlSinkNames = securitySetOf<string>(RAW_HTML_SINK_NAMES);
const blessedSinkWitnesses = securityMap<string, WeakSet<object>>();
const fragmentHtmlSnapshots = securityWeakMap<object, string>();
const renderedFragmentHtmlSnapshots = securityWeakMap<object, string>();
let runtimeSinkSecurityEventHandler: RuntimeSinkSecurityEventHandler | undefined;

/** @internal Mint a non-forgeable runtime witness for a framework-owned sink capability. */
export function blessSink<Sink extends string, T extends object>(
  sink: Sink,
  value: T,
): T & Blessed<Sink> {
  let witnesses = securityMapGet(blessedSinkWitnesses, sink);
  if (!witnesses) {
    witnesses = securityWeakSet<object>();
    securityMapSet(blessedSinkWitnesses, sink, witnesses);
  }
  securityWeakSetAdd(witnesses, value);
  return value as T & Blessed<Sink>;
}

/** @internal Check the module-private witness for a framework-owned sink capability. */
export function isBlessedSink<Sink extends string>(
  sink: Sink,
  value: unknown,
): value is Blessed<Sink> & object {
  if (typeof value !== 'object' || value === null) return false;
  const witnesses = securityMapGet(blessedSinkWitnesses, sink);
  return witnesses !== undefined && securityWeakSetHas(witnesses, value);
}

/**
 * @internal Mint server-side fragment HTML for audited generated/rendered/trusted paths only.
 *
 * SPEC.md §§2, 4.8, 5.2 rule 10, 6.6, 9.1: this brand is an author-time guardrail and
 * internal capability, not the XSS proof. Runtime renderers still own contextual escaping and
 * fragment apply sanitizers still own fail-closed DOM adoption.
 */
export function createFragmentHtml(html: string): FragmentHtml {
  const fragment = fragmentHtmlObject(html, fragmentHtmlSnapshots);
  return blessSink('server:fragment-html', fragment);
}

/** @internal True for server-side fragment HTML minted by {@link createFragmentHtml}. */
export function isFragmentHtml(value: unknown): value is FragmentHtml {
  return isBlessedSink('server:fragment-html', value);
}

/** @internal Unwrap server-side fragment HTML for the wire emitter. */
export function fragmentHtmlContent(value: FragmentHtml): string {
  return securityWeakMapGet(fragmentHtmlSnapshots, value) ?? '';
}

/** @internal Mint browser-decoded fragment HTML before it reaches DOM raw-HTML sinks. */
export function createRenderedFragmentHtml(html: string): RenderedFragmentHtml {
  const fragment = fragmentHtmlObject(html, renderedFragmentHtmlSnapshots);
  return blessSink('browser:response-fragment-html', fragment);
}

/** @internal True for browser-side fragment HTML minted by {@link createRenderedFragmentHtml}. */
export function isRenderedFragmentHtml(value: unknown): value is RenderedFragmentHtml {
  return isBlessedSink('browser:response-fragment-html', value);
}

/** @internal Unwrap browser-side fragment HTML for the framework DOM adapter. */
export function renderedFragmentHtmlContent(value: RenderedFragmentHtml): string {
  return securityWeakMapGet(renderedFragmentHtmlSnapshots, value) ?? '';
}

/** @internal Install a test/dev hook for blocked runtime sink events. */
export function setRuntimeSinkSecurityEventHandler(
  handler: RuntimeSinkSecurityEventHandler | undefined,
): () => void {
  const previous = runtimeSinkSecurityEventHandler;
  runtimeSinkSecurityEventHandler = handler;

  return () => {
    if (runtimeSinkSecurityEventHandler === handler) {
      runtimeSinkSecurityEventHandler = previous;
    }
  };
}

/** @internal Drain one blocked runtime sink event in development/test builds. */
export function drainRuntimeSinkSecurityEvent(event: RuntimeSinkSecurityEvent | undefined): void {
  if (!event || !isDevelopmentOrTestRuntime()) return;

  if (runtimeSinkSecurityEventHandler) {
    runtimeSinkSecurityEventHandler(event);
    return;
  }

  if (runtimeMode() === 'development' && typeof console !== 'undefined') {
    console.warn(event.message, event);
  }
}

/** @internal True when an attribute/property name is an event-handler sink. */
export function isEventHandlerAttributeName(name: string): boolean {
  return securityRegExpTest(/^on[^:]/i, name);
}

/** @internal True when an attribute/property name is a srcdoc sink. */
export function isSrcdocAttributeName(name: string): boolean {
  return securityStringToLowerCase(name) === 'srcdoc';
}

/** @internal True when an attribute/property name is raw CSS text. */
export function isCssTextAttributeName(name: string): boolean {
  return securityStringToLowerCase(name) === 'style';
}

/** @internal True when an attribute/property name is raw HTML insertion. */
export function isRawHtmlSinkName(name: string): boolean {
  return securitySetHas(rawHtmlSinkNames, securityStringToLowerCase(name));
}

/** @internal True when an attribute/property name is a srcset candidate-list sink. */
export function isSrcsetAttributeName(name: string): boolean {
  return securitySetHas(srcsetAttributeNames, securityStringToLowerCase(name));
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
 * @internal Compiler-facing contextual output classification shared with runtime sinks.
 */
export function contextualOutputSinkFamilyForAttribute(name: string): RuntimeSinkFamily {
  return runtimeSinkFamilyForAttribute(name);
}

/**
 * @internal Decide a dynamic attribute write. Unsafe sinks return `remove`; unsafe plain URL
 * attributes return `neutralize` with `#` to preserve the existing server/browser ABI.
 */
export function decideRuntimeAttributeWrite(
  name: string,
  value: string,
  options: RuntimeAttributeWriteOptions = {},
): RuntimeSinkDecision {
  if (options.posture === 'dynamic-binding' && isGeneratedOnlySemanticAttribute(name)) {
    return blockedDecision(
      name,
      'framework-control',
      value,
      'dynamic binding cannot mint or replace compiler-generated control-plane markup',
    );
  }
  const family = runtimeSinkFamilyForAttribute(name);
  const elementContextDecision = decideRuntimeElementContextWrite(name, value, family, options);
  if (elementContextDecision !== undefined) return elementContextDecision;

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

  if (family === 'url' && options.trustedUrl !== true && hasUnsafeUrlScheme(value)) {
    return neutralizedDecision(name, family, '#', value, 'URL scheme is not allowed');
  }

  return { action: 'allow', family, value };
}

/**
 * SPEC §4.8 / §5.2 rule 10: some individually harmless attribute strings become executable or
 * remove isolation because of their element and sibling attributes. Dynamic writes either inert
 * the complete document-navigation primitive or preserve the compiler-reviewed live value.
 */
function decideRuntimeElementContextWrite(
  name: string,
  value: string,
  family: RuntimeSinkFamily,
  options: RuntimeAttributeWriteOptions,
): RuntimeSinkDecision | undefined {
  const tag = securityStringToLowerCase(options.elementName ?? '');
  const attribute = securityStringToLowerCase(name);

  if (tag === 'base') {
    return blockedDecision(
      name,
      family,
      value,
      'base elements cannot receive document-wide URL-resolution controls',
    );
  }
  if (tag === 'meta') {
    if (
      attribute === 'content' &&
      securityStringToLowerCase(securityStringTrim(options.effectiveHttpEquiv ?? '')) === 'refresh'
    ) {
      return blockedDecision(
        name,
        family,
        value,
        'meta refresh content is an executable document-navigation sink',
      );
    }
    if (
      options.posture === 'dynamic-binding' &&
      (attribute === 'http-equiv' || attribute === 'httpequiv') &&
      securityStringToLowerCase(securityStringTrim(value)) === 'refresh'
    ) {
      return blockedDecision(
        name,
        family,
        value,
        'dynamic meta refresh posture is an executable document-navigation sink',
      );
    }
  }

  const control = elementContextSecurityControl(tag, attribute);
  if (control === undefined) return undefined;
  if (options.posture !== 'dynamic-binding') {
    const issue = elementContextSecurityStaticValueIssue(tag, attribute, value);
    return issue === undefined ? undefined : blockedDecision(name, family, value, issue);
  }
  if (control.staticPolicy === 'disabled') {
    return blockedDecision(name, family, value, control.reason);
  }
  if (control.acceptsTrustedUrl && options.trustedUrl === true) return undefined;
  return preservedDecision(name, family, value, control.reason);
}

/** @internal Sanitize a srcset candidate list by dropping unsafe URL candidates. */
export function sanitizeRuntimeSrcset(value: string): string | null {
  const candidates = splitSrcsetCandidates(value);
  const safeCandidates: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const trimmed = securityStringTrim(candidate);
    if (!trimmed || hasUnsafeUrlScheme(trimmed)) continue;

    const urlEnd = firstAsciiWhitespaceIndex(trimmed);
    const url = urlEnd === -1 ? trimmed : securityStringSlice(trimmed, 0, urlEnd);
    const descriptor =
      urlEnd === -1 ? '' : securityStringTrim(securityStringSlice(trimmed, urlEnd));
    if (hasUnsafeUrlScheme(unquoteCssUrlToken(url))) continue;

    securityArrayAppend(safeCandidates, descriptor ? `${url} ${descriptor}` : url);
  }

  if (safeCandidates.length === 0) return null;
  let sanitized = '';
  for (let index = 0; index < safeCandidates.length; index += 1) {
    const candidate = safeCandidates[index];
    if (candidate === undefined) continue;
    sanitized += `${sanitized === '' ? '' : ', '}${candidate}`;
  }
  return sanitized || null;
}

/** @internal CSS url(...) backstop for focused property-sanitizer tests. */
export function hasUnsafeCssUrl(value: string): boolean {
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)]*?))\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = securityRegExpExec(pattern, value)) !== null) {
    const url = securityStringTrim(match[1] ?? match[2] ?? match[3] ?? '');
    if (hasUnsafeUrlScheme(url)) return true;
  }
  return false;
}

/** @internal CSS text backstop for parsed server/browser fragment attributes. */
export function hasUnsafeCssText(value: string): boolean {
  return (
    hasUnsafeCssUrl(value) ||
    securityRegExpTest(/\bexpression\s*\(/i, value) ||
    securityRegExpTest(/-moz-binding\s*:/i, value)
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
      securityArrayAppend(candidates, securityStringSlice(value, start, index));
      start = index + 1;
    }
  }

  securityArrayAppend(candidates, securityStringSlice(value, start));
  return candidates;
}

function firstAsciiWhitespaceIndex(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20) {
      return index;
    }
  }
  return -1;
}

function unquoteCssUrlToken(value: string): string {
  if (
    (value[0] === '"' && value[value.length - 1] === '"') ||
    (value[0] === "'" && value[value.length - 1] === "'")
  ) {
    return securityStringSlice(value, 1, -1);
  }
  return value;
}

function normalizedUrlForSchemeCheck(value: string): string {
  let normalized = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if ((code >= 0 && code <= 0x20) || (code >= 0x7f && code <= 0x9f)) continue;
    normalized += value[index] ?? '';
  }
  return normalized;
}

function hasHtmlColonReferenceInSchemePosition(value: string): boolean {
  let pathBoundary = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '/' || value[index] === '?') {
      pathBoundary = index;
      break;
    }
  }
  const schemePosition = pathBoundary < 0 ? value : securityStringSlice(value, 0, pathBoundary);
  return securityRegExpTest(htmlColonReferencePattern, schemePosition);
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

function preservedDecision(
  sink: string,
  family: RuntimeSinkFamily,
  value: string,
  reason: string,
): RuntimeSinkDecision {
  return {
    action: 'preserve',
    event: runtimeSinkSecurityEvent(sink, family, value, 'preserve', reason),
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

function fragmentHtmlObject(
  html: string,
  snapshots: WeakMap<object, string>,
): {
  readonly html: string;
  toJSON(): string;
  toString(): string;
} {
  const snapshot = securityString(html);
  const fragment = {
    html: snapshot,
    toJSON() {
      return snapshot;
    },
    toString() {
      return snapshot;
    },
  };
  securityWeakMapSet(snapshots, fragment, snapshot);
  return freezeSecurityValue(fragment);
}

function securitySetOf<T>(values: readonly T[]): Set<T> {
  const set = securitySet<T>();
  for (const value of values) securitySetAdd(set, value);
  return set;
}

function isDevelopmentOrTestRuntime(): boolean {
  const mode = runtimeMode();
  return mode === 'development' || mode === 'test';
}

function runtimeMode(): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env?.NODE_ENV;
}
