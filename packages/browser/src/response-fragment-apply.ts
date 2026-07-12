import type { RenderedFragmentHtml } from '@kovojs/core/internal/sink-policy';

import type { FragmentChunk } from './wire-response-scanner.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

type BrowserNavigationSecurityControls = ReturnType<typeof createBrowserNavigationSecurityControls>;

export type HtmlResponseFragmentSecurityControls = Pick<
  BrowserNavigationSecurityControls,
  | 'appendElementChildren'
  | 'charCode'
  | 'cloneDomNode'
  | 'createFragmentContent'
  | 'elementContains'
  | 'hasElementAttribute'
  | 'indexOf'
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
  | 'slice'
  | 'snapshotChildNodes'
  | 'snapshotElementAttributes'
  | 'snapshotElementChildren'
  | 'trim'
>;

// SF-WIRE (secure-framework Tier 3, Trusted Types — WIRED): the `p` and `d` helpers
// below (their `insertAdjacentHTML('beforeend', …)` and `t.innerHTML = h` raw-HTML write
// sinks) are EXTRACTED VERBATIM into the always-on inline loader by `inline-loader-build.ts`
// (the `responseApply` spec; a byte-parity test pins the generated `inline-loader.ts`), and
// that extractor forbids referencing any top-level binding. So unlike the module-side sinks
// in `morph.ts`/`query-bindings.ts` — which route through `kovoCreateHTML` (trusted-types.ts)
// — these two sinks cannot call `kovoCreateHTML`. Instead they call the self-contained
// `trustedHtml` shim BELOW, which is itself a top-level function declaration, so the inline
// extractor pulls it into the closure as a dependency (no top-level import). The shim mints a
// `TrustedHTML` via the framework `kovo` Trusted Types policy when Chromium exposes
// `globalThis.trustedTypes`, caching the policy on a shared global (`__kovo_tt`) so the inline
// loader and the module-side `kovoCreateHTML` reuse the SAME policy — `trusted-types kovo`
// admits no duplicates, so a second `createPolicy('kovo')` would throw. On every other engine
// (and Chromium without the CSP directive) `trustedTypes` is absent and the shim returns the
// raw string verbatim (transparent passthrough — behavior-preserving). Routing these last
// always-on sinks is what lets the strict CSP's `require-trusted-types-for 'script'` directive
// (server `csp.ts`) ship DEFAULT-ON without bricking Kovo's own hydration on Chromium. CSP is
// the cross-browser floor; Trusted Types is Chromium-only runtime defense-in-depth (SPEC §6.6)
// — it kills DOM-XSS sinks OUTSIDE the framework but is silently ignored by every non-Chromium
// engine, so it is a hardening floor, NOT a by-construction proof.

/**
 * SF (secure-framework Tier 3): the self-contained Trusted Types `createHTML` shim embedded
 * into the always-on inline loader's extracted closure. References no top-level binding (the
 * inline extractor forbids that), so the policy detection/creation/caching is inlined here.
 * Returns a `TrustedHTML` (typed as `string` so the sinks compile unchanged) where Trusted
 * Types is enforced, and the raw string everywhere TT is absent. The shared `__kovo_tt` global
 * keeps the single `kovo` policy in lockstep with the module-side `kovoCreateHTML`.
 *
 * @internal
 */
function trustedHtml(h: string): string {
  const w = globalThis as {
    trustedTypes?: {
      createPolicy(
        name: string,
        rules: { createHTML(input: string): string },
      ): {
        createHTML(input: string): string;
      };
    };
    __kovo_tt?: { createHTML(input: string): string } | null;
  };
  const t = w.trustedTypes;
  if (!t) return h;
  let p = w.__kovo_tt;
  if (p === undefined) {
    try {
      p = t.createPolicy('kovo', { createHTML: (s: string) => s });
    } catch {
      p = null;
    }
    w.__kovo_tt = p;
  }
  return p ? (p.createHTML(h) as unknown as string) : h;
}

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
      applied[applied.length] = fragment.target;
    }
  }

  return applied;
}

export function applyHtmlResponseFragments(
  fragments: readonly FragmentChunk[],
  findFragmentTarget: (target: string) => HtmlResponseFragmentApplyTarget | null | undefined,
  security: HtmlResponseFragmentSecurityControls = createBrowserNavigationSecurityControls(),
): string[] {
  return p(fragments, findFragmentTarget, security);
}

export function p(
  fs: readonly FragmentChunk[],
  f: (target: string) => HtmlResponseFragmentApplyTarget | null | undefined,
  security: HtmlResponseFragmentSecurityControls,
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
      // Concurrent hardening (template + g() attribute sanitization) PLUS Trusted Types routing:
      // the raw-HTML write goes through the inlined `trustedHtml` shim so it mints a TrustedHTML
      // under the strict CSP's `require-trusted-types-for 'script'`, and g() still neutralizes
      // dangerous attributes/URLs on the inserted children (SPEC §4.4/§9.1/§6.6).
      const content = security.createFragmentContent(
        trustedHtml(renderedFragmentHtmlContent(x.html)),
      );
      if (x.mode === 'prepend') {
        // SPEC §9.3/§13.2: insert keyed rows at the START, deduped by kovo-key (a
        // row whose key is already present is skipped, never re-inserted), and keep
        // the scroll anchor — the target is the scroll container, so its scrollTop is
        // shifted by the inserted height to keep existing ("load older") content
        // visually fixed (no jump). Inert-until-touched holds as for append.
        const ex = new Set<string>();
        const currentRows = security.snapshotElementChildren(e);
        for (let index = 0; index < currentRows.length; index += 1) {
          const current = currentRows[index];
          if (!current) continue;
          const ck = k(current, security);
          if (ck !== null) ex.add(ck);
        }
        const ins: Element[] = [];
        const incoming = security.snapshotElementChildren(content);
        for (let index = 0; index < incoming.length; index += 1) {
          const n = incoming[index];
          if (!n) continue;
          const nk = k(n, security);
          if (nk !== null && ex.has(nk)) continue;
          ins[ins.length] = n;
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
      d(e, x.html, security);
    }
    a[a.length] = x.target;
  }

  return a;
}

function d(
  e: HtmlResponseFragmentApplyTarget,
  h: RenderedFragmentHtml,
  security: HtmlResponseFragmentSecurityControls,
): void {
  const content = security.createFragmentContent(trustedHtml(renderedFragmentHtmlContent(h)));
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
      q[q.length] = x;
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
  const n = security.lower(name);
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

function g(e: Element, security: HtmlResponseFragmentSecurityControls): Element {
  const descendants = security.queryAllElements(e, '*');
  for (let elementIndex = -1; elementIndex < descendants.length; elementIndex += 1) {
    const x = elementIndex < 0 ? e : descendants[elementIndex];
    if (!x) continue;
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
    if (!w(u2, security)) r[r.length] = x;
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
  for (let nextIndex = 0; nextIndex < next.length; nextIndex += 1) {
    const nextNode = next[nextIndex];
    if (!nextNode) continue;
    if (security.readElementTagName(nextNode) !== undefined) {
      const nextElement = nextNode as Element;
      const key = k(nextElement, security);
      let match: Element | undefined;
      if (key !== null) {
        for (let currentIndex = 0; currentIndex < current.length; currentIndex += 1) {
          const candidate = current[currentIndex];
          if (candidate && k(candidate, security) === key) {
            match = candidate;
            break;
          }
        }
      }
      const resolved = match
        ? m(match, nextElement, security)
        : g(security.cloneDomNode(nextElement, true) as Element, security);
      desired[desired.length] = resolved;
    } else {
      desired[desired.length] = security.cloneDomNode(nextNode, true) as ChildNode;
    }
  }

  security.replaceElementChildren(c, desired);
}
