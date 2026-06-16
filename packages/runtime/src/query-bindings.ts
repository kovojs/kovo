import { domAttributes } from './dom-like.js';
import type {
  AttributeElementLike,
  ClosestElementLike,
  QuerySelectorAllRootLike,
} from './dom-like.js';
import { morphDomElement } from './morph.js';
import { kovoBoundAttributeValue } from './security-output.js';

/** @internal */
export interface QueryBindingElement
  extends AttributeElementLike, ClosestElementLike<QueryBindingElement> {
  checked?: boolean;
  indeterminate?: boolean;
  scrollLeft?: number;
  scrollTop?: number;
  tagName?: string;
  textContent?: string | null;
  value?: string;
}

/** @internal */
export interface QueryBindingRoot extends QuerySelectorAllRootLike<QueryBindingElement> {}

/** @internal */
export interface TemplateStampItem {
  html: string;
  index: number;
  key: string;
  value: unknown;
}

/** @internal */
export interface TemplateStampHost extends QueryBindingElement {
  reconcileTemplateStamp(items: readonly TemplateStampItem[]): void;
}

/** @internal */
export interface CompiledQueryDerive {
  name: string;
  select(value: unknown, root: QueryBindingRoot): unknown;
  selector?: string;
}

/** @internal */
export interface CompiledQueryStamp {
  attr: string;
  select(value: unknown, root: QueryBindingRoot): unknown;
  selector: string;
}

/** @internal */
export interface CompiledQueryTemplateStamp {
  key: string | ((item: unknown, index: number) => string | number);
  list: string;
  render(item: unknown, index: number): string;
  selector: string;
}

/** @internal */
export interface CompiledQueryUpdatePlan {
  bindings?: boolean;
  derives?: readonly CompiledQueryDerive[];
  stamps?: readonly CompiledQueryStamp[];
  templateStamps?: readonly CompiledQueryTemplateStamp[];
}

/** @internal */
export interface AppliedCompiledQueryUpdatePlan {
  bindings: string[];
  derives: string[];
  stamps: string[];
  templateStamps: string[];
}

/** @internal */
export type CompiledQueryUpdatePlans = Readonly<
  Record<string, CompiledQueryUpdatePlan | undefined>
>;

/** @internal */
export interface QueryBindingIndex {
  attributeBindingElements: readonly QueryBindingElement[];
}

/** @internal */
export interface ApplyQueryBindingsOptions {
  bindingIndex?: QueryBindingIndex;
}

/** @internal */
export interface ApplyStateBindingsOptions extends ApplyQueryBindingsOptions {
  importModule?: (url: string) => Promise<Record<string, unknown>>;
}

/** @internal */
export interface ApplyCompiledQueryUpdatePlanOptions extends ApplyQueryBindingsOptions {}

/** @internal */
export function createQueryBindingIndex(root: QueryBindingRoot): QueryBindingIndex {
  return {
    attributeBindingElements: queryAttributeBindingElements(root),
  };
}

/** @internal */
export function applyQueryBindings(
  root: QueryBindingRoot,
  queryName: string,
  value: unknown,
  options: ApplyQueryBindingsOptions = {},
): string[] {
  return applyRootBindings(root, queryName, value, options);
}

/** @internal */
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

  for (const element of dataBindElements(root, options.scopeRoot)) {
    const path = element.getAttribute('data-bind');
    if (!path?.startsWith(`${rootName}.`)) continue;

    const boundValue = valueAtPath(value, path.slice(rootName.length + 1));
    const rendered = formatBoundValue(boundValue);

    if (element.value !== undefined) {
      element.value = rendered;
    } else {
      element.textContent = rendered;
    }
    applied.push(path);
  }

  for (const element of attributeBindingElements(root, options)) {
    if (!elementBelongsToScope(element, options.scopeRoot)) continue;

    for (const attribute of bindingAttributes(element)) {
      const boundAttribute = attribute.name.slice('data-bind:'.length);
      const path = attribute.value;
      if (!path.startsWith(`${rootName}.`)) continue;

      const boundValue = valueAtPath(value, path.slice(rootName.length + 1));
      if (boundValue === undefined || boundValue === null) {
        removeBoundAttribute(element, boundAttribute);
      } else {
        setBoundAttribute(element, boundAttribute, boundValue);
      }
      applied.push(path);
    }
  }

  return applied;
}

/** @internal */
export function applyCompiledQueryUpdatePlan(
  root: QueryBindingRoot,
  queryName: string,
  value: unknown,
  plan: CompiledQueryUpdatePlan = {},
  options: ApplyCompiledQueryUpdatePlanOptions = {},
): AppliedCompiledQueryUpdatePlan {
  const bindingOptions = options.bindingIndex ? { bindingIndex: options.bindingIndex } : {};
  const applied: AppliedCompiledQueryUpdatePlan = {
    bindings:
      plan.bindings === false ? [] : applyQueryBindings(root, queryName, value, bindingOptions),
    derives: [],
    stamps: [],
    templateStamps: [],
  };

  for (const derive of plan.derives ?? []) {
    const selector = derive.selector ?? `[data-derive="${queryName}.${derive.name}"]`;
    const rendered = formatBoundValue(derive.select(value, root));

    for (const element of root.querySelectorAll(selector)) {
      writeQueryPlanElement(element, rendered);
      applied.derives.push(derive.name);
    }
  }

  for (const stamp of plan.stamps ?? []) {
    const selected = stamp.select(value, root);

    for (const element of root.querySelectorAll(stamp.selector)) {
      if (selected === undefined || selected === null) {
        removeBoundAttribute(element, stamp.attr);
      } else {
        setBoundAttribute(element, stamp.attr, selected);
      }
      applied.stamps.push(stamp.attr);
    }
  }

  for (const stamp of plan.templateStamps ?? []) {
    const list = valueAtPath(value, stamp.list);
    if (!Array.isArray(list)) continue;

    const items = list.map((item, index) => ({
      html: stamp.render(item, index),
      index,
      key: String(readTemplateStampKey(stamp, item, index)),
      value: item,
    }));

    for (const element of root.querySelectorAll(stamp.selector)) {
      if (!reconcileTemplateStampHost(element, items)) continue;
      applied.templateStamps.push(stamp.selector);
    }
  }

  return applied;
}

/** @internal */
export function supportsQueryBindings(root: unknown): root is QueryBindingRoot {
  return typeof (root as Partial<QueryBindingRoot>).querySelectorAll === 'function';
}

function isTemplateStampHost(element: QueryBindingElement): element is TemplateStampHost {
  return (
    'reconcileTemplateStamp' in element && typeof element.reconcileTemplateStamp === 'function'
  );
}

function reconcileTemplateStampHost(
  element: QueryBindingElement,
  items: readonly TemplateStampItem[],
): boolean {
  if (isTemplateStampHost(element)) {
    element.reconcileTemplateStamp(items);
    return true;
  }

  if (!isDomTemplateStampHost(element)) return false;

  reconcileDomTemplateStamp(element, items);
  return true;
}

function isDomTemplateStampHost(element: QueryBindingElement): element is Element {
  return (
    typeof (element as Partial<Element>).querySelector === 'function' &&
    typeof (element as Partial<Element>).insertBefore === 'function' &&
    typeof (element as Partial<Element>).querySelectorAll === 'function'
  );
}

function reconcileDomTemplateStamp(host: Element, items: readonly TemplateStampItem[]): void {
  const template = host.querySelector('template[kovo-stamp]');
  if (!isHtmlTemplateElement(template)) return;

  const existingByKey = new Map(
    [...host.children]
      .filter((child) => child !== template)
      .map((child) => [child.getAttribute('kovo-key'), child] as const)
      .filter((entry): entry is [string, Element] => entry[0] !== null),
  );
  const desired = new Set<Element>();

  for (const item of items) {
    const next = domTemplateStampElement(template, item);
    if (!next) continue;

    const existing = existingByKey.get(item.key);
    const element = existing ? morphDomElement(existing, next) : next;
    applyItemRelativeBindings(element, item.value);
    desired.add(element);
    host.insertBefore(element, template);
  }

  for (const child of Array.from(host.children)) {
    if (child !== template && child.hasAttribute('kovo-key') && !desired.has(child)) child.remove();
  }
}

function domTemplateStampElement(
  template: HTMLTemplateElement,
  item: TemplateStampItem,
): Element | null {
  const parser = template.ownerDocument.createElement('template');
  parser.innerHTML = item.html.trim();
  const element = parser.content.firstElementChild;
  if (!element) return null;

  element.setAttribute('kovo-key', item.key);
  return element;
}

function isHtmlTemplateElement(element: Element | null): element is HTMLTemplateElement {
  return element !== null && 'content' in element && 'ownerDocument' in element;
}

function applyItemRelativeBindings(root: Element, value: unknown): void {
  for (const element of itemBindingElements(root)) {
    const path = element.getAttribute('data-bind');
    if (!path?.startsWith('.')) continue;

    writeQueryPlanElement(element, formatBoundValue(valueAtPath(value, path.slice(1))));
  }

  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of bindingAttributes(element)) {
      if (!attribute.value.startsWith('.')) continue;

      const boundAttribute = attribute.name.slice('data-bind:'.length);
      const selected = valueAtPath(value, attribute.value.slice(1));
      if (selected === undefined || selected === null) {
        removeBoundAttribute(element, boundAttribute);
      } else {
        setBoundAttribute(element, boundAttribute, selected);
      }
    }
  }
}

function itemBindingElements(root: Element): Element[] {
  return [
    ...(root.getAttribute('data-bind') !== null ? [root] : []),
    ...root.querySelectorAll('[data-bind]'),
  ];
}

function readTemplateStampKey(
  stamp: CompiledQueryTemplateStamp,
  item: unknown,
  index: number,
): string | number {
  if (typeof stamp.key === 'function') return stamp.key(item, index);

  const key = valueAtPath(item, stamp.key);
  return typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint'
    ? key.toString()
    : index;
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    const key = segment.endsWith('?') ? segment.slice(0, -1) : segment;
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function queryAttributeBindingElements(root: QueryBindingRoot): QueryBindingElement[] {
  try {
    return Array.from(root.querySelectorAll('*')).filter(
      (element) => bindingAttributes(element).length > 0,
    );
  } catch {
    return [];
  }
}

function dataBindElements(root: QueryBindingRoot, scopeRoot: unknown): QueryBindingElement[] {
  const elements = Array.from(root.querySelectorAll('[data-bind]')).filter((element) =>
    elementBelongsToScope(element, scopeRoot),
  );
  if (isQueryBindingElement(root) && root.getAttribute('data-bind') !== null) {
    elements.unshift(root);
  }

  return elements;
}

function attributeBindingElements(
  root: QueryBindingRoot,
  options: ApplyRootBindingsOptions,
): readonly QueryBindingElement[] {
  const elements =
    options.bindingIndex?.attributeBindingElements ?? queryAttributeBindingElements(root);
  if (isQueryBindingElement(root) && bindingAttributes(root).length > 0) {
    return [root, ...elements];
  }

  return elements;
}

async function applyStateDeriveBindings(
  root: QueryBindingRoot,
  state: unknown,
  applied: string[],
  options: ApplyStateBindingsOptions,
): Promise<string[]> {
  const importModule = options.importModule;
  if (!importModule) return applied;

  for (const element of dataBindElements(root, root)) {
    const refValue = element.getAttribute('data-bind');
    if (!refValue) continue;

    const ref = parseDeriveReference(refValue);
    if (!ref) continue;

    const mod = await importModule(ref.url);
    const derive = mod[ref.exportName];
    const value = isRunnableDerive(derive) ? derive.run(state) : undefined;
    writeQueryPlanElement(element, formatBoundValue(value));
    applied.push(refValue);
  }

  for (const element of attributeBindingElements(root, { ...options, scopeRoot: root })) {
    if (!elementBelongsToScope(element, root)) continue;

    for (const attribute of bindingAttributes(element)) {
      const ref = parseDeriveReference(attribute.value);
      if (!ref) continue;

      const mod = await importModule(ref.url);
      const derive = mod[ref.exportName];
      const value = isRunnableDerive(derive) ? derive.run(state) : undefined;
      const boundAttribute = attribute.name.slice('data-bind:'.length);
      if (value === undefined || value === null) {
        removeBoundAttribute(element, boundAttribute);
      } else {
        setBoundAttribute(element, boundAttribute, value);
      }
      applied.push(attribute.value);
    }
  }

  return applied;
}

function isRunnableDerive(value: unknown): value is { run(value: unknown): unknown } {
  return (
    typeof value === 'object' && value !== null && 'run' in value && typeof value.run === 'function'
  );
}

function parseDeriveReference(value: string): { exportName: string; url: string } | null {
  const hashIndex = value.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === value.length - 1) return null;

  return {
    exportName: value.slice(hashIndex + 1),
    url: value.slice(0, hashIndex),
  };
}

function elementBelongsToScope(element: QueryBindingElement, scopeRoot: unknown): boolean {
  if (!scopeRoot || element === scopeRoot) return true;

  const closestStateHost = element.closest?.('[kovo-state]');
  return !closestStateHost || closestStateHost === scopeRoot;
}

function isQueryBindingElement(value: unknown): value is QueryBindingElement {
  return typeof (value as Partial<QueryBindingElement>).getAttribute === 'function';
}

function bindingAttributes(element: QueryBindingElement): Array<{ name: string; value: string }> {
  return domAttributes(element.attributes).filter(
    (attribute) => attribute.name.startsWith('data-bind:') && attribute.value !== '',
  );
}

function writeQueryPlanElement(element: QueryBindingElement, rendered: string): void {
  if (element.value !== undefined) {
    element.value = rendered;
  } else {
    element.textContent = rendered;
  }
}

function removeBoundAttribute(element: QueryBindingElement, name: string): void {
  element.removeAttribute?.(name);
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
  return element.tagName?.toLowerCase() !== 'progress';
}

function setBoundAttribute(element: QueryBindingElement, name: string, value: unknown): void {
  if ((name === 'checked' || name === 'indeterminate') && value === false) {
    removeBoundAttribute(element, name);
    return;
  }

  // SPEC §1 and §5.2: generated/client-updated attributes use the shared output-context model so
  // security behavior remains auditable in emitted code and in the live update path.
  const rendered = kovoBoundAttributeValue(name, value);
  element.setAttribute?.(name, rendered);
  if (name === 'value' && element.value !== undefined) {
    element.value = rendered;
  }
  if ((name === 'scrollLeft' || name === 'scrollleft') && element.scrollLeft !== undefined) {
    element.scrollLeft = Number(value) || 0;
  }
  if ((name === 'scrollTop' || name === 'scrolltop') && element.scrollTop !== undefined) {
    element.scrollTop = Number(value) || 0;
  }
  if (name === 'checked' && element.checked !== undefined) {
    element.checked = true;
  }
  if (name === 'indeterminate' && element.indeterminate !== undefined) {
    element.indeterminate = true;
  }
}

function formatBoundValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return '';
}
