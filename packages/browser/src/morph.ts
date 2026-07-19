import { renderedFragmentHtmlContent } from '@kovojs/core/internal/sink-policy';

import { abortRemovedIslandSignals, defaultIslandSignalScope } from './handler-context.js';
import type { IslandSignalScope } from './handler-context.js';
import { findFragmentTargetElement, type FragmentTargetRoot } from './fragment-targets.js';
import { reconcileKeyed } from './keyed-reconciler.js';
import {
  applyResponseFragments,
  preservesReviewedHtmlElementContextAttribute,
  sanitizeHtmlResponseElementTree,
  setSafeHtmlResponseAttribute,
} from './response-fragment-apply.js';
import { securityArrayAppend, securityStringTrim } from './security-witness-intrinsics.js';
import { kovoCreateHTML } from './trusted-types.js';
import type { FragmentChunk } from './wire-response-scanner.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

// SPEC §6.6 rule 6: capture and validate the DOM commit methods while the framework
// module graph is initializing, before authored client modules can replace realm intrinsics.
const browserDomSecurity =
  typeof document === 'undefined' || typeof Element === 'undefined'
    ? undefined
    : createBrowserNavigationSecurityControls();

function requireBrowserDomSecurity(): NonNullable<typeof browserDomSecurity> {
  if (!browserDomSecurity) {
    throw new TypeError('Kovo DOM morph security controls are unavailable.');
  }
  return browserDomSecurity;
}

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
    const security = requireBrowserDomSecurity();
    // SF (secure-framework Tier 3): route framework-assembled HTML through Kovo's sole
    // Trusted Types policy so this sink survives a strict `require-trusted-types-for`
    // CSP on Chromium (transparent passthrough elsewhere — see trusted-types.ts).
    const content = security.createFragmentContent(kovoCreateHTML(securityStringTrim(html)));
    const nodes = security.snapshotChildNodes(content);
    sanitizeDomNodes(nodes, security);
    security.appendElementChildren(this.element, nodes);
  }

  prependHtml(html: string): void {
    const security = requireBrowserDomSecurity();
    // SF (secure-framework Tier 3): Trusted Types policy seam (see appendHtml).
    const content = security.createFragmentContent(kovoCreateHTML(securityStringTrim(html)));
    // SPEC §9.3/§13.2: dedupe prepended rows by kovo-key (a key already present is
    // skipped, never re-inserted), insert the rest at the START in wire order, and
    // preserve the scroll anchor — the target is treated as the scroll container, so
    // its scrollTop is shifted by the inserted height to keep existing ("load older")
    // content visually fixed (no jump). Inert-until-touched holds as for append.
    const current = security.snapshotElementChildren(this.element);
    const incoming = security.snapshotElementChildren(content);
    const insert: Element[] = [];
    const presentKeys = security.createSecurityMap<string, true>();
    for (let currentIndex = 0; currentIndex < current.length; currentIndex += 1) {
      const currentNode = current[currentIndex];
      if (!currentNode) continue;
      const key = domMorphKey(currentNode, security);
      if (key !== null) security.setSecurityMapValue(presentKeys, key, true);
    }
    for (let incomingIndex = 0; incomingIndex < incoming.length; incomingIndex += 1) {
      const node = incoming[incomingIndex];
      if (!node) continue;
      const key = domMorphKey(node, security);
      if (key !== null) {
        if (security.hasSecurityMapValue(presentKeys, key)) continue;
        security.setSecurityMapValue(presentKeys, key, true);
      }
      securityArrayAppend(insert, node, 'Browser packages/browser/src/morph.ts collection');
    }
    const scrollTop = this.element.scrollTop;
    const scrollHeight = this.element.scrollHeight;
    // Sanitize the exact dense adoption plan, not a related live fragment collection.
    // The boot-pinned commit runs immediately afterward (SPEC §6.6 classify-and-pin).
    sanitizeDomNodes(insert, security);
    security.prependElementChildren(this.element, insert);
    this.element.scrollTop = scrollTop + (this.element.scrollHeight - scrollHeight);
  }

  replaceWithHtml(html: string): void {
    const security = requireBrowserDomSecurity();
    // SF (secure-framework Tier 3): Trusted Types policy seam (see appendHtml).
    const content = security.createFragmentContent(kovoCreateHTML(securityStringTrim(html)));
    const next = firstMorphElement(content, security);
    const activeState = captureActiveDomState(this.element);
    const scrollStates = captureDomScrollStates(this.element);

    if (!next) {
      security.replaceElementChildren(this.element, []);
      return;
    }

    morphDomElement(this.element, next);
    restoreActiveDomState(activeState);
    restoreDomScrollStates(scrollStates);
  }
}

function firstMorphElement(
  content: DocumentFragment,
  security = requireBrowserDomSecurity(),
): Element | null {
  const children = security.snapshotElementChildren(content);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child || isFragmentResourceHint(child, security)) continue;
    return child;
  }
  return null;
}

function isFragmentResourceHint(element: Element, security = requireBrowserDomSecurity()): boolean {
  return (
    security.readElementTagName(element) === 'LINK' &&
    hasStylesheetRelToken(security.readAttribute(element, 'rel') ?? '', security)
  );
}

function hasStylesheetRelToken(value: string, security = requireBrowserDomSecurity()): boolean {
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const code = index < value.length ? security.charCode(value, index) : 0x20;
    const whitespace = code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
    if (!whitespace) continue;
    if (start < index && security.lower(security.slice(value, start, index)) === 'stylesheet') {
      return true;
    }
    start = index + 1;
  }
  return false;
}

/** @internal A {@link MorphRoot} over a live DOM {@link FragmentTargetRoot} (SPEC §9.1). */
export class DomMorphRoot implements MorphRoot {
  private readonly root: FragmentTargetRoot;

  constructor(root: FragmentTargetRoot) {
    this.root = root;
  }

  findFragmentTarget(target: string): MorphTarget | null {
    // SPEC §6.6/§9.1: target identity decides where authoritative server truth commits. Route
    // every lookup through the boot-witnessed DOM controls so authored prototype replacement
    // cannot retain a revoked target by redirecting the fragment into a decoy.
    const element = findFragmentTargetElement(this.root, target, requireBrowserDomSecurity());

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
    appendFragment: (target, html) =>
      appendFragment(target, renderedFragmentHtmlContent(html), morph),
    findFragmentTarget: (target) => root.findFragmentTarget(target),
    prependFragment: (target, html) =>
      prependFragment(target, renderedFragmentHtmlContent(html), morph),
    replaceFragment(target, html) {
      const content = renderedFragmentHtmlContent(html);
      abortRemovedIslandSignals(target.readHtml?.() ?? '', content, islandSignalScope);
      morph(target, content);
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
  const security = requireBrowserDomSecurity();
  // Resolve the reuse plan before validation. On replacement, the final sanitizer
  // pass is followed only by the boot-pinned native replaceWith invocation.
  const canReuse = canReuseDomElement(current, next, security);
  sanitizeDomElementTree(next, security);

  if (!canReuse) {
    security.replaceElement(current, next);
    return next;
  }

  syncDomAttributes(current, next, security);
  if (security.readAttribute(current, 'kovo-state') !== null) {
    return current;
  }
  if (isActiveDomFormControl(current, security)) {
    return current;
  }

  morphDomChildren(current, next, security);
  return current;
}

/** @internal Sanitize a parsed DOM tree before adopting new response HTML (SPEC §4.8). */
export function sanitizeDomElementTree(
  element: Element,
  security = requireBrowserDomSecurity(),
): Element {
  return sanitizeHtmlResponseElementTree(element, security);
}

function sanitizeDomNodes(nodes: readonly Node[], security = requireBrowserDomSecurity()): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node && security.readElementTagName(node) !== undefined) {
      sanitizeDomElementTree(node as Element, security);
    }
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
  return reconcileKeyed(currentChildren, nextChildren, {
    create: cloneStructuralNode,
    currentKey(child) {
      return child.key;
    },
    match(current, next) {
      return morphStructuralTree(current, next);
    },
    nextKey(child) {
      return child.key;
    },
    onDuplicateKey(side, key) {
      throw new Error(`Duplicate ${side} structural morph key: ${String(key)}`);
    },
  });
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

function canReuseDomElement(
  current: Element,
  next: Element,
  security = requireBrowserDomSecurity(),
): boolean {
  const currentKey = domMorphKey(current, security);
  const nextKey = domMorphKey(next, security);

  return (
    security.readElementTagName(current) === security.readElementTagName(next) &&
    currentKey === nextKey
  );
}

function domMorphKey(element: Element, security = requireBrowserDomSecurity()): string | null {
  return security.readAttribute(element, 'kovo-key') ?? security.readAttribute(element, 'data-key');
}

function syncDomAttributes(
  current: Element,
  next: Element,
  security = requireBrowserDomSecurity(),
): void {
  const currentState = security.readAttribute(current, 'kovo-state');

  const currentAttributes = security.snapshotElementAttributes(current);
  for (let index = 0; index < currentAttributes.length; index += 1) {
    const attribute = currentAttributes[index];
    if (!attribute) continue;
    if (attribute.name === 'kovo-state' && currentState !== null) continue;
    if (
      !security.hasElementAttribute(next, attribute.name) &&
      !preservesReviewedHtmlElementContextAttribute(current, attribute.name, security)
    ) {
      security.removeElementAttribute(current, attribute.name);
    }
  }

  const nextAttributes = security.snapshotElementAttributes(next);
  for (let index = 0; index < nextAttributes.length; index += 1) {
    const attribute = nextAttributes[index];
    if (!attribute) continue;
    if (attribute.name === 'kovo-state' && currentState !== null) continue;
    setSafeHtmlResponseAttribute(current, attribute.name, attribute.value, security, true);
  }
}

function isActiveDomFormControl(element: Element, security = requireBrowserDomSecurity()): boolean {
  const tagName = security.readElementTagName(element);
  return (
    security.readDocumentActiveElement() === element &&
    (tagName === 'INPUT' || tagName === 'TEXTAREA')
  );
}

interface ActiveDomState {
  element: HTMLElement;
  selectionDirection?: 'backward' | 'forward' | 'none' | null;
  selectionEnd?: number | null;
  selectionStart?: number | null;
  scrollLeft: number;
  scrollTop: number;
}

function captureActiveDomState(root: Element): ActiveDomState | null {
  const security = requireBrowserDomSecurity();
  const element = security.readDocumentActiveElement();

  if (!(element instanceof HTMLElement) || !security.elementContains(root, element)) {
    return null;
  }

  return {
    element,
    ...(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? {
          selectionDirection: element.selectionDirection,
          selectionEnd: element.selectionEnd,
          selectionStart: element.selectionStart,
        }
      : {}),
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  };
}

function restoreActiveDomState(state: ActiveDomState | null): void {
  const security = requireBrowserDomSecurity();
  if (!state || !security.readNodeIsConnected(state.element)) return;

  state.element.focus();
  if (
    (state.element instanceof HTMLInputElement || state.element instanceof HTMLTextAreaElement) &&
    state.selectionStart !== undefined &&
    state.selectionEnd !== undefined &&
    state.selectionStart !== null &&
    state.selectionEnd !== null
  ) {
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
  const security = requireBrowserDomSecurity();
  return security
    .queryAllElements(root, '[kovo-key], [data-key]')
    .map((element) => element as HTMLElement)
    .filter((element) => element.scrollLeft !== 0 || element.scrollTop !== 0)
    .map((element) => ({
      element,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    }));
}

function restoreDomScrollStates(states: ReturnType<typeof captureDomScrollStates>): void {
  const security = requireBrowserDomSecurity();
  for (const state of states) {
    if (!security.readNodeIsConnected(state.element)) continue;

    state.element.scrollLeft = state.scrollLeft;
    state.element.scrollTop = state.scrollTop;
  }
}

function morphDomChildren(
  current: Element,
  next: Element,
  security = requireBrowserDomSecurity(),
): void {
  const currentChildren = security.snapshotChildNodes(current);
  const nextChildren = security.snapshotChildNodes(next);
  const desiredNodes: ChildNode[] = [];
  const currentByKey = security.createSecurityMap<string, ChildNode>();
  const usedCurrent = security.createSecurityMap<ChildNode, true>();
  let unkeyedCursor = 0;

  for (let currentIndex = 0; currentIndex < currentChildren.length; currentIndex += 1) {
    const candidate = currentChildren[currentIndex];
    if (!candidate || security.readElementTagName(candidate) === undefined) continue;
    const key = domMorphKey(candidate as Element, security);
    if (key !== null && !security.hasSecurityMapValue(currentByKey, key)) {
      security.setSecurityMapValue(currentByKey, key, candidate);
    }
  }

  for (let nextIndex = 0; nextIndex < nextChildren.length; nextIndex += 1) {
    const nextChild = nextChildren[nextIndex];
    if (!nextChild) continue;
    const nextKey =
      security.readElementTagName(nextChild) !== undefined
        ? domMorphKey(nextChild as Element, security)
        : null;
    let matched: ChildNode | undefined;

    if (nextKey === null) {
      while (unkeyedCursor < currentChildren.length) {
        const candidate = currentChildren[unkeyedCursor];
        unkeyedCursor += 1;
        if (!candidate) continue;
        const candidateKey =
          security.readElementTagName(candidate) !== undefined
            ? domMorphKey(candidate as Element, security)
            : null;
        if (candidateKey !== null || security.hasSecurityMapValue(usedCurrent, candidate)) continue;
        matched = candidate;
        break;
      }
    } else {
      matched = security.getSecurityMapValue(currentByKey, nextKey);
    }

    if (!matched || security.hasSecurityMapValue(usedCurrent, matched)) {
      securityArrayAppend(
        desiredNodes,
        cloneDomChildNode(nextChild, security),
        'Browser packages/browser/src/morph.ts collection',
      );
      continue;
    }

    security.setSecurityMapValue(usedCurrent, matched, true);
    if (
      security.readElementTagName(matched) !== undefined &&
      security.readElementTagName(nextChild) !== undefined
    ) {
      securityArrayAppend(
        desiredNodes,
        morphDomElement(matched as Element, nextChild as Element),
        'Browser packages/browser/src/morph.ts collection',
      );
    } else {
      securityArrayAppend(
        desiredNodes,
        cloneDomChildNode(nextChild, security),
        'Browser packages/browser/src/morph.ts collection',
      );
    }
  }

  // Reconciliation itself is not an authority boundary: sanitize the exact dense
  // output plan immediately before the boot-pinned replaceChildren commit.
  sanitizeDomNodes(desiredNodes, security);
  // `replaceChildren` adopts the already-reconciled node plan in one boot-pinned native
  // commit. Reused keyed nodes retain identity; removed nodes are discarded atomically.
  security.replaceElementChildren(current, desiredNodes);
}

function cloneDomChildNode(child: ChildNode, security = requireBrowserDomSecurity()): ChildNode {
  const clone = security.cloneDomNode(child, true) as ChildNode;
  if (security.readElementTagName(clone) !== undefined) {
    return sanitizeDomElementTree(clone as Element, security);
  }
  return clone;
}
