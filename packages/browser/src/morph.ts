import { abortRemovedIslandSignals, defaultIslandSignalScope } from './handler-context.js';
import type { IslandSignalScope } from './handler-context.js';
import { findFragmentTargetElement, type FragmentTargetRoot } from './fragment-targets.js';
import { applyResponseFragments } from './response-fragment-apply.js';
import { kovoSetSafeAttribute } from './security-output.js';
import { kovoCreateHTML } from './trusted-types.js';
import type { FragmentChunk } from './wire-response-scanner.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface MorphTarget {
  appendHtml?(html: string): void;
  /**
   * Insert keyed rows at the START of the target (SPEC §9.3 `mode="prepend"`),
   * deduped by `kovo-key` (§13.2) with the framework scroll-anchor guarantee so
   * "load older" content does not shift the viewport. Optional: a target without
   * it falls back to a morphed prepend (no scroll anchor).
   */
  prependHtml?(html: string): void;
  readHtml?(): string;
  replaceWithHtml(html: string): void;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface MorphRoot {
  findFragmentTarget(target: string): MorphTarget | null;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export type MorphFragment = (target: MorphTarget, html: string) => void;

/** @internal A {@link MorphTarget} backed by a live DOM `Element` (SPEC §9.1). */
export class DomMorphTarget implements MorphTarget {
  element: Element;

  constructor(element: Element) {
    this.element = element;
  }

  readHtml(): string {
    return this.element.innerHTML;
  }

  appendHtml(html: string): void {
    const template = document.createElement('template');
    // SF (secure-framework Tier 3): route framework-assembled HTML through Kovo's sole
    // Trusted Types policy so this sink survives a strict `require-trusted-types-for`
    // CSP on Chromium (transparent passthrough elsewhere — see trusted-types.ts).
    template.innerHTML = kovoCreateHTML(html.trim());
    sanitizeDomFragment(template.content);
    this.element.append(...Array.from(template.content.childNodes));
  }

  prependHtml(html: string): void {
    const template = document.createElement('template');
    // SF (secure-framework Tier 3): Trusted Types policy seam (see appendHtml).
    template.innerHTML = kovoCreateHTML(html.trim());
    sanitizeDomFragment(template.content);
    // SPEC §9.3/§13.2: dedupe prepended rows by kovo-key (a key already present is
    // skipped, never re-inserted), insert the rest at the START in wire order, and
    // preserve the scroll anchor — the target is treated as the scroll container, so
    // its scrollTop is shifted by the inserted height to keep existing ("load older")
    // content visually fixed (no jump). Inert-until-touched holds as for append.
    const present = new Set<string>();
    for (const child of this.element.children) {
      const key = domMorphKey(child);
      if (key !== null) present.add(key);
    }
    const insert: Element[] = [];
    for (const node of Array.from(template.content.children)) {
      const key = domMorphKey(node);
      if (key !== null && present.has(key)) continue;
      insert.push(node);
    }
    const scrollTop = this.element.scrollTop;
    const scrollHeight = this.element.scrollHeight;
    this.element.prepend(...insert);
    this.element.scrollTop = scrollTop + (this.element.scrollHeight - scrollHeight);
  }

  replaceWithHtml(html: string): void {
    const template = document.createElement('template');
    // SF (secure-framework Tier 3): Trusted Types policy seam (see appendHtml).
    template.innerHTML = kovoCreateHTML(html.trim());
    const next = firstMorphElement(template.content);
    const activeState = captureActiveDomState(this.element);
    const scrollStates = captureDomScrollStates(this.element);

    if (!next) {
      this.element.replaceChildren();
      return;
    }

    morphDomElement(this.element, next);
    restoreActiveDomState(activeState);
    restoreDomScrollStates(scrollStates);
  }
}

function firstMorphElement(content: DocumentFragment): Element | null {
  for (const child of content.children) {
    if (isFragmentResourceHint(child)) continue;
    return child;
  }
  return null;
}

function isFragmentResourceHint(element: Element): boolean {
  return (
    element.tagName === 'LINK' &&
    (element.getAttribute('rel') ?? '')
      .split(/\s+/)
      .some((token) => token.toLowerCase() === 'stylesheet')
  );
}

/** @internal A {@link MorphRoot} over a live DOM {@link FragmentTargetRoot} (SPEC §9.1). */
export class DomMorphRoot implements MorphRoot {
  private readonly root: FragmentTargetRoot;

  constructor(root: FragmentTargetRoot) {
    this.root = root;
  }

  findFragmentTarget(target: string): MorphTarget | null {
    const element = findFragmentTargetElement(this.root, target);

    return element ? new DomMorphTarget(element) : null;
  }
}

/** @internal The default {@link MorphFragment}: replace the target with the fragment HTML (SPEC §9.1). */
export const keyedDomMorph: MorphFragment = (target, html) => {
  target.replaceWithHtml(html);
};

/** Runtime API used by Kovo applications and generated runtime integration. */
export type StructuralMorphKey = string | number;

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface StructuralMorphBrowserState {
  focused?: boolean;
  islandState?: unknown;
  scroll?: { left: number; top: number };
  selection?: { direction?: 'backward' | 'forward' | 'none'; end: number; start: number };
}

/**
 * One node in a browser-free structural tree: its `type`, optional `key`,
 * `props`, `text`, `children`, and captured `browserState`. Used by the
 * structural-morph reconciler (SPEC.md §9.1) and by hand-written conformance
 * test helpers that assert keyed reuse across reorder.
 */
export interface StructuralMorphNode {
  browserState?: StructuralMorphBrowserState;
  children?: StructuralMorphNode[];
  key?: StructuralMorphKey | null;
  props?: Record<string, unknown>;
  text?: string;
  type: string;
}

/** @internal Apply response fragments to a {@link MorphRoot} via the runtime morph engine (SPEC §9.1). */
export function applyFragments(
  root: MorphRoot,
  fragments: readonly FragmentChunk[],
  morph: MorphFragment = replaceFragment,
  islandSignalScope: IslandSignalScope = defaultIslandSignalScope,
): string[] {
  return applyResponseFragments<MorphTarget>(fragments, {
    appendFragment: (target, html) => appendFragment(target, html, morph),
    findFragmentTarget: (target) => root.findFragmentTarget(target),
    prependFragment: (target, html) => prependFragment(target, html, morph),
    replaceFragment(target, html) {
      abortRemovedIslandSignals(target.readHtml?.() ?? '', html, islandSignalScope);
      morph(target, html);
    },
  });
}

/**
 * Browser-free structural morph contract from SPEC.md §11.4 and §13.2:
 * the current tree is rewritten to the next tree shape while matching
 * sibling keys keep their object identity and browser-owned state across
 * insertion and reorder.
 */
export function morphStructuralTree(
  current: StructuralMorphNode,
  next: StructuralMorphNode,
): StructuralMorphNode {
  current.type = next.type;
  copyOptionalStructuralFields(current, next);

  if (next.children === undefined) {
    delete current.children;
    return current;
  }

  current.children = morphStructuralChildren(current.children ?? [], next.children);
  return current;
}

/** @internal Reconcile a DOM element in place against its next shape, preserving focus/state (SPEC §9.1). */
export function morphDomElement(current: Element, next: Element): Element {
  sanitizeDomElementTree(next);

  if (!canReuseDomElement(current, next)) {
    current.replaceWith(next);
    return next;
  }

  syncDomAttributes(current, next);
  if (current.getAttribute('kovo-state') !== null) {
    return current;
  }
  if (isActiveDomFormControl(current)) {
    return current;
  }

  morphDomChildren(current, next);
  return current;
}

/** @internal Sanitize a parsed DOM tree before adopting new response HTML (SPEC §4.8). */
export function sanitizeDomElementTree(element: Element): Element {
  for (const current of [element, ...element.querySelectorAll('*')]) {
    for (const attribute of Array.from(current.attributes)) {
      kovoSetSafeAttribute(current, attribute.name, attribute.value);
    }
  }

  return element;
}

function sanitizeDomFragment(fragment: DocumentFragment): void {
  for (const element of Array.from(fragment.children)) {
    sanitizeDomElementTree(element);
  }
}

function replaceFragment(target: MorphTarget, html: string): void {
  target.replaceWithHtml(html);
}

function appendFragment(target: MorphTarget, html: string, morph: MorphFragment): void {
  if (target.appendHtml) {
    target.appendHtml(html);
    return;
  }

  const current = target.readHtml?.();
  if (current !== undefined) {
    morph(target, `${current}${html}`);
    return;
  }

  morph(target, html);
}

/** @internal Apply a `mode="prepend"` fragment (SPEC §9.3): insert keyed rows at the START.
 * Uses the target's {@link MorphTarget.prependHtml} (keyed dedup + scroll anchor) when present;
 * otherwise morphs the prepended HTML ahead of the current content so rows still land first. */
function prependFragment(target: MorphTarget, html: string, morph: MorphFragment): void {
  if (target.prependHtml) {
    target.prependHtml(html);
    return;
  }

  const current = target.readHtml?.();
  if (current !== undefined) {
    morph(target, `${html}${current}`);
    return;
  }

  morph(target, html);
}

function copyOptionalStructuralFields(
  current: StructuralMorphNode,
  next: StructuralMorphNode,
): void {
  if (next.key === undefined) {
    delete current.key;
  } else {
    current.key = next.key;
  }

  if (next.props === undefined) {
    delete current.props;
  } else {
    current.props = { ...next.props };
  }

  if (next.text === undefined) {
    delete current.text;
  } else {
    current.text = next.text;
  }

  if (current.browserState === undefined && next.browserState !== undefined) {
    current.browserState = cloneBrowserState(next.browserState);
  }
}

function morphStructuralChildren(
  currentChildren: readonly StructuralMorphNode[],
  nextChildren: readonly StructuralMorphNode[],
): StructuralMorphNode[] {
  const currentByKey = indexStructuralKeys(currentChildren, 'current');
  indexStructuralKeys(nextChildren, 'next');

  const used = new Set<StructuralMorphNode>();
  let unkeyedCursor = 0;

  function takeNextUnkeyedCurrent(): StructuralMorphNode | undefined {
    while (unkeyedCursor < currentChildren.length) {
      const candidate = currentChildren[unkeyedCursor];
      unkeyedCursor += 1;

      if (!candidate || candidate.key != null || used.has(candidate)) continue;

      return candidate;
    }

    return undefined;
  }

  return nextChildren.map((nextChild) => {
    const matched =
      nextChild.key == null ? takeNextUnkeyedCurrent() : currentByKey.get(nextChild.key);

    if (!matched || used.has(matched)) {
      return cloneStructuralNode(nextChild);
    }

    used.add(matched);
    return morphStructuralTree(matched, nextChild);
  });
}

function indexStructuralKeys(
  children: readonly StructuralMorphNode[],
  side: 'current' | 'next',
): Map<StructuralMorphKey, StructuralMorphNode> {
  const byKey = new Map<StructuralMorphKey, StructuralMorphNode>();

  for (const child of children) {
    if (child.key == null) continue;

    if (byKey.has(child.key)) {
      throw new Error(`Duplicate ${side} structural morph key: ${String(child.key)}`);
    }

    byKey.set(child.key, child);
  }

  return byKey;
}

function cloneStructuralNode(node: StructuralMorphNode): StructuralMorphNode {
  const clone: StructuralMorphNode = { type: node.type };

  if (node.browserState !== undefined) clone.browserState = cloneBrowserState(node.browserState);
  if (node.key !== undefined) clone.key = node.key;
  if (node.props !== undefined) clone.props = { ...node.props };
  if (node.text !== undefined) clone.text = node.text;
  if (node.children !== undefined) {
    clone.children = node.children.map((child) => cloneStructuralNode(child));
  }

  return clone;
}

function cloneBrowserState(state: StructuralMorphBrowserState): StructuralMorphBrowserState {
  return {
    ...(state.focused === undefined ? {} : { focused: state.focused }),
    ...(state.islandState === undefined ? {} : { islandState: structuredClone(state.islandState) }),
    ...(state.scroll === undefined ? {} : { scroll: { ...state.scroll } }),
    ...(state.selection === undefined ? {} : { selection: { ...state.selection } }),
  };
}

function canReuseDomElement(current: Element, next: Element): boolean {
  const currentKey = domMorphKey(current);
  const nextKey = domMorphKey(next);

  return current.tagName === next.tagName && currentKey === nextKey;
}

function domMorphKey(element: Element): string | null {
  return element.getAttribute('kovo-key') ?? element.getAttribute('data-key');
}

function syncDomAttributes(current: Element, next: Element): void {
  const currentState = current.getAttribute('kovo-state');

  for (const name of Array.from(current.attributes, (attribute) => attribute.name)) {
    if (name === 'kovo-state' && currentState !== null) continue;
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  }

  for (const attribute of next.attributes) {
    if (attribute.name === 'kovo-state' && currentState !== null) continue;
    kovoSetSafeAttribute(current, attribute.name, attribute.value);
  }
}

function isActiveDomFormControl(element: Element): boolean {
  return (
    document.activeElement === element &&
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
  );
}

function captureActiveDomState(root: Element) {
  const element = document.activeElement;

  if (
    !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
    !root.contains(element)
  ) {
    return null;
  }

  return {
    element,
    selectionDirection: element.selectionDirection,
    selectionEnd: element.selectionEnd,
    selectionStart: element.selectionStart,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  };
}

function restoreActiveDomState(state: ReturnType<typeof captureActiveDomState>): void {
  if (!state || !state.element.isConnected) return;

  state.element.focus();
  if (state.selectionStart !== null && state.selectionEnd !== null) {
    state.element.setSelectionRange(
      state.selectionStart,
      state.selectionEnd,
      state.selectionDirection ?? 'none',
    );
  }
  state.element.scrollLeft = state.scrollLeft;
  state.element.scrollTop = state.scrollTop;
}

function captureDomScrollStates(root: Element) {
  return [...root.querySelectorAll<HTMLElement>('[kovo-key], [data-key]')]
    .filter((element) => element.scrollLeft !== 0 || element.scrollTop !== 0)
    .map((element) => ({
      element,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    }));
}

function restoreDomScrollStates(states: ReturnType<typeof captureDomScrollStates>): void {
  for (const state of states) {
    if (!state.element.isConnected) continue;

    state.element.scrollLeft = state.scrollLeft;
    state.element.scrollTop = state.scrollTop;
  }
}

function morphDomChildren(current: Element, next: Element): void {
  const currentByKey = new Map(
    [...current.children]
      .map((child) => [domMorphKey(child), child] as const)
      .filter((entry): entry is [string, Element] => entry[0] !== null),
  );
  const nextChildren = [...next.childNodes];
  const desiredNodes: ChildNode[] = [];

  for (const [index, nextChild] of nextChildren.entries()) {
    let desiredNode: ChildNode;
    if (!(nextChild instanceof Element)) {
      desiredNode = nextChild.cloneNode(true) as ChildNode;
    } else {
      const key = domMorphKey(nextChild);
      const existing = key ? currentByKey.get(key) : undefined;
      desiredNode = existing
        ? morphDomElement(existing, nextChild)
        : sanitizeDomElementTree(nextChild.cloneNode(true) as Element);
    }

    desiredNodes.push(desiredNode);
    current.insertBefore(desiredNode, current.childNodes[index] ?? null);
  }

  for (const child of Array.from(current.childNodes)) {
    if (!desiredNodes.includes(child)) child.remove();
  }
}
