import {
  securityJsonStringify,
  securityNumber,
  securityString,
  securityStringToLowerCase,
} from './security-witness-intrinsics.js';

// SPEC.md §4.8 / data-bind-prop plan: reactive *live-property* binding.
//
// `data-bind:<attr>` is attribute-only (setAttribute/removeAttribute). That is
// correct for most attributes, but several DOM attributes are
// property-authoritative: once the property is "dirty" (touched by the user or
// script) the browser stops reflecting attribute writes onto the property.
// `data-bind-prop:<prop>` complements the SSR attribute by assigning the live
// element property after every derive/morph re-render.
//
// Security (SPEC §4.8 KV236): the property set is a CLOSED allowlist of
// property-authoritative form/scroll/open state. It never reaches an unsafe sink
// (`innerHTML`/`outerHTML`/`srcdoc`/`on*`) — those stay forbidden. The compiler
// emits this stamp only for the same allowlist, so the runtime allowlist is a
// defensive second wall: a `data-bind-prop:<prop>` whose prop is not allowlisted
// is ignored.

/** Prefix for the live-property binding stamp (SPEC §4.8 data-bind-prop). */
export const BIND_PROP_PREFIX = 'data-bind-prop:';

/**
 * Per-property coercion kind. Maps the bound value (which arrives as the same
 * `''`/`null` boolean-presence or string/number form as the companion
 * `data-bind:<attr>`) to the live property's type.
 */
type BindPropKind = 'boolean' | 'number' | 'string';

interface BindPropSpec {
  kind: BindPropKind;
  property: keyof BindPropElement;
}

// SPEC §4.8: classify with exact branches rather than a structurally indexed
// object. App code shares this realm and may pollute Object.prototype or replace
// ambient Object/String methods; neither operation may add a property sink to
// the closed allowlist.
function bindPropSpec(suffix: string): BindPropSpec | null {
  switch (securityStringToLowerCase(suffix)) {
    case 'checked':
      return { kind: 'boolean', property: 'checked' };
    case 'indeterminate':
      return { kind: 'boolean', property: 'indeterminate' };
    case 'open':
      return { kind: 'boolean', property: 'open' };
    case 'scrollleft':
      return { kind: 'number', property: 'scrollLeft' };
    case 'scrolltop':
      return { kind: 'number', property: 'scrollTop' };
    case 'selected':
      return { kind: 'boolean', property: 'selected' };
    case 'value':
      return { kind: 'string', property: 'value' };
    default:
      return null;
  }
}

/**
 * Resolve the canonical (cased) property name for a `data-bind-prop:` suffix,
 * or `null` when the property is not on the security allowlist.
 */
export function canonicalBindProp(suffix: string): string | null {
  return bindPropSpec(suffix)?.property ?? null;
}

/**
 * Element shape touched by the live-property writer. Properties are optional so
 * a non-form/non-scroll element silently ignores writes (the property is absent).
 */
export interface BindPropElement {
  checked?: boolean;
  indeterminate?: boolean;
  localName?: string;
  open?: boolean;
  scrollLeft?: number;
  scrollTop?: number;
  selected?: boolean;
  tagName?: string;
  value?: string;
}

/**
 * Assign a live element property for an allowlisted `data-bind-prop:<prop>`.
 *
 * `value` arrives in the same shape as the companion `data-bind:<attr>` write:
 * boolean-presence attributes use `''`/`true` (present) vs `null`/`false`
 * (absent); strings/numbers are passed through. Non-allowlisted props and
 * elements that lack the property are no-ops.
 */
export function applyBindProp(element: BindPropElement, suffix: string, value: unknown): void {
  const spec = bindPropSpec(suffix);
  if (spec === null) return;
  const prop = spec.property;
  // The element must expose the fixed property (e.g. only inputs have `.checked`).
  if ((element as Record<string, unknown>)[prop] === undefined) return;

  if (spec.kind === 'boolean') {
    // Boolean-presence semantics: present (`''`/`true`) → true; absent
    // (`null`/`undefined`/`false`) → false.
    (element as Record<string, unknown>)[prop] = value != null && value !== false;
    return;
  }
  if (spec.kind === 'number') {
    (element as Record<string, unknown>)[prop] = securityNumber(value) || 0;
    return;
  }
  // string (value). `<progress>` is the exception: its `.value` is not a
  // dirty/user-interactive property, and a null value means *indeterminate* (no
  // attribute), so writing `.value = ''` would wrongly force it determinate. The
  // companion data-bind:value attribute already owns progress correctly, mirroring
  // the existing shouldClearRemovedValueProperty carve-out.
  if (isProgressElement(element)) return;
  (element as Record<string, unknown>)[prop] = formatBindPropString(value);
}

function isProgressElement(element: BindPropElement): boolean {
  const name = element.localName ?? element.tagName;
  return typeof name === 'string' && securityStringToLowerCase(name) === 'progress';
}

function formatBindPropString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return securityString(value);
  }
  if (typeof value === 'object') return securityJsonStringify(value) ?? '';
  return '';
}
