import {
  createBrowserNavigationSecurityControls,
  type BrowserDelegatedEventSnapshot,
} from './navigation-security-intrinsics.js';
import {
  applySecurityIntrinsic,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
} from './security-witness-intrinsics.js';

// SPEC §6.6 rule 6: this module is evaluated by the framework bootstrap before authored client
// modules. Browser decisions use the witnessed native DOM/Event controls captured at that point.
// The structural fallback keeps browser-free conformance fakes usable; real browser Elements and
// Events never consult a later-mutated prototype.
const runtimeDomSecurity =
  typeof document === 'undefined' || typeof Element === 'undefined' || typeof Event === 'undefined'
    ? undefined
    : createBrowserNavigationSecurityControls();

export function readRuntimeElementAttribute(element: unknown, name: string): string | null {
  if (runtimeDomSecurity) return runtimeDomSecurity.readAttribute(element, name);
  const method = runtimeStructuralMethod(element, 'getAttribute');
  if (!method) return null;
  try {
    const value = applySecurityIntrinsic<unknown>(method, element, [name]);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function closestRuntimeElement<Value extends object>(
  element: unknown,
  selector: string,
): Value | null {
  if (runtimeDomSecurity) {
    return runtimeDomSecurity.closestElement(element, selector) as Value | null;
  }
  const method = runtimeStructuralMethod(element, 'closest');
  if (!method) return null;
  try {
    const value = applySecurityIntrinsic<unknown>(method, element, [selector]);
    return value !== null && typeof value === 'object' ? (value as Value) : null;
  } catch {
    return null;
  }
}

export function runtimeElementContains(element: unknown, node: object | null): boolean {
  if (element === null || typeof element !== 'object') return false;
  if (runtimeDomSecurity) {
    try {
      return runtimeDomSecurity.elementContains(element, node);
    } catch {
      return false;
    }
  }
  const method = runtimeStructuralMethod(element, 'contains');
  if (!method) return false;
  try {
    return applySecurityIntrinsic(method, element, [node]) === true;
  } catch {
    return false;
  }
}

export function snapshotRuntimeDelegatedEvent(
  event: unknown,
): BrowserDelegatedEventSnapshot | undefined {
  if (runtimeDomSecurity) return runtimeDomSecurity.snapshotDelegatedEvent(event);
  if (event === null || typeof event !== 'object') return undefined;
  const type = runtimeOwnData(event, 'type');
  const target = runtimeOwnData(event, 'target');
  if (
    typeof type !== 'string' ||
    type.length === 0 ||
    (target !== null && typeof target !== 'object')
  ) {
    return undefined;
  }
  const relatedTarget = runtimeOwnData(event, 'relatedTarget');
  const button = runtimeOwnData(event, 'button');
  return {
    altKey: runtimeOwnData(event, 'altKey') === true,
    button: typeof button === 'number' ? button : 0,
    cancelable: runtimeOwnData(event, 'cancelable') === true,
    ctrlKey: runtimeOwnData(event, 'ctrlKey') === true,
    defaultPrevented: runtimeOwnData(event, 'defaultPrevented') === true,
    metaKey: runtimeOwnData(event, 'metaKey') === true,
    relatedTarget:
      relatedTarget !== null && typeof relatedTarget === 'object' ? relatedTarget : null,
    shiftKey: runtimeOwnData(event, 'shiftKey') === true,
    submitter: runtimeOwnData(event, 'submitter'),
    target,
    type,
  };
}

export function preventRuntimeDelegatedEventDefault(event: unknown): boolean {
  if (runtimeDomSecurity) return runtimeDomSecurity.preventDelegatedEventDefault(event);
  const method = runtimeStructuralMethod(event, 'preventDefault');
  if (!method) return false;
  try {
    applySecurityIntrinsic(method, event, []);
    return true;
  } catch {
    return false;
  }
}

export function setRuntimeElementAttribute(element: unknown, name: string, value: string): boolean {
  if (element === null || typeof element !== 'object') return false;
  if (runtimeDomSecurity) {
    try {
      runtimeDomSecurity.setElementAttribute(element, name, value);
      return true;
    } catch {
      return false;
    }
  }
  const method = runtimeStructuralMethod(element, 'setAttribute');
  if (!method) return false;
  try {
    applySecurityIntrinsic(method, element, [name, value]);
    return true;
  } catch {
    return false;
  }
}

export function createRuntimeFormData(form: object, submitter?: unknown): FormData {
  if (runtimeDomSecurity) {
    return runtimeDomSecurity.createFormData(
      form as HTMLFormElement,
      submitter as HTMLElement | null | undefined,
    );
  }
  const StructuralFormData = globalThis.FormData;
  if (!StructuralFormData)
    throw new TypeError('Kovo form-data constructor control is unavailable.');
  return new StructuralFormData(
    form as HTMLFormElement,
    submitter as HTMLElement | null | undefined,
  );
}

function runtimeOwnData(value: object, property: PropertyKey): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(value, property);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function runtimeStructuralMethod(
  value: unknown,
  property: PropertyKey,
): ((...args: any[]) => unknown) | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  // Browser-free fakes expose class-prototype methods. This fallback is deliberately bounded and
  // is not reached for platform objects in the supported browser realm.
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      return 'value' in descriptor && isRuntimeCallable(descriptor.value)
        ? descriptor.value
        : undefined;
    }
    owner = securityGetPrototypeOf(owner);
  }
  return undefined;
}

function isRuntimeCallable(value: unknown): value is (...args: any[]) => unknown {
  return typeof value === 'function';
}
