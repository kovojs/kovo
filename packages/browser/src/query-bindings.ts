import { parseKovoModuleRef, type KovoModuleRef } from '@kovojs/core/internal/module-ref';
import { isBlockedSvgSmilElementName } from '@kovojs/core/internal/sink-policy';

import { applyBindProp, BIND_PROP_PREFIX } from './bind-prop.js';
import { domAttributes } from './dom-like.js';
import type {
  AttributeElementLike,
  ClosestElementLike,
  QuerySelectorAllRootLike,
} from './dom-like.js';
import { morphDomElement, sanitizeDomElementTree } from './morph.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import type { QueryStore } from './query-store.js';
import { kovoBoundAttributeValue } from './security-output.js';
import {
  applySecurityIntrinsic,
  securityArrayAppend,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
  securityJsonStringify,
  securityNumber,
  securityString,
  securityStringCharCodeAt,
  securityStringIndexOf,
  securityStringSlice,
  securityStringStartsWith,
  securityStringToLowerCase,
  securityStringTrim,
} from './security-witness-intrinsics.js';
import { kovoCreateHTML } from './trusted-types.js';
import { assertAllowedKovoDynamicImportRefForModule } from './dynamic-import-url.js';
import { reconcileKeyed } from './keyed-reconciler.js';
import { closestRuntimeElement, readRuntimeElementAttribute } from './runtime-dom-security.js';

// SPEC §6.6 rule 6: query-plan DOM selection, parsing, and commits use controls captured before any
// authored client module can replace realm prototypes. Browser-free structural fakes keep their
// explicit seam below; genuine platform Elements never dispatch through their live prototypes.
const browserQueryBindingSecurity =
  typeof document === 'undefined' || typeof Element === 'undefined'
    ? undefined
    : createBrowserNavigationSecurityControls(globalThis, kovoCreateHTML);

function requireBrowserQueryBindingSecurity(): NonNullable<typeof browserQueryBindingSecurity> {
  if (!browserQueryBindingSecurity) {
    throw new TypeError('Kovo query-binding DOM security controls are unavailable.');
  }
  return browserQueryBindingSecurity;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface QueryBindingElement
  extends AttributeElementLike, ClosestElementLike<QueryBindingElement> {
  checked?: boolean;
  indeterminate?: boolean;
  // SPEC §4.8 data-bind-prop: property-authoritative state set by the live
  // property write (in addition to the companion attribute).
  open?: boolean;
  scrollLeft?: number;
  scrollTop?: number;
  selected?: boolean;
  tagName?: string;
  textContent?: string | null;
  value?: string;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface QueryBindingRoot extends QuerySelectorAllRootLike<QueryBindingElement> {}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface TemplateStampItem {
  html: string;
  index: number;
  key: string;
  value: unknown;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface TemplateStampHost extends QueryBindingElement {
  reconcileTemplateStamp(items: readonly TemplateStampItem[]): void;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface CompiledQueryDerive {
  name: string;
  select(value: unknown, root: QueryBindingRoot, context: CompiledQueryUpdateContext): unknown;
  selector?: string;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface CompiledQueryStamp {
  attr: string;
  select(value: unknown, root: QueryBindingRoot, context: CompiledQueryUpdateContext): unknown;
  selector: string;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface CompiledQueryTemplateStamp {
  key: string | ((item: unknown, index: number) => string | number);
  list: string;
  render(item: unknown, index: number): string;
  selector: string;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface CompiledQueryUpdatePlan {
  bindings?: boolean;
  derives?: readonly CompiledQueryDerive[];
  stamps?: readonly CompiledQueryStamp[];
  templateStamps?: readonly CompiledQueryTemplateStamp[];
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface AppliedCompiledQueryUpdatePlan {
  bindings: string[];
  derives: string[];
  stamps: string[];
  templateStamps: string[];
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export type CompiledQueryUpdatePlans = Readonly<
  Record<string, CompiledQueryUpdatePlan | undefined>
>;

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface QueryBindingIndex {
  attributeBindingElements: readonly QueryBindingElement[];
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface ApplyQueryBindingsOptions {
  bindingIndex?: QueryBindingIndex;
  queryKey?: string;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface ApplyStateBindingsOptions extends ApplyQueryBindingsOptions {
  importModule?: (url: string) => Promise<Record<string, unknown>>;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface ApplyCompiledQueryUpdatePlanOptions extends ApplyQueryBindingsOptions {
  queryStore?: QueryStore;
}

/** Runtime API used by generated runtime integration. */
export interface CompiledQueryUpdateContext {
  queryStore?: QueryStore;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function createQueryBindingIndex(root: QueryBindingRoot): QueryBindingIndex {
  return {
    attributeBindingElements: queryAttributeBindingElements(root),
  };
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function applyQueryBindings(
  root: QueryBindingRoot,
  queryName: string,
  value: unknown,
  options: ApplyQueryBindingsOptions = {},
): string[] {
  return applyRootBindings(root, queryName, value, options);
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function applyStateBindings(
  root: QueryBindingRoot,
  state: unknown,
  options: ApplyStateBindingsOptions = {},
): Promise<string[]> {
  const applied = applyRootBindings(root, 'state', state, { ...options, scopeRoot: root });
  return applyStateDeriveBindings(root, state, applied, options);
}

interface ApplyRootBindingsOptions extends ApplyQueryBindingsOptions {
  scopeRoot?: unknown;
}

function applyRootBindings(
  root: QueryBindingRoot,
  rootName: string,
  value: unknown,
  options: ApplyRootBindingsOptions = {},
): string[] {
  const applied: string[] = [];
  const bindingPrefix = `${rootName}.`;

  const textElements = dataBindElements(root, options.scopeRoot);
  for (let elementIndex = 0; elementIndex < textElements.length; elementIndex += 1) {
    const element = textElements[elementIndex];
    if (!element) continue;
    if (!elementBelongsToQueryKey(element, options.queryKey)) continue;

    const path = readBindingAttribute(element, 'data-bind');
    if (!path || !securityStringStartsWith(path, bindingPrefix)) continue;

    const boundValue = valueAtPath(value, securityStringSlice(path, bindingPrefix.length));
    const rendered = formatBoundValue(boundValue);

    // SPEC §4.8: data-bind is a textContent sink; form values use data-bind:value.
    writeQueryPlanElement(element, rendered);
    securityArrayAppend(applied, path, 'Browser applied query text bindings');
  }

  const attributeElements = attributeBindingElements(root, options);
  for (let elementIndex = 0; elementIndex < attributeElements.length; elementIndex += 1) {
    const element = attributeElements[elementIndex];
    if (!element) continue;
    if (!elementBelongsToScope(element, options.scopeRoot)) continue;
    if (!elementBelongsToQueryKey(element, options.queryKey)) continue;

    const attributes = bindingAttributes(element);
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex];
      if (!attribute) continue;
      const boundAttribute = securityStringSlice(attribute.name, 'data-bind:'.length);
      const path = attribute.value;
      if (!securityStringStartsWith(path, bindingPrefix)) continue;

      const boundValue = valueAtPath(value, securityStringSlice(path, bindingPrefix.length));
      if (boundValue === undefined || boundValue === null) {
        removeBoundAttribute(element, boundAttribute);
      } else {
        setBoundAttribute(element, boundAttribute, boundValue);
      }
      securityArrayAppend(applied, path, 'Browser applied query attribute bindings');
    }

    // SPEC §4.8 data-bind-prop: assign the live property for path-bound stamps.
    const propertyAttributes = bindPropAttributes(element);
    for (let attributeIndex = 0; attributeIndex < propertyAttributes.length; attributeIndex += 1) {
      const attribute = propertyAttributes[attributeIndex];
      if (!attribute) continue;
      const path = attribute.value;
      if (!securityStringStartsWith(path, bindingPrefix)) continue;

      applyBindProp(
        element,
        securityStringSlice(attribute.name, BIND_PROP_PREFIX.length),
        valueAtPath(value, securityStringSlice(path, bindingPrefix.length)),
      );
      securityArrayAppend(applied, path, 'Browser applied query property bindings');
    }
  }

  return applied;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function applyCompiledQueryUpdatePlan(
  root: QueryBindingRoot,
  queryName: string,
  value: unknown,
  plan: CompiledQueryUpdatePlan = {},
  options: ApplyCompiledQueryUpdatePlanOptions = {},
): AppliedCompiledQueryUpdatePlan {
  const bindingOptions = {
    ...(options.bindingIndex ? { bindingIndex: options.bindingIndex } : {}),
    ...(options.queryKey === undefined ? {} : { queryKey: options.queryKey }),
  };
  const applied: AppliedCompiledQueryUpdatePlan = {
    bindings:
      readOwnPlanField(plan, 'bindings') === false
        ? []
        : applyQueryBindings(root, queryName, value, bindingOptions),
    derives: [],
    stamps: [],
    templateStamps: [],
  };
  const context: CompiledQueryUpdateContext = options.queryStore
    ? { queryStore: options.queryStore }
    : {};

  const derives = snapshotPlanArray<CompiledQueryDerive>(plan, 'derives');
  for (let deriveIndex = 0; deriveIndex < derives.length; deriveIndex += 1) {
    const derive = derives[deriveIndex];
    if (!derive) continue;
    const name = requiredOwnString(derive, 'name', 'derive');
    const select = requiredOwnFunction<CompiledQueryDerive['select']>(derive, 'select', 'derive');
    const selector =
      optionalOwnString(derive, 'selector', 'derive') ?? `[data-derive="${queryName}.${name}"]`;
    const rendered = formatBoundValue(
      applySecurityIntrinsic(select, derive, [value, root, context]),
    );

    const elements = queryBindingElements(root, selector);
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      if (!element) continue;
      writeQueryPlanElement(element, rendered);
      securityArrayAppend(applied.derives, name, 'Browser applied compiled query derives');
    }
  }

  const stamps = snapshotPlanArray<CompiledQueryStamp>(plan, 'stamps');
  for (let stampIndex = 0; stampIndex < stamps.length; stampIndex += 1) {
    const stamp = stamps[stampIndex];
    if (!stamp) continue;
    const attr = requiredOwnString(stamp, 'attr', 'stamp');
    const selector = requiredOwnString(stamp, 'selector', 'stamp');
    const select = requiredOwnFunction<CompiledQueryStamp['select']>(stamp, 'select', 'stamp');
    const selected = applySecurityIntrinsic(select, stamp, [value, root, context]);

    const elements = queryBindingElements(root, selector);
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      if (!element) continue;
      if (selected === undefined || selected === null) {
        removeBoundAttribute(element, attr);
      } else {
        setBoundAttribute(element, attr, selected);
      }
      securityArrayAppend(applied.stamps, attr, 'Browser applied compiled query stamps');
    }
  }

  const templateStamps = snapshotPlanArray<CompiledQueryTemplateStamp>(plan, 'templateStamps');
  for (let stampIndex = 0; stampIndex < templateStamps.length; stampIndex += 1) {
    const stamp = templateStamps[stampIndex];
    if (!stamp) continue;
    const listPath = requiredOwnString(stamp, 'list', 'template stamp');
    const selector = requiredOwnString(stamp, 'selector', 'template stamp');
    const render = requiredOwnFunction<CompiledQueryTemplateStamp['render']>(
      stamp,
      'render',
      'template stamp',
    );
    const key = requiredOwnTemplateStampKey(stamp);
    const list = valueAtPath(value, listPath);
    if (!securityArrayIsArray(list)) continue;
    const values = snapshotDenseArray(list, 'query template-stamp list');
    const items: TemplateStampItem[] = [];
    for (let itemIndex = 0; itemIndex < values.length; itemIndex += 1) {
      const item = values[itemIndex];
      const html = applySecurityIntrinsic<unknown>(render, stamp, [item, itemIndex]);
      if (typeof html !== 'string') {
        throw new TypeError('Kovo template-stamp render must return a string.');
      }
      securityArrayAppend(
        items,
        {
          html,
          index: itemIndex,
          key: securityString(readTemplateStampKey(key, stamp, item, itemIndex)),
          value: item,
        },
        'Browser query template-stamp item snapshot',
      );
    }

    const elements = queryBindingElements(root, selector);
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      if (!element) continue;
      if (!reconcileTemplateStampHost(element, items)) continue;
      securityArrayAppend(
        applied.templateStamps,
        selector,
        'Browser applied compiled query template stamps',
      );
    }
  }

  return applied;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function supportsQueryBindings(root: unknown): root is QueryBindingRoot {
  return typeof (root as Partial<QueryBindingRoot>).querySelectorAll === 'function';
}

function reconcileTemplateStampHost(
  element: QueryBindingElement,
  items: readonly TemplateStampItem[],
): boolean {
  if (isDomTemplateStampHost(element)) {
    reconcileDomTemplateStamp(element, items);
    return true;
  }

  const reconcile = structuralMethod(element, 'reconcileTemplateStamp');
  if (!reconcile) return false;
  applySecurityIntrinsic(reconcile, element, [items]);
  return true;
}

function isDomTemplateStampHost(element: QueryBindingElement): element is Element {
  return browserQueryBindingSecurity?.isPlatformElement(element) === true;
}

function reconcileDomTemplateStamp(host: Element, items: readonly TemplateStampItem[]): void {
  const security = requireBrowserQueryBindingSecurity();
  const template = security.queryOne(host, 'template[kovo-stamp]');
  if (!template || security.readElementTagName(template) !== 'TEMPLATE') return;

  const children = security.snapshotElementChildren(host);
  const current: Element[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child && child !== template) {
      securityArrayAppend(current, child, 'Browser query template-stamp current rows');
    }
  }

  const reconciled = reconcileKeyed(current, items, {
    create(item) {
      return domTemplateStampElement(item, security);
    },
    currentKey(child) {
      return security.readAttribute(child, 'kovo-key');
    },
    match(existing, item) {
      const next = domTemplateStampElement(item, security);
      return next ? morphDomElement(existing, next) : existing;
    },
    nextKey(item) {
      return item.key;
    },
    preserveUnkeyed: false,
  });
  const desired = security.createSecurityMap<Element, true>();
  for (let index = 0; index < reconciled.length; index += 1) {
    const element = reconciled[index];
    if (!element) continue;
    security.setSecurityMapValue(desired, element, true);
  }

  for (let index = 0; index < reconciled.length; index += 1) {
    const element = reconciled[index];
    const item = items[index];
    if (!element || !item) continue;
    applyItemRelativeBindings(element, item.value);
    security.insertDomNode(host, element, template);
  }

  const committedChildren = security.snapshotElementChildren(host);
  for (let index = 0; index < committedChildren.length; index += 1) {
    const child = committedChildren[index];
    if (
      child &&
      child !== template &&
      security.hasElementAttribute(child, 'kovo-key') &&
      !security.hasSecurityMapValue(desired, child)
    ) {
      security.removeElement(child);
    }
  }
}

function domTemplateStampElement(
  item: TemplateStampItem,
  security = requireBrowserQueryBindingSecurity(),
): Element | null {
  // SF (secure-framework Tier 3): Trusted Types policy seam (see trusted-types.ts).
  const content = security.createFragmentContent(kovoCreateHTML(securityStringTrim(item.html)));
  const elements = security.snapshotElementChildren(content);
  const element = elements[0];
  if (!element) return null;

  security.setElementAttribute(element, 'kovo-key', item.key);
  return sanitizeDomElementTree(element, security);
}

function applyItemRelativeBindings(root: Element, value: unknown): void {
  const textElements = itemBindingElements(root);
  for (let elementIndex = 0; elementIndex < textElements.length; elementIndex += 1) {
    const element = textElements[elementIndex];
    if (!element) continue;
    const path = readBindingAttribute(element, 'data-bind');
    if (!path || !securityStringStartsWith(path, '.')) continue;

    writeQueryPlanElement(
      element,
      formatBoundValue(valueAtPath(value, securityStringSlice(path, 1))),
    );
  }

  const elements: QueryBindingElement[] = [root];
  const descendants = queryBindingElements(root, '*');
  for (let index = 0; index < descendants.length; index += 1) {
    const descendant = descendants[index];
    if (descendant) {
      securityArrayAppend(elements, descendant, 'Browser query item-binding descendants');
    }
  }
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex];
    if (!element) continue;
    const attributes = bindingAttributes(element);
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex];
      if (!attribute || !securityStringStartsWith(attribute.value, '.')) continue;

      const boundAttribute = securityStringSlice(attribute.name, 'data-bind:'.length);
      const selected = valueAtPath(value, securityStringSlice(attribute.value, 1));
      if (selected === undefined || selected === null) {
        removeBoundAttribute(element, boundAttribute);
      } else {
        setBoundAttribute(element, boundAttribute, selected);
      }
    }

    // SPEC §4.8 data-bind-prop: item-relative live-property assignment.
    const propertyAttributes = bindPropAttributes(element);
    for (let attributeIndex = 0; attributeIndex < propertyAttributes.length; attributeIndex += 1) {
      const attribute = propertyAttributes[attributeIndex];
      if (!attribute || !securityStringStartsWith(attribute.value, '.')) continue;

      applyBindProp(
        element,
        securityStringSlice(attribute.name, BIND_PROP_PREFIX.length),
        valueAtPath(value, securityStringSlice(attribute.value, 1)),
      );
    }
  }
}

function itemBindingElements(root: Element): Element[] {
  const elements: Element[] = [];
  if (readBindingAttribute(root, 'data-bind') !== null) {
    securityArrayAppend(elements, root, 'Browser query item-binding roots');
  }
  const descendants = queryBindingElements(root, '[data-bind]');
  for (let index = 0; index < descendants.length; index += 1) {
    const descendant = descendants[index];
    if (descendant) {
      securityArrayAppend(elements, descendant as Element, 'Browser query item-binding roots');
    }
  }
  return elements;
}

function readTemplateStampKey(
  keyPlan: CompiledQueryTemplateStamp['key'],
  receiver: CompiledQueryTemplateStamp,
  item: unknown,
  index: number,
): string | number {
  if (typeof keyPlan === 'function') {
    const selected = applySecurityIntrinsic<unknown>(keyPlan, receiver, [item, index]);
    if (typeof selected !== 'string' && typeof selected !== 'number') {
      throw new TypeError('Kovo template-stamp key function must return a string or number.');
    }
    return selected;
  }

  const key = valueAtPath(item, keyPlan);
  return typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint'
    ? securityString(key)
    : index;
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  let start = 0;
  while (start <= path.length) {
    const separator = securityStringIndexOf(path, '.', start);
    const end = separator < 0 ? path.length : separator;
    let key = securityStringSlice(path, start, end);
    if (key.length > 0 && key[key.length - 1] === '?') {
      key = securityStringSlice(key, 0, -1);
    }
    if (typeof current !== 'object' || current === null) return undefined;
    const descriptor = securityGetOwnPropertyDescriptor(current, key);
    if (!descriptor || !('value' in descriptor)) return undefined;
    current = descriptor.value;
    if (separator < 0) return current;
    start = separator + 1;
  }
  return current;
}

function queryAttributeBindingElements(root: QueryBindingRoot): QueryBindingElement[] {
  try {
    const selected = queryBindingElements(root, '*');
    const elements: QueryBindingElement[] = [];
    for (let index = 0; index < selected.length; index += 1) {
      const element = selected[index];
      if (
        element &&
        (bindingAttributes(element).length > 0 || bindPropAttributes(element).length > 0)
      ) {
        securityArrayAppend(elements, element, 'Browser query attribute-binding index');
      }
    }
    return elements;
  } catch {
    return [];
  }
}

function dataBindElements(root: QueryBindingRoot, scopeRoot: unknown): QueryBindingElement[] {
  const selected = queryBindingElements(root, '[data-bind]');
  const elements: QueryBindingElement[] = [];
  if (isQueryBindingElement(root) && readBindingAttribute(root, 'data-bind') !== null) {
    securityArrayAppend(elements, root, 'Browser query text-binding roots');
  }
  for (let index = 0; index < selected.length; index += 1) {
    const element = selected[index];
    if (element && elementBelongsToScope(element, scopeRoot)) {
      securityArrayAppend(elements, element, 'Browser query text-binding roots');
    }
  }

  return elements;
}

function attributeBindingElements(
  root: QueryBindingRoot,
  options: ApplyRootBindingsOptions,
): readonly QueryBindingElement[] {
  const elements =
    options.bindingIndex?.attributeBindingElements ?? queryAttributeBindingElements(root);
  if (
    isQueryBindingElement(root) &&
    (bindingAttributes(root).length > 0 || bindPropAttributes(root).length > 0)
  ) {
    const withRoot: QueryBindingElement[] = [];
    securityArrayAppend(withRoot, root, 'Browser query attribute-binding roots');
    const snapshot = snapshotDenseArray(elements, 'query attribute-binding index');
    for (let index = 0; index < snapshot.length; index += 1) {
      const element = snapshot[index];
      if (element) {
        securityArrayAppend(withRoot, element, 'Browser query attribute-binding roots');
      }
    }
    return withRoot;
  }

  return snapshotDenseArray(elements, 'query attribute-binding index');
}

async function applyStateDeriveBindings(
  root: QueryBindingRoot,
  state: unknown,
  applied: string[],
  options: ApplyStateBindingsOptions,
): Promise<string[]> {
  const importModule = options.importModule;
  if (!importModule) return applied;

  type DeriveBinding =
    | {
        element: QueryBindingElement;
        kind: 'attribute';
        name: string;
        ref: KovoModuleRef<'derive'>;
        refValue: string;
      }
    | {
        element: QueryBindingElement;
        kind: 'property';
        name: string;
        ref: KovoModuleRef<'derive'>;
        refValue: string;
      }
    | {
        element: QueryBindingElement;
        kind: 'text';
        ref: KovoModuleRef<'derive'>;
        refValue: string;
      };
  const bindings: DeriveBinding[] = [];

  // Snapshot every DOM-selected derive reference before importing the first authored module. A
  // derive may mutate attributes or DOM prototypes, but it cannot thereby redirect a later
  // framework import/callee decision in the same state-commit pass (SPEC §6.6).
  const textElements = dataBindElements(root, root);
  for (let elementIndex = 0; elementIndex < textElements.length; elementIndex += 1) {
    const element = textElements[elementIndex];
    if (!element) continue;
    const refValue = readRuntimeElementAttribute(element, 'data-bind');
    if (!refValue) continue;

    const ref = parseDeriveReference(refValue);
    if (!ref) continue;
    securityArrayAppend(
      bindings,
      { element, kind: 'text', ref, refValue },
      'Browser state derive binding snapshot',
    );
  }

  const attributeElements = attributeBindingElements(root, { ...options, scopeRoot: root });
  for (let elementIndex = 0; elementIndex < attributeElements.length; elementIndex += 1) {
    const element = attributeElements[elementIndex];
    if (!element) continue;
    if (!elementBelongsToScope(element, root)) continue;

    const attributes = bindingAttributes(element);
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex];
      if (!attribute) continue;
      const ref = parseDeriveReference(attribute.value);
      if (!ref) continue;
      securityArrayAppend(
        bindings,
        {
          element,
          kind: 'attribute',
          name: securityStringSlice(attribute.name, 'data-bind:'.length),
          ref,
          refValue: attribute.value,
        },
        'Browser state derive attribute snapshot',
      );
    }

    // SPEC §4.8 data-bind-prop: assign the live property for derive-bound stamps.
    const propertyAttributes = bindPropAttributes(element);
    for (let attributeIndex = 0; attributeIndex < propertyAttributes.length; attributeIndex += 1) {
      const attribute = propertyAttributes[attributeIndex];
      if (!attribute) continue;
      const ref = parseDeriveReference(attribute.value);
      if (!ref) continue;
      securityArrayAppend(
        bindings,
        {
          element,
          kind: 'property',
          name: securityStringSlice(attribute.name, BIND_PROP_PREFIX.length),
          ref,
          refValue: attribute.value,
        },
        'Browser state derive property snapshot',
      );
    }
  }

  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index];
    if (!binding) continue;
    assertAllowedKovoDynamicImportRefForModule(binding.ref, importModule);
    const mod = await importModule(binding.ref.url);
    const value = runOwnDeriveExport(mod, binding.ref.exportName, state);
    if (binding.kind === 'text') {
      writeQueryPlanElement(binding.element, formatBoundValue(value));
    } else if (binding.kind === 'attribute') {
      if (value === undefined || value === null) {
        removeBoundAttribute(binding.element, binding.name);
      } else {
        setBoundAttribute(binding.element, binding.name, value);
      }
    } else {
      applyBindProp(binding.element, binding.name, value);
    }
    securityArrayAppend(applied, binding.refValue, 'Browser applied state derive bindings');
  }

  return applied;
}

function runOwnDeriveExport(mod: object, exportName: string, state: unknown): unknown {
  const deriveDescriptor = securityGetOwnPropertyDescriptor(mod, exportName);
  if (!deriveDescriptor || !('value' in deriveDescriptor)) return undefined;
  const derive = deriveDescriptor.value;
  if (derive === null || typeof derive !== 'object') return undefined;
  const runDescriptor = securityGetOwnPropertyDescriptor(derive, 'run');
  if (!runDescriptor || !('value' in runDescriptor) || !isDeriveRunner(runDescriptor.value)) {
    return undefined;
  }
  return applySecurityIntrinsic(runDescriptor.value, derive, [state]);
}

function isDeriveRunner(value: unknown): value is (state: unknown) => unknown {
  return typeof value === 'function';
}

function parseDeriveReference(value: string): KovoModuleRef<'derive'> | null {
  return parseKovoModuleRef(value, 'derive') ?? null;
}

function elementBelongsToScope(element: QueryBindingElement, scopeRoot: unknown): boolean {
  if (!scopeRoot || element === scopeRoot) return true;

  const closestStateHost = closestRuntimeElement<QueryBindingElement>(element, '[kovo-state]');
  return !closestStateHost || closestStateHost === scopeRoot;
}

function elementBelongsToQueryKey(
  element: QueryBindingElement,
  queryKey: string | undefined,
): boolean {
  if (!queryKey) return true;

  const closestQueryHost = closestRuntimeElement<QueryBindingElement>(element, '[kovo-deps]');
  if (!closestQueryHost) return true;

  const deps = readDeps(readRuntimeElementAttribute(closestQueryHost, 'kovo-deps'));
  for (let index = 0; index < deps.length; index += 1) {
    if (deps[index] === queryKey) return true;
  }
  return false;
}

function readDeps(value: string | null | undefined): string[] {
  const source = value ?? '';
  const deps: string[] = [];
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    const code = index < source.length ? securityStringCharCodeAt(source, index) : 0x20;
    const delimiter =
      code === 0x2c ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d ||
      code === 0x20;
    if (!delimiter) continue;
    if (start < index) {
      securityArrayAppend(
        deps,
        securityStringSlice(source, start, index),
        'Browser query dependency snapshot',
      );
    }
    start = index + 1;
  }
  return deps;
}

function isQueryBindingElement(value: unknown): value is QueryBindingElement {
  if (browserQueryBindingSecurity?.isPlatformElement(value)) return true;
  return structuralMethod(value, 'getAttribute') !== undefined;
}

function bindingAttributes(element: QueryBindingElement): Array<{ name: string; value: string }> {
  return matchingBindingAttributes(element, 'data-bind:');
}

// SPEC §4.8 data-bind-prop: live-property binding stamps. Kept separate from
// `data-bind:` so the property write runs in addition to (never instead of) the
// companion attribute write.
function bindPropAttributes(element: QueryBindingElement): Array<{ name: string; value: string }> {
  return matchingBindingAttributes(element, BIND_PROP_PREFIX);
}

function writeQueryPlanElement(element: QueryBindingElement, rendered: string): void {
  // SPEC §4.8: derive text stamps share data-bind's textContent semantics.
  if (browserQueryBindingSecurity?.isPlatformElement(element)) {
    browserQueryBindingSecurity.setNodeTextContent(element, rendered);
    return;
  }
  element.textContent = rendered;
}

function removeBoundAttribute(element: QueryBindingElement, name: string): void {
  if (inertBlockedSvgSmilBindingElement(element)) return;
  // SPEC §5.2.4: closing a <dialog> by removing `open` never exits the top layer;
  // route through dialog.close() so a show-modal dialog leaves the top layer.
  if (name === 'open' && reconcileDialogOpen(element, null)) return;
  removeBindingAttribute(element, name);
  if (name === 'value' && element.value !== undefined && shouldClearRemovedValueProperty(element)) {
    element.value = '';
  }
  if ((name === 'scrollLeft' || name === 'scrollleft') && element.scrollLeft !== undefined) {
    element.scrollLeft = 0;
  }
  if ((name === 'scrollTop' || name === 'scrolltop') && element.scrollTop !== undefined) {
    element.scrollTop = 0;
  }
  if (name === 'checked' && element.checked !== undefined) {
    element.checked = false;
  }
  if (name === 'indeterminate' && element.indeterminate !== undefined) {
    element.indeterminate = false;
  }
}

function shouldClearRemovedValueProperty(element: QueryBindingElement): boolean {
  const tagName = readBindingTagName(element);
  return tagName === undefined || securityStringToLowerCase(tagName) !== 'progress';
}

// HTML boolean-presence attributes: falsy value → removeAttribute, truthy → setAttribute('', '').
// Covers query-source bindings/derives/stamps that emit raw booleans (J3, SPEC §4.6/§4.8).
function isBooleanPresenceAttribute(name: string): boolean {
  return (
    name === 'checked' ||
    name === 'disabled' ||
    name === 'hidden' ||
    name === 'indeterminate' ||
    name === 'multiple' ||
    name === 'open' ||
    name === 'readonly' ||
    name === 'required' ||
    name === 'selected'
  );
}

// SPEC §5.2.4: a <dialog> opened via the native show-modal invoker lives in the
// top layer. Reflecting the reactive open state with setAttribute/removeAttribute
// alone never exits the top layer — the dialog stays :modal with an inert backdrop
// intercepting every click — so drive open/close through the dialog methods that
// keep top-layer state in sync. Returns true when it owned the write.
interface DialogElementLike {
  close?: () => void;
  open?: boolean;
  show?: () => void;
  showModal?: () => void;
}

function reconcileDialogOpen(element: QueryBindingElement, value: unknown): boolean {
  const tagName = readBindingTagName(element);
  if (!tagName || securityStringToLowerCase(tagName) !== 'dialog') return false;
  const dialog = element as QueryBindingElement & DialogElementLike;
  if (typeof dialog.close !== 'function') return false;

  if (value === false || value == null) {
    if (dialog.open) dialog.close();
  } else if (!dialog.open) {
    // Idempotent against the native show-modal invoker, which opens the dialog on
    // the same activation before this reactive write runs.
    if (
      readBindingAttribute(element, 'aria-modal') === 'true' &&
      typeof dialog.showModal === 'function'
    ) {
      dialog.showModal();
    } else if (typeof dialog.show === 'function') {
      dialog.show();
    } else {
      setBindingAttribute(element, 'open', '');
    }
  }
  return true;
}

function setBoundAttribute(element: QueryBindingElement, name: string, value: unknown): void {
  if (inertBlockedSvgSmilBindingElement(element)) return;
  // J3 (SPEC §4.6/§4.8): HTML boolean-presence attributes must remove on false/null/undefined,
  // and set to '' (present) on any other value including true, '', and non-null strings.
  // This covers both query-source raw booleans and state-derive '' / null patterns.
  if (name === 'open' && reconcileDialogOpen(element, value)) return;
  if (isBooleanPresenceAttribute(name)) {
    if (value === false || value == null) {
      removeBoundAttribute(element, name);
    } else {
      setBindingAttribute(element, name, '');
      // Sync property mirrors for checked and indeterminate.
      if (name === 'checked' && element.checked !== undefined) element.checked = true;
      if (name === 'indeterminate' && element.indeterminate !== undefined)
        element.indeterminate = true;
    }
    return;
  }

  // SPEC §1 and §5.2: generated/client-updated attributes use the shared output-context model so
  // security behavior remains auditable in emitted code and in the live update path.
  // F2: kovoBoundAttributeValue returns null for blocked sinks; remove any prior value.
  const rendered = kovoBoundAttributeValue(name, value);
  if (rendered === null) {
    removeBoundAttribute(element, name);
    return;
  }
  setBindingAttribute(element, name, rendered);
  if (name === 'value' && element.value !== undefined) {
    element.value = rendered;
  }
  if ((name === 'scrollLeft' || name === 'scrollleft') && element.scrollLeft !== undefined) {
    element.scrollLeft = securityNumber(value) || 0;
  }
  if ((name === 'scrollTop' || name === 'scrolltop') && element.scrollTop !== undefined) {
    element.scrollTop = securityNumber(value) || 0;
  }
}

function formatBoundValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return securityString(value);
  }
  if (typeof value === 'object') return securityJsonStringify(value) ?? '';
  return '';
}

function queryBindingElements(root: object, selector: string): QueryBindingElement[] {
  if (browserQueryBindingSecurity) {
    return browserQueryBindingSecurity.queryAllElements(root, selector) as QueryBindingElement[];
  }
  const query = structuralMethod(root, 'querySelectorAll');
  if (!query) return [];
  const selected = applySecurityIntrinsic<unknown>(query, root, [selector]);
  return snapshotDenseArray(
    selected,
    'structural query-binding selection',
  ) as QueryBindingElement[];
}

function snapshotDenseArray<Value>(value: unknown, label: string): Value[] {
  if (!securityArrayIsArray(value)) throw new TypeError(`Kovo ${label} must be an array.`);
  const length = securityGetOwnPropertyDescriptor(value, 'length');
  if (
    !length ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value > 100_000 ||
    length.value % 1 !== 0
  ) {
    throw new TypeError(`Kovo ${label} length is invalid.`);
  }
  const snapshot: Value[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const item = securityGetOwnPropertyDescriptor(value, index);
    if (!item || !('value' in item)) {
      throw new TypeError(`Kovo ${label} must be dense own data.`);
    }
    securityArrayAppend(snapshot, item.value as Value, `Browser ${label} snapshot`);
  }
  return snapshot;
}

function readOwnPlanField(
  plan: CompiledQueryUpdatePlan,
  name: keyof CompiledQueryUpdatePlan,
): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(plan, name);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`Kovo compiled query plan ${name} must be own data.`);
  }
  return descriptor.value;
}

function snapshotPlanArray<Value>(
  plan: CompiledQueryUpdatePlan,
  name: 'derives' | 'stamps' | 'templateStamps',
): Value[] {
  const value = readOwnPlanField(plan, name);
  return value === undefined ? [] : snapshotDenseArray<Value>(value, `compiled query plan ${name}`);
}

function requiredOwnString(value: object, name: PropertyKey, label: string): string {
  const descriptor = securityGetOwnPropertyDescriptor(value, name);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw new TypeError(`Kovo ${label} ${String(name)} must be own string data.`);
  }
  return descriptor.value;
}

function optionalOwnString(value: object, name: PropertyKey, label: string): string | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(value, name);
  if (!descriptor) return undefined;
  if (!('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw new TypeError(`Kovo ${label} ${String(name)} must be own string data.`);
  }
  return descriptor.value;
}

function requiredOwnFunction<FunctionType extends Function>(
  value: object,
  name: PropertyKey,
  label: string,
): FunctionType {
  const descriptor = securityGetOwnPropertyDescriptor(value, name);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new TypeError(`Kovo ${label} ${String(name)} must be an own-data function.`);
  }
  return descriptor.value as FunctionType;
}

function requiredOwnTemplateStampKey(
  stamp: CompiledQueryTemplateStamp,
): CompiledQueryTemplateStamp['key'] {
  const descriptor = securityGetOwnPropertyDescriptor(stamp, 'key');
  if (
    !descriptor ||
    !('value' in descriptor) ||
    (typeof descriptor.value !== 'string' && typeof descriptor.value !== 'function')
  ) {
    throw new TypeError('Kovo template stamp key must be own string or function data.');
  }
  return descriptor.value;
}

function structuralMethod(
  value: unknown,
  name: PropertyKey,
): ((...args: any[]) => unknown) | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(owner, name);
    if (descriptor) {
      return 'value' in descriptor && typeof descriptor.value === 'function'
        ? descriptor.value
        : undefined;
    }
    owner = securityGetPrototypeOf(owner);
  }
  return undefined;
}

function readBindingAttribute(element: QueryBindingElement, name: string): string | null {
  if (browserQueryBindingSecurity?.isPlatformElement(element)) {
    return browserQueryBindingSecurity.readAttribute(element, name);
  }
  const read = structuralMethod(element, 'getAttribute');
  if (!read) return null;
  const value = applySecurityIntrinsic<unknown>(read, element, [name]);
  return typeof value === 'string' ? value : null;
}

function readBindingTagName(element: QueryBindingElement): string | undefined {
  if (browserQueryBindingSecurity?.isPlatformElement(element)) {
    return browserQueryBindingSecurity.readElementTagName(element);
  }
  const descriptor = securityGetOwnPropertyDescriptor(element, 'tagName');
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

function setBindingAttribute(element: QueryBindingElement, name: string, value: string): void {
  if (browserQueryBindingSecurity?.isPlatformElement(element)) {
    browserQueryBindingSecurity.setElementAttribute(element, name, value);
    return;
  }
  const write = structuralMethod(element, 'setAttribute');
  if (write) applySecurityIntrinsic(write, element, [name, value]);
}

function removeBindingAttribute(element: QueryBindingElement, name: string): void {
  if (browserQueryBindingSecurity?.isPlatformElement(element)) {
    browserQueryBindingSecurity.removeElementAttribute(element, name);
    return;
  }
  const remove = structuralMethod(element, 'removeAttribute');
  if (remove) applySecurityIntrinsic(remove, element, [name]);
}

function matchingBindingAttributes(
  element: QueryBindingElement,
  prefix: string,
): Array<{ name: string; value: string }> {
  const attributes = bindingElementAttributes(element);
  const matches: Array<{ name: string; value: string }> = [];
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index];
    if (attribute && attribute.value !== '' && securityStringStartsWith(attribute.name, prefix)) {
      securityArrayAppend(
        matches,
        { name: attribute.name, value: attribute.value },
        'Browser query binding attribute snapshot',
      );
    }
  }
  return matches;
}

function bindingElementAttributes(
  element: QueryBindingElement,
): Array<{ name: string; value: string }> {
  if (browserQueryBindingSecurity?.isPlatformElement(element)) {
    return browserQueryBindingSecurity.snapshotElementAttributes(element);
  }
  const descriptor = securityGetOwnPropertyDescriptor(element, 'attributes');
  return domAttributes(
    descriptor && 'value' in descriptor
      ? (descriptor.value as QueryBindingElement['attributes'])
      : undefined,
  );
}

/**
 * SPEC.md §4.8 / §5.2 rule 10: a live binding can change a SMIL target before or after its
 * transfer value. Removing the whole attribute set makes both transition orders inert and also
 * retires the binding stamps so a later commit cannot rebuild the primitive.
 */
function inertBlockedSvgSmilBindingElement(element: QueryBindingElement): boolean {
  const tagName = readBindingTagName(element);
  if (tagName === undefined || !isBlockedSvgSmilElementName(tagName)) return false;
  const attributes = bindingElementAttributes(element);
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index];
    if (attribute) removeBindingAttribute(element, attribute.name);
  }
  return true;
}
