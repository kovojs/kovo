/**
 * @internal Generated and semantic HTML attribute policy shared by compiler gates
 * and integration snapshot serialization (SPEC.md §4.8, §5.2 rule 3).
 */
export { SEMANTIC_ATTRIBUTE_MANIFEST } from './semantic-attribute-manifest.js';
import { SEMANTIC_ATTRIBUTE_MANIFEST } from './semantic-attribute-manifest.js';

freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.attributes);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.prefixes);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.compilerOwnedResidual.attributes);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.compilerOwnedResidual.prefixes);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.compilerOwnedResidual);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.controlPlane.attributes);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.controlPlane.prefixes);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.controlPlane);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.semanticSnapshot);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.accessible);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST.behavioral);
freezeSecurityValue(SEMANTIC_ATTRIBUTE_MANIFEST);

/** @internal */
export const GENERATED_ONLY_SEMANTIC_ATTRIBUTES =
  SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.attributes;

/** @internal */
export const GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES =
  SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.prefixes;

/** @internal */
export const COMPILER_OWNED_RESIDUAL_ATTRIBUTES =
  SEMANTIC_ATTRIBUTE_MANIFEST.compilerOwnedResidual.attributes;

/** @internal */
export const COMPILER_OWNED_RESIDUAL_ATTRIBUTE_PREFIXES =
  SEMANTIC_ATTRIBUTE_MANIFEST.compilerOwnedResidual.prefixes;

/** @internal */
export const KOVO_CONTROL_PLANE_ATTRIBUTES = SEMANTIC_ATTRIBUTE_MANIFEST.controlPlane.attributes;

/** @internal */
export const KOVO_CONTROL_PLANE_ATTRIBUTE_PREFIXES =
  SEMANTIC_ATTRIBUTE_MANIFEST.controlPlane.prefixes;

/** @internal */
export const KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES = SEMANTIC_ATTRIBUTE_MANIFEST.semanticSnapshot;

/** @internal */
export const ACCESSIBLE_SEMANTIC_ATTRIBUTES = SEMANTIC_ATTRIBUTE_MANIFEST.accessible;

/** @internal */
export const BEHAVIORAL_SEMANTIC_ATTRIBUTES = SEMANTIC_ATTRIBUTE_MANIFEST.behavioral;

const generatedOnlyAttributeNames = securitySet<string>();
for (let index = 0; index < GENERATED_ONLY_SEMANTIC_ATTRIBUTES.length; index += 1) {
  securitySetAdd(generatedOnlyAttributeNames, GENERATED_ONLY_SEMANTIC_ATTRIBUTES[index]!);
}

const controlPlaneAttributeNames = securitySet<string>();
for (let index = 0; index < KOVO_CONTROL_PLANE_ATTRIBUTES.length; index += 1) {
  securitySetAdd(controlPlaneAttributeNames, KOVO_CONTROL_PLANE_ATTRIBUTES[index]!);
}

const compilerOwnedResidualAttributeNames = securitySet<string>();
for (let index = 0; index < COMPILER_OWNED_RESIDUAL_ATTRIBUTES.length; index += 1) {
  securitySetAdd(compilerOwnedResidualAttributeNames, COMPILER_OWNED_RESIDUAL_ATTRIBUTES[index]!);
}

/** @internal True when a framework-emitted attribute is ignored by render-equivalence. */
export function isGeneratedOnlySemanticAttribute(name: string): boolean {
  const normalizedName = securityStringToLowerCase(name);
  if (securitySetHas(generatedOnlyAttributeNames, normalizedName)) return true;
  for (let index = 0; index < GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES.length; index += 1) {
    if (
      securityStringStartsWith(normalizedName, GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES[index]!)
    ) {
      return true;
    }
  }
  return false;
}

/** @internal True when an opaque carrier name belongs to Kovo's control plane. */
export function isKovoControlPlaneAttribute(name: string): boolean {
  const normalizedName = securityStringToLowerCase(name);
  if (securitySetHas(controlPlaneAttributeNames, normalizedName)) return true;
  for (let index = 0; index < KOVO_CONTROL_PLANE_ATTRIBUTE_PREFIXES.length; index += 1) {
    if (securityStringStartsWith(normalizedName, KOVO_CONTROL_PLANE_ATTRIBUTE_PREFIXES[index]!)) {
      return true;
    }
  }
  return false;
}

/** @internal True when app TSX is attempting to author compiler-owned residual wire IR. */
export function isCompilerOwnedResidualAttribute(name: string): boolean {
  const normalizedName = securityStringToLowerCase(name);
  if (securitySetHas(compilerOwnedResidualAttributeNames, normalizedName)) return true;
  for (let index = 0; index < COMPILER_OWNED_RESIDUAL_ATTRIBUTE_PREFIXES.length; index += 1) {
    if (
      securityStringStartsWith(normalizedName, COMPILER_OWNED_RESIDUAL_ATTRIBUTE_PREFIXES[index]!)
    ) {
      return true;
    }
  }
  return false;
}
import {
  freezeSecurityValue,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityStringCharCodeAt,
  securityStringStartsWith,
  securityStringToLowerCase,
} from './security-witness-intrinsics.js';

/** @internal The browser boundary a server-authored string must survive without aliasing. */
export type HtmlWireValuePosture =
  | 'dom-identity'
  | 'multiline-content'
  | 'option-fallback'
  | 'submitted-control';

/** @internal Why a server-authored string cannot retain its identity at the selected boundary. */
export type HtmlWireValueIssue =
  | 'carriage-return'
  | 'line-feed'
  | 'nul'
  | 'option-whitespace'
  | 'unpaired-surrogate';

/** @internal A lossy browser rule that depends on more than one HTML attribute. */
export type HtmlElementWireValueIssue = 'reserved-charset-hidden-control';

/**
 * @internal Find the first lossy HTML/form wire condition in a server-authored string.
 *
 * SPEC §13.2 requires Kovo's rendered, submitted, and morph identities to remain the same string.
 * HTML input preprocessing replaces NUL, normalizes CR/CRLF, and UTF-8 serialization replaces
 * unpaired UTF-16 surrogates. Native form serialization additionally normalizes every line ending
 * in successful control names/values to CRLF. That rewrite is forbidden for routing/identity
 * values but accepted for ordinary multiline textarea content. An option without `value` also
 * strips and collapses ASCII whitespace when deriving its submitted value. Keep these rules in one
 * boot-pinned predicate so compiler diagnostics and runtime sinks cannot drift.
 */
export function htmlWireValueIssue(
  value: string,
  posture: HtmlWireValuePosture,
): HtmlWireValueIssue | undefined {
  let previous = -1;
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code === 0x0000) return 'nul';
    if (code === 0x000d && posture !== 'multiline-content') return 'carriage-return';
    if (code === 0x000a && posture !== 'dom-identity' && posture !== 'multiline-content') {
      return 'line-feed';
    }
    if (
      posture === 'option-fallback' &&
      (code === 0x0009 ||
        code === 0x000c ||
        (code === 0x0020 && (index === 0 || previous === 0x0020)))
    ) {
      return 'option-whitespace';
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = index + 1 < value.length ? securityStringCharCodeAt(value, index + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) return 'unpaired-surrogate';
      index += 1;
      previous = next;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return 'unpaired-surrogate';
    previous = code;
  }
  if (
    posture === 'option-fallback' &&
    value.length > 0 &&
    securityStringCharCodeAt(value, value.length - 1) === 0x0020
  ) {
    return 'option-whitespace';
  }
  return undefined;
}

/** @internal True only when `value` survives the selected HTML/form boundary injectively. */
export function isHtmlWireValueStable(value: string, posture: HtmlWireValuePosture): boolean {
  return htmlWireValueIssue(value, posture) === undefined;
}

/** @internal Fail closed before a lossy server-authored identity reaches HTML output. */
export function assertHtmlWireValueStable(
  value: string,
  posture: HtmlWireValuePosture,
  sink: string,
): string {
  const issue = htmlWireValueIssue(value, posture);
  if (issue !== undefined) {
    throw new TypeError(
      `KV236: ${sink} is not stable across server HTML and native form serialization (${issue}); SPEC §13.2 forbids emitting aliased runtime identity or substituted control content.`,
    );
  }
  return value;
}

/**
 * @internal Classify browser rewrites that require an element's combined attribute posture.
 *
 * HTML reserves an ASCII-case-insensitive `_charset_` name on hidden inputs. During native form
 * entry-list construction the browser replaces that control's authored value with the selected
 * encoding label (currently `UTF-8`). Character-by-character value validation cannot observe this
 * cross-attribute substitution, so compiler and runtime sinks share this exact tuple predicate.
 */
export function htmlElementWireValueIssue(
  tagName: string,
  typeValue: string | undefined,
  nameValue: string | undefined,
): HtmlElementWireValueIssue | undefined {
  if (securityStringToLowerCase(tagName) !== 'input') return undefined;
  if (typeValue === undefined || securityStringToLowerCase(typeValue) !== 'hidden') {
    return undefined;
  }
  if (nameValue === undefined || securityStringToLowerCase(nameValue) !== '_charset_') {
    return undefined;
  }
  return 'reserved-charset-hidden-control';
}

/** @internal Fail closed before a browser-reserved control can substitute submitted authority. */
export function assertHtmlElementWireValueStable(
  tagName: string,
  typeValue: string | undefined,
  nameValue: string | undefined,
  sink: string,
): void {
  const issue = htmlElementWireValueIssue(tagName, typeValue, nameValue);
  if (issue === undefined) return;
  throw new TypeError(
    `KV236: ${sink} cannot combine <input type="hidden"> with the reserved name "_charset_" (${issue}); native form construction substitutes the encoding label, violating SPEC §13.2 and the SPEC §6.6 fail-closed sink boundary.`,
  );
}

/**
 * @internal Classify intrinsic JSX attributes whose strings route DOM or submitted authority.
 * Ordinary presentation attributes remain outside this fail-closed set.
 */
export function htmlAttributeWireValuePosture(
  tagName: string,
  attributeName: string,
): HtmlWireValuePosture | undefined {
  const tag = securityStringToLowerCase(tagName);
  const name = securityStringToLowerCase(attributeName);

  if (name === 'name') {
    if (
      tag === 'button' ||
      tag === 'input' ||
      tag === 'object' ||
      tag === 'select' ||
      tag === 'textarea'
    ) {
      return 'submitted-control';
    }
    if (tag === 'form' || tag === 'iframe' || tag === 'map' || tag === 'kovo-query') {
      return 'dom-identity';
    }
  }
  if (name === 'dirname' && (tag === 'input' || tag === 'textarea')) {
    return 'submitted-control';
  }
  if (name === 'value' && (tag === 'button' || tag === 'input' || tag === 'option')) {
    return 'submitted-control';
  }
  if (
    name === 'action' ||
    name === 'formaction' ||
    name === 'formenctype' ||
    name === 'formmethod' ||
    name === 'formtarget'
  ) {
    return 'submitted-control';
  }
  if (
    name === 'command' ||
    name === 'commandfor' ||
    name === 'for' ||
    name === 'form' ||
    name === 'id' ||
    name === 'key' ||
    name === 'list' ||
    name === 'popovertarget' ||
    name === 'target'
  ) {
    return 'dom-identity';
  }
  if (
    name === 'data-error-code' ||
    name === 'data-error-path' ||
    securityStringStartsWith(name, 'kovo-') ||
    securityStringStartsWith(name, 'data-kovo-') ||
    securityStringStartsWith(name, 'data-bind') ||
    securityStringStartsWith(name, 'data-derive') ||
    securityStringStartsWith(name, 'data-mutation') ||
    securityStringStartsWith(name, 'data-p-') ||
    securityStringStartsWith(name, 'data-stream-') ||
    securityStringStartsWith(name, 'on:')
  ) {
    return 'dom-identity';
  }
  if (
    (tag === 'kovo-query' && (name === 'settles' || name === 'version')) ||
    (tag === 'kovo-fragment' &&
      (name === 'error-boundary' || name === 'mode' || name === 'priority')) ||
    (tag === 'kovo-text' && name === 'mode') ||
    (tag === 'kovo-defer' && name === 'state') ||
    (tag === 'kovo-done' && name === 'reason') ||
    (tag === 'kovo-live' && name === 'query')
  ) {
    return 'dom-identity';
  }
  return undefined;
}

/** @internal Classify intrinsic element text that can become a successful submitted value. */
export function htmlTextWireValuePosture(
  tagName: string,
  hasExplicitValue: boolean,
): HtmlWireValuePosture | undefined {
  const tag = securityStringToLowerCase(tagName);
  if (tag === 'textarea') return 'multiline-content';
  if (tag === 'option' && !hasExplicitValue) return 'option-fallback';
  return undefined;
}
