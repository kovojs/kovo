import type { EventElementLike, EventTargetLike } from './events.js';
import type { UploadProgress } from './mutation-fetch.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import {
  securityGetOwnPropertyDescriptor,
  securitySet,
  securitySetAdd,
  securitySetDelete,
  securitySetHas,
} from './security-witness-intrinsics.js';
import { closestRuntimeElement } from './runtime-dom-security.js';

// C210 / SPEC §6.6/§9.2: capture native form submission while the framework module graph loads,
// before authored client code can replace HTMLFormElement.prototype.submit.
const browserFormSecurity = createBrowserNavigationSecurityControls();
const browserFormDocumentRealm = typeof document !== 'undefined';

export const enhancedMutationFormSelector = 'form[enhance],form[data-enhance],form[data-mutation]';

export interface EnhancedMutationFormLike {
  action: string;
  getAttribute?(name: string): string | null;
  method?: string | undefined;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedFormElementLike extends EventElementLike {
  action: string;
  id?: string | undefined;
  method?: string | undefined;
  requestSubmit?: (submitter?: unknown) => void;
  submit?: () => void;
}

/** Immutable transport facts derived before Kovo prevents the native submit (SPEC §§6.3, 7, 9.1). */
export interface EnhancedMutationTransport {
  readonly action: string;
  readonly method: 'POST';
  readonly origin: string;
  /** Canonical source document URL: origin + pathname + search, never the fragment. */
  readonly sourceUrl: string;
}

// A requestSubmit() fallback synchronously emits one new submit event. That event must pass through
// to the browser instead of being intercepted into the failed enhanced path again.
const nativeFallbackForms = securitySet<object>();

export function closestEnhancedMutationForm(
  target: EventTargetLike | undefined | null,
): EnhancedFormElementLike | null {
  const form = closestRuntimeElement<EnhancedFormElementLike>(target, enhancedMutationFormSelector);
  return form && isEnhancedForm(form) ? form : null;
}

export function fallbackEnhancedMutationSubmit(
  form: EnhancedFormElementLike,
  submitter?: unknown,
): void {
  securitySetAdd(nativeFallbackForms, form);
  const submitted = browserFormSecurity.requestSubmitForm(form, submitter);
  // Native requestSubmit dispatch is synchronous. Remove a marker left behind by a structural fake
  // or a validation-blocked form so a later real user submit is never skipped accidentally.
  securitySetDelete(nativeFallbackForms, form);
  if (submitted) return;

  form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
  form.setAttribute?.('kovo-error', '');
}

/** @internal Test whether this form is emitting its one synchronous native fallback submit. */
export function isEnhancedMutationNativeFallback(form: EnhancedFormElementLike): boolean {
  return securitySetHas(nativeFallbackForms, form);
}

/** @internal Consume the one native fallback submit emitted by requestSubmit(). */
export function consumeEnhancedMutationNativeFallback(form: EnhancedFormElementLike): boolean {
  if (!securitySetHas(nativeFallbackForms, form)) return false;
  securitySetDelete(nativeFallbackForms, form);
  return true;
}

export function isEnhancedForm(form: EnhancedMutationFormLike | EventElementLike): boolean {
  return (
    browserFormSecurity.readAttribute(form, 'enhance') !== null ||
    browserFormSecurity.readAttribute(form, 'data-enhance') !== null ||
    browserFormSecurity.readAttribute(form, 'data-mutation') !== null
  );
}

/** @internal True only for a compiler-owned typed mutation form identity. */
export function hasTypedMutationIdentity(
  form: EnhancedMutationFormLike | EventElementLike,
): boolean {
  const mutationKey = browserFormSecurity.readAttribute(form, 'data-mutation');
  return typeof mutationKey === 'string' && mutationKey.length > 0;
}

/** @internal Prevent a tampered typed form from falling through to native token submission. */
export function markInvalidTypedMutationTransport(form: EnhancedFormElementLike): void {
  form.setAttribute?.('data-error-code', 'INVALID_MUTATION_TRANSPORT');
  form.setAttribute?.('kovo-error', '');
}

export function readEligibleEnhancedMutationTransport(
  form: EnhancedMutationFormLike,
  submitter?: unknown,
): EnhancedMutationTransport | undefined {
  if (!isEnhancedForm(form)) return undefined;
  // `data-mutation` is compiler-owned typed mutation identity. Raw `enhance` is not enough to
  // authorize credential-bearing enhanced transport (SPEC §§6.3, 7, 9.1).
  const mutationKey = browserFormSecurity.readAttribute(form, 'data-mutation');
  if (!mutationKey) return undefined;

  const submitterObject =
    submitter !== null && typeof submitter === 'object' ? (submitter as object) : undefined;
  const method =
    (submitterObject
      ? (browserFormSecurity.readAttribute(submitterObject, 'formmethod') ??
        ownStringData(submitterObject, 'formMethod'))
      : undefined) ??
    browserFormSecurity.readAttribute(form, 'method') ??
    ownStringData(form, 'method') ??
    'get';
  if (browserFormSecurity.upper(method) !== 'POST') return undefined;

  // A submit button's formaction/formmethod overrides are the effective native transport. Derive
  // them before preventDefault; a non-mutation override must remain an ordinary browser submit.
  const rawAction =
    (submitterObject
      ? (browserFormSecurity.readAttribute(submitterObject, 'formaction') ??
        ownStringData(submitterObject, 'formAction'))
      : undefined) ??
    browserFormSecurity.readAttribute(form, 'action') ??
    ownStringData(form, 'action') ??
    '';
  // A browser document without the effective-origin witness is opaque/sandboxed authority, not a
  // localhost document. Structural browser-free callers get their deterministic fallback from the
  // navigation controls themselves; this browser transport choke must fail closed (SPEC §6.6/§9.1).
  const current =
    browserFormSecurity.currentUrl() ??
    (browserFormDocumentRealm ? undefined : browserFormSecurity.parseUrl('http://localhost/'));
  if (!current) return undefined;
  const documentBase = browserFormSecurity.documentBaseUrl();
  if (!documentBase) return undefined;
  // Empty action attributes have special native current-document semantics; non-empty relative
  // attributes resolve against Document.baseURI (including a same-origin `<base>`), not Location.
  const action = browserFormSecurity.parseUrl(
    rawAction || current.href,
    rawAction ? documentBase.href : current.href,
  );
  // SPEC §§6.3/6.6/9.1: `data:`, `blob:`, `file:`, and `about:` URLs can all serialize origin as
  // `null`. Equality between two opaque origins is not same-origin proof for credentialed fetch.
  if (
    action === undefined ||
    current.origin === 'null' ||
    (current.protocol !== 'http:' && current.protocol !== 'https:') ||
    action.origin === 'null' ||
    (action.protocol !== 'http:' && action.protocol !== 'https:') ||
    action.origin !== current.origin ||
    action.pathname !== `/_m/${mutationKey}` ||
    action.search !== '' ||
    action.hash !== ''
  ) {
    return undefined;
  }

  return {
    action: action.pathname,
    method: 'POST',
    origin: current.origin,
    sourceUrl: current.origin + current.pathname + current.search,
  };
}

/**
 * @internal Recover server truth after an enhanced mutation may already have reached the server.
 *
 * Re-submitting the form here would create a second logical POST and can mint a different replay
 * key. A canonical GET navigation to the snapshotted source document is the only automatic
 * recovery; environments without a navigation control receive a visible form failure instead.
 */
export function recoverEnhancedMutationDocument(
  form: EnhancedFormElementLike,
  transport: EnhancedMutationTransport,
): void {
  if (browserFormSecurity.navigateSameOrigin(transport.sourceUrl)) return;
  if (browserFormSecurity.hasReloadControl()) {
    browserFormSecurity.reload();
    return;
  }
  form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
  form.setAttribute?.('kovo-error', '');
}

export function isEligibleEnhancedMutationForm(
  form: EnhancedFormElementLike,
  submitter?: unknown,
): boolean {
  return readEligibleEnhancedMutationTransport(form, submitter) !== undefined;
}

function ownStringData(value: object, property: PropertyKey): string | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

export function updateUploadProgressElements(
  form: EventElementLike,
  progress: UploadProgress,
): void {
  const progressElements = form.querySelectorAll?.('[kovo-upload-progress]') ?? [];
  const total = progress.total;
  const value =
    total !== undefined && total > 0
      ? Math.min(100, Math.round((progress.loaded / total) * 100))
      : undefined;

  for (const element of progressElements) {
    element.setAttribute('max', '100');
    if (value === undefined) {
      element.removeAttribute?.('value');
      continue;
    }
    element.setAttribute('value', String(value));
  }
}
