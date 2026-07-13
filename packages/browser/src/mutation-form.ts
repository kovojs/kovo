import type { EventElementLike, EventTargetLike } from './events.js';
import type { UploadProgress } from './mutation-fetch.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { securityGetOwnPropertyDescriptor } from './security-witness-intrinsics.js';

// C210 / SPEC §6.6/§9.2: capture native form submission while the framework module graph loads,
// before authored client code can replace HTMLFormElement.prototype.submit.
const browserFormSecurity = createBrowserNavigationSecurityControls();

export const enhancedMutationFormSelector = 'form[enhance],form[data-enhance],form[data-mutation]';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedFormElementLike extends EventElementLike {
  action: string;
  id?: string | undefined;
  method?: string | undefined;
  submit?: () => void;
}

export function closestEnhancedMutationForm(
  target: EventTargetLike | undefined | null,
): EnhancedFormElementLike | null {
  const form = target?.closest?.(enhancedMutationFormSelector) as
    | EnhancedFormElementLike
    | null
    | undefined;
  return form && isEnhancedForm(form) ? form : null;
}

export function fallbackEnhancedMutationSubmit(form: EnhancedFormElementLike): void {
  if (browserFormSecurity.submitForm(form)) return;

  form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
  form.setAttribute?.('kovo-error', '');
}

export function isEnhancedForm(form: EventElementLike): boolean {
  return (
    browserFormSecurity.readAttribute(form, 'enhance') !== null ||
    browserFormSecurity.readAttribute(form, 'data-enhance') !== null ||
    browserFormSecurity.readAttribute(form, 'data-mutation') !== null
  );
}

export function isEligibleEnhancedMutationForm(form: EnhancedFormElementLike): boolean {
  if (!isEnhancedForm(form)) return false;
  const method =
    browserFormSecurity.readAttribute(form, 'method') ?? ownStringData(form, 'method') ?? 'get';
  if (browserFormSecurity.upper(method) !== 'POST') return false;

  // Real forms carry the author-written action as an attribute; the exact-own fallback keeps
  // browser-free conformance fakes without consulting a caller-controlled prototype/accessor.
  const rawAction =
    browserFormSecurity.readAttribute(form, 'action') ?? ownStringData(form, 'action') ?? '';
  const current =
    browserFormSecurity.currentUrl() ?? browserFormSecurity.parseUrl('http://localhost/');
  if (!current) return false;
  const action = browserFormSecurity.parseUrl(rawAction || current.href, current.href);
  return (
    action !== undefined &&
    action.origin === current.origin &&
    browserFormSecurity.slice(action.pathname, 0, 4) === '/_m/'
  );
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
