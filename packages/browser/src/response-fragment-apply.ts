import type { RenderedFragmentHtml } from '@kovojs/core/internal/sink-policy';

import type { FragmentChunk } from './wire-response-scanner.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { kovoCreateHTML } from './trusted-types.js';
import { securityArrayAppend } from './security-witness-intrinsics.js';

type BrowserNavigationSecurityControls = ReturnType<typeof createBrowserNavigationSecurityControls>;

export type HtmlResponseFragmentSecurityControls = Pick<
  BrowserNavigationSecurityControls,
  | 'appendElementChildren'
  | 'charCode'
  | 'cloneDomNode'
  | 'createFragmentContent'
  | 'createSecurityMap'
  | 'elementContains'
  | 'hasElementAttribute'
  | 'indexOf'
  | 'getSecurityMapValue'
  | 'hasSecurityMapValue'
  | 'lower'
  | 'prependElementChildren'
  | 'queryAllElements'
  | 'readAttribute'
  | 'readDocumentActiveElement'
  | 'readElementTagName'
  | 'readNodeIsConnected'
  | 'regExpExec'
  | 'regExpTest'
  | 'removeElementAttribute'
  | 'replaceElement'
  | 'replaceElementChildren'
  | 'setElementAttribute'
  | 'setSecurityMapValue'
  | 'slice'
  | 'snapshotChildNodes'
  | 'snapshotElementAttributes'
  | 'snapshotElementChildren'
  | 'trim'
>;

function renderedFragmentHtmlContent(value: { readonly html: string }): string {
  return value.html;
}

export interface ResponseFragmentApplyOptions<Target> {
  appendFragment(target: Target, html: RenderedFragmentHtml): void;
  findFragmentTarget(target: string): Target | null | undefined;
  /**
   * Insert prepended keyed rows at the START of the target with the §9.3
   * scroll-anchor guarantee (SPEC §9.3/§13.2). Optional: callers that omit it
   * (e.g. plain-object fragment harnesses) fall back to {@link appendFragment}.
   */
  prependFragment?(target: Target, html: RenderedFragmentHtml): void;
  replaceFragment(target: Target, html: RenderedFragmentHtml): void;
}

export interface HtmlResponseFragmentApplyTarget extends Element {}

export function applyResponseFragment<Target>(
  fragment: FragmentChunk,
  options: ResponseFragmentApplyOptions<Target>,
): boolean {
  const element = options.findFragmentTarget(fragment.target);
  if (!element) return false;

  if (fragment.mode === 'append') {
    options.appendFragment(element, fragment.html);
  } else if (fragment.mode === 'prepend') {
    // SPEC §9.3: prepend inserts at the START with a scroll-anchor guarantee. A
    // caller without a prepend sink degrades to append (still an ordered insert,
    // just at the end) rather than a whole-target replace. Each sink is invoked
    // through the `options` receiver so an object-method sink keeps its `this`.
    if (options.prependFragment) {
      options.prependFragment(element, fragment.html);
    } else {
      options.appendFragment(element, fragment.html);
    }
  } else {
    options.replaceFragment(element, fragment.html);
  }
  return true;
}

export function applyResponseFragments<Target>(
  fragments: readonly FragmentChunk[],
  options: ResponseFragmentApplyOptions<Target>,
): string[] {
  // SPEC.md §9.1: decoded kovo-fragment chunks report the same applied target
  // list whether the caller is modular DOM morph or the generated inline loader.
  const applied: string[] = [];

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    if (fragment && applyResponseFragment(fragment, options)) {
      securityArrayAppend(
        applied,
        fragment.target,
        'Browser packages/browser/src/response-fragment-apply.ts collection',
      );
    }
  }

  return applied;
}

export function applyHtmlResponseFragments(
  fragments: readonly FragmentChunk[],
  findFragmentTarget: (target: string) => HtmlResponseFragmentApplyTarget | null | undefined,
  security: HtmlResponseFragmentSecurityControls = createBrowserNavigationSecurityControls(),
): string[] {
  return p(fragments, findFragmentTarget, security, kovoCreateHTML);
}

export function p(
  fs: readonly FragmentChunk[],
  f: (target: string) => HtmlResponseFragmentApplyTarget | null | undefined,
  security: HtmlResponseFragmentSecurityControls,
  createHTML: (html: string) => string,
): string[] {
  // SPEC.md §4.4/§9.1: generated inline apply and modular decoded fragment
  // tests share the DOM HTML adapter instead of carrying an inline-only clone.
  const a: string[] = [];

  for (let index = 0; index < fs.length; index += 1) {
    const x = fs[index];
    if (!x) continue;
    const e = f(x.target);
    if (!e) continue;

    if (x.mode === 'append' || x.mode === 'prepend') {
      // C221 / SPEC §4.4/§6.6/§9.1: modular and generated callers inject a boot-owned exact-byte
      // Trusted Types mint. The canonical apply closure never reads a public realm policy cache.
      const content = security.createFragmentContent(
        createHTML(renderedFragmentHtmlContent(x.html)),
      );
      if (x.mode === 'prepend') {
        // SPEC §9.3/§13.2: insert keyed rows at the START, deduped by kovo-key (a
        // row whose key is already present is skipped, never re-inserted), and keep
        // the scroll anchor — the target is the scroll container, so its scrollTop is
        // shifted by the inserted height to keep existing ("load older") content
        // visually fixed (no jump). Inert-until-touched holds as for append.
        const ex = security.createSecurityMap<string, true>();
        const rememberKey = (key: string): boolean => {
          if (security.hasSecurityMapValue(ex, key)) return false;
          security.setSecurityMapValue(ex, key, true);
          return true;
        };
        const currentRows = security.snapshotElementChildren(e);
        for (let index = 0; index < currentRows.length; index += 1) {
          const current = currentRows[index];
          if (!current) continue;
          const ck = k(current, security);
          if (ck !== null) rememberKey(ck);
        }
        const ins: Element[] = [];
        const incoming = security.snapshotElementChildren(content);
        for (let index = 0; index < incoming.length; index += 1) {
          const n = incoming[index];
          if (!n) continue;
          const nk = k(n, security);
          if (nk !== null && !rememberKey(nk)) continue;
          securityArrayAppend(
            ins,
            n,
            'Browser packages/browser/src/response-fragment-apply.ts collection',
          );
        }
        const top = e.scrollTop;
        const height = e.scrollHeight;
        for (let index = 0; index < ins.length; index += 1) {
          const node = ins[index];
          if (node) g(node, security);
        }
        security.prependElementChildren(e, ins);
        e.scrollTop = top + (e.scrollHeight - height);
      } else {
        const nodes = security.snapshotChildNodes(content);
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index];
          if (node && security.readElementTagName(node) !== undefined) {
            g(node as Element, security);
          }
        }
        security.appendElementChildren(e, nodes);
      }
    } else {
      d(e, x.html, security, createHTML);
    }
    securityArrayAppend(
      a,
      x.target,
      'Browser packages/browser/src/response-fragment-apply.ts collection',
    );
  }

  return a;
}

function d(
  e: HtmlResponseFragmentApplyTarget,
  h: RenderedFragmentHtml,
  security: HtmlResponseFragmentSecurityControls,
  createHTML: (html: string) => string,
): void {
  const content = security.createFragmentContent(createHTML(renderedFragmentHtmlContent(h)));
  const n = firstMorphElement(content, security);
  const active = security.readDocumentActiveElement();
  const s = active && security.elementContains(e, active) ? active : null;
  const q: HTMLElement[] = [];
  const keyed = security.queryAllElements(e, '[kovo-key]');
  for (let index = 0; index < keyed.length; index += 1) {
    const x = keyed[index] as HTMLElement | undefined;
    if (!x) continue;
    if (x.scrollTop) {
      (x as HTMLElement & { s?: number }).s = x.scrollTop;
      securityArrayAppend(
        q,
        x,
        'Browser packages/browser/src/response-fragment-apply.ts collection',
      );
    }
  }

  if (n) {
    m(e, n, security);
  } else {
    security.replaceElementChildren(e, []);
  }
  (s as HTMLElement | null)?.focus();
  for (let index = 0; index < q.length; index += 1) {
    const x = q[index];
    if (x && security.readNodeIsConnected(x)) {
      x.scrollTop = (x as HTMLElement & { s: number }).s;
    }
  }
}

function firstMorphElement(
  content: DocumentFragment,
  security: HtmlResponseFragmentSecurityControls,
): Element | undefined {
  const children = security.snapshotElementChildren(content);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child || isFragmentResourceHint(child, security)) continue;
    return child;
  }
  return undefined;
}

function isFragmentResourceHint(
  element: Element,
  security: HtmlResponseFragmentSecurityControls,
): boolean {
  return (
    security.readElementTagName(element) === 'LINK' &&
    hasStylesheetRelToken(security.readAttribute(element, 'rel') ?? '', security)
  );
}

function hasStylesheetRelToken(
  value: string,
  security: HtmlResponseFragmentSecurityControls,
): boolean {
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

function k(e: Element, security: HtmlResponseFragmentSecurityControls): string | null {
  return security.readAttribute(e, 'kovo-key');
}

function m(c: Element, n: Element, security: HtmlResponseFragmentSecurityControls): Element {
  const replace =
    security.readElementTagName(c) !== security.readElementTagName(n) ||
    k(c, security) !== k(n, security);
  g(n, security);
  if (replace) {
    security.replaceElement(c, n);
    return n;
  }

  const currentAttributes = security.snapshotElementAttributes(c);
  for (let index = currentAttributes.length; index--; ) {
    const attribute = currentAttributes[index];
    if (attribute && !security.hasElementAttribute(n, attribute.name)) {
      security.removeElementAttribute(c, attribute.name);
    }
  }
  const nextAttributes = security.snapshotElementAttributes(n);
  for (let index = 0; index < nextAttributes.length; index += 1) {
    const attribute = nextAttributes[index];
    if (attribute) sa(c, attribute.name, attribute.value, security);
  }

  // SPEC.md §9.1: a focused keyed input/textarea keeps its browser-owned
  // selection state because keyed morph reuses the live element and skips
  // rewriting its children/value.
  if ((c as HTMLInputElement | HTMLTextAreaElement).selectionStart != null) return c;

  u(c, n, security);
  return c;
}

function sa(
  e: Element,
  name: string,
  v: string,
  security: HtmlResponseFragmentSecurityControls,
): void {
  if (inertBlockedSvgSmilElement(e, security)) return;
  const n = security.lower(name);
  if (blocksDocumentNavigationAttribute(e, n, v, security)) {
    security.removeElementAttribute(e, name);
    return;
  }
  if (r(n)) {
    security.removeElementAttribute(e, name);
    return;
  }
  if (n === 'style' && c(v, security)) {
    security.removeElementAttribute(e, name);
    return;
  }
  if (n === 'srcset' || n === 'imagesrcset') {
    const s = y(v, security);
    if (s) security.setElementAttribute(e, name, s);
    else security.removeElementAttribute(e, name);
    return;
  }
  if (isUrlAttributeName(n)) {
    if (w(v, security)) {
      security.setElementAttribute(e, name, '#');
      return;
    }
  }
  security.setElementAttribute(e, name, v);
}

function r(n: string): boolean {
  return (
    (n.length > 2 && n[0] === 'o' && n[1] === 'n' && n[2] !== ':') ||
    n === 'srcdoc' ||
    n === 'dangerouslysetinnerhtml' ||
    n === 'innerhtml' ||
    n === 'outerhtml' ||
    n === 'inserthtml' ||
    n === 'insertadjacenthtml'
  );
}

function isUrlAttributeName(n: string): boolean {
  return (
    n === 'href' ||
    n === 'src' ||
    n === 'action' ||
    n === 'formaction' ||
    n === 'poster' ||
    n === 'background' ||
    n === 'cite' ||
    n === 'data' ||
    n === 'ping' ||
    n === 'xlink:href'
  );
}

function isBlockedSvgSmilTagName(
  name: string | undefined,
  security: HtmlResponseFragmentSecurityControls,
): boolean {
  const n = security.lower(name ?? '');
  return (
    n === 'animate' ||
    n === 'animatecolor' ||
    n === 'animatemotion' ||
    n === 'animatetransform' ||
    n === 'discard' ||
    n === 'set'
  );
}

/**
 * SPEC.md §4.8 / §5.2 rule 10: SMIL's target and transfer attributes form one temporal
 * executable sink, including href-targeted siblings. Strip the complete primitive before a parsed
 * response tree is adopted; retaining selected "safe" attributes would re-open ordering attacks.
 */
function inertBlockedSvgSmilElement(
  element: Element,
  security: HtmlResponseFragmentSecurityControls,
): boolean {
  if (!isBlockedSvgSmilTagName(security.readElementTagName(element), security)) return false;
  const attributes = security.snapshotElementAttributes(element);
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index];
    if (attribute) security.removeElementAttribute(element, attribute.name);
  }
  security.replaceElementChildren(element, []);
  return true;
}

/**
 * SPEC §4.8 / §5.2 rule 10: document-wide navigation is one element/pair sink, not a
 * collection of ordinary independent attributes. A `<base>` is always inert. A meta refresh keeps
 * its descriptive attributes but loses `content`, which is the byte-carrying navigation half.
 */
function inertDocumentNavigationElement(
  element: Element,
  security: HtmlResponseFragmentSecurityControls,
): boolean {
  const tag = security.lower(security.readElementTagName(element) ?? '');
  if (tag === 'base') {
    const attributes = security.snapshotElementAttributes(element);
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes[index];
      if (attribute) security.removeElementAttribute(element, attribute.name);
    }
    security.replaceElementChildren(element, []);
    return true;
  }
  if (tag === 'meta' && metaElementHasRefreshPosture(element, security)) {
    removeAsciiCaseAttribute(element, 'content', security);
  }
  return false;
}

function blocksDocumentNavigationAttribute(
  element: Element,
  normalizedName: string,
  value: string,
  security: HtmlResponseFragmentSecurityControls,
): boolean {
  const tag = security.lower(security.readElementTagName(element) ?? '');
  if (tag === 'base') {
    inertDocumentNavigationElement(element, security);
    return true;
  }
  if (tag !== 'meta') return false;
  if (normalizedName === 'content') return metaElementHasRefreshPosture(element, security);
  if (
    (normalizedName === 'http-equiv' || normalizedName === 'httpequiv') &&
    security.lower(security.trim(value)) === 'refresh'
  ) {
    removeAsciiCaseAttribute(element, 'content', security);
  }
  return false;
}

function metaElementHasRefreshPosture(
  element: Element,
  security: HtmlResponseFragmentSecurityControls,
): boolean {
  const effective =
    security.readAttribute(element, 'http-equiv') ?? security.readAttribute(element, 'httpequiv');
  return effective !== null && security.lower(security.trim(effective)) === 'refresh';
}

function removeAsciiCaseAttribute(
  element: Element,
  expectedName: string,
  security: HtmlResponseFragmentSecurityControls,
): void {
  const attributes = security.snapshotElementAttributes(element);
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index];
    if (attribute && security.lower(attribute.name) === expectedName) {
      security.removeElementAttribute(element, attribute.name);
    }
  }
}

function g(e: Element, security: HtmlResponseFragmentSecurityControls): Element {
  const descendants = security.queryAllElements(e, '*');
  for (let elementIndex = -1; elementIndex < descendants.length; elementIndex += 1) {
    const x = elementIndex < 0 ? e : descendants[elementIndex];
    if (!x) continue;
    if (inertBlockedSvgSmilElement(x, security)) continue;
    if (inertDocumentNavigationElement(x, security)) continue;
    const attributes = security.snapshotElementAttributes(x);
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex];
      if (attribute) sa(x, attribute.name, attribute.value, security);
    }
  }
  return e;
}

/** @internal Sanitize one parsed response element tree through the shared output membrane. */
export function sanitizeHtmlResponseElementTree(
  element: Element,
  security: HtmlResponseFragmentSecurityControls = createBrowserNavigationSecurityControls(),
): Element {
  return g(element, security);
}

/** @internal Apply one response attribute through the shared pinned sanitizer policy. */
export function setSafeHtmlResponseAttribute(
  element: Element,
  name: string,
  value: string,
  security: HtmlResponseFragmentSecurityControls = createBrowserNavigationSecurityControls(),
): void {
  sa(element, name, value, security);
}

function y(v: string, security: HtmlResponseFragmentSecurityControls): string | null {
  const r: string[] = [];
  let q: '"' | "'" | undefined;
  let d = 0;
  let s = 0;
  const a = (p: string) => {
    const x = security.trim(p);
    if (!x) return;
    if (w(x, security)) return;
    let i = -1;
    for (let j = 0; j < x.length; j += 1) {
      const c = security.charCode(x, j);
      if (c === 9 || c === 10 || c === 12 || c === 13 || c === 32) {
        i = j;
        break;
      }
    }
    const u = i < 0 ? x : security.slice(x, 0, i);
    const u2 =
      (u[0] === '"' && u[u.length - 1] === '"') || (u[0] === "'" && u[u.length - 1] === "'")
        ? security.slice(u, 1, -1)
        : u;
    if (!w(u2, security))
      securityArrayAppend(
        r,
        x,
        'Browser packages/browser/src/response-fragment-apply.ts collection',
      );
  };
  for (let i = 0; i < v.length; i += 1) {
    const x = v[i];
    if (q) {
      if (x === q) q = undefined;
    } else if (x === '"' || x === "'") q = x;
    else if (x === '(') d += 1;
    else if (x === ')' && d > 0) d -= 1;
    else if (x === ',' && d === 0) {
      a(security.slice(v, s, i));
      s = i + 1;
    }
  }
  a(security.slice(v, s));
  if (r.length === 0) return null;
  let result = '';
  for (let index = 0; index < r.length; index += 1) {
    const candidate = r[index];
    if (candidate !== undefined) result += (result === '' ? '' : ', ') + candidate;
  }
  return result || null;
}

function c(v: string, security: HtmlResponseFragmentSecurityControls): boolean {
  const p = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*?))\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = security.regExpExec(p, v)) !== null) {
    if (w(security.trim(m[1] ?? m[2] ?? m[3] ?? ''), security)) return true;
  }
  return (
    security.regExpTest(/\bexpression\s*\(/i, v) || security.regExpTest(/-moz-binding\s*:/i, v)
  );
}

function w(v: string, security: HtmlResponseFragmentSecurityControls): boolean {
  let normalized = '';
  for (let index = 0; index < v.length; index += 1) {
    if (security.charCode(v, index) > 0x20) normalized += v[index];
  }
  const s = security.lower(normalized);
  const colon = security.indexOf(s, ':');
  if (colon <= 0) return false;
  for (let index = 0; index < colon; index += 1) {
    const code = security.charCode(s, index);
    const letter = code >= 0x61 && code <= 0x7a;
    const digit = code >= 0x30 && code <= 0x39;
    if (!letter && (index === 0 || (!digit && code !== 0x2b && code !== 0x2e && code !== 0x2d))) {
      return false;
    }
  }
  const scheme = security.slice(s, 0, colon);
  return (
    scheme !== 'http' &&
    scheme !== 'https' &&
    scheme !== 'ftp' &&
    scheme !== 'mailto' &&
    scheme !== 'tel'
  );
}

export const __responseFragmentApplySanitizerParityForTests = {
  hasUnsafeCssText(value: string): boolean {
    return c(value, createBrowserNavigationSecurityControls());
  },
  hasUnsafeUrlScheme(value: string): boolean {
    return w(value, createBrowserNavigationSecurityControls());
  },
  isBlockedSvgSmilElementName(value: string): boolean {
    const security = createBrowserNavigationSecurityControls();
    return isBlockedSvgSmilTagName(value, security);
  },
  sanitizeAttribute(e: Element, name: string, value: string): void {
    sa(e, name, value, createBrowserNavigationSecurityControls());
  },
  sanitizeSrcset(value: string): string | null {
    return y(value, createBrowserNavigationSecurityControls());
  },
};

function u(c: Element, n: Element, security: HtmlResponseFragmentSecurityControls): void {
  const current = security.snapshotElementChildren(c);
  const next = security.snapshotChildNodes(n);
  const desired: ChildNode[] = [];
  const currentByKey = security.createSecurityMap<string, Element>();
  const used = security.createSecurityMap<Element, true>();
  for (let currentIndex = 0; currentIndex < current.length; currentIndex += 1) {
    const candidate = current[currentIndex];
    if (!candidate) continue;
    const key = k(candidate, security);
    if (key !== null && !security.hasSecurityMapValue(currentByKey, key)) {
      security.setSecurityMapValue(currentByKey, key, candidate);
    }
  }
  for (let nextIndex = 0; nextIndex < next.length; nextIndex += 1) {
    const nextNode = next[nextIndex];
    if (!nextNode) continue;
    if (security.readElementTagName(nextNode) !== undefined) {
      const nextElement = nextNode as Element;
      const key = k(nextElement, security);
      const candidate = key === null ? undefined : security.getSecurityMapValue(currentByKey, key);
      const match =
        candidate !== undefined && !security.hasSecurityMapValue(used, candidate)
          ? candidate
          : undefined;
      if (match !== undefined) security.setSecurityMapValue(used, match, true);
      const resolved = match
        ? m(match, nextElement, security)
        : g(security.cloneDomNode(nextElement, true) as Element, security);
      securityArrayAppend(
        desired,
        resolved,
        'Browser packages/browser/src/response-fragment-apply.ts collection',
      );
    } else {
      securityArrayAppend(
        desired,
        security.cloneDomNode(nextNode, true) as ChildNode,
        'Browser packages/browser/src/response-fragment-apply.ts collection',
      );
    }
  }

  security.replaceElementChildren(c, desired);
}
