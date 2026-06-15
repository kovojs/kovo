import { domAttributes } from './dom-like.js';
import type {
  AttributeElementLike,
  ClosestElementLike,
  QuerySelectorAllRootLike,
} from './dom-like.js';

export interface QueryBindingElement
  extends AttributeElementLike,
    ClosestElementLike<QueryBindingElement> {
  textContent?: string | null;
  value?: string;
}

export interface QueryBindingRoot extends QuerySelectorAllRootLike<QueryBindingElement> {}

export interface TemplateStampItem {
  html: string;
  index: number;
  key: string;
  value: unknown;
}

export interface TemplateStampHost extends QueryBindingElement {
  reconcileTemplateStamp(items: readonly TemplateStampItem[]): void;
}

export interface CompiledQueryDerive {
  name: string;
  select(value: unknown, root: QueryBindingRoot): unknown;
  selector?: string;
}

export interface CompiledQueryStamp {
  attr: string;
  select(value: unknown, root: QueryBindingRoot): unknown;
  selector: string;
}

export interface CompiledQueryTemplateStamp {
  key: string | ((item: unknown, index: number) => string | number);
  list: string;
  render(item: unknown, index: number): string;
  selector: string;
}

export interface CompiledQueryUpdatePlan {
  bindings?: boolean;
  derives?: readonly CompiledQueryDerive[];
  stamps?: readonly CompiledQueryStamp[];
  templateStamps?: readonly CompiledQueryTemplateStamp[];
}

export interface AppliedCompiledQueryUpdatePlan {
  bindings: string[];
  derives: string[];
  stamps: string[];
  templateStamps: string[];
}

export type CompiledQueryUpdatePlans = Readonly<
  Record<string, CompiledQueryUpdatePlan | undefined>
>;

export interface QueryBindingIndex {
  attributeBindingElements: readonly QueryBindingElement[];
}

export interface ApplyQueryBindingsOptions {
  bindingIndex?: QueryBindingIndex;
}

export interface ApplyCompiledQueryUpdatePlanOptions extends ApplyQueryBindingsOptions {}

export function createQueryBindingIndex(root: QueryBindingRoot): QueryBindingIndex {
  return {
    attributeBindingElements: queryAttributeBindingElements(root),
  };
}

export function applyQueryBindings(
  root: QueryBindingRoot,
  queryName: string,
  value: unknown,
  options: ApplyQueryBindingsOptions = {},
): string[] {
  return applyRootBindings(root, queryName, value, options);
}

export function applyStateBindings(
  root: QueryBindingRoot,
  state: unknown,
  options: ApplyQueryBindingsOptions = {},
): string[] {
  return applyRootBindings(root, 'state', state, { ...options, scopeRoot: root });
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
        element.removeAttribute?.(boundAttribute);
      } else {
        element.setAttribute?.(boundAttribute, formatBoundValue(boundValue));
      }
      applied.push(path);
    }
  }

  return applied;
}

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
        element.removeAttribute?.(stamp.attr);
      } else {
        element.setAttribute?.(stamp.attr, formatBoundValue(selected));
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
      if (!isTemplateStampHost(element)) continue;
      element.reconcileTemplateStamp(items);
      applied.templateStamps.push(stamp.selector);
    }
  }

  return applied;
}

export function supportsQueryBindings(root: unknown): root is QueryBindingRoot {
  return typeof (root as Partial<QueryBindingRoot>).querySelectorAll === 'function';
}

function isTemplateStampHost(element: QueryBindingElement): element is TemplateStampHost {
  return (
    'reconcileTemplateStamp' in element && typeof element.reconcileTemplateStamp === 'function'
  );
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

function elementBelongsToScope(element: QueryBindingElement, scopeRoot: unknown): boolean {
  if (!scopeRoot || element === scopeRoot) return true;

  const closestStateHost = element.closest?.('[fw-state]');
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

function formatBoundValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return '';
}
