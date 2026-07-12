import { renderedFragmentHtmlContent } from '@kovojs/core/internal/sink-policy';

import { abortRemovedIslandSignals, defaultIslandSignalScope } from './handler-context.js';
import type { IslandSignalScope } from './handler-context.js';
import { findFragmentTargetElement, type FragmentTargetRoot } from './fragment-targets.js';
import { reconcileKeyed } from './keyed-reconciler.js';
import { applyResponseFragments } from './response-fragment-apply.js';
import { kovoSetSafeAttribute } from './security-output.js';
import { securityStringTrim } from './security-witness-intrinsics.js';
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
    const template = document.createElement('template');
    // SF (secure-framework Tier 3): route framework-assembled HTML through Kovo's sole
    // Trusted Types policy so this sink survives a strict `require-trusted-types-for`
    // CSP on Chromium (transparent passthrough elsewhere — see trusted-types.ts).
    template.innerHTML = kovoCreateHTML(securityStringTrim(html));
    const nodes = Array.from(template.content.childNodes);
    sanitizeDomFragment(template.content);
    security.appendElementChildren(this.element, nodes);
  }

  prependHtml(html: string): void {
    const security = requireBrowserDomSecurity();
    const template = document.createElement('template');
    // SF (secure-framework Tier 3): Trusted Types policy seam (see appendHtml).
    template.innerHTML = kovoCreateHTML(securityStringTrim(html));
    // SPEC §9.3/§13.2: dedupe prepended rows by kovo-key (a key already present is
    // skipped, never re-inserted), insert the rest at the START in wire order, and
    // preserve the scroll anchor — the target is treated as the scroll container, so
    // its scrollTop is shifted by the inserted height to keep existing ("load older")
    // content visually fixed (no jump). Inert-until-touched holds as for append.
    const insert = reconcileKeyed([...this.element.children], [...template.content.children], {
      create(node) {
        return node;
      },
      currentKey(child) {
        return domMorphKey(child);
      },
      match(current) {
        return current;
      },
      nextKey(node) {
        return domMorphKey(node);
      },
      preserveUnkeyed: false,
    }).filter((node) => !this.element.contains(node));
    const scrollTop = this.element.scrollTop;
    const scrollHeight = this.element.scrollHeight;
    // Build the insertion plan before the final sanitizer pass. The captured native
    // commit runs immediately afterward, so no authored accessor/method can mutate a
    // node after validation but before adoption (SPEC §6.6 classify-and-pin).
    sanitizeDomFragment(template.content);
    security.prependElementChildren(this.element, insert);
    this.element.scrollTop = scrollTop + (this.element.scrollHeight - scrollHeight);
  }

  replaceWithHtml(html: string): void {
    const security = requireBrowserDomSecurity();
    const template = document.createElement('template');
    // SF (secure-framework Tier 3): Trusted Types policy seam (see appendHtml).
    template.innerHTML = kovoCreateHTML(securityStringTrim(html));
    const next = firstMorphElement(template.content);
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
  const canReuse = canReuseDomElement(current, next);
  sanitizeDomElementTree(next);

  if (!canReuse) {
    security.replaceElement(current, next);
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

interface ActiveDomState {
  element: HTMLElement;
  selectionDirection?: 'backward' | 'forward' | 'none' | null;
  selectionEnd?: number | null;
  selectionStart?: number | null;
  scrollLeft: number;
  scrollTop: number;
}

function captureActiveDomState(root: Element): ActiveDomState | null {
  const element = document.activeElement;

  if (!(element instanceof HTMLElement) || !root.contains(element)) {
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
  if (!state || !state.element.isConnected) return;

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
  const security = requireBrowserDomSecurity();
  const nextChildren = [...next.childNodes];
  const desiredNodes = reconcileKeyed([...current.childNodes], nextChildren, {
    create(nextChild) {
      return cloneDomChildNode(nextChild);
    },
    currentKey(child) {
      return child instanceof Element ? domMorphKey(child) : null;
    },
    match(currentChild, nextChild) {
      if (currentChild instanceof Element && nextChild instanceof Element) {
        return morphDomElement(currentChild, nextChild);
      }
      return cloneDomChildNode(nextChild);
    },
    nextKey(child) {
      return child instanceof Element ? domMorphKey(child) : null;
    },
  });

  // `replaceChildren` adopts the already-reconciled node plan in one boot-pinned native
  // commit. Reused keyed nodes retain identity; removed nodes are discarded atomically.
  security.replaceElementChildren(current, desiredNodes);
}

function cloneDomChildNode(child: ChildNode): ChildNode {
  if (child instanceof Element) return sanitizeDomElementTree(child.cloneNode(true) as Element);
  return child.cloneNode(true) as ChildNode;
}
