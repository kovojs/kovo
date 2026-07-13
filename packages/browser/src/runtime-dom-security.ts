import {
  createBrowserNavigationSecurityControls,
  type BrowserDelegatedEventSnapshot,
} from './navigation-security-intrinsics.js';
import {
  applySecurityIntrinsic,
  defineSecurityProperties,
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

export function addRuntimeEventListener(
  target: unknown,
  type: string,
  listener: (event: any) => void,
  options?: unknown,
): boolean {
  if (runtimeDomSecurity) {
    return runtimeDomSecurity.addLifecycleEventListener(target, type, listener, options);
  }
  const method = runtimeStructuralMethod(target, 'addEventListener');
  if (!method) return false;
  try {
    applySecurityIntrinsic(
      method,
      target,
      options === undefined ? [type, listener] : [type, listener, options],
    );
    return true;
  } catch {
    return false;
  }
}

export function removeRuntimeEventListener(
  target: unknown,
  type: string,
  listener: (event: any) => void,
  options?: unknown,
): boolean {
  if (runtimeDomSecurity) {
    return runtimeDomSecurity.removeLifecycleEventListener(target, type, listener, options);
  }
  const method = runtimeStructuralMethod(target, 'removeEventListener');
  if (!method) return false;
  try {
    applySecurityIntrinsic(
      method,
      target,
      options === undefined ? [type, listener] : [type, listener, options],
    );
    return true;
  } catch {
    return false;
  }
}

/** Resolve the first matching live DOM element through boot-witnessed selector controls. */
export function queryRuntimeElement(root: unknown, selector: string): object | null {
  if (root === null || typeof root !== 'object') return null;
  if (runtimeDomSecurity) {
    const one = runtimeDomSecurity.queryOne(root, selector);
    if (one) return one;
    const values = runtimeDomSecurity.queryAllElements(root, selector);
    return values[0] ?? null;
  }
  const queryOne = runtimeStructuralMethod(root, 'querySelector');
  if (queryOne) {
    try {
      const value = applySecurityIntrinsic<unknown>(queryOne, root, [selector]);
      if (value !== null && typeof value === 'object') return value;
    } catch {}
  }
  const queryAll = runtimeStructuralMethod(root, 'querySelectorAll');
  if (!queryAll) return null;
  try {
    const values = applySecurityIntrinsic<unknown>(queryAll, root, [selector]);
    if (values === null || typeof values !== 'object') return null;
    const first = securityGetOwnPropertyDescriptor(values, 0);
    if (first && 'value' in first && first.value !== null && typeof first.value === 'object') {
      return first.value;
    }
    for (const value of values as Iterable<unknown>) {
      return value !== null && typeof value === 'object' ? value : null;
    }
  } catch {}
  return null;
}

/** Read authoritative text through the boot-witnessed Node.textContent getter. */
export function readRuntimeNodeTextContent(node: unknown): string | null {
  if (node === null || typeof node !== 'object') return null;
  if (runtimeDomSecurity) return runtimeDomSecurity.readNodeTextContent(node);
  const descriptor = securityGetOwnPropertyDescriptor(node, 'textContent');
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : null;
}

/** Commit authoritative text through the boot-witnessed Node.textContent setter. */
export function setRuntimeNodeTextContent(node: unknown, value: string): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (runtimeDomSecurity) {
    try {
      runtimeDomSecurity.setNodeTextContent(node, value);
      return runtimeDomSecurity.readNodeTextContent(node) === value;
    } catch {
      return false;
    }
  }
  const descriptor = securityGetOwnPropertyDescriptor(node, 'textContent');
  if (descriptor && 'value' in descriptor && descriptor.writable === true) {
    defineSecurityProperties(node, {
      textContent: { ...descriptor, value },
    });
    return securityGetOwnPropertyDescriptor(node, 'textContent')?.value === value;
  }
  const setter = runtimeStructuralSetter(node, 'textContent');
  if (!setter) return false;
  try {
    applySecurityIntrinsic(setter, node, [value]);
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

function runtimeStructuralSetter(
  value: object,
  property: PropertyKey,
): ((next: unknown) => void) | undefined {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      return 'set' in descriptor && isRuntimeCallable(descriptor.set) ? descriptor.set : undefined;
    }
    owner = securityGetPrototypeOf(owner);
  }
  return undefined;
}

function isRuntimeCallable(value: unknown): value is (...args: any[]) => unknown {
  return typeof value === 'function';
}
